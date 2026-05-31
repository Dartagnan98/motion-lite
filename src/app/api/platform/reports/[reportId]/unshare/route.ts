// POST /api/platform/reports/[reportId]/unshare
//
// Revokes the public share token for a report. The existing share URL
// will immediately return 404. Tenant-scoped via assertTenantOwnsRow.
//
// Response: { ok: true }

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'

interface PageParams {
  params: Promise<{ reportId: string }>
}

export async function POST(req: NextRequest, { params }: PageParams) {
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

  const db = getDb()
  db.prepare(
    `UPDATE platform_reports SET share_token = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?`
  ).run(Math.floor(Date.now() / 1000), reportId, tenant.id)

  return NextResponse.json({ ok: true })
}
