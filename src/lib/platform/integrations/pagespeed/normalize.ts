// PageSpeed normalize — provider raw → canonical metric envelope.
//
// Slice B (2026-05-27): emits suffix slugs for both mobile + desktop strategies
// in a single MetricEnvelope. Old plain slugs (site_health.performance_score, etc.)
// are no longer emitted — frontend-eng rewrites the consumer to suffix-only.
// Legacy pre-Slice-B snapshots stay in the DB but will not render in the new chart.
//
// Slug namespace this adapter publishes (under metric_slug):
//   pagespeed.performance_mobile        → MetricValue (0-100, unit: 'count')
//   pagespeed.performance_desktop       → MetricValue (0-100, unit: 'count')
//   pagespeed.accessibility_mobile      → MetricValue (0-100, unit: 'count')
//   pagespeed.accessibility_desktop     → MetricValue (0-100, unit: 'count')
//   pagespeed.seo_mobile                → MetricValue (0-100, unit: 'count')
//   pagespeed.seo_desktop               → MetricValue (0-100, unit: 'count')
//   pagespeed.best_practices_mobile     → MetricValue (0-100, unit: 'count')
//   pagespeed.best_practices_desktop    → MetricValue (0-100, unit: 'count')
//   pagespeed.lcp_mobile                → MetricValue (ms, unit: 'ms')
//   pagespeed.lcp_desktop               → MetricValue (ms, unit: 'ms')
//   pagespeed.cls_mobile                → MetricValue (unitless float, unit: 'count')
//   pagespeed.cls_desktop               → MetricValue (unitless float, unit: 'count')
//   pagespeed.inp_mobile                → MetricValue (ms, unit: 'ms') — INP; absent if unavailable
//   pagespeed.inp_desktop               → MetricValue (ms, unit: 'ms') — INP; absent if unavailable
//   pagespeed.ttfb_mobile               → MetricValue (ms, unit: 'ms') — server-response-time
//   pagespeed.ttfb_desktop              → MetricValue (ms, unit: 'ms') — server-response-time
//
// CLS scale: stored as raw float (0.0–~1.0), NOT multiplied. Unit: 'count'
// (unitless — Lighthouse treats it as a score, not a time).
//
// INP: pulled from experimental-interaction-to-next-paint first (Lighthouse 10+),
// then interaction-to-next-paint as fallback. If absent from both: soft drift —
// the slug is omitted from metrics entirely (renderer treats missing slug as N/A)
// and a warning is appended. Do NOT emit 0 for absent INP.
//
// Schema drift strategy: if a category score or required audit numericValue is
// absent on a strategy that DID return a result, throw immediately. Do not
// silently return 0 — a PageSpeed API response missing `categories.performance`
// is a schema change, not a zero score. One exception: server-response-time is
// soft drift (absent on redirect chains — documented gotcha). INP is also soft
// drift (Lighthouse version-gated).

import type { MetricEnvelope, MetricValue } from '../../adapter-contract'
import type { PageSpeedApiResponse, PageSpeedRawSnapshot } from './types'

