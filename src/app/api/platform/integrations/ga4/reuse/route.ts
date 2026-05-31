// GET /api/platform/integrations/ga4/reuse?credId=<id>
//
// Reuse an existing shared agency Google credential to connect GA4 for the
// active client — no re-auth. Mirrors the GSC reuse route. Stashes the shared
// credential id in the pending cookie and redirects to the property picker.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { loadTenantCredentialById } from '@/lib/platform/vault'
import { signState } from '@/lib/platform/state'

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const credId = parseInt(req.nextUrl.searchParams.get('credId') ?? '', 10)
  if (isNaN(credId) || credId <= 0) {
    return NextResponse.redirect(`${origin}/platform/connect/ga4?error=invalid_credential`)
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.redirect(`${origin}/login`)
  const tenant = ensureTenantForWorkspace(workspaceId)

  const cred = loadTenantCredentialById(credId)
  if (!cred || cred.tenant_id !== tenant.id || cred.provider !== 'google') {
    return NextResponse.redirect(`${origin}/platform/connect/ga4?error=credential_not_found`)
  }

  const accountId = await getCurrentAccountId(tenant.id)
  if (!accountId) {
    return NextResponse.redirect(`${origin}/platform/connect/ga4?error=no_active_client`)
  }

  const pendingState = signState({
    provider: 'ga4' as const,
    tenantId: tenant.id,
    level: 'account' as const,
    agencyId: null,
    accountId,
    domainId: null,
    tenant_credential_id: credId,
  })

  const response = NextResponse.redirect(`${origin}/platform/connect/ga4/select-property`)
  response.cookies.set('ga4_pending_connect', pendingState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  })
  return response
}
