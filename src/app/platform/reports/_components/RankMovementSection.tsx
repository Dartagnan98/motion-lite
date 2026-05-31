// Rank Movement section — renders the SE Ranking normalized MetricEnvelope.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Section structure: header (project name + period) →
//   3-tile KPI strip (avg position, keywords top 10, keywords top 3) →
//   daily avg-position line chart (y-axis inverted: lower rank = better) →
//   top 25 keywords table with delta arrows.
//
// Data contract consumed:
//   MetricEnvelope.metrics['rank.average_position'] → MetricValue (unit: 'rank')
//   MetricEnvelope.metrics['rank.keywords_top10']   → MetricValue (unit: 'count')
//   MetricEnvelope.metrics['rank.keywords_top3']    → MetricValue (unit: 'count')
//   MetricEnvelope.metrics['rank.movement_daily']   → MetricSeries (date, avg_position)
//   MetricEnvelope.metrics['rank.keywords']         → MetricSeries (keyword, current_rank, previous_rank, delta)

import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockLineChartSingle } from './BlockLineChartSingle'
import { BlockDeltaIndicator } from './BlockDeltaIndicator'
import { DeltaIndicator } from './DeltaIndicator'
import { computeDelta } from './delta-utils'

interface RankMovementSectionProps {
  title: string
  descriptionHtml?: string | null
  envelope: MetricEnvelope | null
  /** Previous-period envelope for delta indicators. */
  previousEnvelope?: MetricEnvelope | null
  projectName?: string | null
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

export function RankMovementSection({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope,
  projectName,
  periodStart,
  periodEnd,
}: RankMovementSectionProps) {
  const metrics = envelope?.metrics ?? {}
  const prevMetrics = previousEnvelope?.metrics ?? {}

  const avgPosition = isMetricValue(metrics['rank.average_position'])
    ? metrics['rank.average_position']
    : null
  const keywordsTop10 = isMetricValue(metrics['rank.keywords_top10'])
    ? metrics['rank.keywords_top10']
    : null
  const keywordsTop3 = isMetricValue(metrics['rank.keywords_top3'])
    ? metrics['rank.keywords_top3']
    : null

  const prevAvgPos = isMetricValue(prevMetrics['rank.average_position']) ? prevMetrics['rank.average_position'] : null
  const prevTop10 = isMetricValue(prevMetrics['rank.keywords_top10']) ? prevMetrics['rank.keywords_top10'] : null
  const prevTop3 = isMetricValue(prevMetrics['rank.keywords_top3']) ? prevMetrics['rank.keywords_top3'] : null
  const hasPrev = !!previousEnvelope
  const dAvgPos = computeDelta(typeof avgPosition?.value === 'number' ? avgPosition.value : null, typeof prevAvgPos?.value === 'number' ? prevAvgPos.value : null)
  const dTop10 = computeDelta(typeof keywordsTop10?.value === 'number' ? keywordsTop10.value : null, typeof prevTop10?.value === 'number' ? prevTop10.value : null)
  const dTop3 = computeDelta(typeof keywordsTop3?.value === 'number' ? keywordsTop3.value : null, typeof prevTop3?.value === 'number' ? prevTop3.value : null)
  const movementDaily = isMetricSeries(metrics['rank.movement_daily'])
    ? metrics['rank.movement_daily']
    : null
  const keywordsSeries = isMetricSeries(metrics['rank.keywords'])
    ? metrics['rank.keywords']
    : null

  // Top 25 rows sorted by current_rank ascending (best positions first).
  const keywordRows = keywordsSeries
    ? [...keywordsSeries.rows]
        .sort((a, b) => Number(a.current_rank ?? 999) - Number(b.current_rank ?? 999))
        .slice(0, 25)
    : []

  return (
    // PHASE2-TIPTAP: replace outer div with <TiptapSectionNode> custom extension
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {projectName && (
            <p className="text-xs text-gray-400 mt-0.5">{projectName}</p>
          )}
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
          No data synced yet. Connect SE Ranking and run the first sync.
        </div>
      )}

      {/* KPI strip — 3 tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <BlockKpi
          title="Avg Position"
          metric={avgPosition ? { ...avgPosition, label: 'Avg Position' } : null}
          delta={dAvgPos ? <DeltaIndicator pct={dAvgPos.pct} lowerIsBetter /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Keywords in Top 10"
          metric={keywordsTop10 ? { ...keywordsTop10, label: 'Keywords Top 10' } : null}
          delta={dTop10 ? <DeltaIndicator pct={dTop10.pct} /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Keywords in Top 3"
          metric={keywordsTop3 ? { ...keywordsTop3, label: 'Keywords Top 3' } : null}
          delta={dTop3 ? <DeltaIndicator pct={dTop3.pct} /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
      </div>

      {/* Daily avg-position line chart — y-axis inverted */}
      <div className="mb-5">
        <BlockLineChartSingle
          title="Average Position Trend"
          series={movementDaily}
          line={{ dataKey: 'avg_position', label: 'Avg Position', color: '#6366f1' }}
          invertY
          referenceLine={{ y: 10, label: 'Top 10' }}
        />
      </div>

      {/* Top 25 keywords table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-2">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700">Top Keywords</p>
        </div>
        {keywordRows.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-300 text-center">No keyword data</div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-50">
              {keywordRows.map((row, i) => {
                const delta = row.delta !== null && row.delta !== undefined ? Number(row.delta) : null
                return (
                  <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-800 font-medium truncate flex-1">{String(row.keyword ?? '')}</span>
                    <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
                      <span className="text-gray-700">
                        {row.current_rank !== null && row.current_rank !== undefined ? `#${Number(row.current_rank).toFixed(0)}` : '—'}
                      </span>
                      <BlockDeltaIndicator delta={delta} />
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-2.5 font-medium text-gray-500">Keyword</th>
                    <th className="text-right px-4 py-2.5 font-medium text-gray-500">Current</th>
                    <th className="text-right px-4 py-2.5 font-medium text-gray-500">Previous</th>
                    <th className="text-right px-5 py-2.5 font-medium text-gray-500">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {keywordRows.map((row, i) => {
                    const delta = row.delta !== null && row.delta !== undefined
                      ? Number(row.delta)
                      : null
                    return (
                      <tr
                        key={i}
                        className={`border-b border-gray-50 last:border-0 ${
                          i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                        }`}
                      >
                        <td className="px-5 py-2.5 text-gray-800 font-medium">
                          {String(row.keyword ?? '')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">
                          {row.current_rank !== null && row.current_rank !== undefined
                            ? `#${Number(row.current_rank).toFixed(0)}`
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums">
                          {row.previous_rank !== null && row.previous_rank !== undefined
                            ? `#${Number(row.previous_rank).toFixed(0)}`
                            : '—'}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <BlockDeltaIndicator delta={delta} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