export interface PageSpeedNormalized extends MetricEnvelope {
  provider: 'pagespeed'
  // The index signature must satisfy MetricEnvelope.metrics (Record<string, MetricValue | MetricSeries>).
  // Named keys below are all optional — when a strategy fails partially, those slugs are absent.
  metrics: Record<string, MetricValue> & {
    'pagespeed.performance_mobile'?: MetricValue
    'pagespeed.performance_desktop'?: MetricValue
    'pagespeed.accessibility_mobile'?: MetricValue
    'pagespeed.accessibility_desktop'?: MetricValue
    'pagespeed.seo_mobile'?: MetricValue
    'pagespeed.seo_desktop'?: MetricValue
    'pagespeed.best_practices_mobile'?: MetricValue
    'pagespeed.best_practices_desktop'?: MetricValue
    'pagespeed.lcp_mobile'?: MetricValue
    'pagespeed.lcp_desktop'?: MetricValue
    'pagespeed.cls_mobile'?: MetricValue
    'pagespeed.cls_desktop'?: MetricValue
    'pagespeed.inp_mobile'?: MetricValue
    'pagespeed.inp_desktop'?: MetricValue
    'pagespeed.ttfb_mobile'?: MetricValue
    'pagespeed.ttfb_desktop'?: MetricValue
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract a Lighthouse category score as 0-100 integer.
 *  Throws on schema drift (missing category or null score on a non-optional field). */
function extractCategoryScore(
  result: PageSpeedApiResponse,
  categoryKey: 'performance' | 'accessibility' | 'seo' | 'best-practices',
  strategy: 'mobile' | 'desktop',
): number {
  const cat = result.lighthouseResult?.categories?.[categoryKey]
  if (!cat) {
    throw new Error(
      `pagespeed.normalize: Lighthouse category "${categoryKey}" missing from ${strategy} response (schema drift)`
    )
  }
  if (cat.score === null || cat.score === undefined) {
    throw new Error(
      `pagespeed.normalize: Lighthouse category "${categoryKey}" has null score on ${strategy} (unscored audit — check URL is accessible)`
    )
  }
  // Lighthouse scores are 0..1; multiply by 100 and round.
  return Math.round(cat.score * 100)
}

/** Extract a Lighthouse audit's numericValue in milliseconds.
 *  Returns null + warning string if the audit is missing (soft drift).
 *  Throws if the audit is present but numericValue is absent (hard drift). */
function extractAuditMs(
  result: PageSpeedApiResponse,
  auditKey: string,
  strategy: 'mobile' | 'desktop',
): { value: number | null; warning: string | null } {
  const audit = result.lighthouseResult?.audits?.[auditKey]
  if (!audit) {
    return {
      value: null,
      warning: `pagespeed.normalize: audit "${auditKey}" absent from ${strategy} response (metric unavailable)`,
    }
  }
  if (audit.numericValue === undefined || audit.numericValue === null) {
    throw new Error(
      `pagespeed.normalize: audit "${auditKey}" present but numericValue missing on ${strategy} (schema drift)`
    )
  }
  return { value: audit.numericValue, warning: null }
}

/** Extract INP: tries experimental-interaction-to-next-paint first, then
 *  interaction-to-next-paint. Returns null + warning if neither is present
 *  (soft drift — Lighthouse version-gated). */
function extractInp(
  result: PageSpeedApiResponse,
  strategy: 'mobile' | 'desktop',
): { value: number | null; warning: string | null } {
  // Lighthouse 10+ key (preferred).
  const expInp = result.lighthouseResult?.audits?.['experimental-interaction-to-next-paint']
  if (expInp) {
    if (expInp.numericValue === undefined || expInp.numericValue === null) {
      throw new Error(
        `pagespeed.normalize: audit "experimental-interaction-to-next-paint" present but numericValue missing on ${strategy} (schema drift)`
      )
    }
    return { value: expInp.numericValue, warning: null }
  }
  // Non-experimental fallback.
  const stableInp = result.lighthouseResult?.audits?.['interaction-to-next-paint']
  if (stableInp) {
    if (stableInp.numericValue === undefined || stableInp.numericValue === null) {
      throw new Error(
        `pagespeed.normalize: audit "interaction-to-next-paint" present but numericValue missing on ${strategy} (schema drift)`
      )
    }
    return { value: stableInp.numericValue, warning: null }
  }
  return {
    value: null,
    warning: `pagespeed.normalize: INP audit absent from ${strategy} response (Lighthouse < 10 or metric unavailable)`,
  }
}

// ─── Per-strategy extraction ──────────────────────────────────────────────────

interface StrategyMetrics {
  performance: number
  accessibility: number
  seo: number
  bestPractices: number
  lcp: number | null
  cls: number | null
  inp: number | null
  ttfb: number | null
}

/** Extract all metrics for a single strategy result.
 *  Throws on hard schema drift; returns nulls + appends warnings for soft drift. */
function extractStrategyMetrics(
  result: PageSpeedApiResponse,
  strategy: 'mobile' | 'desktop',
  warnings: string[],
): StrategyMetrics {
  if (!result.lighthouseResult) {
    throw new Error(
      `pagespeed.normalize: lighthouseResult missing from ${strategy} response (schema drift)`
    )
  }

  const performance = extractCategoryScore(result, 'performance', strategy)
  const accessibility = extractCategoryScore(result, 'accessibility', strategy)
  const seo = extractCategoryScore(result, 'seo', strategy)
  const bestPractices = extractCategoryScore(result, 'best-practices', strategy)

  const lcpResult = extractAuditMs(result, 'largest-contentful-paint', strategy)
  const clsResult = extractAuditMs(result, 'cumulative-layout-shift', strategy)
  const inpResult = extractInp(result, strategy)
  const ttfbResult = extractAuditMs(result, 'server-response-time', strategy)

  if (lcpResult.warning) warnings.push(lcpResult.warning)
  if (clsResult.warning) warnings.push(clsResult.warning)
  if (inpResult.warning) warnings.push(inpResult.warning)
  if (ttfbResult.warning) warnings.push(ttfbResult.warning)

  return {
    performance,
    accessibility,
    seo,
    bestPractices,
    lcp: lcpResult.value !== null ? Math.round(lcpResult.value) : null,
    // CLS: stored as raw float to 4 decimal places (0.0–~1.0, not multiplied).
    cls: clsResult.value !== null ? Number(clsResult.value.toFixed(4)) : null,
    inp: inpResult.value !== null ? Math.round(inpResult.value) : null,
    ttfb: ttfbResult.value !== null ? Math.round(ttfbResult.value) : null,
  }
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

export function normalize(raw: PageSpeedRawSnapshot): PageSpeedNormalized {
  if (!raw.mobile && !raw.desktop) {
    throw new Error('pagespeed.normalize: both mobile and desktop results are null — cannot normalize')
  }

  const warnings: string[] = []
  const metrics: Record<string, MetricValue> = {}

  // Mobile strategy
  if (raw.mobile) {
    const m = extractStrategyMetrics(raw.mobile, 'mobile', warnings)

    metrics['pagespeed.performance_mobile'] = { value: m.performance, label: 'Performance (Mobile)', unit: 'count' }
    metrics['pagespeed.accessibility_mobile'] = { value: m.accessibility, label: 'Accessibility (Mobile)', unit: 'count' }
    metrics['pagespeed.seo_mobile'] = { value: m.seo, label: 'SEO (Mobile)', unit: 'count' }
    metrics['pagespeed.best_practices_mobile'] = { value: m.bestPractices, label: 'Best Practices (Mobile)', unit: 'count' }
    if (m.lcp !== null) {
      metrics['pagespeed.lcp_mobile'] = { value: m.lcp, label: 'LCP (Mobile)', unit: 'ms' }
    }
    if (m.cls !== null) {
      metrics['pagespeed.cls_mobile'] = { value: m.cls, label: 'CLS (Mobile)', unit: 'count' }
    }
    if (m.inp !== null) {
      metrics['pagespeed.inp_mobile'] = { value: m.inp, label: 'INP (Mobile)', unit: 'ms' }
    }
    if (m.ttfb !== null) {
      metrics['pagespeed.ttfb_mobile'] = { value: m.ttfb, label: 'TTFB (Mobile)', unit: 'ms' }
    }
  } else {
    warnings.push('pagespeed.normalize: mobile strategy result unavailable (partial fetch)')
  }

  // Desktop strategy
  if (raw.desktop) {
    const d = extractStrategyMetrics(raw.desktop, 'desktop', warnings)

    metrics['pagespeed.performance_desktop'] = { value: d.performance, label: 'Performance (Desktop)', unit: 'count' }
    metrics['pagespeed.accessibility_desktop'] = { value: d.accessibility, label: 'Accessibility (Desktop)', unit: 'count' }
    metrics['pagespeed.seo_desktop'] = { value: d.seo, label: 'SEO (Desktop)', unit: 'count' }
    metrics['pagespeed.best_practices_desktop'] = { value: d.bestPractices, label: 'Best Practices (Desktop)', unit: 'count' }
    if (d.lcp !== null) {
      metrics['pagespeed.lcp_desktop'] = { value: d.lcp, label: 'LCP (Desktop)', unit: 'ms' }
    }
    if (d.cls !== null) {
      metrics['pagespeed.cls_desktop'] = { value: d.cls, label: 'CLS (Desktop)', unit: 'count' }
    }
    if (d.inp !== null) {
      metrics['pagespeed.inp_desktop'] = { value: d.inp, label: 'INP (Desktop)', unit: 'ms' }
    }
    if (d.ttfb !== null) {
      metrics['pagespeed.ttfb_desktop'] = { value: d.ttfb, label: 'TTFB (Desktop)', unit: 'ms' }
    }
  } else {
    warnings.push('pagespeed.normalize: desktop strategy result unavailable (partial fetch)')
  }

  // Propagate any fetch-level warnings from the adapter.
  if (raw.fetchWarnings) {
    for (const w of raw.fetchWarnings) warnings.push(w)
  }

  // period_start = period_end = today (UTC) — each refetch is a new dated point
  // on the time-series chart. The refetch route does NOT override this for pagespeed.
  const today = new Date().toISOString().slice(0, 10)

  return {
    provider: 'pagespeed',
    periodStart: today,
    periodEnd: today,
    normalizedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
    metrics,
  }
}
