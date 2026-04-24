// ─── Auto-Scheduling Engine ───
// Phase 1 rewrite: dependency-aware priority sort, completed_time subtraction,
// max chunk enforcement, task buffer, daily capacity cap, break reset between tasks
import { TERMINAL_STATUSES } from '@/lib/task-constants'

export interface SchedulerTask {
  id: number
  title: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  duration_minutes: number
  due_date: string | null
  start_date: string | null
  hard_deadline: number
  scheduled_start: string | null
  scheduled_end: string | null
  auto_schedule: number
  status: string
  overdue_from?: string | null
  is_asap: number
  min_chunk_minutes: number
  blocked_by?: string | null
  schedule_id?: number | null
  locked_at?: string | null
  completed_time_minutes?: number
  effort_level?: string | null
  project_start_date?: string | null
  project_due_date?: string | null
  project_id?: number | null
  labels?: string | null
  existing_chunks?: PlacementChunk[]
}

export interface SchedulerEvent {
  id: string
  start_time: string
  end_time: string
  all_day: number
  busy_status?: string | null
  travel_time_before?: number
  travel_time_after?: number
}

export interface ScheduleBlock {
  day: number // 0=Sun through 6=Sat
  start: string // "09:00"
  end: string // "17:00"
}

export interface SchedulerSchedule {
  id: number
  blocks: ScheduleBlock[]
}

export interface SchedulerSettings {
  breakMinutes: number
  breakEveryMinutes: number
  minChunkDuration: number      // 0 = no minimum
  maxChunkDuration: number      // 0 = no maximum (default 90, ultradian rhythm)
  timezone: string
  meetingBufferBefore: number
  meetingBufferAfter: number
  taskBufferMinutes: number     // Buffer between consecutive tasks (default 5)
  dailyCapPercent: number       // Max % of work hours to fill (default 85)
  // Phase 2: Smart scheduling
  deadlineUrgencyEnabled: boolean   // Boost priority as deadline approaches
  deadlineUrgencyDays: number       // Days before deadline when urgency kicks in (default 3)
  batchSimilarTasks: boolean        // Group same-project tasks together
  deepWorkCapEnabled: boolean       // Cap high-effort tasks per day
  deepWorkCapMinutes: number        // Max minutes of high-effort tasks per day (default 240)
  noDeepWorkAfterMeetings: boolean  // Don't schedule high-effort right after meetings
  deepWorkMeetingBufferMinutes: number // Buffer after meetings before deep work (default 30)
  eatTheFrogEnabled: boolean          // Schedule highest-effort task first each day
}

export interface FlexibleHoursEntry {
  date: string // YYYY-MM-DD
  blocks: ScheduleBlock[]
}

export interface SchedulerInput {
  tasks: SchedulerTask[]
  events: SchedulerEvent[]
  schedules: SchedulerSchedule[]
  settings: SchedulerSettings
  horizon: { start: Date; end: Date }
  mode: 'full' | 'overdue_only'
  now: Date
  disabledStatuses?: Set<string>
  flexibleHours?: FlexibleHoursEntry[]
  /** Internal: set to true for background GET polls to preserve recently-placed tasks */
  _backgroundPoll?: boolean
}

export interface PlacementChunk {
  start: string
  end: string
}

export interface Placement {
  taskId: number
  scheduledStart: string
  scheduledEnd: string
  overdueFrom?: string | null
  priority?: string
  chunks: PlacementChunk[]
}

export interface SchedulerOutput {
  placements: Placement[]
  unplaceable: { taskId: number; reason: string }[]
  warnings: string[]
}

interface TimeSlot {
  start: Date
  end: Date
}

import { PRIORITY_ORDER } from '@/lib/task-constants'

function isScheduleDisabled(status: string, disabledStatuses?: Set<string>): boolean {
  if (!disabledStatuses) return false
  return disabledStatuses.has(status)
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number)
  return { hours: h, minutes: m }
}

// Create a Date in a specific timezone
// e.g., "9:00 AM" in "America/Los_Angeles" -> correct UTC timestamp
function dateInTimezone(date: Date, hours: number, minutes: number, timezone: string): Date {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const h = String(hours).padStart(2, '0')
  const m = String(minutes).padStart(2, '0')
  const guessUtc = new Date(`${year}-${month}-${day}T${h}:${m}:00Z`)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(guessUtc)
  const getPart = (type: string) => Number(parts.find(p => p.type === type)?.value || 0)
  const localYear = getPart('year')
  const localMonth = getPart('month')
  const localDay = getPart('day')
  const localH = getPart('hour')
  const localM = getPart('minute')

  const desiredMs = Date.UTC(year as unknown as number, (parseInt(month) - 1), parseInt(day), hours, minutes)
  const actualLocalMs = Date.UTC(localYear, localMonth - 1, localDay, localH, localM)
  const offsetMs = desiredMs - actualLocalMs

  return new Date(guessUtc.getTime() + offsetMs)
}

function getDayInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
  const dayStr = formatter.format(date)
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return dayMap[dayStr] ?? date.getDay()
}

function getLocalDate(date: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
  const dateStr = formatter.format(date)
  return new Date(dateStr + 'T00:00:00Z')
}

