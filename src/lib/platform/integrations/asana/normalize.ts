// Asana normalize — raw snapshot → canonical metric envelope.
//
// Slug namespace this adapter publishes:
//   tasks.completed         → MetricValue (count) — total tasks completed in period
//   tasks.completed_daily   → MetricSeries — daily bucket: date + count
//   tasks.recent            → MetricSeries — top 10 most recently completed tasks
//
// Schema drift strategy: throw on missing required fields. Do NOT silently
// default to 0 for fields that disappear — wrong numbers are worse than red tiles.
//
// Date handling: all dates emitted as ISO YYYY-MM-DD (or ISO datetime for
// completed_at). completed_at from Asana is an ISO datetime string; we parse
// it and reformat to YYYY-MM-DD for bucketing.

import type { MetricEnvelope, MetricSeries, MetricValue } from '../../adapter-contract'
import type { AsanaRawSnapshot, AsanaTask } from './types'

export interface AsanaNormalized extends MetricEnvelope {
  provider: 'asana'
  metrics: {
    'tasks.completed': MetricValue
    'tasks.completed_daily': MetricSeries
    'tasks.recent': MetricSeries
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the ISO YYYY-MM-DD date portion from an ISO datetime string.
 *  Asana returns completed_at as e.g. "2026-04-15T18:23:00.000Z". */
function toDateOnly(isoDatetime: string): string {
  const match = isoDatetime.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match) {
    throw new Error(
      `asana.normalize: cannot parse date from completed_at "${isoDatetime}" (schema drift)`
    )
  }
  return match[1]
}

/** Get the primary project name from a task's memberships. Falls back to
 *  "(no project)" when a task has no project membership (top-level workspace task). */
function primaryProjectName(task: AsanaTask): string {
  if (!task.memberships || task.memberships.length === 0) {
    return '(no project)'
  }
  return task.memberships[0].project.name || '(unnamed project)'
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

export function normalize(raw: AsanaRawSnapshot): AsanaNormalized {
  // Validate required top-level fields.
  if (!Array.isArray(raw.tasks)) {
    throw new Error('asana.normalize: raw.tasks is not an array (schema drift)')
  }
  if (!raw.periodStart || !raw.periodEnd) {
    throw new Error('asana.normalize: raw.periodStart or periodEnd missing (schema drift)')
  }

  // Filter guard: only fully-completed tasks should be in the list, but
  // double-check so we don't normalize incomplete tasks on a schema change.
  const completed = raw.tasks.filter((t) => {
    if (!t.gid || typeof t.gid !== 'string') {
      throw new Error(`asana.normalize: task missing gid (schema drift): ${JSON.stringify(t)}`)
    }
    if (typeof t.name !== 'string') {
      throw new Error(`asana.normalize: task ${t.gid} missing name (schema drift)`)
    }
    if (!t.completed_at) {
      // Task is in the result set but somehow has no completed_at. Skip gracefully
      // (Asana can return incomplete tasks from search if the filter drifted).
      return false
    }
    return true
  })

  const total = completed.length

  // Build daily bucket map.
  const dailyMap: Map<string, number> = new Map()
  for (const task of completed) {
    const date = toDateOnly(task.completed_at!)
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1)
  }

  // Sort daily buckets by date asc.
  const dailyRows = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  // Top 10 most recently completed tasks (sort by completed_at desc).
  const recentRows = [...completed]
    .sort((a, b) => (b.completed_at! > a.completed_at! ? 1 : -1))
    .slice(0, 10)
    .map((t) => ({
      task_name: t.name,
      project_name: primaryProjectName(t),
      completed_at: t.completed_at!,
    }))

  return {
    provider: 'asana',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    normalizedAt: new Date().toISOString(),
    metrics: {
      'tasks.completed': {
        value: total,
        label: 'Tasks Completed',
        unit: 'count',
      },
      'tasks.completed_daily': {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'count', label: 'Tasks Completed', type: 'number' },
        ],
        rows: dailyRows,
      },
      'tasks.recent': {
        columns: [
          { key: 'task_name', label: 'Task', type: 'string' },
          { key: 'project_name', label: 'Project', type: 'string' },
          { key: 'completed_at', label: 'Completed At', type: 'string' },
        ],
        rows: recentRows,
      },
    },
  }
}
