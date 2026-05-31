// Hiilite Platform — Report data access helpers.
//
// Sprint 2 addition. Keeps DB reads in the lib layer, away from route/component code.
// Phase 2 will expand this into a full report CRUD module. For now: read + auto-seed.
//
// Auto-seed behavior (documented per Sprint 2 requirements):
//   When a PM navigates to /platform/reports/<reportId> and no report row exists,
//   getOrSeedReport() creates one on the fly. It finds the most recent GSC integration
//   for the account, seeds a "Search Performance" section with one block per metric
//   slug, and returns the assembled structure. Phase 2 promotes this to a real
//   "create report" flow with template selection.
//
// Tiptap divergence note (Sprint 2):
//   The report renderer is built as plain React server components (RSC) for Sprint 2.
//   Per the charter §5, Tiptap is the canonical rich-text layer for Phase 2 onward.
//   The `description_html` field on ReportSection is pre-authored here for now.
//   Phase 2 task: mount the Tiptap editor on description_html + ai_summary blocks.

import { getDb, generatePublicId } from '../db'
import { ensurePlatformReady } from './tenant'
import { getLatestSnapshot, getSnapshotForPeriod, getPreviousPeriodSnapshot } from './snapshots'
import type { Report, ReportSection, ReportBlock, Integration } from './types'
import type { MetricEnvelope } from './adapter-contract'

// Providers whose APIs report only "as of now" — no historical date ranges
// (SE Ranking = current rank positions). Their sections always show the latest
// snapshot regardless of the selected window, and the period selector skips
// re-fetching them on a range change. The calendar button is also hidden.
export const POINT_IN_TIME_PROVIDERS = new Set(['se_ranking'])

// Providers that store daily point-in-time snapshots but DO support a date-range
// window for the trend chart. Each snapshot's period_start = period_end = the
// day it was captured. The KPI tiles show the LATEST snapshot (like
// POINT_IN_TIME_PROVIDERS) but the calendar button IS visible so the PM can
// narrow the trend chart range. The period-override popover governs history
// fetching in the component, not getSnapshotForPeriod.
export const LATEST_SNAPSHOT_PROVIDERS = new Set(['pagespeed'])

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse the `settings_json` TEXT column on a section into a typed object.
 *  Tolerant: returns `{}` on null/empty/malformed JSON or non-object root,
 *  so callers never have to wrap in try/catch. Other writers can merge
 *  additional keys into the same blob without breaking this read. */
export function parseSectionSettings(raw: string | null | undefined): SectionSettings {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SectionSettings
    }
  } catch {
    // fall through
  }
  return {}
}

/** Resolve the effective period window for a given section. Returns the
 *  section's `periodOverride` if it is well-formed AND the provider supports
 *  range semantics; otherwise falls back to the report's top-level period.
 *  Point-in-time providers ignore overrides entirely (no period semantics). */
export function resolveSectionPeriod(args: {
  settings: SectionSettings
  provider: string
  reportPeriodStart: string | null
  reportPeriodEnd: string | null
}): { periodStart: string | null; periodEnd: string | null; isOverride: boolean } {
  const o = args.settings.periodOverride
  const overrideValid =
    !!o &&
    typeof o.periodStart === 'string' &&
    typeof o.periodEnd === 'string' &&
    ISO_DATE_RE.test(o.periodStart) &&
    ISO_DATE_RE.test(o.periodEnd) &&
    o.periodEnd >= o.periodStart
  const supportsRange = !POINT_IN_TIME_PROVIDERS.has(args.provider)
  if (overrideValid && supportsRange) {
    return { periodStart: o!.periodStart, periodEnd: o!.periodEnd, isOverride: true }
  }
  return {
    periodStart: args.reportPeriodStart,
    periodEnd: args.reportPeriodEnd,
    isOverride: false,
  }
}

// ─── Composed read types ─────────────────────────────────────────────

export interface BlockWithData extends ReportBlock {
  /** Resolved metric envelope for this block's (integration, period). Null if no snapshot. */
  envelope: MetricEnvelope | null
  /** Previous-period envelope for delta computation. Null when no prior snapshot exists. */
  previousEnvelope: MetricEnvelope | null
}

/** Shape of `platform_report_sections.settings_json` once parsed.
 *  Currently only carries an optional `periodOverride` — the per-section
 *  date window that lets a section show data from a different range than
 *  the report's top-level period. Null/missing/empty = inherit the report period.
 *  Ignored for POINT_IN_TIME_PROVIDERS (se_ranking). */
export interface SectionSettings {
  periodOverride?: { periodStart: string; periodEnd: string } | null
  /** Forward-compatible: any future per-section flags land here. */
  [key: string]: unknown
}

export interface SectionWithBlocks extends ReportSection {
  blocks: BlockWithData[]
  /** Section type discriminator — set by seeder, used by dispatcher.
   *  Values: 'ai_summary' | 'search_performance' | 'traffic_overview' |
   *          'conversions' | 'rank_movement' | 'site_health' | 'site_health_v2' |
   *          'form_conversions' | 'tasks_completed' | 'hours_invested'
   *  Null for reports seeded before the section_type column was added. */
  section_type?: string | null
  /** Parsed view of `settings_json` for the frontend (override badge, etc).
   *  Empty object when settings_json is null/empty/malformed. */
  settings: SectionSettings
}

