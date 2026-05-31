'use client'

// Block: Line chart (client component — Recharts requires the DOM)
//
// Renders a MetricSeries as a dual-line chart (clicks + impressions by date).
// Used for the 30-day daily trend in the Search Performance section.
//
// Sprint 2: Recharts. Phase 2: evaluate if Tiptap canvas blocks or a dedicated
// chart provider is preferred; Recharts stays until Phase 3 at minimum.
//
// Tiptap divergence note: this is a plain client component. Phase 2 will wrap
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

interface BlockLineChartProps {
  title: string
  series: MetricSeries | null
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

function tickEvery(data: unknown[], n: number) {
  // Return an array of indices to show labels on (every nth tick)
  return data
    .map((_, i) => i)
    .filter((i) => i % n === 0)
}

export function BlockLineChart({ title, series }: BlockLineChartProps) {
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

  const chartData = series.rows.map((row) => ({
    date: String(row['date'] ?? ''),
    clicks: Number(row['clicks'] ?? 0),
    impressions: Number(row['impressions'] ?? 0),
  }))

  // Show a label every ~5 days so the axis is readable over 30 days.
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
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            }}
            labelFormatter={(label) => shortDate(label as string)}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            iconType="line"
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="clicks"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            name="Clicks"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="impressions"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            name="Impressions"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
