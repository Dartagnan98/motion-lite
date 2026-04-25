import { NextRequest, NextResponse } from 'next/server'
import { upsertUser, createSession, getCurrentUser } from '@/lib/auth'
import { exchangeFacebookCode } from '@/lib/facebook'
import { saveProviderToken } from '@/lib/provider-tokens'
import { cookies } from 'next/headers'

const APP_URL = process.env.APP_URL || 'https://app.example.com'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const isConnect = state === 'connect'

  if (!code) {
    const errorUrl = isConnect ? '/settings?section=meta-ads&error=no_code' : '/login?error=no_code'
    return NextResponse.redirect(new URL(errorUrl, APP_URL))
  }

  try {
    const fb = await exchangeFacebookCode(code)

    if (isConnect) {
      const currentUser = await getCurrentUser()
      if (!currentUser) {
        return NextResponse.redirect(new URL('/login', APP_URL))
      }
      await saveProviderToken(currentUser.id, 'facebook', fb.access_token, null, fb.expires_in, fb.fb_user_id, fb.email)
      return NextResponse.redirect(new URL('/settings?section=meta-ads&connected=facebook', APP_URL))
    }

    if (!fb.email) {
      return NextResponse.redirect(new URL('/login?error=no_email', APP_URL))
    }
    const user = await upsertUser(fb.email, fb.name, fb.avatar_url)
    await saveProviderToken(user.id, 'facebook', fb.access_token, null, fb.expires_in, fb.fb_user_id, fb.email)
    const sessionId = await createSession(user.id)

    const cookieStore = await cookies()
    cookieStore.set('session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    })

    return NextResponse.redirect(new URL('/', APP_URL))
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('Facebook auth error:', message)
    const errorUrl = isConnect ? '/settings?section=meta-ads&error=facebook_failed' : '/login?error=facebook_failed'
    return NextResponse.redirect(new URL(errorUrl, APP_URL))
  }
}
