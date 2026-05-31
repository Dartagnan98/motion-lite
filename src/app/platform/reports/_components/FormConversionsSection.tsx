// Form Conversions section — renders the Gravity Forms normalized MetricEnvelope.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Section structure: header (site URL + period + "N forms tracked") →
//   1-tile KPI strip (total entries) →
//   daily entries line chart →
//   per-form breakdown table (top 10 by count).
//
// Data contract consumed:
//   MetricEnvelope.metrics['forms.total_entries'] → MetricValue (unit: 'count')
//   MetricEnvelope.metrics['forms.daily']         → MetricSeries (date, entries)
//   MetricEnvelope.metrics['forms.by_form']       → MetricSeries (form_title, entries)

import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockLineChartSingle } from './BlockLineChartSingle'
import { BlockTable } from './BlockTable'
import { RecentEntriesTable } from './RecentEntriesTable'

interface FormConversionsSectionProps {
  title: string
  descriptionHtml?: string | null
  envelope: MetricEnvelope | null
  /** Previous-period envelope for delta indicators. */
  previousEnvelope?: MetricEnvelope | null
  siteUrl?: string | null
  /** Number of forms selected during connect (from config_json.formIds.length). */
  formsTrackedCount?: number | null
  periodStart: string
  periodEnd: string
  readOnly?: boolean
}

function isMetricValue(m: MetricValue | MetricSeries | undefined): m is MetricValue {
  return !!m && 'value' in m
}

function isMetricSeries(m: MetricValue | MetricSeries | undefined): m is MetricSeries {
  return !!m && 'columns' in m
}

function formatPeriod(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return `${fmt(start)} – ${fmt(end)}`
}

export function FormConversionsSection({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope: _previousEnvelope,
  siteUrl,
  formsTrackedCount,
  periodStart,
  periodEnd,
}: FormConversionsSectionProps) {
  const metrics = envelope?.metrics ?? {}

  const totalEntries = isMetricValue(metrics['forms.total_entries'])
    ? metrics['forms.total_entries']
    : null
  const dailySeries = isMetricSeries(metrics['forms.daily'])
    ? metrics['forms.daily']
    : null
  const byFormSeries = isMetricSeries(metrics['forms.by_form'])
    ? metrics['forms.by_form']
    : null
  const recentEntriesSeries = isMetricSeries(metrics['forms.recent_entries'])
    ? metrics['forms.recent_entries']
    : null

  // Top 10 forms by entry count.
  const byFormDisplay: MetricSeries | null = byFormSeries
    ? {
        ...byFormSeries,
        rows: [...byFormSeries.rows]
          .sort((a, b) => Number(b.entries ?? 0) - Number(a.entries ?? 0))
          .slice(0, 10),
      }
    : null

  const formsLabel = formsTrackedCount != null
    ? `${formsTrackedCount} form${formsTrackedCount !== 1 ? 's' : ''} tracked`
    : null

  return (
    // PHASE2-TIPTAP: replace outer div with <TiptapSectionNode> custom extension
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {siteUrl && (
              <p className="text-xs text-gray-400 font-mono">{siteUrl}</p>
            )}
            {formsLabel && (
              <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
                {formsLabel}
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-1 whitespace-nowrap self-start sm:flex-shrink-0 sm:mt-0.5">
          {periodStart && periodEnd ? formatPeriod(periodStart, periodEnd) : 'No period set'}
        </span>
      </div>

      {/* Section description */}
      {descriptionHtml && (
        // PHASE2-TIPTAP: this renders the section's description_html field.
        <div
          className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      {/* No snapshot state */}
      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No data synced yet. Connect Gravity Forms and run the first sync.
        </div>
      )}

      {/* KPI strip — 1 tile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <BlockKpi
          title="Total Entries"
          metric={totalEntries ? { ...totalEntries, label: 'Total Entries' } : null}
        />
      </div>

      {/* Daily entries line chart. NOTE: normalizer emits the column key as
          'count' (not 'entries') — keep these in sync if the slug shape changes. */}
      <div className="mb-5">
        <BlockLineChartSingle
          title="Daily Form Entries"
          series={dailySeries}
          line={{ dataKey: 'count', label: 'Entries', color: '#8b5cf6' }}
        />
      </div>

      {/* Per-form breakdown table */}
      <BlockTable title="Entries by Form" series={byFormDisplay} limit={10} />

      {/* Recent entries — clickable, sortable by date */}
      <div className="mt-5">
        <RecentEntriesTable series={recentEntriesSeries} title="Recent Entries" />
      </div>
    </section>
  )
}
