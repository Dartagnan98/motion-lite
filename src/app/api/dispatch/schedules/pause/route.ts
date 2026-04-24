import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getSchedulesPauseState, setSchedulesPauseState } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET  /api/dispatch/schedules/pause  → current pause state
 * POST /api/dispatch/schedules/pause  → { paused: boolean, reason?: string }
 *
 * Global kill switch for scheduled dispatch firing. When paused, the
 * /api/cron/tick handler short-circuits and skips claiming due schedules —
 * queued dispatches already in flight keep draining through the bridge.
 * Toggling this is the safe way to stop everything without deleting schedules.
 */
export async function GET() {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ state: getSchedulesPauseState() })
}

export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const paused = body.paused === true
  const reason = typeof body.reason === 'string' ? body.reason : null
  const state = setSchedulesPauseState(paused, {
    reason,
    by: user.email || user.name || 'user',
  })
  return NextResponse.json({ state })
}
