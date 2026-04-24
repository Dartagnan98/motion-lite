import { TERMINAL_STATUSES } from '@/lib/task-constants'

// Fields that should trigger a re-schedule when changed
const SCHEDULING_FIELDS = [
  'priority', 'due_date', 'duration_minutes', 'auto_schedule',
  'is_asap', 'blocked_by', 'status', 'hard_deadline', 'start_date',
  'min_chunk_minutes', 'effort_level', 'assignee', 'schedule_id',
]

export function shouldTriggerReschedule(changedFields: string[]): boolean {
  return changedFields.some(f => SCHEDULING_FIELDS.includes(f))
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export async function triggerReschedule(): Promise<boolean> {
  if (debounceTimer) clearTimeout(debounceTimer)

  return new Promise((resolve) => {
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/schedule/auto', { method: 'POST' })
        resolve(res.ok)
      } catch {
        resolve(false)
      }
    }, 500)
  })
}

// Concurrency guard + debounce for server-side scheduler
let _serverRunning = false
let _serverDebounceTimer: ReturnType<typeof setTimeout> | null = null
let _pendingResolvers: Array<(v: boolean) => void> = []

// Server-side version that calls the scheduler directly.
// Debounced (300ms) and serialized: concurrent calls coalesce into one run.
export function triggerRescheduleServer(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    _pendingResolvers.push(resolve)

    if (_serverDebounceTimer) clearTimeout(_serverDebounceTimer)
    _serverDebounceTimer = setTimeout(() => {
      _serverDebounceTimer = null
      _runSchedulerGuarded()
    }, 300)
  })
}

async function _runSchedulerGuarded(): Promise<void> {
  if (_serverRunning) {
    // Already running -- the in-flight run will resolve all pending callers
    return
  }
  _serverRunning = true
  const resolvers = _pendingResolvers
  _pendingResolvers = []
  const result = await _triggerRescheduleServerImpl()
  _serverRunning = false
  for (const r of resolvers) r(result)
  // If new calls arrived while we were running, kick off another pass
  if (_pendingResolvers.length > 0) {
    const next = _pendingResolvers
    _pendingResolvers = []
    const result2 = await _triggerRescheduleServerImpl()
    for (const r of next) r(result2)
  }
}

