// Gravity Forms normalize — raw snapshot → canonical metric envelope.
//
// Slug namespace this adapter publishes (under metric_slug):
//   forms.total_entries  → MetricValue (unit: 'count') — entries across selected forms in period
//   forms.by_form        → MetricSeries — per-form entry count: form_title / entries
//   forms.daily          → MetricSeries — daily entry count: date / count
//
// forms.conversion_rate is skipped in Phase 2 (requires GA4 join — deferred to Phase 3).
//
// Schema drift strategy: throw on missing required fields. An empty entry set is
// valid (no submissions in period) — not schema drift. An empty byForm array when
// formIds were specified is a warning, not a throw.

import type { MetricEnvelope, MetricSeries, MetricValue } from '../../adapter-contract'
import type { GravityFormsRawSnapshot } from './types'

export interface GravityFormsNormalized extends MetricEnvelope {
  provider: 'gravity_forms'
  metrics: {
    'forms.total_entries': MetricValue
    'forms.by_form': MetricSeries
    'forms.daily': MetricSeries
    'forms.recent_entries': MetricSeries
  }
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

export function normalize(raw: GravityFormsRawSnapshot): GravityFormsNormalized {
  // Required top-level field validation.
  if (!raw.siteUrl || typeof raw.siteUrl !== 'string') {
    throw new Error('gravity_forms.normalize: raw.siteUrl missing or not a string (schema drift)')
  }
  if (!raw.periodStart || !raw.periodEnd) {
    throw new Error('gravity_forms.normalize: raw.periodStart or periodEnd missing (schema drift)')
  }
  if (typeof raw.totalEntries !== 'number') {
    throw new Error('gravity_forms.normalize: raw.totalEntries is not a number (schema drift)')
  }
  if (!Array.isArray(raw.byForm)) {
    throw new Error('gravity_forms.normalize: raw.byForm is not an array (schema drift)')
  }
  if (!Array.isArray(raw.daily)) {
    throw new Error('gravity_forms.normalize: raw.daily is not an array (schema drift)')
  }

  // Validate byForm rows.
  for (let i = 0; i < raw.byForm.length; i++) {
    const f = raw.byForm[i]
    if (!f.formId || typeof f.formId !== 'string') {
      throw new Error(`gravity_forms.normalize: byForm[${i}] missing formId (schema drift)`)
    }
    if (typeof f.formTitle !== 'string') {
      throw new Error(`gravity_forms.normalize: byForm[${i}] missing formTitle (schema drift)`)
    }
    if (typeof f.entryCount !== 'number') {
      throw new Error(`gravity_forms.normalize: byForm[${i}] missing entryCount (schema drift)`)
    }
  }

  // Validate daily rows.
  for (let i = 0; i < raw.daily.length; i++) {
    const d = raw.daily[i]
    if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      throw new Error(
        `gravity_forms.normalize: daily[${i}] date "${d.date}" is not YYYY-MM-DD (schema drift)`
      )
    }
    if (typeof d.count !== 'number') {
      throw new Error(`gravity_forms.normalize: daily[${i}] count is not a number (schema drift)`)
    }
  }

  const warnings: string[] = []

  if (raw.formIds.length > 0 && raw.byForm.length === 0) {
    warnings.push('gravity_forms.normalize: no matching forms found for the selected form IDs')
  }

  // Sort by_form by entry count descending.
  const byFormRows = raw.byForm
    .slice()
    .sort((a, b) => b.entryCount - a.entryCount)
    .map((f) => ({
      form_title: f.formTitle,
      entries: f.entryCount,
    }))

  // Sort daily ascending by date.
  const dailyRows = raw.daily
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      count: d.count,
    }))

  return {
    provider: 'gravity_forms',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    normalizedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
    metrics: {
      'forms.total_entries': {
        value: raw.totalEntries,
        label: 'Total Form Entries',
        unit: 'count',
      },
      'forms.by_form': {
        columns: [
          { key: 'form_title', label: 'Form', type: 'string' },
          { key: 'entries', label: 'Entries', type: 'number' },
        ],
        rows: byFormRows,
      },
      'forms.daily': {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'count', label: 'Entries', type: 'number' },
        ],
        rows: dailyRows,
      },
      'forms.recent_entries': {
        columns: [
          { key: 'name', label: 'Name', type: 'string' },
          { key: 'phone', label: 'Phone', type: 'string' },
          { key: 'email', label: 'Email', type: 'string' },
          { key: 'message', label: 'Message', type: 'string' },
          { key: 'entry_date', label: 'Entry Date', type: 'date' },
          { key: 'entry_url', label: 'View', type: 'string' },
        ],
        // recentEntries may be absent in older snapshots persisted before this
        // field landed — guard with `?? []` so normalize stays robust.
        rows: (raw.recentEntries ?? []).map((e) => ({
          name: e.name ?? '',
          phone: e.phone ?? '',
          email: e.email ?? '',
          message: e.message ?? '',
          entry_date: e.dateCreated,
          entry_url: e.entryUrl,
        })),
      },
    },
  }
}
