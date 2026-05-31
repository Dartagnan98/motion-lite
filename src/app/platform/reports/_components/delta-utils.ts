// Pure delta math — NO 'use client' directive so server components (the report
// section components) can import and call it during server render. The visual
// <DeltaIndicator> component lives in DeltaIndicator.tsx ('use client'); this
// file holds only the framework-agnostic computation.
//
// Why split: a function exported from a 'use client' module cannot be invoked
// on the server — React treats it as a client reference. computeDelta is called
// inside server-rendered section components, so it must live in a plain module.

/** Compute percent + absolute delta from two MetricValue-style values.
 *  Returns null if either value isn't a number or previous is zero. */
export function computeDelta(
  current: number | string | undefined | null,
  previous: number | string | undefined | null,
): { pct: number; abs: number } | null {
  if (typeof current !== 'number' || typeof previous !== 'number') return null
  if (previous === 0) return null
  const abs = current - previous
  const pct = (abs / Math.abs(previous)) * 100
  return { pct, abs }
}
