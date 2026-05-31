// /r/[token] — Public read-only report renderer.
//
// Public route — NO auth required. Access is gated solely by token existence.
// The token is the proof of access; if it's not in the DB, 404.
//
// Renders the same section dispatcher as the PM report page but with
// readOnly=true passed to all section components (no Edit, no Regenerate,
// no Refresh data buttons). Shows Hiilite branding footer.

import { notFound } from 'next/navigation'
import Image from 'next/image'
import { getDb } from '@/lib/db'
import { initPlatformSchema } from '@/lib/platform/schema'
import { getLatestSnapshot } from '@/lib/platform/snapshots'
import type { Report, ReportSection, ReportBlock, Integration } from '@/lib/platform/types'
import type { MetricEnvelope } from '@/lib/platform/adapter-contract'
import type { SectionWithBlocks, BlockWithData } from '@/lib/platform/reports'
import { parseSectionSettings } from '@/lib/platform/reports'
import { SearchPerformanceSection } from '@/app/platform/reports/_components/SearchPerformanceSection'
import { TrafficOverviewSection } from '@/app/platform/reports/_components/TrafficOverviewSection'
import { SiteHealthSection } from '@/app/platform/reports/_components/SiteHealthSection'
import { SiteHealthV2Section } from '@/app/platform/reports/_components/SiteHealthV2Section'
import { TasksCompletedSection } from '@/app/platform/reports/_components/TasksCompletedSection'
import { HoursInvestedSection } from '@/app/platform/reports/_components/HoursInvestedSection'
import { RankMovementSection } from '@/app/platform/reports/_components/RankMovementSection'
import { FormConversionsSection } from '@/app/platform/reports/_components/FormConversionsSection'
import { AIExecutiveSummarySection } from '@/app/platform/reports/_components/AIExecutiveSummarySection'
import { BlockRenderer } from '@/app/platform/reports/_components/BlockRenderer'

interface PageProps {
  params: Promise<{ token: string }>
}

interface ReportWithSectionsPublic extends Report {
  account_name: string
  sections: SectionWithBlocks[]
}

function readConfigJson<T extends Record<string, unknown>>(
  integrationId: number | null | undefined
): T | null {
  if (!integrationId) return null
  const db = getDb()
  const row = db
    .prepare('SELECT config_json FROM platform_integrations WHERE id = ?')
    .get(integrationId) as { config_json: string | null } | undefined
  if (!row?.config_json) return null
  try {
    return JSON.parse(row.config_json) as T
  } catch {
    return null
  }
}

function renderSectionReadOnly(section: SectionWithBlocks) {
  const firstIntegrationId = section.blocks.find((b) => b.integration_id)?.integration_id
  const envelope = section.blocks.find((b) => b.envelope !== null)?.envelope ?? null
  const sectionType = section.section_type

  const isSearchPerformance =
    sectionType === 'search_performance' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('search_performance.'))
  const isTrafficOverview =
    sectionType === 'traffic_overview' ||
    section.blocks.some((b) => b.metric_slug?.startsWith('traffic.'))
  const isSiteHealth =
    sectionType === 'site_health' ||
    (section.blocks.some((b) => b.metric_slug?.startsWith('site_health.')) &&
      !section.blocks.some((b) => b.metric_slug?.startsWith('wp.')))
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
  const isAiSummary =
    sectionType === 'ai_summary' ||
    section.blocks.some((b) => b.block_type === 'ai_summary')

  if (isAiSummary) {
    const aiBlock = section.blocks.find((b) => b.block_type === 'ai_summary')
    let initialText = section.description_html ?? ''
    if (!initialText && aiBlock?.rendered_cache_json) {
      try {
        const cached = JSON.parse(aiBlock.rendered_cache_json) as { ai_text?: string }
        initialText = cached.ai_text ?? ''
      } catch {
        // ignore
      }
    }
    // Read-only mode: render as a plain styled div instead of the interactive client component.
    return (
      <section key={section.id} className="mb-10">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">{section.title}</h2>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {initialText ? (
            <p className="text-sm text-gray-700 leading-relaxed">{initialText}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">Summary not yet generated.</p>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-3">Generated by AI — reviewed by your account manager.</p>
      </section>
    )
  }

  if (isSearchPerformance) {
    const config = readConfigJson<{ siteUrl?: string }>(firstIntegrationId)
    return (
      <SearchPerformanceSection
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        siteUrl={config?.siteUrl ?? null}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
      />
    )
  }

  if (isTrafficOverview) {
    const config = readConfigJson<{ propertyId?: string; displayName?: string }>(firstIntegrationId)
    const propertyName = config?.displayName ?? (config?.propertyId ? `Property ${config.propertyId}` : null)
    return (
      <TrafficOverviewSection
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        propertyName={propertyName}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
      />
    )
  }

  if (isSiteHealthV2) {
    const config = readConfigJson<{ siteUrl?: string }>(firstIntegrationId)
    return (
      <SiteHealthV2Section
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        siteUrl={config?.siteUrl ?? null}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
      />
    )
  }

  if (isSiteHealth) {
    const config = readConfigJson<{ url?: string; strategy?: 'mobile' | 'desktop' }>(firstIntegrationId)
    return (
      <SiteHealthSection
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        auditUrl={config?.url ?? null}
        strategy={config?.strategy ?? 'mobile'}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
      />
    )
  }

  if (isRankMovement) {
    const config = readConfigJson<{ projectId?: string; projectName?: string }>(firstIntegrationId)
    return (
      <RankMovementSection
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        projectName={config?.projectName ?? null}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
        readOnly
      />
    )
  }

  if (isFormConversions) {
    const config = readConfigJson<{ siteUrl?: string; formIds?: string[] }>(firstIntegrationId)
    return (
      <FormConversionsSection
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        siteUrl={config?.siteUrl ?? null}
        formsTrackedCount={config?.formIds?.length ?? null}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
        readOnly
      />
    )
  }

  if (isTasksCompleted) {
    const config = readConfigJson<{ workspaceId?: string; workspaceDisplayName?: string }>(firstIntegrationId)
    const workspaceName = config?.workspaceDisplayName ?? null
    return (
      <TasksCompletedSection
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        workspaceName={workspaceName}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
      />
    )
  }

  if (isHoursInvested) {
    const db = getDb()
    let everhourIdentifier: string | null = null
    if (firstIntegrationId) {
      const row = db
        .prepare('SELECT display_name FROM platform_integrations WHERE id = ?')
        .get(firstIntegrationId) as { display_name: string | null } | undefined
      everhourIdentifier = row?.display_name ?? null
    }
    return (
      <HoursInvestedSection
        key={section.id}
        title={section.title}
        descriptionHtml={section.description_html}
        envelope={envelope}
        everhourIdentifier={everhourIdentifier}
        periodStart={envelope?.periodStart ?? ''}
        periodEnd={envelope?.periodEnd ?? ''}
      />
    )
  }

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
    </section>
  )
}

