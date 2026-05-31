'use client'

// Site Health section — Slice B rewrite.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Layout: Mobile + Desktop KPI tile columns → metric switcher dropdown →
//   Recharts dual-line trend chart (one series per strategy).
//
// Data contract consumed (new slug shape — Slice B):
//   MetricEnvelope.metrics['pagespeed.performance_mobile']   → MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.performance_desktop']  → MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.accessibility_mobile'] → MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.accessibility_desktop']→ MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.seo_mobile']           → MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.seo_desktop']          → MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.best_practices_mobile']→ MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.best_practices_desktop']→MetricValue (0–100)
//   MetricEnvelope.metrics['pagespeed.lcp_mobile']           → MetricValue (ms)
//   MetricEnvelope.metrics['pagespeed.lcp_desktop']          → MetricValue (ms)
//   MetricEnvelope.metrics['pagespeed.cls_mobile']           → MetricValue (raw float)
//   MetricEnvelope.metrics['pagespeed.cls_desktop']          → MetricValue (raw float)
//   MetricEnvelope.metrics['pagespeed.inp_mobile']           → MetricValue (ms) | absent
//   MetricEnvelope.metrics['pagespeed.inp_desktop']          → MetricValue (ms) | absent
//   MetricEnvelope.metrics['pagespeed.ttfb_mobile']          → MetricValue (ms)
//   MetricEnvelope.metrics['pagespeed.ttfb_desktop']         → MetricValue (ms)
//
// Legacy snapshots (old site_health.* slugs) render as empty-state rather than crash.
// Trend history: client-fetched via GET /api/platform/integrations/[id]/snapshots.

import { useState, useEffect, useCallback } from 'react'
import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { RefetchButton } from './RefetchButton'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SiteHealthSectionProps {
  title: string
  descriptionHtml?: string | null
  envelope: MetricEnvelope | null
  previousEnvelope?: MetricEnvelope | null
  auditUrl?: string | null
  /** Kept for backward compat — not used in Slice B (both strategies shown). */
  strategy?: 'mobile' | 'desktop' | null
  periodStart: string
  periodEnd: string
  /** Integration ID — used to fetch snapshot history for the trend chart. */
  integrationId?: number | null
  accountId?: number | null
}

type MetricKey = 'performance' | 'lcp' | 'cls' | 'inp' | 'ttfb'

