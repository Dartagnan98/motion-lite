// ── Single source of truth for task priority & status colors ──────────
// Import these everywhere instead of defining locally.

// ── Priority ─────────────────────────────────────────────────────────

export interface PriorityOption {
  value: string
  label: string
  color: string
  icon: string
}

export const PRIORITY_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  urgent: { color: '#ef4444', label: 'ASAP', icon: 'flag' },
  high:   { color: '#f97316', label: 'High',   icon: 'flag' },
  medium: { color: '#eab308', label: 'Medium', icon: 'flag' },
  low:    { color: '#6b7280', label: 'Low',    icon: 'flag' },
}

/** SVG flag path used for priority icons */
export const PRIORITY_FLAG_PATH = 'M3 2v12M3 2h9l-2.5 3.5L12 9H3'

/** Flat color lookup: priorityColor['urgent'] → '#ef4444' */
export const PRIORITY_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(PRIORITY_CONFIG).map(([k, v]) => [k, v.color])
)

/** Array form for dropdowns / selectors */
export const PRIORITY_OPTIONS: PriorityOption[] = Object.entries(PRIORITY_CONFIG).map(
  ([value, { color, label, icon }]) => ({ value, label, color, icon })
)

// ── Task Status ──────────────────────────────────────────────────────

export interface StatusOption {
  value: string
  label: string
  color: string
  icon: 'empty' | 'half' | 'check' | 'x' | 'blocked' | 'dim'
}

export const STATUS_CONFIG: Record<string, { color: string; label: string; icon: StatusOption['icon'] }> = {
  backlog:     { color: '#6b7280', label: 'Backlog',     icon: 'dim' },
  todo:        { color: '#42a5f5', label: 'Todo',        icon: 'empty' },
  in_progress: { color: '#ff9100', label: 'In Progress', icon: 'half' },
  blocked:     { color: '#ef5350', label: 'Blocked',     icon: 'blocked' },
  review:      { color: '#b388ff', label: 'Review',      icon: 'half' },
  done:        { color: '#00e676', label: 'Completed',   icon: 'check' },
  cancelled:   { color: '#ef5350', label: 'Cancelled',   icon: 'x' },
  archived:    { color: '#4a4a4a', label: 'Archived',    icon: 'dim' },
}

/** Flat color lookup: statusColor['in_progress'] → '#ff9100' */
export const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.color])
)

/** Array form for dropdowns (common subset, no cancelled/archived) */
export const STATUS_OPTIONS: StatusOption[] = [
  'backlog', 'todo', 'in_progress', 'blocked', 'review', 'done',
].map(k => ({ value: k, ...STATUS_CONFIG[k] }))

/** Full array including blocked/cancelled/archived */
export const STATUS_OPTIONS_ALL: StatusOption[] = Object.entries(STATUS_CONFIG).map(
  ([value, rest]) => ({ value, ...rest })
)

// ── Project Status (separate from task status) ───────────────────────

export const PROJECT_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  open:     { color: '#3a7d44', label: 'Open' },
  closed:   { color: '#78909c', label: 'Closed' },
  archived: { color: '#f6bf26', label: 'Archived' },
}

export const PROJECT_STATUS_OPTIONS = Object.entries(PROJECT_STATUS_CONFIG).map(
  ([value, { color, label }]) => ({ value, label, color })
)

/** Project status color lookup */
export const PROJECT_STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.color])
)

// ── Duration ────────────────────────────────────────────────────────

export interface DurationOption {
  value: string
  label: string
}

export const DURATION_OPTIONS: DurationOption[] = [
  { value: '0', label: 'Reminder' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' },
  { value: '240', label: '4 hours' },
  { value: '360', label: '6 hours' },
  { value: '480', label: '8 hours' },
  { value: '600', label: '10 hours' },
]

export function formatDuration(mins: number): string {
  if (mins === 0) return 'Reminder'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`
  return `${h}.${Math.round(m / 6)} hours`
}

// ── Chunk Options ───────────────────────────────────────────────────

export const CHUNK_OPTIONS: DurationOption[] = [
  { value: '0', label: 'No Chunks' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
]

// ── Terminal Statuses ───────────────────────────────────────────────

/** Statuses that mean a task is "finished" and shouldn't appear in active lists */
export const TERMINAL_STATUSES: string[] = ['done', 'cancelled', 'archived']

// ── Ordering ───────────────────────────────────────────────────────

/** Sort order for priorities (lower = higher priority) */
export const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0, high: 1, medium: 2, low: 3,
}

/** Sort order for statuses (lower = more active) */
export const STATUS_ORDER: Record<string, number> = {
  in_progress: 0, todo: 1, review: 2, backlog: 3, blocked: 4, done: 5, cancelled: 6, archived: 7,
}

/** Status display labels */
export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.label])
)

/** Priority display labels */
export const PRIORITY_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(PRIORITY_CONFIG).map(([k, v]) => [k, v.label])
)

// ── Default Task Values ─────────────────────────────────────────────

export const DEFAULT_TASK_VALUES = {
  status: 'todo' as const,
  priority: 'medium' as const,
  duration_minutes: 30,
  auto_schedule: true,
}
