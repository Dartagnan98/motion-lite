// GET /api/ms365/callback — Microsoft Graph OAuth callback.
//
// Validates the signed state cookie (HMAC), exchanges the code (PKCE), fetches
// /me + /me/calendars, upserts a single crm_user_calendar_accounts row with
// provider='microsoft', encrypted tokens, and the calendars list in
// calendars_json. Then 302s to /settings?section=calendars&connected=ms365.

import { NextRequest, NextResponse } from 'next/server'
import {
  completeConnect,
  isMs365Configured,
  MS365_STATE_COOKIE_NAME,
  Ms365NotConfiguredError,
  unpackStateCookie,
} from '@/lib/ms365'

function redirectToSettings(req: NextRequest, status: 'ok' | string) {
  const base = process.env.APP_URL || req.nextUrl.origin
  const url = new URL('/settings', base)
  url.searchParams.set('section', 'calendars')
  if (status === 'ok') url.searchParams.set('connected', 'ms365')
  else url.searchParams.set('error', `ms365:${status}`)
  return NextResponse.redirect(url)
}

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

  const code = req.nextUrl.searchParams.get('code')
  const stateParam = req.nextUrl.searchParams.get('state')
  const errorParam = req.nextUrl.searchParams.get('error')

  if (errorParam) {
    // Microsoft returned an error (e.g. user cancelled). Surface it.
    const desc = req.nextUrl.searchParams.get('error_description')
    return redirectToSettings(
      req,
      `${errorParam}${desc ? `:${encodeURIComponent(desc)}` : ''}`,
    )
  }

  if (!code || !stateParam) {
    return NextResponse.json(
      { error: 'Missing code or state' },
      { status: 400 },
    )
  }

  const cookie = req.cookies.get(MS365_STATE_COOKIE_NAME)?.value
  const payload = cookie ? unpackStateCookie(cookie) : null
  if (!payload) {
    return NextResponse.json(
      { error: 'Invalid or expired OAuth state cookie' },
      { status: 400 },
    )
  }
  // CSRF defense: state from query MUST equal state from signed cookie.
  if (payload.state !== stateParam) {
    return NextResponse.json(
      { error: 'OAuth state mismatch' },
      { status: 400 },
    )
  }

  try {
    await completeConnect({
      userId: payload.user_id,
      workspaceId: payload.workspace_id,
      code,
      codeVerifier: payload.code_verifier,
    })
  } catch (e: unknown) {
    if (e instanceof Ms365NotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 })
    }
    const message = e instanceof Error ? e.message : 'Unknown error'
    // Clear state cookie even on failure
    const res = redirectToSettings(req, `exchange_failed:${encodeURIComponent(message)}`)
    res.cookies.set({
      name: MS365_STATE_COOKIE_NAME,
      value: '',
      path: '/api/ms365',
      maxAge: 0,
    })
    return res
  }

  const res = redirectToSettings(req, 'ok')
  // Burn the state cookie — it's single-use.
  res.cookies.set({
    name: MS365_STATE_COOKIE_NAME,
    value: '',
    path: '/api/ms365',
    maxAge: 0,
  })
  return res
}
