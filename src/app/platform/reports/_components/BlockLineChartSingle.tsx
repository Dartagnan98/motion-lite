'use client'

// Block: Single-line configurable chart with optional y-axis inversion.
//
// Used by RankMovementSection (avg position trend, y-axis inverted so "going up"
// means improving rank) and FormConversionsSection (daily entries).
//
// PHASE2-TIPTAP: plain client component. Phase 2 wraps charts in Tiptap
// custom node extensions for the report builder editor.

import type { MetricSeries } from '@/lib/platform/adapter-contract'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

interface LineConfig {
  dataKey: string
  label: string
  color: string
}

interface BlockLineChartSingleProps {
  title: string
  series: MetricSeries | null
  line: LineConfig
  /** When true, reverses the y-axis so lower values appear at the top (rank charts).
   *  Lower rank number = better position, so chart visually climbs when ranking improves. */
  invertY?: boolean
  /** Optional horizontal reference line (e.g. top-10 threshold at y=10). */
  referenceLine?: { y: number; label: string }
  /** Optional subtitle shown below the chart title. */
  subtitle?: string
}

function shortDate(dateStr: string | number | null): string {
  if (!dateStr) return ''
  const s = String(dateStr)
  // Bare 'YYYY-MM-DD' strings are parsed as UTC midnight by `new Date()`,
  // which then formats one day earlier in any timezone west of UTC. Append
  // 'T00:00:00' to force local-midnight parsing.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function tickEvery(data: unknown[], n: number): number[] {
  if (data.length === 0) return []
  const ticks = data.map((_, i) => i).filter((i) => i % n === 0)
  // Ensure the final data point is always labeled — otherwise the visible
  // x-axis appears to end ~n-1 days before the actual period_end.
  const lastIdx = data.length - 1
  if (ticks[ticks.length - 1] !== lastIdx) ticks.push(lastIdx)
  return ticks
}

export function BlockLineChartSingle({
  title,
  series,
  line,
  invertY = false,
  referenceLine,
  subtitle,
}: BlockLineChartSingleProps) {
  if (!series || series.rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-700 mb-3">{title}</p>
        <div className="h-52 flex items-center justify-center text-gray-300 text-sm">
          No data available
        </div>
      </div>
    )
  }

  const dateCol = series.columns.find((c) => c.type === 'date')?.key ?? 'date'

  const chartData = series.rows.map((row) => ({
    date: String(row[dateCol] ?? ''),
    [line.dataKey]: Number(row[line.dataKey] ?? 0),
  }))

  const ticks = tickEvery(chartData, 5).map((i) => chartData[i].date)

  // For inverted y-axis (rank charts), compute domain with some padding.
  const values = chartData
    .map((d) => d[line.dataKey] as number)
    .filter((v) => typeof v === 'number' && !isNaN(v) && v > 0)
  const yMin = values.length ? Math.min(...values) : 0
  const yMax = values.length ? Math.max(...values) : 100
  const padding = Math.max(1, (yMax - yMin) * 0.1)
  const yDomain: [number, number] | ['auto', 'auto'] = invertY
    ? [Math.ceil(yMax + padding), Math.max(0, Math.floor(yMin - padding))]
    : ['auto', 'auto']

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm font-medium text-gray-700 mb-1">{title}</p>
      {subtitle && (
        <p className="text-xs text-gray-400 mb-3">{subtitle}</p>
      )}
      {!subtitle && invertY && (
        <p className="text-xs text-gray-400 mb-3">Lower position number = better ranking</p>
      )}
      {!subtitle && !invertY && <div className="mb-4" />}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            ticks={ticks}
            tickFormatter={shortDate}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            reversed={invertY}
            domain={yDomain}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={invertY ? (v: number) => `#${v.toFixed(0)}` : undefined}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
            labelFormatter={(label) => shortDate(label as string)}
            formatter={(value) => [
              invertY ? `#${Number(value).toFixed(1)}` : (value as string | number),
              line.label,
            ]}
          />
          {referenceLine && (
            <ReferenceLine
              y={referenceLine.y}
              stroke="#94a3b8"
              strokeDasharray="4 2"
              label={{ value: referenceLine.label, fontSize: 10, fill: '#94a3b8', position: 'right' }}
            />
          )}
          <Line
            type="monotone"
            dataKey={line.dataKey}
            stroke={line.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            name={line.label}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
