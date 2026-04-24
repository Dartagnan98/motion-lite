// Provider token storage (SQLite)
// Will migrate to Supabase once DB access is confirmed

import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), '..', 'store', 'motion.db')

function getDb(): Database.Database {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export async function saveProviderToken(
  userId: number,
  provider: string,
  accessToken: string,
  refreshToken: string | null,
  expiresIn: number,
  providerUserId?: string,
  providerEmail?: string
): Promise<void> {
  const db = getDb()
  const expiry = Math.floor(Date.now() / 1000) + expiresIn
  db.prepare(
    `INSERT INTO provider_tokens (user_id, provider, access_token, refresh_token, token_expiry, provider_user_id, provider_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, provider_tokens.refresh_token),
       token_expiry = excluded.token_expiry,
       provider_user_id = excluded.provider_user_id,
       provider_email = excluded.provider_email,
       updated_at = strftime('%s','now')`
  ).run(userId, provider, accessToken, refreshToken, expiry, providerUserId || null, providerEmail || null)
}

export async function getProviderToken(userId: number, provider: string): Promise<{
  access_token: string
  refresh_token: string | null
  token_expiry: number
  provider_user_id: string | null
  provider_email: string | null
} | null> {
  const db = getDb()
  return db.prepare(
    'SELECT access_token, refresh_token, token_expiry, provider_user_id, provider_email FROM provider_tokens WHERE user_id = ? AND provider = ?'
  ).get(userId, provider) as {
    access_token: string
    refresh_token: string | null
    token_expiry: number
    provider_user_id: string | null
    provider_email: string | null
  } | null
}

export async function updateProviderToken(
  userId: number,
  provider: string,
  accessToken: string,
  refreshToken?: string | null,
  expiresIn?: number
): Promise<void> {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  if (refreshToken !== undefined && refreshToken !== null && expiresIn !== undefined) {
    const expiry = now + expiresIn
    db.prepare(
      "UPDATE provider_tokens SET access_token = ?, refresh_token = ?, token_expiry = ?, updated_at = strftime('%s','now') WHERE user_id = ? AND provider = ?"
    ).run(accessToken, refreshToken, expiry, userId, provider)
  } else if (expiresIn !== undefined) {
    const expiry = now + expiresIn
    db.prepare(
      "UPDATE provider_tokens SET access_token = ?, token_expiry = ?, updated_at = strftime('%s','now') WHERE user_id = ? AND provider = ?"
    ).run(accessToken, expiry, userId, provider)
  } else {
    db.prepare(
      "UPDATE provider_tokens SET access_token = ?, updated_at = strftime('%s','now') WHERE user_id = ? AND provider = ?"
    ).run(accessToken, userId, provider)
  }
}

export async function deleteProviderToken(userId: number, provider: string): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM provider_tokens WHERE user_id = ? AND provider = ?').run(userId, provider)
}
