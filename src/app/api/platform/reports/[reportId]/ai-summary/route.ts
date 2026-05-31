// POST /api/platform/reports/[reportId]/ai-summary
//
// Generates (or regenerates) the AI executive summary for a report.
// Tenant-scoped via assertTenantOwnsRow — no cross-tenant reads.
//
// Flow:
//   1. Resolve tenant + assert ownership of the report.
//   2. Load report sections + their snapshot envelopes (getReportWithSections).
//   3. Flatten scalar MetricValues into the ReportContext shape.
//   4. Call buildExecutiveSummaryPrompt() → { system, user }.
//   5. Call Anthropic claude-sonnet-4-6 (max_tokens: 500).
//   6. Persist: ai_summary block → rendered_cache_json; section → description_html.
//   7. Return { ok, summaryText, generatedAt }.
//
// PATCH /api/platform/reports/[reportId]/ai-summary
//
// Persists a PM-edited version of the summary text.
//
// Body: { sectionId: number, blockId: number, text: string }
// Writes text to section.description_html.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getReportWithSections } from '@/lib/platform/reports'
import { buildExecutiveSummaryPrompt } from '@/lib/platform/ai-summary-prompt'
import { getDb } from '@/lib/db'
import type { MetricValue, MetricSeries, MetricEnvelope } from '@/lib/platform/adapter-contract'
import type { ReportContext } from '@/lib/platform/ai-summary-prompt'
import type { ReportWithSections } from '@/lib/platform/reports'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMetricValue(m: MetricValue | MetricSeries | undefined): m is MetricValue {
  return !!m && 'value' in m
}