const METRIC_OPTIONS: { key: MetricKey; label: string }[] = [
  { key: 'performance', label: 'Performance' },
  { key: 'lcp', label: 'LCP' },
  { key: 'cls', label: 'CLS' },
  { key: 'inp', label: 'INP' },
  { key: 'ttfb', label: 'TTFB' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMetricValue(m: MetricValue | MetricSeries | undefined): m is MetricValue {
  return !!m && 'value' in m
}

/** Read a pagespeed slug from an envelope. Returns null if absent or wrong shape. */
function psi(env: MetricEnvelope | null, slug: string): number | null {
  if (!env) return null
  const m = env.metrics[slug]
  if (!isMetricValue(m)) return null
  const v = typeof m.value === 'number' ? m.value : Number(m.value)
  return isNaN(v) ? null : v
}

/** True if the envelope contains at least one new-shape pagespeed.* slug. */
function hasNewSlugs(env: MetricEnvelope | null): boolean {
  if (!env) return false
  return Object.keys(env.metrics).some((k) => k.startsWith('pagespeed.'))
}

/** Format a millisecond value for display. */
function fmtMs(val: number | null): string {
  if (val === null) return 'N/A'
  if (val >= 1000) return `${(val / 1000).toFixed(1)}s`
  return `${Math.round(val)}ms`
}

/** Format CLS as raw decimal to 2dp. */
function fmtCls(val: number | null): string {
  if (val === null) return 'N/A'
  return val.toFixed(2)
}

function shortDate(dateStr: string): string {
  try {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + 'T00:00:00' : dateStr
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

// Score thresholds: >= 90 good, >= 50 needs-improvement, < 50 poor
type ScoreLevel = 'good' | 'needs-improvement' | 'poor'
function scoreLevel(v: number): ScoreLevel {
  if (v >= 90) return 'good'
  if (v >= 50) return 'needs-improvement'
  return 'poor'
}
const SCORE_COLOR: Record<ScoreLevel, string> = {
  good: 'text-green-600',
  'needs-improvement': 'text-amber-600',
  poor: 'text-red-600',
}

// ─── KPI tile ────────────────────────────────────────────────────────────────

interface KpiTileProps {
  strategy: 'Mobile' | 'Desktop'
  performanceScore: number | null
  lcp: number | null
  cls: number | null
  inp: number | null
  ttfb: number | null
}

function KpiTile({ strategy, performanceScore, lcp, cls, inp, ttfb }: KpiTileProps) {
  const scoreColor = performanceScore !== null ? SCORE_COLOR[scoreLevel(performanceScore)] : 'text-gray-300'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      {/* Strategy badge */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
          strategy === 'Mobile'
            ? 'bg-violet-50 text-violet-700 border-violet-200'
            : 'bg-sky-50 text-sky-700 border-sky-200'
        }`}>
          {strategy}
        </span>
      </div>

      {/* Performance score — large */}
      <div className="flex flex-col items-center gap-1 py-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Performance</span>
        {performanceScore !== null ? (
          <>
            <span className={`text-5xl font-bold tabular-nums ${scoreColor}`}>
              {Math.round(performanceScore)}
            </span>
            <span className="text-xs text-gray-400">/ 100</span>
          </>
        ) : (
          <span className="text-3xl font-bold text-gray-200">—</span>
        )}
      </div>

      {/* CWV rows */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <MetricRow label="LCP" value={fmtMs(lcp)} absent={lcp === null} />
        <MetricRow label="CLS" value={fmtCls(cls)} absent={cls === null} />
        <MetricRow label="INP" value={fmtMs(inp)} absent={inp === null} isOptional />
        <MetricRow label="TTFB" value={fmtMs(ttfb)} absent={ttfb === null} />
      </div>
    </div>
  )
}

function MetricRow({
  label,
  value,
  absent,
  isOptional,
}: {
  label: string
  value: string
  absent: boolean
  isOptional?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className={`text-xs font-mono tabular-nums ${absent ? (isOptional ? 'text-gray-300' : 'text-gray-300') : 'text-gray-800 font-semibold'}`}>
        {absent ? (isOptional ? 'N/A' : '—') : value}
      </span>
    </div>
  )
}

// ─── Trend chart ─────────────────────────────────────────────────────────────

interface SnapshotPoint {
  period_end: string
  mobile: number | null
  desktop: number | null
}

function getMetricSlugPair(metric: MetricKey): { mobile: string; desktop: string } {
  return {
    mobile: `pagespeed.${metric}_mobile`,
    desktop: `pagespeed.${metric}_desktop`,
  }
}

function getChartDomain(metric: MetricKey): [number | 'auto', number | 'auto'] {
  if (metric === 'performance') return [0, 100]
  return ['auto', 'auto']
}

function getYAxisFormatter(metric: MetricKey): (v: number) => string {
  if (metric === 'cls') return (v) => v.toFixed(2)
  if (metric === 'lcp' || metric === 'ttfb' || metric === 'inp') {
    return (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)
  }
  return (v) => String(Math.round(v))
}

function getTooltipFormatter(metric: MetricKey) {
  return (value: number) => {
    if (metric === 'cls') return fmtCls(value)
    if (metric === 'lcp' || metric === 'ttfb' || metric === 'inp') return fmtMs(value)
    return String(Math.round(value))
  }
}

interface TrendChartProps {
  points: SnapshotPoint[]
  metric: MetricKey
}

function TrendChart({ points, metric }: TrendChartProps) {
  if (points.length === 0) {
    return (
      <div className="h-52 flex items-center justify-center text-gray-300 text-sm">
        No chart data yet
      </div>
    )
  }

  const domain = getChartDomain(metric)
  const yFmt = getYAxisFormatter(metric)
  const ttFmt = getTooltipFormatter(metric)

  // Build chart data — only include rows where at least one strategy has a value
  const chartData = points
    .filter((p) => p.mobile !== null || p.desktop !== null)
    .map((p) => ({
      date: p.period_end,
      mobile: p.mobile,
      desktop: p.desktop,
    }))

  if (chartData.length === 0) {
    return (
      <div className="h-52 flex items-center justify-center text-gray-300 text-sm">
        No {metric} data in selected range
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={domain}
          tickFormatter={yFmt}
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
          labelFormatter={(label) => shortDate(String(label))}
          formatter={(value) => [ttFmt(value as number), '']}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="line" />
        <Line
          type="monotone"
          dataKey="mobile"
          stroke="#7c3aed"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          name="Mobile"
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="desktop"
          stroke="#0891b2"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          name="Desktop"
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Section component ────────────────────────────────────────────────────────

export function SiteHealthSection({
  title,
  descriptionHtml,
  envelope,
  periodStart,
  periodEnd,
  integrationId,
  accountId,
}: SiteHealthSectionProps) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('performance')
  const [history, setHistory] = useState<SnapshotPoint[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Determine whether the latest envelope uses the new slug shape
  const newShape = hasNewSlugs(envelope)

  // Extract KPI values from the current envelope
  const mobilePerfScore = psi(envelope, 'pagespeed.performance_mobile')
  const desktopPerfScore = psi(envelope, 'pagespeed.performance_desktop')
  const mobileLcp = psi(envelope, 'pagespeed.lcp_mobile')
  const desktopLcp = psi(envelope, 'pagespeed.lcp_desktop')
  const mobileCls = psi(envelope, 'pagespeed.cls_mobile')
  const desktopCls = psi(envelope, 'pagespeed.cls_desktop')
  const mobileInp = psi(envelope, 'pagespeed.inp_mobile')
  const desktopInp = psi(envelope, 'pagespeed.inp_desktop')
  const mobileTtfb = psi(envelope, 'pagespeed.ttfb_mobile')
  const desktopTtfb = psi(envelope, 'pagespeed.ttfb_desktop')

  // Fetch snapshot history for the trend chart
  const fetchHistory = useCallback(async () => {
    if (!integrationId) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const params = new URLSearchParams()
      if (periodStart) params.set('from', periodStart)
      if (periodEnd) params.set('to', periodEnd)
      const res = await fetch(
        `/api/platform/integrations/${integrationId}/snapshots?${params.toString()}`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Failed to load history')
      }
      const data = await res.json() as {
        snapshots: { id: number; period_end: string; data_json: MetricEnvelope | null }[]
      }

      const { mobile: mobileSlug, desktop: desktopSlug } = getMetricSlugPair(activeMetric)

      const points: SnapshotPoint[] = data.snapshots
        .filter((s) => s.data_json && hasNewSlugs(s.data_json))
        .map((s) => ({
          period_end: s.period_end,
          mobile: psi(s.data_json, mobileSlug),
          desktop: psi(s.data_json, desktopSlug),
        }))

      setHistory(points)
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Could not load history')
    } finally {
      setHistoryLoading(false)
    }
  }, [integrationId, periodStart, periodEnd, activeMetric])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Recompute chart points when metric switcher changes (already re-triggered by
  // fetchHistory dep on activeMetric)

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-5 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {periodStart && periodEnd
              ? `${shortDate(periodStart)} – ${shortDate(periodEnd)}`
              : 'Site performance over time'}
          </p>
        </div>
        {integrationId && (
          <RefetchButton
            integrationIds={[integrationId]}
            variant="header"
            label="Refresh"
            periodStart={periodStart}
            periodEnd={periodEnd}
            accountId={accountId ?? undefined}
          />
        )}
      </div>

      {/* Description */}
      {descriptionHtml && (
        <div
          className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      {/* No snapshot at all */}
      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No data synced yet. Connect PageSpeed Insights and click Refresh.
        </div>
      )}

      {/* Legacy snapshot (old site_health.* slugs — no new data yet) */}
      {envelope && !newShape && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5 text-sm text-blue-700">
          No measurement since the new tracking model went live. Click Refresh to capture the first
          mobile + desktop snapshot, or wait for the next daily fetch.
        </div>
      )}

      {/* KPI tiles — only shown for new-shape snapshots */}
      {newShape && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <KpiTile
            strategy="Mobile"
            performanceScore={mobilePerfScore}
            lcp={mobileLcp}
            cls={mobileCls}
            inp={mobileInp}
            ttfb={mobileTtfb}
          />
          <KpiTile
            strategy="Desktop"
            performanceScore={desktopPerfScore}
            lcp={desktopLcp}
            cls={desktopCls}
            inp={desktopInp}
            ttfb={desktopTtfb}
          />
        </div>
      )}

      {/* Trend chart section */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {/* Chart header: title + metric switcher */}
        <div className="flex items-center justify-between mb-4 gap-3">
          <p className="text-sm font-medium text-gray-700">Performance over time</p>
          <select
            value={activeMetric}
            onChange={(e) => setActiveMetric(e.target.value as MetricKey)}
            className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 text-gray-700
                       bg-white focus:outline-none focus:ring-2 focus:ring-[var(--platform-accent,#0891b2)]
                       focus:border-transparent cursor-pointer"
          >
            {METRIC_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Chart body */}
        {historyLoading && (
          <div className="h-52 flex items-center justify-center text-gray-300 text-sm">
            Loading history...
          </div>
        )}
        {!historyLoading && historyError && (
          <div className="h-52 flex items-center justify-center">
            <p className="text-sm text-red-500 text-center max-w-xs">{historyError}</p>
          </div>
        )}
        {!historyLoading && !historyError && history !== null && (
          <>
            {history.length === 0 ? (
              <div className="h-52 flex flex-col items-center justify-center gap-2">
                <p className="text-sm text-gray-400 text-center max-w-xs">
                  PSI is now tracked over time. Click Refresh or wait for the daily fetch to see
                  trend data here.
                </p>
              </div>
            ) : (
              <TrendChart points={history} metric={activeMetric} />
            )}
          </>
        )}
        {!historyLoading && !historyError && history === null && !integrationId && (
          <div className="h-52 flex items-center justify-center text-gray-300 text-sm">
            No integration linked
          </div>
        )}
      </div>
    </section>
  )
}
