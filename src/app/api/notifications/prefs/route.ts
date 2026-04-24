import { NextRequest, NextResponse } from 'next/server'
import {
  getUserNotificationPrefs,
  updateUserNotificationPref,
  USER_NOTIFICATION_KINDS,
  type UserNotificationKind,
} from '@/lib/db'
import { requireAuth } from '@/lib/auth'

function isKind(value: unknown): value is UserNotificationKind {
  return typeof value === 'string'
    && (USER_NOTIFICATION_KINDS as readonly string[]).includes(value)
}

/**
 * GET /api/notifications/prefs
 * Returns the full per-kind preference map, filling unseeded kinds with
 * defaults.
 */
export async function GET(_request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const prefs = getUserNotificationPrefs(user.id)
  return NextResponse.json({ prefs })
}

/**
 * PATCH /api/notifications/prefs
 *   Body: { kind, in_app?, email?, push? }
 */
export async function PATCH(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  let body: Record<string, unknown> = {}
  try { body = await request.json() as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
  }
  if (!isKind(body.kind)) {
    return NextResponse.json({ error: 'kind is required and must be a known notification kind' }, { status: 400 })
  }
  const patch: { in_app?: boolean; email?: boolean; push?: boolean } = {}
  if (body.in_app !== undefined) patch.in_app = Boolean(body.in_app)
  if (body.email !== undefined) patch.email = Boolean(body.email)
  if (body.push !== undefined) patch.push = Boolean(body.push)

  const next = updateUserNotificationPref(user.id, body.kind, patch)
  return NextResponse.json({ ok: true, kind: body.kind, pref: next })
}
