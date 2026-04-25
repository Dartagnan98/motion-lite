import { NextRequest, NextResponse } from 'next/server'
import { scheduleGoogleAdsAutoSync } from '@/lib/google-ads-sync'
import { getAllEnabledGoogleAdsAccounts } from '@/lib/db'
import { requireOwner } from '@/lib/auth'

scheduleGoogleAdsAutoSync()

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAccounts() {
  const connected = getAllEnabledGoogleAdsAccounts()
  return connected.map(a => ({ id: a.customer_id, name: a.account_name, slug: a.client_slug || '' }))
}

interface CampaignPerformance {
  date: string
  customer_id: string
  account_name: string
  client_slug: string
  campaign_id: string
  campaign_name: string
  campaign_type: string | null
  campaign_status: string | null
  ad_group_id: string | null
  ad_group_name: string | null
  cost: number
  impressions: number
  clicks: number
  ctr: number
  avg_cpc: number
  conversions: number
  conversion_value: number
  cost_per_conversion: number
  conversion_rate: number
  roas: number
  search_impression_share: number | null
  search_lost_is_budget: number | null
  search_lost_is_rank: number | null
  all_conversions: number
  view_through_conversions: number
  video_views: number
  video_view_rate: number
}

async function fetchPerformanceData(
  accountId: string | null,
  dateStart: string,
  dateEnd: string
): Promise<CampaignPerformance[]> {
  let url = `${SUPABASE_URL}/rest/v1/google_ads_daily?select=*&date=gte.${dateStart}&date=lte.${dateEnd}`

  if (accountId) {
    url += `&customer_id=eq.${accountId}`
  } else {
    const accountIds = getAccounts().map(a => a.id)
    if (accountIds.length === 0) return []
    url += `&customer_id=in.(${accountIds.join(',')})`
  }

  const response = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  })
  return (await response.json()) as CampaignPerformance[]
}

function aggregateByCampaign(data: CampaignPerformance[]) {
  const map = new Map<string, Record<string, unknown>>()

  for (const row of data) {
    const key = row.campaign_id
    const existing = map.get(key)
    if (existing) {
      existing.cost = (existing.cost as number) + (row.cost || 0)
      existing.impressions = (existing.impressions as number) + (row.impressions || 0)
      existing.clicks = (existing.clicks as number) + (row.clicks || 0)
      existing.conversions = (existing.conversions as number) + (row.conversions || 0)
      existing.conversion_value = (existing.conversion_value as number) + (row.conversion_value || 0)
      existing.all_conversions = (existing.all_conversions as number) + (row.all_conversions || 0)
      existing.view_through_conversions = (existing.view_through_conversions as number) + (row.view_through_conversions || 0)
      existing.video_views = (existing.video_views as number) + (row.video_views || 0)
      if (row.search_impression_share != null) existing.search_impression_share = row.search_impression_share
      if (row.search_lost_is_budget != null) existing.search_lost_is_budget = row.search_lost_is_budget
      if (row.search_lost_is_rank != null) existing.search_lost_is_rank = row.search_lost_is_rank
    } else {
      map.set(key, {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name || 'Unknown',
        campaign_type: row.campaign_type || 'UNKNOWN',
        campaign_status: row.campaign_status || 'UNKNOWN',
        account_name: row.account_name || '',
        cost: row.cost || 0,
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        conversions: row.conversions || 0,
        conversion_value: row.conversion_value || 0,
        all_conversions: row.all_conversions || 0,
        view_through_conversions: row.view_through_conversions || 0,
        video_views: row.video_views || 0,
        search_impression_share: row.search_impression_share,
        search_lost_is_budget: row.search_lost_is_budget,
        search_lost_is_rank: row.search_lost_is_rank,
        ctr: 0, avg_cpc: 0, cost_per_conversion: 0, conversion_rate: 0, roas: 0,
      })
    }
  }

  for (const [, c] of map) {
    const impressions = c.impressions as number
    const clicks = c.clicks as number
    const conversions = c.conversions as number
    const cost = c.cost as number
    const conversion_value = c.conversion_value as number
    if (impressions > 0) c.ctr = (clicks / impressions) * 100
    if (clicks > 0) {
      c.avg_cpc = cost / clicks
      c.conversion_rate = (conversions / clicks) * 100
    }
    if (conversions > 0) c.cost_per_conversion = cost / conversions
    if (cost > 0) c.roas = conversion_value / cost
  }

  return Array.from(map.values()).sort((a, b) => (b.cost as number) - (a.cost as number))
}

