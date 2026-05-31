// POST /api/platform/integrations/qbo/connect
//
// Starts the Intuit OAuth flow for the tenant (agency-level — one QBO realm
// serves all the tenant's clients). Returns { redirectUrl }.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace } from '@/lib/platform/tenant'
import { qboAdapter } from '@/lib/platform/integrations/qbo/adapter'
import { getDb } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    const agency = getDb()
      .prepare(`SELECT id FROM platform_agencies WHERE tenant_id = ? AND status = 'active' ORDER BY id LIMIT 1`)
      .get(tenant.id) as { id: number } | undefined

    // Fixed redirect URI (must EXACTLY match the one registered in the Intuit
    // app AND the one used at token exchange). Env-pinned to avoid origin-header
    // drift between the connect request and the callback.
    const origin = req.headers.get('origin') || req.nextUrl.origin
    const redirectUri = process.env.INTUIT_REDIRECT_URI || `${origin}/api/platform/integrations/qbo/callback`

    const result = await qboAdapter.connect({
      tenantId: tenant.id,
      level: 'agency',
      agencyId: agency?.id ?? null,
      accountId: null,
      domainId: null,
      redirectUri,
    })
    if (!result.redirectUrl) {
      return NextResponse.json({ error: 'Adapter did not return a redirectUrl' }, { status: 500 })
    }
    return NextResponse.json({ redirectUrl: result.redirectUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('[platform/qbo/connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
