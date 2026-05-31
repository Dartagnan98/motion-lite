// GA4 adapter — provider-specific raw types.
//
// Reference: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
// API: POST https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport
//
// We issue eleven calls per fetchSnapshot:
//   1. summary (all metrics, no dimensions) — period totals
//   2. daily (date dimension) — 30-day time series
//   3. top pages (pagePath dimension) — top 25 by screenPageViews
//   4. top sources (sessionSourceMedium dimension) — top 25 by sessions
//   5. conversions total (keyEvents metric, no dimensions) — single count
//   6. conversions by event name (eventName dimension + keyEvents metric)
//   7. conversions by channel (sessionDefaultChannelGroup dimension + keyEvents metric)
//   8. device breakdown (deviceCategory dimension) — sessions by device
//   9. new vs returning (newVsReturning dimension) — sessions by visitor type
//  10. channels (sessionDefaultChannelGroup dimension) — sessions by channel
//  11. avg session duration (averageSessionDuration metric, no dimensions) — single value
//
// The GA4 Data API wraps every response in the same envelope regardless of
// which dimension set you request. We keep one generic response type.

/** A single dimension header from a GA4 report response. */
export interface GA4DimensionHeader {
  name: string
}

/** A single metric header from a GA4 report response. */
export interface GA4MetricHeader {
  name: string
  /** 'TYPE_INTEGER' | 'TYPE_FLOAT' | 'TYPE_SECONDS' | 'TYPE_MILLISECONDS' | 'TYPE_MINUTES' | 'TYPE_HOURS' | 'TYPE_STANDARD' | 'TYPE_CURRENCY' | 'TYPE_FEET' | 'TYPE_MILES' | 'TYPE_METERS' | 'TYPE_KILOMETERS' | 'TYPE_PERCENT' */
  type: string
}

/** A single row in a GA4 report. dimensionValues and metricValues align
 *  positionally with dimensionHeaders and metricHeaders respectively. */
export interface GA4Row {
  /** One entry per requested dimension. Order matches dimensionHeaders. */
  dimensionValues: Array<{ value: string }>
  /** One entry per requested metric. Order matches metricHeaders. */
  metricValues: Array<{ value: string }>
}

/** Response envelope from a single properties.runReport call. */
export interface GA4ReportResponse {
  dimensionHeaders?: GA4DimensionHeader[]
  metricHeaders?: GA4MetricHeader[]
  rows?: GA4Row[]
  /** Not present when zero rows. */
  rowCount?: number
  /** Minimized schema metadata — not needed for normalization. */
  metadata?: {
    currencyCode?: string
    timeZone?: string
  }
  /** Present when the query triggered response-level sampling. */
  samplingMetadatas?: Array<{
    samplesReadCount?: string
    samplingSpaceSize?: string
  }>
}

/** Account Summary from Analytics Admin API.
 *  GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries */
export interface GA4PropertySummary {
  property: string    // e.g. "properties/123456789"
  displayName: string
  propertyType: 'PROPERTY_TYPE_ORDINARY' | 'PROPERTY_TYPE_SUBPROPERTY' | 'PROPERTY_TYPE_ROLLUP'
}

export interface GA4AccountSummary {
  name: string        // e.g. "accountSummaries/1234567"
  displayName: string
  account: string     // e.g. "accounts/1234567"
  propertySummaries?: GA4PropertySummary[]
}

export interface GA4AccountSummariesResponse {
  accountSummaries?: GA4AccountSummary[]
  nextPageToken?: string
}

/** Composite raw snapshot assembled from multiple runReport calls.
 *  This is what fetchSnapshot returns and what persists to raw_json. */
export interface GA4RawSnapshot {
  propertyId: string     // e.g. '123456789' (without 'properties/' prefix)
  periodStart: string    // 'YYYY-MM-DD'
  periodEnd: string      // 'YYYY-MM-DD'
  /** Period totals: totalUsers, sessions, screenPageViews, engagementRate, bounceRate.
   *  No dimension; single-row response. */
  summary: GA4ReportResponse
  /** Daily time series: date dimension, totalUsers + sessions metrics. */
  daily: GA4ReportResponse
  /** Top 25 pages by screenPageViews: pagePath dimension. */
  topPages: GA4ReportResponse
  /** Top 25 session source/medium by sessions: sessionSourceMedium dimension. */
  topSources: GA4ReportResponse
  /** Conversions total: keyEvents (or fallback: conversions) metric, no dimension.
   *  Single-row response. May be empty rows (0 key events configured). */
  conversionsTotal: GA4ReportResponse
  /** Conversions by event name: eventName dimension + keyEvents metric.
   *  Ordered desc by keyEvents. Zero-keyEvents rows stripped at normalize time. */
  conversionsByEvent: GA4ReportResponse
  /** Conversions by channel group: sessionDefaultChannelGroup dimension + keyEvents metric.
   *  Ordered desc by keyEvents. Zero-keyEvents rows stripped at normalize time. */
  conversionsByChannel: GA4ReportResponse
  /** Which metric name was actually used for key-event queries: 'keyEvents' or 'conversions'.
   *  Logged at fetch time; used by normalize to extract the right header. */
  keyEventsMetricName: 'keyEvents' | 'conversions'
  /** Device category breakdown: deviceCategory dimension, sessions metric.
   *  Ordered desc by sessions. Zero-session rows stripped at normalize time. */
  deviceBreakdown: GA4ReportResponse
  /** New vs returning visitor breakdown: newVsReturning dimension, sessions metric. */
  newVsReturning: GA4ReportResponse
  /** Sessions by default channel group: sessionDefaultChannelGroup dimension, sessions metric.
   *  Ordered desc by sessions. Zero-session rows stripped at normalize time. */
  channelsSessions: GA4ReportResponse
  /** Average session duration in seconds: averageSessionDuration metric, no dimensions.
   *  Single-row response. Empty rows means no sessions in period (emit 0). */
  avgSessionDuration: GA4ReportResponse
  /** Stamped server-side at fetch time. */
  fetchedAt: string      // ISO datetime
}
