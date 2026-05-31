// GET /api/platform/integrations/asana/callback
//
// Asana redirects here after the user completes (or cancels) the OAuth flow.
// Query params: code, state (plus error on failure).
//
// Flow:
//   1. Extract code + state from query string.
//   2. Verify HMAC-signed state (decodeState). Reject with redirect-to-error on failure.
//   3. finishConnectStage1: exchange code → tokens, list accessible Asana workspaces.
//   4. Store the exchange temporarily in a signed cookie so the workspace-picker
//      page can call completeConnect without re-exchanging the code.
//      (State is short-lived — cookie expires in 10 minutes.)
//   5. Redirect to /platform/connect/asana/select-workspace.
//
// Cookie security: HttpOnly + Secure + SameSite=Lax. Signed with HMAC via signState.
// The cookie is never read by client-side JS; only the select-workspace route reads it.
// Mirrors /api/platform/integrations/ga4/callback/route.ts exactly.

import { NextRequest, NextResponse } from 'next/server'
import { finishConnectStage1 } from '@/lib/platform/integrations/asana/connect-flow'
import { signState } from '@/lib/platform/state'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const error = searchParams.get('error')

  const origin = req.nextUrl.origin

  if (error) {
    return NextResponse.redirect(
      `${origin}/platform/connect/asana?error=${encodeURIComponent(error)}`
    )
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${origin}/platform/connect/asana?error=missing_oauth_params`
    )
  }

  const redirectUri = `${origin}/api/platform/integrations/asana/callback`

  try {
    // Exchange code + verify HMAC state; list Asana workspaces.
    const { exchange, workspaces, state } = await finishConnectStage1({
      code,
      state: stateParam,
      redirectUri,
    })

    // Encode the token exchange result in a short-lived signed cookie so the
    // select-workspace page can call completeConnect without re-exchanging the code.
    const pendingPayload = {
      provider: 'asana' as const,
      tenantId: state.tenantId,
      level: state.level,
      agencyId: state.agencyId,
      accountId: state.accountId,
      domainId: state.domainId,
      exchange_access_token: exchange.access_token,
      exchange_refresh_token: exchange.refresh_token,
      exchange_expires_in: exchange.expires_in,
      exchange_email: exchange.data?.email ?? null,
      exchange_scopes: exchange.scopes,
    }
    const pendingState = signState(pendingPayload)

    const dest = `${origin}/platform/connect/asana/select-workspace`
    const response = NextResponse.redirect(dest)
    response.cookies.set('asana_pending_connect', pendingState, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60,  // 10 minutes
      path: '/',
    })

    // Suppress unused-variable warning: workspaces is fetched during stage1 to
    // verify the token works. The select-workspace page re-calls listWorkspaces
    // from the cookie token (same pattern as GA4 — list is fetched server-side
    // in the page server component, not passed via URL).
    void workspaces

    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/asana/callback]', message)
    return NextResponse.redirect(
      `${origin}/platform/connect/asana?error=${encodeURIComponent(message)}`
    )
  }
}
