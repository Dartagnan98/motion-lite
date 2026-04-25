import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, createGoogleAccount, syncCalendarList } from '@/lib/google'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const code = req.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 })
  }

  try {
    const { access_token, refresh_token, expires_in, email } = await exchangeCode(code)
    const account = createGoogleAccount(email, access_token, refresh_token, expires_in)
    await syncCalendarList(account.id)
    return NextResponse.redirect(new URL('/settings?section=calendars&connected=1', process.env.APP_URL || 'https://app.example.com'))
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
