// POST /api/platform/accounts/[id]/clone-template
//
// Copies the most recent report's section + block structure from a source
// account to the destination account (the [id] in the path).
//
// Tenant-scoped on BOTH source and destination. integration_id is stripped
// so the new account must connect its own integrations.
//
// Body: { sourceAccountId: number }
// Response: { reportId: number }

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import {
  ensureTenantForWorkspace,
  assertTenantOwnsRow,
  getCurrentAccountId,
} from '@/lib/platform/tenant'
import { getDb, generatePublicId } from '@/lib/db'

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: idStr } = await params
  const destAccountId = parseInt(idStr, 10)
  if (isNaN(destAccountId) || destAccountId <= 0) {
    return NextResponse.json({ error: 'Invalid destination account id' }, { status: 400 })
  }

  let body: { sourceAccountId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sourceAccountId =
    typeof body.sourceAccountId === 'number' ? body.sourceAccountId : null
  if (!sourceAccountId || sourceAccountId <= 0) {
    return NextResponse.json({ error: 'sourceAccountId is required' }, { status: 400 })
  }

  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    // Guard both source and destination. Phase C: account_id values now reference client_profiles.
    assertTenantOwnsRow(tenant, 'client_profiles', destAccountId)
    assertTenantOwnsRow(tenant, 'client_profiles', sourceAccountId)

    const db = getDb()

    // Find the most recent report for the source account.
    const sourceReport = db
      .prepare(
        `SELECT * FROM platform_reports
          WHERE tenant_id = ? AND account_id = ?
          ORDER BY period_end DESC, created_at DESC LIMIT 1`
      )
      .get(tenant.id, sourceAccountId) as
      | { id: number; name: string; period_start: string; period_end: string }
      | undefined

    if (!sourceReport) {
      return NextResponse.json(
        { error: 'Source account has no reports to clone from.' },
        { status: 400 }
      )
    }

    // Look up destination account name for the new report title.
    const destAccount = db
      .prepare(`SELECT name FROM client_profiles WHERE id = ?`)
      .get(destAccountId) as { name: string } | undefined

    const now = Math.floor(Date.now() / 1000)

    // Compute a fresh 30-day period for the cloned report.
    const end = new Date()
    end.setDate(end.getDate() - 1)
    const start = new Date(end)
    start.setDate(start.getDate() - 29)
    const periodEnd = end.toISOString().slice(0, 10)
    const periodStart = start.toISOString().slice(0, 10)

    // Create the new report row.
    const reportResult = db
      .prepare(
        `INSERT INTO platform_reports
           (tenant_id, public_id, account_id, name, status, period_start, period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
      )
      .run(
        tenant.id,
        generatePublicId(),
        destAccountId,
        `${destAccount?.name ?? 'Client'} — SEO Retainer Report`,
        periodStart,
        periodEnd,
        now,
        now,
      )

    const newReportId = Number(reportResult.lastInsertRowid)

    // Copy sections from source report.
    const sourceSections = db
      .prepare(
        `SELECT * FROM platform_report_sections
          WHERE report_id = ? AND tenant_id = ?
          ORDER BY position ASC`
      )
      .all(sourceReport.id, tenant.id) as Array<{
        id: number
        position: number
        title: string
        description_html: string | null
        section_type: string | null
        settings_json: string | null
      }>

    for (const section of sourceSections) {
      const sectionResult = db
        .prepare(
          `INSERT INTO platform_report_sections
             (tenant_id, public_id, report_id, position, title, description_html, section_type, settings_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          tenant.id,
          generatePublicId(),
          newReportId,
          section.position,
          section.title,
          section.description_html,
          section.section_type,
          section.settings_json,
          now,
          now,
        )

      const newSectionId = Number(sectionResult.lastInsertRowid)

      // Copy blocks, stripping integration_id (new account must connect its own).
      const sourceBlocks = db
        .prepare(
          `SELECT * FROM platform_report_blocks
            WHERE section_id = ? AND tenant_id = ?
            ORDER BY position ASC`
        )
        .all(section.id, tenant.id) as Array<{
          position: number
          block_type: string
          title: string | null
          metric_slug: string | null
          config_json: string | null
        }>

      for (const block of sourceBlocks) {
        db.prepare(
          `INSERT INTO platform_report_blocks
             (tenant_id, public_id, section_id, position, block_type, title, integration_id, metric_slug, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
        ).run(
          tenant.id,
          generatePublicId(),
          newSectionId,
          block.position,
          block.block_type,
          block.title,
          block.metric_slug,
          block.config_json,
          now,
          now,
        )
      }
    }

    return NextResponse.json({ reportId: newReportId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (message.startsWith('assertTenantOwnsRow')) {
      return NextResponse.json({ error: 'Account not found or access denied' }, { status: 404 })
    }
    console.error('[api/platform/accounts/clone-template]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
