'use client'

// Search Performance section — renders the GSC normalized MetricEnvelope.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Section structure: header (site + period) → KPI strip (4 tiles) →
//   30-day line chart → Top Queries table (with per-row PoP delta) →
//   Top Pages table (with per-row PoP delta).
//
// Tiptap divergence note (Sprint 2):
//   This is a plain React client component. The report builder in Phase 2 wraps
//   sections in a Tiptap custom node extension so PMs can drag-reorder and
//   inline-edit the description_html. The comment `// PHASE2-TIPTAP: replace
//   with Tiptap custom node` marks the seam.
//
// Data contract consumed:
//   MetricEnvelope.metrics['search_performance.clicks']      → MetricValue
//   MetricEnvelope.metrics['search_performance.impressions'] → MetricValue
//   MetricEnvelope.metrics['search_performance.ctr']         → MetricValue
//   MetricEnvelope.metrics['search_performance.position']    → MetricValue
//   MetricEnvelope.metrics['search_performance.daily']       → MetricSeries
//   MetricEnvelope.metrics['search_performance.top_queries'] → MetricSeries
//   MetricEnvelope.metrics['search_performance.top_pages']   → MetricSeries

import { useMemo } from 'react'
import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockLineChart } from './BlockLineChart'
import { DeltaIndicator } from './DeltaIndicator'
import { computeDelta } from './delta-utils'

interface SearchPerformanceSectionProps {
  title: string
  descriptionHtml?: string | null
  envelope: MetricEnvelope | null
  previousEnvelope?: MetricEnvelope | null
  siteUrl?: string | null
  periodStart: string
  periodEnd: string
}

// ─── Type guards ─────────────────────────────────────────────────────────────

function isMetricValue(m: MetricValue | MetricSeries | undefined): m is MetricValue {
  return !!m && 'value' in m
}

function isMetricSeries(m: MetricValue | MetricSeries | undefined): m is MetricSeries {
  return !!m && 'columns' in m
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPeriod(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return `${fmt(start)} – ${fmt(end)}`
}

/** Inline delta cell: renders `<value> <small arrow + signed number>`.
 *  absChange: current - previous. isPositiveGood: false for position (lower=better). */
function InlineDelta({
  value,
  absChange,
  isPositiveGood = true,
  decimals = 0,
}: {
  value: string | number
  absChange: number | null
  isPositiveGood?: boolean
  decimals?: number
}) {
  if (absChange === null || !isFinite(absChange) || absChange === 0) {
    return (
      <span className="tabular-nums text-gray-800">
        {typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: decimals }) : value}
      </span>
    )
  }

  // For position: a negative absChange (went from 5 to 3 = -2) is an improvement.
  // isPositiveGood=false means lower number is better.
  const improved = isPositiveGood ? absChange > 0 : absChange < 0
  const colorStyle: React.CSSProperties = { color: improved ? '#059669' : '#ef4444' }
  const arrow = absChange > 0 ? '▲' : '▼'
  const sign = absChange > 0 ? '+' : ''
  const absFormatted =
    decimals > 0
      ? `${sign}${Math.abs(absChange).toFixed(decimals)}`
      : `${sign}${Math.round(Math.abs(absChange)).toLocaleString()}`
  // For negative: show the negative sign explicitly
  const deltaLabel = absChange < 0
    ? `-${Math.abs(absChange).toFixed(decimals > 0 ? decimals : 0)}`
    : absFormatted

  return (
    <span className="inline-flex items-baseline gap-0.5 tabular-nums">
      <span className="text-gray-800">
        {typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: decimals }) : value}
      </span>
      <span
        className="text-[10px] font-semibold leading-none ml-0.5"
        style={colorStyle}
      >
        {arrow}{deltaLabel}
      </span>
    </span>
  )
}

// ─── Per-row delta table for keywords ────────────────────────────────────────

interface KeywordRow {
  query: string
  clicks: number
  impressions: number
  position: number
  prevClicks: number | null
  prevImpressions: number | null
  prevPosition: number | null
}

interface QueryTableProps {
  title: string
  currentSeries: MetricSeries | null
  previousSeries: MetricSeries | null
  limit?: number
}

