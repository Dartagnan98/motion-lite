// GSC OAuth flow (Google).
//
// Mirrors motion-lite's google.ts pattern (auth code → exchange → save tokens),
// but writes to platform_oauth_tokens via vault.ts and creates a
// platform_integrations row keyed to a tenant + level.
//
// Scopes required:
//   webmasters.readonly  — read site list, search analytics, sitemaps (read-only)
//
// Why not webmasters (full)? We never write back to GSC. Stay minimal.
//
// ─── Threat model: OAuth state-forgery / cross-tenant write ────────────────
// The OAuth `state` round-trips through the user's browser to Google and back.
// If state is unsigned, an attacker can craft a state pointing at a tenant /
// level / agency_id / account_id / domain_id they don't own, walk through the
// flow with their own GSC credentials, and the callback handler will write a
// platform_integrations row + token into the victim's tenant.
//
// Defense (Option A — chosen): HMAC-sign the state with a server-only secret
// derived from CRM_ENCRYPTION_KEY. State format is `<b64u_payload>.<hex_hmac>`.
// The signing helpers live in `src/lib/platform/state.ts`; this adapter calls
// `signState()` in `adapter.ts:connect()` and `verifyState()` in
// `connect-flow.ts:decodeState()`. Any callback whose state fails HMAC is
// rejected before any DB write.
//
// Why not Option B (server-side nonce table)? Stateless HMAC is sufficient
// for this threat model (we control both ends, the OAuth code itself is
// single-use at Google), avoids a new table + GC job, and ports cleanly to
// Phase 4. If we later want explicit replay protection we add an `iat` claim
// in state.ts without touching adapters.
//
// All future OAuth adapters MUST follow this same pattern. See
// adapter-contract.ts:connect() for the contract requirement.
// ───────────────────────────────────────────────────────────────────────────

import { getDb, generatePublicId } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import { saveToken, updateAccessToken, loadToken } from '../../vault'
import {
  saveTenantCredential,
  loadTenantCredentialById,
  updateTenantCredentialAccessToken,
} from '../../vault'
import type { GscSitesListResponse } from './types'

// Combined Google scopes: request BOTH Search Console + Analytics read access
// (plus email) on every Google consent, so a single agency Google login yields
// one shared credential reusable for BOTH GSC and GA4 connects (see
// CONNECTOR-REUSE-PLAN). All read-only.
const GSC_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const

/** Minimum buffer before token expiry to consider it "still valid" (seconds). */
const REFRESH_BUFFER_SECONDS = 60

/** Build the Google OAuth consent URL for GSC.
 *  callbackState gets serialized into the `state` param so the callback
 *  can re-attach the integration to the right level/tenant. */
export function buildAuthUrl(args: {
  redirectUri: string
  state: string
}): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('gsc.oauth: GOOGLE_CLIENT_ID env var not set')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: GSC_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: args.state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export interface ExchangeResult {
  access_token: string
  refresh_token: string | null
  expires_in: number  // seconds
  email: string | null
  scopes: string
}

/** Exchange the authorization code for tokens and resolve the user's email. */
export async function exchangeCode(args: {
  code: string
  redirectUri: string
}): Promise<ExchangeResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('gsc.oauth: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set')
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
      `gsc.oauth: token exchange failed — ${tokens.error || 'unknown'}: ${tokens.error_description || JSON.stringify(tokens)}`
    )
  }

  // Resolve email so we can show "connected as <email>" in the UI.
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
    // Non-fatal — we still have a valid token.
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_in: tokens.expires_in ?? 3600,
    email,
    scopes: tokens.scope || GSC_SCOPES.join(' '),
  }
}

// Per-integration refresh lock. Prevents races when multiple report blocks
// concurrently fetch and trigger refresh on the same integration.
const refreshLocks = new Map<number | string, Promise<string>>()

/** Return a valid (unexpired) access token for the integration, refreshing
 *  if needed. Throws if no token row or refresh fails. */
