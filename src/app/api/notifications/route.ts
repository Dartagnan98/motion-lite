import { NextRequest, NextResponse } from 'next/server'
import {
  getNotifications,
  getUnreadNotifCount,
  markNotifsRead,
  markAllNotifsRead,
  listUserNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
} from '@/lib/db'
import { requireAuth, requireOwner } from '@/lib/auth'

/**
 * Hybrid notifications endpoint.
 *
 *   Legacy workspace-wide bell (sidebar): no params or `unread_count=1`
 *     GET  /api/notifications?unread_count=1
 *     GET  /api/notifications?limit=10
 *     PATCH /api/notifications  { ids?: number[], all?: true }
 *
 *   New per-user notification center (header bell + settings page):
 *     GET  /api/notifications?unread=true&limit=50
 *     (Use /api/notifications/mark-read, /prefs, /unread-count for writes.)
 *
 * Detection: the new API opts in with `unread=`. When that param is present
 * OR the caller explicitly asks for `scope=user`, we return per-user rows
 * from `user_notifications`. Otherwise we fall back to the legacy table.
 */
export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams
  const newApi = qs.get('scope') === 'user' || qs.has('unread')

  if (newApi) {
    const user = await safeRequireAuth()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const limit = Math.min(Math.max(Number(qs.get('limit')) || 50, 1), 200)
    const onlyUnread = qs.get('unread') === 'true' || qs.get('unread') === '1'
    const notifications = listUserNotifications(user.id, { limit, onlyUnread })
    const unreadCount = getUnreadNotificationCount(user.id)
    return NextResponse.json({ notifications, unreadCount })
  }

  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  // Quick unread count check (legacy workspace bell).
  if (qs.get('unread_count') === '1') {
    const count = getUnreadNotifCount()
    return NextResponse.json({ count })
  }

  const limit = Number(qs.get('limit')) || 30
  const notifications = getNotifications(limit)
  const unreadCount = getUnreadNotifCount()
  return NextResponse.json({ notifications, unreadCount })
}

export async function PATCH(request: NextRequest) {
  // PATCH is only used by the legacy workspace bell today. The new per-user
  // API uses POST /api/notifications/mark-read. Keep behaviour unchanged.
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()

  if (body.all) {
    markAllNotifsRead()
    // Also mark the current user's per-user rows read so the two bells stay
    // in sync when an owner hits "mark all read" in the legacy UI.
    try {
      const user = await safeRequireAuth()
      if (user) markNotificationsRead(user.id, null)
    } catch { /* resilient */ }
    return NextResponse.json({ ok: true })
  }

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    markNotifsRead(body.ids)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Provide { ids: number[] } or { all: true }' }, { status: 400 })
}

async function safeRequireAuth() {
  try {
    return await requireAuth()
  } catch {
    return null
  }
}
