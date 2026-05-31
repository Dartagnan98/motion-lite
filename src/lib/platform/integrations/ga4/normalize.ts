// GA4 normalize — provider raw → canonical metric envelope.
//
// Slug namespace this adapter publishes (under metric_slug):
//   traffic.users                → MetricValue (totalUsers for period)
//   traffic.sessions             → MetricValue (sessions for period)
//   traffic.page_views           → MetricValue (screenPageViews for period)
//   traffic.engagement_rate      → MetricValue (%, engagementRate period average)
//   traffic.bounce_rate          → MetricValue (%, bounceRate period average)
//   traffic.daily                → MetricSeries (date, users, sessions)
//   traffic.top_pages            → MetricSeries (pagePath, screenPageViews)
//   traffic.top_sources          → MetricSeries (sessionSourceMedium, sessions)
//   traffic.device_breakdown     → MetricSeries (device, sessions; sorted desc)
//   traffic.new_vs_returning     → MetricSeries (type, sessions)
//   traffic.channels             → MetricSeries (channel, sessions; sorted desc)
//   traffic.avg_session_duration → MetricValue (count; seconds, rounded; section formats as mm:ss)
//   ga4.conversions_total        → MetricValue (count; total key events in period)
//   ga4.conversions_by_event     → MetricSeries (event_name, completions; sorted desc)
//   ga4.conversions_by_channel   → MetricSeries (channel, count; sorted desc)
//
// Renderer maps these slugs to chart/table/KPI blocks.
//
// Schema drift strategy: throw immediately when a required field is absent or
// mistyped. The error surfaces in health() as red:schema_drift. Do NOT silently
// default to 0 for fields the API stopped sending — wrong numbers are worse
// than visible errors.

import type { MetricEnvelope, MetricSeries, MetricValue } from '../../adapter-contract'
import type { GA4ReportResponse, GA4RawSnapshot } from './types'