/** Exchange a refresh token for a fresh access token. Shared by the
 *  per-integration and tenant-credential refresh paths. */
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number; refresh_token: string | null }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('gsc.oauth: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set')
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = (await res.json()) as {
    access_token?: string; expires_in?: number; refresh_token?: string
    error?: string; error_description?: string
  }
  if (!data.access_token) {
    throw new Error(`gsc.oauth: refresh failed — ${data.error || 'unknown'}: ${data.error_description || JSON.stringify(data)}`)
  }
  return { access_token: data.access_token, expires_in: data.expires_in ?? 3600, refresh_token: data.refresh_token ?? null }
}

/** Resolve a valid access token for a shared tenant credential, refreshing
 *  against the tenant store if expired. Lock keyed by credential id. */
export async function getValidAccessTokenForCredential(credentialId: number): Promise<string> {
  ensurePlatformReady()
  const cred = loadTenantCredentialById(credentialId)
  if (!cred || !cred.access_token) {
    throw new Error(`gsc.oauth: no tenant credential ${credentialId}`)
  }
  const now = Math.floor(Date.now() / 1000)
  if (cred.token_expiry && cred.token_expiry > now + REFRESH_BUFFER_SECONDS) {
    return cred.access_token
  }
  const lockKey = `cred:${credentialId}`
  const inFlight = refreshLocks.get(lockKey)
  if (inFlight) return inFlight

  const promise = (async () => {
    try {
      if (!cred.refresh_token) throw new Error('gsc.oauth: tenant credential expired and has no refresh_token')
      const fresh = await refreshGoogleToken(cred.refresh_token)
      updateTenantCredentialAccessToken({
        id: credentialId,
        access_token: fresh.access_token,
        token_expiry: Math.floor(Date.now() / 1000) + fresh.expires_in,
        refresh_token: fresh.refresh_token,
      })
      return fresh.access_token
    } finally {
      refreshLocks.delete(lockKey)
    }
  })()
  refreshLocks.set(lockKey, promise)
  return promise
}

export async function getValidAccessToken(integrationId: number): Promise<string> {
  ensurePlatformReady()

  // Resolve tenant_id + whether this integration uses a SHARED tenant credential.
  const integrationRow = getDb().prepare(
    'SELECT tenant_id, tenant_credential_id FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { tenant_id: number; tenant_credential_id: number | null } | undefined
  if (!integrationRow) {
    throw new Error(`gsc.oauth: integration ${integrationId} not found (cannot resolve tenant_id)`)
  }

  // Shared tenant credential path (reused across clients).
  if (integrationRow.tenant_credential_id) {
    return getValidAccessTokenForCredential(integrationRow.tenant_credential_id)
  }

  // Legacy per-integration token path (existing connections — unchanged).
  const stored = loadToken(integrationId)
  if (!stored) throw new Error(`gsc.oauth: no token for integration ${integrationId}`)

  const now = Math.floor(Date.now() / 1000)
  if (stored.token_expiry && stored.token_expiry > now + REFRESH_BUFFER_SECONDS) {
    return stored.access_token
  }
  const inFlight = refreshLocks.get(integrationId)
  if (inFlight) return inFlight
  const tenantId = integrationRow.tenant_id

  const promise = (async () => {
    try {
      if (!stored.refresh_token) {
        throw new Error('gsc.oauth: token expired and no refresh_token on record')
      }
      const fresh = await refreshGoogleToken(stored.refresh_token)
      updateAccessToken({
        tenant_id: tenantId,
        integration_id: integrationId,
        access_token: fresh.access_token,
        token_expiry: Math.floor(Date.now() / 1000) + fresh.expires_in,
        refresh_token: fresh.refresh_token,
      })
      return fresh.access_token
    } finally {
      refreshLocks.delete(integrationId)
    }
  })()
  refreshLocks.set(integrationId, promise)
  return promise
}

/** List the GSC sites the OAuthed user can read. Used during connect to let
 *  the PM pick which property to attach. */
export async function listSites(accessToken: string): Promise<GscSitesListResponse> {
  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`gsc.oauth: sites.list failed (${res.status}): ${text}`)
  }
  return (await res.json()) as GscSitesListResponse
}