export async function GET(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const accountId = req.nextUrl.searchParams.get('account') || null
  const typeFilter = req.nextUrl.searchParams.get('type') || null

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

  const accounts = getAccounts()
  let rawData: CampaignPerformance[] = []
  try {
    rawData = await fetchPerformanceData(accountId, dateStart, dateEnd)
  } catch (err) {
    console.error('Google Ads data error:', err)
  }

  if (typeFilter && typeFilter !== 'ALL') {
    rawData = rawData.filter(r => r.campaign_type === typeFilter)
  }

  const campaigns = aggregateByCampaign(rawData)

  // Summary
  const totalCost = campaigns.reduce((s, c) => s + (c.cost as number), 0)
  const totalImpressions = campaigns.reduce((s, c) => s + (c.impressions as number), 0)
  const totalClicks = campaigns.reduce((s, c) => s + (c.clicks as number), 0)
  const totalConversions = campaigns.reduce((s, c) => s + (c.conversions as number), 0)
  const totalConversionValue = campaigns.reduce((s, c) => s + (c.conversion_value as number), 0)

  // Type breakdown
  const typeBreakdown: Record<string, { cost: number; conversions: number; clicks: number; impressions: number }> = {}
  for (const c of campaigns) {
    const t = (c.campaign_type as string) || 'UNKNOWN'
    if (!typeBreakdown[t]) typeBreakdown[t] = { cost: 0, conversions: 0, clicks: 0, impressions: 0 }
    typeBreakdown[t].cost += c.cost as number
    typeBreakdown[t].conversions += c.conversions as number
    typeBreakdown[t].clicks += c.clicks as number
    typeBreakdown[t].impressions += c.impressions as number
  }

  // Daily data for charts
  const dailyMap = new Map<string, { cost: number; conversions: number; clicks: number; impressions: number }>()
  for (const row of rawData) {
    const d = dailyMap.get(row.date)
    if (d) {
      d.cost += row.cost || 0
      d.conversions += row.conversions || 0
      d.clicks += row.clicks || 0
      d.impressions += row.impressions || 0
    } else {
      dailyMap.set(row.date, { cost: row.cost || 0, conversions: row.conversions || 0, clicks: row.clicks || 0, impressions: row.impressions || 0 })
    }
  }
  const dailyData = Array.from(dailyMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, d]) => ({ date, ...d }))

  // Search impression share
  const searchCampaigns = campaigns.filter(c => c.campaign_type === 'SEARCH' && c.search_impression_share != null)
  const avgImprShare = searchCampaigns.length > 0 ? searchCampaigns.reduce((s, c) => s + (c.search_impression_share as number || 0), 0) / searchCampaigns.length : null
  const avgLostBudget = searchCampaigns.length > 0 ? searchCampaigns.reduce((s, c) => s + (c.search_lost_is_budget as number || 0), 0) / searchCampaigns.length : null
  const avgLostRank = searchCampaigns.length > 0 ? searchCampaigns.reduce((s, c) => s + (c.search_lost_is_rank as number || 0), 0) / searchCampaigns.length : null

  return NextResponse.json({
    campaigns,
    accounts,
    dateStart,
    dateEnd,
    summary: {
      totalCost,
      totalImpressions,
      totalClicks,
      totalConversions,
      totalConversionValue,
      avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      avgCpa: totalConversions > 0 ? totalCost / totalConversions : 0,
      avgRoas: totalCost > 0 ? totalConversionValue / totalCost : 0,
    },
    typeBreakdown,
    dailyData,
    impressionShare: avgImprShare !== null ? { captured: avgImprShare, lostBudget: avgLostBudget, lostRank: avgLostRank } : null,
  })
}
