// POST /api/platform/reports/[reportId]/comments/[commentId]/push-to-asana
//
// Creates an Asana task from the comment body and stores the resulting task GID
// on the comment row. One-way: once pushed, the button shows "View in Asana".
//
// Flow:
//   1. Tenant-scope via assertTenantOwnsRow on report + comment.
//   2. Look up report → account_id.
//   3. findAsanaIntegration({tenantId, accountId}) — 400 if none.
//   4. Read config_json → {workspaceId, projectIds}. 400 if no projectIds.
//   5. getValidAccessToken(integrationId).
//   6. POST /tasks to Asana API.
//   7. Persist asana_task_gid on comment row.
//   8. Return { ok, taskGid, taskUrl }.
//
// If the Asana token is expired and refresh fails → 502 with Asana error surfaced.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { findAsanaIntegration } from '@/lib/platform/reports'
import { getValidAccessToken } from '@/lib/platform/integrations/asana/oauth'

const ASANA_API_BASE = 'https://app.asana.com/api/1.0'

interface AsanaConfig {
  workspaceId?: string
  projectIds?: string[]
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ reportId: string; commentId: string }> }
) {
  const { reportId: reportIdStr, commentId: commentIdStr } = await params
  const reportId = parseInt(reportIdStr, 10)
  const commentId = parseInt(commentIdStr, 10)

  if (isNaN(reportId) || reportId <= 0 || isNaN(commentId) || commentId <= 0) {
    return NextResponse.json({ error: 'Invalid reportId or commentId' }, { status: 400 })
  }

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const tenant = ensureTenantForWorkspace(workspaceId)

  // Scope checks.
  try {
    assertTenantOwnsRow(tenant, 'platform_reports', reportId)
  } catch {
    return NextResponse.json({ error: 'Report not found or access denied' }, { status: 404 })
  }

  const db = getDb()

  const comment = db.prepare(
    `SELECT id, tenant_id, report_id, author_user_id, body, asana_task_gid
       FROM platform_report_comments
      WHERE id = ? AND tenant_id = ? AND report_id = ? AND body != '_deleted_'`
  ).get(commentId, tenant.id, reportId) as {
    id: number
    tenant_id: number
    report_id: number
    author_user_id: number
    body: string
    asana_task_gid: string | null
  } | undefined

  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  // If already pushed, return the existing task link.
  if (comment.asana_task_gid) {
    return NextResponse.json({
      ok: true,
      taskGid: comment.asana_task_gid,
      alreadyPushed: true,
    })
  }

  // Load the report to get account_id.
  const report = db.prepare(
    `SELECT id, account_id, name, period_start, period_end FROM platform_reports WHERE id = ? AND tenant_id = ?`
  ).get(reportId, tenant.id) as {
    id: number
    account_id: number
    name: string
    period_start: string
    period_end: string
  } | undefined

  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  // Find Asana integration for this account.
  const asanaIntegration = findAsanaIntegration({ tenantId: tenant.id, accountId: report.account_id })
  if (!asanaIntegration) {
    return NextResponse.json(
      { error: 'No Asana integration connected for this client' },
      { status: 400 }
    )
  }

  // Parse config_json for workspaceId + projectIds.
  let asanaConfig: AsanaConfig = {}
  try {
    if (asanaIntegration.config_json) {
      asanaConfig = JSON.parse(asanaIntegration.config_json) as AsanaConfig
    }
  } catch {
    return NextResponse.json({ error: 'Asana integration config is invalid' }, { status: 500 })
  }

  if (!asanaConfig.workspaceId) {
    return NextResponse.json({ error: 'Asana integration missing workspaceId' }, { status: 400 })
  }

  if (!asanaConfig.projectIds || asanaConfig.projectIds.length === 0) {
    return NextResponse.json(
      { error: 'No Asana projects selected for this integration' },
      { status: 400 }
    )
  }

  const firstProjectId = asanaConfig.projectIds[0]

  // Get a valid access token (refreshes if needed).
  let accessToken: string
  try {
    accessToken = await getValidAccessToken(asanaIntegration.id)
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : 'Token refresh failed'
    return NextResponse.json({ error: `Asana auth error: ${msg}` }, { status: 502 })
  }

  // Build task name from first line of comment body (max 120 chars).
  const firstLine = comment.body.split('\n')[0] ?? comment.body
  const taskName = firstLine.slice(0, 120)

  // Build report URL for the notes link.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const reportUrl = `${appUrl}/platform/reports/${reportId}`

  const taskNotes = `${comment.body}\n\nFrom Hiilite Platform report: ${reportUrl}`

  // Call Asana API.
  const asanaRes = await fetch(`${ASANA_API_BASE}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      data: {
        workspace: asanaConfig.workspaceId,
        projects: [firstProjectId],
        name: taskName,
        notes: taskNotes,
        assignee: 'me',
      },
    }),
  })

  if (!asanaRes.ok) {
    const errText = await asanaRes.text().catch(() => '')
    console.error('[push-to-asana] Asana task creation failed:', asanaRes.status, errText)
    return NextResponse.json(
      { error: `Asana error (${asanaRes.status}): ${errText.slice(0, 400)}` },
      { status: 502 }
    )
  }

  const asanaData = await asanaRes.json() as { data?: { gid?: string } }
  const taskGid = asanaData.data?.gid
  if (!taskGid) {
    return NextResponse.json({ error: 'Asana returned no task GID' }, { status: 502 })
  }

  // Persist the task GID on the comment row.
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    `UPDATE platform_report_comments
        SET asana_task_gid = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`
  ).run(taskGid, now, commentId, tenant.id)

  const taskUrl = `https://app.asana.com/0/${firstProjectId}/${taskGid}`

  return NextResponse.json({ ok: true, taskGid, taskUrl })
}
