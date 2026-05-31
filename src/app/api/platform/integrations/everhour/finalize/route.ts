// POST /api/platform/integrations/everhour/finalize
//
// Step 3 of the Everhour multi-step connect flow.
// Reads + verifies the pending cookie, calls everhourAdapter.connect() with
// apiKey, projectIds, clientIds, clientNames from the cookie payload.
// Fires the first snapshot (non-fatal). Clears the cookie.
//
// Body: { projectIds: string[] }
// Response: { ok: true, integrationId: number }

import { NextRequest, NextResponse } from 'next/server'
import { verifyState } from '@/lib/platform/state'
import { everhourAdapter } from '@/lib/platform/integrations/everhour/adapter'
import { persistSnapshot } from '@/lib/platform/snapshots'
import { getDb } from '@/lib/db'

interface PendingPayload {
  provider: string
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  apiKey: string
  step: string
  clientIds: string[]
  clientNames: string[]
}

export async function POST(req: NextRequest) {
  let body: { projectIds?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.projectIds) || body.projectIds.length === 0) {
    return NextResponse.json({ error: 'projectIds must be a non-empty array' }, { status: 400 })
  }

  const projectIds = (body.projectIds as unknown[]).filter((v) => typeof v === 'string') as string[]

  if (projectIds.length === 0) {
    return NextResponse.json({ error: 'At least one projectId is required' }, { status: 400 })
  }

  // Read + verify pending cookie.
  const pendingCookie = req.cookies.get('everhour_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'everhour' || payload.step !== 'projects') {
    return NextResponse.json(
      { error: 'Invalid session — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  if (!Array.isArray(payload.clientIds) || payload.clientIds.length === 0) {
    return NextResponse.json(
      { error: 'Session is missing client selection — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  try {
    // Re-validate the API key (key may have been revoked between steps).
    // This runs inside adapter.connect() via validateApiKey() — if the key is
    // bad it will throw a 401 error before writing any row.

    const result = await everhourAdapter.connect({
      tenantId: payload.tenantId,
      level: payload.level,
      agencyId: payload.agencyId,
      accountId: payload.accountId,
      domainId: payload.domainId,
      redirectUri: '',  // not used for api_key auth model
      apiKey: payload.apiKey,
      callbackState: {
        projectIds: JSON.stringify(projectIds),
        clientIds: JSON.stringify(payload.clientIds),
        clientNames: JSON.stringify(payload.clientNames),
      },
    })

    if (!result.integrationId) {
      return NextResponse.json({ error: 'Adapter did not return an integrationId' }, { status: 500 })
    }

    const integrationId = result.integrationId
    const accountId = payload.accountId ?? 0

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
        tenant_id: payload.tenantId,
        integration_id: integrationId,
        account_id: accountId,
        period_start: normalized.periodStart,
        period_end: normalized.periodEnd,
        raw,
        normalized,
      })
    } catch (snapErr) {
      console.error('[platform/everhour/finalize] initial snapshot failed:', snapErr)
    }

    // Clear the pending cookie.
    const response = NextResponse.json({ ok: true, integrationId })
    response.cookies.set('everhour_pending_connect', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/everhour/finalize]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
