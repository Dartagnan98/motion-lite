// PATCH /api/platform/reports/[reportId]/sections
//
// Persists section order + visibility for a report AND saves it as the client's
// default layout (so future reports for this client open the same way).
// Tenant-scoped via assertTenantOwnsRow — no cross-tenant writes.
//
// Body: { layout: { sectionId: number, position: number, isHidden: boolean }[] }
// Response: { ok: true }
//
// Used by both the Organize panel (batch reorder + visibility) and the inline
// per-section eye toggle (sends the full current layout with one flag flipped).

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { saveReportLayout, type SectionLayoutEntry } from '@/lib/platform/reports'
import { getDb } from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId: reportIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }

  let body: { layout?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.layout)) {
    return NextResponse.json({ error: 'layout must be an array' }, { status: 400 })
  }

  const layout: SectionLayoutEntry[] = []
  for (const raw of body.layout) {
    const e = raw as { sectionId?: unknown; position?: unknown; isHidden?: unknown }
    if (typeof e.sectionId !== 'number' || typeof e.position !== 'number') {
      return NextResponse.json(
        { error: 'each layout entry needs numeric sectionId + position' },
        { status: 400 }
      )
    }
    layout.push({ sectionId: e.sectionId, position: e.position, isHidden: e.isHidden === true })
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

  // Resolve the account so the layout can be saved as the client default.
  const row = getDb().prepare(
    'SELECT account_id FROM platform_reports WHERE id = ? AND tenant_id = ?'
  ).get(reportId, tenant.id) as { account_id: number } | undefined
  if (!row) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  saveReportLayout({
    tenantId: tenant.id,
    accountId: row.account_id,
    reportId,
    layout,
  })

  return NextResponse.json({ ok: true })
}