async function _triggerRescheduleServerImpl(): Promise<boolean> {
  try {
    const { autoSchedule } = await import('./scheduler')
    const { getSchedules, getTasksForScheduling, getTaskChunksForTaskIds, getUserWorkspaces, getWorkspaceStatuses, getFlexibleHoursRange, clearStaleTaskSchedulingMetadata } = await import('./db')
    const { getSetting, getAllSettings } = await import('./settings')
    const { getConflictEvents } = await import('./google')

    clearStaleTaskSchedulingMetadata()

    const workspaces = getUserWorkspaces(1)
    const workspaceIds = workspaces.map(w => w.id)
    const tasks = getTasksForScheduling(workspaceIds)
    const allChunks = getTaskChunksForTaskIds(tasks.map(t => t.id))
    const schedules = getSchedules()
    const now = new Date()
    // Dynamic horizon: extend to cover the latest task start_date/due_date + 14 days
    let latestMs = now.getTime() + 30 * 24 * 60 * 60 * 1000
    for (const t of tasks) {
      if ((t as any).start_date) {
        const sd = new Date((t as any).start_date + 'T00:00:00').getTime() + 14 * 86400000
        if (sd > latestMs) latestMs = sd
      }
      if ((t as any).due_date) {
        const dd = new Date((t as any).due_date + 'T00:00:00').getTime() + 14 * 86400000
        if (dd > latestMs) latestMs = dd
      }
    }
    const horizon = {
      start: now,
      end: new Date(latestMs),
    }

    // Load Google Calendar events (the critical missing piece)
    let events: { id: string; start_time: string; end_time: string; all_day: number; busy_status?: string | null; travel_time_before?: number; travel_time_after?: number }[] = []
    try {
      const calEvents = getConflictEvents(horizon.start.toISOString(), horizon.end.toISOString())
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
    } catch (err) {
      console.error('[Scheduler] Failed to load calendar events:', err)
    }

    // Partially-locked tasks are handled SEPARATELY after the main scheduler runs.
    // They must NOT enter the main scheduler — doing so causes full rearrangement of other tasks.
    const partiallyLockedMap = new Map<number, { task: typeof tasks[0]; lockedStart: string; lockedEnd: string; remaining: number }>()
    for (const t of tasks) {
      if (!t.auto_schedule || TERMINAL_STATUSES.includes(t.status) || !(t as any).assignee) continue
      if (!t.locked_at || !t.scheduled_start || !t.scheduled_end) continue
      const lockedMs = new Date(t.scheduled_end).getTime() - new Date(t.scheduled_start).getTime()
      const lockedMinutes = Math.round(lockedMs / 60000)
      const remaining = (t.duration_minutes || 0) - lockedMinutes
      if (remaining > 1) {
        partiallyLockedMap.set(t.id, { task: t, lockedStart: t.scheduled_start, lockedEnd: t.scheduled_end, remaining })
        console.log(`[Scheduler] Partially-locked #${t.id} "${t.title}": ${lockedMinutes}min locked, ${remaining}min overflow to place separately`)
      }
    }

    // Main scheduler: exclude partially-locked tasks entirely
    const schedulerTasks = tasks
      .filter(t => t.auto_schedule && !TERMINAL_STATUSES.includes(t.status) && !!(t as any).assignee && !partiallyLockedMap.has(t.id))
      .map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        duration_minutes: t.duration_minutes,
        due_date: t.due_date,
        start_date: t.start_date,
        hard_deadline: t.hard_deadline,
        scheduled_start: t.scheduled_start,
        scheduled_end: t.scheduled_end,
        auto_schedule: t.auto_schedule,
        status: t.status,
        overdue_from: t.overdue_from,
        is_asap: t.is_asap,
        min_chunk_minutes: t.min_chunk_minutes,
        blocked_by: t.blocked_by,
        schedule_id: t.schedule_id,
        locked_at: t.locked_at,
        completed_time_minutes: t.completed_time_minutes,
        effort_level: t.effort_level,
        project_start_date: t.project_start_date || null,
        project_due_date: t.project_due_date || null,
        project_id: t.project_id,
        labels: t.labels,
        existing_chunks: (allChunks[t.id] || []).map(chunk => ({
          start: chunk.chunk_start,
          end: chunk.chunk_end,
        })),
      }))

    const schedulerSchedules = schedules.map(s => ({
      id: s.id,
      blocks: JSON.parse(s.blocks || '[]'),
    }))

    // Load settings
    const allSettings = getAllSettings()

    // Collect statuses with auto-scheduling disabled
    const disabledStatuses = new Set<string>()
    for (const ws of workspaces) {
      const statuses = getWorkspaceStatuses(ws.id)
      for (const s of statuses) {
        if ((s as any).auto_schedule_disabled) {
          disabledStatuses.add(s.name.toLowerCase().replace(/\s+/g, '_'))
        }
      }
    }

    // Load flexible hours (timezone-aware, matching schedule/auto/route.ts)
    const tz = (allSettings.timezone as string) || 'America/Los_Angeles'
    const tzFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    const startDateStr = tzFmt.format(horizon.start)
    const endDateStr = tzFmt.format(horizon.end)
    const rawFlexHours = getFlexibleHoursRange(startDateStr, endDateStr)
    const flexibleHours = rawFlexHours.map(fh => ({
      date: fh.date,
      blocks: JSON.parse(fh.blocks) as { day: number; start: string; end: string }[],
    }))

    console.log(`[Scheduler] Running with ${schedulerTasks.length} tasks, ${events.length} events, ${schedulerSchedules.length} schedules, horizon: ${horizon.start.toISOString()} - ${horizon.end.toISOString()}`)
    if (schedulerSchedules.length > 0) {
      console.log(`[Scheduler] Schedule blocks:`, JSON.stringify(schedulerSchedules[0].blocks?.slice(0, 3)))
    }
    const result = autoSchedule({
      tasks: schedulerTasks,
      events,
      schedules: schedulerSchedules,
      settings: {
        breakMinutes: allSettings.breakEnabled === false ? 0 : (Number(allSettings.breakMinutes) || 15),
        breakEveryMinutes: allSettings.breakEveryHours ? Number(allSettings.breakEveryHours) * 60 : (Number(allSettings.breakEveryMinutes) || 180),
        minChunkDuration: Number(allSettings.minChunkDuration) || 15,
        timezone: (getSetting<string>('timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone),
        meetingBufferBefore: Number(allSettings.meetingBufferBefore) || 0,
        meetingBufferAfter: Number(allSettings.meetingBufferAfter) || 0,
        maxChunkDuration: Number(allSettings.maxChunkDuration) || 90,
        taskBufferMinutes: Number(allSettings.taskBufferMinutes) || 5,
        dailyCapPercent: Number(allSettings.dailyCapPercent) || 85,
        deadlineUrgencyEnabled: (allSettings.deadlineUrgencyEnabled as boolean) ?? true,
        deadlineUrgencyDays: Number(allSettings.deadlineUrgencyDays) || 3,
        batchSimilarTasks: (allSettings.batchSimilarTasks as boolean) ?? true,
        deepWorkCapEnabled: (allSettings.deepWorkCapEnabled as boolean) ?? true,
        deepWorkCapMinutes: Number(allSettings.deepWorkCapMinutes) || 240,
        noDeepWorkAfterMeetings: (allSettings.noDeepWorkAfterMeetings as boolean) ?? true,
        deepWorkMeetingBufferMinutes: Number(allSettings.deepWorkMeetingBufferMinutes) || 30,
        eatTheFrogEnabled: (allSettings.eatTheFrogEnabled as boolean) ?? true,
      },
      horizon,
      mode: 'full',
      now,
      disabledStatuses,
      flexibleHours,
    })
    console.log(`[Scheduler] Result: ${result.placements.length} placed, ${result.unplaceable.length} unplaceable`)
    if (result.unplaceable.length > 0) {
      console.log(`[Scheduler] Unplaceable:`, result.unplaceable.map(u => `${u.taskId}: ${u.reason}`).join(', '))
    }

    // Apply main scheduler placements
    const { getDb, updateTask, clearTaskChunks, insertTaskChunk } = await import('./db')
    const db = getDb()
    db.prepare('BEGIN IMMEDIATE').run()
    try {
      for (const p of result.placements) {
        updateTask(p.taskId, {
          scheduled_start: p.scheduledStart,
          scheduled_end: p.scheduledEnd,
          overdue_from: p.overdueFrom || null,
        })
        const taskRow = db.prepare('SELECT locked_at FROM tasks WHERE id = ?').get(p.taskId) as { locked_at: string | null } | undefined
        if (!taskRow?.locked_at) {
          clearTaskChunks(p.taskId)
          if (p.chunks) {
            for (const c of p.chunks) {
              insertTaskChunk(p.taskId, c.start, c.end)
            }
          }
        }
      }
      for (const u of result.unplaceable) {
        const taskRow = db.prepare('SELECT locked_at FROM tasks WHERE id = ?').get(u.taskId) as { locked_at: string | null } | undefined
        if (!taskRow?.locked_at) {
          updateTask(u.taskId, { scheduled_start: null, scheduled_end: null })
          clearTaskChunks(u.taskId)
        }
      }
      db.prepare('COMMIT').run()
    } catch (e) {
      db.prepare('ROLLBACK').run()
      throw e
    }

    // Targeted overflow placement for partially-locked tasks.
    // Runs AFTER the main scheduler so it only fills genuinely free slots
    // without rearranging anything else.
    if (partiallyLockedMap.size > 0) {
      // Build busy intervals: calendar events + all currently scheduled tasks
      const freshTasks = getTasksForScheduling(workspaceIds)
      const busyIntervals: { start: number; end: number }[] = []
      const taskEndTimes = new Map<number, number>()
      for (const e of events) {
        if (e.busy_status === 'free' || e.all_day) continue
        busyIntervals.push({ start: new Date(e.start_time).getTime(), end: new Date(e.end_time).getTime() })
      }
      for (const t of freshTasks) {
        if (!t.scheduled_start || !t.scheduled_end) continue
        taskEndTimes.set(t.id, new Date(t.scheduled_end).getTime())
        busyIntervals.push({ start: new Date(t.scheduled_start).getTime(), end: new Date(t.scheduled_end).getTime() })
      }
      busyIntervals.sort((a, b) => a.start - b.start)

      // Get work schedule blocks to know which hours are work time
      const defaultSchedule = schedulerSchedules[0]
      const workBlocks: { day: number; startH: number; startM: number; endH: number; endM: number }[] = []
      if (defaultSchedule) {
        for (const b of defaultSchedule.blocks) {
          const [sh, sm] = b.start.split(':').map(Number)
          const [eh, em] = b.end.split(':').map(Number)
          workBlocks.push({ day: b.day, startH: sh, startM: sm, endH: eh, endM: em })
        }
      }

      const tz = (getAllSettings().timezone as string) || 'America/Los_Angeles'

      function isWorkTime(ms: number): boolean {
        if (workBlocks.length === 0) return true
        const d = new Date(ms)
        const dayOfWeek = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
        const dayNum = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(dayOfWeek)
        const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
        const [h, m] = timeStr.split(':').map(Number)
        const minOfDay = h * 60 + m
        return workBlocks.some(b => b.day === dayNum && minOfDay >= b.startH * 60 + b.startM && minOfDay < b.endH * 60 + b.endM)
      }

      function isFreeSlot(startMs: number, endMs: number): boolean {
        return !busyIntervals.some(b => b.start < endMs && b.end > startMs)
      }

      function dateInTimezone(date: Date, hours: number, minutes: number, timezone: string): Date {
        const year = date.getUTCFullYear()
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        const day = String(date.getUTCDate()).padStart(2, '0')
        const h = String(hours).padStart(2, '0')
        const m = String(minutes).padStart(2, '0')
        const guessUtc = new Date(`${year}-${month}-${day}T${h}:${m}:00Z`)
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        })
        const parts = formatter.formatToParts(guessUtc)
        const getPart = (type: string) => Number(parts.find(p => p.type === type)?.value || 0)
        const localYear = getPart('year')
        const localMonth = getPart('month')
        const localDay = getPart('day')
        const localH = getPart('hour')
        const localM = getPart('minute')

        const desiredMs = Date.UTC(year, parseInt(month, 10) - 1, parseInt(day, 10), hours, minutes)
        const actualLocalMs = Date.UTC(localYear, localMonth - 1, localDay, localH, localM)
        return new Date(guessUtc.getTime() + (desiredMs - actualLocalMs))
      }

      function getBoundaryTime(dateStr: string, endOfDay = false): number {
        const [year, month, day] = dateStr.split('-').map(Number)
        const utcDate = new Date(Date.UTC(year, month - 1, day))
        const boundary = endOfDay
          ? dateInTimezone(utcDate, 23, 59, tz).getTime() + 59999
          : dateInTimezone(utcDate, 0, 0, tz).getTime()
        return boundary
      }

      function parseBlockedBy(blockedBy: string | null | undefined): number[] {
        if (!blockedBy) return []
        try {
          const parsed = JSON.parse(blockedBy)
          return Array.isArray(parsed) ? parsed.map(Number).filter(n => !Number.isNaN(n) && n > 0) : []
        } catch {
          return blockedBy.split(',').map(v => Number(v.trim())).filter(n => !Number.isNaN(n) && n > 0)
        }
      }

      for (const [taskId, { task, lockedStart, lockedEnd, remaining }] of partiallyLockedMap) {
        if (remaining <= 0) {
          console.log(`[Scheduler] Skipping overflow placement for #${taskId}: no remaining time after locked chunk`)
          continue
        }
        const minChunkMs = remaining * 60000
        if (minChunkMs <= 0) continue
        const blockerEnd = parseBlockedBy(task.blocked_by)
          .reduce((latest, blockerId) => Math.max(latest, taskEndTimes.get(blockerId) || 0), 0)
        const explicitStart = task.start_date ? getBoundaryTime(task.start_date) : 0
        const projectStart = task.project_start_date ? getBoundaryTime(task.project_start_date) : 0
        const hardDeadlineEnd = task.hard_deadline && task.due_date ? getBoundaryTime(task.due_date, true) : null
        const projectDeadlineEnd = task.project_due_date ? getBoundaryTime(task.project_due_date, true) : null
        const deadlineEnd = hardDeadlineEnd === null
          ? projectDeadlineEnd
          : (projectDeadlineEnd === null ? hardDeadlineEnd : Math.min(hardDeadlineEnd, projectDeadlineEnd))
        const searchStart = Math.max(
          new Date(lockedEnd).getTime(),
          now.getTime(),
          explicitStart,
          projectStart,
          blockerEnd
        )
        const searchEnd = Math.min(horizon.end.getTime(), deadlineEnd ?? horizon.end.getTime())

        if (searchStart + minChunkMs > searchEnd) {
          console.log(`[Scheduler] Could not place overflow chunk for #${taskId}: no room before constraints/deadline`)
          continue
        }

        let cursor = searchStart
        let placed = false
        while (cursor < searchEnd) {
          const slotEnd = cursor + minChunkMs
          if (slotEnd > searchEnd) break
          // Check that the entire slot is in work hours and free
          if (isWorkTime(cursor) && isWorkTime(slotEnd - 60000) && isFreeSlot(cursor, slotEnd)) {
            const chunkStart = new Date(cursor).toISOString()
            const chunkEnd = new Date(slotEnd).toISOString()
            db.prepare('DELETE FROM task_chunks WHERE task_id = ? AND locked = 0').run(taskId)
            const existingLocked = db.prepare('SELECT id FROM task_chunks WHERE task_id = ? AND locked = 1').get(taskId) as { id: number } | undefined
            if (!existingLocked) {
              db.prepare('INSERT INTO task_chunks (task_id, chunk_start, chunk_end, locked) VALUES (?, ?, ?, 1)').run(taskId, lockedStart, lockedEnd)
            }
            insertTaskChunk(taskId, chunkStart, chunkEnd)
            updateTask(taskId, {
              scheduled_start: lockedStart,
              scheduled_end: chunkEnd,
              overdue_from: null,
            })
            taskEndTimes.set(taskId, new Date(chunkEnd).getTime())
            // Mark slot as busy for subsequent tasks
            busyIntervals.push({ start: cursor, end: slotEnd })
            busyIntervals.sort((a, b) => a.start - b.start)
            console.log(`[Scheduler] Overflow chunk for #${taskId}: ${chunkStart} → ${chunkEnd}`)
            placed = true
            break
          }
          cursor += 5 * 60000 // step 5 min
        }
        if (!placed) {
          console.log(`[Scheduler] Could not find free slot for overflow chunk of #${taskId} (${remaining}min needed)`)
        }
      }
    }

    // Fire schedule.rearranged notification
    if (result.placements.length > 0) {
      const { createNotification } = await import('./notifications')
      const count = result.placements.length
      createNotification(
        'schedule.rearranged',
        'Schedule rearranged',
        `${count} task${count > 1 ? 's' : ''} rescheduled by auto-scheduler`,
        result.placements[0].taskId
      )
    }

    return true
  } catch (err) {
    console.error('[Scheduler] triggerRescheduleServer failed:', err)
    return false
  }
}
