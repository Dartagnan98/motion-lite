// QuickBooks Online — OAuth 2.0 + token management (Phase 4 Sprint 1).
//
// Reuses the MCP's PRODUCTION Intuit app (INTUIT_CLIENT_ID/SECRET) but mints the
// platform's OWN token via its own OAuth round-trip (does NOT share the MCP
// refresh token — that would rotate and break the MCP). Token lives in the
// shared tenant credential store (provider='qbo', identity=realmId), refreshed
// against it — same model as the Google adapters.

import { ensurePlatformReady } from '../../tenant'
import {
  saveTenantCredential,
  loadTenantCredentialById,
  updateTenantCredentialAccessToken,
} from '../../vault'
import { getDb, generatePublicId } from '../../../db'

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const SCOPE = 'com.intuit.quickbooks.accounting'
const REFRESH_BUFFER_SECONDS = 120

/** Production vs sandbox API base. */
export function qboApiBase(): string {
  return process.env.INTUIT_OAUTH_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
}

function basicAuthHeader(): string {
  const id = process.env.INTUIT_CLIENT_ID
  const secret = process.env.INTUIT_CLIENT_SECRET
  if (!id || !secret) throw new Error('qbo.oauth: INTUIT_CLIENT_ID / INTUIT_CLIENT_SECRET not set')
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
}

/** Build the Intuit consent URL. state must be HMAC-signed by the caller. */
export function buildAuthUrl(args: { redirectUri: string; state: string }): string {
  const clientId = process.env.INTUIT_CLIENT_ID
  if (!clientId) throw new Error('qbo.oauth: INTUIT_CLIENT_ID not set')
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: args.redirectUri,
    state: args.state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export interface QboExchange {
  access_token: string
  refresh_token: string
  expires_in: number
}

/** Exchange the authorization code for tokens. */
export async function exchangeCode(args: { code: string; redirectUri: string }): Promise<QboExchange> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: args.code, redirect_uri: args.redirectUri }),
  })
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !data.access_token || !data.refresh_token) {
    throw new Error(`qbo.oauth: token exchange failed (${res.status}): ${data.error_description || data.error || JSON.stringify(data)}`)
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in ?? 3600 }
}

export async function exchangeRefreshToken(refresh_token: string): Promise<QboExchange> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token }),
  })
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`qbo.oauth: refresh failed (${res.status}): ${data.error_description || data.error || JSON.stringify(data)}`)
  }
  // Intuit rotates the refresh token on every refresh — persist the new one.
  return { access_token: data.access_token, refresh_token: data.refresh_token ?? refresh_token, expires_in: data.expires_in ?? 3600 }
}

const refreshLocks = new Map<number, Promise<string>>()

/** Valid access token for a shared QBO tenant credential (refresh if expired). */
export async function getValidAccessTokenForCredential(credentialId: number): Promise<string> {
  ensurePlatformReady()
  const cred = loadTenantCredentialById(credentialId)
  if (!cred || !cred.access_token) throw new Error(`qbo.oauth: no tenant credential ${credentialId}`)
  const now = Math.floor(Date.now() / 1000)
  if (cred.token_expiry && cred.token_expiry > now + REFRESH_BUFFER_SECONDS) return cred.access_token
  const inFlight = refreshLocks.get(credentialId)
  if (inFlight) return inFlight
  const promise = (async () => {
    try {
      if (!cred.refresh_token) throw new Error('qbo.oauth: credential expired and has no refresh_token')
      const fresh = await exchangeRefreshToken(cred.refresh_token)
      updateTenantCredentialAccessToken({
        id: credentialId,
        access_token: fresh.access_token,
        token_expiry: Math.floor(Date.now() / 1000) + fresh.expires_in,
        refresh_token: fresh.refresh_token,
      })
      return fresh.access_token
    } finally { refreshLocks.delete(credentialId) }
  })()
  refreshLocks.set(credentialId, promise)
  return promise
}

/** Resolve a valid access token for a QBO integration (via its tenant credential). */
export async function getValidAccessToken(integrationId: number): Promise<string> {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT tenant_credential_id FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { tenant_credential_id: number | null } | undefined
  if (!row?.tenant_credential_id) throw new Error(`qbo.oauth: integration ${integrationId} has no tenant_credential_id`)
  return getValidAccessTokenForCredential(row.tenant_credential_id)
}

/** Persist the QBO tenant credential + the tenant-level integration row.
 *  account_id is NULL (serves all the tenant's clients). Dedupe: one QBO
 *  integration per tenant. */
export function persistIntegration(args: {
  tenantId: number
  agencyId: number | null
  realmId: string
  exchange: QboExchange
}): { integrationId: number } {
  ensurePlatformReady()
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  const credentialId = saveTenantCredential({
    tenant_id: args.tenantId,
    provider: 'qbo',
    auth_model: 'oauth',
    identity: args.realmId,
    access_token: args.exchange.access_token,
    refresh_token: args.exchange.refresh_token,
    token_expiry: now + args.exchange.expires_in,
    scopes: SCOPE,
    provider_user_id: args.realmId,
  })

  const config = JSON.stringify({ realmId: args.realmId })
  const displayName = `QuickBooks Online — realm ${args.realmId}`

  // Dedupe: one tenant-level QBO integration (account_id NULL).
  const existing = db.prepare(
    `SELECT id FROM platform_integrations WHERE tenant_id = ? AND provider = 'qbo' ORDER BY id LIMIT 1`
  ).get(args.tenantId) as { id: number } | undefined
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

  const result = db.prepare(
    `INSERT INTO platform_integrations
       (tenant_id, public_id, level, agency_id, account_id, domain_id,
        provider, auth_model, config_json, display_name, tenant_credential_id,
        status, last_health_status, last_health_checked_at, last_synced_at,
        created_at, updated_at)
     VALUES (?, ?, 'agency', ?, NULL, NULL, 'qbo', 'oauth', ?, ?, ?, 'connected', 'green', ?, NULL, ?, ?)`
  ).run(
    args.tenantId, generatePublicId(),
    args.agencyId, config, displayName, credentialId, now, now, now,
  )
  return { integrationId: Number(result.lastInsertRowid) }
}

/** GET a QBO API path (query or report). Returns parsed JSON. */
export async function qboApiGet(accessToken: string, realmId: string, path: string): Promise<unknown> {
  const url = `${qboApiBase()}/v3/company/${realmId}/${path}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`qbo.api: GET ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.json()
}
