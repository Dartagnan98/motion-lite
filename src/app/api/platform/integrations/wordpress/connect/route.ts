// POST /api/platform/integrations/wordpress/connect
//
// Single-step WordPress connect flow.
// Validates credentials by calling /wp-json/wp/v2/users/me with basic auth.
// Creates the integration row and fires the first snapshot (non-fatal).
// Redirects to dashboard on success.
//
// Body: { siteUrl: string, username: string, appPassword: string }
// Response: { ok: true, integrationId: number }

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { persistSnapshot } from '@/lib/platform/snapshots'
import { getDb, generatePublicId } from '@/lib/db'
import { wordpressAdapter } from '@/lib/platform/integrations/wordpress/adapter'

async function validateWordPressCredentials(
  siteUrl: string,
  username: string,
  appPassword: string
): Promise<{ displayName: string }> {
  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64')
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'WordPress authentication failed — check your username and application password.'
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `WordPress API error (${res.status}). Is the REST API enabled? ${text.slice(0, 150)}`
    )
  }
  const user = await res.json() as { name?: string; display_name?: string }
  return { displayName: user.name ?? user.display_name ?? username }
}

export async function POST(req: NextRequest) {
  let body: { siteUrl?: unknown; username?: unknown; appPassword?: unknown; accountId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const siteUrl =
    typeof body.siteUrl === 'string' ? body.siteUrl.trim().replace(/\/+$/, '') : null
  const username = typeof body.username === 'string' ? body.username.trim() : null
  const appPassword = typeof body.appPassword === 'string'
    ? body.appPassword.trim().replace(/\s+/g, '')
    : null

  if (!siteUrl || !username || !appPassword) {
    return NextResponse.json(
      { error: 'siteUrl, username, and appPassword are required' },
      { status: 400 }
    )
  }

  if (!/^https?:\/\//i.test(siteUrl)) {
    return NextResponse.json(
      { error: 'siteUrl must start with http:// or https://' },
      { status: 400 }
    )
  }

  try {
    // Validate credentials before touching the tenant.
    let displayName: string
    try {
      const result = await validateWordPressCredentials(siteUrl, username, appPassword)
      displayName = result.displayName
    } catch (credErr) {
      const msg = credErr instanceof Error ? credErr.message : 'Credential validation failed'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    const db = getDb()

    // Sprint 2 should-fix #1: prefer body-provided accountId over cookie.
    let accountId: number | null = null
    const bodyAccountId = typeof body.accountId === 'number' ? body.accountId : null
    if (bodyAccountId) {
      try {
        const { assertTenantOwnsRow } = await import('@/lib/platform/tenant')
        assertTenantOwnsRow(tenant, 'client_profiles', bodyAccountId)
        accountId = bodyAccountId
      } catch {
        return NextResponse.json({ error: 'accountId not found or access denied' }, { status: 400 })
      }
    } else {
      accountId = await getCurrentAccountId(tenant.id)
    }
    if (!accountId) {
      return NextResponse.json(
        { error: 'No active client selected. Create a client first.' },
        { status: 400 }
      )
    }

    const now = Math.floor(Date.now() / 1000)
    const configJson = JSON.stringify({ siteUrl, username, appPassword })

    const wpDisplayName = `WordPress — ${displayName} (${siteUrl})`
    // Dedupe: reconnect/reconfigure updates the existing tile for this account.
    const { findIntegrationForAccount, updateIntegrationConfig } = await import('@/lib/platform/integrations/upsert')
    const existingId = findIntegrationForAccount({ tenantId: tenant.id, provider: 'wordpress', accountId })
    let integrationId: number
    if (existingId) {
      updateIntegrationConfig({ integrationId: existingId, configJson, displayName: wpDisplayName })
      integrationId = existingId
    } else {
      const result = db
        .prepare(
          `INSERT INTO platform_integrations
             (tenant_id, public_id, level, account_id, agency_id, domain_id, provider, auth_model,
              config_json, display_name, status, created_at, updated_at)
           VALUES (?, ?, 'account', ?, NULL, NULL, 'wordpress', 'basic_auth', ?, ?, 'connected', ?, ?)`
        )
        .run(tenant.id, generatePublicId(), accountId, configJson, wpDisplayName, now, now)
      integrationId = Number(result.lastInsertRowid)
    }

    // Fire first snapshot — non-fatal.
    try {
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start = new Date(end)
      start.setDate(start.getDate() - 29)

      const raw = await wordpressAdapter.fetchSnapshot({
        integrationId,
        accountId,
        period: { start, end },
      })
      const normalized = wordpressAdapter.normalize(raw)
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
      console.error('[platform/wordpress/connect] initial snapshot failed:', snapErr)
    }

    db.prepare(
      `UPDATE platform_integrations SET last_synced_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, integrationId)

    return NextResponse.json({ ok: true, integrationId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[platform/wordpress/connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