/** Persist the integration + token. Called from the OAuth callback once we
 *  know which level + entity the user is connecting. */
export function persistIntegration(args: {
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  /** Verified GSC site URL the user picked. */
  siteUrl: string
  email: string | null
  /** Fresh OAuth result — adopted into the tenant credential store. */
  exchange?: ExchangeResult
  /** Reuse an existing shared tenant credential instead of a fresh exchange. */
  tenantCredentialId?: number
}): { integrationId: number } {
  ensurePlatformReady()
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const config = JSON.stringify({ siteUrl: args.siteUrl })

  // Resolve the shared tenant credential: reuse the given one, or adopt the
  // fresh exchange into the tenant store (so future clients reuse this Google
  // identity without re-auth). The integration references it via
  // tenant_credential_id; getValidAccessToken resolves + refreshes from there.
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
  if (!credentialId) {
    throw new Error('gsc.persistIntegration: need either exchange or tenantCredentialId')
  }

  const credEmail = args.email
    ?? loadTenantCredentialById(credentialId)?.identity
    ?? null

  // Dedupe: if this account already has a GSC integration, UPDATE it (reconnect
  // / reconfigure) instead of inserting a duplicate tile.
  if (args.accountId) {
    const existing = db.prepare(
      `SELECT id FROM platform_integrations
        WHERE tenant_id = ? AND provider = 'gsc' AND account_id = ?
        ORDER BY id LIMIT 1`
    ).get(args.tenantId, args.accountId) as { id: number } | undefined
    if (existing) {
      db.prepare(
        `UPDATE platform_integrations
            SET config_json = ?, display_name = ?, tenant_credential_id = ?,
                status = 'connected', last_health_status = 'green',
                last_health_message = NULL, updated_at = ?
          WHERE id = ?`
      ).run(config, credEmail ? `GSC — ${credEmail}` : 'GSC', credentialId, now, existing.id)
      return { integrationId: existing.id }
    }
  }

  const result = db.prepare(
    `INSERT INTO platform_integrations
       (tenant_id, public_id, level, agency_id, account_id, domain_id,
        provider, auth_model, config_json, display_name, tenant_credential_id,
        status, last_health_status, last_health_checked_at, last_synced_at,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'gsc', 'oauth', ?, ?, ?, 'connected', 'green', ?, NULL, ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.level,
    args.agencyId,
    args.accountId,
    args.domainId,
    config,
    credEmail ? `GSC — ${credEmail}` : 'GSC',
    credentialId,
    now,
    now,
    now,
  )
  const integrationId = Number(result.lastInsertRowid)

  // No per-integration token row — the shared tenant credential is the source
  // of truth (getValidAccessToken resolves it via tenant_credential_id).
  return { integrationId }
}

/** Bootstrap: mirror any existing per-integration Google tokens (from older
 *  GSC/GA4 connections) into the shared tenant credential store, so the connect
 *  page can offer "reuse studio@…" without a re-auth. Idempotent. */
export function adoptLegacyGoogleCredentials(tenantId: number): void {
  ensurePlatformReady()
  const db = getDb()
  const rows = db.prepare(
    `SELECT i.id AS integration_id, t.provider_email
       FROM platform_integrations i
       JOIN platform_oauth_tokens t ON t.integration_id = i.id
      WHERE i.tenant_id = ? AND i.provider IN ('gsc','ga4')
        AND i.tenant_credential_id IS NULL
        AND t.provider_email IS NOT NULL`
  ).all(tenantId) as { integration_id: number; provider_email: string }[]
  for (const r of rows) {
    const stored = loadToken(r.integration_id)
    if (!stored || !stored.refresh_token) continue
    saveTenantCredential({
      tenant_id: tenantId,
      provider: 'google',
      auth_model: 'oauth',
      identity: r.provider_email,
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      token_expiry: stored.token_expiry,
      scopes: stored.scopes,
    })
  }
}

export const GSC_OAUTH_SCOPES = GSC_SCOPES
