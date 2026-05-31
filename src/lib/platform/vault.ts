// Hiilite Platform — Token vault (encrypt-at-rest)
//
// Wraps motion-lite's existing crm-crypto helpers (AES-256-GCM, key from
// CRM_ENCRYPTION_KEY env). Tokens persist in platform_oauth_tokens scoped
// to (tenant_id, integration_id). Storage format:
//
//   access_token_encrypted:  base64(iv|tag|ciphertext)  REQUIRED
//   refresh_token_encrypted: base64(iv|tag|ciphertext)  NULLABLE
//
// Why a wrapper:
// - one place to audit "what reads tokens?"
// - typed payloads instead of stringly-typed crm-crypto calls
// - lets us swap to a managed KMS at Phase 4 without touching adapter code

import { getDb } from '../db'
import { encryptSecret, decryptSecret } from '../crm-crypto'
import { ensurePlatformReady } from './tenant'

export interface StoredToken {
  access_token: string
  refresh_token: string | null
  token_expiry: number | null
  provider_user_id: string | null
  provider_email: string | null
  scopes: string | null
}

export interface SaveTokenInput {
  tenant_id: number
  integration_id: number
  access_token: string
  refresh_token?: string | null
  /** Unix-seconds expiry. NULL means non-expiring (e.g. permanent API key). */
  token_expiry?: number | null
  provider_user_id?: string | null
  provider_email?: string | null
  scopes?: string | null
}

/** Insert or update the token row for an integration. Encrypts before write. */
export function saveToken(input: SaveTokenInput): void {
  ensurePlatformReady()
  const accessEnc = encryptSecret(input.access_token)
  if (!accessEnc) throw new Error('vault.saveToken: access_token encryption failed')
  const refreshEnc = input.refresh_token ? encryptSecret(input.refresh_token) : null

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `INSERT INTO platform_oauth_tokens
       (tenant_id, integration_id, access_token_encrypted, refresh_token_encrypted,
        token_expiry, provider_user_id, provider_email, scopes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, platform_oauth_tokens.refresh_token_encrypted),
       token_expiry = excluded.token_expiry,
       provider_user_id = COALESCE(excluded.provider_user_id, platform_oauth_tokens.provider_user_id),
       provider_email = COALESCE(excluded.provider_email, platform_oauth_tokens.provider_email),
       scopes = COALESCE(excluded.scopes, platform_oauth_tokens.scopes),
       updated_at = excluded.updated_at`
  ).run(
    input.tenant_id,
    input.integration_id,
    accessEnc,
    refreshEnc,
    input.token_expiry ?? null,
    input.provider_user_id ?? null,
    input.provider_email ?? null,
    input.scopes ?? null,
    now,
  )
}

/** Read and decrypt the stored token for an integration. Returns null if missing
 *  or undecryptable (key rotation, corrupted row). Caller decides how to react. */
export function loadToken(integrationId: number): StoredToken | null {
  ensurePlatformReady()
  const row = getDb().prepare(
    `SELECT access_token_encrypted, refresh_token_encrypted, token_expiry,
            provider_user_id, provider_email, scopes
       FROM platform_oauth_tokens
      WHERE integration_id = ?`
  ).get(integrationId) as {
    access_token_encrypted: string
    refresh_token_encrypted: string | null
    token_expiry: number | null
    provider_user_id: string | null
    provider_email: string | null
    scopes: string | null
  } | undefined
  if (!row) return null

  const accessToken = decryptSecret(row.access_token_encrypted)
  if (!accessToken) return null
  const refreshToken = row.refresh_token_encrypted
    ? decryptSecret(row.refresh_token_encrypted)
    : null

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expiry: row.token_expiry,
    provider_user_id: row.provider_user_id,
    provider_email: row.provider_email,
    scopes: row.scopes,
  }
}

