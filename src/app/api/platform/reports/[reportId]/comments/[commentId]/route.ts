// PATCH /api/platform/reports/[reportId]/comments/[commentId]
//   — toggle is_resolved OR edit body (author-only)
// DELETE /api/platform/reports/[reportId]/comments/[commentId]
//   — soft-delete: sets body to '_deleted_' sentinel, retains row for Asana trail
//
// Both tenant-scoped via assertTenantOwnsRow on the report and the comment.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface CommentRow {
  id: number
  tenant_id: number
  report_id: number
  section_id: number | null
  author_user_id: number
  body: string
  is_resolved: number
  asana_task_gid: string | null
}

async function resolveContext(
  req: NextRequest,
  reportIdStr: string,
  commentIdStr: string
) {
  const reportId = parseInt(reportIdStr, 10)
  const commentId = parseInt(commentIdStr, 10)
  if (isNaN(reportId) || reportId <= 0 || isNaN(commentId) || commentId <= 0) {
    return { error: 'Invalid reportId or commentId', status: 400 } as const
  }

  const user = await getCurrentUser()
  if (!user) return { error: 'Not authenticated', status: 401 } as const

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return { error: 'Not authenticated', status: 401 } as const
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
  } catch {
    return { error: 'Report not found or access denied', status: 404 } as const
  }

  const db = getDb()
  const comment = db.prepare(
    `SELECT id, tenant_id, report_id, section_id, author_user_id, body,
            is_resolved, asana_task_gid
       FROM platform_report_comments
      WHERE id = ? AND tenant_id = ? AND report_id = ?`
  ).get(commentId, tenant.id, reportId) as CommentRow | undefined

  if (!comment || comment.body === '_deleted_') {
    return { error: 'Comment not found', status: 404 } as const
  }

  return { reportId, commentId, user, tenant, db, comment } as const
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string; commentId: string }> }
) {
  const { reportId: reportIdStr, commentId: commentIdStr } = await params
  const ctx = await resolveContext(req, reportIdStr, commentIdStr)
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }
  const { commentId, user, tenant, db, comment } = ctx

  let body: { is_resolved?: unknown; body?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)

  // Toggle is_resolved — any authed team member can resolve.
  if (typeof body.is_resolved === 'number' || typeof body.is_resolved === 'boolean') {
    const newResolved = body.is_resolved ? 1 : 0
    db.prepare(
      `UPDATE platform_report_comments
          SET is_resolved = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    ).run(newResolved, now, commentId, tenant.id)
    return NextResponse.json({ ok: true })
  }

  // Edit body — author-only.
  if (typeof body.body === 'string') {
    if (comment.author_user_id !== user.id) {
      return NextResponse.json({ error: 'Only the comment author can edit this comment' }, { status: 403 })
    }
    const newBody = body.body.trim()
    if (!newBody) {
      return NextResponse.json({ error: 'Comment body cannot be empty' }, { status: 400 })
    }
    if (newBody.length > 8000) {
      return NextResponse.json({ error: 'Comment body exceeds 8000 characters' }, { status: 400 })
    }
    db.prepare(
      `UPDATE platform_report_comments
          SET body = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`
    ).run(newBody, now, commentId, tenant.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Provide is_resolved or body to update' }, { status: 400 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string; commentId: string }> }
) {
  const { reportId: reportIdStr, commentId: commentIdStr } = await params
  const ctx = await resolveContext(req, reportIdStr, commentIdStr)
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  }
  const { commentId, user, tenant, db, comment } = ctx

  // Only the author can delete.
  if (comment.author_user_id !== user.id) {
    return NextResponse.json({ error: 'Only the comment author can delete this comment' }, { status: 403 })
  }

  // Soft-delete: sentinel value preserves asana_task_gid for audit trail.
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `UPDATE platform_report_comments
        SET body = '_deleted_', updated_at = ?
      WHERE id = ? AND tenant_id = ?`
  ).run(now, commentId, tenant.id)

  return NextResponse.json({ ok: true })
}