export interface ReportWithSections extends Report {
  account_name: string
  sections: SectionWithBlocks[]
}

// ─── Reader ──────────────────────────────────────────────────────────

/** Load a report + its sections + blocks, resolved with snapshot data.
 *  Scoped to tenant_id — throws if the report does not belong to the tenant. */
export function getReportWithSections(args: {
  reportId: number
  tenantId: number
}): ReportWithSections | null {
  ensurePlatformReady()
  const db = getDb()

  // Phase C: client_profiles.id is the canonical account id. platform_reports.account_id
  // references client_profiles.id post-consolidation.
  const report = db.prepare(
    `SELECT r.*, cp.name AS account_name
       FROM platform_reports r
       JOIN client_profiles cp ON cp.id = r.account_id
      WHERE r.id = ? AND r.tenant_id = ?`
  ).get(args.reportId, args.tenantId) as (Report & { account_name: string }) | undefined
  if (!report) return null

  const sections = db.prepare(
    `SELECT *, section_type FROM platform_report_sections
      WHERE report_id = ? AND tenant_id = ?
      ORDER BY position ASC`
  ).all(args.reportId, args.tenantId) as (ReportSection & { section_type?: string | null })[]

  const sectionIds = sections.map((s) => s.id)
  const allBlocks: ReportBlock[] = sectionIds.length
    ? (db.prepare(
        `SELECT * FROM platform_report_blocks
          WHERE section_id IN (${sectionIds.map(() => '?').join(',')}) AND tenant_id = ?
          ORDER BY section_id, position ASC`
      ).all(...sectionIds, args.tenantId) as ReportBlock[])
    : []

  // Provider per integration referenced by this report's blocks — used to
  // decide window-exact vs latest-snapshot resolution below.
  const blockIntegrationIds = Array.from(
    new Set(allBlocks.map((b) => b.integration_id).filter((id): id is number => id != null))
  )
  const providerById = new Map<number, string>()
  if (blockIntegrationIds.length) {
    for (const r of db.prepare(
      `SELECT id, provider FROM platform_integrations
        WHERE id IN (${blockIntegrationIds.map(() => '?').join(',')}) AND tenant_id = ?`
    ).all(...blockIntegrationIds, args.tenantId) as { id: number; provider: string }[]) {
      providerById.set(r.id, r.provider)
    }
  }

  // Resolve snapshot data for every block that has an integration_id.
  const sectionsWithBlocks: SectionWithBlocks[] = sections.map((section) => {
    // Parse the section's settings_json once per section — used to apply a
    // per-section period override (Slice A). Tolerates null/malformed JSON.
    const settings = parseSectionSettings(section.settings_json)

    const blocks = allBlocks
      .filter((b) => b.section_id === section.id)
      .map((block): BlockWithData => {
        let envelope: MetricEnvelope | null = null
        let previousEnvelope: MetricEnvelope | null = null
        if (block.integration_id) {
          const provider = providerById.get(block.integration_id) ?? ''
          const isPointInTime = POINT_IN_TIME_PROVIDERS.has(provider)

          // Effective window for THIS section: the override (if set + provider
          // supports ranges) or the report's top-level period. Point-in-time
          // providers always fall back to the report period — their override
          // is a no-op since their snapshots have no period semantics.
          const eff = resolveSectionPeriod({
            settings,
            provider,
            reportPeriodStart: report.period_start,
            reportPeriodEnd: report.period_end,
          })

          // Point-in-time providers (SE Ranking) have no history — always show
          // their latest snapshot regardless of the selected window.
          // LATEST_SNAPSHOT_PROVIDERS (pagespeed, Slice B) store daily point-in-time
          // snapshots (period_start = period_end = capture date). KPI tiles show the
          // latest snapshot; the trend chart is fetched client-side by the section
          // component via GET /api/platform/integrations/[id]/snapshots.
          // Range-aware providers match the section's EXACT effective window
          // (null until fetched). Legacy reports with no period fall back to latest.
          const isLatestSnap = LATEST_SNAPSHOT_PROVIDERS.has(provider)
          const snap = (isPointInTime || isLatestSnap || !eff.periodStart || !eff.periodEnd)
            ? getLatestSnapshot({
                tenant_id: args.tenantId,
                integration_id: block.integration_id,
                // Floor date so the newest snapshot always wins for point-in-time
                // and latest-snapshot providers; date-bounded for period fallback.
                asOf: (isPointInTime || isLatestSnap) ? '1970-01-01' : eff.periodEnd ?? undefined,
              })
            : getSnapshotForPeriod({
                tenant_id: args.tenantId,
                integration_id: block.integration_id,
                periodStart: eff.periodStart,
                periodEnd: eff.periodEnd,
                // Disambiguate tenant-level integrations (QBO) by client.
                account_id: report.account_id,
              })
          envelope = snap?.normalized ?? null

          // Resolve previous-period snapshot for delta indicators. When an
          // override is in effect, base the previous-period lookup on the
          // override window so deltas stay consistent with what's rendered.
          //
          // GA-style explicit compare: when the report row has both
          // compare_period_start + compare_period_end set AND we're rendering
          // the report's primary window (no per-section override), pass them
          // through so snapshots.ts does an EXACT lookup instead of the
          // ±5-day "closest to ideal" auto-compute. NULL columns = fall back
          // to the existing auto-compute logic (back-compat for old reports).
          if (eff.periodStart && eff.periodEnd) {
            const useExplicitCompare =
              !eff.isOverride && !!report.compare_period_start && !!report.compare_period_end
            const prevSnap = getPreviousPeriodSnapshot({
              tenant_id: args.tenantId,
              integration_id: block.integration_id,
              currentPeriodStart: eff.periodStart,
              currentPeriodEnd: eff.periodEnd,
              explicitPeriodStart: useExplicitCompare ? report.compare_period_start : null,
              explicitPeriodEnd: useExplicitCompare ? report.compare_period_end : null,
            })
            previousEnvelope = prevSnap?.normalized ?? null
          }
        }
        return { ...block, envelope, previousEnvelope }
      })
    return { ...section, blocks, settings }
  })

  return { ...report, sections: sectionsWithBlocks }
}

