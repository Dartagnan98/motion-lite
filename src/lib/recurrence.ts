import { createTask, getTask, updateTask } from './db'
import type { Task } from './types'

export interface RecurrenceRule {
  type: 'daily' | 'weekly' | 'monthly'
  interval: number
  days?: number[] // for weekly: 0=Sun..6=Sat
  end_date?: string | null
}

export function parseRecurrenceRule(json: string | null): RecurrenceRule | null {
  if (!json) return null
  try {
    return JSON.parse(json) as RecurrenceRule
  } catch {
    return null
  }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function getNextOccurrence(fromDate: Date, rule: RecurrenceRule): Date | null {
  if (rule.end_date && new Date(rule.end_date) < fromDate) return null

  switch (rule.type) {
    case 'daily':
      return addDays(fromDate, rule.interval)

    case 'weekly': {
      if (rule.days && rule.days.length > 0) {
        const currentDay = fromDate.getDay()
        // Find next matching day
        const sorted = [...rule.days].sort((a, b) => a - b)
        for (const day of sorted) {
          if (day > currentDay) {
            return addDays(fromDate, day - currentDay)
          }
        }
        // Wrap to next week
        const daysUntilNext = 7 * rule.interval - currentDay + sorted[0]
        return addDays(fromDate, daysUntilNext)
      }
      return addDays(fromDate, 7 * rule.interval)
    }

    case 'monthly':
      return addMonths(fromDate, rule.interval)

    default:
      return null
  }
}

export function createNextRecurrenceInstance(completedTask: Task): Task | null {
  const rule = parseRecurrenceRule(completedTask.recurrence_rule)
  if (!rule) return null

  const baseDate = completedTask.due_date ? new Date(completedTask.due_date) : new Date()
  const nextDate = getNextOccurrence(baseDate, rule)
  if (!nextDate) return null

  const dateStr = nextDate.toISOString().split('T')[0]

  const newTask = createTask({
    title: completedTask.title,
    description: completedTask.description || undefined,
    projectId: completedTask.project_id || undefined,
    stageId: completedTask.stage_id || undefined,
    workspaceId: completedTask.workspace_id || undefined,
    folderId: completedTask.folder_id || undefined,
    assignee: completedTask.assignee || undefined,
    priority: completedTask.priority,
    status: 'todo',
    due_date: dateStr,
    duration_minutes: completedTask.duration_minutes,
  })

  // Set recurrence fields on new task
  updateTask(newTask.id, {
    recurrence_rule: completedTask.recurrence_rule,
    recurrence_parent_id: completedTask.recurrence_parent_id || completedTask.id,
    auto_schedule: completedTask.auto_schedule,
    min_chunk_minutes: completedTask.min_chunk_minutes,
    start_date: dateStr,
    hard_deadline: completedTask.hard_deadline,
    task_type: completedTask.task_type,
    is_asap: 0,
  })

  return getTask(newTask.id)
}

// Detach a single instance from its recurring series
// Used when editing "this occurrence only"
export function detachFromSeries(taskId: number): Task | null {
  const task = getTask(taskId)
  if (!task) return null

  updateTask(taskId, {
    recurrence_rule: null,
    recurrence_parent_id: task.recurrence_parent_id || task.id,
  })

  return getTask(taskId)
}

// Edit all future occurrences by updating the master task's recurrence rule
export function editAllOccurrences(taskId: number, data: Record<string, unknown>): Task | null {
  const task = getTask(taskId)
  if (!task) return null

  // Find the master task (either this task or its parent)
  const masterId = task.recurrence_parent_id || task.id
  updateTask(masterId, data)

  return getTask(masterId)
}

// Delete a single occurrence (detach and mark cancelled)
export function deleteSingleOccurrence(taskId: number): void {
  updateTask(taskId, {
    recurrence_rule: null,
    recurrence_parent_id: null,
    status: 'cancelled',
  })
}

// Delete all occurrences in a series
export function deleteAllOccurrences(taskId: number): void {
  const task = getTask(taskId)
  if (!task) return

  const masterId = task.recurrence_parent_id || task.id

  // Find all tasks in this series
  const { getDb } = require('./db')
  const db = getDb()
  const seriesTasks = db.prepare(
    'SELECT id FROM tasks WHERE id = ? OR recurrence_parent_id = ?'
  ).all(masterId, masterId) as { id: number }[]

  for (const t of seriesTasks) {
    updateTask(t.id, { status: 'cancelled', recurrence_rule: null })
  }
}

export function expandRecurringTasks(tasks: Task[], horizonStart: Date, horizonEnd: Date): Task[] {
  const expanded: Task[] = []

  for (const task of tasks) {
    const rule = parseRecurrenceRule(task.recurrence_rule)
    if (!rule) continue
    if (task.recurrence_parent_id) continue // skip instances, only expand templates

    let current = new Date(task.start_date || task.created_at * 1000)
    current.setHours(0, 0, 0, 0)
    let count = 0
    const MAX_EXPANSIONS = 50

    while (current <= horizonEnd && count < MAX_EXPANSIONS) {
      if (current >= horizonStart) {
        expanded.push({
          ...task,
          id: -(task.id * 1000 + count), // negative IDs for virtual instances
          start_date: current.toISOString().split('T')[0],
          due_date: current.toISOString().split('T')[0],
          scheduled_start: null,
          scheduled_end: null,
          status: 'todo',
          title: task.title,
        })
      }
      const next = getNextOccurrence(current, rule)
      if (!next || next <= current) break
      current = next
      count++
    }
  }

  return expanded
}