function getWorkingSlots(date: Date, blocks: ScheduleBlock[], timezone: string, flexibleHours?: FlexibleHoursEntry[]): TimeSlot[] {
  const localDate = getLocalDate(date, timezone)

  if (flexibleHours && flexibleHours.length > 0) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    const dateStr = formatter.format(date)
    const override = flexibleHours.find(fh => fh.date === dateStr)
    if (override) {
      return override.blocks.map(b => {
        const s = parseTime(b.start)
        const e = parseTime(b.end)
        return { start: dateInTimezone(localDate, s.hours, s.minutes, timezone), end: dateInTimezone(localDate, e.hours, e.minutes, timezone) }
      }).sort((a, b) => a.start.getTime() - b.start.getTime())
    }
  }

  const dayOfWeek = getDayInTimezone(date, timezone)
  const dayBlocks = blocks.filter(b => b.day === dayOfWeek)
  return dayBlocks.map(b => {
    const s = parseTime(b.start)
    const e = parseTime(b.end)
    return { start: dateInTimezone(localDate, s.hours, s.minutes, timezone), end: dateInTimezone(localDate, e.hours, e.minutes, timezone) }
  }).sort((a, b) => a.start.getTime() - b.start.getTime())
}

function subtractBusy(slots: TimeSlot[], busy: TimeSlot[]): TimeSlot[] {
  let available = [...slots]
  for (const b of busy) {
    const next: TimeSlot[] = []
    for (const s of available) {
      if (b.end.getTime() <= s.start.getTime() || b.start.getTime() >= s.end.getTime()) {
        next.push(s)
      } else {
        if (b.start.getTime() > s.start.getTime()) {
          next.push({ start: s.start, end: new Date(Math.min(b.start.getTime(), s.end.getTime())) })
        }
        if (b.end.getTime() < s.end.getTime()) {
          next.push({ start: new Date(Math.max(b.end.getTime(), s.start.getTime())), end: s.end })
        }
      }
    }
    available = next
  }
  return available
}

// Parse blocked_by field (JSON array or comma-separated)
function parseBlockedBy(blockedBy: string | null | undefined): number[] {
  if (!blockedBy) return []
  try {
    const parsed = JSON.parse(blockedBy)
    return Array.isArray(parsed) ? parsed.map(Number).filter(n => !isNaN(n)) : []
  } catch {
    return blockedBy.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0)
  }
}

// ─── Dependency-aware priority sort ───
// Topological sort that respects priority within each tier.
// Tasks with dependencies always come after their blockers,
// but within the same dependency level, priority order is preserved.

function dependencyAwarePrioritySort(tasks: SchedulerTask[], nowMs: number, urgencyEnabled = true, urgencyDays = 3): SchedulerTask[] {
  const taskMap = new Map<number, SchedulerTask>()
  const deps = new Map<number, number[]>()

  for (const t of tasks) {
    taskMap.set(t.id, t)
    const blockers = parseBlockedBy(t.blocked_by).filter(id => tasks.some(tt => tt.id === id))
    deps.set(t.id, blockers)
  }

  // Compute priority score for sorting within tiers
  function priorityScore(t: SchedulerTask): number {
    let score = 0
    if (t.is_asap) score -= 100000
    if (t.overdue_from) score -= 50000
    score += (PRIORITY_ORDER[t.priority] ?? 2) * 10000
    if (t.due_date) {
      const dueMs = new Date(t.due_date + 'T23:59:59').getTime()
      const daysUntilDue = Math.max(0, (dueMs - nowMs) / 86400000)
      // Closer deadline = lower score = higher priority
      score += daysUntilDue
      // Deadline urgency: boost priority as deadline approaches
      if (urgencyEnabled && daysUntilDue <= urgencyDays) {
        const urgencyBoost = (1 - daysUntilDue / urgencyDays) * 15000
        score -= urgencyBoost
      }
    } else {
      score += 99999 // no due date = lower priority within tier
    }
    return score
  }

  // Kahn's algorithm with priority-aware queue
  const inDegree = new Map<number, number>()
  for (const t of tasks) inDegree.set(t.id, 0)
  deps.forEach((blockers, taskId) => {
    let validBlockerCount = 0
    for (const b of blockers) {
      if (taskMap.has(b)) validBlockerCount++
    }
    inDegree.set(taskId, validBlockerCount)
  })

  // Start with tasks that have no blockers, sorted by priority
  const ready = tasks
    .filter(t => (inDegree.get(t.id) || 0) === 0)
    .sort((a, b) => priorityScore(a) - priorityScore(b))

  const result: SchedulerTask[] = []
  const processed = new Set<number>()

  while (ready.length > 0) {
    const task = ready.shift()!
    if (processed.has(task.id)) continue
    processed.add(task.id)
    result.push(task)

    // Find tasks that were blocked by this one and decrement their in-degree
    deps.forEach((blockers, taskId) => {
      if (processed.has(taskId)) return
      if (blockers.includes(task.id)) {
        const newDeg = (inDegree.get(taskId) || 1) - 1
        inDegree.set(taskId, newDeg)
        if (newDeg <= 0) {
          // Insert into ready queue in priority order
          const t = taskMap.get(taskId)!
          const score = priorityScore(t)
          let insertIdx = ready.findIndex(r => priorityScore(r) > score)
          if (insertIdx === -1) insertIdx = ready.length
          ready.splice(insertIdx, 0, t)
        }
      }
    })
  }

  // Add any tasks not processed (circular deps) -- just append by priority
  for (const t of tasks) {
    if (!processed.has(t.id)) {
      result.push(t)
    }
  }

  return result
}

