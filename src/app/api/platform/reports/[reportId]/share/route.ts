// POST /api/platform/reports/[reportId]/share
//
// Generates (or returns an existing) public share token for a report.
// Tenant-scoped via assertTenantOwnsRow. Token is 32-char URL-safe random.
//
// Response: { ok: true, token: string, shareUrl: string, generatedAt: string }

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'
import crypto from 'crypto'

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

  // Check if there's an existing share token (use the column that already exists on the schema:
  // platform_reports.share_token OR platform_reports.public_share_token — the schema uses share_token).
  const reportRow = db
    .prepare('SELECT share_token FROM platform_reports WHERE id = ? AND tenant_id = ?')
    .get(reportId, tenant.id) as { share_token: string | null } | undefined

  if (!reportRow) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  let token = reportRow.share_token
  const generatedAt = new Date().toISOString()

  if (!token) {
    // Generate a 32-char URL-safe random token.
    token = crypto.randomBytes(24).toString('base64url')

    db.prepare(
      `UPDATE platform_reports SET share_token = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`
    ).run(token, Math.floor(Date.now() / 1000), reportId, tenant.id)
  }

  const origin = req.nextUrl.origin
  const shareUrl = `${origin}/r/${token}`

  return NextResponse.json({ ok: true, token, shareUrl, generatedAt })
}
