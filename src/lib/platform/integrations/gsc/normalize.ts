// GSC normalize — provider raw → canonical metric envelope.
//
// Slug namespace this adapter publishes (under metric_slug):
//   search_performance.clicks         → MetricValue (sum over period)
//   search_performance.impressions    → MetricValue (sum)
//   search_performance.ctr            → MetricValue (period CTR, %)
//   search_performance.position       → MetricValue (avg position)
//   search_performance.daily          → MetricSeries (date, clicks, impressions, ctr, position)
//   search_performance.top_queries    → MetricSeries (query, clicks, impressions, ctr, position)
//   search_performance.top_pages      → MetricSeries (page, clicks, impressions, ctr, position)
//
// Renderer maps these slugs to chart/table/KPI blocks.

import type { MetricEnvelope, MetricSeries, MetricValue } from '../../adapter-contract'
import type { GscApiResponse, GscRawSnapshot } from './types'

export interface GscNormalized extends MetricEnvelope {
  provider: 'gsc'
  metrics: {
    'search_performance.clicks': MetricValue
    'search_performance.impressions': MetricValue
    'search_performance.ctr': MetricValue
    'search_performance.position': MetricValue
    'search_performance.daily': MetricSeries
    'search_performance.top_queries': MetricSeries
    'search_performance.top_pages': MetricSeries
  }
}

/** Sum a numeric field across rows. Returns 0 on empty. */
function sumField(resp: GscApiResponse, field: 'clicks' | 'impressions'): number {
  if (!resp.rows || resp.rows.length === 0) return 0
  return resp.rows.reduce((acc, r) => acc + (r[field] ?? 0), 0)
}

/** Average a numeric field across rows weighted equally (GSC averages position
 *  per row already; we re-average across the period for the headline). */
function avgField(resp: GscApiResponse, field: 'position' | 'ctr'): number {
  if (!resp.rows || resp.rows.length === 0) return 0
  const total = resp.rows.reduce((acc, r) => acc + (r[field] ?? 0), 0)
  return total / resp.rows.length
}

/** Validate the daily response has the dimension we asked for. Throws on drift. */
function assertDailyShape(resp: GscApiResponse): void {
  if (!resp.rows) return  // empty is valid (low-traffic site)
  for (const row of resp.rows) {
    if (!Array.isArray(row.keys) || row.keys.length !== 1) {
      throw new Error(
        `gsc.normalize: daily response row malformed — expected keys=[date], got ${JSON.stringify(row.keys)}`
      )
    }
    if (typeof row.clicks !== 'number' || typeof row.impressions !== 'number') {
      throw new Error('gsc.normalize: daily row missing clicks/impressions')
    }
  }
}

export function normalize(raw: GscRawSnapshot): GscNormalized {
  assertDailyShape(raw.daily)

  const clicks = sumField(raw.daily, 'clicks')
  const impressions = sumField(raw.daily, 'impressions')
  // CTR for the period = total clicks / total impressions (NOT row average).
  const periodCtr = impressions > 0 ? clicks / impressions : 0
  const avgPosition = avgField(raw.daily, 'position')

  const dailyRows = (raw.daily.rows || []).map((r) => ({
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }))

  const topQueries = (raw.topQueries.rows || []).map((r) => ({
    query: r.keys[0] || '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }))

  const topPages = (raw.topPages.rows || []).map((r) => ({
    page: r.keys[0] || '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }))

  return {
    provider: 'gsc',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    normalizedAt: new Date().toISOString(),
    metrics: {
      'search_performance.clicks': {
        value: clicks,
        label: 'Clicks',
        unit: 'count',
      },
      'search_performance.impressions': {
        value: impressions,
        label: 'Impressions',
        unit: 'count',
      },
      'search_performance.ctr': {
        value: Number((periodCtr * 100).toFixed(2)),
        label: 'CTR',
        unit: '%',
      },
      'search_performance.position': {
        value: Number(avgPosition.toFixed(2)),
        label: 'Avg Position',
        unit: 'rank',
      },
      'search_performance.daily': {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'clicks', label: 'Clicks', type: 'number' },
          { key: 'impressions', label: 'Impressions', type: 'number' },
          { key: 'ctr', label: 'CTR', type: 'percent' },
          { key: 'position', label: 'Position', type: 'number' },
        ],
        rows: dailyRows,
      },
      'search_performance.top_queries': {
        columns: [
          { key: 'query', label: 'Query', type: 'string' },
          { key: 'clicks', label: 'Clicks', type: 'number' },
          { key: 'impressions', label: 'Impressions', type: 'number' },
          { key: 'ctr', label: 'CTR', type: 'percent' },
          { key: 'position', label: 'Position', type: 'number' },
        ],
        rows: topQueries,
      },
      'search_performance.top_pages': {
        columns: [
          { key: 'page', label: 'Page', type: 'string' },
          { key: 'clicks', label: 'Clicks', type: 'number' },
          { key: 'impressions', label: 'Impressions', type: 'number' },
          { key: 'ctr', label: 'CTR', type: 'percent' },
          { key: 'position', label: 'Position', type: 'number' },
        ],
        rows: topPages,
      },
    },
  }
}
