import { NextResponse } from 'next/server'
import { getValidZoomToken } from '@/lib/zoom'
import { getProviderToken } from '@/lib/provider-tokens'
import { getDb } from '@/lib/db'

// Proactive Zoom token refresh - keeps token alive so it never goes stale
// Called by the auto-scheduler cron or directly
export async function GET() {
  try {
    // Find the user who has a Zoom token
    const db = getDb()
    const row = db.prepare("SELECT user_id FROM provider_tokens WHERE provider = 'zoom' LIMIT 1").get() as { user_id: number } | undefined

    if (!row) {
      return NextResponse.json({ status: 'no_token', message: 'No Zoom token found' })
    }

    const token = await getProviderToken(row.user_id, 'zoom')
    if (!token) {
      return NextResponse.json({ status: 'no_token', message: 'Token not found' })
    }

    const now = Math.floor(Date.now() / 1000)
    const expiresIn = token.token_expiry - now

    // Only refresh if expiring within 30 minutes
    if (expiresIn < 1800) {
      await getValidZoomToken(row.user_id)
      return NextResponse.json({ status: 'refreshed', message: 'Token refreshed', email: token.provider_email })
    }

    return NextResponse.json({ status: 'valid', message: `Token valid for ${Math.round(expiresIn / 60)} more minutes`, email: token.provider_email })
  } catch (error: any) {
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 })
  }
}
