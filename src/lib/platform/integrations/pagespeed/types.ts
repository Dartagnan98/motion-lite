// PageSpeed adapter — provider-specific raw types.
//
// Reference: https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed
// API: GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed
//        ?url=<url>&strategy=mobile|desktop&category=performance&category=accessibility
//        &category=seo&category=best-practices&key=<api_key>
//
// Slice B (2026-05-27): adapter now fetches BOTH mobile + desktop in parallel.
// PageSpeedRawSnapshot carries both results. normalize() emits suffix slugs
// (e.g. pagespeed.performance_mobile, pagespeed.performance_desktop) so both
// strategies live in a single snapshot row.

/** A Lighthouse category score (0..1, multiply by 100 for display). */
export interface PageSpeedCategory {
  id: string
  title: string
  /** 0..1 numeric score. Null if the category could not be scored. */
  score: number | null
  description?: string
}

/** A Lighthouse audit numeric value. */
export interface PageSpeedAudit {
  id: string
  title: string
  description?: string
  /** 0..1 score, null if not applicable. */
  score: number | null
  /** Numeric value for metric audits (e.g. LCP in ms). Not present on non-metric audits. */
  numericValue?: number
  /** Unit for the numeric value ('millisecond', 'byte', 'unitless', etc.) */
  numericUnit?: string
  displayValue?: string
}

/** The Lighthouse result block inside a PageSpeed response. */
export interface PageSpeedLighthouseResult {
  requestedUrl?: string
  finalUrl?: string
  lighthouseVersion?: string
  /** Audit strategy: 'MOBILE' | 'DESKTOP' */
  configSettings?: {
    formFactor?: string
    emulatedFormFactor?: string
    locale?: string
  }
  fetchTime?: string
  /** Map of category id → category object. */
  categories: {
    performance?: PageSpeedCategory
    accessibility?: PageSpeedCategory
    seo?: PageSpeedCategory
    'best-practices'?: PageSpeedCategory
  }
  /** Map of audit id → audit object. We care about a subset. */
  audits: {
    'largest-contentful-paint'?: PageSpeedAudit
    'cumulative-layout-shift'?: PageSpeedAudit
    /** INP — available in Lighthouse 10+ as experimental-interaction-to-next-paint.
     *  Falls back to interaction-to-next-paint (non-experimental key) if present.
     *  Will be absent on older Lighthouse versions; normalize() treats as soft drift. */
    'experimental-interaction-to-next-paint'?: PageSpeedAudit
    'interaction-to-next-paint'?: PageSpeedAudit
    'server-response-time'?: PageSpeedAudit
    [key: string]: PageSpeedAudit | undefined
  }
}

/** Full response from a single pagespeedonline/v5/runPagespeed call. */
export interface PageSpeedApiResponse {
  kind?: string
  id?: string
  loadingExperience?: Record<string, unknown>
  originLoadingExperience?: Record<string, unknown>
  lighthouseResult: PageSpeedLighthouseResult
  analysisUTCTimestamp?: string
}

/** Raw snapshot stored to platform_snapshots.raw_json.
 *
 *  Slice B (2026-05-27): both mobile and desktop results are stored together.
 *  One fetchSnapshot call → two PageSpeed API calls → one raw snapshot row.
 *
 *  `strategyResult` is kept for backward compat on old single-strategy rows
 *  (pre-Slice B). New code always uses `mobile` + `desktop`. If `mobile` or
 *  `desktop` is absent the strategy call failed (partial fetch — see adapter). */
export interface PageSpeedRawSnapshot {
  /** Target URL that was audited. */
  url: string
  /** ISO datetime when the fetch ran. */
  fetchedAt: string
  /** Mobile strategy API response. Null if the mobile call failed (partial fetch). */
  mobile: PageSpeedApiResponse | null
  /** Desktop strategy API response. Null if the desktop call failed (partial fetch). */
  desktop: PageSpeedApiResponse | null
  /** Warnings from partial fetch (e.g. one strategy errored). */
  fetchWarnings?: string[]

  // ── Backward compat: old single-strategy raw rows had these fields. ──
  // normalize() ignores them — the suffix-slug output shape is always dual-strategy.
  /** @deprecated use `mobile` or `desktop` */
  strategy?: 'mobile' | 'desktop'
  /** @deprecated use `mobile` or `desktop` */
  result?: PageSpeedApiResponse
}