function getPublicReport(token: string): ReportWithSectionsPublic | null {
  initPlatformSchema(getDb())
  const db = getDb()

  // Phase C: account_id on platform_reports references client_profiles.id.
  const report = db
    .prepare(
      `SELECT r.*, cp.name AS account_name
         FROM platform_reports r
         JOIN client_profiles cp ON cp.id = r.account_id
        WHERE r.share_token = ?`
    )
    .get(token) as (Report & { account_name: string }) | undefined

  if (!report) return null

  // Exclude PM-hidden sections from the public client view entirely — they're
  // never rendered or sent to the client.
  const sections = db
    .prepare(
      `SELECT * FROM platform_report_sections
        WHERE report_id = ? AND (is_hidden IS NULL OR is_hidden = 0)
          AND (section_type IS NULL OR section_type != 'financial_summary')
        ORDER BY position ASC`
    )
    .all(report.id) as (ReportSection & { section_type?: string })[]

  const sectionIds = sections.map((s) => s.id)
  const allBlocks: ReportBlock[] = sectionIds.length
    ? (db
        .prepare(
          `SELECT * FROM platform_report_blocks
            WHERE section_id IN (${sectionIds.map(() => '?').join(',')})
            ORDER BY section_id, position ASC`
        )
        .all(...sectionIds) as ReportBlock[])
    : []

  const sectionsWithBlocks: SectionWithBlocks[] = sections.map((section) => {
    const blocks = allBlocks
      .filter((b) => b.section_id === section.id)
      .map((block): BlockWithData => {
        let envelope: MetricEnvelope | null = null
        if (block.integration_id) {
          const snap = getLatestSnapshot({
            tenant_id: report.tenant_id,
            integration_id: block.integration_id,
            asOf: report.period_end,
          })
          envelope = snap?.normalized ?? null
        }
        return { ...block, envelope, previousEnvelope: null }
      })
    return { ...section, blocks, section_type: section.section_type, settings: parseSectionSettings(section.settings_json) }
  })

  return { ...report, sections: sectionsWithBlocks }
}

export default async function PublicReportPage({ params }: PageProps) {
  const { token } = await params

  if (!token || token.length < 8) notFound()

  const report = getPublicReport(token)
  if (!report) notFound()

  const periodLabel = new Date(report.period_start + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const footerDate = new Date().toISOString().slice(0, 10)

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Public header — Hiilite branding, no PM controls */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 min-h-14 flex items-center justify-between gap-4 py-2 sm:py-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Hiilite logo */}
            <div className="flex items-center gap-2">
              <img
                src="/hiilite-logo.svg"
                alt="Hiilite"
                className="h-6 w-auto"
                onError={(e) => {
                  // Fallback if SVG not found
                  const el = e.target as HTMLImageElement
                  el.style.display = 'none'
                }}
              />
              <span className="text-sm font-semibold text-gray-800 leading-none">Hiilite</span>
            </div>
            <span className="text-gray-200">|</span>
            <div className="min-w-0">
              <span className="text-sm font-medium text-gray-700 truncate block">
                {report.account_name}
              </span>
              <span className="text-xs text-gray-400">{periodLabel}</span>
            </div>
          </div>
          {/* Download PDF — token-scoped public route added in Phase 3 Sprint 1 */}
          <a
            href={`/r/${report.share_token}/pdf`}
            className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 flex-shrink-0"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download PDF
          </a>
        </div>
      </div>

      {/* Report body */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <div className="mb-6 md:mb-8">
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 leading-snug">{report.name}</h1>
          <p className="text-sm text-gray-400 mt-1">
            {report.period_start} &ndash; {report.period_end}
          </p>
        </div>

        {report.sections.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">This report has no sections.</div>
        ) : (
          report.sections.map((s) => renderSectionReadOnly(s))
        )}

        {/* Footer */}
        <div className="mt-10 md:mt-12 pt-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-400">
            Generated by Hiilite Platform &middot; {footerDate}
          </p>
        </div>
      </div>
    </main>
  )
}
