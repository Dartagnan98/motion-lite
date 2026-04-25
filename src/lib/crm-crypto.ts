// Tiny AES-256-GCM helper for encrypting provider secrets (Stripe / Square).
// Intentionally minimal: one encrypt + one decrypt, with a dev fallback so
// local builds don't explode when CRM_ENCRYPTION_KEY isn't set.
//
// Storage format: base64("iv" | "authTag" | "ciphertext")
// - iv is 12 bytes (GCM recommended)
// - authTag is 16 bytes

import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

let warnedAboutDevKey = false

function getKey(): Buffer {
  const raw = process.env.CRM_ENCRYPTION_KEY
  if (raw && raw.length > 0) {
    // Accept either 64 hex chars, 44 base64 chars, or any raw string — we
    // hash to 32 bytes deterministically so operators don't have to be
    // precise about encoding.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
    return crypto.createHash('sha256').update(raw, 'utf8').digest()
  }
  if (!warnedAboutDevKey && process.env.NODE_ENV !== 'test') {
    warnedAboutDevKey = true
    // eslint-disable-next-line no-console
    console.warn('[crm-crypto] WARN: CRM_ENCRYPTION_KEY not set — using an in-memory dev key. Production deployments MUST set this.')
  }
  return crypto.createHash('sha256').update('ctrl-motion-dev-key-do-not-use-in-prod', 'utf8').digest()
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return null
  const key = getKey()
  if (key.length !== KEY_LEN) throw new Error('CRM encryption key must resolve to 32 bytes')
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (payload == null || payload === '') return null
  try {
    const buf = Buffer.from(payload, 'base64')
    if (buf.length < IV_LEN + TAG_LEN + 1) return null
    const iv = buf.subarray(0, IV_LEN)
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const ct = buf.subarray(IV_LEN + TAG_LEN)
    const key = getKey()
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString('utf8')
  } catch {
    return null
  }
}

/** Render a safe preview of a secret for display: `sk_live_••••1234`. */
export function previewSecret(plain: string | null | undefined): string | null {
  if (!plain) return null
  const trimmed = plain.trim()
  if (trimmed.length <= 8) return '•'.repeat(Math.max(4, trimmed.length))
  const head = trimmed.slice(0, 7)
  const tail = trimmed.slice(-4)
  return `${head}••••${tail}`
}
