import { NextRequest, NextResponse } from 'next/server'
import { upsertUser, createSession, getCurrentUser } from '@/lib/auth'
import { exchangeZoomCode } from '@/lib/zoom'
import { saveProviderToken } from '@/lib/provider-tokens'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')
  const isConnect = state === 'connect'

  // Zoom sends error param if user denied or something went wrong
  if (error) {
    return NextResponse.redirect(new URL(isConnect ? `/settings?section=conference&error=${error}` : `/login?error=${error}`, process.env.APP_URL || 'https://app.example.com'))
  }

  if (!code) {
    return NextResponse.redirect(new URL(isConnect ? '/settings?section=conference&error=no_code' : '/login?error=no_code', process.env.APP_URL || 'https://app.example.com'))
  }

  try {
    const zoom = await exchangeZoomCode(code)

    if (isConnect) {
      const currentUser = await getCurrentUser()
      if (!currentUser) {
        return NextResponse.redirect(new URL('/login', process.env.APP_URL || 'https://app.example.com'))
      }
      await saveProviderToken(currentUser.id, 'zoom', zoom.access_token, zoom.refresh_token, zoom.expires_in, zoom.zoom_user_id, zoom.email)
      return NextResponse.redirect(new URL('/settings?section=conference&connected=zoom', process.env.APP_URL || 'https://app.example.com'))
    }

    const user = await upsertUser(zoom.email, zoom.name, zoom.avatar_url)
    await saveProviderToken(user.id, 'zoom', zoom.access_token, zoom.refresh_token, zoom.expires_in, zoom.zoom_user_id, zoom.email)
    const sessionId = await createSession(user.id)

    const cookieStore = await cookies()
    cookieStore.set('session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    })

    return NextResponse.redirect(new URL('/', process.env.APP_URL || 'https://app.example.com'))
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[zoom-callback] Error:', message)
    return NextResponse.redirect(new URL(isConnect ? '/settings?section=conference&error=zoom_failed' : '/login?error=zoom_failed', process.env.APP_URL || 'https://app.example.com'))
  }
}
