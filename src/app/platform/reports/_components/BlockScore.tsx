// Block: Score tile (Lighthouse-style 0–100 score)
//
// Renders a numeric 0-100 score with Lighthouse color thresholds:
//   0-49  → red  (poor)
//   50-89 → amber (needs improvement)
//   90-100 → green (good)
//
// Used for the 4-score grid in SiteHealthSection (Performance, Accessibility,
// SEO, Best Practices).
//
// Sprint 2: plain RSC. No animation. Phase 3: animated radial gauge via
// requestAnimationFrame if the design review calls for it.

import type { MetricValue } from '@/lib/platform/adapter-contract'

interface BlockScoreProps {
  title: string
  metric: MetricValue | null
}

type ScoreLevel = 'good' | 'needs-improvement' | 'poor'

function scoreLevel(value: number): ScoreLevel {
  if (value >= 90) return 'good'
  if (value >= 50) return 'needs-improvement'
  return 'poor'
}

const LEVEL_COLORS: Record<ScoreLevel, {
  text: string
  ring: string
  bg: string
  badge: string
  badgeBg: string
}> = {
  good: {
    text: 'text-green-600',
    ring: 'border-green-400',
    bg: 'bg-green-50',
    badge: 'text-green-700',
    badgeBg: 'bg-green-100',
  },
  'needs-improvement': {
    text: 'text-amber-600',
    ring: 'border-amber-400',
    bg: 'bg-amber-50',
    badge: 'text-amber-700',
    badgeBg: 'bg-amber-100',
  },
  poor: {
    text: 'text-red-600',
    ring: 'border-red-400',
    bg: 'bg-red-50',
    badge: 'text-red-700',
    badgeBg: 'bg-red-100',
  },
}

const LEVEL_LABELS: Record<ScoreLevel, string> = {
  good: 'Good',
  'needs-improvement': 'Needs Work',
  poor: 'Poor',
}

export function BlockScore({ title, metric }: BlockScoreProps) {
  if (!metric) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col items-center gap-3">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide text-center">
          {title}
        </span>
        <div className="w-16 h-16 rounded-full border-4 border-gray-200 flex items-center justify-center">
          <span className="text-xl font-bold text-gray-200">—</span>
        </div>
      </div>
    )
  }

  const numValue = typeof metric.value === 'number' ? metric.value : Number(metric.value)
  const level = scoreLevel(numValue)
  const colors = LEVEL_COLORS[level]

  return (
    <div className={`rounded-lg border p-5 flex flex-col items-center gap-3 ${colors.bg} ${colors.ring} border-2`}>
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide text-center">
        {metric.label || title}
      </span>
      {/* Score circle */}
      <div className={`w-16 h-16 rounded-full border-4 ${colors.ring} flex items-center justify-center bg-white`}>
        <span className={`text-xl font-bold tabular-nums ${colors.text}`}>
          {Math.round(numValue)}
        </span>
      </div>
      {/* Level badge */}
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors.badgeBg} ${colors.badge}`}>
        {LEVEL_LABELS[level]}
      </span>
    </div>
  )
}
