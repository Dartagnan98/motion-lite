// POST /api/platform/nps
//
// Stores a PM NPS response. One per user per calendar month.
// Body: { score: number (0-10), comment?: string }
// Response: { ok: true }
//
// Duplicate guard: if a row already exists for this user in the current
// calendar month, the insert is skipped and { ok: true, alreadySubmitted: true }
// is returned (idempotent).

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace } from '@/lib/platform/tenant'
import { getDb, generatePublicId } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  let body: { score?: unknown; comment?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const score = typeof body.score === 'number' ? body.score : null
  if (score === null || !Number.isInteger(score) || score < 0 || score > 10) {
    return NextResponse.json({ error: 'score must be an integer between 0 and 10' }, { status: 400 })
  }

  const comment =
    typeof body.comment === 'string' && body.comment.trim().length > 0
      ? body.comment.trim().slice(0, 2000)
      : null

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const tenant = ensureTenantForWorkspace(workspaceId)

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  // Duplicate guard: first epoch second of the current calendar month (UTC).
  // Date.UTC produces an actual UTC epoch; `new Date(year, month, 1)` would
  // treat args as local time and shift by up to 24h on non-UTC servers.
  // Must match the same computation in /platform/dashboard/page.tsx.
  const d = new Date()
  const firstOfMonthEpoch = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000)

  const existing = db.prepare(
    `SELECT id FROM platform_nps_responses
      WHERE user_id = ? AND created_at >= ?`
  ).get(user.id, firstOfMonthEpoch) as { id: number } | undefined

  if (existing) {
    return NextResponse.json({ ok: true, alreadySubmitted: true })
  }

  db.prepare(
    `INSERT INTO platform_nps_responses (tenant_id, public_id, user_id, score, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(tenant.id, generatePublicId(), user.id, score, comment, now)

  return NextResponse.json({ ok: true })
}