// ─── Auto-seeder ─────────────────────────────────────────────────────

interface BlockDef {
  block_type: string
  title: string
  metric_slug: string
  position: number
}

/** Low-level block inserter for sections that have no integration (e.g. AI summary).
 *  Differs from insertBlocks in that integration_id and metric_slug are omitted. */
function insertAiSummaryBlock(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  sectionId: number
  now: number
}) {
  db.prepare(
    `INSERT INTO platform_report_blocks
       (tenant_id, public_id, section_id, position, block_type, title,
        integration_id, metric_slug, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'ai_summary', 'AI Executive Summary', NULL, NULL, ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.sectionId,
    args.now,
    args.now,
  )
}

/** Low-level block inserter. Shared by all section seeders. */
function insertBlocks(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  sectionId: number
  integrationId: number
  blocks: BlockDef[]
  now: number
}) {
  const stmt = db.prepare(
    `INSERT INTO platform_report_blocks
       (tenant_id, public_id, section_id, position, block_type, title, integration_id, metric_slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const b of args.blocks) {
    stmt.run(
      args.tenantId,
      generatePublicId(),
      args.sectionId,
      b.position,
      b.block_type,
      b.title,
      args.integrationId,
      b.metric_slug,
      args.now, args.now,
    )
  }
}

/** Seed the AI Executive Summary section + block at position 0.
 *  Always seeded regardless of which integrations are connected.
 *  The block has no integration_id or metric_slug. */
function seedAiSummarySection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Executive Summary', '', 'ai_summary', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    args.now,
    args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)
  insertAiSummaryBlock(db, { tenantId: args.tenantId, sectionId, now: args.now })
  return sectionId
}

/** Seed the Search Performance section + blocks. Returns sectionId. */
function seedSearchPerformanceSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Search Performance', ?, 'search_performance', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>Google Search Console data for the reporting period. Covers organic search clicks, impressions, CTR, and ranking performance across verified properties.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',        title: 'Clicks',                    metric_slug: 'search_performance.clicks',       position: 0 },
      { block_type: 'kpi',        title: 'Impressions',               metric_slug: 'search_performance.impressions',  position: 1 },
      { block_type: 'kpi',        title: 'CTR',                       metric_slug: 'search_performance.ctr',          position: 2 },
      { block_type: 'kpi',        title: 'Avg Position',              metric_slug: 'search_performance.position',     position: 3 },
      { block_type: 'line_chart', title: 'Daily Clicks & Impressions',metric_slug: 'search_performance.daily',        position: 4 },
      { block_type: 'table',      title: 'Top Queries',               metric_slug: 'search_performance.top_queries',  position: 5 },
      { block_type: 'table',      title: 'Top Pages',                 metric_slug: 'search_performance.top_pages',    position: 6 },
    ],
  })

  return sectionId
}

/** Seed the Traffic Overview section + blocks. Returns sectionId. */
function seedTrafficOverviewSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Traffic Overview', ?, 'traffic_overview', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>Google Analytics 4 traffic data for the reporting period. Covers users, sessions, page views, engagement, and top traffic sources.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',        title: 'Users',            metric_slug: 'traffic.users',           position: 0 },
      { block_type: 'kpi',        title: 'Sessions',         metric_slug: 'traffic.sessions',        position: 1 },
      { block_type: 'kpi',        title: 'Page Views',       metric_slug: 'traffic.page_views',      position: 2 },
      { block_type: 'kpi',        title: 'Engagement Rate',  metric_slug: 'traffic.engagement_rate', position: 3 },
      { block_type: 'kpi',        title: 'Bounce Rate',      metric_slug: 'traffic.bounce_rate',     position: 4 },
      { block_type: 'line_chart', title: 'Daily Users & Sessions', metric_slug: 'traffic.daily',     position: 5 },
      { block_type: 'table',      title: 'Top Pages',        metric_slug: 'traffic.top_pages',       position: 6 },
      { block_type: 'table',      title: 'Top Sources',      metric_slug: 'traffic.top_sources',     position: 7 },
    ],
  })

  return sectionId
}

/** Seed the Conversions section + blocks (GA4-side). Returns sectionId.
 *  Distinct from Form Conversions (Gravity Forms) — this is GA4 conversion
 *  event totals + breakdowns by event and acquisition channel. */
function seedConversionsSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Conversions', ?, 'conversions', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>Google Analytics 4 conversion events for the reporting period. Shows total conversions, breakdown by event name, and attribution by acquisition channel.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',   title: 'Total Conversions',    metric_slug: 'ga4.conversions_total',       position: 0 },
      { block_type: 'table', title: 'Conversions by Event', metric_slug: 'ga4.conversions_by_event',    position: 1 },
      { block_type: 'table', title: 'Conversions by Channel', metric_slug: 'ga4.conversions_by_channel', position: 2 },
    ],
  })

  return sectionId
}

/** Seed the Site Health section + blocks. Returns sectionId. */
function seedSiteHealthSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Site Health', ?, 'site_health', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>PageSpeed Insights Lighthouse audit results. Scores are out of 100; Core Web Vitals thresholds follow Google\'s public guidelines.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi', title: 'Performance Score',    metric_slug: 'site_health.performance_score',    position: 0 },
      { block_type: 'kpi', title: 'Accessibility Score',  metric_slug: 'site_health.accessibility_score',  position: 1 },
      { block_type: 'kpi', title: 'SEO Score',            metric_slug: 'site_health.seo_score',            position: 2 },
      { block_type: 'kpi', title: 'Best Practices Score', metric_slug: 'site_health.best_practices_score', position: 3 },
      { block_type: 'kpi', title: 'LCP',                  metric_slug: 'site_health.lcp',                  position: 4 },
      { block_type: 'kpi', title: 'CLS',                  metric_slug: 'site_health.cls',                  position: 5 },
      { block_type: 'kpi', title: 'TBT',                  metric_slug: 'site_health.tbt',                  position: 6 },
      { block_type: 'kpi', title: 'TTFB',                 metric_slug: 'site_health.ttfb',                 position: 7 },
    ],
  })

  return sectionId
}

function seedTasksCompletedSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Tasks Completed', ?, 'tasks_completed', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>Asana tasks completed during the report period, broken down by day and project.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',      title: 'Tasks Completed',       metric_slug: 'tasks.completed',       position: 0 },
      { block_type: 'bar_chart', title: 'Daily Completions',    metric_slug: 'tasks.completed_daily', position: 1 },
      { block_type: 'table',    title: 'Recently Completed',    metric_slug: 'tasks.recent',          position: 2 },
    ],
  })

  return sectionId
}

function seedHoursInvestedSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Hours Invested', ?, 'hours_invested', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>Everhour time tracking for the period, broken down by project and day.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',       title: 'Total Hours',         metric_slug: 'hours.total',      position: 0 },
      { block_type: 'line_chart', title: 'Daily Hours',        metric_slug: 'hours.daily',      position: 1 },
      { block_type: 'table',     title: 'Hours by Project',    metric_slug: 'hours.by_project', position: 2 },
    ],
  })

  return sectionId
}

/** Seed the Financial Summary section + blocks (QBO). Returns sectionId. */
function seedFinancialSummarySection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Financial Summary', ?, 'financial_summary', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>Invoicing &amp; receivables for the period (QuickBooks Online). Internal — excluded from the shared client report.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',        title: 'Invoiced',     metric_slug: 'finance.invoiced_total', position: 0 },
      { block_type: 'kpi',        title: 'Paid',         metric_slug: 'finance.paid_total',      position: 1 },
      { block_type: 'kpi',        title: 'Outstanding',  metric_slug: 'finance.outstanding',     position: 2 },
      { block_type: 'kpi',        title: 'DSO',          metric_slug: 'finance.dso_days',         position: 3 },
      { block_type: 'line_chart', title: 'Daily Invoiced', metric_slug: 'finance.invoiced_daily', position: 4 },
      { block_type: 'table',      title: 'AR Aging',     metric_slug: 'finance.ar_aging',         position: 5 },
      { block_type: 'table',      title: 'Recent Invoices', metric_slug: 'finance.recent_invoices', position: 6 },
    ],
  })

  return sectionId
}

/** The tenant's QBO integration IF connected AND this client is mapped to a QBO
 *  customer. Drives whether the Financial Summary section exists for a report. */
export function findQboIntegrationForClient(args: { tenantId: number; accountId: number }): Integration | null {
  ensurePlatformReady()
  const db = getDb()
  const client = db.prepare('SELECT qbo_customer_id FROM client_profiles WHERE id = ?').get(args.accountId) as { qbo_customer_id: string | null } | undefined
  if (!client?.qbo_customer_id) return null
  return (db.prepare(
    `SELECT * FROM platform_integrations WHERE tenant_id = ? AND provider = 'qbo' AND status = 'connected' ORDER BY id LIMIT 1`
  ).get(args.tenantId) as Integration | undefined) ?? null
}

