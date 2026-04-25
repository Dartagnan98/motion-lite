import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAdsOAuthUrl } from '@/lib/google-ads'

export async function GET(req: NextRequest) {
  try {
    const connect = req.nextUrl.searchParams.get('connect')
    const state = connect ? 'connect' : undefined
    const url = getGoogleAdsOAuthUrl(state)
    return NextResponse.redirect(url)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
