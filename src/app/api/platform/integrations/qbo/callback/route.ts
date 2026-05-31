// GET /api/platform/integrations/qbo/callback
//
// Intuit redirects here with ?code, ?state, ?realmId. Verify the signed state,
// exchange the code for tokens, persist the tenant QBO credential + integration,
// then redirect to the PM dashboard.

import { NextRequest, NextResponse } from 'next/server'
import { verifyState } from '@/lib/platform/state'
import { exchangeCode, persistIntegration } from '@/lib/platform/integrations/qbo/oauth'

interface QboState {
  provider: string
  tenantId: number
  agencyId: number | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const origin = req.nextUrl.origin
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const realmId = searchParams.get('realmId')
  const error = searchParams.get('error')

  if (error) return NextResponse.redirect(`${origin}/platform/connect/qbo?error=${encodeURIComponent(error)}`)
  if (!code || !stateParam || !realmId) {
    return NextResponse.redirect(`${origin}/platform/connect/qbo?error=missing_oauth_params`)
  }

  const state = verifyState<QboState>(stateParam)
  if (!state || state.provider !== 'qbo') {
    return NextResponse.redirect(`${origin}/platform/connect/qbo?error=invalid_state`)
  }

  try {
    // Must match the redirect_uri used in the connect request exactly.
    const redirectUri = process.env.INTUIT_REDIRECT_URI || `${origin}/api/platform/integrations/qbo/callback`
    const exchange = await exchangeCode({ code, redirectUri })
    persistIntegration({ tenantId: state.tenantId, agencyId: state.agencyId, realmId, exchange })
    return NextResponse.redirect(`${origin}/platform/dashboard?connected=qbo`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/qbo/callback]', message)
    return NextResponse.redirect(`${origin}/platform/connect/qbo?error=${encodeURIComponent(message)}`)
  }
}
