// Everhour normalize — raw snapshot → canonical metric envelope.
//
// Slug namespace this adapter publishes:
//   hours.total       → MetricValue (hours) — total tracked hours in period
//   hours.by_project  → MetricSeries — top 10 projects by hours desc
//   hours.daily       → MetricSeries — daily hours (YYYY-MM-DD, hours)
//
// Schema drift strategy: throw on missing required fields. Do NOT silently
// zero-fill for fields the API stopped sending.
//
// All time values from Everhour are in seconds; we convert to decimal hours
// (entry.time / 3600) rounded to 2 decimal places.

import type { MetricEnvelope, MetricSeries, MetricValue } from '../../adapter-contract'
import type { EverhourRawSnapshot, EverhourTimeEntry } from './types'

export interface EverhourNormalized extends MetricEnvelope {
  provider: 'everhour'
  metrics: {
    'hours.total': MetricValue
    'hours.by_project': MetricSeries
    'hours.daily': MetricSeries
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert seconds to decimal hours, rounded to 2dp. */
function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

/** Primary project ID from a time entry (Everhour returns bare ID strings,
 *  not project objects, in entry.task.projects). */
function primaryProjectId(entry: EverhourTimeEntry): string | null {
  if (!entry.task || !entry.task.projects || entry.task.projects.length === 0) {
    return null
  }
  return entry.task.projects[0] || null
}

/** Resolve a project's display name via the projectsById map (built by the
 *  adapter from /projects). Falls back gracefully through:
 *    1. projectsById[id].name        — canonical name
 *    2. id (the raw "as:1234" string) — better than "(unnamed project)" for debugging
 *    3. "(no project)"               — entry has no task or no projects
 */
function resolveProjectName(
  entry: EverhourTimeEntry,
  projectsById: Record<string, { name: string }>,
): string {
  const id = primaryProjectId(entry)
  if (!id) return '(no project)'
  return projectsById[id]?.name || id
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

export function normalize(raw: EverhourRawSnapshot): EverhourNormalized {
  // Validate required top-level fields.
  if (!Array.isArray(raw.entries)) {
    throw new Error('everhour.normalize: raw.entries is not an array (schema drift)')
  }
  if (!raw.periodStart || !raw.periodEnd) {
    throw new Error('everhour.normalize: raw.periodStart or periodEnd missing (schema drift)')
  }

  for (let i = 0; i < raw.entries.length; i++) {
    const e = raw.entries[i]
    if (typeof e.id !== 'number' && typeof e.id !== 'string') {
      throw new Error(`everhour.normalize: entry[${i}] missing id (schema drift)`)
    }
    if (typeof e.time !== 'number') {
      throw new Error(`everhour.normalize: entry[${i}] (id=${e.id}) missing time (schema drift)`)
    }
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      throw new Error(
        `everhour.normalize: entry[${i}] (id=${e.id}) date "${e.date}" is not YYYY-MM-DD (schema drift)`
      )
    }
  }

  // Total hours.
  const totalSeconds = raw.entries.reduce((sum, e) => sum + e.time, 0)
  const totalHours = secondsToHours(totalSeconds)

  // Per-project aggregation. Project names are resolved from the adapter's
  // /projects map; the raw time entries contain only project IDs.
  const projectsById = raw.projectsById ?? {}
  const projectMap: Map<string, { name: string; seconds: number }> = new Map()
  for (const entry of raw.entries) {
    const name = resolveProjectName(entry, projectsById)
    const id = primaryProjectId(entry) ?? name  // use name as key if no ID
    const existing = projectMap.get(id)
    if (existing) {
      existing.seconds += entry.time
    } else {
      projectMap.set(id, { name, seconds: entry.time })
    }
  }

  // Top 10 by hours descending.
  const byProjectRows = Array.from(projectMap.values())
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 10)
    .map((p) => ({
      project_name: p.name,
      hours: secondsToHours(p.seconds),
    }))

  // Daily aggregation.
  const dailyMap: Map<string, number> = new Map()
  for (const entry of raw.entries) {
    dailyMap.set(entry.date, (dailyMap.get(entry.date) ?? 0) + entry.time)
  }
  const dailyRows = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, seconds]) => ({
      date,
      hours: secondsToHours(seconds),
    }))

  return {
    provider: 'everhour',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    normalizedAt: new Date().toISOString(),
    metrics: {
      'hours.total': {
        value: totalHours,
        label: 'Total Hours',
        unit: 'hours',
      },
      'hours.by_project': {
        columns: [
          { key: 'project_name', label: 'Project', type: 'string' },
          { key: 'hours', label: 'Hours', type: 'number' },
        ],
        rows: byProjectRows,
      },
      'hours.daily': {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'hours', label: 'Hours', type: 'number' },
        ],
        rows: dailyRows,
      },
    },
  }
}
