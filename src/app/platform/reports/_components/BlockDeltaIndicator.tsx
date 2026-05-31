// BlockDeltaIndicator — renders a rank-movement delta arrow with color coding.
//
// Used by RankMovementSection's keywords table.
// delta > 0 = rank improved (e.g. went from 22 → 18, delta = +4) — green ▲
// delta < 0 = rank declined — red ▼
// delta === 0 or null — gray dash

interface BlockDeltaIndicatorProps {
  delta: number | null | undefined
}

export function BlockDeltaIndicator({ delta }: BlockDeltaIndicatorProps) {
  if (delta === null || delta === undefined) {
    return <span className="text-gray-300 text-xs">—</span>
  }

  if (delta === 0) {
    return <span className="text-gray-300 text-xs font-medium">—</span>
  }

  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 2L10.5 9H1.5L6 2Z" />
        </svg>
        {delta}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-500">
      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 10L1.5 3H10.5L6 10Z" />
      </svg>
      {Math.abs(delta)}
    </span>
  )
}