/**
 * Reorder tasks within the same dependency tier to batch by project_id.
 * Preserves dependency ordering -- only reorders tasks with the same in-degree level.
 */
function batchSimilarTasks(sorted: SchedulerTask[]): SchedulerTask[] {
  // Group consecutive tasks that could be reordered (no dependency relationship between them)
  // Simple approach: stable sort by project_id as secondary key
  // This works because Kahn's algorithm already ordered by priority, so within the same
  // priority band, we just cluster by project
  const result: SchedulerTask[] = []
  let batch: SchedulerTask[] = []
  let lastPriorityBand = -1

  function flushBatch() {
    if (batch.length <= 1) { result.push(...batch); batch = []; return }
    // Sort batch by project_id to cluster same-project tasks
    batch.sort((a, b) => (a.project_id || 0) - (b.project_id || 0))
    result.push(...batch)
    batch = []
  }

  for (const t of sorted) {
    const band = PRIORITY_ORDER[t.priority] ?? 2
    if (band !== lastPriorityBand && batch.length > 0) {
      flushBatch()
    }
    lastPriorityBand = band
    batch.push(t)
  }
  flushBatch()
  return result
}

// Eat the Frog: prioritize high-effort tasks to the front so they fill the first slots of the day
const EFFORT_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }
function eatTheFrogSort(sorted: SchedulerTask[]): SchedulerTask[] {
  // Reorder by effort level ONLY within the same priority band.
  // Overdue/ASAP/urgent tasks must stay at the front -- never let
  // a high-effort normal task jump ahead of an overdue task.
  const result: SchedulerTask[] = []
  let batch: SchedulerTask[] = []
  let lastBand = -1

  function flushBatch() {
    if (batch.length <= 1) { result.push(...batch); batch = []; return }
    batch.sort((a, b) => {
      const ae = EFFORT_ORDER[a.effort_level || 'medium'] ?? 1
      const be = EFFORT_ORDER[b.effort_level || 'medium'] ?? 1
      return ae - be
    })
    result.push(...batch)
    batch = []
  }

  for (const t of sorted) {
    // Overdue and ASAP tasks are their own band (never reordered with normal tasks)
    const band = t.overdue_from || t.is_asap ? -1 : (PRIORITY_ORDER[t.priority] ?? 2)
    if (band !== lastBand && batch.length > 0) {
      flushBatch()
    }
    lastBand = band
    batch.push(t)
  }
  flushBatch()
  return result
}

// Compute total work minutes available on a day
function getDayCapacityMinutes(day: Date, blocks: ScheduleBlock[], timezone: string, flexibleHours?: FlexibleHoursEntry[]): number {
  const slots = getWorkingSlots(day, blocks, timezone, flexibleHours)
  let total = 0
  for (const s of slots) {
    total += (s.end.getTime() - s.start.getTime()) / 60000
  }
  return total
}

