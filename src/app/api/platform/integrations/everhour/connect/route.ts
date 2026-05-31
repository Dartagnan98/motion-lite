// POST /api/platform/integrations/everhour/connect
//
// Everhour uses an API key (no OAuth). PM submits their key from the connect form;
// this route validates the key by calling the adapter's connect(), which pings
// /users/me, then creates the integration row and fires the first snapshot.
//
// Body: { apiKey: string }
// Response: { ok: true, integrationId: number }

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { everhourAdapter } from '@/lib/platform/integrations/everhour/adapter'
import { persistSnapshot } from '@/lib/platform/snapshots'

export async function POST(req: NextRequest) {
  let body: { apiKey?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : null
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
  }

  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    const accountId = await getCurrentAccountId(tenant.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'No active client selected. Create a client first.' },
        { status: 400 }
      )
    }

    const origin = req.nextUrl.origin

    // adapter.connect() validates the API key (calls /users/me) and creates the integration row.
    const result = await everhourAdapter.connect({
      tenantId: tenant.id,
      level: 'account',
      agencyId: null,
      accountId,
      domainId: null,
      redirectUri: `${origin}/platform/connect/everhour`,  // not used for api_key, but required by contract
      apiKey,
    })

    if (!result.integrationId) {
      return NextResponse.json({ error: 'Adapter did not return an integrationId' }, { status: 500 })
    }

    const integrationId = result.integrationId

    // Fire the first snapshot (last 30 days). Non-fatal if it fails.
    try {
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start = new Date(end)
      start.setDate(start.getDate() - 29)

      const raw = await everhourAdapter.fetchSnapshot({
        integrationId,
        accountId,
        period: { start, end },
      })
      const normalized = everhourAdapter.normalize(raw)
      await persistSnapshot({
        tenant_id: tenant.id,
        integration_id: integrationId,
        account_id: accountId,
        period_start: normalized.periodStart,
        period_end: normalized.periodEnd,
        raw,
        normalized,
      })
    } catch (snapErr) {
      console.error('[platform/everhour/connect] initial snapshot failed:', snapErr)
    }

    return NextResponse.json({ ok: true, integrationId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[platform/everhour/connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