/** Seed the Rank Movement section + blocks (SE Ranking). Returns sectionId. */
function seedRankMovementSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Rank Movement', ?, 'rank_movement', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>SE Ranking keyword position tracking for the reporting period. Shows average position, top-10 and top-3 keyword counts, and daily rank movement.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',        title: 'Avg Position',          metric_slug: 'rank.average_position',  position: 0 },
      { block_type: 'kpi',        title: 'Keywords in Top 10',    metric_slug: 'rank.keywords_top10',    position: 1 },
      { block_type: 'kpi',        title: 'Keywords in Top 3',     metric_slug: 'rank.keywords_top3',     position: 2 },
      { block_type: 'line_chart', title: 'Avg Position Trend',    metric_slug: 'rank.movement_daily',    position: 3 },
      { block_type: 'table',      title: 'Top Keywords',          metric_slug: 'rank.keywords',          position: 4 },
    ],
  })

  return sectionId
}

/** Seed the Site & Content (WP) section + blocks. Returns sectionId. */
function seedSiteHealthV2Section(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Site & Content', ?, 'site_health_v2', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>WordPress content activity for the reporting period. Tracks posts and pages published, WordPress version, and recent content updates.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',   title: 'Posts Published',   metric_slug: 'wp.posts_published', position: 0 },
      { block_type: 'kpi',   title: 'Pages Published',   metric_slug: 'wp.pages_published', position: 1 },
      { block_type: 'kpi',   title: 'WordPress Version', metric_slug: 'wp.wp_version',      position: 2 },
      { block_type: 'kpi',   title: 'Media Uploads',     metric_slug: 'wp.media_uploads',   position: 3 },
      { block_type: 'table', title: 'Recent Posts',      metric_slug: 'wp.recent_posts',    position: 4 },
    ],
  })

  return sectionId
}

/** Seed the Form Conversions section + blocks (Gravity Forms). Returns sectionId. */
function seedFormConversionsSection(db: ReturnType<typeof getDb>, args: {
  tenantId: number
  reportId: number
  integrationId: number
  position: number
  now: number
}): number {
  const sectionResult = db.prepare(
    `INSERT INTO platform_report_sections
       (tenant_id, public_id, report_id, position, title, description_html, section_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Form Conversions', ?, 'form_conversions', ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.reportId,
    args.position,
    '<p>Gravity Forms submission data for the reporting period. Shows total entries, daily submission trends, and a per-form breakdown.</p>',
    args.now, args.now,
  )
  const sectionId = Number(sectionResult.lastInsertRowid)

  insertBlocks(db, {
    tenantId: args.tenantId,
    sectionId,
    integrationId: args.integrationId,
    now: args.now,
    blocks: [
      { block_type: 'kpi',        title: 'Total Entries',      metric_slug: 'forms.total_entries', position: 0 },
      { block_type: 'line_chart', title: 'Daily Entries',      metric_slug: 'forms.daily',         position: 1 },
      { block_type: 'table',      title: 'Entries by Form',    metric_slug: 'forms.by_form',       position: 2 },
    ],
  })

  return sectionId
}

/** Seed a combined SEO Retainer report. Detects which integrations exist for
 *  the account and seeds sections accordingly:
 *
 *   GSC only                        → Search Performance
 *   GSC + GA4                       → Search Performance + Traffic Overview
 *   GSC + GA4 + PageSpeed           → ... + Site Health
 *   + Asana                         → ... + Tasks Completed
 *   + Everhour                      → ... + Hours Invested
 *
 *  Phase 2: replace with a real "create report from template" UI flow. */
export function seedSeoRetainerReport(args: {
  tenantId: number
  accountId: number
  /** Required: GSC integration must exist for the seeder to run at all. */
  gscIntegrationId: number
  /** Optional: GA4 integration id, if connected. */
  ga4IntegrationId?: number | null
  /** Optional: PageSpeed integration id, if connected. */
  pagespeedIntegrationId?: number | null
  /** Optional: SE Ranking integration id, if connected. */
  seRankingIntegrationId?: number | null
  /** Optional: WordPress integration id, if connected. */
  wordpressIntegrationId?: number | null
  /** Optional: Gravity Forms integration id, if connected. */
  gravityFormsIntegrationId?: number | null
  /** Optional: Asana integration id, if connected. */
  asanaIntegrationId?: number | null
  /** Optional: Everhour integration id, if connected. */
  everhourIntegrationId?: number | null
  accountName: string
}): { reportId: number } {
  ensurePlatformReady()
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  const periodEnd = end.toISOString().slice(0, 10)
  const periodStart = start.toISOString().slice(0, 10)

  const reportResult = db.prepare(
    `INSERT INTO platform_reports
       (tenant_id, public_id, account_id, name, status, period_start, period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    args.tenantId,
    generatePublicId(),
    args.accountId,
    `${args.accountName} — SEO Retainer Report`,
    periodStart,
    periodEnd,
    now, now,
  )
  const reportId = Number(reportResult.lastInsertRowid)

  let position = 0

  // Position 0: AI Executive Summary — always present, content generated on first render.
  seedAiSummarySection(db, {
    tenantId: args.tenantId,
    reportId,
    position: position++,
    now,
  })

  // Position 1: Search Performance (GSC is required by the seeder contract).
  seedSearchPerformanceSection(db, {
    tenantId: args.tenantId,
    reportId,
    integrationId: args.gscIntegrationId,
    position: position++,
    now,
  })

  // Seed Traffic Overview if GA4 integration exists.
  if (args.ga4IntegrationId) {
    seedTrafficOverviewSection(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.ga4IntegrationId,
      position: position++,
      now,
    })
    // Conversions (GA4) — sits right after Traffic Overview, before any
    // local Form Conversions (Gravity Forms) section seeded later.
    seedConversionsSection(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.ga4IntegrationId,
      position: position++,
      now,
    })
  }

  // Seed Rank Movement if SE Ranking integration exists.
  if (args.seRankingIntegrationId) {
    seedRankMovementSection(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.seRankingIntegrationId,
      position: position++,
      now,
    })
  }

  // Seed Site Health if PageSpeed integration exists.
  if (args.pagespeedIntegrationId) {
    seedSiteHealthSection(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.pagespeedIntegrationId,
      position: position++,
      now,
    })
  }

  // Seed Site & Content (WP) if WordPress integration exists.
  if (args.wordpressIntegrationId) {
    seedSiteHealthV2Section(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.wordpressIntegrationId,
      position: position++,
      now,
    })
  }

  // Seed Form Conversions if Gravity Forms integration exists.
  if (args.gravityFormsIntegrationId) {
    seedFormConversionsSection(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.gravityFormsIntegrationId,
      position: position++,
      now,
    })
  }

  // Seed Tasks Completed if Asana integration exists.
  if (args.asanaIntegrationId) {
    seedTasksCompletedSection(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.asanaIntegrationId,
      position: position++,
      now,
    })
  }

  // Seed Hours Invested if Everhour integration exists.
  if (args.everhourIntegrationId) {
    seedHoursInvestedSection(db, {
      tenantId: args.tenantId,
      reportId,
      integrationId: args.everhourIntegrationId,
      position: position++,
      now,
    })
  }

  // Apply this client's saved section order + visibility (if any) so the new
  // report opens in their preferred arrangement.
  applyClientLayout({ tenantId: args.tenantId, accountId: args.accountId, reportId })

  return { reportId }
}

