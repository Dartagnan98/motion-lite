import type { Task } from './types'
import { TERMINAL_STATUSES } from '@/lib/task-constants'

export interface TaskState {
  state: 'on_time' | 'at_risk' | 'past_due' | 'could_not_fit' | 'no_eta'
  label: string
  color: string
  badgeColor: string
}
const MS_24H = 24 * 60 * 60 * 1000

function parseDate(s: string): Date { return new Date(s.includes('T') ? s : s + 'T00:00:00') }

export function getTaskState(task: Task): TaskState {
  const now = new Date()
  const hasDueDate = !!task.due_date
  const hasScheduledEnd = !!task.scheduled_end
  const hasScheduledStart = !!task.scheduled_start
  const isTerminal = TERMINAL_STATUSES.includes(task.status)

  // Past Due: has due_date, due_date end of day is in the past, not terminal
  if (hasDueDate && !isTerminal) {
    const due = new Date(task.due_date! + 'T23:59:59')
    if (due < now) {
      return {
        state: 'past_due',
        label: 'PAST DEADLINE',
        color: 'var(--status-past-due)',
        badgeColor: 'var(--status-past-due)',
      }
    }
  }

  // At Risk: has due_date + scheduled_end, scheduled_end within 24h of due_date
  if (hasDueDate && hasScheduledEnd) {
    const due = parseDate(task.due_date!)
    const end = new Date(task.scheduled_end!)
    const gap = due.getTime() - end.getTime()

    if (gap >= 0 && gap <= MS_24H) {
      return {
        state: 'at_risk',
        label: 'AT RISK',
        color: 'var(--status-at-risk)',
        badgeColor: 'var(--status-at-risk)',
      }
    }

    // On Time: scheduled_end is more than 24h before due_date
    if (gap > MS_24H) {
      return {
        state: 'on_time',
        label: 'ON TIME',
        color: 'var(--status-on-time)',
        badgeColor: 'var(--status-on-time)',
      }
    }
  }

  // Could Not Fit: auto_schedule enabled but no scheduled_start
  if (task.auto_schedule === 1 && !hasScheduledStart) {
    return {
      state: 'could_not_fit',
      label: 'COULD NOT FIT',
      color: 'var(--status-no-fit)',
      badgeColor: 'var(--status-no-fit)',
    }
  }

  // No ETA: no due_date and no scheduled_start
  if (!hasDueDate && !hasScheduledStart) {
    return {
      state: 'no_eta',
      label: 'NO ETA',
      color: 'var(--text-dim)',
      badgeColor: 'var(--text-dim)',
    }
  }

  // Default fallback
  return {
    state: 'no_eta',
    label: 'NO ETA',
    color: 'var(--text-dim)',
    badgeColor: 'var(--text-dim)',
  }
}

export function getOverdueCount(tasks: Task[]): number {
  return tasks.filter((t) => getTaskState(t).state === 'past_due').length
}
