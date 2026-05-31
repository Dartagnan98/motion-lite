// POST /api/platform/integrations/ga4/connect
//
// Mirrors /api/platform/integrations/gsc/connect exactly. Body shape is
// the same; only the adapter call differs.
//
// Body: { level: 'agency'|'account'|'domain',
//         workspaceId?: number,
//         agencyId?: number, accountId?: number, domainId?: number }
//
// Resolves tenant, builds HMAC-signed OAuth state, returns { redirectUrl }.
// The caller (connect page) navigates the browser to Google's consent screen.

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMember, requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { ga4Adapter } from '@/lib/platform/integrations/ga4/adapter'
import { getDb } from '@/lib/db'

export async function POST(req: NextRequest) {
  let body: {
    workspaceId?: unknown
    level?: unknown
    agencyId?: unknown
    accountId?: unknown
    domainId?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const bodyWorkspaceId = typeof body.workspaceId === 'number' ? body.workspaceId : null

  const level = body.level as 'agency' | 'account' | 'domain' | undefined
  if (!level || !['agency', 'account', 'domain'].includes(level)) {
    return NextResponse.json({ error: 'level must be agency|account|domain' }, { status: 400 })
  }

  let agencyId = typeof body.agencyId === 'number' ? body.agencyId : null
  let accountId = typeof body.accountId === 'number' ? body.accountId : null
  const domainId = typeof body.domainId === 'number' ? body.domainId : null

  if (level === 'domain' && !domainId) {
    return NextResponse.json({ error: 'domainId required when level=domain' }, { status: 400 })
  }

  try {
    let workspaceId: number
    if (bodyWorkspaceId !== null) {
      await requireWorkspaceMember(bodyWorkspaceId)
      workspaceId = bodyWorkspaceId
    } else {
      const resolved = await requireAuthWithWorkspace(req)
      workspaceId = resolved.workspaceId
    }

    const tenant = ensureTenantForWorkspace(workspaceId)

    // Fill in agency/account FK — prefer active account cookie, then first row.
    if (level === 'account' && !accountId) {
      accountId = await getCurrentAccountId(tenant.id)
      if (!accountId) {
        return NextResponse.json(
          { error: 'No active client selected. Create a client first.' },
          { status: 400 }
        )
      }
    }
    if (level === 'agency' && !agencyId) {
      const row = getDb()
        .prepare(`SELECT id FROM platform_agencies WHERE tenant_id = ? AND status = 'active' ORDER BY id LIMIT 1`)
        .get(tenant.id) as { id: number } | undefined
      if (!row) {
        return NextResponse.json(
          { error: 'No agencies seeded for this tenant. Run scripts/seed-glenvalley.mjs.' },
          { status: 400 }
        )
      }
      agencyId = row.id
    }

    const origin = req.headers.get('origin') || req.nextUrl.origin
    const redirectUri = `${origin}/api/platform/integrations/ga4/callback`

    const result = await ga4Adapter.connect({
      tenantId: tenant.id,
      level,
      agencyId,
      accountId,
      domainId,
      redirectUri,
    })

    if (!result.redirectUrl) {
      return NextResponse.json({ error: 'Adapter did not return a redirectUrl' }, { status: 500 })
    }

    return NextResponse.json({ redirectUrl: result.redirectUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[platform/ga4/connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
