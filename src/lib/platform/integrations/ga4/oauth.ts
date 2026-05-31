// GA4 OAuth flow (Google).
//
// Shares the same Google Cloud Console project / credentials as GSC:
//   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (already required for GSC).
//
// Scope required:
//   https://www.googleapis.com/auth/analytics.readonly
//   https://www.googleapis.com/auth/userinfo.email    (label "connected as X")
//
// After code exchange we call the Analytics Admin API to list the user's
// accessible GA4 properties. The frontend shows a property picker; the user
// selects one, and the route handler calls persistIntegration() with the
// chosen propertyId.
//
// ─── Threat model ────────────────────────────────────────────────────────────
// Same as GSC. OAuth state round-trips through the browser; an unsigned state
// allows cross-tenant write injection. We sign with signState() (HMAC-SHA256
// over CRM_ENCRYPTION_KEY-derived key). The callback verifies before any DB
// write. See src/lib/platform/state.ts for the full threat model.
// ─────────────────────────────────────────────────────────────────────────────

import { getDb, generatePublicId } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import { saveToken, updateAccessToken, loadToken } from '../../vault'
import {
  saveTenantCredential,
  loadTenantCredentialById,
  updateTenantCredentialAccessToken,
} from '../../vault'
import type { GA4AccountSummariesResponse, GA4PropertySummary } from './types'

// Combined Google scopes (Search Console + Analytics + email) — one consent
// yields a shared credential reusable for both GSC and GA4 (CONNECTOR-REUSE-PLAN).
export const GA4_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const

/** Minimum buffer before token expiry to consider it "still valid" (seconds).
 *  Mirror of GSC value — 60s is enough to complete a fetchSnapshot call. */
const REFRESH_BUFFER_SECONDS = 60

// ─── Auth URL ─────────────────────────────────────────────────────────────────

/** Build the Google OAuth consent URL for GA4. */
export function buildAuthUrl(args: {
  redirectUri: string
  state: string
}): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('ga4.oauth: GOOGLE_CLIENT_ID env var not set')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: GA4_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: args.state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

// ─── Code exchange ────────────────────────────────────────────────────────────

export interface ExchangeResult {
  access_token: string
  refresh_token: string | null
  expires_in: number
  email: string | null
  scopes: string
}

/** Exchange an authorization code for tokens and resolve the user's email. */
export async function exchangeCode(args: {
  code: string
  redirectUri: string
}): Promise<ExchangeResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('ga4.oauth: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set')
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: args.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  }
  if (!tokens.access_token) {
    throw new Error(
      `ga4.oauth: token exchange failed — ${tokens.error || 'unknown'}: ${tokens.error_description || JSON.stringify(tokens)}`
    )
  }

  let email: string | null = null
  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (userRes.ok) {
      const u = (await userRes.json()) as { email?: string }
      email = u.email || null
    }
  } catch {
    // Non-fatal.
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_in: tokens.expires_in ?? 3600,
    email,
    scopes: tokens.scope || GA4_OAUTH_SCOPES.join(' '),
  }
}

// ─── Per-integration refresh lock ────────────────────────────────────────────
// Prevents races when multiple concurrent report blocks all trigger a refresh
// for the same integration. Pattern mirrors GSC exactly.

const refreshLocks = new Map<number | string, Promise<string>>()

/** Return a valid (unexpired) access token for the integration, refreshing if
 *  needed. Throws if no token row or refresh fails. */
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number; refresh_token: string | null }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('ga4.oauth: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set')
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  })
  const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string }
  if (!data.access_token) {
    throw new Error(`ga4.oauth: refresh failed — ${data.error || 'unknown'}: ${data.error_description || JSON.stringify(data)}`)
  }
  return { access_token: data.access_token, expires_in: data.expires_in ?? 3600, refresh_token: data.refresh_token ?? null }
}

/** Valid access token for a shared tenant credential (refreshes against the tenant store). */
export async function getValidAccessTokenForCredential(credentialId: number): Promise<string> {
  ensurePlatformReady()
  const cred = loadTenantCredentialById(credentialId)
  if (!cred || !cred.access_token) throw new Error(`ga4.oauth: no tenant credential ${credentialId}`)
  const now = Math.floor(Date.now() / 1000)
  if (cred.token_expiry && cred.token_expiry > now + REFRESH_BUFFER_SECONDS) return cred.access_token
  const lockKey = `cred:${credentialId}`
  const inFlight = refreshLocks.get(lockKey)
  if (inFlight) return inFlight
  const promise = (async () => {
    try {
      if (!cred.refresh_token) throw new Error('ga4.oauth: tenant credential expired and has no refresh_token')
      const fresh = await refreshGoogleToken(cred.refresh_token)
      updateTenantCredentialAccessToken({ id: credentialId, access_token: fresh.access_token, token_expiry: Math.floor(Date.now() / 1000) + fresh.expires_in, refresh_token: fresh.refresh_token })
      return fresh.access_token
    } finally { refreshLocks.delete(lockKey) }
  })()
  refreshLocks.set(lockKey, promise)
  return promise
}

