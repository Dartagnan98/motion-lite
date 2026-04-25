import { NextRequest, NextResponse } from 'next/server'
import { getCreativeCacheSync } from '@/lib/meta-api'
import { isSyncStale, syncAdsData } from '@/lib/ads-sync'
import { getAllEnabledAdAccounts } from '@/lib/db'
import { requireOwner } from '@/lib/auth'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAccounts() {
  const connected = getAllEnabledAdAccounts()
  return connected.map(a => ({ id: a.account_id, name: a.account_name, slug: a.client_slug || '' }))
}

interface AdPerformance {
  ad_id: string
  ad_name: string
  account_id: string
  account_name: string
  client_slug: string
  campaign_id: string
  campaign_name: string
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  ctr: number
  cpc: number
  leads: number
  cpl: number
  hook_rate: number
  hold_rate: number
  video_views: number
  video_thruplay: number
  video_p25_watched: number
  video_p50_watched: number
  video_p75_watched: number
  video_p95_watched: number
  reach: number
  frequency: number
  cpm: number
}

async function fetchPerformanceData(
  accountId: string | null,
  dateStart: string,
  dateEnd: string
): Promise<AdPerformance[]> {
  let url = `${SUPABASE_URL}/rest/v1/ad_performance_daily?select=ad_id,ad_name,account_id,account_name,client_slug,campaign_id,campaign_name,spend,impressions,clicks,link_clicks,ctr,cpc,leads,cpl,hook_rate,hold_rate,video_views,video_thruplay,video_p25_watched,video_p50_watched,video_p75_watched,video_p95_watched,reach,frequency,cpm&date=gte.${dateStart}&date=lte.${dateEnd}`

  if (accountId) {
    url += `&account_id=eq.${accountId}`
  } else {
    const accountIds = getAccounts().map(a => a.id)
    if (accountIds.length === 0) return []
    url += `&account_id=in.(${accountIds.join(',')})`
  }

  const response = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  })
  return (await response.json()) as AdPerformance[]
}

function aggregateByAdCampaign(data: AdPerformance[]) {
  const adMap = new Map<string, Record<string, unknown>>()

  for (const row of data) {
    const key = `${row.ad_id}_${row.campaign_id || 'unknown'}`
    const existing = adMap.get(key)
    if (existing) {
      existing.spend = (existing.spend as number) + (row.spend || 0)
      existing.impressions = (existing.impressions as number) + (row.impressions || 0)
      existing.clicks = (existing.clicks as number) + (row.clicks || 0)
      existing.link_clicks = (existing.link_clicks as number) + (row.link_clicks || 0)
      existing.leads = (existing.leads as number) + (row.leads || 0)
      existing.reach = (existing.reach as number) + (row.reach || 0)
      existing.video_views = (existing.video_views as number) + (row.video_views || 0)
      existing.video_thruplay = (existing.video_thruplay as number) + (row.video_thruplay || 0)
      existing.video_p25 = (existing.video_p25 as number) + (row.video_p25_watched || 0)
      existing.video_p50 = (existing.video_p50 as number) + (row.video_p50_watched || 0)
      existing.video_p75 = (existing.video_p75 as number) + (row.video_p75_watched || 0)
      existing.video_p95 = (existing.video_p95 as number) + (row.video_p95_watched || 0)
    } else {
      adMap.set(key, {
        ad_id: row.ad_id,
        ad_name: row.ad_name || 'Unnamed Ad',
        account_name: row.account_name || 'Unknown Account',
        campaign_id: row.campaign_id || '',
        campaign_name: row.campaign_name || 'Unknown Campaign',
        spend: row.spend || 0,
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        link_clicks: row.link_clicks || 0,
        leads: row.leads || 0,
        reach: row.reach || 0,
        video_views: row.video_views || 0,
        video_thruplay: row.video_thruplay || 0,
        video_p25: row.video_p25_watched || 0,
        video_p50: row.video_p50_watched || 0,
        video_p75: row.video_p75_watched || 0,
        video_p95: row.video_p95_watched || 0,
        ctr: 0, cpc: 0, cpm: 0, cpl: 0, hook_rate: 0, hold_rate: 0,
        link_clicks_ctr: 0, cost_per_link_click: 0, frequency: 0,
        hookScore: 'red', clickScore: 'red', conversionScore: 'none',
        thumbnailUrl: null, imageUrl: null, objectType: null,
        videoUrl: null, videoId: null, effectiveStatus: null,
        body: null, title: null, ctaType: null, linkUrl: null,
        adsetName: null, optimizationGoal: null,
      })
    }
  }

  // Compute derived metrics
  for (const [, ad] of adMap) {
    const impressions = ad.impressions as number
    const clicks = ad.clicks as number
    const spend = ad.spend as number
    const link_clicks = ad.link_clicks as number
    const leads = ad.leads as number
    const reach = ad.reach as number
    const video_views = ad.video_views as number
    const video_thruplay = ad.video_thruplay as number

    if (impressions > 0) {
      ad.ctr = (clicks / impressions) * 100
      ad.link_clicks_ctr = (link_clicks / impressions) * 100
      ad.cpm = (spend / impressions) * 1000
      ad.hook_rate = (video_views / impressions) * 100
    }
    if (video_views > 0) ad.hold_rate = (video_thruplay / video_views) * 100
    if (clicks > 0) ad.cpc = spend / clicks
    if (link_clicks > 0) ad.cost_per_link_click = spend / link_clicks
    if (leads > 0) ad.cpl = spend / leads
    if (reach > 0) ad.frequency = impressions / reach

    const hook_rate = ad.hook_rate as number
    const ctr = ad.ctr as number
    const cpl = ad.cpl as number
    ad.hookScore = hook_rate > 25 ? 'green' : hook_rate > 15 ? 'yellow' : 'red'
    ad.clickScore = ctr > 2 ? 'green' : ctr > 1 ? 'yellow' : 'red'
    ad.conversionScore = leads === 0 ? 'none' : cpl < 50 ? 'green' : cpl < 100 ? 'yellow' : 'red'
  }

  return adMap
}