function QueryDeltaTable({ title, currentSeries, previousSeries, limit = 20 }: QueryTableProps) {
  const rows = useMemo<KeywordRow[]>(() => {
    if (!currentSeries || currentSeries.rows.length === 0) return []

    // Build prev-period lookup by lowercase-trimmed query
    const prevMap = new Map<string, { clicks: number; impressions: number; position: number }>()
    if (previousSeries) {
      for (const row of previousSeries.rows) {
        const q = String(row['query'] ?? row['keyword'] ?? '').toLowerCase().trim()
        if (q) {
          prevMap.set(q, {
            clicks: Number(row['clicks'] ?? 0),
            impressions: Number(row['impressions'] ?? 0),
            position: Number(row['position'] ?? row['avg_position'] ?? 0),
          })
        }
      }
    }

    // Detect the query column name (might be 'query' or 'keyword')
    const queryCols = currentSeries.columns.filter(
      (c) => c.key === 'query' || c.key === 'keyword',
    )
    const queryKey = queryCols[0]?.key ?? 'query'

    return currentSeries.rows.slice(0, limit).map((row) => {
      const q = String(row[queryKey] ?? '')
      const prev = prevMap.get(q.toLowerCase().trim()) ?? null
      return {
        query: q,
        clicks: Number(row['clicks'] ?? 0),
        impressions: Number(row['impressions'] ?? 0),
        position: Number(row['position'] ?? row['avg_position'] ?? 0),
        prevClicks: prev ? prev.clicks : null,
        prevImpressions: prev ? prev.impressions : null,
        prevPosition: prev ? prev.position : null,
      }
    })
  }, [currentSeries, previousSeries, limit])

  if (!currentSeries || rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-700 mb-3">{title}</p>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    )
  }

  const hasPrev = !!previousSeries

  return (
    <div data-report-card className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-700">{title}</p>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden divide-y divide-gray-50">
        {rows.map((row, i) => {
          const dClicks = row.prevClicks !== null ? row.clicks - row.prevClicks : null
          const dImpressions = row.prevImpressions !== null ? row.impressions - row.prevImpressions : null
          const dPosition = row.prevPosition !== null ? row.position - row.prevPosition : null
          return (
            <div key={i} className="px-4 py-3">
              <p className="text-sm text-gray-800 font-medium truncate">{row.query.length > 50 ? row.query.slice(0, 47) + '…' : row.query}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                <span className="text-xs text-gray-500">Clicks: <InlineDelta value={row.clicks} absChange={dClicks} isPositiveGood={true} /></span>
                <span className="text-xs text-gray-500">Impr: <InlineDelta value={row.impressions} absChange={dImpressions} isPositiveGood={true} /></span>
                <span className="text-xs text-gray-500">Pos: <InlineDelta value={row.position} absChange={dPosition} isPositiveGood={false} decimals={1} /></span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">
                Keyword
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                Clicks{hasPrev ? <span className="text-gray-300 normal-case font-normal ml-1">This Period</span> : null}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                Impr.{hasPrev ? <span className="text-gray-300 normal-case font-normal ml-1">This Period</span> : null}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                Avg Pos.{hasPrev ? <span className="text-gray-300 normal-case font-normal ml-1">This Period</span> : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const dClicks = row.prevClicks !== null ? row.clicks - row.prevClicks : null
              const dImpressions = row.prevImpressions !== null ? row.impressions - row.prevImpressions : null
              const dPosition = row.prevPosition !== null ? row.position - row.prevPosition : null

              return (
                <tr
                  key={i}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-2.5 text-gray-700 max-w-[200px] truncate" title={row.query}>
                    {row.query.length > 50 ? row.query.slice(0, 47) + '…' : row.query}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <InlineDelta value={row.clicks} absChange={dClicks} isPositiveGood={true} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <InlineDelta value={row.impressions} absChange={dImpressions} isPositiveGood={true} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <InlineDelta value={row.position} absChange={dPosition} isPositiveGood={false} decimals={1} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Per-row delta table for pages ───────────────────────────────────────────

interface PageRow {
  page: string
  clicks: number
  impressions: number
  position: number
  prevClicks: number | null
  prevImpressions: number | null
  prevPosition: number | null
}

interface PageTableProps {
  title: string
  currentSeries: MetricSeries | null
  previousSeries: MetricSeries | null
  limit?: number
}

function PageDeltaTable({ title, currentSeries, previousSeries, limit = 10 }: PageTableProps) {
  const rows = useMemo<PageRow[]>(() => {
    if (!currentSeries || currentSeries.rows.length === 0) return []

    // Build prev-period lookup by lowercase-trimmed page URL
    const prevMap = new Map<string, { clicks: number; impressions: number; position: number }>()
    if (previousSeries) {
      for (const row of previousSeries.rows) {
        const url = String(row['page'] ?? row['url'] ?? row['path'] ?? '').toLowerCase().trim()
        if (url) {
          prevMap.set(url, {
            clicks: Number(row['clicks'] ?? 0),
            impressions: Number(row['impressions'] ?? 0),
            position: Number(row['position'] ?? row['avg_position'] ?? 0),
          })
        }
      }
    }

    // Detect the URL column name
    const urlCols = currentSeries.columns.filter(
      (c) => c.key === 'page' || c.key === 'url' || c.key === 'path',
    )
    const urlKey = urlCols[0]?.key ?? 'page'

    return currentSeries.rows.slice(0, limit).map((row) => {
      const url = String(row[urlKey] ?? '')
      const prev = prevMap.get(url.toLowerCase().trim()) ?? null
      return {
        page: url,
        clicks: Number(row['clicks'] ?? 0),
        impressions: Number(row['impressions'] ?? 0),
        position: Number(row['position'] ?? row['avg_position'] ?? 0),
        prevClicks: prev ? prev.clicks : null,
        prevImpressions: prev ? prev.impressions : null,
        prevPosition: prev ? prev.position : null,
      }
    })
  }, [currentSeries, previousSeries, limit])

  if (!currentSeries || rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-700 mb-3">{title}</p>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    )
  }

  const hasPrev = !!previousSeries

  return (
    <div data-report-card className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-700">{title}</p>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden divide-y divide-gray-50">
        {rows.map((row, i) => {
          const dClicks = row.prevClicks !== null ? row.clicks - row.prevClicks : null
          const dImpressions = row.prevImpressions !== null ? row.impressions - row.prevImpressions : null
          const dPosition = row.prevPosition !== null ? row.position - row.prevPosition : null
          let displayUrl = row.page
          try {
            const u = new URL(row.page)
            displayUrl = u.pathname + (u.pathname.endsWith('/') ? '' : '/')
          } catch { /* leave as-is */ }
          if (displayUrl.length > 55) displayUrl = displayUrl.slice(0, 52) + '…'
          return (
            <div key={i} className="px-4 py-3">
              <a
                href={row.page.startsWith('http') ? row.page : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-800 font-medium hover:text-indigo-600 truncate block"
                title={row.page}
              >
                {displayUrl}
              </a>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                <span className="text-xs text-gray-500">Clicks: <InlineDelta value={row.clicks} absChange={dClicks} isPositiveGood={true} /></span>
                <span className="text-xs text-gray-500">Impr: <InlineDelta value={row.impressions} absChange={dImpressions} isPositiveGood={true} /></span>
                <span className="text-xs text-gray-500">Pos: <InlineDelta value={row.position} absChange={dPosition} isPositiveGood={false} decimals={1} /></span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">
                Page URL
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                Clicks{hasPrev ? <span className="text-gray-300 normal-case font-normal ml-1">This Period</span> : null}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                Impr.{hasPrev ? <span className="text-gray-300 normal-case font-normal ml-1">This Period</span> : null}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                Avg Pos.{hasPrev ? <span className="text-gray-300 normal-case font-normal ml-1">This Period</span> : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const dClicks = row.prevClicks !== null ? row.clicks - row.prevClicks : null
              const dImpressions = row.prevImpressions !== null ? row.impressions - row.prevImpressions : null
              const dPosition = row.prevPosition !== null ? row.position - row.prevPosition : null

              // Shorten URL for display
              let displayUrl = row.page
              try {
                const u = new URL(row.page)
                displayUrl = u.pathname + (u.pathname.endsWith('/') ? '' : '/')
              } catch {
                // not a full URL, show as-is
              }
              if (displayUrl.length > 55) displayUrl = displayUrl.slice(0, 52) + '…'

              return (
                <tr
                  key={i}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-2.5 text-gray-700 max-w-[220px]" title={row.page}>
                    <a
                      href={row.page.startsWith('http') ? row.page : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-indigo-600 transition-colors"
                    >
                      {displayUrl}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <InlineDelta value={row.clicks} absChange={dClicks} isPositiveGood={true} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <InlineDelta value={row.impressions} absChange={dImpressions} isPositiveGood={true} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <InlineDelta value={row.position} absChange={dPosition} isPositiveGood={false} decimals={1} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SearchPerformanceSection({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope,
  siteUrl,
  periodStart,
  periodEnd,
}: SearchPerformanceSectionProps) {
  const metrics = envelope?.metrics ?? {}
  const prevMetrics = previousEnvelope?.metrics ?? {}

  const clicks = isMetricValue(metrics['search_performance.clicks'])
    ? metrics['search_performance.clicks']
    : null
  const impressions = isMetricValue(metrics['search_performance.impressions'])
    ? metrics['search_performance.impressions']
    : null
  const ctr = isMetricValue(metrics['search_performance.ctr'])
    ? metrics['search_performance.ctr']
    : null
  const position = isMetricValue(metrics['search_performance.position'])
    ? metrics['search_performance.position']
    : null
  const daily = isMetricSeries(metrics['search_performance.daily'])
    ? metrics['search_performance.daily']
    : null
  const topQueries = isMetricSeries(metrics['search_performance.top_queries'])
    ? metrics['search_performance.top_queries']
    : null
  const topPages = isMetricSeries(metrics['search_performance.top_pages'])
    ? metrics['search_performance.top_pages']
    : null

  // Delta helpers — compute period-over-period change for each scalar KPI.
  const prevClicks = isMetricValue(prevMetrics['search_performance.clicks'])
    ? prevMetrics['search_performance.clicks'] : null
  const prevImpressions = isMetricValue(prevMetrics['search_performance.impressions'])
    ? prevMetrics['search_performance.impressions'] : null
  const prevCtr = isMetricValue(prevMetrics['search_performance.ctr'])
    ? prevMetrics['search_performance.ctr'] : null
  const prevPosition = isMetricValue(prevMetrics['search_performance.position'])
    ? prevMetrics['search_performance.position'] : null

  // Previous-period series for per-row delta
  const prevTopQueries = isMetricSeries(prevMetrics['search_performance.top_queries'])
    ? prevMetrics['search_performance.top_queries']
    : null
  const prevTopPages = isMetricSeries(prevMetrics['search_performance.top_pages'])
    ? prevMetrics['search_performance.top_pages']
    : null

  const deltaClicks = computeDelta(
    typeof clicks?.value === 'number' ? clicks.value : null,
    typeof prevClicks?.value === 'number' ? prevClicks.value : null,
  )
  const deltaImpressions = computeDelta(
    typeof impressions?.value === 'number' ? impressions.value : null,
    typeof prevImpressions?.value === 'number' ? prevImpressions.value : null,
  )
  const deltaCtr = computeDelta(
    typeof ctr?.value === 'number' ? ctr.value : null,
    typeof prevCtr?.value === 'number' ? prevCtr.value : null,
  )
  const deltaPosition = computeDelta(
    typeof position?.value === 'number' ? position.value : null,
    typeof prevPosition?.value === 'number' ? prevPosition.value : null,
  )

  const hasPreviousPeriod = !!previousEnvelope

  return (
    // PHASE2-TIPTAP: replace outer div with <TiptapSectionNode> custom extension
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {siteUrl && (
            <p className="text-xs text-gray-400 mt-0.5">{siteUrl}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:mt-0.5">
          {hasPreviousPeriod && previousEnvelope && (
            <span className="text-xs text-blue-500 bg-blue-50 border border-blue-200 rounded px-2 py-1 whitespace-nowrap">
              Comparing to {formatPeriod(previousEnvelope.periodStart, previousEnvelope.periodEnd)}
            </span>
          )}
          <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-1 whitespace-nowrap">
            {formatPeriod(periodStart, periodEnd)}
          </span>
        </div>
      </div>

      {/* Section description */}
      {descriptionHtml && (
        // PHASE2-TIPTAP: Phase 2 mounts a Tiptap editor here.
        <div
          className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      {/* No snapshot state */}
      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No data synced yet. Connect Google Search Console and run the first sync.
        </div>
      )}

      {/* KPI strip — 4 tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <BlockKpi
          title="Clicks"
          metric={clicks}
          delta={deltaClicks ? <DeltaIndicator pct={deltaClicks.pct} /> : hasPreviousPeriod ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Impressions"
          metric={impressions}
          delta={deltaImpressions ? <DeltaIndicator pct={deltaImpressions.pct} /> : hasPreviousPeriod ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="CTR"
          metric={ctr}
          delta={deltaCtr ? <DeltaIndicator pct={deltaCtr.pct} /> : hasPreviousPeriod ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Avg Position"
          metric={position}
          delta={deltaPosition ? <DeltaIndicator pct={deltaPosition.pct} lowerIsBetter /> : hasPreviousPeriod ? <DeltaIndicator pct={null} /> : undefined}
        />
      </div>

      {/* 30-day line chart */}
      <div className="mb-5">
        <BlockLineChart title="Daily Clicks & Impressions" series={daily} />
      </div>

      {/* Tables with per-row PoP delta arrows */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QueryDeltaTable
          title="Top Keywords"
          currentSeries={topQueries}
          previousSeries={prevTopQueries}
          limit={20}
        />
        <PageDeltaTable
          title="Top Pages"
          currentSeries={topPages}
          previousSeries={prevTopPages}
          limit={10}
        />
      </div>
    </section>
  )
}
