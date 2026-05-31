// DELETE /api/platform/integrations/[integrationId]
//
// Disconnects (deletes) an integration. Tenant-scoped via assertTenantOwnsRow.
//
// FK behavior on delete:
//   - platform_snapshots         → CASCADE (removed)
//   - platform_oauth_tokens      → CASCADE (removed)
//   - platform_report_blocks     → SET NULL on integration_id (block stays;
//                                  section renders empty until re-linked)
//
// The PM may reconnect immediately via /platform/connect/<provider>. The
// existing report blocks pick up the new integration on next refetch IF the
// new integration_id is wired (Phase 3 will add a "Link block to integration"
// UI; for Phase 2 the PM re-seeds via scripts/reseed-glenvalley-report.mjs).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const { integrationId: integrationIdStr } = await params
  const integrationId = parseInt(integrationIdStr, 10)
  if (!integrationId || isNaN(integrationId)) {
    return NextResponse.json({ error: 'Invalid integrationId' }, { status: 400 })
  }

  let tenantId: number
  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)
    tenantId = tenant.id
    assertTenantOwnsRow(tenant, 'platform_integrations', integrationId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Forbidden'
    if (message === 'FORBIDDEN' || message.includes('does not own')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }

  try {
    const info = getDb().prepare(
      'DELETE FROM platform_integrations WHERE id = ? AND tenant_id = ?'
    ).run(integrationId, tenantId)

    if (info.changes === 0) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, deleted: integrationId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/integration DELETE]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
