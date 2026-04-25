import { NextRequest, NextResponse } from 'next/server'
import { validateExternalToken, getDb } from './db'

// ─── Rate Limiting ───

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 120 // requests per window per token

function checkRateLimit(tokenPrefix: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(tokenPrefix)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(tokenPrefix, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

// ─── Audit Logging ───

let auditTableReady = false

function ensureAuditTable(): void {
  if (auditTableReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS external_api_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER,
      method TEXT,
      path TEXT,
      scope TEXT,
      status INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `)
  auditTableReady = true
}

export function logExternalAccess(tokenId: number | null, method: string, path: string, scope: string, status: number): void {
  ensureAuditTable()
  getDb().prepare(
    'INSERT INTO external_api_log (token_id, method, path, scope, status) VALUES (?, ?, ?, ?, ?)'
  ).run(tokenId, method, path, scope, status)
}

// ─── Pagination ───

export const MAX_PAGE_SIZE = 200

export function clampLimit(requested: number | undefined, defaultLimit = 50): number {
  const n = requested ?? defaultLimit
  if (n < 1) return 1
  return Math.min(n, MAX_PAGE_SIZE)
}

// ─── Safe resolveId ───

const ALLOWED_TABLES = new Set(['tasks', 'projects', 'workspaces', 'docs', 'meeting_notes'])

export function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  if (!ALLOWED_TABLES.has(table)) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  return row?.id ?? null
}

// ─── Auth ───

export type ExternalAuthResult = {
  authenticated: true
  tokenId: number
} | {
  authenticated: false
  response: NextResponse
}

// Validate Bearer token from Authorization header
export function authenticateRequest(
  req: NextRequest,
  requiredScope: string
): ExternalAuthResult {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    logExternalAccess(null, req.method, req.nextUrl.pathname, requiredScope, 401)
    return {
      authenticated: false,
      response: NextResponse.json(
        { error: 'Missing or invalid Authorization header. Use: Bearer ctrl_...' },
        { status: 401 }
      ),
    }
  }

  const token = authHeader.slice(7)

  // Rate limit using first 16 chars of token as key
  const tokenPrefix = token.slice(0, 16)
  if (!checkRateLimit(tokenPrefix)) {
    logExternalAccess(null, req.method, req.nextUrl.pathname, requiredScope, 429)
    return {
      authenticated: false,
      response: NextResponse.json(
        { error: 'Rate limit exceeded. Max 120 requests per minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      ),
    }
  }

  const tokenId = validateExternalToken(token, requiredScope)
  if (!tokenId) {
    logExternalAccess(null, req.method, req.nextUrl.pathname, requiredScope, 403)
    return {
      authenticated: false,
      response: NextResponse.json(
        { error: 'Invalid token or insufficient permissions' },
        { status: 403 }
      ),
    }
  }

  logExternalAccess(tokenId, req.method, req.nextUrl.pathname, requiredScope, 200)
  return { authenticated: true, tokenId }
}
