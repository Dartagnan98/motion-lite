// DeltaIndicator — shared KPI tile delta indicator for period-over-period comparison.
//
// Shows below a KPI value on each tile. Color logic:
//   delta > 0, lowerIsBetter=false → green up-arrow  (improvement)
//   delta > 0, lowerIsBetter=true  → red up-arrow    (worse)
//   delta < 0, lowerIsBetter=false → red down-arrow  (decline)
//   delta < 0, lowerIsBetter=true  → green down-arrow (improvement)
//   delta = 0 or no prev data      → gray dash
//
// Used by all 9 section components' KPI tiles. For rank metrics (avg position,
// LCP, CLS, TBT, TTFB) pass lowerIsBetter={true} to invert color logic.

'use client'

interface DeltaIndicatorProps {
  /** Percent change: ((current - previous) / previous) * 100. Pass null if no prev data. */
  pct: number | null | undefined
  /** Absolute delta to show alongside the percent (optional). */
  abs?: number | null
  /** Invert color logic: for metrics where lower=better (rank, LCP, etc.). */
  lowerIsBetter?: boolean
  /** Format override for the displayed value (e.g. show absolute instead of percent). */
  format?: 'pct' | 'abs'
  /** Unit suffix shown after abs value (e.g. 'pts', 'hrs'). */
  unit?: string
}

function UpArrow() {
  return (
    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 2L10.5 9H1.5L6 2Z" />
    </svg>
  )
}

function DownArrow() {
  return (
    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 10L1.5 3H10.5L6 10Z" />
    </svg>
  )
}

export function DeltaIndicator({
  pct,
  abs,
  lowerIsBetter = false,
  format = 'pct',
  unit = '',
}: DeltaIndicatorProps) {
  if (pct === null || pct === undefined || !isFinite(pct)) {
    return (
      <span className="text-xs text-gray-300 font-medium">No prev data</span>
    )
  }

  if (Math.abs(pct) < 0.05) {
    // Less than 0.05% change — treat as flat.
    return (
      <span className="text-xs text-gray-400 font-medium">
        <span className="mr-0.5">—</span>
        <span className="text-gray-300 font-normal">vs prev</span>
      </span>
    )
  }

  const improved = lowerIsBetter ? pct < 0 : pct > 0
  const colorClass = improved ? 'text-emerald-600' : 'text-red-500'

  const displayValue = format === 'abs' && abs !== null && abs !== undefined
    ? `${abs > 0 ? '+' : ''}${abs.toLocaleString()}${unit ? ' ' + unit : ''}`
    : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${colorClass}`}>
      {pct > 0 ? <UpArrow /> : <DownArrow />}
      {displayValue}
      <span className="text-gray-300 font-normal ml-0.5">vs prev</span>
    </span>
  )
}

// computeDelta moved to ./delta-utils (plain module) so server components can
// call it — a function exported from this 'use client' file can't run on the
// server. Re-exported here for any existing client-side importers.
export { computeDelta } from './delta-utils'
