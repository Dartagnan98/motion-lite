// Block: KPI tile
//
// Renders a single MetricValue as a large-number KPI card.
// Matches the "KPI strip" row in the wireframe (4 tiles across: Clicks,
// Impressions, CTR, Avg Position).
//
// Sprint 3: accepts optional `delta` slot (a DeltaIndicator element) for
// period-over-period comparison. Caller computes the delta using computeDelta()
// from DeltaIndicator.tsx and passes the element in.

import type { MetricValue } from '@/lib/platform/adapter-contract'
import type { ReactNode } from 'react'

interface BlockKpiProps {
  title: string
  metric: MetricValue | null
  /** Optional delta indicator element rendered below the value. */
  delta?: ReactNode
}

export function formatKpiValue(metric: MetricValue): string {
  const { value, unit } = metric
  if (typeof value === 'string') return value
  if (unit === '%') return `${value.toLocaleString()}%`
  if (unit === 'rank') return `#${value.toFixed(1)}`
  if (unit === 'USD') return `$${value.toLocaleString()}`
  if (unit === 'ms') return `${value.toLocaleString()}ms`
  if (unit === 'hours') return `${value.toFixed(1)} hrs`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

export function BlockKpi({ title, metric, delta }: BlockKpiProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        {metric?.label || title}
      </span>
      {metric ? (
        <span className="text-2xl font-bold text-gray-900 tabular-nums">
          {formatKpiValue(metric)}
        </span>
      ) : (
        <span className="text-2xl font-bold text-gray-300">—</span>
      )}
      {delta && <div className="mt-0.5">{delta}</div>}
    </div>
  )
}
