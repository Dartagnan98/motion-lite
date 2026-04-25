import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { exchangeGoogleAdsCode } from '@/lib/google-ads'
import { saveProviderToken } from '@/lib/provider-tokens'

const APP_URL = process.env.APP_URL || 'https://app.example.com'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const isConnect = state === 'connect'

  if (!code) {
    return NextResponse.redirect(new URL('/settings?section=google-ads&error=no_code', APP_URL))
  }

  try {
    const result = await exchangeGoogleAdsCode(code)

    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.redirect(new URL('/login', APP_URL))
    }

    await saveProviderToken(
      currentUser.id,
      'google_ads',
      result.access_token,
      result.refresh_token,
      result.expires_in,
      undefined,
      result.email
    )

    return NextResponse.redirect(new URL('/settings?section=google-ads&connected=google_ads', APP_URL))
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('Google Ads auth error:', message)
    return NextResponse.redirect(new URL('/settings?section=google-ads&error=google_ads_failed', APP_URL))
  }
}
