import { NextRequest, NextResponse } from 'next/server'
import { syncGoogleAdsData, isGoogleAdsSyncInProgress } from '@/lib/google-ads-sync'
import { requireOwner } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const days = parseInt(req.nextUrl.searchParams.get('days') || '3')
  const account = req.nextUrl.searchParams.get('account') || undefined
  const wait = req.nextUrl.searchParams.get('wait') === '1'

  if (isGoogleAdsSyncInProgress()) {
    return NextResponse.json({ ok: false, message: 'Sync already in progress' })
  }

  if (wait) {
    const result = await syncGoogleAdsData(days, account)
    return NextResponse.json(result)
  } else {
    syncGoogleAdsData(days, account).catch(console.error)
    return NextResponse.json({ ok: true, message: 'Sync started in background' })
  }
}