export function autoSchedule(input: SchedulerInput): SchedulerOutput {
  const { tasks, events, schedules, settings, horizon, mode, now } = input
  const activeTaskIds = new Set(
    tasks
      .filter(task => !TERMINAL_STATUSES.includes(task.status))
      .map(task => task.id)
  )

  // Default schedule: first schedule or Mon-Fri 9-5
  const defaultBlocks: ScheduleBlock[] = [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '17:00' }))
  const defaultScheduleBlocks = schedules.length > 0 ? schedules[0].blocks : defaultBlocks

  const scheduleMap = new Map<number, ScheduleBlock[]>()
  for (const s of schedules) scheduleMap.set(s.id, s.blocks)

  function getBlocksForTask(task: SchedulerTask): ScheduleBlock[] {
    if (task.schedule_id && scheduleMap.has(task.schedule_id)) {
      return scheduleMap.get(task.schedule_id)!
    }
    return defaultScheduleBlocks
  }

  function getBoundaryTime(dateStr: string, endOfDay = false): number {
    const [year, month, day] = dateStr.split('-').map(Number)
    const utcDate = new Date(Date.UTC(year, month - 1, day))
    const boundary = endOfDay
      ? dateInTimezone(utcDate, 23, 59, settings.timezone).getTime() + 59999
      : dateInTimezone(utcDate, 0, 0, settings.timezone).getTime()
    return boundary
  }

  function getTaskDeadlineEnd(task: SchedulerTask): number | null {
    let deadlineEnd: number | null = null
    if (task.hard_deadline && task.due_date) {
      deadlineEnd = getBoundaryTime(task.due_date, true)
    }
    if (task.project_due_date) {
      const projectDeadline = getBoundaryTime(task.project_due_date, true)
      if (deadlineEnd === null || projectDeadline < deadlineEnd) {
        deadlineEnd = projectDeadline
      }
    }
    return deadlineEnd
  }

  function getTaskExistingChunks(task: SchedulerTask): TimeSlot[] {
    if (task.existing_chunks && task.existing_chunks.length > 0) {
      return task.existing_chunks.map(chunk => ({
        start: new Date(chunk.start),
        end: new Date(chunk.end),
      }))
    }
    if (task.scheduled_start && task.scheduled_end) {
      return [{ start: new Date(task.scheduled_start), end: new Date(task.scheduled_end) }]
    }
    return []
  }

  function getTaskEarliestStartTime(task: SchedulerTask, blockerEnds: Map<number, number>): number {
    let startDateTime = horizon.start.getTime()
    if (task.start_date) {
      startDateTime = Math.max(startDateTime, getBoundaryTime(task.start_date))
    }
    if (task.project_start_date) {
      startDateTime = Math.max(startDateTime, getBoundaryTime(task.project_start_date))
    }

    let earliestStartTime = Math.max(now.getTime(), startDateTime)
    for (const blockerId of parseBlockedBy(task.blocked_by)) {
      const blockerEnd = blockerEnds.get(blockerId)
      if (blockerEnd) {
        earliestStartTime = Math.max(earliestStartTime, blockerEnd)
      }
    }
    return earliestStartTime
  }

  function placementConflicts(chunks: TimeSlot[], busy: TimeSlot[]): boolean {
    return chunks.some(chunk =>
      busy.some(slot => slot.start.getTime() < chunk.end.getTime() && slot.end.getTime() > chunk.start.getTime())
    )
  }

  function getChunkDurationMinutes(chunk: TimeSlot): number {
    return (chunk.end.getTime() - chunk.start.getTime()) / 60000
  }

  function getTaskDeadlineLabel(task: SchedulerTask): string | null {
    if (task.hard_deadline && task.due_date) return task.due_date
    if (task.project_due_date) return task.project_due_date
    return null
  }

  // Settings
  const meetingBufferBefore = settings.meetingBufferBefore || 0
  const meetingBufferAfter = settings.meetingBufferAfter || 0
  const taskBuffer = settings.taskBufferMinutes || 0
  const maxChunk = settings.maxChunkDuration || 0 // 0 = no limit
  const dailyCap = settings.dailyCapPercent || 100 // 100 = fill everything
  // Phase 2
  const urgencyEnabled = settings.deadlineUrgencyEnabled ?? true
  const urgencyDays = settings.deadlineUrgencyDays || 3
  const deepWorkCapEnabled = settings.deepWorkCapEnabled ?? true
  const deepWorkCapMinutes = settings.deepWorkCapMinutes || 240
  const noDeepWorkAfterMeetings = settings.noDeepWorkAfterMeetings ?? true
  const deepWorkMeetingBuffer = settings.deepWorkMeetingBufferMinutes || 30
  const eatTheFrogEnabled = settings.eatTheFrogEnabled ?? true

  // Track all occupied intervals in one mutable set so placements made earlier in this
  // batch immediately block later tasks from reusing the same slot.
  const occupiedSlots: TimeSlot[] = []
  occupiedSlots.push({ start: new Date(0), end: new Date(now) }) // Block past
  const meetingEndTimes: Date[] = [] // For no-deep-work-after-meetings

  let skippedFree = 0, skippedTentative = 0, skippedAllDay = 0, addedBusy = 0
  for (const ev of events) {
    if (ev.busy_status === 'free') { skippedFree++; continue }
    if (ev.busy_status === 'tentative') { skippedTentative++; continue }
    if (ev.all_day) { skippedAllDay++; continue }

    const start = new Date(ev.start_time)
    const end = new Date(ev.end_time)
    const beforeMins = Math.max(meetingBufferBefore, ev.travel_time_before || 0)
    const afterMins = Math.max(meetingBufferAfter, ev.travel_time_after || 0)
    occupiedSlots.push({
      start: new Date(start.getTime() - beforeMins * 60000),
      end: new Date(end.getTime() + afterMins * 60000),
    })
    meetingEndTimes.push(end)
    addedBusy++
  }
  console.log(`[Scheduler] Events: ${events.length} total, ${addedBusy} blocking, skipped: ${skippedFree} free, ${skippedTentative} tentative, ${skippedAllDay} all-day`)

  // Determine which tasks to schedule
  let tasksToSchedule: SchedulerTask[]
  const blockerEndTimes = new Map<number, number>()

  if (mode === 'overdue_only') {
    const TEN_HOURS_MS = 10 * 60 * 60 * 1000

    tasksToSchedule = tasks.filter(t => {
      if (TERMINAL_STATUSES.includes(t.status)) return false
      if (t.auto_schedule !== 1) return false
      if (t.locked_at) return false
      if (isScheduleDisabled(t.status, input.disabledStatuses)) return false
      if (!t.scheduled_end) return false
      return (now.getTime() - new Date(t.scheduled_end).getTime()) >= TEN_HOURS_MS
    }).map(t => ({
      ...t,
      overdue_from: t.overdue_from || t.scheduled_start,
      priority: 'urgent' as const,
      scheduled_start: null,
      scheduled_end: null,
    }))

    // All other scheduled tasks are busy
    for (const t of tasks) {
      if (TERMINAL_STATUSES.includes(t.status)) continue
      if (!t.scheduled_start || !t.scheduled_end) continue
      if (tasksToSchedule.some(ts => ts.id === t.id)) continue
      blockerEndTimes.set(t.id, new Date(t.scheduled_end).getTime())
      occupiedSlots.push({ start: new Date(t.scheduled_start), end: new Date(t.scheduled_end) })
    }
  } else {
    const autoTasks = tasks.filter(t => {
      if (t.auto_schedule !== 1) return false
      if (TERMINAL_STATUSES.includes(t.status)) return false
      if (t.locked_at) return false
      if (isScheduleDisabled(t.status, input.disabledStatuses)) return false
      return true
    })

    tasksToSchedule = []
    const fixedBusyTasks = tasks.filter(t => {
      if (TERMINAL_STATUSES.includes(t.status)) return false
      if (!t.scheduled_start || !t.scheduled_end) return false
      if (t.auto_schedule === 1 && !t.locked_at && !isScheduleDisabled(t.status, input.disabledStatuses)) {
        return false
      }
      return true
    })

    for (const task of fixedBusyTasks) {
      for (const slot of getTaskExistingChunks(task)) {
        occupiedSlots.push(slot)
      }
      blockerEndTimes.set(task.id, new Date(task.scheduled_end!).getTime())
    }

    // On a triggered reschedule (full mode), reschedule ALL auto tasks so they
    // compact to fill freed gaps. The 10-hour keep window only applies to
    // background GET polls to prevent thrashing.
    const isBackgroundPoll = input._backgroundPoll === true

    const autoTasksByExistingStart = [...autoTasks].sort((a, b) => {
      const aStart = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
      const bStart = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER
      if (aStart !== bStart) return aStart - bStart
      return a.id - b.id
    })

    for (const t of autoTasksByExistingStart) {
      // Background refresh/poll should preserve the existing plan.
      // Only explicit user-triggered actions should cause a live repack.
      if (isBackgroundPoll) {
        if (t.scheduled_start && t.scheduled_end) {
          for (const slot of getTaskExistingChunks(t)) {
            occupiedSlots.push(slot)
          }
          blockerEndTimes.set(t.id, new Date(t.scheduled_end).getTime())
        }
        continue
      }

      if (new Date(t.scheduled_end || 0).getTime() < now.getTime()) {
        const hoursSinceEnd = t.scheduled_end
          ? (now.getTime() - new Date(t.scheduled_end).getTime()) / (60 * 60 * 1000)
          : Infinity
        tasksToSchedule.push({
          ...t,
          overdue_from: t.overdue_from || t.scheduled_start,
          priority: (hoursSinceEnd >= 10 ? 'urgent' : t.priority) as any,
          scheduled_start: null,
          scheduled_end: null,
          existing_chunks: undefined,
        })
      } else {
        const isPastDue = t.due_date && new Date(t.due_date + 'T23:59:59').getTime() < now.getTime()
        tasksToSchedule.push({
          ...t,
          ...(isPastDue ? { overdue_from: t.overdue_from || t.scheduled_start || now.toISOString(), priority: 'urgent' as any } : {}),
          // Full-mode reschedules should repack future auto tasks from scratch.
          // Only background polls preserve the existing plan.
          scheduled_start: null,
          scheduled_end: null,
          existing_chunks: undefined,
        })
      }
    }
  }

  console.log(`[Scheduler] tasksToSchedule=${tasksToSchedule.length}, kept=${mode === 'full' ? (tasks.filter(t => t.auto_schedule === 1 && !TERMINAL_STATUSES.includes(t.status) && !t.locked_at).length + ' autoEligible') : 'n/a'}, allTasks=${tasks.length}, mode=${mode}`)
  if (tasksToSchedule.length > 0) {
    console.log(`[Scheduler] Tasks:`, tasksToSchedule.slice(0, 5).map(t => `#${t.id} "${t.title}" overdue=${!!t.overdue_from} dur=${t.duration_minutes}`))
  }

  // Sort tasks: dependency-aware priority sort (fixes the old .sort() that destroyed topological order)
  let sortedTasks = dependencyAwarePrioritySort(tasksToSchedule, now.getTime(), urgencyEnabled, urgencyDays)
  if (settings.batchSimilarTasks) {
    sortedTasks = batchSimilarTasks(sortedTasks)
  }

  // Eat the Frog: move highest-effort tasks to the front so they get scheduled first each day
  if (eatTheFrogEnabled) {
    sortedTasks = eatTheFrogSort(sortedTasks)
  }

  // Log sort order for overdue tasks
  const overdueInSort = sortedTasks.filter(t => t.overdue_from)
  if (overdueInSort.length > 0) {
    const idx = sortedTasks.findIndex(t => t.overdue_from)
    console.log(`[Scheduler] Overdue tasks: ${overdueInSort.map(t => `#${t.id} "${t.title}"`).join(', ')} | first at sort position ${idx}/${sortedTasks.length}`)
  }

  const placements: Placement[] = []
  const unplaceable: { taskId: number; reason: string }[] = []
  const warnings: string[] = []
  // Track daily placed minutes for capacity cap
  const dailyPlacedMinutes = new Map<string, number>()
  // Track daily deep work minutes for high-effort cap
  const dailyDeepWorkMinutes = new Map<string, number>()

  // Timezone-aware date key: returns YYYY-MM-DD in user's timezone (not UTC)
  const tzFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone })
  function localDateKey(date: Date): string {
    return tzFormatter.format(date)
  }

  // Build days array -- use timezone-aware "today" so we don't skip the current
  // day when the server's UTC midnight differs from the user's local midnight.
  const days: Date[] = []
  const todayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone })
  const todayStr = todayFormatter.format(now)
  const todayLocal = new Date(todayStr + 'T00:00:00Z')
  const d = new Date(todayLocal)
  const endDate = new Date(horizon.end)
  endDate.setHours(23, 59, 59, 999)
  while (d <= endDate) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  console.log(`[Scheduler] Days array: ${days.length} days, first=${days[0]?.toISOString()}, today(tz)=${todayStr}, mode=${mode}`)

  // Pre-compute daily capacity limits
  const dailyCapLimits = new Map<string, number>()
  if (dailyCap < 100) {
    for (const day of days) {
      const cap = getDayCapacityMinutes(day, defaultScheduleBlocks, settings.timezone, input.flexibleHours)
      const dateKey = localDateKey(day)
      dailyCapLimits.set(dateKey, Math.floor(cap * dailyCap / 100))
    }
  }

  let consecutiveMinutes = 0
  let lastPlacedDay = ''

  // Pre-compute task states
  interface TaskState {
    task: SchedulerTask
    remaining: number
    chunks: PlacementChunk[]
    preferredChunks?: TimeSlot[]
    earliestStartTime: number
    deadlineEnd: number | null
    minChunk: number
    taskBlocks: ScheduleBlock[]
    done: boolean
    blockedReason?: string
  }

  const taskStates: TaskState[] = sortedTasks.map(task => {
    // Effective duration = total - completed time
    // For partially-locked tasks, duration_minutes is already reduced to remaining only
    const completedTime = task.completed_time_minutes || 0
    const effectiveDuration = Math.max(0, task.duration_minutes - completedTime)

    const earliestStartTime = getTaskEarliestStartTime(task, blockerEndTimes)
    const deadlineEnd = getTaskDeadlineEnd(task)

    // Min chunk: task override > settings global > whole-block for short tasks
    // 0 = no minimum (from settings), task-level always respected
    let minChunk: number
    if (task.min_chunk_minutes && task.min_chunk_minutes > 0) {
      minChunk = task.min_chunk_minutes
    } else if (settings.minChunkDuration > 0) {
      // Short tasks (<=60m) placed as one block
      minChunk = effectiveDuration <= 60 ? effectiveDuration : settings.minChunkDuration
    } else {
      // No min chunk setting -- use task duration for short tasks, else 1 minute
      minChunk = effectiveDuration <= 60 ? effectiveDuration : 1
    }

    const preferredChunks = getTaskExistingChunks(task)
    const preferredMinutes = preferredChunks.reduce((sum, chunk) => sum + getChunkDurationMinutes(chunk), 0)
    const canPreferExistingPlacement =
      task.scheduled_start !== null &&
      task.scheduled_end !== null &&
      new Date(task.scheduled_start).getTime() >= now.getTime() &&
      !task.overdue_from &&
      preferredChunks.length > 0 &&
      preferredMinutes === effectiveDuration &&
      preferredChunks.every(chunk => chunk.end.getTime() > chunk.start.getTime()) &&
      (maxChunk <= 0 || preferredChunks.every(chunk => getChunkDurationMinutes(chunk) <= maxChunk)) &&
      (
        preferredChunks.length <= 1
          ? true
          : preferredChunks.every(chunk => getChunkDurationMinutes(chunk) >= minChunk)
      )

    return {
      task,
      remaining: effectiveDuration,
      chunks: [],
      preferredChunks: canPreferExistingPlacement ? preferredChunks : undefined,
      earliestStartTime,
      deadlineEnd,
      minChunk,
      taskBlocks: getBlocksForTask(task),
      done: effectiveDuration <= 0,
    }
  })

  // GREEDY placement: each task fills ALL its time into earliest available slots before moving to next
  for (const ts of taskStates) {
    if (ts.done) continue
    if (ts.remaining <= 0) { ts.done = true; continue }

    // Re-check blocker end times (may have been set by tasks processed before this one)
    const blockerIds = parseBlockedBy(ts.task.blocked_by)
    const unresolvedBlockers = blockerIds.filter(bid => activeTaskIds.has(bid) && !blockerEndTimes.has(bid))
    if (unresolvedBlockers.length > 0) {
      ts.remaining = -1
      ts.done = true
      ts.blockedReason = `Blocked by unresolved task(s): ${unresolvedBlockers.map(id => `#${id}`).join(', ')}`
      continue
    }
    for (const bid of blockerIds) {
      const blockerEnd = blockerEndTimes.get(bid)
      if (blockerEnd) {
        ts.earliestStartTime = Math.max(ts.earliestStartTime, blockerEnd)
      }
    }

    if (ts.preferredChunks && ts.preferredChunks.length > 0) {
      const violatesStartBoundary = ts.preferredChunks.some(chunk => chunk.start.getTime() < ts.earliestStartTime)
      const deadlineEnd = ts.deadlineEnd
      const violatesDeadline = deadlineEnd !== null && ts.preferredChunks.some(chunk => chunk.end.getTime() > deadlineEnd)
      const hasConflict = placementConflicts(ts.preferredChunks, occupiedSlots)
      if (!violatesStartBoundary && !violatesDeadline && !hasConflict) {
        for (const chunk of ts.preferredChunks) {
          const startIso = chunk.start.toISOString()
          const endIso = chunk.end.toISOString()
          ts.chunks.push({ start: startIso, end: endIso })
          occupiedSlots.push({ start: chunk.start, end: chunk.end })
          const dayKey = localDateKey(chunk.start)
          const minutes = getChunkDurationMinutes(chunk)
          dailyPlacedMinutes.set(dayKey, (dailyPlacedMinutes.get(dayKey) || 0) + minutes)
          if (ts.task.effort_level === 'high') {
            dailyDeepWorkMinutes.set(dayKey, (dailyDeepWorkMinutes.get(dayKey) || 0) + minutes)
          }
        }
        ts.remaining = 0
        ts.done = true
        const lastChunk = ts.preferredChunks[ts.preferredChunks.length - 1]
        blockerEndTimes.set(ts.task.id, lastChunk.end.getTime())
        continue
      }
    }

    // Reset consecutive minutes when switching to a new task
    consecutiveMinutes = 0

    for (const day of days) {
      if (ts.done || ts.remaining <= 0) break
      // Skip days before earliest start (timezone-aware)
      const earliestDateKey = localDateKey(new Date(ts.earliestStartTime))
      const thisDayKey = localDateKey(day)
      if (thisDayKey < earliestDateKey) continue

      // Check daily capacity cap
      const dayKey = localDateKey(day)
      const capLimit = dailyCapLimits.get(dayKey)
      if (capLimit !== undefined) {
        const used = dailyPlacedMinutes.get(dayKey) || 0
        if (used >= capLimit) continue // Day is at capacity
      }

      // Deep work cap: skip this day for high-effort tasks if cap reached
      if (deepWorkCapEnabled && ts.task.effort_level === 'high') {
        const dwUsed = dailyDeepWorkMinutes.get(dayKey) || 0
        if (dwUsed >= deepWorkCapMinutes) continue
      }

      const workSlots = getWorkingSlots(day, ts.taskBlocks, settings.timezone, input.flexibleHours)

      while (!ts.done && ts.remaining > 0) {
        // Recompute availability after every placement so tasks scheduled earlier
        // in this batch immediately block later tasks from reusing the same slot.
        if (ts.task.overdue_from) {
          const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(day)
          const availPreview = subtractBusy(workSlots, occupiedSlots)
          console.log(`[Scheduler] Overdue #${ts.task.id}: day ${day.toISOString()} (local=${localDay}) workSlots=${workSlots.length} busy=${occupiedSlots.length} available=${availPreview.length} avail=${availPreview.map(s => s.start.toISOString().slice(11,16)+'-'+s.end.toISOString().slice(11,16)).join(',')}`)
        }

        const available = subtractBusy(workSlots, occupiedSlots)
        let placedInPass = false

        for (const slot of available) {
          if (ts.done || ts.remaining <= 0) break

          // Hard deadline check
          if (ts.deadlineEnd && slot.start.getTime() > ts.deadlineEnd) {
            ts.remaining = -1
            ts.done = true
            break
          }

          // Skip slots before earliest start
          let effectiveStart = slot.start
          if (effectiveStart.getTime() < ts.earliestStartTime) {
            effectiveStart = new Date(ts.earliestStartTime)
            const mins = effectiveStart.getMinutes()
            effectiveStart.setMinutes(Math.ceil(mins / 5) * 5, 0, 0)
            if (effectiveStart >= slot.end) continue
          }

          // For overdue_only mode, skip past slots
          if (mode === 'overdue_only' && slot.start.getTime() < now.getTime()) {
            effectiveStart = new Date(Math.max(effectiveStart.getTime(), now.getTime()))
            const mins = effectiveStart.getMinutes()
            effectiveStart.setMinutes(Math.ceil(mins / 5) * 5, 0, 0)
            if (effectiveStart >= slot.end) continue
          }

          // Clamp end to deadline
          let effectiveEnd = slot.end
          if (ts.deadlineEnd && slot.end.getTime() > ts.deadlineEnd) {
            effectiveEnd = new Date(ts.deadlineEnd)
          }

          const dur = (effectiveEnd.getTime() - effectiveStart.getTime()) / 60000
          if (dur < ts.minChunk) continue

          // Reset break counter on day change
          const slotDay = localDateKey(effectiveStart)
          if (slotDay !== lastPlacedDay) {
            consecutiveMinutes = 0
            lastPlacedDay = slotDay
          }

          // Insert break if needed (after X consecutive minutes of work)
          let slotStart = effectiveStart
          if (consecutiveMinutes >= settings.breakEveryMinutes && settings.breakMinutes > 0) {
            slotStart = new Date(slotStart.getTime() + settings.breakMinutes * 60000)
            consecutiveMinutes = 0
            if (slotStart >= effectiveEnd) continue
          }

          // Add task buffer after previous placement
          if (taskBuffer > 0 && ts.chunks.length === 0 && occupiedSlots.length > 0) {
            for (const pb of occupiedSlots) {
              if (Math.abs(pb.end.getTime() - slotStart.getTime()) < taskBuffer * 60000) {
                const buffered = new Date(pb.end.getTime() + taskBuffer * 60000)
                if (buffered.getTime() > slotStart.getTime()) {
                  slotStart = buffered
                }
              }
            }
            if (slotStart >= effectiveEnd) continue
          }

          // No deep work after meetings: push high-effort tasks past meeting buffer
          if (noDeepWorkAfterMeetings && ts.task.effort_level === 'high') {
            for (const meetEnd of meetingEndTimes) {
              const bufferEnd = new Date(meetEnd.getTime() + deepWorkMeetingBuffer * 60000)
              if (slotStart.getTime() >= meetEnd.getTime() && slotStart.getTime() < bufferEnd.getTime()) {
                slotStart = bufferEnd
              }
            }
            if (slotStart >= effectiveEnd) continue
          }

          // Check daily capacity
          const placeDayKey = localDateKey(slotStart)
          const dayCapLimit = dailyCapLimits.get(placeDayKey)
          let availableCapacity = Infinity
          if (dayCapLimit !== undefined) {
            const used = dailyPlacedMinutes.get(placeDayKey) || 0
            availableCapacity = Math.max(0, dayCapLimit - used)
            if (availableCapacity < ts.minChunk && availableCapacity < ts.remaining) continue
          }

          const slotMinutes = (effectiveEnd.getTime() - slotStart.getTime()) / 60000
          // GREEDY: use as much of the slot as possible (up to remaining time)
          let useMinutes = Math.min(ts.remaining, slotMinutes, availableCapacity)

          // Enforce max chunk duration (0 = no limit)
          if (maxChunk > 0 && useMinutes > maxChunk) {
            useMinutes = maxChunk
          }

          if (useMinutes < ts.minChunk && useMinutes < ts.remaining) continue

          const end = new Date(slotStart.getTime() + useMinutes * 60000)
          // Merge with previous chunk if back-to-back (avoids splitting a contiguous block)
          const prevChunk = ts.chunks[ts.chunks.length - 1]
          if (prevChunk && new Date(prevChunk.end).getTime() === slotStart.getTime()) {
            prevChunk.end = end.toISOString()
          } else {
            ts.chunks.push({ start: slotStart.toISOString(), end: end.toISOString() })
          }
          occupiedSlots.push({ start: slotStart, end })
          ts.remaining -= useMinutes
          consecutiveMinutes += useMinutes
          placedInPass = true

          // Debug: log placement for overdue tasks
          if (ts.task.overdue_from) {
            console.log(`[Scheduler] Placed overdue #${ts.task.id} "${ts.task.title}": ${slotStart.toISOString()} - ${end.toISOString()} (day=${day.toISOString()}, dayKey=${placeDayKey})`);
          }

          // Track daily capacity
          dailyPlacedMinutes.set(placeDayKey, (dailyPlacedMinutes.get(placeDayKey) || 0) + useMinutes)
          // Track deep work minutes
          if (ts.task.effort_level === 'high') {
            dailyDeepWorkMinutes.set(placeDayKey, (dailyDeepWorkMinutes.get(placeDayKey) || 0) + useMinutes)
          }

          if (ts.remaining <= 0) {
            ts.done = true
            blockerEndTimes.set(ts.task.id, end.getTime())
          }

          break
        }

        if (!placedInPass) break
      }
    }
  }

  // Build results
  for (const ts of taskStates) {
    if (ts.blockedReason) {
      unplaceable.push({ taskId: ts.task.id, reason: ts.blockedReason })
      warnings.push(`"${ts.task.title}" is blocked by an unresolved dependency`)
    } else if (ts.remaining > 0 && ts.remaining !== -1) {
      if (ts.deadlineEnd) {
        const deadlineLabel = getTaskDeadlineLabel(ts.task)
        unplaceable.push({ taskId: ts.task.id, reason: `Cannot fit before deadline (${deadlineLabel || 'constraint'})` })
        warnings.push(`"${ts.task.title}" cannot be completed before its deadline ${deadlineLabel || 'constraint'}`)
      } else {
        unplaceable.push({ taskId: ts.task.id, reason: `Could not fit ${ts.remaining} remaining minutes within horizon` })
      }
    }

    if (ts.chunks.length > 0) {
      const lastEnd = new Date(ts.chunks[ts.chunks.length - 1].end)
      blockerEndTimes.set(ts.task.id, lastEnd.getTime())

      placements.push({
        taskId: ts.task.id,
        scheduledStart: ts.chunks[0].start,
        scheduledEnd: ts.chunks[ts.chunks.length - 1].end,
        overdueFrom: ts.task.overdue_from || null,
        priority: ts.task.priority,
        chunks: ts.chunks,
      })
    }
  }

  // Capacity warnings
  if (unplaceable.length > 0) {
    const hardDeadlineMisses = unplaceable.filter(u => u.reason.includes('deadline'))
    if (hardDeadlineMisses.length > 0) {
      warnings.push(`${hardDeadlineMisses.length} task(s) cannot fit before their deadlines`)
    }
  }

  return { placements, unplaceable, warnings }
}
