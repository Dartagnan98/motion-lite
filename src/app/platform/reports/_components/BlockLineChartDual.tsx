'use client'

// Block: Dual-line chart (client component — Recharts requires the DOM)
//
// Renders a MetricSeries as a dual-line chart with configurable line keys.
// Used for the 30-day daily trend in Traffic Overview (users + sessions).
// More general than BlockLineChart, which hardcodes clicks/impressions.
//
// Sprint 2: Recharts. Phase 2: evaluate if Tiptap canvas blocks or a dedicated
// chart provider is preferred; Recharts stays until Phase 3 at minimum.
//
// PHASE2-TIPTAP: this is a plain client component. Phase 2 will wrap
// charts in Tiptap custom node extensions for the report builder editor.

import type { MetricSeries } from '@/lib/platform/adapter-contract'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface LineConfig {
  dataKey: string
  label: string
  color: string
}

interface BlockLineChartDualProps {
  title: string
  series: MetricSeries | null
  lineA: LineConfig
  /** Optional second line. When omitted, renders a single-line chart
   *  (used by HoursInvestedSection which has one series). */
  lineB?: LineConfig
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

export function BlockLineChartDual({ title, series, lineA, lineB }: BlockLineChartDualProps) {
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
    [lineA.dataKey]: Number(row[lineA.dataKey] ?? 0),
    ...(lineB ? { [lineB.dataKey]: Number(row[lineB.dataKey] ?? 0) } : {}),
  }))

  const ticks = tickEvery(chartData, 5).map((i) => chartData[i].date)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm font-medium text-gray-700 mb-4">{title}</p>
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
            yAxisId="left"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          {lineB && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
          )}
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
            labelFormatter={(label) => shortDate(label as string)}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="line" />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey={lineA.dataKey}
            stroke={lineA.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            name={lineA.label}
          />
          {lineB && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey={lineB.dataKey}
              stroke={lineB.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              name={lineB.label}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
