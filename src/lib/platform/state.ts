// Hiilite Platform — OAuth state signer (CSRF / state-forgery defense).
//
// Threat model: an OAuth `state` round-trips through the user's browser to the
// provider and back. If the callback handler trusts state contents verbatim,
// an attacker can forge a state that points connect outcomes (a freshly issued
// platform_integrations row + token) at a tenant they don't own. This file
// closes that hole with a stateless HMAC.
//
// Choice: Option A (HMAC over JSON), not Option B (server-side nonce table).
// Rationale:
//   - Stateless. No new table, no GC job, no read on the callback hot path.
//   - Sufficient for our threat model. We control both ends; the goal is
//     integrity + binding, not blocking replay (the OAuth code itself is
//     single-use at Google's end and the state is short-lived in practice).
//   - Ports cleanly to Phase 4 — same helper, same secret derivation; if we
//     later want replay protection we add an `iat` claim and a max-age check
//     here without touching adapters.
//
// Format: `<base64url(payload_json)>.<hex(hmac_sha256)>`
//   - payload_json: arbitrary adapter-defined object (provider, tenantId, …)
//   - hmac: HMAC-SHA256 over the base64url payload using the platform secret
//
// All adapters with authModel === 'oauth' MUST use signState() / verifyState()
// for the OAuth `state` param. See adapter-contract.ts.

import crypto from 'crypto'

/** Derive the HMAC key. Reuses CRM_ENCRYPTION_KEY (already required for the
 *  vault) so we don't introduce a new env-var surface. We HKDF-style derive
 *  a separate key for state signing so it cannot be confused with vault keys
 *  even if logs leak one or the other. */
function getStateHmacKey(): Buffer {
  const raw = process.env.CRM_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('platform/state: CRM_ENCRYPTION_KEY not set (required to sign OAuth state)')
  }
  // Derive a domain-separated key via HMAC. The label is fixed; rotating
  // CRM_ENCRYPTION_KEY rotates this key automatically.
  return crypto.createHmac('sha256', raw).update('hiilite-platform/oauth-state/v1').digest()
}

/** Sign a JSON-serializable payload. Returns `<b64u_payload>.<hex_hmac>`. */
export function signState(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, 'utf8').toString('base64url')
  const mac = crypto.createHmac('sha256', getStateHmacKey()).update(b64).digest('hex')
  return `${b64}.${mac}`
}

/** Verify a signed state and return the parsed payload, or null if the state
 *  is malformed, the HMAC mismatches, or the JSON is invalid. Constant-time
 *  HMAC comparison. Never throws — callers should treat null as "reject". */
export function verifyState<T = Record<string, unknown>>(signed: string): T | null {
  if (typeof signed !== 'string' || signed.length === 0) return null
  const dot = signed.lastIndexOf('.')
  if (dot <= 0 || dot === signed.length - 1) return null

  const b64 = signed.slice(0, dot)
  const macHex = signed.slice(dot + 1)

  let expected: Buffer
  try {
    expected = crypto.createHmac('sha256', getStateHmacKey()).update(b64).digest()
  } catch {
    return null
  }
  let provided: Buffer
  try {
    provided = Buffer.from(macHex, 'hex')
  } catch {
    return null
  }
  if (provided.length !== expected.length) return null
  if (!crypto.timingSafeEqual(provided, expected)) return null

  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8')
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
