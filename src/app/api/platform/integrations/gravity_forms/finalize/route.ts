// POST /api/platform/integrations/gravity_forms/finalize
//
// Step 2 of the Gravity Forms multi-step connect flow.
// Reads + verifies the pending cookie, creates the integration row, fires the
// first snapshot (non-fatal). Clears the cookie.
//
// Body: { formIds: string[], formNames: string[] }
// Response: { ok: true, integrationId: number }

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { verifyState } from '@/lib/platform/state'
import { persistSnapshot } from '@/lib/platform/snapshots'
import { getDb, generatePublicId } from '@/lib/db'
import { gravityFormsAdapter } from '@/lib/platform/integrations/gravity_forms/adapter'

interface PendingPayload {
  provider: string
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  siteUrl: string
  username: string
  appPassword: string
  forms: string
  step: string
}

export async function POST(req: NextRequest) {
  let body: { formIds?: unknown; formNames?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const formIds = Array.isArray(body.formIds)
    ? (body.formIds as unknown[]).filter((v) => typeof v === 'string') as string[]
    : []

  const formNames = Array.isArray(body.formNames)
    ? (body.formNames as unknown[]).filter((v) => typeof v === 'string') as string[]
    : []

  // Verify session auth before reading the cookie — defense-in-depth so a
  // CSRF-forged request can't consume the pending state from another session.
  let authedWorkspaceId: number
  try {
    const auth = await requireAuthWithWorkspace(req)
    authedWorkspaceId = auth.workspaceId
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pendingCookie = req.cookies.get('gravity_forms_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'gravity_forms' || payload.step !== 'forms') {
    return NextResponse.json(
      { error: 'Invalid session — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  // Belt-and-suspenders: confirm tenant in cookie matches the session's tenant.
  const sessionTenant = ensureTenantForWorkspace(authedWorkspaceId)
  if (sessionTenant.id !== payload.tenantId) {
    return NextResponse.json({ error: 'Tenant mismatch — please reconnect from the beginning' }, { status: 403 })
  }
  if (payload.accountId) {
    try {
      assertTenantOwnsRow(sessionTenant, 'client_profiles', payload.accountId)
    } catch {
      return NextResponse.json({ error: 'Account not found or access denied' }, { status: 403 })
    }
  }

  try {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    const configJson = JSON.stringify({
      siteUrl: payload.siteUrl,
      username: payload.username,
      appPassword: payload.appPassword,
      formIds: formIds.length > 0 ? formIds : null,
      formNames: formNames.length > 0 ? formNames : null,
    })

    const displayName = formIds.length > 0
      ? `Gravity Forms — ${payload.siteUrl} (${formIds.length} form${formIds.length !== 1 ? 's' : ''})`
      : `Gravity Forms — ${payload.siteUrl} (all forms)`

    // Dedupe: reconnect/reconfigure updates the existing tile for this account.
    const { findIntegrationForAccount, updateIntegrationConfig } = await import('@/lib/platform/integrations/upsert')
    const existingId = findIntegrationForAccount({ tenantId: payload.tenantId, provider: 'gravity_forms', accountId: payload.accountId })
    let integrationId: number
    if (existingId) {
      updateIntegrationConfig({ integrationId: existingId, configJson, displayName })
      integrationId = existingId
    } else {
      const result = db
        .prepare(
          `INSERT INTO platform_integrations
             (tenant_id, public_id, level, account_id, agency_id, domain_id, provider, auth_model,
              config_json, display_name, status, created_at, updated_at)
           VALUES (?, ?, 'account', ?, NULL, NULL, 'gravity_forms', 'basic_auth', ?, ?, 'connected', ?, ?)`
        )
        .run(payload.tenantId, generatePublicId(), payload.accountId, configJson, displayName, now, now)
      integrationId = Number(result.lastInsertRowid)
    }

    // Fire first snapshot — non-fatal. Failure leaves the integration in
    // 'connected' state; PM can re-trigger via the dashboard refresh icon.
    try {
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start = new Date(end)
      start.setDate(start.getDate() - 29)

      const periodStart = start.toISOString().slice(0, 10)
      const periodEnd = end.toISOString().slice(0, 10)

      const raw = await gravityFormsAdapter.fetchSnapshot({
        integrationId,
        accountId: payload.accountId ?? 0,
        period: { start, end },
      })
      const normalized = gravityFormsAdapter.normalize(raw)
      await persistSnapshot({
        tenant_id: payload.tenantId,
        integration_id: integrationId,
        account_id: payload.accountId ?? 0,
        period_start: normalized.periodStart,
        period_end: normalized.periodEnd,
        raw,
        normalized,
      })
    } catch (snapErr) {
      console.error('[platform/gravity_forms/finalize] initial snapshot failed:', snapErr)
    }

    db.prepare(
      `UPDATE platform_integrations SET last_synced_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, integrationId)

    const response = NextResponse.json({ ok: true, integrationId })
    response.cookies.set('gravity_forms_pending_connect', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/gravity_forms/finalize]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
