import { NextRequest, NextResponse } from 'next/server'
import { getUnreadNotificationCount } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

/**
 * GET /api/notifications/unread-count
 * Small endpoint for the bell badge's 30-second poll.
 */
export async function GET(_request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const count = getUnreadNotificationCount(user.id)
  return NextResponse.json({ count })
}
