// POST /api/platform/integrations/ga4/select-property
//
// Called after the property picker UI submits a chosen GA4 property.
// Reads the pending exchange from the signed cookie set by the callback route,
// calls completeConnect() to persist the integration + token, then fires the
// first snapshot and redirects to dashboard.
//
// Body: { propertyId: string, propertyDisplayName: string }
// Cookie: ga4_pending_connect (signed HMAC payload from callback)

import { NextRequest, NextResponse } from 'next/server'
import { verifyState } from '@/lib/platform/state'
import { completeConnect } from '@/lib/platform/integrations/ga4/connect-flow'
import { ga4Adapter } from '@/lib/platform/integrations/ga4/adapter'
import { persistSnapshot } from '@/lib/platform/snapshots'
import type { CallbackState } from '@/lib/platform/integrations/ga4/connect-flow'

interface PendingPayload extends CallbackState {
  exchange_access_token?: string
  exchange_refresh_token?: string | null
  exchange_expires_in?: number
  exchange_email?: string | null
  exchange_scopes?: string
  tenant_credential_id?: number
}

export async function POST(req: NextRequest) {
  let body: { propertyId?: unknown; propertyDisplayName?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : null
  const propertyDisplayName = typeof body.propertyDisplayName === 'string'
    ? body.propertyDisplayName.trim()
    : propertyId || 'GA4 Property'

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
  }

  const origin = req.nextUrl.origin

  // Read + verify the signed pending connect cookie.
  const pendingCookie = req.cookies.get('ga4_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'ga4') {
    return NextResponse.json(
      { error: 'Invalid session — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  try {
    // Persist integration row + token.
    const { integrationId } = completeConnect({
      state: {
        provider: 'ga4',
        tenantId: payload.tenantId,
        level: payload.level,
        agencyId: payload.agencyId,
        accountId: payload.accountId,
        domainId: payload.domainId,
      },
      propertyId,
      propertyDisplayName,
      // Reuse links the shared credential; fresh OAuth adopts the exchange.
      ...(payload.tenant_credential_id
        ? { tenantCredentialId: payload.tenant_credential_id }
        : {
            exchange: {
              access_token: payload.exchange_access_token!,
              refresh_token: payload.exchange_refresh_token ?? null,
              expires_in: payload.exchange_expires_in!,
              email: payload.exchange_email ?? null,
              scopes: payload.exchange_scopes!,
            },
          }),
    })

    const accountId = payload.accountId ?? 0

    // Fire the first snapshot (last 30 days). Non-fatal if it fails.
    try {
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start = new Date(end)
      start.setDate(start.getDate() - 29)

      const raw = await ga4Adapter.fetchSnapshot({
        integrationId,
        accountId,
        period: { start, end },
      })
      const normalized = ga4Adapter.normalize(raw)
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
      console.error('[platform/ga4/select-property] initial snapshot failed:', snapErr)
    }

    // Clear the pending cookie and redirect to dashboard.
    const response = NextResponse.json({ ok: true, integrationId })
    response.cookies.set('ga4_pending_connect', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/ga4/select-property]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
