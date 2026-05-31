// /platform/reports/[reportId]
//
// Report renderer — server component.
//
// Loads the report row + sections + blocks from DB, resolves snapshot data,
// and renders each section using the appropriate section component.
//
// Tiptap divergence note (Sprint 2):
//   This file uses plain RSC. Phase 2 wraps sections in Tiptap custom nodes
//   so PMs can drag-reorder and inline-edit before sending. The seam is the
//   SectionWithBlocks loop below — Phase 2 replaces it with a Tiptap editor
//   initialized from the same data. No breaking changes to the data layer.
//
// Auto-seed behavior:
//   If reportId=0 or the report row is not found, the page attempts to find
//   a connected GSC integration for the workspace's default account and seeds
//   a "Search Performance" report automatically. See src/lib/platform/reports.ts.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentWorkspaceId, getCurrentAccountId } from '@/lib/platform/tenant'
import {
  getReportWithSections,
  listReportsForAccount,
  listCommentsForReport,
  seedSeoRetainerReport,
  reconcileReportSections,
  POINT_IN_TIME_PROVIDERS,
  findGscIntegration,
  findGa4Integration,
  findPagespeedIntegration,
  findAsanaIntegration,
  findEverhourIntegration,
  findSeRankingIntegration,
  findWordpressIntegration,
  findGravityFormsIntegration,
} from '@/lib/platform/reports'
import { getDb } from '@/lib/db'
import { getSnapshotForPeriod } from '@/lib/platform/snapshots'
import { SearchPerformanceSection } from '../_components/SearchPerformanceSection'
import { TrafficOverviewSection } from '../_components/TrafficOverviewSection'
import { SiteHealthSection } from '../_components/SiteHealthSection'
import { SiteHealthV2Section } from '../_components/SiteHealthV2Section'
import { RankMovementSection } from '../_components/RankMovementSection'
import { FormConversionsSection } from '../_components/FormConversionsSection'
import { TasksCompletedSection } from '../_components/TasksCompletedSection'
import { HoursInvestedSection } from '../_components/HoursInvestedSection'
import { FinancialSummarySection } from '../_components/FinancialSummarySection'
import { ConversionsSection } from '../_components/ConversionsSection'
import { AutoFetchOnLoad } from '../_components/AutoFetchOnLoad'
import { AIExecutiveSummarySection } from '../_components/AIExecutiveSummarySection'
import { BlockRenderer } from '../_components/BlockRenderer'
import { RefetchButton } from '../_components/RefetchButton'
import { SharePopover } from '../_components/SharePopover'
import { ReportPeriodSelector } from '../_components/ReportPeriodSelector'
import { CommentThread } from '../_components/CommentThread'
import { OrganizeSectionsPanel } from '../_components/OrganizeSectionsPanel'
import { SectionControlBar } from '../_components/SectionControlBar'
import { SectionShell } from '../_components/SectionShell'
import type { SectionWithBlocks, ReportComment } from '@/lib/platform/reports'
import type { Integration } from '@/lib/platform/types'
import type { MetricEnvelope } from '@/lib/platform/adapter-contract'

interface PageProps {
  params: Promise<{ reportId: string }>
  searchParams: Promise<{ accountId?: string; standalone?: string }>
}

// ─── Helpers ──────────────────────────────────────────────────────────


function getSiteUrl(integration: Integration | null): string | null {
  if (!integration?.config_json) return null
  try {
    const c = JSON.parse(integration.config_json) as { siteUrl?: string }
    return c.siteUrl ?? null
  } catch {
    return null
  }
}

// ─── Section dispatcher ───────────────────────────────────────────────

function readConfigJson<T extends Record<string, unknown>>(
  integrationId: number | null | undefined,
): T | null {
  if (!integrationId) return null
  const db = getDb()
  const row = db.prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row?.config_json) return null
  try {
    return JSON.parse(row.config_json) as T
  } catch {
    return null
  }
}