/** Non-destructively sync a report's data sections to the account's currently
 *  connected integrations. ADDS a section for any connected integration that
 *  lacks one. REMOVES a data section only when its integration row is fully
 *  gone (disconnected/deleted) — NOT when the integration merely errored, so a
 *  transient API failure doesn't wipe a section + its edits.
 *
 *  Preserves: the AI Summary section, the report period, comments (their
 *  section_id is set NULL via FK on section delete), and description_html
 *  edits on surviving sections.
 *
 *  Called on report render so the report self-heals whenever the PM connects
 *  or disconnects an integration — no manual reseed needed. Returns the set of
 *  section types added/removed (empty arrays = report was already in sync). */
export function reconcileReportSections(args: {
  tenantId: number
  reportId: number
  accountId: number
}): { added: string[]; removed: string[] } {
  ensurePlatformReady()
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  // section_type → provider + finder (connected-only) + seeder
  const map = [
    { type: 'search_performance', provider: 'gsc',           find: findGscIntegration,          seed: seedSearchPerformanceSection },
    { type: 'traffic_overview',   provider: 'ga4',           find: findGa4Integration,          seed: seedTrafficOverviewSection },
    { type: 'conversions',        provider: 'ga4',           find: findGa4Integration,          seed: seedConversionsSection },
    { type: 'rank_movement',      provider: 'se_ranking',    find: findSeRankingIntegration,    seed: seedRankMovementSection },
    { type: 'site_health',        provider: 'pagespeed',     find: findPagespeedIntegration,    seed: seedSiteHealthSection },
    { type: 'site_health_v2',     provider: 'wordpress',     find: findWordpressIntegration,    seed: seedSiteHealthV2Section },
    { type: 'form_conversions',   provider: 'gravity_forms', find: findGravityFormsIntegration, seed: seedFormConversionsSection },
    { type: 'tasks_completed',    provider: 'asana',         find: findAsanaIntegration,        seed: seedTasksCompletedSection },
    { type: 'hours_invested',     provider: 'everhour',      find: findEverhourIntegration,     seed: seedHoursInvestedSection },
  ] as const

  const sections = db.prepare(
    `SELECT id, section_type, position FROM platform_report_sections WHERE report_id = ? AND tenant_id = ?`
  ).all(args.reportId, args.tenantId) as { id: number; section_type: string | null; position: number }[]

  const existingTypes = new Set(sections.map((s) => s.section_type))
  let maxPos = sections.reduce((m, s) => Math.max(m, s.position), 0)

  // "Does any integration row of this provider exist for the account?" — used
  // for the remove decision so a non-'connected' (errored) row keeps its section.
  const anyRowStmt = db.prepare(
    `SELECT 1 FROM platform_integrations WHERE tenant_id = ? AND account_id = ? AND provider = ? LIMIT 1`
  )

  const added: string[] = []
  const removed: string[] = []

  // ADD — connected integration with no matching section
  for (const entry of map) {
    const integ = entry.find({ tenantId: args.tenantId, accountId: args.accountId })
    if (integ && !existingTypes.has(entry.type)) {
      entry.seed(db, {
        tenantId: args.tenantId,
        reportId: args.reportId,
        integrationId: integ.id,
        position: ++maxPos,
        now,
      })
      added.push(entry.type)
    } else if (integ) {
      // HEAL orphaned blocks — a section whose backing integration was deleted
      // (e.g. duplicate cleanup set integration_id NULL via FK) re-links to the
      // current provider integration so its data resolves again.
      db.prepare(
        `UPDATE platform_report_blocks
            SET integration_id = ?
          WHERE integration_id IS NULL
            AND section_id IN (SELECT id FROM platform_report_sections WHERE report_id = ? AND tenant_id = ? AND section_type = ?)`
      ).run(integ.id, args.reportId, args.tenantId, entry.type)
    }
  }

  // REMOVE — data section whose integration row is entirely gone
  for (const s of sections) {
    if (!s.section_type) continue
    const entry = map.find((e) => e.type === s.section_type)
    if (!entry) continue // ai_summary / unknown — never auto-remove
    const rowExists = anyRowStmt.get(args.tenantId, args.accountId, entry.provider)
    if (!rowExists) {
      db.prepare('DELETE FROM platform_report_blocks WHERE section_id = ?').run(s.id)
      db.prepare('DELETE FROM platform_report_sections WHERE id = ? AND tenant_id = ?').run(s.id, args.tenantId)
      removed.push(s.section_type)
    }
  }

  // Financial Summary (QBO) — special case: tenant-level integration, gated on
  // the client being mapped to a QBO customer (not a per-client integration row,
  // so it can't use the generic map above). Add when mapped, remove when not.
  const qboInteg = findQboIntegrationForClient({ tenantId: args.tenantId, accountId: args.accountId })
  const finSection = sections.find((s) => s.section_type === 'financial_summary')
  if (qboInteg && !finSection) {
    seedFinancialSummarySection(db, { tenantId: args.tenantId, reportId: args.reportId, integrationId: qboInteg.id, position: ++maxPos, now })
    added.push('financial_summary')
  } else if (!qboInteg && finSection) {
    db.prepare('DELETE FROM platform_report_blocks WHERE section_id = ?').run(finSection.id)
    db.prepare('DELETE FROM platform_report_sections WHERE id = ? AND tenant_id = ?').run(finSection.id, args.tenantId)
    removed.push('financial_summary')
  }

  // Newly-added sections were appended at the end. Re-apply the client's saved
  // layout so they land in the client's preferred order/visibility by type.
  if (added.length > 0) {
    applyClientLayout({ tenantId: args.tenantId, accountId: args.accountId, reportId: args.reportId })
  }

  return { added, removed }
}

