// GET /api/platform/integrations/ga4/callback
//
// Google redirects here after the user completes (or cancels) the GA4 OAuth flow.
// Query params: code, state (plus scope / error on failure).
//
// Flow:
//   1. Extract code + state from query string.
//   2. Verify HMAC-signed state (decodeState). Reject with redirect-to-error on failure.
//   3. finishConnectStage1: exchange code → tokens, list accessible GA4 properties.
//   4. Store the exchange temporarily in a signed cookie so the property-picker
//      page can call completeConnect without re-exchanging the code.
//      (State is short-lived — cookie expires in 10 minutes.)
//   5. Redirect to /platform/connect/ga4/select-property?integrationId=pending
//      which shows the property picker.
//   6. The picker page POSTs propertyId → /api/platform/integrations/ga4/select-property
//      which calls completeConnect + fires the first snapshot.
//
// Note on session storage of the exchange result:
//   We cannot pass the access_token through a query param (secret leakage).
//   Options:
//     A. Signed cookie (chosen) — stateless, no table, expires quickly.
//     B. Server-side nonce table — adds DB reads.
//   Option A is simpler. The cookie is HttpOnly + Secure + SameSite=Lax.
//   Frontend never reads it; only the select-property route reads it.

import { NextRequest, NextResponse } from 'next/server'
import {
  finishConnectStage1,
} from '@/lib/platform/integrations/ga4/connect-flow'
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
      `${origin}/platform/connect/ga4?error=${encodeURIComponent(error)}`
    )
  }

  // Google bounced back without code/state — usually means redirect URI isn't
  // registered in Google Cloud Console, or the user tampered with the URL.
  // Redirect to the connect page with a friendly error instead of raw JSON.
  if (!code || !stateParam) {
    return NextResponse.redirect(
      `${origin}/platform/connect/ga4?error=missing_oauth_params`
    )
  }

  const redirectUri = `${origin}/api/platform/integrations/ga4/callback`

  try {
    // Exchange code + verify HMAC state; list GA4 properties.
    const { exchange, properties, state } = await finishConnectStage1({
      code,
      state: stateParam,
      redirectUri,
    })

    if (!properties || properties.length === 0) {
      return NextResponse.redirect(
        `${origin}/platform/connect/ga4?error=no_properties_found`
      )
    }

    // Encode the token exchange result in a short-lived signed cookie so the
    // select-property page can call completeConnect without re-exchanging the code.
    // The signed state includes the CallbackState + exchange tokens.
    const pendingPayload = {
      provider: 'ga4' as const,
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

    // Build the redirect to the select-property UI page. The picker fetches
    // the property list server-side from the access token in the pending cookie
    // (passing the list via URL hits the 16KB request-header limit at scale).

    // Pass the pending state via a short-lived cookie (10 minutes).
    const dest = `${origin}/platform/connect/ga4/select-property`
    const response = NextResponse.redirect(dest)
    response.cookies.set('ga4_pending_connect', pendingState, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60,  // 10 minutes
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/ga4/callback]', message)
    return NextResponse.redirect(
      `${origin}/platform/connect/ga4?error=${encodeURIComponent(message)}`
    )
  }
}
