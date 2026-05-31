// POST /api/platform/integrations/everhour/begin-connect
//
// Step 1 of the Everhour multi-step connect flow.
// Validates the API key by calling /users/me, then sets a signed HttpOnly
// cookie carrying the pending connect state. The cookie is consumed by the
// select-clients and select-projects pages.
//
// Body: { apiKey: string }
// Response: { ok: true }
// Sets cookie: everhour_pending_connect (signed HMAC, HttpOnly, maxAge 10 min)

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { signState } from '@/lib/platform/state'

const EVERHOUR_API_BASE = 'https://api.everhour.com'

async function validateKey(apiKey: string): Promise<void> {
  const res = await fetch(`${EVERHOUR_API_BASE}/users/me`, {
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
  })
  if (res.status === 401) {
    throw new Error('Invalid Everhour API key')
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Everhour API error (${res.status}): ${text}`)
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
    // Validate the API key first — fail fast before we even look up the tenant.
    try {
      await validateKey(apiKey)
    } catch (keyErr) {
      const msg = keyErr instanceof Error ? keyErr.message : 'Invalid Everhour API key'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    // Adopt the key as the agency's shared Everhour key so future clients
    // prefill it instead of re-pasting (CONNECTOR-REUSE-PLAN A3).
    const { saveTenantCredential } = await import('@/lib/platform/vault')
    saveTenantCredential({ tenant_id: tenant.id, provider: 'everhour', auth_model: 'api_key', identity: 'default', api_key: apiKey })

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

    // Sign the pending state and set the cookie.
    const payload = {
      provider: 'everhour',
      tenantId: tenant.id,
      level: 'account',
      agencyId: null,
      accountId,
      domainId: null,
      apiKey,
      step: 'clients',
    }

    const signed = signState(payload)

    const response = NextResponse.json({ ok: true })
    response.cookies.set('everhour_pending_connect', signed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[platform/everhour/begin-connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