export interface GA4Normalized extends MetricEnvelope {
  provider: 'ga4'
  metrics: {
    'traffic.users': MetricValue
    'traffic.sessions': MetricValue
    'traffic.page_views': MetricValue
    'traffic.engagement_rate': MetricValue
    'traffic.bounce_rate': MetricValue
    'traffic.daily': MetricSeries
    'traffic.top_pages': MetricSeries
    'traffic.top_sources': MetricSeries
    /** Sessions by device category (desktop / mobile / tablet / ...). Sorted desc by sessions. */
    'traffic.device_breakdown': MetricSeries
    /** Sessions split by visitor type (new / returning / (not set)). */
    'traffic.new_vs_returning': MetricSeries
    /** Sessions by default channel group (Direct, Organic Search, ...). Sorted desc. */
    'traffic.channels': MetricSeries
    /** Average session duration in whole seconds. Section renders as mm:ss. */
    'traffic.avg_session_duration': MetricValue
    'ga4.conversions_total': MetricValue
    'ga4.conversions_by_event': MetricSeries
    'ga4.conversions_by_channel': MetricSeries
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Extract a named metric value from a GA4 report row by metricHeader name.
 *  Throws on schema drift (header not found, value missing). */
function extractMetric(resp: GA4ReportResponse, rowIndex: number, metricName: string): number {
  const headers = resp.metricHeaders
  if (!headers) {
    throw new Error(`ga4.normalize: metricHeaders absent in response (schema drift)`)
  }
  const idx = headers.findIndex((h) => h.name === metricName)
  if (idx === -1) {
    throw new Error(
      `ga4.normalize: metric "${metricName}" not found in metricHeaders: ${JSON.stringify(headers.map((h) => h.name))}`
    )
  }
  const row = resp.rows?.[rowIndex]
  if (!row) {
    // Empty result set — return 0 for totals (valid for zero-traffic period).
    return 0
  }
  const mv = row.metricValues?.[idx]
  if (!mv || typeof mv.value !== 'string') {
    throw new Error(`ga4.normalize: metricValues[${idx}] missing for metric "${metricName}"`)
  }
  return parseFloat(mv.value)
}

/** Extract a named dimension value from a GA4 report row by dimensionHeader name. */
function extractDimension(resp: GA4ReportResponse, rowIndex: number, dimName: string): string {
  const headers = resp.dimensionHeaders
  if (!headers) {
    throw new Error(`ga4.normalize: dimensionHeaders absent in response (schema drift)`)
  }
  const idx = headers.findIndex((h) => h.name === dimName)
  if (idx === -1) {
    throw new Error(
      `ga4.normalize: dimension "${dimName}" not found in dimensionHeaders: ${JSON.stringify(headers.map((h) => h.name))}`
    )
  }
  const row = resp.rows?.[rowIndex]
  if (!row) return ''
  const dv = row.dimensionValues?.[idx]
  if (!dv || typeof dv.value !== 'string') {
    throw new Error(`ga4.normalize: dimensionValues[${idx}] missing for dimension "${dimName}"`)
  }
  return dv.value
}

/** Validate that the summary response has the expected single-row structure.
 *  Throws on schema drift. */
function assertSummaryShape(resp: GA4ReportResponse): void {
  if (!resp.metricHeaders || resp.metricHeaders.length === 0) {
    throw new Error('ga4.normalize: summary response missing metricHeaders (schema drift)')
  }
  // Zero rows is valid — a property with no traffic in the period.
  if (resp.rows && resp.rows.length > 1) {
    throw new Error(
      `ga4.normalize: summary response has ${resp.rows.length} rows; expected 0 or 1 (no dimension should have been requested)`
    )
  }
}

/** Validate that the daily response has the date dimension. */
function assertDailyShape(resp: GA4ReportResponse): void {
  if (!resp.rows) return  // empty is valid
  for (let i = 0; i < resp.rows.length; i++) {
    const row = resp.rows[i]
    if (!row.dimensionValues || row.dimensionValues.length === 0) {
      throw new Error(`ga4.normalize: daily row ${i} missing dimensionValues (schema drift)`)
    }
    if (!row.metricValues || row.metricValues.length < 2) {
      throw new Error(`ga4.normalize: daily row ${i} has < 2 metricValues (schema drift)`)
    }
  }
}

// ─── Sampling detection ───────────────────────────────────────────────

function detectSampling(resp: GA4ReportResponse): string | null {
  if (resp.samplingMetadatas && resp.samplingMetadatas.length > 0) {
    const s = resp.samplingMetadatas[0]
    if (s.samplesReadCount && s.samplingSpaceSize) {
      const pct = (parseInt(s.samplesReadCount) / parseInt(s.samplingSpaceSize)) * 100
      if (pct < 100) {
        return `GA4 data sampled at ${pct.toFixed(1)}% confidence (high-traffic property)`
      }
    }
  }
  return null
}

// ─── Main normalizer ─────────────────────────────────────────────────

export function normalize(raw: GA4RawSnapshot): GA4Normalized {
  assertSummaryShape(raw.summary)
  assertDailyShape(raw.daily)

  // Period totals from summary call.
  const totalUsers = extractMetric(raw.summary, 0, 'totalUsers')
  const sessions = extractMetric(raw.summary, 0, 'sessions')
  const screenPageViews = extractMetric(raw.summary, 0, 'screenPageViews')
  const engagementRate = extractMetric(raw.summary, 0, 'engagementRate')
  const bounceRate = extractMetric(raw.summary, 0, 'bounceRate')

  // Daily series. GA4 returns dates as 'YYYYMMDD' — reformat to 'YYYY-MM-DD'
  // so consumers can pass them to `new Date()` without Invalid Date.
  const dailyRows = (raw.daily.rows || []).map((_, i) => {
    const ymd = extractDimension(raw.daily, i, 'date')
    const isoDate = /^\d{8}$/.test(ymd)
      ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
      : ymd
    return {
      date: isoDate,
      users: extractMetric(raw.daily, i, 'totalUsers'),
      sessions: extractMetric(raw.daily, i, 'sessions'),
    }
  })

  // Top pages series.
  const topPagesRows = (raw.topPages.rows || []).map((_, i) => ({
    page: extractDimension(raw.topPages, i, 'pagePath'),
    page_views: extractMetric(raw.topPages, i, 'screenPageViews'),
    sessions: extractMetric(raw.topPages, i, 'sessions'),
  }))

  // Top sources series.
  const topSourcesRows = (raw.topSources.rows || []).map((_, i) => ({
    source_medium: extractDimension(raw.topSources, i, 'sessionSourceMedium'),
    sessions: extractMetric(raw.topSources, i, 'sessions'),
    users: extractMetric(raw.topSources, i, 'totalUsers'),
  }))

  // Conversions total — single metric, no dimensions, 0 or 1 row.
  // Empty rows means no key events configured for this property in the period:
  // emit 0 rather than throwing. This is not schema drift; it's valid GA4 state.
  const metricName = raw.keyEventsMetricName ?? 'keyEvents'
  let conversionsTotal = 0
  if (raw.conversionsTotal.rows && raw.conversionsTotal.rows.length > 0) {
    // Use extractMetric which handles the positional lookup by header name.
    conversionsTotal = extractMetric(raw.conversionsTotal, 0, metricName)
  }

  // Conversions by event name — filter rows where keyEvents = 0.
  const conversionsByEventRows = (raw.conversionsByEvent.rows || [])
    .map((_, i) => ({
      event_name: extractDimension(raw.conversionsByEvent, i, 'eventName'),
      completions: extractMetric(raw.conversionsByEvent, i, metricName),
    }))
    .filter((r) => r.completions > 0)
  // Already ordered desc by keyEvents from the API; filtering preserves order.

  // Conversions by channel — filter zero rows.
  const conversionsByChannelRows = (raw.conversionsByChannel.rows || [])
    .map((_, i) => ({
      channel: extractDimension(raw.conversionsByChannel, i, 'sessionDefaultChannelGroup'),
      count: extractMetric(raw.conversionsByChannel, i, metricName),
    }))
    .filter((r) => r.count > 0)

  // Device breakdown — filter zero-session rows (GA4 can emit empty buckets).
  const deviceBreakdownRows = (raw.deviceBreakdown.rows || [])
    .map((_, i) => ({
      device: extractDimension(raw.deviceBreakdown, i, 'deviceCategory'),
      sessions: extractMetric(raw.deviceBreakdown, i, 'sessions'),
    }))
    .filter((r) => r.sessions > 0)

  // New vs returning — pass type value through as-is; GA4 returns 'new', 'returning',
  // '(not set)'. Filter zero-session rows.
  const newVsReturningRows = (raw.newVsReturning.rows || [])
    .map((_, i) => ({
      type: extractDimension(raw.newVsReturning, i, 'newVsReturning'),
      sessions: extractMetric(raw.newVsReturning, i, 'sessions'),
    }))
    .filter((r) => r.sessions > 0)

  // Channels by sessions — filter zero-session rows.
  const channelsRows = (raw.channelsSessions.rows || [])
    .map((_, i) => ({
      channel: extractDimension(raw.channelsSessions, i, 'sessionDefaultChannelGroup'),
      sessions: extractMetric(raw.channelsSessions, i, 'sessions'),
    }))
    .filter((r) => r.sessions > 0)

  // Average session duration — single metric value, no dimensions.
  // GA4 returns a float in seconds; round to nearest whole second.
  // Empty rows (no sessions in period) → emit 0.
  let avgSessionDurationSeconds = 0
  if (raw.avgSessionDuration.rows && raw.avgSessionDuration.rows.length > 0) {
    avgSessionDurationSeconds = extractMetric(raw.avgSessionDuration, 0, 'averageSessionDuration')
  }

  // Collect warnings.
  const warnings: string[] = []
  const dailySampleWarn = detectSampling(raw.daily)
  if (dailySampleWarn) warnings.push(dailySampleWarn)
  const summSampleWarn = detectSampling(raw.summary)
  if (summSampleWarn) warnings.push(summSampleWarn)

  return {
    provider: 'ga4',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    normalizedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
    metrics: {
      'traffic.users': {
        value: Math.round(totalUsers),
        label: 'Total Users',
        unit: 'count',
      },
      'traffic.sessions': {
        value: Math.round(sessions),
        label: 'Sessions',
        unit: 'count',
      },
      'traffic.page_views': {
        value: Math.round(screenPageViews),
        label: 'Page Views',
        unit: 'count',
      },
      'traffic.engagement_rate': {
        value: Number((engagementRate * 100).toFixed(2)),
        label: 'Engagement Rate',
        unit: '%',
      },
      'traffic.bounce_rate': {
        value: Number((bounceRate * 100).toFixed(2)),
        label: 'Bounce Rate',
        unit: '%',
      },
      'traffic.daily': {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'users', label: 'Users', type: 'number' },
          { key: 'sessions', label: 'Sessions', type: 'number' },
        ],
        rows: dailyRows,
      },
      'traffic.top_pages': {
        columns: [
          { key: 'page', label: 'Page', type: 'string' },
          { key: 'page_views', label: 'Page Views', type: 'number' },
          { key: 'sessions', label: 'Sessions', type: 'number' },
        ],
        rows: topPagesRows,
      },
      'traffic.top_sources': {
        columns: [
          { key: 'source_medium', label: 'Source / Medium', type: 'string' },
          { key: 'sessions', label: 'Sessions', type: 'number' },
          { key: 'users', label: 'Users', type: 'number' },
        ],
        rows: topSourcesRows,
      },
      'traffic.device_breakdown': {
        columns: [
          { key: 'device', label: 'Device', type: 'string' },
          { key: 'sessions', label: 'Sessions', type: 'number' },
        ],
        rows: deviceBreakdownRows,
      },
      'traffic.new_vs_returning': {
        columns: [
          { key: 'type', label: 'Visitor Type', type: 'string' },
          { key: 'sessions', label: 'Sessions', type: 'number' },
        ],
        rows: newVsReturningRows,
      },
      'traffic.channels': {
        columns: [
          { key: 'channel', label: 'Channel', type: 'string' },
          { key: 'sessions', label: 'Sessions', type: 'number' },
        ],
        rows: channelsRows,
      },
      'traffic.avg_session_duration': {
        value: Math.round(avgSessionDurationSeconds),
        label: 'Avg. Session Duration',
        unit: 'count',
      },
      'ga4.conversions_total': {
        value: Math.round(conversionsTotal),
        label: 'Total Conversions',
        unit: 'count',
      },
      'ga4.conversions_by_event': {
        columns: [
          { key: 'event_name', label: 'Event', type: 'string' },
          { key: 'completions', label: 'Completions', type: 'number' },
        ],
        rows: conversionsByEventRows,
      },
      'ga4.conversions_by_channel': {
        columns: [
          { key: 'channel', label: 'Channel', type: 'string' },
          { key: 'count', label: 'Conversions', type: 'number' },
        ],
        rows: conversionsByChannelRows,
      },
    },
  }
}
