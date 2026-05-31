// SE Ranking normalize — raw snapshot → canonical metric envelope.
//
// Slug namespace this adapter publishes (under metric_slug):
//   rank.average_position  → MetricValue (unit: 'rank') — avg rank across tracked keywords
//   rank.keywords_top10    → MetricValue (unit: 'count') — keywords ranking in top 10
//   rank.keywords_top3     → MetricValue (unit: 'count') — keywords ranking in top 3
//   rank.movement_daily    → MetricSeries — daily avg_position over period
//   rank.keywords          → MetricSeries — top 50 tracked keywords with rank + delta
//
// Schema drift strategy: throw on missing required fields. Do not silently zero-fill.
// Exception: history may be an empty array if SE Ranking has no data for the period —
// that is not schema drift, just an empty series. We surface a warning instead.
//
// Delta convention: positive = improvement (rank moved up; lower number is better).
//   delta = previous_rank - current_rank
//   If current_rank = 5, previous_rank = 8 → delta = +3 (moved up 3 spots)
//   If current_rank = 10, previous_rank = 7 → delta = -3 (moved down 3 spots)
//
// Rank value 0 or null from SE Ranking means "not in top 100". We represent this
// as position 101 for aggregation purposes and exclude from average calculations.

import type { MetricEnvelope, MetricSeries, MetricValue } from '../../adapter-contract'
import type { SeRankingRawSnapshot, SeRankingKeywordPosition, SeRankingPositionRow } from './types'

export interface SeRankingNormalized extends MetricEnvelope {
  provider: 'se_ranking'
  metrics: {
    'rank.average_position': MetricValue
    'rank.keywords_top10': MetricValue
    'rank.keywords_top3': MetricValue
    'rank.movement_daily': MetricSeries
    'rank.keywords': MetricSeries
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert SE Ranking's 0/null position sentinel to 101 (meaning "not ranking"). */
function normalizePosition(pos: number | null | undefined): number {
  if (pos === null || pos === undefined || pos === 0) return 101
  return pos
}

/** Latest dated entry in a keyword's positions array. */
function latestPositionRow(rows: SeRankingPositionRow[]): SeRankingPositionRow | null {
  if (!rows || rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))
  return sorted[0]
}

/** Read the current rank from a keyword. SE Ranking returns rank as `pos`
 *  inside the `positions` array (most-recent date wins). */
function currentRank(p: SeRankingKeywordPosition): number {
  const latest = latestPositionRow(p.positions ?? [])
  return latest ? normalizePosition(latest.pos) : 101
}

/** Compute the previous rank from a keyword. If the positions array has at
 *  least 2 entries, the second-latest is the previous rank. Otherwise fall back
 *  to `current + change` (SE Ranking's `change` field is positive when rank
 *  improved, so previous = current + change). */
function previousRank(p: SeRankingKeywordPosition): number {
  const rows = p.positions ?? []
  if (rows.length >= 2) {
    const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date))
    return normalizePosition(sorted[1].pos)
  }
  const latest = latestPositionRow(rows)
  if (latest && typeof latest.change === 'number' && latest.pos > 0) {
    return normalizePosition(latest.pos + latest.change)
  }
  return 101
}

