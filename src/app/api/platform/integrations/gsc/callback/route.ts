// GET /api/platform/integrations/gsc/callback
//
// Google redirects here after the user completes (or cancels) the OAuth flow.
// Query params: code, state (plus scope / error on failure).
//
// Flow:
//   1. Extract code + state from query string.
//   2. Verify HMAC-signed state (decodeState). Reject on failure.
//   3. finishConnectStage1: exchange code for tokens, list verified GSC sites.
//   4. Store exchange in a short-lived signed HttpOnly cookie.
//   5. Redirect to /platform/connect/gsc/select-site?sites=<encoded> for the
//      property picker UI. The picker POSTs to /api/platform/integrations/gsc/select-site
//      which persists the integration + fires the first snapshot.

import { NextRequest, NextResponse } from 'next/server'
import {
  finishConnectStage1,
} from '@/lib/platform/integrations/gsc/connect-flow'
import { signState } from '@/lib/platform/state'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const error = searchParams.get('error')

  const origin = req.nextUrl.origin

  // Google reports OAuth denials as ?error=access_denied
  if (error) {
    return NextResponse.redirect(
      `${origin}/platform/connect/gsc?error=${encodeURIComponent(error)}`
    )
  }

  // Google bounced back without code/state — usually means redirect URI isn't
  // registered in Google Cloud Console, or the user tampered with the URL.
  // Redirect to the connect page with a friendly error instead of raw JSON.
  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${origin}/platform/connect/gsc?error=missing_oauth_params`
    )
  }

  const redirectUri = `${origin}/api/platform/integrations/gsc/callback`

  try {
    // Exchange code + verify HMAC state; list GSC sites.
    const { exchange, sites, state } = await finishConnectStage1({
      code,
      state: stateParam,
      redirectUri,
    })

    if (!sites || sites.length === 0) {
      return NextResponse.redirect(
        `${origin}/platform/connect/gsc?error=no_verified_sites`
      )
    }

    // Encode exchange tokens in a short-lived signed HttpOnly cookie.
    const pendingPayload = {
      provider: 'gsc' as const,
      tenantId: state.tenantId,
      level: state.level,
      agencyId: state.agencyId,
      accountId: state.accountId,
      domainId: state.domainId,
      exchange_access_token: exchange.access_token,
      exchange_refresh_token: exchange.refresh_token,
      exchange_expires_in: exchange.expires_in,
      exchange_email: exchange.email,
      exchange_scopes: exchange.scopes,
    }
    const pendingState = signState(pendingPayload)

    // The picker fetches the FULL site list server-side from the pending token
    // (no URL cap / truncation) — we only redirect; the cookie carries the token.
    const dest = new URL(`${origin}/platform/connect/gsc/select-site`)

    const response = NextResponse.redirect(dest.toString())
    response.cookies.set('gsc_pending_connect', pendingState, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60,  // 10 minutes
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/gsc/callback]', message)
    return NextResponse.redirect(
      `${origin}/platform/connect/gsc?error=${encodeURIComponent(message)}`
    )
  }
}
