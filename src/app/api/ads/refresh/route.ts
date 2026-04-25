import { NextRequest, NextResponse } from 'next/server'
import { syncAdsData, isSyncInProgress, getLastSyncTime } from '@/lib/ads-sync'
import { clearCreativeCache } from '@/lib/meta-api'
import { requireOwner } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const daysBack = parseInt(req.nextUrl.searchParams.get('days') || '3')
  const account = req.nextUrl.searchParams.get('account') || undefined

  if (isSyncInProgress()) {
    return NextResponse.json({ ok: false, message: 'Sync already in progress', lastSync: getLastSyncTime() })
  }

  // Clear creative cache so thumbnails refresh too
  clearCreativeCache()

  // Run sync (non-blocking for fast response, or blocking with ?wait=1)
  const wait = req.nextUrl.searchParams.get('wait') === '1'

  if (wait) {
    const result = await syncAdsData(daysBack, account)
    return NextResponse.json({ ...result, lastSync: Date.now() })
  }

  // Fire and forget - return immediately
  syncAdsData(daysBack, account).catch(console.error)
  return NextResponse.json({ ok: true, message: 'Sync started', lastSync: getLastSyncTime() })
}