/** Update only the access token + expiry — typical refresh flow output.
 *  Refresh tokens may rotate too (Google does occasionally); pass non-null to update.
 *
 *  Defense-in-depth: the WHERE clause filters on `tenant_id` AND `integration_id`.
 *  `integration_id` is unique per row (UNIQUE constraint), so the data is
 *  already correct — but the explicit tenant filter makes a misrouted call
 *  fail loudly instead of silently writing to the wrong tenant. Pass the
 *  tenant_id you already hold (e.g. from the integration row). */
export function updateAccessToken(args: {
  tenant_id: number
  integration_id: number
  access_token: string
  token_expiry: number
  refresh_token?: string | null
}): void {
  ensurePlatformReady()
  const accessEnc = encryptSecret(args.access_token)
  if (!accessEnc) throw new Error('vault.updateAccessToken: encryption failed')
  const refreshEnc = args.refresh_token ? encryptSecret(args.refresh_token) : null

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  let info: { changes: number }
  if (refreshEnc) {
    info = db.prepare(
      `UPDATE platform_oauth_tokens
          SET access_token_encrypted = ?,
              refresh_token_encrypted = ?,
              token_expiry = ?,
              updated_at = ?
        WHERE integration_id = ? AND tenant_id = ?`
    ).run(accessEnc, refreshEnc, args.token_expiry, now, args.integration_id, args.tenant_id)
  } else {
    info = db.prepare(
      `UPDATE platform_oauth_tokens
          SET access_token_encrypted = ?,
              token_expiry = ?,
              updated_at = ?
        WHERE integration_id = ? AND tenant_id = ?`
    ).run(accessEnc, args.token_expiry, now, args.integration_id, args.tenant_id)
  }
  if (info.changes === 0) {
    throw new Error(
      `vault.updateAccessToken: no row updated for integration_id=${args.integration_id} tenant_id=${args.tenant_id} (mismatched tenant or missing token row)`
    )
  }
}

/** Delete the token row. Use on integration disconnect or auth-error wipeout. */
export function deleteToken(integrationId: number): void {
  ensurePlatformReady()
  getDb().prepare(
    'DELETE FROM platform_oauth_tokens WHERE integration_id = ?'
  ).run(integrationId)
}

// ─── Tenant-level shared credentials (CONNECTOR-REUSE-PLAN A1) ──────────
//
// One credential per (tenant, provider, identity), reused across clients. OAuth
// providers store access/refresh; api_key providers store api_key_encrypted.
// Encryption reuses the same AES-256-GCM path as per-integration tokens.

export interface TenantCredential {
  id: number
  tenant_id: number
  provider: string
  auth_model: 'oauth' | 'api_key'
  identity: string
  access_token: string | null
  refresh_token: string | null
  token_expiry: number | null
  scopes: string | null
  api_key: string | null
  provider_user_id: string | null
  status: string
}

export interface SaveTenantCredentialInput {
  tenant_id: number
  provider: string
  auth_model: 'oauth' | 'api_key'
  identity: string
  access_token?: string | null
  refresh_token?: string | null
  token_expiry?: number | null
  scopes?: string | null
  api_key?: string | null
  provider_user_id?: string | null
}

