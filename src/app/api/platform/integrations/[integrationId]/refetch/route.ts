// POST /api/platform/integrations/[integrationId]/refetch
//
// Triggers a re-snapshot for a single integration. Tenant-scoped: returns 404
// if the integration doesn't belong to the caller's tenant.
//
// Flow:
//   1. Resolve tenant from session.
//   2. assertTenantOwnsRow(tenant, 'platform_integrations', integrationId).
//   3. Look up the integration row to get provider + account_id.
//   4. Resolve adapter via integrations registry.
//   5. Call fetchSnapshot → normalize → persistSnapshot (last 30 days).
//   6. Return { ok: true, snapshotId } on success, 4xx/5xx on error.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getAdapter } from '@/lib/platform/integrations'
import { persistSnapshot } from '@/lib/platform/snapshots'
import { getDb } from '@/lib/db'
import type { Integration } from '@/lib/platform/types'

interface RouteParams {
  params: Promise<{ integrationId: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { integrationId: integrationIdStr } = await params
  const integrationId = parseInt(integrationIdStr, 10)

  if (isNaN(integrationId) || integrationId <= 0) {
    return NextResponse.json({ error: 'Invalid integrationId' }, { status: 400 })
  }

  try {
    // Resolve workspace + tenant from session.
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    // Verify the integration belongs to this tenant before doing any work.
    assertTenantOwnsRow(tenant, 'platform_integrations', integrationId)

    // Load integration row to get provider + account_id. Tenant filter is
    // defense-in-depth — assertTenantOwnsRow above already guards this.
    const integration = getDb().prepare(
      `SELECT * FROM platform_integrations WHERE id = ? AND tenant_id = ?`
    ).get(integrationId, tenant.id) as Integration | undefined

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    if (integration.status === 'disconnected') {
      return NextResponse.json({ error: 'Integration is disconnected — reconnect first' }, { status: 400 })
    }

    // Resolve adapter by provider slug.
    let adapter
    try {
      adapter = getAdapter(integration.provider)
    } catch {
      return NextResponse.json(
        { error: `No adapter registered for provider "${integration.provider}"` },
        { status: 501 }
      )
    }

    // Window to fetch: the caller's requested period (the report's selected
    // range), or last-30-days-ending-yesterday as the default (dashboard tile,
    // or a Refresh with no period). ISO YYYY-MM-DD.
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
    const body = await req.json().catch(() => ({})) as { periodStart?: unknown; periodEnd?: unknown; accountId?: unknown }
    const reqStart = typeof body.periodStart === 'string' && ISO_DATE.test(body.periodStart) ? body.periodStart : null
    const reqEnd = typeof body.periodEnd === 'string' && ISO_DATE.test(body.periodEnd) ? body.periodEnd : null
    const reqAccountId = typeof body.accountId === 'number' && body.accountId > 0 ? body.accountId : null

    let start: Date, end: Date
    if (reqStart && reqEnd && reqStart <= reqEnd) {
      start = new Date(reqStart + 'T00:00:00')
      end = new Date(reqEnd + 'T00:00:00')
    } else {
      end = new Date()
      end.setDate(end.getDate() - 1)
      start = new Date(end)
      start.setDate(start.getDate() - 29)
    }
    const periodStartStr = start.toISOString().slice(0, 10)
    const periodEndStr = end.toISOString().slice(0, 10)

    // Prefer the caller-supplied accountId — required for tenant-level
    // integrations (QBO: integration.account_id is NULL; the client to fetch
    // for comes from the report being viewed).
    const accountId = reqAccountId ?? integration.account_id ?? 0

    // fetchSnapshot → normalize → persistSnapshot
    const raw = await adapter.fetchSnapshot({
      integrationId,
      accountId,
      domainId: integration.domain_id,
      period: { start, end },
    })
    const normalized = adapter.normalize(raw)

    // Key the snapshot to the REQUESTED window so getSnapshotForPeriod matches
    // the report's selected range.
    //
    // Exception: pagespeed is now a time-series provider (Slice B). Its normalizer
    // sets period_start = period_end = today's UTC date so each daily refetch creates
    // a new dated point on the chart. We do NOT override its period — the adapter
    // owns it. SE Ranking remains point-in-time and still gets the window label.
    const isPagespeed = integration.provider === 'pagespeed'
    if (!isPagespeed) {
      normalized.periodStart = periodStartStr
      normalized.periodEnd = periodEndStr
    }

    const snapshotPeriodStart = isPagespeed ? normalized.periodStart : periodStartStr
    const snapshotPeriodEnd = isPagespeed ? normalized.periodEnd : periodEndStr

    const snapshot = persistSnapshot({
      tenant_id: tenant.id,
      integration_id: integrationId,
      account_id: accountId,
      domain_id: integration.domain_id,
      period_start: snapshotPeriodStart,
      period_end: snapshotPeriodEnd,
      raw,
      normalized,
    })

    return NextResponse.json({ ok: true, snapshotId: snapshot.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN' || message.includes('does not own')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    console.error('[platform/integrations/refetch]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
