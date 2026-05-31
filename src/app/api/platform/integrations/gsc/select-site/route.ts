// POST /api/platform/integrations/gsc/select-site
//
// Called after the GSC site picker UI submits a chosen siteUrl.
// Reads the pending exchange from the signed cookie, calls completeConnect(),
// fires the first snapshot, and returns { ok, integrationId, accountId }.
//
// Body: { siteUrl: string }
// Cookie: gsc_pending_connect (signed HMAC payload from callback)

import { NextRequest, NextResponse } from 'next/server'
import { verifyState } from '@/lib/platform/state'
import { completeConnect } from '@/lib/platform/integrations/gsc/connect-flow'
import { gscAdapter } from '@/lib/platform/integrations/gsc/adapter'
import { persistSnapshot } from '@/lib/platform/snapshots'
import type { CallbackState } from '@/lib/platform/integrations/gsc/connect-flow'

interface PendingPayload extends CallbackState {
  // Fresh OAuth path carries the exchange tokens; reuse path carries a shared
  // tenant credential id instead.
  exchange_access_token?: string
  exchange_refresh_token?: string | null
  exchange_expires_in?: number
  exchange_email?: string | null
  exchange_scopes?: string
  tenant_credential_id?: number
}

export async function POST(req: NextRequest) {
  let body: { siteUrl?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const siteUrl = typeof body.siteUrl === 'string' ? body.siteUrl.trim() : null
  if (!siteUrl) {
    return NextResponse.json({ error: 'siteUrl is required' }, { status: 400 })
  }

  const pendingCookie = req.cookies.get('gsc_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'gsc') {
    return NextResponse.json(
      { error: 'Invalid session — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  try {
    const { integrationId } = completeConnect({
      state: {
        provider: 'gsc',
        tenantId: payload.tenantId,
        level: payload.level,
        agencyId: payload.agencyId,
        accountId: payload.accountId,
        domainId: payload.domainId,
      },
      siteUrl,
      // Reuse path links to the shared credential; fresh OAuth adopts the
      // exchange tokens into the tenant store.
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

    // Fire the first snapshot (last 30 days). Non-fatal.
    try {
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start = new Date(end)
      start.setDate(start.getDate() - 29)

      const raw = await gscAdapter.fetchSnapshot({
        integrationId,
        accountId,
        domainId: payload.domainId,
        period: { start, end },
      })
      const normalized = gscAdapter.normalize(raw)
      await persistSnapshot({
        tenant_id: payload.tenantId,
        integration_id: integrationId,
        account_id: accountId,
        domain_id: payload.domainId,
        period_start: normalized.periodStart,
        period_end: normalized.periodEnd,
        raw,
        normalized,
      })
    } catch (snapErr) {
      console.error('[platform/gsc/select-site] initial snapshot failed:', snapErr)
    }

    // Clear pending cookie.
    const response = NextResponse.json({
      ok: true,
      integrationId,
      accountId: payload.accountId,
    })
    response.cookies.set('gsc_pending_connect', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/gsc/select-site]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
