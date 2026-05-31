'use client'

// Traffic Overview section — renders the GA4 normalized MetricEnvelope.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Section structure: header (property name + period) → 6-tile KPI strip →
//   30-day daily line chart (users + sessions) →
//   New vs Returning donut + Device Breakdown donut (side-by-side) →
//   Channels grouped bar chart (This Period vs Previous Period) →
//   Top Pages table + Top Sources table.
//
// Data contract consumed:
//   MetricEnvelope.metrics['traffic.users']                → MetricValue
//   MetricEnvelope.metrics['traffic.sessions']             → MetricValue
//   MetricEnvelope.metrics['traffic.page_views']           → MetricValue
//   MetricEnvelope.metrics['traffic.engagement_rate']      → MetricValue (unit: '%')
//   MetricEnvelope.metrics['traffic.bounce_rate']          → MetricValue (unit: '%')
//   MetricEnvelope.metrics['traffic.avg_session_duration'] → MetricValue (unit: 'count', seconds)
//   MetricEnvelope.metrics['traffic.daily']                → MetricSeries (date, users, sessions)
//   MetricEnvelope.metrics['traffic.new_vs_returning']     → MetricSeries { type, sessions }
//   MetricEnvelope.metrics['traffic.device_breakdown']     → MetricSeries { device, sessions }
//   MetricEnvelope.metrics['traffic.channels']             → MetricSeries { channel, sessions }
//   MetricEnvelope.metrics['traffic.top_pages']            → MetricSeries (path, page_views, users)
//   MetricEnvelope.metrics['traffic.top_sources']          → MetricSeries (source_medium, sessions, engagement_rate)

import { useMemo } from 'react'
import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockLineChartDual } from './BlockLineChartDual'
import { BlockTable } from './BlockTable'
import { DeltaIndicator } from './DeltaIndicator'
import { computeDelta } from './delta-utils'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ─── Color palette ────────────────────────────────────────────────────────────
// Donut slices: matches ConversionsSection palette (orange / purple / teal / indigo / amber / emerald)
const DONUT_COLORS = ['#f97316', '#8b5cf6', '#14b8a6', '#6366f1', '#f59e0b', '#10b981']
// Channels bar chart: indigo (This Period) + amber (Previous Period) — matches PDF blue+orange intent
const BAR_THIS = '#6366f1'
const BAR_PREV = '#f59e0b'

// ─── Prop shape ──────────────────────────────────────────────────────────────

interface TrafficOverviewSectionProps {
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

/** Format seconds as mm:ss. Input is a MetricValue with value in seconds. */
function formatDuration(seconds: number): string {
  const s = Math.round(Math.abs(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/** Label a new_vs_returning `type` value for display. */
function labelNvR(type: string): string {
  if (type === 'new') return 'New Visitors'
  if (type === 'returning') return 'Returning Visitors'
  return type // (not set) or anything else — leave as-is
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface PieLegendProps {
  entries: { name: string; color: string; pct: string }[]
}
function DonutLegend({ entries }: PieLegendProps) {
  return (
    <div className="flex flex-col gap-2 justify-center pl-4 min-w-[120px]">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: e.color }}
          />
          <span className="text-xs text-gray-600 leading-tight">
            {e.name}
            <span className="text-gray-400 ml-1">{e.pct}%</span>
          </span>
        </div>
      ))}
    </div>
  )
}

interface DonutTooltipProps {
  active?: boolean
  payload?: { name: string; value: number; payload: { pct: number } }[]
}
function DonutTooltip({ active, payload }: DonutTooltipProps) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-gray-800">{item.name}</p>
      <p className="text-gray-500">{item.value.toLocaleString()} sessions</p>
      <p className="text-gray-400">{item.payload.pct}%</p>
    </div>
  )
}

