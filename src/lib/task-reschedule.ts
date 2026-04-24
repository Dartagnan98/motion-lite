import { getProject, getWorkspaceStatuses } from '@/lib/db'

const SCHEDULING_FIELDS = [
  'priority',
  'due_date',
  'duration_minutes',
  'auto_schedule',
  'is_asap',
  'blocked_by',
  'status',
  'hard_deadline',
  'start_date',
  'min_chunk_minutes',
  'effort_level',
  'assignee',
  'schedule_id',
  'locked_at',
] as const

type ExistingTaskLike = {
  id: number
  status?: string | null
  workspace_id?: number | null
  project_id?: number | null
  auto_schedule?: number | null
  priority?: string | null
  due_date?: string | null
  duration_minutes?: number | null
  is_asap?: number | null
  blocked_by?: string | null
  hard_deadline?: number | null
  start_date?: string | null
  min_chunk_minutes?: number | null
  effort_level?: string | null
  assignee?: string | null
  schedule_id?: number | null
  locked_at?: string | null
} | null | undefined

const NUMERIC_FIELDS = new Set<typeof SCHEDULING_FIELDS[number]>([
  'duration_minutes',
  'min_chunk_minutes',
  'schedule_id',
])

const BOOLEANISH_FIELDS = new Set<typeof SCHEDULING_FIELDS[number]>([
  'auto_schedule',
  'is_asap',
  'hard_deadline',
])

function normalizeStatusKey(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
}

function normalizeBooleanishValue(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (!lower) return 0
    if (['0', 'false', 'off', 'no'].includes(lower)) return 0
    if (['1', 'true', 'on', 'yes'].includes(lower)) return 1
  }
  return Number(Boolean(value))
}

function normalizeComparableValue(field: typeof SCHEDULING_FIELDS[number], value: unknown): number | string | null {
  if (value === null || value === undefined || value === '') return null
  if (field === 'blocked_by') {
    if (Array.isArray(value)) {
      return value
        .map(v => String(v).trim())
        .filter(Boolean)
        .sort()
        .join(',')
    }
    return String(value)
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .sort()
      .join(',')
  }
  if (BOOLEANISH_FIELDS.has(field)) return normalizeBooleanishValue(value)
  if (NUMERIC_FIELDS.has(field)) return Number(value)
  return String(value)
}

function getEffectiveSchedulingFieldChanges(
  existingTask: ExistingTaskLike,
  data: Record<string, unknown>,
  changedFields: string[],
): Array<typeof SCHEDULING_FIELDS[number]> {
  return changedFields.filter((field): field is typeof SCHEDULING_FIELDS[number] => {
    const schedulingField = field as typeof SCHEDULING_FIELDS[number]
    if (!SCHEDULING_FIELDS.includes(schedulingField)) return false
    return normalizeComparableValue(schedulingField, data[schedulingField]) !== normalizeComparableValue(schedulingField, (existingTask as Record<string, unknown> | undefined)?.[schedulingField])
  })
}

function isAutoScheduleDisabledStatus(task: ExistingTaskLike, status: string): boolean {
  if (!task?.id) return false

  const workspaceId = task.workspace_id
    || (task.project_id ? getProject(task.project_id)?.workspace_id : null)

  if (!workspaceId) return false

  const target = normalizeStatusKey(status)
  if (!target) return false

  return getWorkspaceStatuses(workspaceId).some(statusRow =>
    !!statusRow.auto_schedule_disabled && normalizeStatusKey(statusRow.name) === target
  )
}

export function shouldTriggerTaskReschedule(changedFields: string[]): boolean {
  return changedFields.some(field => SCHEDULING_FIELDS.includes(field as typeof SCHEDULING_FIELDS[number]))
}

export function getTaskMutationRescheduleScope(
  existingTask: ExistingTaskLike,
  data: Record<string, unknown>,
  changedFields: string[],
): { shouldReschedule: boolean } {
  const effectiveSchedulingChanges = getEffectiveSchedulingFieldChanges(existingTask, data, changedFields)
  if (effectiveSchedulingChanges.length === 0) return { shouldReschedule: false }

  if ('status' in data) {
    const nextStatus = String(data.status || '')
    const prevStatus = String(existingTask?.status || '')
    const statusOnlyChange = effectiveSchedulingChanges.every(field => field === 'status')
      && changedFields.every(field => field === 'status' || field === 'completed_at')
    const prevDisabled = isAutoScheduleDisabledStatus(existingTask, prevStatus)
    const nextDisabled = isAutoScheduleDisabledStatus(existingTask, nextStatus)

    if (statusOnlyChange && !['done', 'cancelled', 'archived'].includes(nextStatus) && prevDisabled === nextDisabled) {
      return { shouldReschedule: false }
    }
  }

  if (existingTask?.id) {
    return { shouldReschedule: true }
  }

  return { shouldReschedule: true }
}