/** Humanize a metric slug: "traffic.users" → "Users" */
function humanizeSlug(slug: string | null | undefined): string {
  if (!slug) return 'Metric'
  const parts = slug.split('.')
  const last = parts[parts.length - 1] ?? slug
  return last
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Narrow MetricValue.unit to the subset accepted by ReportContext.
 *  GSC adds 'rank'; strip any unknown unit so the prompt context stays typed. */
function safeUnit(
  unit: MetricValue['unit'] | string | undefined
): ReportContext['sections'][number]['metrics'][number]['unit'] {
  const allowed = new Set(['ms', '%', 'USD', 'count', 'hours'] as const)
  if (!unit) return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return allowed.has(unit as any) ? (unit as 'ms' | '%' | 'USD' | 'count' | 'hours') : undefined
}

/** Build the ReportContext from the assembled report + snapshot data.
 *  Sprint 2: also builds previousPeriod sections when previousEnvelope is present
 *  on blocks. ricky's prompt update handles the delta-driven narrative. */
function buildReportContext(report: ReportWithSections): ReportContext {
  const sections: ReportContext['sections'] = []
  const previousSections: ReportContext['sections'] = []
  // Track previous-period dates from whatever envelope provides them first.
  // ricky's prompt v2 requires periodStart + periodEnd on previousPeriod so
  // the delta-driven paragraph can cite the comparison month by name.
  let prevPeriodStart: string | null = null
  let prevPeriodEnd: string | null = null

  for (const section of report.sections) {
    // Skip the AI summary section — no data blocks.
    if (section.blocks.some((b) => b.block_type === 'ai_summary')) continue

    // Skip Financial Summary — its data is internal (decision #5) and the AI
    // Executive Summary is shown on the PUBLIC client share, so financial
    // figures (invoiced/outstanding/AR) must never flow into the narrative.
    const sectionType = (section as { section_type?: string | null }).section_type
    if (sectionType === 'financial_summary' || section.blocks.some((b) => b.metric_slug?.startsWith('finance.'))) continue

    const metrics: ReportContext['sections'][number]['metrics'] = []
    const prevMetrics: ReportContext['sections'][number]['metrics'] = []

    for (const block of section.blocks) {
      const envelope = block.envelope as MetricEnvelope | null
      const prevEnvelope = block.previousEnvelope as MetricEnvelope | null
      if (!block.metric_slug) continue

      // First non-null previousEnvelope carries the period dates.
      if (prevEnvelope && !prevPeriodStart) {
        prevPeriodStart = prevEnvelope.periodStart
        prevPeriodEnd = prevEnvelope.periodEnd
      }

      // Current period scalar.
      if (envelope?.metrics) {
        const metric = envelope.metrics[block.metric_slug]
        if (isMetricValue(metric)) {
          metrics.push({
            label: block.title || humanizeSlug(block.metric_slug),
            value: metric.value,
            unit: safeUnit(metric.unit),
          })
        }
      }

      // Previous period scalar.
      if (prevEnvelope?.metrics) {
        const prevMetric = prevEnvelope.metrics[block.metric_slug]
        if (isMetricValue(prevMetric)) {
          prevMetrics.push({
            label: block.title || humanizeSlug(block.metric_slug),
            value: prevMetric.value,
            unit: safeUnit(prevMetric.unit),
          })
        }
      }
    }

    if (metrics.length > 0) {
      sections.push({ title: section.title, metrics })
    }
    if (prevMetrics.length > 0) {
      previousSections.push({ title: section.title, metrics: prevMetrics })
    }
  }

  const context: ReportContext = {
    clientName: report.account_name,
    periodStart: report.period_start,
    periodEnd: report.period_end,
    sections,
  }

  // Client-card context — tailors framing, voice, and the forward-looking
  // sentence. Never a source of numbers (the prompt's hallucination guard holds).
  const cp = getDb().prepare(
    'SELECT industry, goals, services, target_audience, brand_voice, location FROM client_profiles WHERE id = ?'
  ).get(report.account_id) as
    | { industry: string | null; goals: string | null; services: string | null; target_audience: string | null; brand_voice: string | null; location: string | null }
    | undefined
  if (cp && (cp.industry || cp.goals || cp.services || cp.target_audience || cp.brand_voice || cp.location)) {
    context.clientContext = {
      industry: cp.industry, goals: cp.goals, services: cp.services,
      audience: cp.target_audience, brandVoice: cp.brand_voice, location: cp.location,
    }
  }

  // Only attach previousPeriod when we have comparison data AND the dates
  // to anchor it. ricky's prompt v2 reads periodStart + periodEnd to write
  // "from <Mar> to <Apr>" deltas. Without dates the prompt renders
  // "undefined to undefined" — caught at qa-engineer review.
  if (previousSections.length > 0 && prevPeriodStart && prevPeriodEnd) {
    context.previousPeriod = {
      periodStart: prevPeriodStart,
      periodEnd: prevPeriodEnd,
      sections: previousSections,
    }
  }

  return context
}

// ─── POST: generate ───────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId: reportIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
  } catch {
    return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })
  }

  const report = getReportWithSections({ reportId, tenantId: tenant.id })
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  // Should-fix #1: rate-limit check — prevent burning Anthropic budget on
  // rapid regeneration. If the AI summary block was rendered within the last
  // 60 seconds, return 429 with retryAfterSeconds.
  const db = getDb()
  const aiSectionRow = report.sections.find((s) =>
    s.blocks.some((b) => b.block_type === 'ai_summary')
  )
  const aiBlockRow = aiSectionRow?.blocks.find((b) => b.block_type === 'ai_summary')
  if (aiBlockRow?.rendered_at) {
    const secondsSinceRender = Math.floor(Date.now() / 1000) - aiBlockRow.rendered_at
    const rateLimitWindow = 60
    if (secondsSinceRender < rateLimitWindow) {
      const retryAfterSeconds = rateLimitWindow - secondsSinceRender
      return NextResponse.json(
        {
          error: `AI summary was generated recently — please wait ${retryAfterSeconds} second${retryAfterSeconds !== 1 ? 's' : ''} before regenerating.`,
          retryAfterSeconds,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        }
      )
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }

  try {
    // Build the prompt context from the report's section data.
    const context = buildReportContext(report)
    const { system, user } = buildExecutiveSummaryPrompt(context)

    // Call Anthropic — mirrors the pattern in meeting-processor.ts.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[platform/ai-summary] Anthropic error:', errText)
      return NextResponse.json(
        { error: `Anthropic request failed (${res.status})` },
        { status: 502 }
      )
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>
    }
    const summaryText = data.content?.[0]?.type === 'text'
      ? (data.content[0].text ?? '')
      : ''

    if (!summaryText) {
      return NextResponse.json({ error: 'Empty response from Anthropic' }, { status: 502 })
    }

    const generatedAt = new Date().toISOString()
    const db = getDb()

    // Find the AI summary section + block.
    const aiSection = report.sections.find((s) =>
      s.blocks.some((b) => b.block_type === 'ai_summary')
    )
    const aiBlock = aiSection?.blocks.find((b) => b.block_type === 'ai_summary')

    if (aiBlock) {
      // Persist rendered_cache_json on the block row.
      const cacheJson = JSON.stringify({
        ai_text: summaryText,
        generated_at: generatedAt,
        model: 'claude-sonnet-4-6',
      })
      db.prepare(
        `UPDATE platform_report_blocks
            SET rendered_cache_json = ?, rendered_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`
      ).run(
        cacheJson,
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        aiBlock.id,
        tenant.id,
      )
    }

    if (aiSection) {
      // Persist description_html on the section row — this is the PM-editable copy.
      db.prepare(
        `UPDATE platform_report_sections
            SET description_html = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`
      ).run(
        summaryText,
        Math.floor(Date.now() / 1000),
        aiSection.id,
        tenant.id,
      )
    }

    return NextResponse.json({ ok: true, summaryText, generatedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/ai-summary] POST error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── PATCH: persist PM edit ───────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId: reportIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }

  let body: { sectionId?: unknown; blockId?: unknown; text?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sectionId = typeof body.sectionId === 'number' ? body.sectionId : null
  const text = typeof body.text === 'string' ? body.text.trim() : null

  if (!sectionId || !text) {
    return NextResponse.json({ error: 'sectionId and text are required' }, { status: 400 })
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
    assertTenantOwnsRow(tenant, 'platform_report_sections', sectionId)
  } catch {
    return NextResponse.json({ error: 'Not found or access denied' }, { status: 404 })
  }

  // Cross-report guard: the section must belong to THIS report (not just this
  // tenant). Without this, a PM could PATCH /reports/5/ai-summary with a
  // sectionId from report 10 and overwrite the wrong report's summary.
  const db = getDb()
  const sectionRow = db.prepare(
    'SELECT report_id FROM platform_report_sections WHERE id = ? AND tenant_id = ?'
  ).get(sectionId, tenant.id) as { report_id: number } | undefined
  if (!sectionRow || sectionRow.report_id !== reportId) {
    return NextResponse.json({ error: 'Section does not belong to this report' }, { status: 404 })
  }

  try {
    db.prepare(
      `UPDATE platform_report_sections
          SET description_html = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    ).run(text, Math.floor(Date.now() / 1000), sectionId, tenant.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/ai-summary] PATCH error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
