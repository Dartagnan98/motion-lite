// Supabase REST API helper -- typed fetch wrapper
// Uses service role key for server-side operations

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

// ─── Token Encryption (AES-256-GCM) ───
import crypto from 'crypto'

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 32) || 'dev-only-insecure-encryption-key'

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'utf-8').subarray(0, 32), iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${tag}:${encrypted}`
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, tagHex, encrypted] = ciphertext.split(':')
  if (!ivHex || !tagHex || !encrypted) return ciphertext // not encrypted, return as-is
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'utf-8').subarray(0, 32), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    return ciphertext // fallback: return as-is if decryption fails
  }
}

// ─── Generic Supabase REST calls ───

export async function supabaseSelect<T>(
  table: string,
  query: string = '',
  options?: { single?: boolean }
): Promise<T | null> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    headers: {
      ...headers,
      ...(options?.single ? { Accept: 'application/vnd.pgrst.object+json' } : {}),
    },
  })
  if (!res.ok) {
    if (res.status === 406 && options?.single) return null // no rows
    console.error(`Supabase SELECT ${table} error:`, res.status, await res.text())
    return null
  }
  return res.json()
}

export async function supabaseInsert<T>(
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  options?: { onConflict?: string; returning?: boolean }
): Promise<T | null> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${options?.onConflict ? `?on_conflict=${options.onConflict}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: `${options?.onConflict ? 'resolution=merge-duplicates,' : ''}${options?.returning !== false ? 'return=representation' : 'return=minimal'}`,
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    console.error(`Supabase INSERT ${table} error:`, res.status, await res.text())
    return null
  }
  if (options?.returning === false) return null
  return res.json()
}

export async function supabaseUpdate<T>(
  table: string,
  query: string,
  data: Record<string, unknown>,
  options?: { returning?: boolean }
): Promise<T | null> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...headers,
      Prefer: options?.returning !== false ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    console.error(`Supabase UPDATE ${table} error:`, res.status, await res.text())
    return null
  }
  if (options?.returning === false) return null
  return res.json()
}

export async function supabaseDelete(table: string, query: string): Promise<boolean> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) {
    console.error(`Supabase DELETE ${table} error:`, res.status, await res.text())
    return false
  }
  return true
}
