import { NextRequest, NextResponse } from 'next/server'
import { buildCreativeMap, fetchAdEngagement, type MetaAdCreative, type AdEngagementMetrics } from '@/lib/meta-api'
import { getAllEnabledAdAccounts } from '@/lib/db'
import { requireOwner } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const clientSlug = req.nextUrl.searchParams.get('client') || null
  const days = parseInt(req.nextUrl.searchParams.get('days') || '30')

  // Get connected accounts from DB
  const allAccounts = getAllEnabledAdAccounts()
  let accountIds: string[]
  if (clientSlug) {
    accountIds = allAccounts.filter(a => a.client_slug === clientSlug).map(a => a.account_id)
    if (accountIds.length === 0) accountIds = allAccounts.map(a => a.account_id)
  } else {
    accountIds = [...new Set(allAccounts.map(a => a.account_id))]
  }

  try {
    // Fetch creatives and engagement in parallel
    const dateEnd = new Date().toISOString().split('T')[0]
    const dateStart = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

    const [creativeMap, ...engagementResults] = await Promise.all([
      buildCreativeMap(accountIds),
      ...accountIds.map(id => fetchAdEngagement(id, dateStart, dateEnd)),
    ])

    // Merge engagement maps
    const engagementMap = new Map<string, AdEngagementMetrics>()
    for (const result of engagementResults) {
      for (const [key, val] of result) {
        engagementMap.set(key, val)
      }
    }

    // Build response: merge creative + engagement
    const creatives: Array<MetaAdCreative & {
      engagement?: AdEngagementMetrics
      thumbnailProxy: string
      videoProxy: string | null
    }> = []

    for (const [adId, creative] of creativeMap) {
      const engagement = engagementMap.get(adId)
      creatives.push({
        ...creative,
        engagement: engagement || undefined,
        thumbnailProxy: `/api/ads/thumb/${adId}`,
        videoProxy: creative.videoId ? `/api/ads/video/${creative.videoId}` : null,
      })
    }

    return NextResponse.json({
      creatives,
      total: creatives.length,
      accounts: accountIds.length,
    })
  } catch (err) {
    console.error('Creatives API error:', err)
    return NextResponse.json({ error: 'Failed to fetch creatives' }, { status: 500 })
  }
}