// ─── Layout: section ordering + visibility ───────────────────────────

export interface SectionLayoutEntry {
  sectionId: number
  position: number
  isHidden: boolean
}

/** Persist a report's section order + visibility AND save it as the client's
 *  default layout (keyed by section_type) so future reports for this client
 *  open in the same arrangement. Tenant-scoped. */
export function saveReportLayout(args: {
  tenantId: number
  accountId: number
  reportId: number
  layout: SectionLayoutEntry[]
}): void {
  ensurePlatformReady()
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  const updateStmt = db.prepare(
    `UPDATE platform_report_sections
        SET position = ?, is_hidden = ?, updated_at = ?
      WHERE id = ? AND report_id = ? AND tenant_id = ?`
  )
  const tx = db.transaction((entries: SectionLayoutEntry[]) => {
    for (const e of entries) {
      updateStmt.run(e.position, e.isHidden ? 1 : 0, now, e.sectionId, args.reportId, args.tenantId)
    }
  })
  tx(args.layout)

  // Derive the client-default layout (by section_type) from the updated rows.
  const rows = db.prepare(
    `SELECT section_type, position, is_hidden
       FROM platform_report_sections
      WHERE report_id = ? AND tenant_id = ? AND section_type IS NOT NULL
      ORDER BY position ASC`
  ).all(args.reportId, args.tenantId) as { section_type: string; position: number; is_hidden: number }[]

  const layoutJson = JSON.stringify(
    rows.map((r) => ({ section_type: r.section_type, position: r.position, is_hidden: r.is_hidden }))
  )
  db.prepare(
    `UPDATE client_profiles SET report_layout_json = ?, updated_at = ? WHERE id = ?`
  ).run(layoutJson, now, args.accountId)
}

/** Apply the client's saved default layout to a report's sections — sets each
 *  section's position + is_hidden by matching section_type. Sections whose type
 *  isn't in the saved layout are appended after (visible), preserving their
 *  current relative order. No-op if the client has no saved layout. */
export function applyClientLayout(args: {
  tenantId: number
  accountId: number
  reportId: number
}): void {
  ensurePlatformReady()
  const db = getDb()
  const raw = (db.prepare(
    `SELECT report_layout_json FROM client_profiles WHERE id = ?`
  ).get(args.accountId) as { report_layout_json: string | null } | undefined)?.report_layout_json
  if (!raw) return

  let saved: { section_type: string; position: number; is_hidden: number }[]
  try {
    saved = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(saved) || saved.length === 0) return

  const byType = new Map(saved.map((s) => [s.section_type, s]))
  const sections = db.prepare(
    `SELECT id, section_type FROM platform_report_sections
      WHERE report_id = ? AND tenant_id = ? ORDER BY position ASC`
  ).all(args.reportId, args.tenantId) as { id: number; section_type: string | null }[]

  let tail = saved.reduce((m, s) => Math.max(m, s.position), 0) + 1
  const now = Math.floor(Date.now() / 1000)
  const upd = db.prepare(
    `UPDATE platform_report_sections SET position = ?, is_hidden = ?, updated_at = ? WHERE id = ?`
  )
  const tx = db.transaction(() => {
    for (const sec of sections) {
      const match = sec.section_type ? byType.get(sec.section_type) : undefined
      if (match) upd.run(match.position, match.is_hidden ? 1 : 0, now, sec.id)
      else upd.run(tail++, 0, now, sec.id)
    }
  })
  tx()
}

