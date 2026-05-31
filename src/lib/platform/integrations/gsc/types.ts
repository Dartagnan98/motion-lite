// GSC adapter — provider-specific raw types.
//
// Reference: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
// API: https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query
//
// We ask the API for date-grouped rows over the requested period plus a top-N
// "queries" pull for the same period (no date dimension). Both pulls hit the
// same endpoint; we compose one RawSnapshot from the two responses.

/** Single row returned by searchAnalytics.query(). */
export interface GscApiRow {
  /** Comma-separated dimension values, in the order requested. */
  keys: string[]
  clicks: number
  impressions: number
  ctr: number          // 0..1
  position: number     // average position
}

/** Response envelope from a single searchAnalytics.query() call. */
export interface GscApiResponse {
  rows?: GscApiRow[]
  responseAggregationType?: string
}

/** Provider-shaped payload the adapter persists to platform_snapshots.raw_json. */
export interface GscRawSnapshot {
  siteUrl: string
  periodStart: string  // 'YYYY-MM-DD'
  periodEnd: string    // 'YYYY-MM-DD'
  /** Daily rows: one entry per day in the period, dimension=['date']. */
  daily: GscApiResponse
  /** Top queries for the period, dimension=['query'], rowLimit=25. */
  topQueries: GscApiResponse
  /** Top pages for the period, dimension=['page'], rowLimit=25. */
  topPages: GscApiResponse
  /** Stamped server-side at fetch time. */
  fetchedAt: string  // ISO datetime
}

/** GSC's `sites.list` shape — what we read during connect to populate
 *  config_json with the verified properties the user can pick from. */
export interface GscSite {
  siteUrl: string
  /** "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser" */
  permissionLevel: string
}

export interface GscSitesListResponse {
  siteEntry?: GscSite[]
}