export async function getValidAccessToken(integrationId: number): Promise<string> {
  ensurePlatformReady()
  const integrationRow = getDb().prepare(
    'SELECT tenant_id, tenant_credential_id FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { tenant_id: number; tenant_credential_id: number | null } | undefined
  if (!integrationRow) {
    throw new Error(`ga4.oauth: integration ${integrationId} not found (cannot resolve tenant_id)`)
  }
  // Shared tenant credential path.
  if (integrationRow.tenant_credential_id) {
    return getValidAccessTokenForCredential(integrationRow.tenant_credential_id)
  }
  // Legacy per-integration token path (unchanged).
  const stored = loadToken(integrationId)
  if (!stored) throw new Error(`ga4.oauth: no token for integration ${integrationId}`)
  const now = Math.floor(Date.now() / 1000)
  if (stored.token_expiry && stored.token_expiry > now + REFRESH_BUFFER_SECONDS) return stored.access_token
  const inFlight = refreshLocks.get(integrationId)
  if (inFlight) return inFlight
  const tenantId = integrationRow.tenant_id
  const promise = (async () => {
    try {
      if (!stored.refresh_token) throw new Error('ga4.oauth: token expired and no refresh_token on record')
      const fresh = await refreshGoogleToken(stored.refresh_token)
      updateAccessToken({ tenant_id: tenantId, integration_id: integrationId, access_token: fresh.access_token, token_expiry: Math.floor(Date.now() / 1000) + fresh.expires_in, refresh_token: fresh.refresh_token })
      return fresh.access_token
    } finally { refreshLocks.delete(integrationId) }
  })()
  refreshLocks.set(integrationId, promise)
  return promise
}

// ─── Property listing ─────────────────────────────────────────────────────────

export interface GA4PropertyChoice {
  propertyId: string   // numeric portion only, e.g. '123456789'
  displayName: string
  accountDisplayName: string
}

/** List all GA4 properties the OAuthed user can read. Called during connect so
 *  the PM can pick which property to attach. Exposed for the frontend to call
 *  after the OAuth round-trip completes.
 *
 *  Pagination: the Admin API paginates at 200 account summaries. We follow
 *  nextPageToken until exhausted. Most agencies have < 10 accounts; this is
 *  a safety net. */
export async function listProperties(accessToken: string): Promise<GA4PropertyChoice[]> {
  const results: GA4PropertyChoice[] = []
  let pageToken: string | undefined

  do {
    const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ga4.oauth: accountSummaries.list failed (${res.status}): ${text}`)
    }
    const body = (await res.json()) as GA4AccountSummariesResponse
    for (const account of body.accountSummaries || []) {
      for (const prop of account.propertySummaries || []) {
        // Only include ordinary properties — not subproperties or rollups.
        if (prop.propertyType !== 'PROPERTY_TYPE_ORDINARY') continue
        const propertyId = prop.property.replace('properties/', '')
        results.push({
          propertyId,
          displayName: prop.displayName,
          accountDisplayName: account.displayName,
        })
      }
    }
    pageToken = body.nextPageToken
  } while (pageToken)

  return results
}

// ─── Integration persistence ─────────────────────────────────────────────────

/** Persist the integration row + token after the user picks a property.
 *  Called from connect-flow.ts:completeConnect(). */
export function persistIntegration(args: {
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  /** Numeric GA4 property ID the user selected. */
  propertyId: string
  propertyDisplayName: string
  email: string | null
  /** Fresh OAuth — adopted into the tenant credential store. */
  exchange?: ExchangeResult
  /** Reuse an existing shared tenant credential. */
  tenantCredentialId?: number
}): { integrationId: number } {
  ensurePlatformReady()
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const config = JSON.stringify({ propertyId: args.propertyId })

  // Resolve the shared tenant credential (reuse or adopt the fresh exchange).
  let credentialId = args.tenantCredentialId ?? null
  if (!credentialId && args.exchange) {
    credentialId = saveTenantCredential({
      tenant_id: args.tenantId,
      provider: 'google',
      auth_model: 'oauth',
      identity: args.email ?? 'google',
      access_token: args.exchange.access_token,
      refresh_token: args.exchange.refresh_token,
      token_expiry: Math.floor(Date.now() / 1000) + args.exchange.expires_in,
      scopes: args.exchange.scopes,
    })
  }
  if (!credentialId) throw new Error('ga4.persistIntegration: need either exchange or tenantCredentialId')

  const email = args.email ?? loadTenantCredentialById(credentialId)?.identity ?? null
  const displayName = email
    ? `GA4 — ${args.propertyDisplayName} (${email})`
    : `GA4 — ${args.propertyDisplayName}`

  // Dedupe: if this account already has a GA4 integration, UPDATE it instead of
  // inserting a duplicate tile (reconnect / reconfigure).
  if (args.accountId) {
    const existing = db.prepare(
      `SELECT id FROM platform_integrations
        WHERE tenant_id = ? AND provider = 'ga4' AND account_id = ?
        ORDER BY id LIMIT 1`
    ).get(args.tenantId, args.accountId) as { id: number } | undefined
    if (existing) {
      db.prepare(
        `UPDATE platform_integrations
            SET config_json = ?, display_name = ?, tenant_credential_id = ?,
                status = 'connected', last_health_status = 'green',
                last_health_message = NULL, updated_at = ?
          WHERE id = ?`
      ).run(config, displayName, credentialId, now, existing.id)
      return { integrationId: existing.id }
    }
  }

  const result = db.prepare(
    `INSERT INTO platform_integrations
       (tenant_id, public_id, level, agency_id, account_id, domain_id,
        provider, auth_model, config_json, display_name, tenant_credential_id,
        status, last_health_status, last_health_checked_at, last_synced_at,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ga4', 'oauth', ?, ?, ?, 'connected', 'green', ?, NULL, ?, ?)`
  ).run(
    args.tenantId, generatePublicId(), args.level, args.agencyId, args.accountId,
    args.domainId, config, displayName, credentialId, now, now, now,
  )
  return { integrationId: Number(result.lastInsertRowid) }
}
