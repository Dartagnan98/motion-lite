// POST /api/platform/integrations/se_ranking/finalize
//
// Step 2 of the SE Ranking multi-step connect flow.
// Reads + verifies the pending cookie, calls the SE Ranking adapter connect()
// with apiKey + projectId/projectName. Fires the first snapshot (non-fatal).
// Clears the cookie.
//
// Body: { projectId: string, projectName: string }
// Response: { ok: true, integrationId: number }

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { verifyState } from '@/lib/platform/state'
import { persistSnapshot } from '@/lib/platform/snapshots'
import { getDb, generatePublicId } from '@/lib/db'
import { seRankingAdapter } from '@/lib/platform/integrations/se_ranking/adapter'

interface PendingPayload {
  provider: string
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  apiKey: string
  step: string
}

// Removed unused stale SE_RANKING_BASE constant — finalize uses
// seRankingAdapter.fetchSnapshot() which has its own base URL.

export async function POST(req: NextRequest) {
  let body: { projectId?: unknown; projectName?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // The adapter's readConfig expects projectId as a number; coerce from the
  // string body. (The picker form submits the gid as a string for URL safety.)
  const projectIdRaw =
    typeof body.projectId === 'string' ? body.projectId.trim()
    : typeof body.projectId === 'number' ? String(body.projectId)
    : null
  const projectIdNum = projectIdRaw ? Number(projectIdRaw) : NaN
  const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : projectIdRaw

  if (!projectIdRaw || !Number.isFinite(projectIdNum)) {
    return NextResponse.json({ error: 'projectId is required and must be numeric' }, { status: 400 })
  }

  // Verify session auth before reading the cookie — defense-in-depth so a
  // CSRF-forged request can't consume the pending state from another session.
  let authedWorkspaceId: number
  try {
    const auth = await requireAuthWithWorkspace(req)
    authedWorkspaceId = auth.workspaceId
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pendingCookie = req.cookies.get('se_ranking_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'se_ranking' || payload.step !== 'project') {
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

    // Create the integration row. projectId is stored as a number — the
    // adapter's readConfig() rejects strings (validated at fetchSnapshot time).
    const configJson = JSON.stringify({
      apiKey: payload.apiKey,
      projectId: projectIdNum,
      projectName: projectName ?? projectIdRaw,
    })

    const displayName = `SE Ranking — ${projectName ?? projectIdRaw}`
    // Dedupe: reconnect/reconfigure updates the existing tile for this account.
    const { findIntegrationForAccount, updateIntegrationConfig } = await import('@/lib/platform/integrations/upsert')
    const existingId = findIntegrationForAccount({ tenantId: payload.tenantId, provider: 'se_ranking', accountId: payload.accountId })
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
           VALUES (?, ?, 'account', ?, NULL, NULL, 'se_ranking', 'api_key', ?, ?, 'connected', ?, ?)`
        )
        .run(payload.tenantId, generatePublicId(), payload.accountId, configJson, displayName, now, now)
      integrationId = Number(result.lastInsertRowid)
    }

    // Fire first snapshot — non-fatal.
    try {
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start = new Date(end)
      start.setDate(start.getDate() - 29)

      const periodStart = start.toISOString().slice(0, 10)
      const periodEnd = end.toISOString().slice(0, 10)

      const raw = await seRankingAdapter.fetchSnapshot({
        integrationId,
        accountId: payload.accountId ?? 0,
        period: { start, end },
      })
      const normalized = seRankingAdapter.normalize(raw)
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
      console.error('[platform/se_ranking/finalize] initial snapshot failed:', snapErr)
    }

    // Update last_synced_at on the integration row.
    db.prepare(
      `UPDATE platform_integrations SET last_synced_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, integrationId)

    const response = NextResponse.json({ ok: true, integrationId })
    response.cookies.set('se_ranking_pending_connect', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/se_ranking/finalize]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
