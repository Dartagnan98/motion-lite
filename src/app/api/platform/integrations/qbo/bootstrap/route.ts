// POST /api/platform/integrations/qbo/bootstrap
//
// Connect QBO via a refresh token pasted from Intuit's OAuth 2.0 Playground —
// for environments where the browser-redirect OAuth can't be used (Intuit
// production redirect URIs can't be localhost). Validates the token by doing
// one refresh, then stores it as the tenant QBO credential + integration.
//
// Body: { refreshToken: string, realmId: string }

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace } from '@/lib/platform/tenant'
import { exchangeRefreshToken, persistIntegration } from '@/lib/platform/integrations/qbo/oauth'
import { getDb } from '@/lib/db'

export async function POST(req: NextRequest) {
  let body: { refreshToken?: unknown; realmId?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : ''
  const realmId = typeof body.realmId === 'string' ? body.realmId.trim() : ''
  if (!refreshToken || !realmId) {
    return NextResponse.json({ error: 'refreshToken and realmId are required' }, { status: 400 })
  }

  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)
    const agency = getDb()
      .prepare(`SELECT id FROM platform_agencies WHERE tenant_id = ? AND status = 'active' ORDER BY id LIMIT 1`)
      .get(tenant.id) as { id: number } | undefined

    // Validate the pasted token by exchanging it once (also gives a fresh
    // access token + the rotated refresh token, which we store going forward).
    const exchange = await exchangeRefreshToken(refreshToken)
    const { integrationId } = persistIntegration({
      tenantId: tenant.id,
      agencyId: agency?.id ?? null,
      realmId,
      exchange,
    })
    return NextResponse.json({ ok: true, integrationId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('[platform/qbo/bootstrap]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
