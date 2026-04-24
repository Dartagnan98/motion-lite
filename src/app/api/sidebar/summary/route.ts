import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, getWorkspaceIdFromRequest } from '@/lib/auth'
import { getFavoriteTasks, getNextScheduledTask, getPastDueTaskCount, getUserWorkspaces, isWorkspaceMember } from '@/lib/db'
import { getCalendarEvents } from '@/lib/google'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const headerWsId = getWorkspaceIdFromRequest(request)
  if (headerWsId && !isWorkspaceMember(user.id, headerWsId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const wsFilter = headerWsId || getUserWorkspaces(user.id).map(w => w.id)

  const now = new Date()
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  const favoriteTasks = getFavoriteTasks(wsFilter).map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
  }))
  const pastDueCount = getPastDueTaskCount(wsFilter)
  const nextTask = getNextScheduledTask(wsFilter)
  const nextEvent = getCalendarEvents(now.toISOString(), endOfDay.toISOString())
    .filter(event => new Date(event.start_time).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0]

  const upNextTask = nextTask?.scheduled_start
    ? {
        type: 'task' as const,
        id: nextTask.id,
        title: nextTask.title,
        time: nextTask.scheduled_start,
        duration: nextTask.duration_minutes || undefined,
      }
    : null

  const upNextEvent = nextEvent
    ? {
        type: 'event' as const,
        id: nextEvent.id,
        title: nextEvent.title || 'Meeting',
        time: nextEvent.start_time,
        duration: Math.max(
          0,
          Math.round((new Date(nextEvent.end_time).getTime() - new Date(nextEvent.start_time).getTime()) / 60000),
        ) || undefined,
      }
    : null

  let upNext: typeof upNextTask | typeof upNextEvent = null
  if (!upNextTask) upNext = upNextEvent
  else if (!upNextEvent) upNext = upNextTask
  else upNext = new Date(upNextTask.time) <= new Date(upNextEvent.time) ? upNextTask : upNextEvent

  return NextResponse.json({
    favoriteTasks,
    pastDueCount,
    upNext,
  })
}
