// POST /api/platform/reports/[reportId]/comments — create a comment
// GET  /api/platform/reports/[reportId]/comments — list comments for a report
//
// Both routes are tenant-scoped via assertTenantOwnsRow on the report.
// GET returns all non-deleted comments, oldest-first, sorted by created_at.
// POST body: { sectionId?: number, body: string }

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { listCommentsForReport } from '@/lib/platform/reports'
import { getDb, generatePublicId } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId: reportIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
  } catch {
    return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })
  }

  const comments = listCommentsForReport({ tenantId: tenant.id, reportId })
  return NextResponse.json({ comments })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId: reportIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  if (isNaN(reportId) || reportId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId' }, { status: 400 })
  }

  let body: { sectionId?: unknown; body?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const commentBody = typeof body.body === 'string' ? body.body.trim() : null
  if (!commentBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }
  if (commentBody.length > 8000) {
    return NextResponse.json({ error: 'Comment body exceeds 8000 characters' }, { status: 400 })
  }

  const sectionId = typeof body.sectionId === 'number' ? body.sectionId : null

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
  } catch {
    return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })
  }

  // Validate sectionId belongs to this report if provided.
  if (sectionId) {
    try {
      assertTenantOwnsRow(tenant, 'platform_report_sections', sectionId)
    } catch {
      return NextResponse.json({ error: 'Section not found or access denied' }, { status: 404 })
    }
    const db = getDb()
    const sectionRow = db.prepare(
      'SELECT report_id FROM platform_report_sections WHERE id = ? AND tenant_id = ?'
    ).get(sectionId, tenant.id) as { report_id: number } | undefined
    if (!sectionRow || sectionRow.report_id !== reportId) {
      return NextResponse.json({ error: 'Section does not belong to this report' }, { status: 404 })
    }
  }

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const publicId = generatePublicId()

  const result = db.prepare(
    `INSERT INTO platform_report_comments
       (tenant_id, public_id, report_id, section_id, author_user_id, body,
        is_resolved, asana_task_gid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
  ).run(tenant.id, publicId, reportId, sectionId, user.id, commentBody, now, now)

  const comment = db.prepare(
    `SELECT id, public_id, report_id, section_id, author_user_id, body,
            is_resolved, asana_task_gid, created_at, updated_at
       FROM platform_report_comments WHERE id = ?`
  ).get(result.lastInsertRowid) as Record<string, unknown>

  return NextResponse.json({ ok: true, comment }, { status: 201 })
}
