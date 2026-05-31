'use client'

// GA4 Conversions section — renders key event (conversion) data from GA4.
//
// Wireframe ref: "Hiilites - Glenvalley Dental - 2026-05 - Conversions.pdf"
//   Section structure: header (property + period) →
//   "Goals" sub-card → two-column layout:
//     LEFT:  sortable table (event name | Completions | Last Period | Change %)
//     RIGHT: total KPI + delta + "Since last period" + pie chart by channel
//
// Data contract consumed:
//   MetricEnvelope.metrics['ga4.conversions_total']     → MetricValue (count)
//   MetricEnvelope.metrics['ga4.conversions_by_event']  → MetricSeries { event_name, completions }
//   MetricEnvelope.metrics['ga4.conversions_by_channel'] → MetricSeries { channel, count }

import { useState, useMemo } from 'react'
import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// ─── Color palette ───────────────────────────────────────────────────────────
// PDF reference: orange / purple / teal dominant.
// Chosen to harmonize with the existing report accent palette (indigo, emerald).
const SLICE_COLORS = ['#f97316', '#8b5cf6', '#14b8a6', '#6366f1', '#f59e0b', '#10b981']

// ─── Prop shape ──────────────────────────────────────────────────────────────

interface ConversionsSectionProps {
  title: string
  descriptionHtml?: string | null
  envelope: MetricEnvelope | null
  previousEnvelope?: MetricEnvelope | null
  propertyName?: string | null
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPeriod(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return `${fmt(start)} – ${fmt(end)}`
}

/** snake_case → Title Case With Spaces */
function toTitleCase(raw: string): string {
  return raw
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

type SortKey = 'event_name' | 'completions' | 'last_period' | 'change_pct'
type SortDir = 'asc' | 'desc'

interface EventRow {
  event_name: string
  completions: number
  last_period: number
  change_pct: number | null // null = n/a (0/0 case)
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SortChevron({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`inline-flex flex-col ml-1 gap-[1px] ${active ? 'opacity-100' : 'opacity-30'}`}>
      <svg
        className={`w-2 h-2 ${active && dir === 'asc' ? 'text-gray-700' : 'text-gray-400'}`}
        viewBox="0 0 8 5"
        fill="currentColor"
      >
        <path d="M4 0L8 5H0L4 0Z" />
      </svg>
      <svg
        className={`w-2 h-2 ${active && dir === 'desc' ? 'text-gray-700' : 'text-gray-400'}`}
        viewBox="0 0 8 5"
        fill="currentColor"
      >
        <path d="M4 5L0 0H8L4 5Z" />
      </svg>
    </span>
  )
}

function ChangePctCell({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-gray-300 font-medium">—</span>
  }
  const isPositive = pct > 0
  const isNegative = pct < 0
  const colorClass = isPositive ? 'text-emerald-600' : isNegative ? 'text-red-500' : 'text-gray-400'
  const arrow = isPositive ? '▲' : isNegative ? '▼' : '—'
  const display = Math.abs(pct) < 0.05 ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
  if (Math.abs(pct) < 0.05) {
    return <span className="text-gray-400 font-medium">—</span>
  }
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${colorClass}`}>
      <span className="text-xs leading-none">{arrow}</span>
      <span>{display}</span>
    </span>
  )
}

interface PieTooltipProps {
  active?: boolean
  payload?: { name: string; value: number; payload: { total: number } }[]
}

function PieTooltip({ active, payload }: PieTooltipProps) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  const share = item.payload.total > 0
    ? ((item.value / item.payload.total) * 100).toFixed(1)
    : '0'
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-gray-800">{item.name}</p>
      <p className="text-gray-500">{item.value.toLocaleString()} completions</p>
      <p className="text-gray-400">{share}% of total</p>
    </div>
  )
}

// Custom legend to match the PDF (right-side vertical list)
interface LegendItemProps {
  entries: { name: string; color: string }[]
}
function PieLegend({ entries }: LegendItemProps) {
  return (
    <div className="flex flex-col gap-2 justify-center pl-4">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: e.color }}
          />
          <span className="text-xs text-gray-600 leading-tight">{e.name}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConversionsSection({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope,
  propertyName,
  periodStart,
  periodEnd,
}: ConversionsSectionProps) {
  const [sortKey, setSortKey] = useState<SortKey>('completions')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const metrics = envelope?.metrics ?? {}
  const prevMetrics = previousEnvelope?.metrics ?? {}

  // Extract slugs
  const convTotal = isMetricValue(metrics['ga4.conversions_total'])
    ? metrics['ga4.conversions_total']
    : null
  const byEvent = isMetricSeries(metrics['ga4.conversions_by_event'])
    ? metrics['ga4.conversions_by_event']
    : null
  const byChannel = isMetricSeries(metrics['ga4.conversions_by_channel'])
    ? metrics['ga4.conversions_by_channel']
    : null

  const prevTotal = isMetricValue(prevMetrics['ga4.conversions_total'])
    ? prevMetrics['ga4.conversions_total']
    : null
  const prevByEvent = isMetricSeries(prevMetrics['ga4.conversions_by_event'])
    ? prevMetrics['ga4.conversions_by_event']
    : null

  // Build previous-event lookup map
  const prevEventMap = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>()
    if (!prevByEvent) return map
    for (const row of prevByEvent.rows) {
      const name = String(row['event_name'] ?? '')
      const count = Number(row['completions'] ?? 0)
      if (name) map.set(name, count)
    }
    return map
  }, [prevByEvent])

  // Compute event rows with delta
  const eventRows = useMemo<EventRow[]>(() => {
    if (!byEvent) return []
    return byEvent.rows.map((row) => {
      const event_name = String(row['event_name'] ?? '')
      const completions = Number(row['completions'] ?? 0)
      const last_period = prevEventMap.get(event_name) ?? 0
      let change_pct: number | null = null
      if (completions === 0 && last_period === 0) {
        change_pct = null
      } else if (last_period === 0) {
        change_pct = null // can't compute from zero base
      } else {
        change_pct = ((completions - last_period) / last_period) * 100
      }
      return { event_name, completions, last_period, change_pct }
    })
  }, [byEvent, prevEventMap])

  // Sort
  const sortedRows = useMemo<EventRow[]>(() => {
    const copy = [...eventRows]
    copy.sort((a, b) => {
      let diff = 0
      switch (sortKey) {
        case 'event_name':
          diff = a.event_name.localeCompare(b.event_name)
          break
        case 'completions':
          diff = a.completions - b.completions
          break
        case 'last_period':
          diff = a.last_period - b.last_period
          break
        case 'change_pct':
          // nulls go last
          if (a.change_pct === null && b.change_pct === null) diff = 0
          else if (a.change_pct === null) diff = 1
          else if (b.change_pct === null) diff = -1
          else diff = a.change_pct - b.change_pct
          break
      }
      return sortDir === 'asc' ? diff : -diff
    })
    return copy
  }, [eventRows, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'event_name' ? 'asc' : 'desc')
    }
  }

  // Total KPI + delta
  const curTotalNum = typeof convTotal?.value === 'number' ? convTotal.value : null
  const prevTotalNum = typeof prevTotal?.value === 'number' ? prevTotal.value : null
  const totalDeltaPct =
    curTotalNum !== null && prevTotalNum !== null && prevTotalNum !== 0
      ? ((curTotalNum - prevTotalNum) / prevTotalNum) * 100
      : null

  const hasPrev = !!previousEnvelope

  // Pie chart data
  const channelData = useMemo(() => {
    if (!byChannel) return []
    const total = byChannel.rows.reduce((sum, r) => sum + Number(r['count'] ?? 0), 0)
    return byChannel.rows.map((row) => ({
      channel: String(row['channel'] ?? ''),
      count: Number(row['count'] ?? 0),
      total,
    }))
  }, [byChannel])

  // Empty state: no envelope or total=0 + no rows
  const isEmpty =
    !envelope ||
    (curTotalNum === 0 || curTotalNum === null) && eventRows.length === 0 && channelData.length === 0

  return (
    // PHASE2-TIPTAP: replace outer section with <TiptapSectionNode> custom extension
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {propertyName && (
            <p className="text-xs text-gray-400 mt-0.5">{propertyName}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:mt-0.5">
          {hasPrev && previousEnvelope && (
            <span className="text-xs text-blue-500 bg-blue-50 border border-blue-200 rounded px-2 py-1 whitespace-nowrap">
              vs {formatPeriod(previousEnvelope.periodStart, previousEnvelope.periodEnd)}
            </span>
          )}
          <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-1 whitespace-nowrap">
            {periodStart && periodEnd ? formatPeriod(periodStart, periodEnd) : 'No period set'}
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

      {/* Empty state */}
      {isEmpty ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">No key events fired in this period.</p>
          <p className="text-xs text-gray-400">
            Ensure GA4 key events (conversions) are configured and the integration has synced.
          </p>
        </div>
      ) : (
        /* Goals sub-card */
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">Goals</h3>

          {/* Two-column layout: table LEFT, summary+pie RIGHT */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* ─── LEFT: events table ─── */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {(
                      [
                        { key: 'event_name', label: 'Event' },
                        { key: 'completions', label: 'Completions' },
                        { key: 'last_period', label: 'Last Period' },
                        { key: 'change_pct', label: 'Change %' },
                      ] as { key: SortKey; label: string }[]
                    ).map(({ key, label }) => (
                      <th
                        key={key}
                        className={`pb-2 pr-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-gray-600 transition-colors ${key === 'event_name' ? '' : 'text-right'}`}
                        onClick={() => handleSort(key)}
                      >
                        <span className="inline-flex items-center">
                          {key !== 'event_name' && <span className="mr-1" />}
                          {label}
                          <SortChevron active={sortKey === key} dir={sortDir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-gray-300 text-xs">
                        No event data
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row, i) => (
                      <tr
                        key={row.event_name}
                        className={`border-b border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}
                      >
                        <td className="py-2.5 pr-3 text-gray-800 font-medium whitespace-nowrap">
                          {toTitleCase(row.event_name)}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-gray-800 tabular-nums font-semibold">
                          {row.completions.toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-gray-500 tabular-nums">
                          {row.last_period.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right">
                          <ChangePctCell pct={row.change_pct} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* ─── RIGHT: KPI + pie ─── */}
            <div className="flex flex-col items-center">
              {/* Total KPI */}
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                Goal Completions
              </p>
              <p className="text-5xl font-bold text-gray-900 tabular-nums leading-none mb-2">
                {curTotalNum !== null ? curTotalNum.toLocaleString() : '—'}
              </p>

              {/* Delta row */}
              {totalDeltaPct !== null ? (
                <div className={`flex items-center gap-1 text-sm font-semibold mb-0.5 ${totalDeltaPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  <span className="text-xs leading-none">
                    {totalDeltaPct >= 0 ? '▲' : '▼'}
                  </span>
                  <span>
                    {totalDeltaPct > 0 ? '+' : ''}{totalDeltaPct.toFixed(2)}%
                  </span>
                </div>
              ) : hasPrev ? (
                <div className="text-xs text-gray-300 font-medium mb-0.5">No prev data</div>
              ) : null}

              {hasPrev && (
                <p className="text-xs text-gray-400 mb-4">Since last period</p>
              )}

              {/* Pie chart */}
              {channelData.length > 0 ? (
                <div className="w-full">
                  <div className="flex items-center justify-center">
                    <div style={{ width: 180, height: 180, flexShrink: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={channelData}
                            dataKey="count"
                            nameKey="channel"
                            cx="50%"
                            cy="50%"
                            outerRadius={78}
                            innerRadius={0}
                            label={({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
                              if (value === 0 || midAngle == null) return null
                              const RADIAN = Math.PI / 180
                              const radius = (innerRadius ?? 0) + ((outerRadius ?? 0) - (innerRadius ?? 0)) * 0.55
                              const x = (cx ?? 0) + radius * Math.cos(-midAngle * RADIAN)
                              const y = (cy ?? 0) + radius * Math.sin(-midAngle * RADIAN)
                              return (
                                <text
                                  x={x}
                                  y={y}
                                  fill="white"
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize={12}
                                  fontWeight={600}
                                >
                                  {value.toLocaleString()}
                                </text>
                              )
                            }}
                            labelLine={false}
                          >
                            {channelData.map((_, index) => (
                              <Cell
                                key={index}
                                fill={SLICE_COLORS[index % SLICE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <PieLegend
                      entries={channelData.map((d, i) => ({
                        name: d.channel,
                        color: SLICE_COLORS[i % SLICE_COLORS.length],
                      }))}
                    />
                  </div>
                </div>
              ) : (
                <div className="w-full h-40 flex items-center justify-center text-gray-300 text-xs">
                  No channel breakdown available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
