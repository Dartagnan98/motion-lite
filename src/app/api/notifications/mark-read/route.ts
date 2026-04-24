import { NextRequest, NextResponse } from 'next/server'
import { markNotificationsRead } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/notifications/mark-read
 *   Body: { ids?: number[] }   — omit ids (or pass empty) to mark ALL of the
 *                                 current user's unread notifications as read.
 */
export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  let body: { ids?: unknown } = {}
  try { body = await request.json() as { ids?: unknown } } catch { /* empty body ok */ }

  let ids: number[] | null = null
  if (Array.isArray(body.ids)) {
    ids = body.ids
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0)
  }

  const changes = markNotificationsRead(user.id, ids)
  return NextResponse.json({ ok: true, marked: changes })
}
