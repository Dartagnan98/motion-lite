import { NextRequest, NextResponse } from 'next/server'
import { updateCalendarVisibility, updateCalendarBusyStatus, updateCalendarConflicts } from '@/lib/google'
import { requireAuth } from '@/lib/auth'
import { triggerRescheduleServer } from '@/lib/schedule-trigger'

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { calendarId, visible, default_busy_status, use_for_conflicts } = await req.json()
  if (!calendarId) return NextResponse.json({ error: 'Missing calendarId' }, { status: 400 })
  let schedulingChanged = false
  if (visible !== undefined) {
    updateCalendarVisibility(calendarId, visible)
    schedulingChanged = true
  }
  if (default_busy_status !== undefined) {
    updateCalendarBusyStatus(calendarId, default_busy_status)
    schedulingChanged = true
  }
  if (use_for_conflicts !== undefined) {
    updateCalendarConflicts(calendarId, use_for_conflicts)
    schedulingChanged = true
  }
  if (schedulingChanged) {
    triggerRescheduleServer().catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
