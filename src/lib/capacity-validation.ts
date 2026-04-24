import type { ScheduleBlock } from '@/lib/scheduler'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "HH:MM" into total minutes since midnight */
function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Iterate each calendar day in [startDate, endDate] inclusive (YYYY-MM-DD) */
function forEachDay(startDate: string, endDate: string, cb: (date: Date) => void): void {
  const cur = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  while (cur <= end) {
    cb(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
}

/** Minutes of work available from a set of blocks for a given day-of-week */
function blockMinutesForDay(dayOfWeek: number, workBlocks: ScheduleBlock[]): number {
  let total = 0
  for (const b of workBlocks) {
    if (b.day === dayOfWeek) {
      const mins = parseTime(b.end) - parseTime(b.start)
      if (mins > 0) total += mins
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Count total available work minutes in a date range after applying the
 * daily capacity percentage.
 */
export function getAvailableWorkMinutes(
  startDate: string,
  endDate: string,
  workBlocks: ScheduleBlock[],
  dailyCapPercent: number,
): number {
  const cap = Math.max(0, Math.min(100, dailyCapPercent)) / 100
  let total = 0
  forEachDay(startDate, endDate, (date) => {
    const dow = date.getDay() // 0=Sun … 6=Sat
    total += blockMinutesForDay(dow, workBlocks) * cap
  })
  return Math.floor(total)
}

/**
 * Check whether the tasks in a stage fit within the stage's date range.
 */
export function validateStageCapacity(
  tasks: { duration_minutes: number }[],
  startDate: string,
  endDate: string,
  workBlocks: ScheduleBlock[],
  dailyCapPercent: number,
): {
  fits: boolean
  totalTaskMinutes: number
  availableMinutes: number
  overflowMinutes: number
  workDays: number
} {
  const totalTaskMinutes = tasks.reduce((sum, t) => sum + (t.duration_minutes || 0), 0)
  const availableMinutes = getAvailableWorkMinutes(startDate, endDate, workBlocks, dailyCapPercent)

  let workDays = 0
  forEachDay(startDate, endDate, (date) => {
    if (blockMinutesForDay(date.getDay(), workBlocks) > 0) workDays++
  })

  const overflowMinutes = Math.max(0, totalTaskMinutes - availableMinutes)

  return {
    fits: totalTaskMinutes <= availableMinutes,
    totalTaskMinutes,
    availableMinutes,
    overflowMinutes,
    workDays,
  }
}

/**
 * Validate every stage in a project and return an overall fit + per-stage
 * breakdown.
 */
export function validateProjectCapacity(
  stages: {
    tasks: { duration_minutes: number }[]
    startDate: string
    endDate: string
  }[],
  workBlocks: ScheduleBlock[],
  dailyCapPercent: number,
): {
  fits: boolean
  stageResults: {
    startDate: string
    endDate: string
    fits: boolean
    totalTaskMinutes: number
    availableMinutes: number
    overflowMinutes: number
    workDays: number
  }[]
} {
  const stageResults = stages.map((stage) => {
    const result = validateStageCapacity(
      stage.tasks,
      stage.startDate,
      stage.endDate,
      workBlocks,
      dailyCapPercent,
    )
    return {
      startDate: stage.startDate,
      endDate: stage.endDate,
      ...result,
    }
  })

  return {
    fits: stageResults.every((r) => r.fits),
    stageResults,
  }
}

/**
 * Check whether adding a single task to a stage would exceed capacity.
 */
export function validateTaskFits(
  taskDurationMinutes: number,
  startDate: string,
  endDate: string,
  workBlocks: ScheduleBlock[],
  dailyCapPercent: number,
  existingTaskMinutesInStage: number,
): {
  fits: boolean
  availableMinutes: number
  totalAfterAdd: number
  overflowMinutes: number
} {
  const availableMinutes = getAvailableWorkMinutes(startDate, endDate, workBlocks, dailyCapPercent)
  const totalAfterAdd = existingTaskMinutesInStage + taskDurationMinutes
  const overflowMinutes = Math.max(0, totalAfterAdd - availableMinutes)

  return {
    fits: totalAfterAdd <= availableMinutes,
    availableMinutes,
    totalAfterAdd,
    overflowMinutes,
  }
}

/**
 * Return a human-readable capacity warning with a solution suggestion.
 *
 * @param context - where the warning appears, so the suggestion is relevant
 *   'task'     → single task in TaskDetailPanel
 *   'stage'    → stage in CreateProjectModal wizard
 *   'template' → stage in TemplateEditor
 */
export function formatCapacityWarning(
  available: number,
  needed: number,
  context: 'task' | 'stage' | 'template' = 'stage',
): { message: string; suggestion: string } {
  const overflowMins = needed - available
  const overflowHrs = (overflowMins / 60).toFixed(1)
  const availHrs = (available / 60).toFixed(1)
  const neededHrs = (needed / 60).toFixed(1)

  const message = `${neededHrs} hrs of tasks won't fit in ${availHrs} hrs of available work time`

  let suggestion: string
  if (context === 'task') {
    suggestion = `Shorten the task by ${overflowHrs} hrs, extend the date range, or increase your daily capacity in Settings.`
  } else if (context === 'template') {
    suggestion = `Remove ${overflowHrs} hrs of tasks, extend the stage duration, or reduce task durations.`
  } else {
    suggestion = `Extend the stage deadline, shorten tasks by ${overflowHrs} hrs, or increase daily capacity in Settings.`
  }

  return { message, suggestion }
}
