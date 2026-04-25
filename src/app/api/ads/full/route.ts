import { NextRequest, NextResponse } from 'next/server'
import { buildCreativeMap, fetchAdEngagement } from '@/lib/meta-api'
import { getAllEnabledAdAccounts, getDb, verifyPortalToken } from '@/lib/db'
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

interface AggregatedAd {
  ad_id: string
  ad_name: string
  account_name: string
  campaign_id: string
  campaign_name: string
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  outbound_clicks: number
  ctr: number
  ctr_outbound: number
  cpc: number
  cpc_outbound: number
  cpm: number
  link_clicks_ctr: number
  cost_per_link_click: number
  frequency: number
  reach: number
  leads: number
  cpl: number
  hook_rate: number
  hold_rate: number
  video_views: number
  video_p25: number
  video_p50: number
  video_p75: number
  video_thruplay: number
  video_p100: number
  video_p95: number
  video_avg_time: number
  hookScore: string
  clickScore: string
  conversionScore: string
  thumbnailUrl: string | null
  imageUrl: string | null
  objectType: string | null
  videoUrl: string | null
  videoId: string | null
  effectiveStatus: string | null
  body: string | null
  title: string | null
  ctaType: string | null
  linkUrl: string | null
  adsetName: string | null
  optimizationGoal: string | null
  conversionEvent: string | null
  endDate: string | null
  bodyVariations: string[]
  titleVariations: string[]
  reactions: number
  comments: number
  shares: number
  engagementScore: number
  engagementScoreRating: string
}

async function fetchPerformanceData(accountId: string | null, dateStart: string, dateEnd: string, allowedIds?: string[] | null): Promise<AdPerformance[]> {
  let url = `${SUPABASE_URL}/rest/v1/ad_performance_daily?select=ad_id,ad_name,account_id,account_name,client_slug,campaign_id,campaign_name,spend,impressions,clicks,link_clicks,ctr,cpc,leads,cpl,hook_rate,hold_rate,video_views,video_thruplay,video_p25_watched,video_p50_watched,video_p75_watched,video_p95_watched,reach,frequency,cpm&date=gte.${dateStart}&date=lte.${dateEnd}`

  if (accountId) {
    url += `&account_id=eq.${accountId}`
  } else if (allowedIds) {
    url += `&account_id=in.(${allowedIds.join(',')})`
  } else {
    const accountIds = getAccounts().map(a => a.id)
    url += `&account_id=in.(${accountIds.join(',')})`
  }

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  })

  return (await response.json()) as AdPerformance[]
}

function aggregateByAdCampaign(data: AdPerformance[]): Map<string, AggregatedAd> {
  const adMap = new Map<string, AggregatedAd>()

  for (const row of data) {
    const key = `${row.ad_id}_${row.campaign_id || 'unknown'}`
    const existing = adMap.get(key)
    if (existing) {
      existing.spend += row.spend || 0
      existing.impressions += row.impressions || 0
      existing.clicks += row.clicks || 0
      existing.link_clicks += row.link_clicks || 0
      existing.leads += row.leads || 0
      existing.reach += row.reach || 0
      existing.video_views += row.video_views || 0
      existing.video_thruplay += row.video_thruplay || 0
      existing.video_p25 += row.video_p25_watched || 0
      existing.video_p50 += row.video_p50_watched || 0
      existing.video_p75 += row.video_p75_watched || 0
      existing.video_p95 += row.video_p95_watched || 0
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
        outbound_clicks: 0,
        ctr: 0, ctr_outbound: 0, cpc: 0, cpc_outbound: 0, cpm: 0,
        link_clicks_ctr: 0, cost_per_link_click: 0, frequency: 0,
        reach: row.reach || 0,
        leads: row.leads || 0,
        cpl: 0, hook_rate: 0, hold_rate: 0,
        video_views: row.video_views || 0,
        video_thruplay: row.video_thruplay || 0,
        video_p25: row.video_p25_watched || 0,
        video_p50: row.video_p50_watched || 0,
        video_p75: row.video_p75_watched || 0,
        video_p95: row.video_p95_watched || 0,
        video_p100: 0, video_avg_time: 0,
        hookScore: 'red', clickScore: 'red', conversionScore: 'none',
        thumbnailUrl: null, imageUrl: null, objectType: null,
        videoUrl: null, videoId: null, effectiveStatus: null,
        body: null, title: null, ctaType: null, linkUrl: null,
        adsetName: null, optimizationGoal: null, conversionEvent: null, endDate: null,
        bodyVariations: [], titleVariations: [],
        reactions: 0, comments: 0, shares: 0,
        engagementScore: 0, engagementScoreRating: 'red'
      })
    }
  }

  for (const [, ad] of adMap) {
    if (ad.impressions > 0) {
      ad.ctr = (ad.clicks / ad.impressions) * 100
      ad.link_clicks_ctr = (ad.link_clicks / ad.impressions) * 100
      ad.cpm = (ad.spend / ad.impressions) * 1000
      ad.hook_rate = (ad.video_views / ad.impressions) * 100
    }
    if (ad.video_views > 0) {
      ad.hold_rate = (ad.video_thruplay / ad.video_views) * 100
    }
    if (ad.clicks > 0) ad.cpc = ad.spend / ad.clicks
    if (ad.link_clicks > 0) {
      ad.cost_per_link_click = ad.spend / ad.link_clicks
      ad.outbound_clicks = ad.link_clicks
      ad.ctr_outbound = ad.link_clicks_ctr
      ad.cpc_outbound = ad.cost_per_link_click
    }
    if (ad.leads > 0) ad.cpl = ad.spend / ad.leads
    if (ad.reach > 0) ad.frequency = ad.impressions / ad.reach
    ad.hookScore = ad.hook_rate > 25 ? 'green' : ad.hook_rate > 15 ? 'yellow' : 'red'
    ad.clickScore = ad.ctr > 2 ? 'green' : ad.ctr > 1 ? 'yellow' : 'red'
    ad.conversionScore = ad.leads === 0 ? 'none' : ad.leads > 0 && ad.cpl < 50 ? 'green' : ad.cpl < 100 ? 'yellow' : 'red'
  }

  return adMap
}