interface ChannelsTooltipProps {
  active?: boolean
  label?: string
  payload?: { name: string; value: number; color: string }[]
}
function ChannelsTooltip({ active, label, payload }: ChannelsTooltipProps) {
  if (!active || !payload?.length) return null
  const thisPeriod = payload.find((p) => p.name === 'This Period')
  const prevPeriod = payload.find((p) => p.name === 'Previous Period')
  const delta =
    thisPeriod && prevPeriod && prevPeriod.value !== 0
      ? thisPeriod.value - prevPeriod.value
      : null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-md min-w-[140px]">
      <p className="font-medium text-gray-800 mb-1">{label}</p>
      {thisPeriod && (
        <p style={{ color: BAR_THIS }}>This Period: {thisPeriod.value.toLocaleString()}</p>
      )}
      {prevPeriod && (
        <p style={{ color: BAR_PREV }}>Prev Period: {prevPeriod.value.toLocaleString()}</p>
      )}
      {delta !== null && (
        <p className={`font-medium mt-0.5 ${delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {delta >= 0 ? '+' : ''}{delta.toLocaleString()}
        </p>
      )}
    </div>
  )
}

interface DonutChartCardProps {
  title: string
  data: { name: string; value: number; pct: number }[]
  colors: string[]
}
function DonutChartCard({ title, data, colors }: DonutChartCardProps) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col">
        <p className="text-sm font-medium text-gray-700 mb-3">{title}</p>
        <div className="flex-1 flex items-center justify-center text-gray-300 text-xs min-h-[160px]">
          No data available
        </div>
      </div>
    )
  }

  const legendEntries = data.map((d, i) => ({
    name: d.name,
    color: colors[i % colors.length],
    pct: String(d.pct),
  }))

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm font-medium text-gray-700 mb-4">{title}</p>
      <div className="flex items-center justify-center">
        <div style={{ width: 180, height: 180, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                innerRadius={48}
                labelLine={false}
                label={({ cx, cy, midAngle, innerRadius, outerRadius, index }) => {
                  const entry = data[index]
                  if (!entry || entry.pct < 5) return null
                  const RADIAN = Math.PI / 180
                  const radius = (innerRadius ?? 0) + ((outerRadius ?? 0) - (innerRadius ?? 0)) * 0.55
                  const x = (cx ?? 0) + radius * Math.cos(-(midAngle ?? 0) * RADIAN)
                  const y = (cy ?? 0) + radius * Math.sin(-(midAngle ?? 0) * RADIAN)
                  return (
                    <text
                      x={x}
                      y={y}
                      fill="white"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={11}
                      fontWeight={600}
                    >
                      {entry.pct}%
                    </text>
                  )
                }}
              >
                {data.map((_, index) => (
                  <Cell key={index} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <DonutLegend entries={legendEntries} />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TrafficOverviewSection({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope,
  propertyName,
  periodStart,
  periodEnd,
}: TrafficOverviewSectionProps) {
  const metrics = envelope?.metrics ?? {}
  const prevMetrics = previousEnvelope?.metrics ?? {}

  // ── Scalar KPIs ──
  const users = isMetricValue(metrics['traffic.users']) ? metrics['traffic.users'] : null
  const sessions = isMetricValue(metrics['traffic.sessions']) ? metrics['traffic.sessions'] : null
  const pageViews = isMetricValue(metrics['traffic.page_views']) ? metrics['traffic.page_views'] : null
  const engagementRate = isMetricValue(metrics['traffic.engagement_rate']) ? metrics['traffic.engagement_rate'] : null
  const bounceRate = isMetricValue(metrics['traffic.bounce_rate']) ? metrics['traffic.bounce_rate'] : null
  const avgDuration = isMetricValue(metrics['traffic.avg_session_duration']) ? metrics['traffic.avg_session_duration'] : null

  const prevUsers = isMetricValue(prevMetrics['traffic.users']) ? prevMetrics['traffic.users'] : null
  const prevSessions = isMetricValue(prevMetrics['traffic.sessions']) ? prevMetrics['traffic.sessions'] : null
  const prevPageViews = isMetricValue(prevMetrics['traffic.page_views']) ? prevMetrics['traffic.page_views'] : null
  const prevEngRate = isMetricValue(prevMetrics['traffic.engagement_rate']) ? prevMetrics['traffic.engagement_rate'] : null
  const prevBounceRate = isMetricValue(prevMetrics['traffic.bounce_rate']) ? prevMetrics['traffic.bounce_rate'] : null
  const prevAvgDuration = isMetricValue(prevMetrics['traffic.avg_session_duration']) ? prevMetrics['traffic.avg_session_duration'] : null

  const hasPrev = !!previousEnvelope

  const dUsers = computeDelta(typeof users?.value === 'number' ? users.value : null, typeof prevUsers?.value === 'number' ? prevUsers.value : null)
  const dSessions = computeDelta(typeof sessions?.value === 'number' ? sessions.value : null, typeof prevSessions?.value === 'number' ? prevSessions.value : null)
  const dPageViews = computeDelta(typeof pageViews?.value === 'number' ? pageViews.value : null, typeof prevPageViews?.value === 'number' ? prevPageViews.value : null)
  const dEngRate = computeDelta(typeof engagementRate?.value === 'number' ? engagementRate.value : null, typeof prevEngRate?.value === 'number' ? prevEngRate.value : null)
  const dBounceRate = computeDelta(typeof bounceRate?.value === 'number' ? bounceRate.value : null, typeof prevBounceRate?.value === 'number' ? prevBounceRate.value : null)
  const dAvgDuration = computeDelta(typeof avgDuration?.value === 'number' ? avgDuration.value : null, typeof prevAvgDuration?.value === 'number' ? prevAvgDuration.value : null)

  // Avg session duration as formatted MetricValue for BlockKpi
  const avgDurationForKpi: MetricValue | null = avgDuration && typeof avgDuration.value === 'number'
    ? { value: formatDuration(avgDuration.value), label: avgDuration.label, unit: undefined }
    : null

  // ── Series data ──
  const daily = isMetricSeries(metrics['traffic.daily']) ? metrics['traffic.daily'] : null
  const topPages = isMetricSeries(metrics['traffic.top_pages']) ? metrics['traffic.top_pages'] : null
  const topSources = isMetricSeries(metrics['traffic.top_sources']) ? metrics['traffic.top_sources'] : null
  const newVsReturning = isMetricSeries(metrics['traffic.new_vs_returning']) ? metrics['traffic.new_vs_returning'] : null
  const deviceBreakdown = isMetricSeries(metrics['traffic.device_breakdown']) ? metrics['traffic.device_breakdown'] : null
  const channels = isMetricSeries(metrics['traffic.channels']) ? metrics['traffic.channels'] : null
  const prevChannels = isMetricSeries(prevMetrics['traffic.channels']) ? prevMetrics['traffic.channels'] : null

  // ── New vs Returning donut data ──
  const nvrData = useMemo(() => {
    if (!newVsReturning || newVsReturning.rows.length === 0) return []
    const total = newVsReturning.rows.reduce((sum, r) => sum + Number(r['sessions'] ?? 0), 0)
    if (total === 0) return []
    return newVsReturning.rows.map((row) => ({
      name: labelNvR(String(row['type'] ?? '')),
      value: Number(row['sessions'] ?? 0),
      pct: parseFloat(((Number(row['sessions'] ?? 0) / total) * 100).toFixed(1)),
    }))
  }, [newVsReturning])

  // ── Device Breakdown donut data ──
  const deviceData = useMemo(() => {
    if (!deviceBreakdown || deviceBreakdown.rows.length === 0) return []
    const total = deviceBreakdown.rows.reduce((sum, r) => sum + Number(r['sessions'] ?? 0), 0)
    if (total === 0) return []
    return deviceBreakdown.rows.map((row) => ({
      name: toTitleCase(String(row['device'] ?? '')),
      value: Number(row['sessions'] ?? 0),
      pct: parseFloat(((Number(row['sessions'] ?? 0) / total) * 100).toFixed(1)),
    }))
  }, [deviceBreakdown])

  // ── Channels grouped bar data (outer-join current + previous) ──
  const channelsChartData = useMemo(() => {
    const curMap = new Map<string, number>()
    const prevMap = new Map<string, number>()

    if (channels) {
      for (const row of channels.rows) {
        const ch = String(row['channel'] ?? '')
        if (ch) curMap.set(ch, Number(row['sessions'] ?? 0))
      }
    }
    if (prevChannels) {
      for (const row of prevChannels.rows) {
        const ch = String(row['channel'] ?? '')
        if (ch) prevMap.set(ch, Number(row['sessions'] ?? 0))
      }
    }

    // Merge channel names from both periods
    const allChannels = Array.from(new Set([...curMap.keys(), ...prevMap.keys()]))
    // Sort descending by current sessions so biggest bars are leftmost
    allChannels.sort((a, b) => (curMap.get(b) ?? 0) - (curMap.get(a) ?? 0))

    return allChannels.map((ch) => ({
      channel: ch,
      'This Period': curMap.get(ch) ?? 0,
      'Previous Period': prevMap.get(ch) ?? 0,
    }))
  }, [channels, prevChannels])

  const hasChannelData = channelsChartData.length > 0

  return (
    // PHASE2-TIPTAP: replace outer div with <TiptapSectionNode> custom extension
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

      {/* No snapshot state */}
      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No data synced yet. Connect Google Analytics 4 and run the first sync.
        </div>
      )}

      {/* KPI strip — 6 tiles (2-col on mobile, 3-col on sm, 6-col on desktop) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <BlockKpi
          title="Users"
          metric={users}
          delta={dUsers ? <DeltaIndicator pct={dUsers.pct} /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Sessions"
          metric={sessions}
          delta={dSessions ? <DeltaIndicator pct={dSessions.pct} /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Page Views"
          metric={pageViews}
          delta={dPageViews ? <DeltaIndicator pct={dPageViews.pct} /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Engagement Rate"
          metric={engagementRate}
          delta={dEngRate ? <DeltaIndicator pct={dEngRate.pct} /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Bounce Rate"
          metric={bounceRate}
          delta={dBounceRate ? <DeltaIndicator pct={dBounceRate.pct} lowerIsBetter /> : hasPrev ? <DeltaIndicator pct={null} /> : undefined}
        />
        <BlockKpi
          title="Avg Session Duration"
          metric={avgDurationForKpi}
          delta={dAvgDuration ? <DeltaIndicator pct={dAvgDuration.pct} /> : hasPrev && avgDuration ? <DeltaIndicator pct={null} /> : undefined}
        />
      </div>

      {/* 30-day daily line chart: users + sessions dual lines */}
      <div className="mb-5">
        <BlockLineChartDual
          title="Daily Users & Sessions"
          series={daily}
          lineA={{ dataKey: 'users', label: 'Users', color: '#6366f1' }}
          lineB={{ dataKey: 'sessions', label: 'Sessions', color: '#10b981' }}
        />
      </div>

      {/* New vs Returning + Device Breakdown donuts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <DonutChartCard title="New vs Returning" data={nvrData} colors={DONUT_COLORS} />
        <DonutChartCard title="Device Breakdown" data={deviceData} colors={[DONUT_COLORS[0], DONUT_COLORS[2], DONUT_COLORS[4]]} />
      </div>

      {/* Channels grouped bar chart */}
      {hasChannelData ? (
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-5">
          <p className="text-sm font-medium text-gray-700 mb-4">Channels</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={channelsChartData}
              margin={{ top: 4, right: 8, left: 0, bottom: 24 }}
              barCategoryGap="30%"
              barGap={3}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis
                dataKey="channel"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                interval={0}
                angle={channelsChartData.length > 4 ? -25 : 0}
                textAnchor={channelsChartData.length > 4 ? 'end' : 'middle'}
                height={channelsChartData.length > 4 ? 48 : 24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                width={36}
                allowDecimals={false}
              />
              <Tooltip content={<ChannelsTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingBottom: 4 }}
                iconType="square"
                verticalAlign="top"
                align="right"
              />
              <Bar dataKey="This Period" fill={BAR_THIS} radius={[3, 3, 0, 0]} maxBarSize={36} />
              <Bar dataKey="Previous Period" fill={BAR_PREV} radius={[3, 3, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-5">
          <p className="text-sm font-medium text-gray-700 mb-2">Channels</p>
          <p className="text-sm text-gray-400">No channel data available</p>
        </div>
      )}

      {/* Tables: side-by-side on wide screens, stacked on narrow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BlockTable title="Top Pages" series={topPages} limit={10} />
        <BlockTable title="Top Sources" series={topSources} limit={10} />
      </div>
    </section>
  )
}
