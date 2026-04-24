import { NextRequest, NextResponse } from 'next/server'
import { getDb, getSchedules, updateTask, clearTaskChunks, insertTaskChunk, getWorkspaceStatuses, getUserWorkspaces, autoArchiveStale, getFlexibleHoursRange, clearStaleTaskSchedulingMetadata, getTaskChunksForTaskIds, getTasksForScheduling, getUnassignedAutoScheduleTasks } from '@/lib/db'
import { getConflictEvents } from '@/lib/google'
import { getAllSettings } from '@/lib/settings'
import { autoSchedule } from '@/lib/scheduler'
import { createNotification } from '@/lib/notifications'
import type { SchedulerTask, SchedulerEvent, ScheduleBlock } from '@/lib/scheduler'
import { getCurrentUser } from '@/lib/auth'
import { classifyUnclassifiedTasks } from '@/lib/effort-classifier'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  autoArchiveStale() // Auto-archive dormant tasks
  clearStaleTaskSchedulingMetadata()
  // AI effort classification before scheduling (non-blocking if it fails)
  try { await classifyUnclassifiedTasks() } catch (e) { console.error('[Scheduler] Effort classification failed:', e) }
  const result = runScheduler('full', user.id, true)
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const mode = body.mode || 'full'
  const dryRun = body.dry_run
  // _background=true preserves recently-placed tasks (used by periodic repack polls)
  const backgroundPoll = body._background === true
  clearStaleTaskSchedulingMetadata()
  // AI effort classification before scheduling
  try { await classifyUnclassifiedTasks() } catch (e) { console.error('[Scheduler] Effort classification failed:', e) }
  const result = runScheduler(mode, user.id, backgroundPoll)

  if (!dryRun) {
    const db = getDb()
    db.prepare('BEGIN IMMEDIATE').run()
    try {
      for (const p of result.placements) {
        updateTask(p.taskId, {
          scheduled_start: p.scheduledStart,
          scheduled_end: p.scheduledEnd,
          ...(p.overdueFrom ? { overdue_from: p.overdueFrom } : {}),
          ...(p.priority ? { priority: p.priority } : {}),
        })

        // Persist chunks.
        // Chunk-level locks only mean "keep this specific chunk" — they must not prevent
        // a full reschedule of a task that has no task-level lock (locked_at IS NULL).
        // Task-level locked_at is the true "don't move me" signal.
        const task = db.prepare('SELECT locked_at FROM tasks WHERE id = ?').get(p.taskId) as { locked_at: string | null } | undefined
        const taskIsLocked = !!task?.locked_at
        if (!taskIsLocked) {
          clearTaskChunks(p.taskId)
          for (const chunk of p.chunks) {
            insertTaskChunk(p.taskId, chunk.start, chunk.end)
          }
        }
      }

      // Clear schedule for unplaceable tasks (so stale dates don't persist)
      for (const u of result.unplaceable) {
        const task = db.prepare('SELECT locked_at FROM tasks WHERE id = ?').get(u.taskId) as { locked_at: string | null } | undefined
        if (!task?.locked_at) {
          updateTask(u.taskId, { scheduled_start: null, scheduled_end: null })
          clearTaskChunks(u.taskId)
        }
      }

      db.prepare('COMMIT').run()
    } catch (e) {
      db.prepare('ROLLBACK').run()
      throw e
    }

    // Fire a single schedule.rearranged notification if tasks were moved
    if (result.placements.length > 0) {
      const count = result.placements.length
      const firstTaskId = result.placements[0].taskId
      createNotification(
        'schedule.rearranged',
        'Schedule rearranged',
        `${count} task${count > 1 ? 's' : ''} rescheduled by auto-scheduler`,
        firstTaskId
      )
    }
  }

  return NextResponse.json(result)
}

