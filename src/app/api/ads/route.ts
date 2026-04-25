import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const headers = () => ({
  'apikey': SUPABASE_KEY!,
  'Authorization': `Bearer ${SUPABASE_KEY!}`,
})

export async function GET(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const days = parseInt(req.nextUrl.searchParams.get('days') || '30')
  const clientSlug = req.nextUrl.searchParams.get('client') || null
  const view = req.nextUrl.searchParams.get('view') || 'summary'
  const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

  try {
    let query = `${SUPABASE_URL}/rest/v1/ad_performance_daily?select=*&date=gte.${startDate}&order=date.asc`
    if (clientSlug) query += `&client_slug=eq.${clientSlug}`

    const resp = await fetch(query, { headers: headers() })
    const rawData = await resp.json()

    if (!Array.isArray(rawData)) {
      return NextResponse.json({ error: 'Unexpected response', raw: rawData }, { status: 500 })
    }

    // Aggregate by ad
    const adMap = new Map<string, Record<string, unknown>>()
    for (const row of rawData) {
      const key = `${row.ad_id}_${row.campaign_id || ''}`
      const existing = adMap.get(key)
      if (existing) {
        existing.spend = (existing.spend as number || 0) + (row.spend || 0)
        existing.impressions = (existing.impressions as number || 0) + (row.impressions || 0)
        existing.clicks = (existing.clicks as number || 0) + (row.clicks || 0)
        existing.link_clicks = (existing.link_clicks as number || 0) + (row.link_clicks || 0)
        existing.leads = (existing.leads as number || 0) + (row.leads || 0)
        existing.video_views = (existing.video_views as number || 0) + (row.video_views || 0)
        existing.video_thruplay = (existing.video_thruplay as number || 0) + (row.video_thruplay || 0)
        existing.reach = (existing.reach as number || 0) + (row.reach || 0)
        existing.days_count = (existing.days_count as number || 0) + 1
      } else {
        adMap.set(key, { ...row, days_count: 1 })
      }
    }

    // Calculate derived metrics
    const ads = Array.from(adMap.values()).map(ad => {
      const spend = ad.spend as number || 0
      const impr = ad.impressions as number || 0
      const clicks = ad.clicks as number || 0
      const linkClicks = ad.link_clicks as number || 0
      const leads = ad.leads as number || 0
      const views = ad.video_views as number || 0
      const thruplay = ad.video_thruplay as number || 0
      const reach = ad.reach as number || 0
      return {
        ad_id: ad.ad_id,
        ad_name: ad.ad_name || 'Unnamed',
        campaign_name: ad.campaign_name || 'Unknown',
        campaign_id: ad.campaign_id,
        account_name: ad.account_name,
        client_slug: ad.client_slug,
        spend: Math.round(spend * 100) / 100,
        impressions: impr,
        clicks,
        link_clicks: linkClicks,
        leads,
        ctr: impr > 0 ? Math.round((clicks / impr) * 10000) / 100 : 0,
        cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
        cpm: impr > 0 ? Math.round((spend / impr * 1000) * 100) / 100 : 0,
        cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : 0,
        hook_rate: impr > 0 && views > 0 ? Math.round((views / impr) * 10000) / 100 : 0,
        hold_rate: views > 0 && thruplay > 0 ? Math.round((thruplay / views) * 10000) / 100 : 0,
        video_views: views,
        video_thruplay: thruplay,
        frequency: reach > 0 ? Math.round((impr / reach) * 100) / 100 : 0,
        reach,
        days_active: ad.days_count as number,
        // Scores
        hook_score: views > 0 && impr > 0 ? ((views / impr) * 100 > 25 ? 'green' : (views / impr) * 100 > 15 ? 'yellow' : 'red') : 'none',
        click_score: clicks > 0 && impr > 0 ? ((clicks / impr) * 100 > 2 ? 'green' : (clicks / impr) * 100 > 1 ? 'yellow' : 'red') : 'red',
        conversion_score: leads === 0 ? 'none' : (spend / leads) < 50 ? 'green' : (spend / leads) < 100 ? 'yellow' : 'red',
      }
    }).sort((a, b) => b.spend - a.spend)

    // Aggregate by date for charts
    const dayMap = new Map<string, { date: string; spend: number; impressions: number; clicks: number; leads: number; reach: number }>()
    for (const row of rawData) {
      const ex = dayMap.get(row.date)
      if (ex) {
        ex.spend += row.spend || 0
        ex.impressions += row.impressions || 0
        ex.clicks += row.clicks || 0
        ex.leads += row.leads || 0
        ex.reach += row.reach || 0
      } else {
        dayMap.set(row.date, {
          date: row.date,
          spend: row.spend || 0,
          impressions: row.impressions || 0,
          clicks: row.clicks || 0,
          leads: row.leads || 0,
          reach: row.reach || 0,
        })
      }
    }
    const daily = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    // Fatigue detection
    const now = Date.now()
    const weekAgo = new Date(now - 7 * 86400000).toISOString().split('T')[0]
    const twoWeeksAgo = new Date(now - 14 * 86400000).toISOString().split('T')[0]
    const fatigue: { ad_name: string; ad_id: string; signal: string; severity: string }[] = []

    for (const [, ad] of adMap) {
      const adKey = ad.ad_id || ad.ad_name
      const thisWeek = rawData.filter((r: Record<string, unknown>) => (r.ad_id || r.ad_name) === adKey && (r.date as string) >= weekAgo)
      const lastWeek = rawData.filter((r: Record<string, unknown>) => (r.ad_id || r.ad_name) === adKey && (r.date as string) >= twoWeeksAgo && (r.date as string) < weekAgo)
      if (thisWeek.length < 3 || lastWeek.length < 3) continue

      const avg = (arr: Record<string, unknown>[], field: string) => {
        const total = arr.reduce((s: number, r) => s + ((r[field] as number) || 0), 0)
        return total / arr.length
      }

      const ctrNow = avg(thisWeek, 'ctr')
      const ctrPrev = avg(lastWeek, 'ctr')
      const freqNow = avg(thisWeek, 'frequency')
      const hookNow = avg(thisWeek, 'hook_rate')
      const hookPrev = avg(lastWeek, 'hook_rate')

      if (ctrPrev > 0 && ctrNow < ctrPrev * 0.7) {
        fatigue.push({ ad_name: ad.ad_name as string, ad_id: ad.ad_id as string, signal: `CTR dropped ${Math.round((1 - ctrNow / ctrPrev) * 100)}% WoW`, severity: ctrNow < ctrPrev * 0.5 ? 'high' : 'medium' })
      }
      if (freqNow > 3) {
        fatigue.push({ ad_name: ad.ad_name as string, ad_id: ad.ad_id as string, signal: `Frequency ${freqNow.toFixed(1)} (>3.0)`, severity: freqNow > 5 ? 'high' : 'medium' })
      }
      if (hookPrev > 0 && hookNow < hookPrev * 0.7) {
        fatigue.push({ ad_name: ad.ad_name as string, ad_id: ad.ad_id as string, signal: `Hook rate dropped ${Math.round((1 - hookNow / hookPrev) * 100)}% WoW`, severity: 'medium' })
      }
    }

    // Campaign breakdown
    const campaignMap = new Map<string, { name: string; spend: number; leads: number; clicks: number; impressions: number; ads: number }>()
    for (const ad of ads) {
      const cName = String(ad.campaign_name)
      const c = campaignMap.get(cName) || { name: cName, spend: 0, leads: 0, clicks: 0, impressions: 0, ads: 0 }
      c.spend += ad.spend; c.leads += ad.leads; c.clicks += ad.clicks; c.impressions += ad.impressions; c.ads++
      campaignMap.set(cName, c)
    }
    const campaigns = Array.from(campaignMap.values()).sort((a, b) => b.spend - a.spend)

    // Client breakdown
    const clientMap = new Map<string, { slug: string; spend: number; leads: number; ads: number }>()
    for (const ad of ads) {
      const slug = String(ad.client_slug || 'unknown')
      const c = clientMap.get(slug) || { slug, spend: 0, leads: 0, ads: 0 }
      c.spend += ad.spend; c.leads += ad.leads; c.ads++
      clientMap.set(slug, c)
    }
    const clients = Array.from(clientMap.values()).sort((a, b) => b.spend - a.spend)

    // Summary
    const totalSpend = ads.reduce((s, a) => s + a.spend, 0)
    const totalImpr = ads.reduce((s, a) => s + a.impressions, 0)
    const totalClicks = ads.reduce((s, a) => s + a.clicks, 0)
    const totalLeads = ads.reduce((s, a) => s + a.leads, 0)
    const totalReach = ads.reduce((s, a) => s + a.reach, 0)

    return NextResponse.json({
      ads,
      daily,
      fatigue,
      campaigns,
      clients,
      summary: {
        total_spend: Math.round(totalSpend * 100) / 100,
        total_impressions: totalImpr,
        total_clicks: totalClicks,
        total_leads: totalLeads,
        total_reach: totalReach,
        total_ads: ads.length,
        avg_ctr: totalImpr > 0 ? Math.round((totalClicks / totalImpr) * 10000) / 100 : 0,
        avg_cpc: totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0,
        avg_cpl: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0,
        avg_cpm: totalImpr > 0 ? Math.round((totalSpend / totalImpr * 1000) * 100) / 100 : 0,
      },
      period: days,
    })
  } catch (err) {
    console.error('Ads API error:', err)
    return NextResponse.json({ error: 'Failed to fetch ad data' }, { status: 500 })
  }
}