/** Backward-compat alias — callers that still reference the old name continue
 *  to work. Delegates to seedSeoRetainerReport with only the GSC section. */
export function seedSearchPerformanceReport(args: {
  tenantId: number
  accountId: number
  integrationId: number
  accountName: string
}): { reportId: number } {
  return seedSeoRetainerReport({
    tenantId: args.tenantId,
    accountId: args.accountId,
    gscIntegrationId: args.integrationId,
    accountName: args.accountName,
  })
}

// ─── Convenience: find first GSC integration for an account ──────────

/** Return the first connected GSC integration for the account, or null.
 *  Used by the report page to decide whether to run the auto-seeder. */
export function findGscIntegration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'gsc' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

/** Return the first connected GSC integration for any account under the tenant.
 *  Used by the dashboard when no specific accountId is in scope. */
export function findAnyGscIntegration(tenantId: number): (Integration & { account_name: string }) | null {
  ensurePlatformReady()
  // Phase C: account_id on platform_integrations references client_profiles.id.
  return (getDb().prepare(
    `SELECT i.*, cp.name AS account_name
       FROM platform_integrations i
       JOIN client_profiles cp ON cp.id = i.account_id
      WHERE i.tenant_id = ? AND i.provider = 'gsc' AND i.status = 'connected'
      ORDER BY i.created_at DESC LIMIT 1`
  ).get(tenantId) as (Integration & { account_name: string }) | undefined) ?? null
}

/** Return the first connected GA4 integration for a given account. */
export function findGa4Integration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'ga4' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

/** Return the first connected PageSpeed integration for a given account. */
export function findPagespeedIntegration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'pagespeed' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

/** Return the first connected Asana integration for a given account. */
export function findAsanaIntegration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'asana' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

/** Return the first connected Everhour integration for a given account. */
export function findEverhourIntegration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'everhour' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

/** Return the first connected SE Ranking integration for a given account. */
export function findSeRankingIntegration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'se_ranking' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

/** Return the first connected WordPress integration for a given account. */
export function findWordpressIntegration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'wordpress' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

/** Return the first connected Gravity Forms integration for a given account. */
export function findGravityFormsIntegration(args: {
  tenantId: number
  accountId: number
}): Integration | null {
  ensurePlatformReady()
  return (getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ? AND provider = 'gravity_forms' AND status = 'connected'
      ORDER BY created_at DESC LIMIT 1`
  ).get(args.tenantId, args.accountId) as Integration | undefined) ?? null
}

// ─── Comment helpers ────────────────────────────────────────────────────

export interface ReportComment {
  id: number
  public_id: string
  report_id: number
  section_id: number | null
  author_user_id: number
  body: string
  is_resolved: number
  asana_task_gid: string | null
  created_at: number
  updated_at: number
}

/** Returns all non-deleted comments for a report, oldest first.
 *  Grouped structure: each entry carries the section_id so the caller can
 *  partition by section in the UI. Soft-deleted comments (body='_deleted_')
 *  are excluded. */
export function listCommentsForReport(args: {
  tenantId: number
  reportId: number
}): ReportComment[] {
  ensurePlatformReady()
  return getDb().prepare(
    `SELECT id, public_id, report_id, section_id, author_user_id, body,
            is_resolved, asana_task_gid, created_at, updated_at
       FROM platform_report_comments
      WHERE tenant_id = ? AND report_id = ? AND body != '_deleted_'
      ORDER BY created_at ASC`
  ).all(args.tenantId, args.reportId) as ReportComment[]
}

/** List all integrations for a tenant (all providers, all levels).
 *  Used by the PM dashboard health tile. */
export function listIntegrations(tenantId: number): Integration[] {
  ensurePlatformReady()
  return getDb().prepare(
    `SELECT * FROM platform_integrations WHERE tenant_id = ? ORDER BY provider, created_at DESC`
  ).all(tenantId) as Integration[]
}

/** List integrations scoped to a specific account. */
export function listIntegrationsForAccount(args: { tenantId: number; accountId: number }): Integration[] {
  ensurePlatformReady()
  return getDb().prepare(
    `SELECT * FROM platform_integrations
      WHERE tenant_id = ? AND account_id = ?
      ORDER BY provider, created_at DESC`
  ).all(args.tenantId, args.accountId) as Integration[]
}

/** List all reports for an account, newest first. */
export function listReportsForAccount(args: { tenantId: number; accountId: number }): Report[] {
  ensurePlatformReady()
  return getDb().prepare(
    `SELECT * FROM platform_reports
      WHERE tenant_id = ? AND account_id = ?
      ORDER BY period_end DESC, created_at DESC`
  ).all(args.tenantId, args.accountId) as Report[]
}