export async function GET(request: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('account') || null
  const sortBy = searchParams.get('sort') || 'spend'

  const today = new Date()
  let dateEnd = today.toISOString().split('T')[0]
  let dateStart: string
  if (searchParams.get('start') && searchParams.get('end')) {
    dateStart = searchParams.get('start')!
    dateEnd = searchParams.get('end')!
  } else {
    const days = parseInt(searchParams.get('days') || '7')
    const startDate = new Date()
    startDate.setDate(today.getDate() - days)
    dateStart = startDate.toISOString().split('T')[0]
  }

  try {
    if (isSyncStale()) {
      syncAdsData(3).catch(console.error)
    }

    const performanceData = await fetchPerformanceData(accountId, dateStart, dateEnd)
    const aggregated = aggregateByAdCampaign(performanceData)

    // Merge cached creative data
    const creativeCache = getCreativeCacheSync()
    if (creativeCache) {
      for (const [, ad] of aggregated) {
        const creative = creativeCache.get(ad.ad_id as string)
        if (creative) {
          ad.thumbnailUrl = creative.thumbnailUrl
          ad.imageUrl = creative.imageUrl
          ad.objectType = creative.objectType
          ad.videoId = creative.videoId
          ad.videoUrl = creative.videoUrl
          ad.effectiveStatus = creative.effectiveStatus
          ad.body = creative.body
          ad.title = creative.title
          ad.ctaType = creative.ctaType
          ad.linkUrl = creative.linkUrl
          ad.adsetName = creative.adsetName
          ad.optimizationGoal = creative.optimizationGoal
        }
      }
    }

    let ads = Array.from(aggregated.values())
    if (sortBy === 'spend') ads.sort((a, b) => (b.spend as number) - (a.spend as number))
    else if (sortBy === 'ctr') ads.sort((a, b) => (b.ctr as number) - (a.ctr as number))
    else if (sortBy === 'hook') ads.sort((a, b) => (b.hook_rate as number) - (a.hook_rate as number))
    else if (sortBy === 'leads') ads.sort((a, b) => (b.leads as number) - (a.leads as number))
    else if (sortBy === 'cpl') ads.sort((a, b) => (a.cpl as number) - (b.cpl as number))

    const accounts = getAccounts()

    return NextResponse.json({
      ads,
      accounts,
      dateStart,
      dateEnd,
      summary: {
        totalSpend: ads.reduce((s, a) => s + (a.spend as number), 0),
        totalLeads: ads.reduce((s, a) => s + (a.leads as number), 0),
        avgCTR: ads.length > 0 ? ads.reduce((s, a) => s + (a.ctr as number), 0) / ads.length : 0,
        activeAds: ads.filter(a => (a.effectiveStatus as string) === 'ACTIVE').length || ads.length,
      },
    })
  } catch (err) {
    console.error('Ads data error:', err)
    return NextResponse.json({ error: 'Failed to load ads data' }, { status: 500 })
  }
}
