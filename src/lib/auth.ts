// Auth module -- users, sessions, password hashing
// Uses SQLite for storage (will migrate to Supabase when DB access is confirmed)

import crypto from 'crypto'
import { cookies, headers } from 'next/headers'
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), '..', 'store', 'motion.db')

function getDb(): Database.Database {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

// ─── Types ───

export interface User {
  id: number
  email: string
  name: string
  password_hash: string | null
  avatar_url: string | null
  role: 'owner' | 'team' | 'client'
  is_agency_admin: number
  created_at: number
  last_login: number
}

export interface Session {
  id: string
  user_id: number
  expires_at: number
  created_at: number
}

// ─── Password hashing ───

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex')
  if (hash.length !== attempt.length) return false
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(attempt))
}

// ─── User CRUD ───

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getDb()
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | null
}

export async function getUserById(id: number): Promise<User | null> {
  const db = getDb()
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | null
}

export async function createUser(email: string, name: string, avatarUrl?: string, role?: string, password?: string): Promise<User> {
  const db = getDb()
  const passwordHash = password ? hashPassword(password) : null
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(
    'INSERT INTO users (email, name, avatar_url, role, password_hash, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(email, name, avatarUrl || null, role || 'team', passwordHash, now, now)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User
}

export async function upsertUser(email: string, name: string, avatarUrl?: string): Promise<User> {
  const existing = await getUserByEmail(email)
  if (existing) {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE users SET name = ?, avatar_url = COALESCE(?, avatar_url), last_login = ? WHERE id = ?')
      .run(name, avatarUrl || null, now, existing.id)
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as User
  }
  // Signup is disabled -- only invited users (existing in DB) can log in
  throw new Error('No account found. Contact your workspace admin for an invite.')
}

export async function getUsers(): Promise<User[]> {
  const db = getDb()
  return db.prepare('SELECT id, email, name, avatar_url, role, created_at, last_login FROM users ORDER BY created_at ASC').all() as User[]
}

export async function getUserByName(name: string): Promise<User | null> {
  const db = getDb()
  return db.prepare('SELECT id, email, name, avatar_url, role, created_at, last_login FROM users WHERE LOWER(name) = LOWER(?)').get(name) as User | null
}

// ─── Email/Password Auth ───

export async function signupWithPassword(email: string, name: string, password: string): Promise<User> {
  const existing = await getUserByEmail(email)
  if (existing) throw new Error('Email already registered')
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
  const role = count === 0 ? 'owner' : 'team'
  const user = await createUser(email, name, undefined, role, password)
  // Auto-create private workspace for new user (password signup)
  const { createPrivateWorkspace } = require('./db')
  createPrivateWorkspace(user.id)
  return user
}

export async function loginWithPassword(email: string, password: string): Promise<User> {
  const user = await getUserByEmail(email)
  if (!user) throw new Error('Invalid email or password')
  if (!user.password_hash) throw new Error('This account uses Google sign-in. Please sign in with Google.')
  if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password')
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now, user.id)
  return user
}

// ─── Sessions ───

export async function createSession(userId: number): Promise<string> {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 30 * 86400
  db.prepare('INSERT INTO auth_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(id, userId, expiresAt, now)
  return id
}

export async function getSession(sessionId: string): Promise<(Session & { user: User }) | null> {
  const db = getDb()
  const session = db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(sessionId) as Session | null
  if (!session) return null
  const now = Math.floor(Date.now() / 1000)
  if (session.expires_at < now) {
    db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId)
    return null
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as User | null
  if (!user) return null
  // Cheap presence heartbeat — every authenticated request stamps last_seen_at.
  // Throttle writes to once/60s so we don't hammer SQLite on bursty traffic.
  try {
    const last = (user as { last_seen_at?: number | null }).last_seen_at ?? 0
    if (!last || now - last >= 60) {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, user.id)
    }
  } catch { /* column missing mid-migration */ }
  return { ...session, user }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId)
}

export async function deleteUserSessions(userId: number): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId)
}

// ─── Auth helpers for server components/routes ───