function runScheduler(mode: 'full' | 'overdue_only', userId: number, backgroundPoll = false) {
  const settings = getAllSettings()
  const workspaces = getUserWorkspaces(userId)
  const workspaceIds = workspaces.map(ws => ws.id)
  const allTasks = getTasksForScheduling(workspaceIds) as (SchedulerTask & {
    parent_task_id?: number | null
    assignee?: string | null
    project_start_date?: string | null
    project_due_date?: string | null
    project_id?: number | null
    labels?: string | null
    locked_at?: string | null
    completed_time_minutes?: number
    effort_level?: string | null
  })[]
  const allTaskChunks = getTaskChunksForTaskIds(allTasks.map(task => task.id))
  for (const task of allTasks) {
    task.existing_chunks = (allTaskChunks[task.id] || []).map(chunk => ({
      start: chunk.chunk_start,
      end: chunk.chunk_end,
    }))
  }
  // Filter out subtasks and unassigned auto-schedule tasks (unassigned tasks can't be scheduled)
  const unassignedAutoTasks = getUnassignedAutoScheduleTasks(workspaceIds)
  const tasks = allTasks.filter(t => !t.parent_task_id && (t.auto_schedule !== 1 || !!t.assignee))
  const schedules = getSchedules()

  const now = new Date()
  const horizonStart = now
  // Dynamic horizon: extend to cover the latest task start_date/due_date + 14 days buffer
  let latestDate = now.getTime() + 30 * 86400000
  for (const t of tasks) {
    if (t.start_date) {
      const sd = new Date(t.start_date + 'T00:00:00').getTime() + 14 * 86400000
      if (sd > latestDate) latestDate = sd
    }
    if (t.due_date) {
      const dd = new Date(t.due_date + 'T00:00:00').getTime() + 14 * 86400000
      if (dd > latestDate) latestDate = dd
    }
  }
  const horizonEnd = new Date(latestDate)

  let events: SchedulerEvent[] = []
  try {
    const calEvents = getConflictEvents(horizonStart.toISOString(), horizonEnd.toISOString())
    events = calEvents.map(e => ({
      id: e.id,
      start_time: e.start_time,
      end_time: e.end_time,
      all_day: e.all_day,
      busy_status: e.busy_status,
      travel_time_before: (e as any).travel_time_before || 0,
      travel_time_after: (e as any).travel_time_after || 0,
    }))
    console.log(`[Scheduler] Loaded ${calEvents.length} calendar events, ${events.filter(e => e.busy_status !== 'free' && e.busy_status !== 'tentative' && !e.all_day).length} blocking`)
    // Log first few blocking events for debugging
    const blocking = events.filter(e => e.busy_status !== 'free' && e.busy_status !== 'tentative' && !e.all_day)
    if (blocking.length > 0) {
      console.log(`[Scheduler] First 3 blocking events:`, blocking.slice(0, 3).map(e => `${e.start_time} - ${e.end_time} (busy_status=${e.busy_status}, all_day=${e.all_day})`))
    }
  } catch (err) {
    console.error('[Scheduler] Failed to load calendar events:', err)
  }

  const parsedSchedules = schedules.map(s => ({
    id: s.id,
    blocks: JSON.parse(s.blocks) as ScheduleBlock[],
  }))

  // Collect statuses with auto-scheduling disabled across all workspaces
  const disabledStatuses = new Set<string>()
  for (const ws of workspaces) {
    const statuses = getWorkspaceStatuses(ws.id)
    for (const s of statuses) {
      if ((s as any).auto_schedule_disabled) {
        disabledStatuses.add(s.name.toLowerCase().replace(/\s+/g, '_'))
      }
    }
  }

  // Load flexible hours overrides within the scheduling horizon (timezone-aware)
  const tz = (settings.timezone as string) || 'America/Los_Angeles'
  const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  const startDateStr = tzFmt.format(horizonStart)
  const endDateStr = tzFmt.format(horizonEnd)
  const rawFlexHours = getFlexibleHoursRange(startDateStr, endDateStr)
  const flexibleHours = rawFlexHours.map(fh => ({
    date: fh.date,
    blocks: JSON.parse(fh.blocks) as ScheduleBlock[],
  }))

  const result = autoSchedule({
    tasks,
    events,
    schedules: parsedSchedules,
    settings: {
      breakMinutes: settings.breakEnabled === false ? 0 : ((settings.breakMinutes as number) || 15),
      breakEveryMinutes: settings.breakEveryHours ? (settings.breakEveryHours as number) * 60 : ((settings.breakEveryMinutes as number) || 180),
      minChunkDuration: (settings.minChunkDuration as number) || 15,
      timezone: (settings.timezone as string) || 'America/Los_Angeles',
      meetingBufferBefore: (settings.meetingBufferBefore as number) || 0,
      meetingBufferAfter: (settings.meetingBufferAfter as number) || 0,
      maxChunkDuration: (settings.maxChunkDuration as number) ?? 90,
      taskBufferMinutes: (settings.taskBufferMinutes as number) ?? 5,
      dailyCapPercent: (settings.dailyCapPercent as number) ?? 85,
      deadlineUrgencyEnabled: (settings.deadlineUrgencyEnabled as boolean) ?? true,
      deadlineUrgencyDays: (settings.deadlineUrgencyDays as number) ?? 3,
      batchSimilarTasks: (settings.batchSimilarTasks as boolean) ?? true,
      deepWorkCapEnabled: (settings.deepWorkCapEnabled as boolean) ?? true,
      deepWorkCapMinutes: (settings.deepWorkCapMinutes as number) ?? 240,
      noDeepWorkAfterMeetings: (settings.noDeepWorkAfterMeetings as boolean) ?? true,
      deepWorkMeetingBufferMinutes: (settings.deepWorkMeetingBufferMinutes as number) ?? 30,
      eatTheFrogEnabled: (settings.eatTheFrogEnabled as boolean) ?? true,
    },
    horizon: { start: horizonStart, end: horizonEnd },
    mode,
    now,
    disabledStatuses,
    flexibleHours,
    _backgroundPoll: backgroundPoll,
  })

  // Add unassigned auto-schedule tasks to unplaceable list
  for (const t of unassignedAutoTasks) {
    result.unplaceable.push({ taskId: t.id, reason: 'Unassigned — assign someone to auto-schedule' })
  }

  return result
}