/** Insert/update a shared tenant credential. Returns its id. */
export function saveTenantCredential(input: SaveTenantCredentialInput): number {
  ensurePlatformReady()
  const accessEnc = input.access_token ? encryptSecret(input.access_token) : null
  const refreshEnc = input.refresh_token ? encryptSecret(input.refresh_token) : null
  const apiKeyEnc = input.api_key ? encryptSecret(input.api_key) : null

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `INSERT INTO platform_tenant_credentials
       (tenant_id, provider, auth_model, identity, access_token_encrypted,
        refresh_token_encrypted, token_expiry, scopes, api_key_encrypted,
        provider_user_id, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
     ON CONFLICT(tenant_id, provider, identity) DO UPDATE SET
       auth_model = excluded.auth_model,
       access_token_encrypted = COALESCE(excluded.access_token_encrypted, platform_tenant_credentials.access_token_encrypted),
       refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, platform_tenant_credentials.refresh_token_encrypted),
       token_expiry = COALESCE(excluded.token_expiry, platform_tenant_credentials.token_expiry),
       scopes = COALESCE(excluded.scopes, platform_tenant_credentials.scopes),
       api_key_encrypted = COALESCE(excluded.api_key_encrypted, platform_tenant_credentials.api_key_encrypted),
       provider_user_id = COALESCE(excluded.provider_user_id, platform_tenant_credentials.provider_user_id),
       status = 'active',
       updated_at = excluded.updated_at`
  ).run(
    input.tenant_id, input.provider, input.auth_model, input.identity,
    accessEnc, refreshEnc, input.token_expiry ?? null, input.scopes ?? null,
    apiKeyEnc, input.provider_user_id ?? null, now,
  )
  const row = db.prepare(
    `SELECT id FROM platform_tenant_credentials WHERE tenant_id = ? AND provider = ? AND identity = ?`
  ).get(input.tenant_id, input.provider, input.identity) as { id: number }
  return row.id
}

function decodeCredentialRow(row: {
  id: number; tenant_id: number; provider: string; auth_model: string; identity: string
  access_token_encrypted: string | null; refresh_token_encrypted: string | null
  token_expiry: number | null; scopes: string | null; api_key_encrypted: string | null
  provider_user_id: string | null; status: string
}): TenantCredential {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    provider: row.provider,
    auth_model: row.auth_model as 'oauth' | 'api_key',
    identity: row.identity,
    access_token: row.access_token_encrypted ? decryptSecret(row.access_token_encrypted) : null,
    refresh_token: row.refresh_token_encrypted ? decryptSecret(row.refresh_token_encrypted) : null,
    token_expiry: row.token_expiry,
    scopes: row.scopes,
    api_key: row.api_key_encrypted ? decryptSecret(row.api_key_encrypted) : null,
    provider_user_id: row.provider_user_id,
    status: row.status,
  }
}

const SELECT_CRED = `SELECT id, tenant_id, provider, auth_model, identity,
  access_token_encrypted, refresh_token_encrypted, token_expiry, scopes,
  api_key_encrypted, provider_user_id, status FROM platform_tenant_credentials`

/** Load a tenant credential by id (decrypted). */
export function loadTenantCredentialById(id: number): TenantCredential | null {
  ensurePlatformReady()
  const row = getDb().prepare(`${SELECT_CRED} WHERE id = ?`).get(id) as Parameters<typeof decodeCredentialRow>[0] | undefined
  return row ? decodeCredentialRow(row) : null
}

/** List a tenant's credentials for a provider (e.g. all Google identities). */
export function listTenantCredentials(tenant_id: number, provider: string): TenantCredential[] {
  ensurePlatformReady()
  const rows = getDb().prepare(
    `${SELECT_CRED} WHERE tenant_id = ? AND provider = ? AND status = 'active' ORDER BY updated_at DESC`
  ).all(tenant_id, provider) as Parameters<typeof decodeCredentialRow>[0][]
  return rows.map(decodeCredentialRow)
}

/** Update only the access token + expiry on a shared credential (refresh flow). */
export function updateTenantCredentialAccessToken(args: {
  id: number
  access_token: string
  token_expiry: number
  refresh_token?: string | null
}): void {
  ensurePlatformReady()
  const accessEnc = encryptSecret(args.access_token)
  if (!accessEnc) throw new Error('vault.updateTenantCredentialAccessToken: encryption failed')
  const refreshEnc = args.refresh_token ? encryptSecret(args.refresh_token) : null
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `UPDATE platform_tenant_credentials
        SET access_token_encrypted = ?,
            refresh_token_encrypted = COALESCE(?, refresh_token_encrypted),
            token_expiry = ?,
            updated_at = ?
      WHERE id = ?`
  ).run(accessEnc, refreshEnc, args.token_expiry, now, args.id)
}
