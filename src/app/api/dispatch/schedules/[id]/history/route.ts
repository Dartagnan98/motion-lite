import { NextRequest, NextResponse } from 'next/server'
import { getScheduledDispatch, listScheduleHistory } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/dispatch/schedules/[id]/history?limit=
 *
 * Recent fires for a single schedule. Drives the "History" expander on each
 * SchedulesPanel row -- we key off dispatch_queue.source_schedule_id rather
 * than task_activities, so inline-context schedules (no task_id) still show.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: idStr } = await params
  const id = Number(idStr)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const existing = getScheduledDispatch(id)
  if (!existing) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const limitRaw = searchParams.get('limit')
  const limit = limitRaw && Number.isFinite(Number(limitRaw))
    ? Math.min(Math.max(Number(limitRaw), 1), 100)
    : 25

  const history = listScheduleHistory(id, limit)
  return NextResponse.json({ history })
}
