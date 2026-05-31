'use client'

// Block: Bar chart (client component — Recharts requires the DOM)
//
// Renders a MetricSeries as a bar chart with a single configurable bar key.
// Used for daily task completion counts in the Tasks Completed section.
//
// Sprint 2: Recharts. Mirrors BlockLineChartDual structure for consistency.
//
// PHASE2-TIPTAP: plain client component. Phase 2 wraps in Tiptap custom node
// extensions for the report builder editor.

import type { MetricSeries } from '@/lib/platform/adapter-contract'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface BarConfig {
  dataKey: string
  label: string
  color: string
}

interface BlockBarChartProps {
  title: string
  series: MetricSeries | null
  bar: BarConfig
}

function shortDate(dateStr: string | number | null): string {
  if (!dateStr) return ''
  const s = String(dateStr)
  // Bare 'YYYY-MM-DD' → parse as local midnight (not UTC) so western-hemisphere
  // timezones don't shift the label one day earlier.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function tickEvery(data: unknown[], n: number): number[] {
  return data.map((_, i) => i).filter((i) => i % n === 0)
}

export function BlockBarChart({ title, series, bar }: BlockBarChartProps) {
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
    [bar.dataKey]: Number(row[bar.dataKey] ?? 0),
  }))

  const ticks = tickEvery(chartData, 5).map((i) => chartData[i].date)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-sm font-medium text-gray-700 mb-4">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={ticks}
            tickFormatter={shortDate}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
            labelFormatter={(label) => shortDate(label as string)}
            formatter={(value) => [value ?? 0, bar.label]}
          />
          <Bar
            dataKey={bar.dataKey}
            fill={bar.color}
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
            name={bar.label}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