function renderSection(
  section: SectionWithBlocks,
  reportId: number,
  allComments: ReportComment[],
  currentUserId: number,
  currentUserName: string,
  reportMeta?: { accountId: number; periodStart: string; periodEnd: string },
) {
  const firstIntegrationId = section.blocks.find((b) => b.integration_id)?.integration_id
  const envelope = section.blocks.find((b) => b.envelope !== null)?.envelope ?? null
  const previousEnvelope: MetricEnvelope | null =
    section.blocks.find((b) => b.previousEnvelope !== null)?.previousEnvelope ?? null

  // Dispatch by section_type — stored on the section row as section_type column.
  // Fall back to slug-prefix detection for Phase 1 reports that pre-date the
  // section_type column.
  const sectionType = (section as SectionWithBlocks & { section_type?: string }).section_type

  const isSearchPerformance =
    sectionType === 'search_performance' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('search_performance.'))

  const isTrafficOverview =
    sectionType === 'traffic_overview' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('traffic.'))

  const isSiteHealth =
    sectionType === 'site_health' ||
    (
      (
        section.blocks.some((b) => b.metric_slug?.startsWith('site_health.')) ||
        section.blocks.some((b) => b.metric_slug?.startsWith('pagespeed.'))
      ) &&
      !section.blocks.some((b) => b.metric_slug?.startsWith('wp.'))
    )

  const isSiteHealthV2 =
    sectionType === 'site_health_v2' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('wp.'))

  const isRankMovement =
    sectionType === 'rank_movement' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('rank.'))

  const isFormConversions =
    sectionType === 'form_conversions' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('forms.'))

  const isTasksCompleted =
    sectionType === 'tasks_completed' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('tasks.'))

  const isHoursInvested =
    sectionType === 'hours_invested' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('hours.'))

  const isFinancialSummary =
    sectionType === 'financial_summary' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('finance.'))

  const isConversions =
    sectionType === 'conversions' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('ga4.conversions'))

  const isAiSummary =
    sectionType === 'ai_summary' ||
    section.blocks.some((b) => b.block_type === 'ai_summary')

  const commentThreadEl = (
    <CommentThread
      reportId={reportId}
      sectionId={section.id}
      initialComments={allComments}
      currentUserId={currentUserId}
      currentUserName={currentUserName}
    />
  )

  if (isAiSummary) {
    // Find the AI summary block to get its id and cached content.
    const aiBlock = section.blocks.find((b) => b.block_type === 'ai_summary')
    // Prefer description_html on the section (PM-editable copy); fall back to
    // rendered_cache_json.ai_text if the section text hasn't been written yet.
    let initialText = section.description_html ?? ''
    if (!initialText && aiBlock?.rendered_cache_json) {
      try {
        const cached = JSON.parse(aiBlock.rendered_cache_json) as { ai_text?: string }
        initialText = cached.ai_text ?? ''
      } catch {
        // ignore parse errors
      }
    }
    return (
      <div key={section.id}>
        <AIExecutiveSummarySection
          reportId={reportId}
          sectionId={section.id}
          blockId={aiBlock?.id ?? 0}
          initialText={initialText}
          title={section.title}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isSearchPerformance) {
    const config = readConfigJson<{ siteUrl?: string }>(firstIntegrationId)
    return (
      <div key={section.id}>
        <SearchPerformanceSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          siteUrl={config?.siteUrl ?? null}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isTrafficOverview) {
    const config = readConfigJson<{ propertyId?: string; displayName?: string }>(firstIntegrationId)
    const propertyName = config?.displayName ?? (config?.propertyId ? `Property ${config.propertyId}` : null)
    return (
      <div key={section.id}>
        <TrafficOverviewSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          propertyName={propertyName}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isSiteHealth) {
    const config = readConfigJson<{ url?: string; strategy?: 'mobile' | 'desktop' }>(firstIntegrationId)
    return (
      <div key={section.id}>
        <SiteHealthSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          auditUrl={config?.url ?? null}
          strategy={config?.strategy ?? 'mobile'}
          integrationId={firstIntegrationId ?? null}
          accountId={reportMeta?.accountId ?? null}
          periodStart={reportMeta?.periodStart ?? envelope?.periodStart ?? ''}
          periodEnd={reportMeta?.periodEnd ?? envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isSiteHealthV2) {
    const config = readConfigJson<{ siteUrl?: string }>(firstIntegrationId)
    return (
      <div key={section.id}>
        <SiteHealthV2Section
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          siteUrl={config?.siteUrl ?? null}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isRankMovement) {
    const config = readConfigJson<{ projectId?: string; projectName?: string }>(firstIntegrationId)
    return (
      <div key={section.id}>
        <RankMovementSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          projectName={config?.projectName ?? null}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isFormConversions) {
    const config = readConfigJson<{ siteUrl?: string; formIds?: string[] }>(firstIntegrationId)
    return (
      <div key={section.id}>
        <FormConversionsSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          siteUrl={config?.siteUrl ?? null}
          formsTrackedCount={config?.formIds?.length ?? null}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isTasksCompleted) {
    const config = readConfigJson<{ workspaceId?: string; workspaceDisplayName?: string }>(firstIntegrationId)
    const workspaceName = config?.workspaceDisplayName ?? (config?.workspaceId ? `Workspace ${config.workspaceId}` : null)
    return (
      <div key={section.id}>
        <TasksCompletedSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          workspaceName={workspaceName}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isHoursInvested) {
    // Everhour display_name from the integration row is the identifier shown in the header.
    const db = getDb()
    let everhourIdentifier: string | null = null
    if (firstIntegrationId) {
      const row = db.prepare(
        'SELECT display_name FROM platform_integrations WHERE id = ?'
      ).get(firstIntegrationId) as { display_name: string | null } | undefined
      everhourIdentifier = row?.display_name ?? null
    }
    return (
      <div key={section.id}>
        <HoursInvestedSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          everhourIdentifier={everhourIdentifier}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isFinancialSummary) {
    return (
      <div key={section.id}>
        <FinancialSummarySection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  if (isConversions) {
    const config = readConfigJson<{ propertyId?: string; displayName?: string }>(firstIntegrationId)
    const propertyName = config?.displayName ?? (config?.propertyId ? `Property ${config.propertyId}` : null)
    return (
      <div key={section.id}>
        <ConversionsSection
          title={section.title}
          descriptionHtml={section.description_html}
          envelope={envelope}
          previousEnvelope={previousEnvelope}
          propertyName={propertyName}
          periodStart={envelope?.periodStart ?? ''}
          periodEnd={envelope?.periodEnd ?? ''}
        />
        {commentThreadEl}
      </div>
    )
  }

  // Generic section: render blocks in order using BlockRenderer.
  // PHASE2-TIPTAP: this becomes the Tiptap editor surface.
  return (
    <section key={section.id} className="mb-10">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">{section.title}</h2>
      {section.description_html && (
        <div
          className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: section.description_html }}
        />
      )}
      <div className="space-y-4">
        {section.blocks.map((block) => (
          <BlockRenderer
            key={block.id}
            blockType={block.block_type}
            title={block.title}
            metricSlug={block.metric_slug}
            envelope={block.envelope}
          />
        ))}
      </div>
      {commentThreadEl}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────

export default async function ReportPage({ params, searchParams }: PageProps) {
  const { reportId: reportIdStr } = await params
  const sp = await searchParams
  const accountIdStr = sp.accountId
  // `?standalone` is appended by the Puppeteer PDF render. In that mode we
  // SKIP AutoFetchOnLoad — the PDF route waits on `networkidle`, and
  // AutoFetchOnLoad keeps the network busy with refetches that easily exceed
  // the 30s timeout. The DB state at render time is what gets baked into the PDF.
  const isStandalone = sp.standalone !== undefined

  const user = await getCurrentUser()
  if (!user) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-sm w-full text-center">
          <p className="text-gray-600 mb-4">Sign in to view this report.</p>
          <Link href="/login" className="text-blue-600 text-sm font-medium hover:underline">
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) redirect('/login')
  const tenant = ensureTenantForWorkspace(workspaceId)

  const reportId = parseInt(reportIdStr, 10)
  let report = !isNaN(reportId) && reportId > 0
    ? getReportWithSections({ reportId, tenantId: tenant.id })
    : null

  // Auto-seed: if no report found, use the active account (from cookie / fallback)
  // rather than findAnyGscIntegration — Phase 3 multi-account fix.
  if (!report) {
    const activeAccountId = await getCurrentAccountId(tenant.id)
    if (activeAccountId) {
      const gscIntegration = findGscIntegration({ tenantId: tenant.id, accountId: activeAccountId })
      if (gscIntegration) {
        const existing = listReportsForAccount({
          tenantId: tenant.id,
          accountId: activeAccountId,
        })
        if (existing.length > 0) {
          // Use the most recent existing report instead of seeding a new one.
          report = getReportWithSections({ reportId: existing[0].id, tenantId: tenant.id })
        } else {
          // Detect additional integrations for this account to seed all available sections.
          const ga4 = findGa4Integration({ tenantId: tenant.id, accountId: activeAccountId })
          const pagespeed = findPagespeedIntegration({ tenantId: tenant.id, accountId: activeAccountId })
          const asana = findAsanaIntegration({ tenantId: tenant.id, accountId: activeAccountId })
          const everhour = findEverhourIntegration({ tenantId: tenant.id, accountId: activeAccountId })
          const seRanking = findSeRankingIntegration({ tenantId: tenant.id, accountId: activeAccountId })
          const wordpress = findWordpressIntegration({ tenantId: tenant.id, accountId: activeAccountId })
          const gravityForms = findGravityFormsIntegration({ tenantId: tenant.id, accountId: activeAccountId })

          // Look up account name for the report title.
          // Phase C: active account id is now client_profiles.id.
          const accountName = (getDb().prepare(
            'SELECT name FROM client_profiles WHERE id = ?'
          ).get(activeAccountId) as { name: string } | undefined)?.name ?? 'Client'

          const { reportId: newId } = seedSeoRetainerReport({
            tenantId: tenant.id,
            accountId: activeAccountId,
            gscIntegrationId: gscIntegration.id,
            ga4IntegrationId: ga4?.id ?? null,
            pagespeedIntegrationId: pagespeed?.id ?? null,
            seRankingIntegrationId: seRanking?.id ?? null,
            wordpressIntegrationId: wordpress?.id ?? null,
            gravityFormsIntegrationId: gravityForms?.id ?? null,
            asanaIntegrationId: asana?.id ?? null,
            everhourIntegrationId: everhour?.id ?? null,
            accountName,
          })
          report = getReportWithSections({ reportId: newId, tenantId: tenant.id })
        }
      }
    }
  }

  // Self-heal: sync the report's sections to the account's currently connected
  // integrations. Adds a section when a new connector was added, removes one
  // when a connector was disconnected — non-destructively (AI summary, period,
  // comments, and section edits are preserved). This is why no manual reseed is
  // needed after connecting/disconnecting an integration.
  if (report) {
    const { added, removed } = reconcileReportSections({
      tenantId: tenant.id,
      reportId: report.id,
      accountId: report.account_id,
    })
    if (added.length > 0 || removed.length > 0) {
      report = getReportWithSections({ reportId: report.id, tenantId: tenant.id })
    }
  }

  if (!report) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">No Report Found</h1>
          <p className="text-sm text-gray-600 mb-6">
            Connect a Google Search Console property first, then come back to see your report.
          </p>
          <Link
            href="/platform/connect"
            className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            Connect an Integration
          </Link>
        </div>
      </main>
    )
  }

  const periodLabel = `${new Date(report.period_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`

  // Comparison period: prefer the report's explicit compare window (GA-style
  // picker — persisted via /set-period). Fall back to the same-length window
  // immediately before period_start when no explicit compare is set.
  // The "Compared to" caption + section-level PoP deltas both key off this.
  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const priorPeriod = (() => {
    // Explicit compare set on the report row — use it verbatim.
    if (report.compare_period_start && report.compare_period_end) {
      return {
        start: report.compare_period_start,
        end: report.compare_period_end,
      }
    }
    // Auto-compute fallback: same-length window immediately before period_start.
    if (!report.period_start || !report.period_end) return null
    const dayMs = 86_400_000
    const start = new Date(report.period_start + 'T00:00:00')
    const end = new Date(report.period_end + 'T00:00:00')
    const lenDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1
    const priorEnd = new Date(start.getTime() - dayMs)
    const priorStart = new Date(priorEnd.getTime() - (lenDays - 1) * dayMs)
    return {
      start: priorStart.toISOString().slice(0, 10),
      end: priorEnd.toISOString().slice(0, 10),
    }
  })()

  // Collect unique integration IDs referenced by this report's blocks for the refetch button.
  const integrationIds = Array.from(
    new Set(
      report.sections
        .flatMap((s) => s.blocks)
        .map((b) => b.integration_id)
        .filter((id): id is number => id !== null)
    )
  )

  // Range-aware integrations only — these get re-fetched when the period
  // changes. Point-in-time providers (PageSpeed, SE Ranking) are skipped on a
  // range change (no history; re-fetching is slow + pointless) but still
  // included in the explicit "Refresh data" button.
  const allIntegrationRows = integrationIds.length
    ? (getDb().prepare(
        `SELECT id, provider FROM platform_integrations
          WHERE id IN (${integrationIds.map(() => '?').join(',')}) AND tenant_id = ?`
      ).all(...integrationIds, tenant.id) as { id: number; provider: string }[])
    : []

  // Map from integration_id → provider string — used per-section below.
  const providerByIntegrationId = new Map<number, string>(
    allIntegrationRows.map((r) => [r.id, r.provider])
  )

  const rangeAwareIntegrationIds = allIntegrationRows
    .filter((r) => !POINT_IN_TIME_PROVIDERS.has(r.provider))
    .map((r) => r.id)

  // Auto-fetch on generation: range-aware integrations with NO snapshot for the
  // report's exact period (e.g. a freshly generated report whose window drifted
  // past the last fetch). The client auto-fetches just these, once, then
  // refreshes — so "generate → see data" works without a manual Refresh.
  const autoFetchIntegrationIds = (report.period_start && report.period_end)
    ? rangeAwareIntegrationIds.filter((id) => !getSnapshotForPeriod({
        tenant_id: tenant.id,
        integration_id: id,
        periodStart: report.period_start,
        periodEnd: report.period_end,
        account_id: report.account_id,
      }))
    : []

  // Compute share URL if the report has a share token.
  // Report type includes share_token per types.ts; TypeScript needs the cast because
  // ReportWithSections extends beyond what the Report interface declares here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shareToken = (report as unknown as { share_token?: string | null }).share_token
  const footerDate = new Date().toISOString().slice(0, 10)

  // Load all comments for the report (server-side; passed to each section + report-level thread).
  const allComments = listCommentsForReport({ tenantId: tenant.id, reportId: report.id })
  const currentUserId = user.id
  const currentUserName = user.name ?? user.email ?? 'You'

  // Sprint 2: account-mismatch banner — if ?accountId param differs from
  // the resolved active account, show a warning so PMs know which context they're in.
  const activeAccountId = await getCurrentAccountId(tenant.id)
  const urlAccountId = accountIdStr ? parseInt(accountIdStr, 10) : null
  const accountMismatch =
    urlAccountId &&
    !isNaN(urlAccountId) &&
    activeAccountId &&
    urlAccountId !== activeAccountId

  // Lookup the mismatch account name if there is one.
  // Phase C: account ids are client_profiles.id values.
  let mismatchAccountName: string | null = null
  if (accountMismatch && urlAccountId) {
    const row = getDb().prepare(
      'SELECT name FROM client_profiles WHERE id = ? AND tenant_id = ?'
    ).get(urlAccountId, tenant.id) as { name: string } | undefined
    mismatchAccountName = row?.name ?? null
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Report header bar */}
      <div data-report-toolbar className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/platform/dashboard"
              className="text-gray-400 hover:text-gray-600 flex-shrink-0 transition-colors"
              aria-label="Back to dashboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            {/* Hiilite logo (white-label v1) */}
            <img
              src="/hiilite-logo.svg"
              alt="Hiilite"
              className="h-5 w-auto hidden sm:block flex-shrink-0"
              style={{ color: 'var(--platform-accent, #0891b2)' }}
            />
            <div className="min-w-0">
              {/* Client name only — the date range + comparison are shown by the
                  ReportPeriodSelector trigger on the right side of this bar, and
                  per-section KPI strips render their own "vs <prev>" captions. */}
              <span className="text-sm font-medium text-gray-900 truncate block">{report.account_name}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Period selector — also refetches integrations for the new window */}
            <ReportPeriodSelector
              reportId={report.id}
              currentPeriodStart={report.period_start}
              currentPeriodEnd={report.period_end}
              currentComparePeriodStart={report.compare_period_start ?? null}
              currentComparePeriodEnd={report.compare_period_end ?? null}
              integrationIds={rangeAwareIntegrationIds}
              accountId={report.account_id}
            />

            {/* Refresh data button — refetches all integrations for the selected window */}
            {integrationIds.length > 0 && (
              <RefetchButton
                integrationIds={integrationIds}
                variant="header"
                label="Refresh data"
                periodStart={report.period_start}
                periodEnd={report.period_end}
                accountId={report.account_id}
              />
            )}

            {/* Organize sections — reorder + show/hide */}
            <OrganizeSectionsPanel
              reportId={report.id}
              sections={report.sections.map((s) => ({
                id: s.id,
                title: s.title,
                sectionType: s.section_type ?? null,
                isHidden: s.is_hidden === 1,
              }))}
            />

            {/* Share button + popover */}
            <SharePopover
              reportId={report.id}
              initialShareUrl={shareToken ? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/r/${shareToken}` : null}
            />

            {/* Download PDF button */}
            <a
              href={`/api/platform/reports/${report.id}/pdf`}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download PDF
            </a>

            {/* Status pill */}
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              report.status === 'published'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {report.status}
            </span>
          </div>
        </div>
      </div>

      {/* Report body */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Sprint 2: account-mismatch banner */}
        {accountMismatch && mismatchAccountName && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800">
              You are viewing this report for <strong>{mismatchAccountName}</strong>,
              which differs from your active client.
            </p>
            <form action={`/api/platform/accounts/${urlAccountId}/activate`} method="POST">
              <button
                type="submit"
                className="text-xs font-medium text-amber-700 hover:text-amber-900 border border-amber-300
                           hover:border-amber-400 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap"
              >
                Switch to this client
              </button>
            </form>
          </div>
        )}

        {/* Report title — "<Client> — Hiilite Success Metrics Report" + a
            Report Period / Compared To subtitle. priorPeriod prefers the
            report's explicit compare columns, falling back to auto-computed. */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {report.account_name} — Hiilite Success Metrics Report
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {report.period_start && report.period_end && (
              <>
                Report Period: <span className="text-gray-700">{fmtDate(report.period_start)} – {fmtDate(report.period_end)}</span>
                {priorPeriod && (
                  <>
                    {' '}<span className="text-gray-300">|</span>{' '}
                    Compared To: <span className="text-gray-700">{fmtDate(priorPeriod.start)} – {fmtDate(priorPeriod.end)}</span>
                  </>
                )}
              </>
            )}
          </p>
        </div>

        {/* Auto-fetch data for this period if any range-aware integration is
            missing a snapshot (e.g. freshly generated report). data-report-toolbar
            keeps it out of the PDF; isStandalone skips it entirely during PDF
            generation so Puppeteer's networkidle wait doesn't time out on
            in-flight refetches. */}
        {!isStandalone && autoFetchIntegrationIds.length > 0 && (
          <div data-report-toolbar>
            <AutoFetchOnLoad
              integrationIds={autoFetchIntegrationIds}
              periodStart={report.period_start}
              periodEnd={report.period_end}
              accountId={report.account_id}
              reportId={report.id}
            />
          </div>
        )}

        {/* Sections */}
        {report.sections.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">
            This report has no sections yet.
          </div>
        ) : (
          report.sections.map((s, i) => {
            const hidden = s.is_hidden === 1
            // data-report-section + index drive the PDF page-break rule:
            // every section starts on a new page except index 0 (Exec Summary).
            // data-section-hidden drops the whole block from the PDF + share.
            // See src/lib/platform/pdf-print-css.ts.

            // Compute per-section provider metadata for the control bar.
            const sectionIntegrationIds = Array.from(
              new Set(
                s.blocks
                  .map((b) => b.integration_id)
                  .filter((id): id is number => id !== null)
              )
            )
            // A section is POINT_IN_TIME if it has at least one integration AND
            // every integration it uses is a point-in-time provider (no range semantics).
            const sectionProviders = sectionIntegrationIds.map(
              (id) => providerByIntegrationId.get(id) ?? ''
            )
            const isSectionPointInTime =
              sectionProviders.length > 0 &&
              sectionProviders.every((p) => POINT_IN_TIME_PROVIDERS.has(p))

            return (
              <div
                key={s.id}
                data-report-section
                data-section-index={i}
                data-section-hidden={hidden ? '' : undefined}
              >
                <SectionShell>
                  <SectionControlBar
                    reportId={report.id}
                    sectionId={s.id}
                    position={s.position}
                    title={s.title}
                    isHidden={hidden}
                    settings={s.settings}
                    isPointInTime={isSectionPointInTime}
                    integrationIds={sectionIntegrationIds}
                    reportPeriodStart={report.period_start}
                    reportPeriodEnd={report.period_end}
                    accountId={report.account_id}
                  />
                  {!hidden && renderSection(s, report.id, allComments, currentUserId, currentUserName, {
                    accountId: report.account_id,
                    periodStart: report.period_start,
                    periodEnd: report.period_end,
                  })}
                </SectionShell>
              </div>
            )
          })
        )}

        {/* Report-level comment thread (sectionId = null) */}
        <div data-report-comments-block className="mt-8">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
            Report-level Comments
          </h3>
          <CommentThread
            reportId={report.id}
            sectionId={null}
            initialComments={allComments}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
          />
        </div>

        {/* Footer — white-label v1 */}
        <div className="mt-12 pt-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-400">
            Generated by Hiilite Platform &middot; {footerDate}
          </p>
        </div>
      </div>
    </main>
  )
}
