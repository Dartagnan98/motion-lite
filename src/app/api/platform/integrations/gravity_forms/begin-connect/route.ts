// POST /api/platform/integrations/gravity_forms/begin-connect
//
// Step 1 of the Gravity Forms multi-step connect flow.
// Validates credentials by calling /wp-json/gf/v2/forms with basic auth.
// Sets a signed HttpOnly cookie with the pending state + form list.
//
// Body: { siteUrl: string, username: string, appPassword: string }
// Response: { ok: true }
// Sets cookie: gravity_forms_pending_connect (signed HMAC, HttpOnly, maxAge 10 min)

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { signState } from '@/lib/platform/state'

export interface GravityForm {
  id: string
  title: string
  entryCount?: number
}

async function fetchGravityForms(
  siteUrl: string,
  username: string,
  appPassword: string
): Promise<GravityForm[]> {
  const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64')
  const res = await fetch(`${siteUrl}/wp-json/gf/v2/forms`, {
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'Gravity Forms authentication failed — check username and application password.'
    )
  }
  if (res.status === 404) {
    throw new Error(
      'Gravity Forms REST API not found. Enable it under Forms > Settings > REST API in WP admin.'
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gravity Forms API error (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json() as Record<string, { id?: number | string; title?: string }>
  // GF REST API returns an object keyed by form ID, not an array.
  return Object.values(data).map((form) => ({
    id: String(form.id ?? ''),
    title: String(form.title ?? `Form ${form.id ?? ''}`),
  })).filter((f) => f.id)
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
    // Validate credentials + fetch form list.
    let forms: GravityForm[]
    try {
      forms = await fetchGravityForms(siteUrl, username, appPassword)
    } catch (credErr) {
      const msg = credErr instanceof Error ? credErr.message : 'Credential validation failed'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

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

    const payload = {
      provider: 'gravity_forms',
      tenantId: tenant.id,
      level: 'account',
      agencyId: null,
      accountId,
      domainId: null,
      siteUrl,
      username,
      appPassword,
      forms: JSON.stringify(forms),
      step: 'forms',
    }

    const signed = signState(payload)

    const response = NextResponse.json({ ok: true })
    response.cookies.set('gravity_forms_pending_connect', signed, {
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
    console.error('[platform/gravity_forms/begin-connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
