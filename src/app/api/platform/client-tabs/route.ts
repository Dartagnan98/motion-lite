// GET /api/platform/client-tabs?clientName=<name>
//
// Returns integrations, reports, and comments for a specific client.
//
// Phase C: client_profiles.id is the canonical account id. Resolve by name match
// against client_profiles directly; that id is then the account_id on
// platform_integrations / platform_reports.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCurrentWorkspaceId,
  ensureTenantForWorkspace,
} from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientName = req.nextUrl.searchParams.get('clientName')
  if (!clientName) return NextResponse.json({ error: 'clientName required' }, { status: 400 })

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const tenant = ensureTenantForWorkspace(workspaceId)
  const db = getDb()

  // Look up the client by name and tenant. Only return rows that are platform-enrolled.
  const cpRow = db.prepare(`
    SELECT id FROM client_profiles
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
       AND tenant_id = ?
       AND platform_status = 'active'
     LIMIT 1
  `).get(clientName, tenant.id) as { id: number } | undefined

  if (!cpRow) {
    return NextResponse.json({ accountId: null, integrations: [], reports: [], comments: [] })
  }

  const accountId = cpRow.id

  const integrations = db.prepare(`
    SELECT id, provider, display_name, status, last_health_status, last_synced_at
    FROM platform_integrations
    WHERE account_id = ? AND tenant_id = ? AND level = 'account'
    ORDER BY provider ASC
  `).all(accountId, tenant.id)

  const reports = db.prepare(`
    SELECT id, name, period_start, period_end, status
    FROM platform_reports
    WHERE account_id = ? AND tenant_id = ?
    ORDER BY period_end DESC
    LIMIT 20
  `).all(accountId, tenant.id)

  const comments = db.prepare(`
    SELECT
      c.id,
      c.body,
      r.name AS report_name,
      s.title AS section_title,
      u.name AS author_name,
      c.created_at
    FROM platform_report_comments c
    JOIN platform_reports r ON r.id = c.report_id
    LEFT JOIN platform_report_sections s ON s.id = c.section_id
    LEFT JOIN users u ON u.id = c.author_user_id
    WHERE r.account_id = ? AND r.tenant_id = ?
      AND c.body != '_deleted_'
    ORDER BY c.created_at DESC
    LIMIT 20
  `).all(accountId, tenant.id)

  return NextResponse.json({ accountId, integrations, reports, comments })
}
