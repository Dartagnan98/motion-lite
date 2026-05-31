// GET /api/ms365/auth — begin Microsoft Graph OAuth (PKCE + state).
//
// Behavior:
//   1. requireAuthWithWorkspace → resolves the calling user + their workspace.
//   2. generate PKCE pair + random state.
//   3. set httpOnly state cookie carrying { state, code_verifier, user_id,
//      workspace_id, exp } (HMAC-signed). 10-minute TTL.
//   4. 302 to login.microsoftonline.com.
//
// If MS365 env vars are missing, return 503 with a helpful message rather than
// 500. The frontend Connect button surfaces this as a graceful error.

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAuthWithWorkspace } from '@/lib/auth'
import {
  buildAuthUrl,
  generatePkce,
  isMs365Configured,
  MS365_STATE_COOKIE_NAME,
  MS365_STATE_COOKIE_TTL_SECONDS,
  Ms365NotConfiguredError,
  packStateCookie,
} from '@/lib/ms365'

export async function GET(req: NextRequest) {
  if (!isMs365Configured()) {
    return NextResponse.json(
      {
        error:
          'MS365_CLIENT_ID / MS365_CLIENT_SECRET not configured. See README — Azure AD App Setup.',
      },
      { status: 503 },
    )
  }

  let user: { id: number }
  let workspaceId: number
  try {
    const ctx = await requireAuthWithWorkspace(req)
    user = ctx.user
    workspaceId = ctx.workspaceId
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'UNAUTHORIZED'
    return NextResponse.json(
      { error: msg },
      { status: msg === 'FORBIDDEN' || msg === 'NO_WORKSPACE' ? 403 : 401 },
    )
  }

  try {
    const state = crypto.randomBytes(16).toString('hex')
    const pkce = generatePkce()
    const authorizeUrl = buildAuthUrl({
      state,
      codeChallenge: pkce.challenge,
    })

    const exp = Math.floor(Date.now() / 1000) + MS365_STATE_COOKIE_TTL_SECONDS
    const cookieValue = packStateCookie({
      state,
      code_verifier: pkce.verifier,
      user_id: user.id,
      workspace_id: workspaceId,
      exp,
    })

    const res = NextResponse.redirect(authorizeUrl)
    res.cookies.set({
      name: MS365_STATE_COOKIE_NAME,
      value: cookieValue,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/ms365',
      maxAge: MS365_STATE_COOKIE_TTL_SECONDS,
    })
    return res
  } catch (e: unknown) {
    if (e instanceof Ms365NotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 })
    }
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
