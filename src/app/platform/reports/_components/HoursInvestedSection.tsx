// Hours Invested section — renders the Everhour normalized MetricEnvelope.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Section structure: header (Everhour identifier + period) → 1-tile KPI strip →
//   daily hours line chart → hours by project table (top 10).
//
// Data contract consumed:
//   MetricEnvelope.metrics['hours.total']      → MetricValue (unit: 'hours')
//   MetricEnvelope.metrics['hours.daily']      → MetricSeries (date, hours)
//   MetricEnvelope.metrics['hours.by_project'] → MetricSeries (project_name, hours)

import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockLineChartDual } from './BlockLineChartDual'
import { BlockTable } from './BlockTable'

interface HoursInvestedSectionProps {
  /** Section title from the database row */
  title: string
  /** Optional intro copy (description_html from the section row). */
  descriptionHtml?: string | null
  /** The normalized Everhour envelope. Null means no snapshot yet. */
  envelope: MetricEnvelope | null
  /** Previous-period envelope for delta indicators. */
  previousEnvelope?: MetricEnvelope | null
  /** Everhour identifier (account name or team name from integration display_name). */
  everhourIdentifier?: string | null
  /** Period dates for the sub-header. */
  periodStart: string
  periodEnd: string
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

export function HoursInvestedSection({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope: _previousEnvelope,
  everhourIdentifier,
  periodStart,
  periodEnd,
}: HoursInvestedSectionProps) {
  const metrics = envelope?.metrics ?? {}

  const hoursTotal = isMetricValue(metrics['hours.total'])
    ? metrics['hours.total']
    : null
  const hoursDaily = isMetricSeries(metrics['hours.daily'])
    ? metrics['hours.daily']
    : null
  const hoursByProject = isMetricSeries(metrics['hours.by_project'])
    ? metrics['hours.by_project']
    : null

  // Format the total hours KPI with 1 decimal place override so "14.5 hrs" reads cleanly.
  const formattedHoursMetric = hoursTotal
    ? {
        ...hoursTotal,
        value:
          typeof hoursTotal.value === 'number'
            ? Number(hoursTotal.value.toFixed(1))
            : hoursTotal.value,
      }
    : null

  return (
    // PHASE2-TIPTAP: replace outer div with <TiptapSectionNode> custom extension
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {everhourIdentifier && (
            <p className="text-xs text-gray-400 mt-0.5">{everhourIdentifier}</p>
          )}
        </div>
        <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-1 whitespace-nowrap self-start sm:flex-shrink-0 sm:mt-0.5">
          {periodStart && periodEnd ? formatPeriod(periodStart, periodEnd) : 'No period set'}
        </span>
      </div>

      {/* Section description (intro copy from description_html) */}
      {descriptionHtml && (
        // PHASE2-TIPTAP: this renders the section's description_html field.
        // Sprint 3 mounts a Tiptap editor here so PMs can edit before sending.
        <div
          className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      {/* No snapshot state */}
      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No data synced yet. Connect Everhour and run the first sync.
        </div>
      )}

      {/* KPI strip — 1 tile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <BlockKpi title="Total Hours" metric={formattedHoursMetric} />
      </div>

      {/* Daily hours line chart */}
      <div className="mb-5">
        <BlockLineChartDual
          title="Daily Hours Tracked"
          series={hoursDaily}
          lineA={{ dataKey: 'hours', label: 'Hours', color: '#f59e0b' }}
        />
      </div>

      {/* Hours by project table */}
      <BlockTable title="Hours by Project" series={hoursByProject} limit={10} />
    </section>
  )
}