// In-memory creative cache (15 min TTL)
let creativeCache: { data: Map<string, Record<string, unknown>>; timestamp: number } | null = null
const CACHE_TTL = 15 * 60 * 1000

async function getCachedCreatives(accountIds: string[]) {
  const now = Date.now()
  if (creativeCache && (now - creativeCache.timestamp) < CACHE_TTL) {
    return creativeCache.data
  }
  const data = await buildCreativeMap(accountIds)
  creativeCache = { data: data as unknown as Map<string, Record<string, unknown>>, timestamp: now }
  return data
}

function getPortalAccountIds(slug: string): string[] | null {
  const db = getDb()
  const clientRow = db.prepare('SELECT id FROM client_profiles WHERE slug = ?').get(slug) as { id: number } | undefined
  if (!clientRow) return null
  const businesses = db.prepare('SELECT ad_account_id FROM client_businesses WHERE client_id = ? AND ad_account_id IS NOT NULL').all(clientRow.id) as { ad_account_id: string }[]
  return businesses.map(b => b.ad_account_id)
}

export async function GET(req: NextRequest) {
  const portalSlug = req.nextUrl.searchParams.get('portal_slug')
  const portalToken = req.nextUrl.searchParams.get('portal_token')
  let portalAccountIds: string[] | null = null
  if (portalSlug) {
    if (!verifyPortalToken(portalSlug, portalToken)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    portalAccountIds = getPortalAccountIds(portalSlug)
    if (!portalAccountIds) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } else {
    try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const accountId = req.nextUrl.searchParams.get('account') || null

  // Reject cross-tenant account requests from portal users
  if (accountId && portalAccountIds && !portalAccountIds.includes(accountId)) {
    return NextResponse.json({ error: 'Account not authorized for this portal' }, { status: 403 })
  }

  const today = new Date()
  let dateEnd = today.toISOString().split('T')[0]
  let dateStart: string
  const startParam = req.nextUrl.searchParams.get('start')
  const endParam = req.nextUrl.searchParams.get('end')
  if (startParam && endParam) {
    dateStart = startParam
    dateEnd = endParam
  } else {
    const days = parseInt(req.nextUrl.searchParams.get('days') || '7')
    const sd = new Date()
    sd.setDate(today.getDate() - days)
    dateStart = sd.toISOString().split('T')[0]
  }

  try {
    const effectiveAccountIds = portalAccountIds || getAccounts().map(a => a.id)
    const accountIds = accountId ? [accountId] : effectiveAccountIds
    const [performanceData, creativeMap, ...engagementMaps] = await Promise.all([
      fetchPerformanceData(accountId, dateStart, dateEnd, portalAccountIds),
      getCachedCreatives(effectiveAccountIds),
      ...accountIds.map(accId => fetchAdEngagement(accId, dateStart, dateEnd))
    ])

    // Merge all engagement maps
    const engagementMap = new Map<string, { reactions: number; comments: number; shares: number; engagementScore: number }>()
    for (const map of engagementMaps) {
      for (const [adId, metrics] of map) {
        engagementMap.set(adId, metrics)
      }
    }

    const aggregated = aggregateByAdCampaign(performanceData)

    for (const [, ad] of aggregated) {
      const creative = creativeMap.get(ad.ad_id) as Record<string, unknown> | undefined
      if (creative) {
        ad.thumbnailUrl = creative.thumbnailUrl as string | null
        ad.imageUrl = creative.imageUrl as string | null
        ad.objectType = creative.objectType as string | null
        ad.videoId = creative.videoId as string | null
        ad.videoUrl = creative.videoUrl as string | null
        ad.effectiveStatus = creative.effectiveStatus as string | null
        ad.body = creative.body as string | null
        ad.title = creative.title as string | null
        ad.ctaType = creative.ctaType as string | null
        ad.linkUrl = creative.linkUrl as string | null
        ad.adsetName = creative.adsetName as string | null
        ad.optimizationGoal = creative.optimizationGoal as string | null
        ad.conversionEvent = creative.conversionEvent as string | null
        ad.endDate = creative.endDate as string | null
        ad.bodyVariations = (creative.bodyVariations as string[]) || []
        ad.titleVariations = (creative.titleVariations as string[]) || []
      }

      const engagement = engagementMap.get(ad.ad_id)
      if (engagement) {
        ad.reactions = engagement.reactions
        ad.comments = engagement.comments
        ad.shares = engagement.shares
        ad.engagementScore = engagement.engagementScore
        ad.engagementScoreRating = engagement.engagementScore > 0.5 ? 'green' : engagement.engagementScore > 0.2 ? 'yellow' : 'red'
      }
    }

    const adsArray = Array.from(aggregated.values())
    return NextResponse.json({
      accounts: getAccounts(),
      ads: adsArray
    })
  } catch (err) {
    console.error('Full API error:', err)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