/** Sort keywords by current_rank ascending (best rank first), then by keyword alpha for ties. */
function sortKeywords(a: SeRankingKeywordPosition, b: SeRankingKeywordPosition): number {
  const posA = currentRank(a)
  const posB = currentRank(b)
  if (posA !== posB) return posA - posB
  return (a.name ?? '').localeCompare(b.name ?? '')
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

export function normalize(raw: SeRankingRawSnapshot): SeRankingNormalized {
  // Required top-level field validation.
  if (typeof raw.projectId !== 'number') {
    throw new Error('se_ranking.normalize: raw.projectId missing or not a number (schema drift)')
  }
  if (!raw.periodStart || !raw.periodEnd) {
    throw new Error('se_ranking.normalize: raw.periodStart or periodEnd missing (schema drift)')
  }
  if (!Array.isArray(raw.positions)) {
    throw new Error('se_ranking.normalize: raw.positions is not an array (schema drift)')
  }
  if (!Array.isArray(raw.history)) {
    throw new Error('se_ranking.normalize: raw.history is not an array (schema drift)')
  }

  // Validate each position row.
  for (let i = 0; i < raw.positions.length; i++) {
    const p = raw.positions[i]
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new Error(`se_ranking.normalize: positions[${i}] missing keyword name (schema drift)`)
    }
  }

  const warnings: string[] = []

  // ─── Aggregate metrics ────────────────────────────────────────────────────

  // Compute the current rank for every keyword (101 = not ranking in top 100).
  const ranks = raw.positions.map((p) => currentRank(p))
  const rankingOnly = ranks.filter((r) => r < 101)

  // Average position (only over keywords that are ranking).
  let averagePosition = 0
  if (rankingOnly.length > 0) {
    const sum = rankingOnly.reduce((acc, r) => acc + r, 0)
    averagePosition = Math.round((sum / rankingOnly.length) * 10) / 10
  } else if (raw.positions.length > 0) {
    warnings.push('se_ranking.normalize: no keywords are currently ranking in top 100 — SE Ranking may not have completed its first check yet')
  }

  // Top 10 and top 3 counts.
  const keywordsTop10 = rankingOnly.filter((r) => r <= 10).length
  const keywordsTop3 = rankingOnly.filter((r) => r <= 3).length

  // ─── Daily history series ─────────────────────────────────────────────────

  if (raw.history.length === 0) {
    warnings.push('se_ranking.normalize: no history data returned for the period — SE Ranking may not have checked yet')
  }

  for (let i = 0; i < raw.history.length; i++) {
    const h = raw.history[i]
    if (typeof h.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) {
      throw new Error(
        `se_ranking.normalize: history[${i}] date "${h.date}" is not YYYY-MM-DD (schema drift)`
      )
    }
    if (typeof h.avg_position !== 'number') {
      throw new Error(
        `se_ranking.normalize: history[${i}] avg_position is not a number (schema drift)`
      )
    }
  }

  const movementDailyRows = raw.history
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => ({
      date: h.date,
      avg_position: Math.round(h.avg_position * 10) / 10,
    }))

  // ─── Top 50 keywords series ───────────────────────────────────────────────

  const sortedKeywords = raw.positions.slice().sort(sortKeywords).slice(0, 50)

  const keywordRows = sortedKeywords.map((p) => {
    const curr = currentRank(p)
    const prev = previousRank(p)
    // delta = previous - current: positive means rank improved (lower number)
    const delta = curr >= 101 || prev >= 101
      ? 0  // can't compute meaningful delta if either rank is "not ranking"
      : prev - curr

    return {
      keyword: p.name,
      current_rank: curr >= 101 ? null : curr,
      previous_rank: prev >= 101 ? null : prev,
      delta,
    }
  })

  return {
    provider: 'se_ranking',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    normalizedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
    metrics: {
      'rank.average_position': {
        value: averagePosition,
        label: 'Average Position',
        unit: 'rank',
      },
      'rank.keywords_top10': {
        value: keywordsTop10,
        label: 'Keywords in Top 10',
        unit: 'count',
      },
      'rank.keywords_top3': {
        value: keywordsTop3,
        label: 'Keywords in Top 3',
        unit: 'count',
      },
      'rank.movement_daily': {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'avg_position', label: 'Avg Position', type: 'number' },
        ],
        rows: movementDailyRows,
      },
      'rank.keywords': {
        columns: [
          { key: 'keyword', label: 'Keyword', type: 'string' },
          { key: 'current_rank', label: 'Current Rank', type: 'number' },
          { key: 'previous_rank', label: 'Previous Rank', type: 'number' },
          { key: 'delta', label: 'Delta', type: 'number' },
        ],
        rows: keywordRows,
      },
    },
  }
}