// Internal service token for agent API calls (no cookie needed)
// If env var not set, generate a random secret and persist to a local file
import fs from 'fs'
const SECRET_FILE = path.resolve(process.cwd(), '..', 'store', '.internal-api-secret')
function loadOrCreateSecret(): string {
  if (process.env.INTERNAL_API_SECRET) return process.env.INTERNAL_API_SECRET
  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim()
    if (existing.length >= 32) return existing
  } catch { /* file doesn't exist yet */ }
  const secret = crypto.randomBytes(32).toString('hex')
  try { fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 }) } catch { /* read-only fs fallback */ }
  return secret
}
const INTERNAL_API_SECRET = loadOrCreateSecret()

export function getInternalApiSecret(): string {
  return INTERNAL_API_SECRET
}

export async function getCurrentUser(): Promise<User | null> {
  // Local dev bypass — return user id=1 when BYPASS_AUTH is set
  if (process.env.BYPASS_AUTH === 'true') {
    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE id = 1').get() as User | undefined
    if (user) return user
  }

  // Check for internal service token (used by agent api_request tool)
  try {
    const hdrs = await headers()
    const internalToken = hdrs.get('x-internal-token')
    if (internalToken && internalToken === INTERNAL_API_SECRET) {
      const db = getDb()
      // Support per-user agent scoping via X-User-Id header
      const userIdHeader = hdrs.get('x-user-id')
      const targetUserId = userIdHeader ? parseInt(userIdHeader, 10) : 1
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId) as User | undefined
      if (user) return user
    }

    // Check for Bearer API key (MCP server / service access)
    // Resolves to the first owner account so workspace membership checks pass.
    const authHeader = hdrs.get('authorization') || hdrs.get('Authorization')
    if (authHeader?.startsWith('Bearer ctrlm_')) {
      const apiKey = authHeader.slice(7)
      const validKey = process.env.CTRL_MOTION_API_KEY
      if (validKey && apiKey === validKey) {
        const db = getDb()
        const owner = db.prepare("SELECT * FROM users WHERE role = 'owner' ORDER BY id LIMIT 1").get() as User | undefined
        if (owner) return owner
      }
    }
  } catch { /* headers() may not be available in all contexts */ }

  const cookieStore = await cookies()
  const sessionId = cookieStore.get('session')?.value
  if (!sessionId) return null
  const session = await getSession(sessionId)
  return session?.user || null
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHORIZED')
  return user
}

export async function requireRole(...allowedRoles: Array<'owner' | 'team' | 'client'>): Promise<User> {
  const user = await requireAuth()
  if (!allowedRoles.includes(user.role)) throw new Error('FORBIDDEN')
  return user
}

export async function requireOwner(): Promise<User> {
  return requireRole('owner')
}

// ─── Workspace access helpers ───

import { isWorkspaceMember, getWorkspaceById } from './db'
import type { NextRequest } from 'next/server'

/**
 * Extract workspace ID from request header (X-Workspace-Id).
 * Returns null if not present.
 */
export function getWorkspaceIdFromRequest(request: NextRequest): number | null {
  const raw = request.headers.get('x-workspace-id')
  if (!raw) return null
  const id = parseInt(raw, 10)
  return isNaN(id) ? null : id
}

/**
 * Require the authenticated user to be a member of the given workspace.
 * Throws FORBIDDEN if not a member. Returns the user on success.
 */
export async function requireWorkspaceMember(workspaceId: number): Promise<User> {
  const user = await requireAuth()
  if (!isWorkspaceMember(user.id, workspaceId)) {
    throw new Error('FORBIDDEN')
  }
  return user
}

/**
 * Convenience: get authenticated user + validated workspace ID from request.
 * If X-Workspace-Id header present, validates membership.
 * If absent, returns user's primary/first workspace.
 * Returns { user, workspaceId }.
 */
export async function requireAuthWithWorkspace(request: NextRequest): Promise<{ user: User; workspaceId: number }> {
  const user = await requireAuth()
  const headerWsId = getWorkspaceIdFromRequest(request)

  if (headerWsId) {
    // Validate user has access to this workspace
    if (!isWorkspaceMember(user.id, headerWsId)) {
      throw new Error('FORBIDDEN')
    }
    return { user, workspaceId: headerWsId }
  }

  // Fall back to user's primary workspace or first available
  const { getUserWorkspaces } = require('./db')
  const workspaces = getUserWorkspaces(user.id)
  if (workspaces.length === 0) throw new Error('NO_WORKSPACE')
  // Prefer primary, then first
  const primary = workspaces.find((w: any) => w.is_primary === 1)
  const fallbackId: number = primary ? primary.id : workspaces[0].id
  return { user, workspaceId: fallbackId }
}
