// POST /api/platform/accounts/[id]/activate
//
// Sets the signed active_account_id cookie to the given account.
// Validates tenant ownership before writing the cookie.
//
// Response: { ok: true }

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import {
  ensureTenantForWorkspace,
  assertTenantOwnsRow,
  buildActiveAccountCookie,
} from '@/lib/platform/tenant'

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: idStr } = await params
  const accountId = parseInt(idStr, 10)
  if (isNaN(accountId) || accountId <= 0) {
    return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
  }

  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    // Guard: account (now a client_profiles row, post Phase C) must belong to this tenant.
    assertTenantOwnsRow(tenant, 'client_profiles', accountId)

    const cookieValue = buildActiveAccountCookie(tenant.id, accountId)
    const response = NextResponse.json({ ok: true })
    response.cookies.set('hiilite_active_account_id', cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (message.startsWith('assertTenantOwnsRow')) {
      return NextResponse.json({ error: 'Account not found or access denied' }, { status: 404 })
    }
    console.error('[api/platform/accounts/activate]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
