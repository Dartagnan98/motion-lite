import { NextRequest, NextResponse } from 'next/server'
import { getZoomOAuthUrl } from '@/lib/zoom'

export async function GET(req: NextRequest) {
  try {
    const connect = req.nextUrl.searchParams.get('connect')
    const state = connect ? 'connect' : undefined
    const url = getZoomOAuthUrl(state)
    return NextResponse.redirect(url)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[zoom-auth] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
