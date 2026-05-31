// GET /api/platform/integrations/gsc/reuse?credId=<id>
//
// Reuse an existing shared agency Google credential to connect GSC for the
// active client — NO re-auth. Resolves the connect context (active account),
// validates the credential belongs to the tenant, stashes it in the same signed
// pending cookie the OAuth callback uses (carrying tenant_credential_id instead
// of fresh tokens), then redirects to the property picker.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { loadTenantCredentialById } from '@/lib/platform/vault'
import { signState } from '@/lib/platform/state'

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const credId = parseInt(req.nextUrl.searchParams.get('credId') ?? '', 10)
  if (isNaN(credId) || credId <= 0) {
    return NextResponse.redirect(`${origin}/platform/connect/gsc?error=invalid_credential`)
  }

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.redirect(`${origin}/login`)
  const tenant = ensureTenantForWorkspace(workspaceId)

  // Validate the credential belongs to this tenant + is a Google credential.
  const cred = loadTenantCredentialById(credId)
  if (!cred || cred.tenant_id !== tenant.id || cred.provider !== 'google') {
    return NextResponse.redirect(`${origin}/platform/connect/gsc?error=credential_not_found`)
  }

  // Connect against the active client (account level).
  const accountId = await getCurrentAccountId(tenant.id)
  if (!accountId) {
    return NextResponse.redirect(`${origin}/platform/connect/gsc?error=no_active_client`)
  }

  const pendingPayload = {
    provider: 'gsc' as const,
    tenantId: tenant.id,
    level: 'account' as const,
    agencyId: null,
    accountId,
    domainId: null,
    tenant_credential_id: credId,
  }
  const pendingState = signState(pendingPayload)

  const response = NextResponse.redirect(`${origin}/platform/connect/gsc/select-site`)
  response.cookies.set('gsc_pending_connect', pendingState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  })
  return response
}
