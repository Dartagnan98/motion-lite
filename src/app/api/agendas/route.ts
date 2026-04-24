import { NextRequest, NextResponse } from 'next/server'
import { saveAgendaSnapshot, getAgendaSnapshot, getAgendaSnapshotDates, getAllTasksEnriched, getUserWorkspaces } from '@/lib/db'
import { getCurrentUser, getWorkspaceIdFromRequest } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = req.nextUrl
  const date = searchParams.get('date')

  if (date) {
    const row = getAgendaSnapshot(date)
    return NextResponse.json(row || null)
  }

  // Return list of dates that have snapshots
  const dates = getAgendaSnapshotDates()
  return NextResponse.json({ dates })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Auto-fetch current tasks and save as today's snapshot
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10)

  const headerWsId = getWorkspaceIdFromRequest(req)
  const wsFilter = headerWsId || getUserWorkspaces(user.id).map(w => w.id)
  const allTasks = getAllTasksEnriched(wsFilter)

  // Build snapshot: tasks with their status/completion info for today
  const snapshotData = allTasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_date: t.due_date,
    scheduled_start: t.scheduled_start,
    duration_minutes: t.duration_minutes,
    completed_at: t.completed_at,
    workspace_name: t.workspace_name,
    project_name: t.project_name,
    project_color: t.project_color,
    stage_name: t.stage_name,
  }))

  saveAgendaSnapshot(dateStr, JSON.stringify(snapshotData))

  return NextResponse.json({ ok: true, date: dateStr, task_count: snapshotData.length })
}
