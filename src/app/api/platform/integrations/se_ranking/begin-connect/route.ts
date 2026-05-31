// POST /api/platform/integrations/se_ranking/begin-connect
//
// Step 1 of the SE Ranking multi-step connect flow.
// Validates the API key by calling GET /sites (the project list endpoint),
// then sets a signed HttpOnly cookie carrying the pending connect state.
//
// Body: { apiKey: string }
// Response: { ok: true }
// Sets cookie: se_ranking_pending_connect (signed HMAC, HttpOnly, maxAge 10 min)

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { signState } from '@/lib/platform/state'

// SE Ranking Project API. Path + auth must stay in sync with the adapter
// (`src/lib/platform/integrations/se_ranking/adapter.ts`).
const SE_RANKING_BASE = 'https://api.seranking.com'

async function validateKey(apiKey: string): Promise<void> {
  const res = await fetch(`${SE_RANKING_BASE}/v1/project-management/sites`, {
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Invalid SE Ranking API key (${res.status}). ${text.slice(0, 200)}`
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`SE Ranking API error (${res.status}): ${text.slice(0, 200)}`)
  }
}

export async function POST(req: NextRequest) {
  let body: { apiKey?: unknown; accountId?: unknown }
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
    // Validate API key before looking up the tenant.
    try {
      await validateKey(apiKey)
    } catch (keyErr) {
      const msg = keyErr instanceof Error ? keyErr.message : 'Invalid SE Ranking API key'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    // Adopt as the agency's shared SE Ranking key (CONNECTOR-REUSE-PLAN A3).
    const { saveTenantCredential } = await import('@/lib/platform/vault')
    saveTenantCredential({ tenant_id: tenant.id, provider: 'se_ranking', auth_model: 'api_key', identity: 'default', api_key: apiKey })

    // Sprint 2 should-fix #1: prefer body-provided accountId over cookie to prevent
    // two-tab race where the cookie reflects a different account than the connect page.
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

    const payload = {
      provider: 'se_ranking',
      tenantId: tenant.id,
      level: 'account',
      agencyId: null,
      accountId,
      domainId: null,
      apiKey,
      step: 'project',
    }

    const signed = signState(payload)

    const response = NextResponse.json({ ok: true })
    response.cookies.set('se_ranking_pending_connect', signed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[platform/se_ranking/begin-connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
