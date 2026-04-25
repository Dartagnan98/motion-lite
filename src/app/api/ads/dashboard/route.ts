import { NextRequest, NextResponse } from 'next/server'
import { getCreativeCacheSync } from '@/lib/meta-api'
import { scheduleAutoSync, isSyncStale, syncAdsData } from '@/lib/ads-sync'
import { getAllEnabledAdAccounts, getDb } from '@/lib/db'
import { requireOwner } from '@/lib/auth'
import { dashboardCss } from '@/lib/dashboard-shell'
import crypto from 'crypto'

// Auto-sync disabled by default. Set META_AUTO_SYNC=1 to re-enable after rate-limit audit.
if (process.env.META_AUTO_SYNC === '1') {
  scheduleAutoSync()
}

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAccounts() {
  const connected = getAllEnabledAdAccounts()
  if (connected.length > 0) {
    return connected.map(a => ({ id: a.account_id, name: a.account_name, slug: a.client_slug || '' }))
  }
  // No connected accounts yet
  return []
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
  purchases: number
  purchase_value: number
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
  hookScore: 'red' | 'yellow' | 'green'
  clickScore: 'red' | 'yellow' | 'green'
  conversionScore: 'red' | 'yellow' | 'green' | 'none'
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
  engagementScoreRating: 'red' | 'yellow' | 'green'
}

async function fetchPerformanceData(
  accountId: string | null,
  dateStart: string,
  dateEnd: string,
  allowedAccountIds?: string[] | null
): Promise<AdPerformance[]> {
  let url = `${SUPABASE_URL}/rest/v1/ad_performance_daily?select=ad_id,ad_name,account_id,account_name,client_slug,campaign_id,campaign_name,spend,impressions,clicks,link_clicks,ctr,cpc,leads,cpl,purchases,purchase_value,hook_rate,hold_rate,video_views,video_thruplay,video_p25_watched,video_p50_watched,video_p75_watched,video_p95_watched,reach,frequency,cpm&date=gte.${dateStart}&date=lte.${dateEnd}`

  if (accountId) {
    url += `&account_id=eq.${accountId}`
  } else if (allowedAccountIds) {
    url += `&account_id=in.(${allowedAccountIds.join(',')})`
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
      existing.purchases += (row as any).purchases || 0
      existing.purchase_value += (row as any).purchase_value || 0
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
        ctr: 0,
        ctr_outbound: 0,
        cpc: 0,
        cpc_outbound: 0,
        cpm: 0,
        link_clicks_ctr: 0,
        cost_per_link_click: 0,
        frequency: 0,
        reach: row.reach || 0,
        leads: row.leads || 0,
        cpl: 0,
        purchases: (row as any).purchases || 0,
        purchase_value: (row as any).purchase_value || 0,
        hook_rate: 0,
        hold_rate: 0,
        video_views: row.video_views || 0,
        video_thruplay: row.video_thruplay || 0,
        video_p25: row.video_p25_watched || 0,
        video_p50: row.video_p50_watched || 0,
        video_p75: row.video_p75_watched || 0,
        video_p95: row.video_p95_watched || 0,
        video_p100: 0,
        video_avg_time: 0,
        hookScore: 'red',
        clickScore: 'red',
        conversionScore: 'none',
        thumbnailUrl: null,
        imageUrl: null,
        objectType: null,
        videoUrl: null,
        videoId: null,
        effectiveStatus: null,
        body: null,
        title: null,
        ctaType: null,
        linkUrl: null,
        adsetName: null,
        optimizationGoal: null,
        conversionEvent: null,
        endDate: null,
        bodyVariations: [],
        titleVariations: [],
        reactions: 0,
        comments: 0,
        shares: 0,
        engagementScore: 0,
        engagementScoreRating: 'red'
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
    if (ad.clicks > 0) {
      ad.cpc = ad.spend / ad.clicks
    }
    if (ad.link_clicks > 0) {
      ad.cost_per_link_click = ad.spend / ad.link_clicks
      ad.outbound_clicks = ad.link_clicks
      ad.ctr_outbound = ad.link_clicks_ctr
      ad.cpc_outbound = ad.cost_per_link_click
    }
    if (ad.leads > 0) {
      ad.cpl = ad.spend / ad.leads
    }
    if (ad.reach > 0) {
      ad.frequency = ad.impressions / ad.reach
    }

    ad.hookScore = ad.hook_rate > 25 ? 'green' : ad.hook_rate > 15 ? 'yellow' : 'red'
    ad.clickScore = ad.ctr > 2 ? 'green' : ad.ctr > 1 ? 'yellow' : 'red'
    ad.conversionScore = ad.leads === 0 ? 'none' : ad.leads > 0 && ad.cpl < 50 ? 'green' : ad.cpl < 100 ? 'yellow' : 'red'
  }

  return adMap
}

function getScoreColor(score: 'red' | 'yellow' | 'green' | 'none'): string {
  switch (score) {
    case 'green': return 'var(--status-completed)'
    case 'yellow': return 'var(--status-active)'
    case 'red': return 'var(--status-overdue)'
    default: return 'var(--text-dim)'
  }
}

interface PrimaryConversion {
  label: string        // "Leads", "Link Clicks", "Thruplays", "Engagements"
  value: string        // formatted value ("40 leads", "1,234", "-")
  costLabel: string    // "CPL", "CPC", "CPV", "CPE"
  costValue: string    // "$3.03" or "-"
  barWidth: number     // 0-100
  score: 'red' | 'yellow' | 'green' | 'none'
}

interface CardScoreRow {
  label: string
  value: string
  barWidth: number
  score: 'red' | 'yellow' | 'green' | 'none'
}

interface CardMetricItem {
  label: string
  value: string
}

type OptimizationIntent =
  | 'lead'
  | 'purchase'
  | 'video'
  | 'engagement'
  | 'reach'
  | 'conversation'
  | 'click'

function hasLeadIntentName(ad: AggregatedAd): boolean {
  const text = `${ad.campaign_name || ''} ${ad.ad_name || ''}`.toLowerCase()
  return /(webinar|register|registration|lead|book|booking|consult|consultation|demo|application|apply|quote|estimate|appointment|strategy call|discovery)/.test(text)
}

function hasPurchaseIntentName(ad: AggregatedAd): boolean {
  const text = `${ad.campaign_name || ''} ${ad.ad_name || ''}`.toLowerCase()
  return /(purchase|checkout|order|cart|buy|sale|shop|ecom|e-commerce|product)/.test(text)
}

function hasLeadIntentEvent(ad: AggregatedAd): boolean {
  const event = (ad.conversionEvent || '').toLowerCase()
  return /(lead|complete_registration|registration|submit_application|schedule|contact|subscribe|start_trial|book)/.test(event)
}

function hasPurchaseIntentEvent(ad: AggregatedAd): boolean {
  const event = (ad.conversionEvent || '').toLowerCase()
  return /(purchase|checkout|add_to_cart|initiate_checkout|add_payment_info)/.test(event)
}

function getOptimizationIntent(ad: AggregatedAd): OptimizationIntent {
  const goal = (ad.optimizationGoal || '').toLowerCase()
  const hasGoal = goal.length > 0
  const leadNameHint = hasLeadIntentName(ad)
  const purchaseNameHint = hasPurchaseIntentName(ad)
  const leadEventHint = hasLeadIntentEvent(ad)
  const purchaseEventHint = hasPurchaseIntentEvent(ad)

  const isLeadGoal = goal.includes('lead') || goal.includes('quality_lead') || goal.includes('contact')
  const isPurchaseGoal = goal.includes('purchase') || goal.includes('value')
  const isVideoGoal = goal.includes('thruplay') || goal.includes('video_view')
  const isEngagementGoal = goal.includes('engagement') || goal.includes('post_engagement') || goal.includes('page_like') || goal.includes('event_response')
  const isReachGoal = goal.includes('reach') || goal.includes('brand_awareness') || goal.includes('impressions')
  const isConversationGoal = goal.includes('conversation') || goal.includes('messaging')
  const isClickGoal = goal.includes('link_click') || goal.includes('landing_page') || goal.includes('store_visit') || goal.includes('app_install') || goal.includes('app_events')
  const isOffsiteGoal = goal.includes('offsite_conv')

  if (leadEventHint && !purchaseEventHint) return 'lead'
  if (purchaseEventHint && !leadEventHint) return 'purchase'
  if (leadNameHint && !purchaseNameHint) return 'lead'
  if (isLeadGoal) return 'lead'

  // OFFSITE_CONVERSIONS can represent leads or purchases depending on payload.
  if (isOffsiteGoal) {
    if (leadNameHint && !purchaseNameHint) return 'lead'
    if (ad.leads > 0 && ad.leads >= ad.purchases) return 'lead'
    if (ad.purchases > 0 || ad.purchase_value > 0 || isPurchaseGoal) return 'purchase'
    return 'click'
  }

  if (isPurchaseGoal) return 'purchase'
  if (isVideoGoal) return 'video'
  if (isEngagementGoal) return 'engagement'
  if (isReachGoal) return 'reach'
  if (isConversationGoal) return 'conversation'
  if (isClickGoal) return 'click'

  // No goal yet (hydration can fill later): infer from actual outcomes.
  if (!hasGoal) {
    if (ad.leads > 0) return 'lead'
    if (ad.purchases > 0 || ad.purchase_value > 0) return 'purchase'
    if (ad.video_thruplay > 50 && ad.link_clicks < 20) return 'video'
    const engagement = (ad.reactions || 0) + (ad.comments || 0) + (ad.shares || 0)
    if (engagement > 0 && ad.link_clicks === 0) return 'engagement'
  }

  return 'click'
}

function getPrimaryConversion(ad: AggregatedAd): PrimaryConversion {
  const intent = getOptimizationIntent(ad)

  if (intent === 'lead') {
    const score = ad.leads === 0 ? 'none' : ad.cpl < 50 ? 'green' : ad.cpl < 100 ? 'yellow' : 'red'
    const barW = ad.leads > 0 ? Math.min(50 + (50 / (ad.cpl / 20)), 100) : 0
    return { label: 'Leads', value: ad.leads > 0 ? ad.leads.toLocaleString() + ' leads' : '0 leads', costLabel: 'CPL', costValue: ad.leads > 0 ? '$' + ad.cpl.toFixed(2) : '-', barWidth: barW, score }
  }

  if (intent === 'purchase') {
    if (ad.purchases > 0 || ad.purchase_value > 0) {
      const cpa = ad.purchases > 0 ? ad.spend / ad.purchases : 0
      const roas = ad.spend > 0 ? ad.purchase_value / ad.spend : 0
      const score: 'red' | 'yellow' | 'green' | 'none' = roas === 0 ? 'none' : roas >= 3 ? 'green' : roas >= 1.5 ? 'yellow' : 'red'
      const barW = Math.min(roas * 25, 100)
      const roasStr = roas > 0 ? roas.toFixed(2) + 'x' : '-'
      return { label: 'Purchases', value: ad.purchases > 0 ? ad.purchases + ' · ' + roasStr + ' ROAS' : '-', costLabel: 'CPA', costValue: cpa > 0 ? '$' + cpa.toFixed(2) : '-', barWidth: barW, score }
    }
    // Purchase-intent campaigns without purchase events yet — use click proxy.
    const score: 'red' | 'yellow' | 'green' | 'none' = ad.link_clicks === 0 ? 'none' : ad.cpc < 2 ? 'green' : ad.cpc < 5 ? 'yellow' : 'red'
    return { label: 'Link Clicks', value: ad.link_clicks > 0 ? ad.link_clicks.toLocaleString() : '-', costLabel: 'CPC', costValue: ad.cpc > 0 ? '$' + ad.cpc.toFixed(2) : '-', barWidth: Math.min(ad.ctr * 20, 100), score }
  }

  if (intent === 'video') {
    const cpv = ad.video_thruplay > 0 ? ad.spend / ad.video_thruplay : 0
    return { label: 'Thruplays', value: ad.video_thruplay > 0 ? ad.video_thruplay.toLocaleString() : '-', costLabel: 'CPV', costValue: cpv > 0 ? '$' + cpv.toFixed(3) : '-', barWidth: Math.min((ad.video_thruplay / Math.max(ad.impressions * 0.1, 1)) * 100, 100), score: 'none' }
  }

  if (intent === 'engagement') {
    const eng = (ad.reactions || 0) + (ad.comments || 0) + (ad.shares || 0)
    const cpe = eng > 0 ? ad.spend / eng : 0
    return { label: 'Engagements', value: eng > 0 ? eng.toLocaleString() : '-', costLabel: 'CPE', costValue: cpe > 0 ? '$' + cpe.toFixed(2) : '-', barWidth: Math.min(eng / 10, 100), score: 'none' }
  }

  if (intent === 'reach') {
    return { label: 'Reach', value: ad.reach > 0 ? ad.reach.toLocaleString() : '-', costLabel: 'CPM', costValue: ad.cpm > 0 ? '$' + ad.cpm.toFixed(2) : '-', barWidth: Math.min((ad.reach / Math.max(ad.impressions, 1)) * 100, 100), score: 'none' }
  }

  if (intent === 'conversation') {
    return { label: 'Conversations', value: '-', costLabel: 'CPM', costValue: ad.cpm > 0 ? '$' + ad.cpm.toFixed(2) : '-', barWidth: 0, score: 'none' }
  }

  const score: 'red' | 'yellow' | 'green' | 'none' = ad.link_clicks === 0 ? 'none' : ad.cpc < 1 ? 'green' : ad.cpc < 3 ? 'yellow' : 'red'
  return { label: 'Link Clicks', value: ad.link_clicks > 0 ? ad.link_clicks.toLocaleString() : '-', costLabel: 'CPC', costValue: ad.cpc > 0 ? '$' + ad.cpc.toFixed(2) : '-', barWidth: Math.min(ad.ctr * 20, 100), score }
}

function getCardScoreRows(ad: AggregatedAd): CardScoreRow[] {
  const primary = getPrimaryConversion(ad)
  const intent = getOptimizationIntent(ad)

  const engagementRow: CardScoreRow = {
    label: 'Engage',
    value: ad.engagementScore > 0 ? ad.engagementScore.toFixed(2) + '%' : '-',
    barWidth: Math.min(ad.engagementScore * 100, 100),
    score: ad.engagementScore > 0 ? ad.engagementScoreRating : 'none'
  }

  const holdRow: CardScoreRow = {
    label: 'Hold',
    value: ad.hold_rate > 0 ? ad.hold_rate.toFixed(1) + '%' : '-',
    barWidth: Math.min(ad.hold_rate * 2, 100),
    score: ad.video_views > 0 ? (ad.hold_rate >= 25 ? 'green' : ad.hold_rate >= 12 ? 'yellow' : 'red') : 'none'
  }

  const frequencyRow: CardScoreRow = {
    label: 'Freq',
    value: ad.frequency > 0 ? ad.frequency.toFixed(2) : '-',
    barWidth: Math.min(ad.frequency * 25, 100),
    score: ad.frequency > 0 ? (ad.frequency <= 2 ? 'green' : ad.frequency <= 3 ? 'yellow' : 'red') : 'none'
  }

  const tailRow = intent === 'video' ? holdRow : intent === 'reach' ? frequencyRow : engagementRow

  return [
    {
      label: 'Hook',
      value: ad.hook_rate > 0 ? ad.hook_rate.toFixed(1) + '%' : '-',
      barWidth: Math.min(ad.hook_rate * 2, 100),
      score: ad.hook_rate > 0 ? ad.hookScore : 'none'
    },
    {
      label: 'Click',
      value: ad.ctr > 0 ? ad.ctr.toFixed(2) + '%' : '-',
      barWidth: Math.min(ad.ctr * 20, 100),
      score: ad.ctr > 0 ? ad.clickScore : 'none'
    },
    {
      label: primary.label,
      value: primary.value,
      barWidth: primary.barWidth,
      score: primary.score
    },
    tailRow
  ]
}

function getCardMetricItems(ad: AggregatedAd): CardMetricItem[] {
  const intent = getOptimizationIntent(ad)
  const primary = getPrimaryConversion(ad)
  const engagement = (ad.reactions || 0) + (ad.comments || 0) + (ad.shares || 0)
  const roas = ad.spend > 0 ? ad.purchase_value / ad.spend : 0

  if (intent === 'lead') {
    return [
      { label: 'CPL', value: ad.leads > 0 ? '$' + ad.cpl.toFixed(2) : '-' },
      { label: 'Leads', value: ad.leads > 0 ? ad.leads.toLocaleString() : '0' },
      { label: 'Impr', value: ad.impressions.toLocaleString() },
      { label: 'Link', value: ad.link_clicks.toLocaleString() }
    ]
  }

  if (intent === 'purchase') {
    return [
      { label: primary.costLabel, value: primary.costValue },
      { label: 'ROAS', value: roas > 0 ? roas.toFixed(2) + 'x' : '-' },
      { label: 'Impr', value: ad.impressions.toLocaleString() },
      { label: 'Purch', value: ad.purchases > 0 ? ad.purchases.toLocaleString() : '-' }
    ]
  }

  if (intent === 'video') {
    const cpv = ad.video_thruplay > 0 ? ad.spend / ad.video_thruplay : 0
    return [
      { label: 'CPV', value: cpv > 0 ? '$' + cpv.toFixed(3) : '-' },
      { label: 'Thru', value: ad.video_thruplay > 0 ? ad.video_thruplay.toLocaleString() : '-' },
      { label: 'Hook', value: ad.hook_rate > 0 ? ad.hook_rate.toFixed(1) + '%' : '-' },
      { label: 'Hold', value: ad.hold_rate > 0 ? ad.hold_rate.toFixed(1) + '%' : '-' }
    ]
  }

  if (intent === 'engagement') {
    const cpe = engagement > 0 ? ad.spend / engagement : 0
    return [
      { label: 'CPE', value: cpe > 0 ? '$' + cpe.toFixed(2) : '-' },
      { label: 'Engage', value: engagement > 0 ? engagement.toLocaleString() : '-' },
      { label: 'Impr', value: ad.impressions.toLocaleString() },
      { label: 'Link', value: ad.link_clicks.toLocaleString() }
    ]
  }

  if (intent === 'reach') {
    return [
      { label: 'CPM', value: ad.cpm > 0 ? '$' + ad.cpm.toFixed(2) : '-' },
      { label: 'Reach', value: ad.reach > 0 ? ad.reach.toLocaleString() : '-' },
      { label: 'Freq', value: ad.frequency > 0 ? ad.frequency.toFixed(2) : '-' },
      { label: 'Impr', value: ad.impressions.toLocaleString() }
    ]
  }

  if (intent === 'conversation') {
    return [
      { label: 'CPM', value: ad.cpm > 0 ? '$' + ad.cpm.toFixed(2) : '-' },
      { label: 'CPC', value: ad.cpc > 0 ? '$' + ad.cpc.toFixed(2) : '-' },
      { label: 'Impr', value: ad.impressions.toLocaleString() },
      { label: 'Clicks', value: ad.link_clicks.toLocaleString() }
    ]
  }

  return [
    { label: 'CPC', value: ad.cpc > 0 ? '$' + ad.cpc.toFixed(2) : '-' },
    { label: 'Link', value: ad.link_clicks.toLocaleString() },
    { label: 'CTR', value: ad.link_clicks_ctr > 0 ? ad.link_clicks_ctr.toFixed(2) + '%' : '-' },
    { label: 'Impr', value: ad.impressions.toLocaleString() }
  ]
}

function getResultValueForPrimaryLabel(ad: AggregatedAd, label: string): number {
  if (label === 'Leads') return ad.leads
  if (label === 'Purchases') return ad.purchases
  if (label === 'Thruplays') return ad.video_thruplay
  if (label === 'Reach') return ad.reach
  if (label === 'Engagements') return (ad.reactions || 0) + (ad.comments || 0) + (ad.shares || 0)
  if (label === 'Conversations') return ad.link_clicks
  return ad.link_clicks
}

function getCampaignResultSummary(campAds: AggregatedAd[]): { label: string; value: number } {
  if (campAds.length === 0) return { label: 'Results', value: 0 }
  const spendByLabel = new Map<string, number>()
  for (const ad of campAds) {
    const label = getPrimaryConversion(ad).label
    spendByLabel.set(label, (spendByLabel.get(label) || 0) + ad.spend)
  }
  let topLabel = 'Results'
  let topSpend = -1
  for (const [label, spend] of spendByLabel.entries()) {
    if (spend > topSpend) {
      topSpend = spend
      topLabel = label
    }
  }
  const value = campAds.reduce((sum, ad) => sum + getResultValueForPrimaryLabel(ad, topLabel), 0)
  return { label: topLabel, value }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function generateInsightsHTML(ads: AggregatedAd[]): string {
  if (ads.length === 0) return ''

  const withSpend = ads.filter(a => a.spend > 0)
  if (withSpend.length === 0) return ''

  const bestHook = [...withSpend].sort((a, b) => b.hook_rate - a.hook_rate)[0]
  const bestCTR = [...withSpend].sort((a, b) => b.ctr - a.ctr)[0]
  const bestCPL = [...withSpend].filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl)[0]
  const mostLeads = [...withSpend].filter(a => a.leads > 0).sort((a, b) => b.leads - a.leads)[0]
  const worstCPL = [...withSpend].filter(a => a.leads > 0).sort((a, b) => b.cpl - a.cpl)[0]
  const worstHook = [...withSpend].sort((a, b) => a.hook_rate - b.hook_rate)[0]
  const highestSpend = [...withSpend].sort((a, b) => b.spend - a.spend)[0]

  const byAccount = new Map<string, AggregatedAd[]>()
  for (const ad of withSpend) {
    if (!byAccount.has(ad.account_name)) byAccount.set(ad.account_name, [])
    byAccount.get(ad.account_name)!.push(ad)
  }

  function accountBreakdown(name: string, acctAds: AggregatedAd[]): string {
    const spend = acctAds.reduce((s, a) => s + a.spend, 0)
    const leads = acctAds.reduce((s, a) => s + a.leads, 0)
    const impr = acctAds.reduce((s, a) => s + a.impressions, 0)
    const avgCpl = leads > 0 ? spend / leads : 0
    const avgHook = acctAds.reduce((s, a) => s + a.hook_rate, 0) / acctAds.length

    // Determine if this account primarily runs lead-gen campaigns
    const leadGenAds = acctAds.filter(a => a.leads > 0)
    const isLeadAcct = leadGenAds.length > 0 || acctAds.some(a => (a.optimizationGoal || '').toLowerCase().includes('lead') || (a.optimizationGoal || '').toLowerCase().includes('offsite_conv'))

    let chips = ''
    const topHook = [...acctAds].sort((a, b) => b.hook_rate - a.hook_rate)[0]
    if (topHook && topHook.hook_rate > 40) chips += `<div class="insight-chip insight-green"><span class="insight-icon">▲</span><strong>${escapeHtml(topHook.ad_name)}</strong> top hook ${topHook.hook_rate.toFixed(1)}%</div>`

    if (isLeadAcct) {
      const best = [...acctAds].filter(a => a.leads > 0).sort((a, b) => a.cpl - b.cpl)[0]
      if (best) chips += `<div class="insight-chip insight-green"><span class="insight-icon">▲</span><strong>${escapeHtml(best.ad_name)}</strong> best CPL $${best.cpl.toFixed(2)} (${best.leads} leads)</div>`
      const worst = [...acctAds].filter(a => a.leads > 0).sort((a, b) => b.cpl - a.cpl)[0]
      if (worst && best && worst.ad_id !== best.ad_id) chips += `<div class="insight-chip insight-red"><span class="insight-icon">▼</span><strong>${escapeHtml(worst.ad_name)}</strong> worst CPL $${worst.cpl.toFixed(2)}</div>`
      // Only flag "0 leads" for lead-gen campaigns with meaningful spend
      const noConvLeadAds = acctAds.filter(a => {
        const pc = getPrimaryConversion(a)
        return pc.label === 'Leads' && a.leads === 0 && a.spend > 10
      })
      if (noConvLeadAds.length > 0) chips += `<div class="insight-chip insight-yellow"><span class="insight-icon">!</span>${noConvLeadAds.length} lead ad${noConvLeadAds.length > 1 ? 's' : ''} with 0 leads</div>`
    } else {
      // Non-lead account — show top performer by primary metric
      const topByClicks = [...acctAds].sort((a, b) => b.link_clicks - a.link_clicks)[0]
      if (topByClicks && topByClicks.link_clicks > 0) chips += `<div class="insight-chip insight-green"><span class="insight-icon">▲</span><strong>${escapeHtml(topByClicks.ad_name)}</strong> top clicks ${topByClicks.link_clicks.toLocaleString()}</div>`
    }

    const lowHook = acctAds.filter(a => a.hook_rate < 20 && a.hook_rate > 0)
    if (lowHook.length > 0) chips += `<div class="insight-chip insight-yellow"><span class="insight-icon">!</span>${lowHook.length} ad${lowHook.length > 1 ? 's' : ''} with hook rate under 20%</div>`

    // Determine primary conversion label for stats row
    const acctLeads = acctAds.reduce((s, a) => s + a.leads, 0)
    const acctClicks = acctAds.reduce((s, a) => s + a.link_clicks, 0)
    const convStatLabel = isLeadAcct ? 'Leads' : 'Clicks'
    const convStatVal = isLeadAcct ? leads : acctClicks

    return `<div class="insight-account-block">
      <div class="insight-account-header">
        <div class="insight-account-name">${escapeHtml(name)}</div>
        <div class="insight-account-stats">
          <div class="insight-stat-item"><span class="insight-stat-val">$${spend.toFixed(2)}</span><span class="insight-stat-lbl">Spend</span></div>
          <div class="insight-stat-item"><span class="insight-stat-val">${impr.toLocaleString()}</span><span class="insight-stat-lbl">Impr</span></div>
          <div class="insight-stat-item"><span class="insight-stat-val">${convStatVal}</span><span class="insight-stat-lbl">${convStatLabel}</span></div>
          ${isLeadAcct && leads > 0 ? `<div class="insight-stat-item"><span class="insight-stat-val">$${avgCpl.toFixed(2)}</span><span class="insight-stat-lbl">CPL</span></div>` : ''}
          <div class="insight-stat-item"><span class="insight-stat-val">${avgHook.toFixed(0)}%</span><span class="insight-stat-lbl">Hook</span></div>
        </div>
      </div>
      <div class="insight-chips-row">${chips}</div>
    </div>`
  }

  // Global insights — only compare like-for-like (lead ads vs lead ads)
  const globalLeadAds = ads.filter(a => a.leads > 0)
  let globalHtml = ''
  if (bestCPL && globalLeadAds.length > 0) globalHtml += `<div class="insight-chip insight-green"><span class="insight-icon">▲</span><strong>${escapeHtml(bestCPL.ad_name)}</strong> best CPL $${bestCPL.cpl.toFixed(2)} (${bestCPL.leads} leads)</div>`
  if (mostLeads && mostLeads.ad_id !== bestCPL?.ad_id) globalHtml += `<div class="insight-chip insight-green"><span class="insight-icon">▲</span><strong>${escapeHtml(mostLeads.ad_name)}</strong> most leads: ${mostLeads.leads}</div>`
  if (bestHook && bestHook.hook_rate > 50) globalHtml += `<div class="insight-chip insight-green"><span class="insight-icon">▲</span><strong>${escapeHtml(bestHook.ad_name)}</strong> highest hook ${bestHook.hook_rate.toFixed(1)}%</div>`
  if (worstCPL && bestCPL && worstCPL.ad_id !== bestCPL.ad_id && globalLeadAds.length > 1) globalHtml += `<div class="insight-chip insight-red"><span class="insight-icon">▼</span><strong>${escapeHtml(worstCPL.ad_name)}</strong> worst CPL $${worstCPL.cpl.toFixed(2)}</div>`
  if (highestSpend) {
    const hspc = getPrimaryConversion(highestSpend)
    if (hspc.value === '-' || hspc.barWidth === 0) globalHtml += `<div class="insight-chip insight-red"><span class="insight-icon">▼</span><strong>${escapeHtml(highestSpend.ad_name)}</strong> highest spend ($${highestSpend.spend.toFixed(2)}) · no ${hspc.label.toLowerCase()}</div>`
  }

  const accountBlocks = Array.from(byAccount.entries()).map(([name, acctAds]) => accountBreakdown(name, acctAds)).join('')

  const multipleAccounts = byAccount.size > 1

  return `<div class="insights-panel">
    <div class="insights-header">
      <span class="insights-title" style="color:#ffffff;">Your Ads At A Glance</span>
    </div>
    <div class="insights-body" style="display:grid; grid-template-columns: ${multipleAccounts && globalHtml ? '1fr 2fr' : '1fr'}; gap: 24px;">
      ${multipleAccounts && globalHtml ? `<div class="insights-section">
        <div class="insights-section-label">Top Performers</div>
        <div class="insight-chips-row">${globalHtml}</div>
      </div>` : ''}
      <div class="insights-section">
        <div class="insights-section-label">${multipleAccounts ? 'By Account' : 'Overview'}</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
          ${accountBlocks}
        </div>
      </div>
    </div>
  </div>`
}

function renderDashboard(
  ads: AggregatedAd[],
  selectedAccount: string | null,
  dateStart: string,
  dateEnd: string,
  sortBy: string,
  accountsList?: { id: string; name: string; slug: string }[],
  portalParams?: string
): string {
  const dashAccounts = accountsList || getAccounts()
  const extraParams = portalParams ? '&' + portalParams : ''
  const isPortal = !!portalParams
  const totalSpend = ads.reduce((sum, a) => sum + a.spend, 0)
  const totalLeads = ads.reduce((sum, a) => sum + a.leads, 0)
  const avgCTR = ads.length > 0 ? ads.reduce((sum, a) => sum + a.ctr, 0) / ads.length : 0

  const pageCSS = `
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--border-strong) transparent;
    }
    *::-webkit-scrollbar { width: 6px; height: 6px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
    *::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

    .page-header {
      background: var(--glass-bg);
      border-bottom: 1px solid var(--glass-border);
      box-shadow: var(--glass-highlight);
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .page-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 500;
      color: var(--text-secondary);
      font-family: var(--font-body);
      letter-spacing: -0.3px;
    }
    .page-title img { height: 22px; width: auto; opacity: 0.9; }
    .page-title span { color: var(--accent); }
    .controls {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .refresh-btn {
      background: var(--bg);
      color: #ffffff;
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .refresh-btn:hover { color: #ffffff; border-color: var(--border-strong); background: var(--bg-surface); }
    .refresh-btn.loading { opacity: 0.5; pointer-events: none; }
    .view-toggle {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .view-btn {
      background: transparent;
      color: var(--text-secondary);
      border: none;
      padding: 5px 12px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      transition: all 0.15s;
    }
    .view-btn:hover { color: #ffffff; }
    .view-btn.active { background: var(--accent); color: #ffffff; }
    .table-view { padding: 0 32px 32px; }
    .table-account-group { margin-bottom: 24px; }
    .table-account-header {
      font-size: 16px;
      font-weight: 600;
      color: var(--cream);
      font-family: var(--font-mono);
      padding: 16px 0 8px;
      border-bottom: 2px solid var(--accent);
      margin-bottom: 8px;
    }
    .table-campaign-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      margin-top: 8px;
      background: var(--bg-hover);
      border-radius: 8px 8px 0 0;
      border: 1px solid var(--border);
      border-bottom: none;
    }
    .table-campaign-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--cream);
      font-family: var(--font-mono);
    }
    .table-campaign-stats {
      font-size: 11px;
      color: var(--text-dim);
      font-family: var(--font-mono);
    }
    .table-scroll {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 0 0 8px 8px;
      margin-bottom: 4px;
    }
    .ads-table {
      min-width: 900px;
      border-collapse: collapse;
      font-size: 12px;
      font-family: var(--font-mono);
      white-space: nowrap;
    }
    .ads-table thead th {
      background: rgba(255,255,255,0.03);
      color: var(--text-dim);
      font-weight: 500;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
      padding: 10px 12px;
      text-align: right;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .ads-table thead th:first-child { text-align: left; }
    .th-sticky, .td-sticky {
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--bg-card);
    }
    .ads-table thead .th-sticky { z-index: 3; background: var(--bg); }
    .ads-table tbody td {
      padding: 10px 12px;
      color: var(--cream);
      text-align: right;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .td-name {
      text-align: left !important;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    }
    .ads-table tbody td { background: var(--bg); }
    .table-row { cursor: pointer; }
    .table-row:hover td { background: var(--bg-hover); }
    .table-row .td-sticky { background: var(--bg); }
    .table-row:hover .td-sticky { background: var(--bg-hover); }
    .date-picker-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .date-presets {
      display: flex;
      gap: 2px;
    }
    .date-preset {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 5px 10px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
    }
    .date-preset:first-child { border-radius: 6px 0 0 6px; }
    .date-preset:last-child { border-radius: 0 6px 6px 0; }
    .date-preset:not(:last-child) { border-right: none; }
    .date-preset:hover { color: #ffffff; border-color: var(--border-strong); }
    .date-preset.active { background: var(--accent); color: #ffffff; border-color: var(--accent); }
    .date-preset.active + .date-preset { border-left: 1px solid var(--accent); }
    .date-separator { color: var(--text-dim); font-size: 12px; margin: 0 2px; }
    input[type="date"] { display: none; }
    /* Custom date picker trigger */
    .dpick { position: relative; display: inline-block; }
    .dpick-trigger {
      background: var(--bg); border: 1px solid var(--border); color: #fff;
      padding: 6px 10px; border-radius: 6px; font-size: 13px;
      font-family: inherit; cursor: pointer; transition: border-color 0.15s;
      white-space: nowrap;
    }
    .dpick-trigger:hover { border-color: var(--border-strong); }
    .dpick-cal {
      display: none; position: absolute; top: calc(100% + 4px); left: 0;
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      padding: 8px; z-index: 999; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      width: 240px;
    }
    .dpick-cal.open { display: block; }
    .dpick-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 6px; padding: 0 2px;
    }
    .dpick-header span { font-size: 13px; font-weight: 600; color: #fff; }
    .dpick-header button {
      background: none; border: none; color: var(--text-secondary); cursor: pointer;
      padding: 2px 6px; font-size: 14px; border-radius: 4px;
    }
    .dpick-header button:hover { color: #fff; background: rgba(255,255,255,0.06); }
    .dpick-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; text-align: center; }
    .dpick-dow { font-size: 10px; color: var(--text-dim); padding: 4px 0; font-weight: 600; }
    .dpick-day {
      font-size: 12px; color: var(--text-secondary); padding: 5px 0; border-radius: 4px;
      cursor: pointer; border: none; background: none; font-family: inherit;
    }
    .dpick-day:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .dpick-day.sel { background: var(--accent); color: #fff; }
    .dpick-day.today { border: 1px solid var(--border-strong); }
    .dpick-day.other { color: var(--border-strong); }
    select {
      background: var(--bg);
      border: 1px solid var(--border);
      color: #ffffff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      transition: border-color 0.15s;
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ba1a6' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      padding-right: 26px;
    }
    select:hover { border-color: var(--border-strong); }
    select:focus { outline: none; border-color: var(--accent); }
    option { background: var(--bg); color: #ffffff; }
    /* Custom dropdown (replaces native select) */
    .csel { position: relative; display: inline-block; }
    .csel-trigger {
      background: var(--bg); border: 1px solid var(--border); color: #fff;
      padding: 6px 26px 6px 10px; border-radius: 6px; font-size: 13px;
      font-family: inherit; cursor: pointer; transition: border-color 0.15s;
      white-space: nowrap; min-width: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239ba1a6' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center;
    }
    .csel-trigger:hover { border-color: var(--border-strong); }
    .csel-menu {
      display: none; position: absolute; top: calc(100% + 4px); left: 0;
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      min-width: 100%; max-height: 260px; overflow-y: auto; z-index: 999;
      padding: 4px 0; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .csel-menu.open { display: block; }
    .csel-menu.up { top: auto; bottom: calc(100% + 4px); }
    .csel-opt {
      display: block; width: 100%; padding: 6px 10px; font-size: 13px;
      color: var(--text-secondary); background: none; border: none; text-align: left;
      cursor: pointer; font-family: inherit; white-space: nowrap;
    }
    .csel-opt:hover { background: rgba(255,255,255,0.06); color: #fff; }
    .csel-opt.active { color: #fff; background: rgba(255,255,255,0.08); }
    .insights-panel {
      margin: 20px 32px 0;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: var(--glass-shadow), var(--glass-highlight);
    }
    .insights-header {
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .insights-title {
      font-size: 10px;
      font-weight: 700;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .insights-body {
      padding: 16px 20px;
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
    }
    .insights-section { flex: 1; min-width: 250px; }
    .insights-section-label {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .insight-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-family: var(--font-mono);
      padding: 5px 10px;
      border-radius: 6px;
      margin: 3px 3px 3px 0;
      line-height: 1.4;
      border: 1px solid transparent;
    }
    .insight-chip strong { font-weight: 600; }
    .insight-icon { font-size: 10px; flex-shrink: 0; }
    .insight-green {
      background: rgba(74,222,128,0.08);
      border-color: rgba(74,222,128,0.2);
      color: rgba(200,240,210,0.9);
    }
    .insight-green .insight-icon { color: rgba(74,222,128,0.9); }
    .insight-red {
      background: rgba(248,113,113,0.08);
      border-color: rgba(248,113,113,0.2);
      color: rgba(255,200,200,0.9);
    }
    .insight-red .insight-icon { color: rgba(248,113,113,0.9); }
    .insight-yellow {
      background: rgba(234,179,8,0.08);
      border-color: rgba(234,179,8,0.2);
      color: rgba(255,230,150,0.9);
    }
    .insight-yellow .insight-icon { color: var(--status-active); }
    .insight-account-block {
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .insight-account-block:last-child { margin-bottom: 0; }
    .insight-account-header { margin-bottom: 8px; }
    .insight-account-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--cream);
      font-family: var(--font-mono);
      margin-bottom: 6px;
    }
    .insight-account-stats {
      display: flex;
      gap: 0;
      flex-wrap: wrap;
    }
    .insight-stat-item {
      display: flex;
      flex-direction: column;
      padding: 0 12px 0 0;
      margin-right: 12px;
      border-right: 1px solid rgba(255,255,255,0.06);
      margin-bottom: 4px;
    }
    .insight-stat-item:last-child { border-right: none; }
    .insight-stat-val {
      font-size: 13px;
      font-weight: 600;
      color: var(--cream);
      font-family: var(--font-mono);
    }
    .insight-stat-lbl {
      font-size: 9px;
      color: var(--text-dim);
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 1px;
    }
    .insight-chips-row {
      display: flex;
      flex-wrap: wrap;
      margin-top: 8px;
      gap: 0;
    }
    /* KPI strip — Bloomberg status-bar, not tiles */
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0;
      margin: 20px 32px 24px;
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 4px;
      box-shadow: inset 0 1px 0 rgba(255,245,225,0.03);
      overflow: hidden;
    }
    .summary-stat {
      padding: 14px 18px;
      text-align: left;
      position: relative;
      background: transparent;
    }
    .summary-stat + .summary-stat::before {
      content: '';
      position: absolute;
      left: 0; top: 14px; bottom: 14px;
      width: 1px;
      background: var(--border);
    }
    .summary-value {
      font-family: var(--font-sans);
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--text);
      line-height: 1;
      font-feature-settings: 'tnum' 1;
    }
    .summary-label {
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .ad-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
      padding: 24px 32px;
    }
    .ad-card {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
      box-shadow: var(--glass-shadow), var(--glass-highlight);
      cursor: pointer;
    }
    .ad-card:hover { border-color: var(--glass-border-strong); box-shadow: 0 20px 60px rgba(0,0,0,0.45), 0 4px 16px rgba(0,0,0,0.3), var(--glass-highlight); transform: translateY(-2px); }
    .thumbnail {
      width: 100%;
      height: 180px;
      background: #0f1112;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }
    .thumbnail img { width: 100%; height: 100%; object-fit: cover; }
    .thumbnail-placeholder { color: var(--text-dim); font-size: 13px; font-family: var(--font-mono); }
    .type-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(0,0,0,0.7);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--accent);
    }
    .ad-info { padding: 16px; }
    .ad-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--cream);
      margin-bottom: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.4;
    }
    .ad-account {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      margin-bottom: 12px;
    }
    .ad-spend {
      font-size: 22px;
      font-weight: 700;
      color: var(--cream);
      font-family: var(--font-mono);
      margin-bottom: 16px;
    }
    .scores { display: flex; flex-direction: column; gap: 8px; }
    .score-row { display: flex; align-items: center; gap: 8px; }
    .score-label { font-size: 13px; font-family: var(--font-mono); color: var(--text-dim); width: 60px; }
    .score-bar { flex: 1; height: 7px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
    .score-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .score-value { font-size: 13px; font-family: var(--font-mono); color: var(--cream); font-weight: 600; width: 75px; text-align: right; }
    .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .metric { font-size: 13px; }
    .metric-label { color: var(--text-dim); font-family: var(--font-mono); font-size: 13px; }
    .metric-value { color: var(--cream); font-weight: 600; font-family: var(--font-mono); font-size: 13px; }
    .empty { text-align: center; padding: 48px; color: var(--text-dim); font-family: var(--font-mono); }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 6px;
    }
    .status-active { background: rgba(74,222,128,0.85); }
    .status-paused { background: rgba(234,179,8,0.75); }
    .status-other { background: var(--text-dim); }

    /* Modal Styles */
    .ad-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .ad-modal.open { display: flex; }
    .modal-content {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border-strong);
      border-radius: 20px;
      width: 95%;
      max-width: 1100px;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 80px rgba(0,0,0,0.6), var(--glass-highlight);
    }
    .modal-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .modal-ad-select {
      flex: 1;
      min-width: 160px;
      max-width: 350px;
    }
    .modal-status {
      display: flex;
      align-items: center;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }
    .modal-ad-id {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      background: rgba(255,255,255,0.05);
      padding: 4px 8px;
      border-radius: 4px;
    }
    .modal-date-range {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      margin-left: auto;
    }
    .modal-date-picker {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
    }
    .modal-date-picker input[type="date"] {
      padding: 5px 8px;
      font-size: 11px;
    }
    .modal-close {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .modal-close:hover { background: rgba(255,255,255,0.05); border-color: var(--border-hover); }
    .modal-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .modal-media {
      flex: 1;
      background: var(--bg-base);
      overflow-y: auto;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 16px;
    }
    .modal-media iframe {
      border: none;
      width: 500px;
      height: 100%;
      min-height: 80vh;
    }
    .modal-media video, .modal-media img {
      max-width: 100%;
      max-height: 70vh;
      object-fit: contain;
    }
    .ad-preview {
      background: var(--bg-surface);
      border-radius: 8px;
      overflow: hidden;
      max-width: 500px;
      width: 100%;
      border: 1px solid var(--border);
    }
    .ad-preview-body {
      padding: 16px;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text);
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .ad-preview-media {
      position: relative;
      background: var(--bg-base);
    }
    .ad-preview-media img {
      display: block;
      width: 100%;
      max-height: none;
    }
    .ad-preview-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: rgba(255,255,255,0.03);
      border-top: 1px solid rgba(255,255,255,0.06);
      gap: 12px;
    }
    .ad-preview-footer-text {
      flex: 1;
      min-width: 0;
    }
    .ad-preview-domain {
      font-size: 11px;
      color: var(--text-dim);
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .ad-preview-headline {
      font-size: 14px;
      font-weight: 500;
      color: var(--cream);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ad-preview-cta {
      flex-shrink: 0;
      background: var(--accent);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--cream);
      padding: 8px 16px;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(122, 107, 85, 0.3);
      font-size: 13px;
      font-family: var(--font-mono);
      font-weight: 500;
      cursor: default;
      white-space: nowrap;
    }
    .modal-right-panel {
      width: 380px;
      min-width: 380px;
      overflow-y: auto;
      border-left: 1px solid var(--border);
    }
    .modal-dimensions {
      padding: 20px;
      border-bottom: 1px solid var(--border);
    }
    .modal-metrics {
      padding: 16px 20px;
    }
    .modal-hero-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .modal-hero-item {
      background: rgba(255,255,255,0.025);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .modal-hero-val {
      font-size: 16px;
      font-weight: 700;
      color: var(--cream);
      font-family: var(--font-mono);
      letter-spacing: -0.3px;
    }
    .modal-hero-lbl {
      font-size: 9px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      font-weight: 600;
    }
    .modal-scores-header {
      font-size: 10px;
      font-weight: 700;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 10px;
    }
    .dim-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .dim-section-header:hover { opacity: 0.8; }
    .dim-section-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--cream);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dim-section-title svg { color: var(--accent); }
    .dim-section-toggle { color: var(--text-dim); font-size: 12px; transition: transform 0.2s; }
    .dim-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .dim-row-label {
      font-size: 13px;
      color: var(--text-dim);
    }
    .dim-row-value {
      font-size: 13px;
      color: var(--cream);
      text-align: right;
      max-width: 60%;
      word-break: break-word;
    }
    .dim-row-value .dim-sub {
      font-size: 11px;
      color: var(--text-dim);
      display: block;
    }
    .modal-spend {
      font-size: 32px;
      font-weight: 600;
      color: var(--cream);
      font-family: var(--font-mono);
      margin-bottom: 20px;
    }
    .modal-scores { margin-bottom: 20px; }
    .modal-score-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
    }
    .modal-score-label {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      width: 80px;
      flex-shrink: 0;
    }
    .modal-score-bar {
      flex: 1;
      height: 14px;
      background: rgba(255,255,255,0.04);
      border-radius: 4px;
      overflow: hidden;
    }
    .modal-score-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease;
    }
    .modal-score-value {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--cream);
      font-weight: 500;
      width: 70px;
      text-align: right;
      flex-shrink: 0;
    }
    .modal-metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .modal-metric-box {
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
    }
    .modal-metric-label {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .modal-metric-value {
      font-size: 18px;
      font-weight: 600;
      color: var(--cream);
      font-family: var(--font-mono);
    }
    @media (max-width: 768px) {
      .modal-body { flex-direction: column; }
      .modal-metrics { width: 100%; border-left: none; border-top: 1px solid var(--border); }
    }
    .video-thumb-wrap {
      position: relative;
      cursor: pointer;
    }
    .video-thumb-wrap:hover .play-btn { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
    .video-thumb-wrap:hover img { opacity: 0.85; }
    .video-thumb-wrap img { transition: opacity 0.2s; }
    .play-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      opacity: 0.85;
      transition: opacity 0.2s, transform 0.2s;
      filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5));
    }
    /* Collapsible Metric Sections */
    .metric-section {
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .metric-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(255,255,255,0.02);
      cursor: pointer;
      transition: background 0.2s;
    }
    .metric-section-header:hover {
      background: rgba(255,255,255,0.04);
    }
    .metric-section-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--cream);
      font-family: var(--font-mono);
    }
    .metric-section-toggle {
      color: var(--text-dim);
      font-size: 10px;
      transition: transform 0.2s;
    }
    .metric-section.collapsed .metric-section-toggle {
      transform: rotate(-90deg);
    }
    .metric-section-content {
      padding: 0;
      max-height: 2000px;
      transition: max-height 0.3s ease;
    }
    .metric-section.collapsed .metric-section-content {
      max-height: 0;
      overflow: hidden;
    }
    .metric-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      border-top: 1px solid var(--border);
    }
    .metric-row-label {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }
    .metric-row-value {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--cream);
      font-weight: 500;
      text-align: right;
    }
    .metric-row-sub {
      display: flex;
      gap: 12px;
      margin-top: 2px;
    }
    .metric-row-cost {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--accent);
    }
    .metric-row-cvr {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }
    /* Charts view */
    .charts-view { padding: 24px 32px; }
    .charts-loading {
      text-align: center;
      padding: 60px 0;
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: 14px;
    }
    .charts-kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      padding: 16px;
      box-shadow: var(--glass-shadow), var(--glass-highlight);
    }
    .kpi-label {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: 600;
      color: var(--cream);
      font-family: var(--font-mono);
      margin-bottom: 8px;
    }
    .kpi-spark { height: 52px; }
    .kpi-spark svg { width: 100%; height: 100%; }
    .kpi-change {
      font-size: 11px;
      font-family: var(--font-mono);
    }
    .kpi-change.up { color: rgba(74,222,128,0.9); }
    .kpi-change.down { color: rgba(248,113,113,0.9); }
    .kpi-change.flat { color: var(--text-dim); }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .chart-card {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      padding: 20px;
      box-shadow: var(--glass-shadow), var(--glass-highlight);
    }
    .chart-card.chart-wide { grid-column: span 2; }
    .chart-title {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 16px;
    }
    .chart-container { height: 240px; position: relative; }
    .chart-container.chart-bars { height: auto; min-height: 100px; }
    .chart-container svg { width: 100%; height: 100%; overflow: visible; }
    .chart-tooltip {
      position: absolute;
      background: rgba(13, 17, 23, 0.95);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--cream);
      pointer-events: none;
      z-index: 10;
      white-space: nowrap;
    }
    .bar-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      gap: 12px;
    }
    .bar-label {
      width: 180px;
      min-width: 180px;
      font-size: 12px;
      color: var(--text-dim);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bar-track {
      flex: 1;
      height: 24px;
      background: rgba(122, 107, 85, 0.08);
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
      min-width: 2px;
    }
    .bar-fill-spend { background: var(--border-strong); }
    .bar-fill-leads { background: rgba(34, 197, 94, 0.5); }
    .bar-value {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--cream);
      min-width: 80px;
      text-align: right;
    }
    .bar-stats {
      display: flex;
      gap: 12px;
      min-width: 200px;
    }
    .bar-stat {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }
    .bar-stat strong { color: var(--cream); }
    .chart-legend {
      display: flex;
      gap: 16px;
      margin-bottom: 12px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .charts-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .charts-filters {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .charts-date-picker {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .charts-date-picker input[type="date"] {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-family: var(--font-mono);
    }
    .chart-tt {
      position: absolute;
      background: rgba(13, 17, 23, 0.95);
      border: 1px solid rgba(122, 107, 85, 0.25);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--cream);
      pointer-events: none;
      z-index: 20;
      white-space: nowrap;
      display: none;
      line-height: 1.6;
    }
    .charts-filters select {
      background: var(--bg);
      color: #ffffff;
      border: 1px solid var(--border);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
      max-width: 250px;
    }
    .charts-period-toggle {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .period-btn {
      background: transparent;
      color: var(--text-dim);
      border: none;
      padding: 8px 14px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--font-mono);
      transition: all 0.2s;
    }
    .period-btn:hover { color: var(--cream); }
    .period-btn.active { background: var(--accent); color: var(--cream); }
    .top-performers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .top-perf-card {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      padding: 14px 16px;
      box-shadow: var(--glass-shadow), var(--glass-highlight);
    }
    .top-perf-label {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .top-perf-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--cream);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }
    .top-perf-value {
      font-size: 18px;
      font-weight: 600;
      font-family: var(--font-mono);
    }
    .top-perf-value.green { color: var(--status-completed); }
    .top-perf-value.red { color: var(--status-overdue); }
    .top-perf-value.cyan { color: #b5a48e; }
    .top-perf-value.gold { color: var(--status-active); }
    .top-perf-sub {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-dim);
      margin-top: 2px;
    }
    @media (max-width: 900px) {
      .charts-grid { grid-template-columns: 1fr; }
      .chart-card.chart-wide { grid-column: span 1; }
    }`

  const body = `
    <div class="page-header">
      <div class="page-title"><img src="/ctrl-strategies-logo.png" alt="Example Co" style="height:24px;" /> <img src="/meta-logo-white.jpeg" alt="Meta" style="height:20px;margin-left:2px;" /></div>
      <div class="controls">
        <div class="csel" id="account-csel">
          <button class="csel-trigger" onclick="toggleCsel('account-csel')">${selectedAccount ? escapeHtml(dashAccounts.find(a => a.id === selectedAccount)?.name || 'All Accounts') : 'All Accounts'}</button>
          <div class="csel-menu">
            <button class="csel-opt ${!selectedAccount ? 'active' : ''}" onclick="pickCsel('account-csel','','All Accounts')">All Accounts</button>
            ${dashAccounts.map(acc => `<button class="csel-opt ${selectedAccount === acc.id ? 'active' : ''}" onclick="pickCsel('account-csel','${acc.id}','${escapeHtml(acc.name)}')">${escapeHtml(acc.name)}</button>`).join('')}
          </div>
        </div>
        <input type="hidden" id="account-select" value="${selectedAccount || ''}" />
        <div class="date-picker-group">
          <div class="date-presets">
            <button class="date-preset" onclick="setPreset(7)">7d</button>
            <button class="date-preset" onclick="setPreset(14)">14d</button>
            <button class="date-preset" onclick="setPreset(30)">30d</button>
          </div>
          <div class="dpick" id="dpick-start">
            <button class="dpick-trigger" onclick="openDatePicker('dpick-start')">${dateStart}</button>
            <div class="dpick-cal" id="dpick-start-cal"></div>
          </div>
          <input type="hidden" id="date-start" value="${dateStart}" />
          <span class="date-separator">\u2192</span>
          <div class="dpick" id="dpick-end">
            <button class="dpick-trigger" onclick="openDatePicker('dpick-end')">${dateEnd}</button>
            <div class="dpick-cal" id="dpick-end-cal"></div>
          </div>
          <input type="hidden" id="date-end" value="${dateEnd}" />
        </div>
        <div class="csel" id="sort-csel">
          <button class="csel-trigger" onclick="toggleCsel('sort-csel')">${{spend:'Sort by Spend',ctr:'Sort by CTR',hook:'Sort by Hook Rate',engagement:'Sort by Engagement'}[sortBy] || 'Sort by Spend'}</button>
          <div class="csel-menu">
            ${[['spend','Sort by Spend'],['ctr','Sort by CTR'],['hook','Sort by Hook Rate'],['engagement','Sort by Engagement']].map(([v,l]) => `<button class="csel-opt ${sortBy===v?'active':''}" onclick="pickCsel('sort-csel','${v}','${l}')">${l}</button>`).join('')}
          </div>
        </div>
        <input type="hidden" id="sort-select" value="${sortBy}" />
        <div class="csel" id="jump-csel">
          <button class="csel-trigger" onclick="toggleCsel('jump-csel')">Jump to ad...</button>
          <div class="csel-menu">
            ${ads.map((ad, i) => `<button class="csel-opt" onclick="pickCsel('jump-csel','${i}','${escapeHtml(ad.ad_name.substring(0, 40))}');jumpToAd(${i})">${escapeHtml(ad.ad_name.substring(0, 40))}${ad.ad_name.length > 40 ? '...' : ''}</button>`).join('')}
          </div>
        </div>
        <div class="view-toggle">
          <button class="view-btn active" id="btn-cards" onclick="setView('cards')">Cards</button>
          <button class="view-btn" id="btn-table" onclick="setView('table')">Table</button>
          <button class="view-btn" id="btn-charts" onclick="setView('charts')">Charts</button>
        </div>
        <button class="refresh-btn" onclick="refreshData()" id="refresh-btn" title="Clear caches and reload fresh data from Meta">\u21BB Refresh</button>
      </div>
    </div>

    <div class="summary">
      <div class="summary-stat">
        <div class="summary-label">Total Spend</div>
        <div class="summary-value">$${totalSpend.toFixed(2)}</div>
      </div>
      <div class="summary-stat">
        <div class="summary-label">Leads</div>
        <div class="summary-value">${totalLeads}</div>
      </div>
      <div class="summary-stat">
        <div class="summary-label">Avg CTR</div>
        <div class="summary-value">${avgCTR.toFixed(2)}%</div>
      </div>
      <div class="summary-stat">
        <div class="summary-label">Active Ads</div>
        <div class="summary-value">${ads.length}</div>
      </div>
    </div>

    ${generateInsightsHTML(ads)}

    <div class="ad-grid">
      ${ads.length === 0 ? '<div class="empty">No ads found for the selected filters</div>' : ''}
      ${ads.map((ad, index) => `
        <div class="ad-card" onclick="openAdModal(${index})" data-ad-index="${index}">
          <div class="thumbnail">
            ${ad.thumbnailUrl
              ? `<img src="${isPortal ? escapeHtml(ad.imageUrl || ad.thumbnailUrl) : '/api/ads/thumb/' + encodeURIComponent(ad.ad_id)}" alt="${escapeHtml(ad.ad_name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''" /><span class="thumbnail-placeholder" style="display:none">No preview</span>`
              : '<span class="thumbnail-placeholder">No preview</span>'
            }
            ${ad.objectType ? `<span class="type-badge">${ad.objectType}</span>` : ''}
            <span class="status-dot status-${(ad.effectiveStatus || '').toLowerCase() === 'active' ? 'active' : (ad.effectiveStatus || '').toLowerCase() === 'paused' ? 'paused' : 'other'}" style="position: absolute; top: 8px; right: 8px;"></span>
          </div>
          <div class="ad-info">
            <div class="ad-name" title="${escapeHtml(ad.campaign_name + ' / ' + ad.ad_name)}">${escapeHtml(ad.campaign_name || 'Unknown Campaign')} / ${escapeHtml(ad.ad_name)}</div>
            <div class="ad-account">${escapeHtml(ad.account_name)}</div>
            <div class="ad-spend">$${ad.spend.toFixed(2)} CAD</div>

            ${(() => {
              const scoreRows = getCardScoreRows(ad)
              return `<div class="scores">
                ${scoreRows.map(row => `<div class="score-row">
                  <span class="score-label">${escapeHtml(row.label)}</span>
                  <div class="score-bar">
                    <div class="score-fill" style="width: ${row.barWidth}%; background: ${getScoreColor(row.score)};"></div>
                  </div>
                  <span class="score-value">${escapeHtml(row.value)}</span>
                </div>`).join('')}
              </div>`
            })()}

            ${(() => {
              const metrics = getCardMetricItems(ad)
              return `<div class="metrics">
                ${metrics.map(m => `<div class="metric">
                  <span class="metric-label">${escapeHtml(m.label)} </span>
                  <span class="metric-value">${escapeHtml(m.value)}</span>
                </div>`).join('')}
              </div>`
            })()}
          </div>
        </div>
      `).join('')}
    </div>

    <div id="table-view" class="table-view" style="display:none;">
      ${(() => {
        const byAccount = new Map<string, Map<string, AggregatedAd[]>>()
        for (const ad of ads) {
          if (!byAccount.has(ad.account_name)) byAccount.set(ad.account_name, new Map())
          const campaigns = byAccount.get(ad.account_name)!
          if (!campaigns.has(ad.campaign_name)) campaigns.set(ad.campaign_name, [])
          campaigns.get(ad.campaign_name)!.push(ad)
        }
        let html = ''
        const adIndexMap = new Map<string, number>()
        ads.forEach((ad, i) => adIndexMap.set(ad.ad_id + '_' + ad.campaign_id, i))

        for (const [accountName, campaigns] of byAccount) {
          html += `<div class="table-account-group">
            <div class="table-account-header">${escapeHtml(accountName)}</div>`
          for (const [campaignName, campAds] of campaigns) {
            const cSpend = campAds.reduce((s, a) => s + a.spend, 0)
            const cImpr = campAds.reduce((s, a) => s + a.impressions, 0)
            const campaignResult = getCampaignResultSummary(campAds)
            html += `<div class="table-campaign-header">
              <span class="table-campaign-name">${escapeHtml(campaignName)}</span>
              <span class="table-campaign-stats">${campAds.length} ads \u00B7 $${cSpend.toFixed(2)} \u00B7 ${cImpr.toLocaleString()} impr \u00B7 ${campaignResult.value.toLocaleString()} ${escapeHtml(campaignResult.label.toLowerCase())}</span>
            </div>
            <div class="table-scroll"><table class="ads-table">
              <thead><tr>
                <th class="th-sticky">Ad Name</th>
                <th>Status</th>
                <th>Spend</th>
                <th>Impr</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>CPC</th>
                <th>CPM</th>
                <th>Result</th>
                <th>Cost/Result</th>
                <th>Hook</th>
                <th>Hold</th>
              </tr></thead>
              <tbody>`
            for (const ad of campAds) {
              const idx = adIndexMap.get(ad.ad_id + '_' + ad.campaign_id) ?? 0
              const statusClass = (ad.effectiveStatus || '').toLowerCase() === 'active' ? 'active' : (ad.effectiveStatus || '').toLowerCase() === 'paused' ? 'paused' : 'other'
              const pc = getPrimaryConversion(ad)
              html += `<tr onclick="openAdModal(${idx})" class="table-row">
                <td class="td-name td-sticky">${escapeHtml(ad.ad_name)}</td>
                <td><span class="status-dot status-${statusClass}" style="display:inline-block;"></span></td>
                <td>$${ad.spend.toFixed(2)}</td>
                <td>${ad.impressions.toLocaleString()}</td>
                <td>${ad.link_clicks}</td>
                <td>${ad.ctr.toFixed(2)}%</td>
                <td>$${ad.cpc.toFixed(2)}</td>
                <td>$${ad.cpm.toFixed(2)}</td>
                <td>${escapeHtml(pc.label)}: ${escapeHtml(pc.value)}</td>
                <td>${escapeHtml(pc.costLabel)} ${escapeHtml(pc.costValue)}</td>
                <td style="color:${getScoreColor(ad.hookScore)}">${ad.hook_rate.toFixed(1)}%</td>
                <td>${ad.hold_rate.toFixed(1)}%</td>
              </tr>`
            }
            html += `</tbody></table></div>`
          }
          html += `</div>`
        }
        return html
      })()}
    </div>

    <div id="charts-view" class="charts-view" style="display:none;">
      <div class="charts-controls">
        <div class="charts-filters">
          <div class="charts-date-picker">
            <div class="dpick" id="dpick-chart-start">
              <button class="dpick-trigger" onclick="openDatePicker('dpick-chart-start')">${dateStart}</button>
              <div class="dpick-cal" id="dpick-chart-start-cal"></div>
            </div>
            <input type="hidden" id="chart-date-start" value="${dateStart}" />
            <span class="date-separator">to</span>
            <div class="dpick" id="dpick-chart-end">
              <button class="dpick-trigger" onclick="openDatePicker('dpick-chart-end')">${dateEnd}</button>
              <div class="dpick-cal" id="dpick-chart-end-cal"></div>
            </div>
            <input type="hidden" id="chart-date-end" value="${dateEnd}" />
            <button class="refresh-btn" onclick="reloadChartData()" style="padding:6px 12px;">Go</button>
            <div class="date-presets" style="margin-left:4px;">
              <button class="date-preset" onclick="setChartPreset(7)">7d</button>
              <button class="date-preset" onclick="setChartPreset(14)">14d</button>
              <button class="date-preset" onclick="setChartPreset(30)">30d</button>
              <button class="date-preset" onclick="setChartPreset(60)">60d</button>
              <button class="date-preset" onclick="setChartPreset(90)">90d</button>
            </div>
          </div>
          <select id="chart-campaign-filter" onchange="onChartCampaignChange()">
            <option value="">All Campaigns</option>
          </select>
          <select id="chart-ad-filter" onchange="onChartAdChange()">
            <option value="">All Ads</option>
          </select>
        </div>
        <div class="charts-period-toggle">
          <button class="period-btn active" onclick="setChartPeriod('daily')">Daily</button>
          <button class="period-btn" onclick="setChartPeriod('weekly')">Weekly</button>
          <button class="period-btn" onclick="setChartPeriod('monthly')">Monthly</button>
        </div>
      </div>
      <div class="charts-loading" id="charts-loading">Loading chart data...</div>
      <div id="charts-content" style="display:none;">
        <div class="charts-kpi-row" id="charts-kpi-row"></div>
        <div id="charts-top-performers"></div>
        <div class="charts-grid">
          <div class="chart-card chart-wide">
            <div class="chart-title" id="chart-spend-leads-title">Daily Spend & Leads</div>
            <div id="chart-spend-leads" class="chart-container"></div>
          </div>
          <div class="chart-card">
            <div class="chart-title" id="chart-cpr-title">CPL Trend</div>
            <div id="chart-cpl" class="chart-container"></div>
          </div>
          <div class="chart-card">
            <div class="chart-title">CTR Trend</div>
            <div id="chart-ctr" class="chart-container"></div>
          </div>
          <div class="chart-card">
            <div class="chart-title">Hook & Hold Rate</div>
            <div id="chart-hook-hold" class="chart-container"></div>
          </div>
          <div class="chart-card">
            <div class="chart-title" id="chart-breakdown-title">Campaign Breakdown</div>
            <div id="chart-campaigns" class="chart-container chart-bars"></div>
          </div>
          <div class="chart-card chart-wide">
            <div class="chart-title" id="chart-top-ads-title">Top Ads by Spend</div>
            <div id="chart-top-ads" class="chart-container chart-bars"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Ad Detail Modal -->
    <div id="ad-modal" class="ad-modal" onclick="if(event.target === this) closeAdModal()">
      <div class="modal-content">
        <div class="modal-header">
          <select id="modal-ad-select" class="modal-ad-select" onchange="switchAd(this.value)">
            ${ads.map((ad, i) => `<option value="${i}">${escapeHtml(ad.ad_name)}</option>`).join('')}
          </select>
          <div class="modal-status">
            <span id="modal-status-dot" class="status-dot"></span>
            <span id="modal-status-text"></span>
          </div>
          <div class="modal-date-picker">
            <div class="dpick" id="dpick-modal-start">
              <button class="dpick-trigger" onclick="openDatePicker('dpick-modal-start')">${dateStart}</button>
              <div class="dpick-cal" id="dpick-modal-start-cal"></div>
            </div>
            <input type="hidden" id="modal-date-start" value="${dateStart}" />
            <span class="date-separator">\u2192</span>
            <div class="dpick" id="dpick-modal-end">
              <button class="dpick-trigger" onclick="openDatePicker('dpick-modal-end')">${dateEnd}</button>
              <div class="dpick-cal" id="dpick-modal-end-cal"></div>
            </div>
            <input type="hidden" id="modal-date-end" value="${dateEnd}" />
          </div>
          <button class="modal-close" onclick="closeAdModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="modal-media">
            <div id="modal-media-container"></div>
          </div>
          <div class="modal-right-panel">
            <div id="modal-dimensions" class="modal-dimensions"></div>
            <div class="modal-metrics">
              <div id="modal-hero-stats" class="modal-hero-stats"></div>
              <div class="modal-scores-header">CTRL Scores</div>
              <div class="modal-scores" id="modal-scores"></div>
              <div id="modal-sections"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`

  // Serialize ads data for JavaScript
  const adsJson = JSON.stringify(ads.map(ad => ({
    ad_id: ad.ad_id,
    ad_name: ad.ad_name,
    campaign_id: ad.campaign_id,
    account_name: ad.account_name,
    campaign_name: ad.campaign_name,
    spend: ad.spend,
    impressions: ad.impressions,
    clicks: ad.clicks,
    link_clicks: ad.link_clicks,
    outbound_clicks: ad.outbound_clicks,
    ctr: ad.ctr,
    ctr_outbound: ad.ctr_outbound,
    cpc: ad.cpc,
    cpc_outbound: ad.cpc_outbound,
    cpm: ad.cpm,
    link_clicks_ctr: ad.link_clicks_ctr,
    cost_per_link_click: ad.cost_per_link_click,
    frequency: ad.frequency,
    reach: ad.reach || 0,
    landing_page_views: ad.link_clicks || 0,
    leads: ad.leads,
    cpl: ad.cpl,
    purchases: ad.purchases,
    purchase_value: ad.purchase_value,
    hook_rate: ad.hook_rate,
    hold_rate: ad.hold_rate,
    video_views: ad.video_views,
    video_thruplay: ad.video_thruplay,
    video_p25: ad.video_p25,
    video_p50: ad.video_p50,
    video_p75: ad.video_p75,
    video_p95: ad.video_p95,
    video_p100: ad.video_p100,
    hookScore: ad.hookScore,
    clickScore: ad.clickScore,
    conversionScore: ad.conversionScore,
    thumbnailUrl: ad.thumbnailUrl ? (isPortal ? (ad.imageUrl || ad.thumbnailUrl) : `/api/ads/thumb/${encodeURIComponent(ad.ad_id)}`) : null,
    imageUrl: ad.imageUrl ? (isPortal ? ad.imageUrl : `/api/ads/thumb/${encodeURIComponent(ad.ad_id)}`) : null,
    isHiddenVideo: !ad.videoId && ad.objectType === 'SHARE' && (ad.thumbnailUrl || '').includes('t15.'),
    objectType: ad.objectType,
    videoId: ad.videoId,
    videoUrl: ad.videoUrl,
    effectiveStatus: ad.effectiveStatus,
    body: ad.body,
    title: ad.title,
    ctaType: ad.ctaType,
    linkUrl: ad.linkUrl,
    adsetName: ad.adsetName,
    optimizationGoal: ad.optimizationGoal,
    conversionEvent: ad.conversionEvent,
    endDate: ad.endDate,
    bodyVariations: ad.bodyVariations,
    titleVariations: ad.titleVariations,
    reactions: ad.reactions,
    comments: ad.comments,
    shares: ad.shares,
    engagementScore: ad.engagementScore,
    engagementScoreRating: ad.engagementScoreRating
  })))

  const script = `
    var adsData = ${adsJson};
    var currentDateStart = '${dateStart}';
    var currentDateEnd = '${dateEnd}';
    var currentAdIndex = 0;

    // Custom dropdown helpers
    function toggleCsel(id) {
      var el = document.getElementById(id);
      var menu = el.querySelector('.csel-menu');
      var wasOpen = menu.classList.contains('open');
      // Close all other dropdowns
      document.querySelectorAll('.csel-menu.open').forEach(function(m) { m.classList.remove('open'); });
      if (!wasOpen) menu.classList.add('open');
    }
    function pickCsel(id, value, label) {
      var el = document.getElementById(id);
      el.querySelector('.csel-trigger').textContent = label;
      // Update hidden input if exists
      var hidden = el.nextElementSibling;
      if (hidden && hidden.tagName === 'INPUT') hidden.value = value;
      el.querySelector('.csel-menu').classList.remove('open');
      // Remove active from all opts, set on clicked
      el.querySelectorAll('.csel-opt').forEach(function(o) { o.classList.remove('active'); });
      event.target.classList.add('active');
      // Trigger filter update
      if (id === 'account-csel' || id === 'sort-csel') updateFilters();
    }
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.csel')) {
        document.querySelectorAll('.csel-menu.open').forEach(function(m) { m.classList.remove('open'); });
      }
    });

    // Date picker
    var dpickState = {};
    function openDatePicker(id) {
      document.querySelectorAll('.dpick-cal.open').forEach(function(c) { c.classList.remove('open'); });
      document.querySelectorAll('.csel-menu.open').forEach(function(m) { m.classList.remove('open'); });
      var cal = document.getElementById(id + '-cal');
      var hiddenId = id.replace('dpick-', '').replace('-start', '-start').replace('-end', '-end');
      // Map dpick id to hidden input id
      var inputMap = {
        'dpick-start': 'date-start', 'dpick-end': 'date-end',
        'dpick-chart-start': 'chart-date-start', 'dpick-chart-end': 'chart-date-end',
        'dpick-modal-start': 'modal-date-start', 'dpick-modal-end': 'modal-date-end'
      };
      var inputId = inputMap[id];
      var currentVal = document.getElementById(inputId).value;
      var d = currentVal ? new Date(currentVal + 'T00:00:00') : new Date();
      dpickState[id] = { month: d.getMonth(), year: d.getFullYear(), inputId: inputId };
      renderCal(id);
      cal.classList.add('open');
    }
    function renderCal(id) {
      var s = dpickState[id];
      var cal = document.getElementById(id + '-cal');
      var selVal = document.getElementById(s.inputId).value;
      var today = new Date(); today.setHours(0,0,0,0);
      var first = new Date(s.year, s.month, 1);
      var startDay = first.getDay();
      var daysInMonth = new Date(s.year, s.month + 1, 0).getDate();
      var prevDays = new Date(s.year, s.month, 0).getDate();
      var mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var h = '<div class="dpick-header">';
      h += '<span>' + mNames[s.month] + ' ' + s.year + '</span>';
      h += '<div><button onclick="dpickNav(\\'' + id + '\\',-1)">\u2190</button>';
      h += '<button onclick="dpickNav(\\'' + id + '\\',1)">\u2192</button></div></div>';
      h += '<div class="dpick-grid">';
      ['S','M','T','W','T','F','S'].forEach(function(d) { h += '<div class="dpick-dow">' + d + '</div>'; });
      // Previous month days
      for (var i = startDay - 1; i >= 0; i--) {
        var pd = prevDays - i;
        var pdate = new Date(s.year, s.month - 1, pd);
        var pval = fmt(pdate);
        h += '<button class="dpick-day other" onclick="pickDate(\\'' + id + '\\',\\'' + pval + '\\')">' + pd + '</button>';
      }
      // Current month
      for (var d = 1; d <= daysInMonth; d++) {
        var date = new Date(s.year, s.month, d);
        var val = fmt(date);
        var cls = 'dpick-day';
        if (val === selVal) cls += ' sel';
        if (date.getTime() === today.getTime()) cls += ' today';
        h += '<button class="' + cls + '" onclick="pickDate(\\'' + id + '\\',\\'' + val + '\\')">' + d + '</button>';
      }
      // Next month days
      var totalCells = startDay + daysInMonth;
      var remaining = (7 - (totalCells % 7)) % 7;
      for (var d = 1; d <= remaining; d++) {
        var ndate = new Date(s.year, s.month + 1, d);
        var nval = fmt(ndate);
        h += '<button class="dpick-day other" onclick="pickDate(\\'' + id + '\\',\\'' + nval + '\\')">' + d + '</button>';
      }
      h += '</div>';
      cal.innerHTML = h;
    }
    function dpickNav(id, dir) {
      var s = dpickState[id];
      s.month += dir;
      if (s.month > 11) { s.month = 0; s.year++; }
      if (s.month < 0) { s.month = 11; s.year--; }
      renderCal(id);
    }
    function pickDate(id, val) {
      var s = dpickState[id];
      document.getElementById(s.inputId).value = val;
      document.getElementById(id).querySelector('.dpick-trigger').textContent = val;
      document.getElementById(id + '-cal').classList.remove('open');
      // Trigger appropriate update
      if (s.inputId === 'date-start' || s.inputId === 'date-end') updateFilters();
      if (s.inputId === 'modal-date-start' || s.inputId === 'modal-date-end') { if (typeof updateFromModal === 'function') updateFromModal(); }
    }
    function fmt(d) {
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.dpick')) {
        document.querySelectorAll('.dpick-cal.open').forEach(function(c) { c.classList.remove('open'); });
      }
    });

    var currentView = new URLSearchParams(window.location.search).get('view') || 'cards';
    var chartsLoaded = false;
    function setView(view) {
      currentView = view;
      var cardGrid = document.querySelector('.ad-grid');
      var tableView = document.getElementById('table-view');
      var chartsView = document.getElementById('charts-view');
      var btnCards = document.getElementById('btn-cards');
      var btnTable = document.getElementById('btn-table');
      var btnCharts = document.getElementById('btn-charts');
      if (cardGrid) cardGrid.style.display = 'none';
      if (tableView) tableView.style.display = 'none';
      if (chartsView) chartsView.style.display = 'none';
      if (btnCards) btnCards.classList.remove('active');
      if (btnTable) btnTable.classList.remove('active');
      if (btnCharts) btnCharts.classList.remove('active');
      if (view === 'table') {
        if (tableView) tableView.style.display = 'block';
        if (btnTable) btnTable.classList.add('active');
      } else if (view === 'charts') {
        if (chartsView) chartsView.style.display = 'block';
        if (btnCharts) btnCharts.classList.add('active');
        if (!chartsLoaded) loadCharts();
      } else {
        if (cardGrid) cardGrid.style.display = '';
        if (btnCards) btnCards.classList.add('active');
      }
    }
    if (currentView === 'table') setView('table');
    else if (currentView === 'charts') setView('charts');

    async function refreshData() {
      var btn = document.getElementById('refresh-btn');
      if (btn) { btn.classList.add('loading'); btn.textContent = '\\u21BB Syncing from Meta...'; }
      try {
        var resp = await fetch('/api/ads/refresh?days=3&wait=1');
        var result = await resp.json();
        if (result.ok) {
          if (btn) btn.textContent = '\\u21BB Synced ' + (result.rows || 0) + ' rows';
          setTimeout(function() { window.location.reload(); }, 500);
        } else {
          if (btn) { btn.classList.remove('loading'); btn.textContent = '\\u21BB ' + (result.message || 'Error'); }
        }
      } catch(e) {
        if (btn) { btn.classList.remove('loading'); btn.textContent = '\\u21BB Refresh'; }
      }
    }

    var portalExtraParams = '${extraParams}';
    function updateFilters() {
      var accountEl = document.getElementById('account-select');
      var startEl = document.getElementById('date-start');
      var endEl = document.getElementById('date-end');
      var sortEl = document.getElementById('sort-select');
      if (!startEl || !endEl || !sortEl) return;

      var url = '/api/ads/dashboard?';
      if (accountEl && accountEl.value) url += 'account=' + encodeURIComponent(accountEl.value) + '&';
      url += 'start=' + startEl.value + '&end=' + endEl.value + '&sort=' + sortEl.value;
      if (currentView !== 'cards') url += '&view=' + currentView;
      if (portalExtraParams) url += portalExtraParams;
      window.location.href = url;
    }

    var modalLoading = false;
    async function updateFromModal() {
      if (modalLoading) return;
      var startEl = document.getElementById('modal-date-start');
      var endEl = document.getElementById('modal-date-end');
      if (!startEl || !endEl) return;

      var newStart = startEl.value;
      var newEnd = endEl.value;
      if (!newStart || !newEnd) return;

      modalLoading = true;

      try {
        var accountEl = document.getElementById('account-select');
        var apiUrl = '/api/ads/full?start=' + newStart + '&end=' + newEnd;
        if (accountEl && accountEl.value) apiUrl += '&account=' + encodeURIComponent(accountEl.value);
        if (portalExtraParams) apiUrl += portalExtraParams;

        var response = await fetch(apiUrl);
        var data = await response.json();

        if (data.ads && data.ads.length > 0) {
          currentDateStart = newStart;
          currentDateEnd = newEnd;

          var currentAdId = adsData[currentAdIndex] ? adsData[currentAdIndex].ad_id : null;
          adsData = data.ads;

          adsData.forEach(function(ad) {
            ad.ctr = ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
            ad.link_clicks_ctr = ad.impressions > 0 ? (ad.link_clicks / ad.impressions) * 100 : 0;
            ad.cpc = ad.clicks > 0 ? ad.spend / ad.clicks : 0;
            ad.cost_per_link_click = ad.link_clicks > 0 ? ad.spend / ad.link_clicks : 0;
            ad.outbound_clicks = ad.link_clicks;
            ad.ctr_outbound = ad.link_clicks_ctr;
            ad.cpc_outbound = ad.cost_per_link_click;
            ad.cpm = ad.impressions > 0 ? (ad.spend / ad.impressions) * 1000 : 0;
            ad.hookScore = ad.hook_rate > 50 ? 'green' : ad.hook_rate > 25 ? 'yellow' : 'red';
            ad.clickScore = ad.ctr > 2 ? 'green' : ad.ctr > 1 ? 'yellow' : 'red';
            ad.conversionScore = ad.leads > 0 ? (ad.cpl < 15 ? 'green' : ad.cpl < 30 ? 'yellow' : 'red') : 'none';
            ad.landing_page_views = ad.link_clicks || 0;
            if (!ad.engagementScoreRating) {
              ad.engagementScoreRating = (ad.engagementScore || 0) > 0.5 ? 'green' : (ad.engagementScore || 0) > 0.2 ? 'yellow' : 'red';
            }
          });
          refreshAdIntentMap();

          var newIndex = 0;
          if (currentAdId) {
            for (var i = 0; i < adsData.length; i++) {
              if (adsData[i].ad_id === currentAdId) { newIndex = i; break; }
            }
          }

          var select = document.getElementById('modal-ad-select');
          if (select) {
            select.innerHTML = adsData.map(function(a, i) {
              return '<option value="' + i + '">' + (a.ad_name || '').replace(/</g, '&lt;') + '</option>';
            }).join('');
            select.value = newIndex;
          }

          currentAdIndex = newIndex;
          populateModal(newIndex);
        }
      } catch (err) {
        console.error('Failed to fetch modal data:', err);
        if (spendEl) spendEl.textContent = 'Error loading data';
      }
      modalLoading = false;
    }

    function setPreset(days) {
      var end = new Date();
      var start = new Date();
      start.setDate(end.getDate() - Math.max(days - 1, 0));
      document.getElementById('date-start').value = start.toISOString().split('T')[0];
      document.getElementById('date-end').value = end.toISOString().split('T')[0];
      document.querySelectorAll('.date-preset').forEach(function(btn) { btn.classList.remove('active'); });
      event.target.classList.add('active');
      updateFilters();
    }

    (function() {
      var start = new Date(currentDateStart);
      var end = new Date(currentDateEnd);
      var dayCount = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
      var today = new Date().toISOString().split('T')[0];
      if (currentDateEnd === today) {
        document.querySelectorAll('.date-preset').forEach(function(btn) {
          if (parseInt(btn.textContent) === dayCount) btn.classList.add('active');
        });
      }
    })();

    function jumpToAd(index) {
      if (index === '') return;
      openAdModal(parseInt(index));
      document.getElementById('ad-jump-select').value = '';
    }

    function getScoreColor(score) {
      if (score === 'green') return 'var(--status-completed)';
      if (score === 'yellow') return 'var(--status-active)';
      if (score === 'red') return 'var(--status-overdue)';
      return '#555';
    }

    function escText(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function hasLeadIntentNameJS(a) {
      var text = ((a.campaign_name || '') + ' ' + (a.ad_name || '')).toLowerCase();
      return /(webinar|register|registration|lead|book|booking|consult|consultation|demo|application|apply|quote|estimate|appointment|strategy call|discovery)/.test(text);
    }

    function hasPurchaseIntentNameJS(a) {
      var text = ((a.campaign_name || '') + ' ' + (a.ad_name || '')).toLowerCase();
      return /(purchase|checkout|order|cart|buy|sale|shop|ecom|e-commerce|product)/.test(text);
    }

    function hasLeadIntentEventJS(a) {
      var event = (a.conversionEvent || '').toLowerCase();
      return /(lead|complete_registration|registration|submit_application|schedule|contact|subscribe|start_trial|book)/.test(event);
    }

    function hasPurchaseIntentEventJS(a) {
      var event = (a.conversionEvent || '').toLowerCase();
      return /(purchase|checkout|add_to_cart|initiate_checkout|add_payment_info)/.test(event);
    }

    function getOptimizationIntentJS(a) {
      var goal = (a.optimizationGoal || '').toLowerCase();
      var hasGoal = goal.length > 0;
      var leadNameHint = hasLeadIntentNameJS(a);
      var purchaseNameHint = hasPurchaseIntentNameJS(a);
      var leadEventHint = hasLeadIntentEventJS(a);
      var purchaseEventHint = hasPurchaseIntentEventJS(a);
      var isLeadGoal = goal.includes('lead') || goal.includes('quality_lead') || goal.includes('contact');
      var isPurchaseGoal = goal.includes('purchase') || goal.includes('value');
      var isVideoGoal = goal.includes('thruplay') || goal.includes('video_view');
      var isEngagementGoal = goal.includes('engagement') || goal.includes('post_engagement') || goal.includes('page_like') || goal.includes('event_response');
      var isReachGoal = goal.includes('reach') || goal.includes('brand_awareness') || goal.includes('impressions');
      var isConversationGoal = goal.includes('conversation') || goal.includes('messaging');
      var isClickGoal = goal.includes('link_click') || goal.includes('landing_page') || goal.includes('store_visit') || goal.includes('app_install') || goal.includes('app_events');
      var isOffsiteGoal = goal.includes('offsite_conv');

      if (leadEventHint && !purchaseEventHint) return 'lead';
      if (purchaseEventHint && !leadEventHint) return 'purchase';
      if (leadNameHint && !purchaseNameHint) return 'lead';
      if (isLeadGoal) return 'lead';
      if (isOffsiteGoal) {
        if (leadNameHint && !purchaseNameHint) return 'lead';
        if ((a.leads || 0) > 0 && (a.leads || 0) >= (a.purchases || 0)) return 'lead';
        if ((a.purchases || 0) > 0 || (a.purchase_value || 0) > 0 || isPurchaseGoal) return 'purchase';
        return 'click';
      }
      if (isPurchaseGoal) return 'purchase';
      if (isVideoGoal) return 'video';
      if (isEngagementGoal) return 'engagement';
      if (isReachGoal) return 'reach';
      if (isConversationGoal) return 'conversation';
      if (isClickGoal) return 'click';

      if (!hasGoal) {
        if ((a.leads || 0) > 0) return 'lead';
        if ((a.purchases || 0) > 0 || (a.purchase_value || 0) > 0) return 'purchase';
        if ((a.video_thruplay || 0) > 50 && (a.link_clicks || 0) < 20) return 'video';
        var eng = (a.reactions || 0) + (a.comments || 0) + (a.shares || 0);
        if (eng > 0 && (a.link_clicks || 0) === 0) return 'engagement';
      }
      return 'click';
    }

    function getPrimaryConvJS(a) {
      var intent = getOptimizationIntentJS(a);
      var cur = 'CA$';

      if (intent === 'lead') {
        var lScore = (a.leads || 0) === 0 ? 'none' : (a.cpl < 50 ? 'green' : a.cpl < 100 ? 'yellow' : 'red');
        return {
          label: 'Leads',
          val: (a.leads || 0) > 0 ? (a.leads || 0).toLocaleString() + ' leads' : '0 leads',
          costLabel: 'CPL',
          costVal: (a.leads || 0) > 0 ? cur + a.cpl.toFixed(2) : '—',
          barW: (a.leads || 0) > 0 ? Math.min(50 + (50 / (a.cpl / 20)), 100) : 0,
          score: lScore
        };
      }

      if (intent === 'purchase') {
        if ((a.purchases || 0) > 0 || (a.purchase_value || 0) > 0) {
          var roas = a.spend > 0 ? ((a.purchase_value || 0) / a.spend) : 0;
          var cpa = (a.purchases || 0) > 0 ? (a.spend / a.purchases) : 0;
          var roasStr = roas > 0 ? roas.toFixed(2) + 'x' : '—';
          var roasScore = roas === 0 ? 'none' : roas >= 3 ? 'green' : roas >= 1.5 ? 'yellow' : 'red';
          return {
            label: 'Purchases',
            val: (a.purchases || 0) > 0 ? a.purchases + ' · ' + roasStr + ' ROAS' : '—',
            costLabel: 'CPA',
            costVal: cpa > 0 ? cur + cpa.toFixed(2) : '—',
            barW: Math.min(roas * 25, 100),
            score: roasScore
          };
        }
        var clickScorePurch = (a.link_clicks || 0) === 0 ? 'none' : (a.cpc < 2 ? 'green' : a.cpc < 5 ? 'yellow' : 'red');
        return {
          label: 'Link Clicks',
          val: (a.link_clicks || 0) > 0 ? (a.link_clicks || 0).toLocaleString() : '—',
          costLabel: 'CPC',
          costVal: a.cpc > 0 ? cur + a.cpc.toFixed(2) : '—',
          barW: Math.min((a.ctr || 0) * 20, 100),
          score: clickScorePurch
        };
      }

      if (intent === 'video') {
        var cpv = (a.video_thruplay || 0) > 0 ? a.spend / a.video_thruplay : 0;
        return {
          label: 'Thruplays',
          val: (a.video_thruplay || 0) > 0 ? (a.video_thruplay || 0).toLocaleString() : '—',
          costLabel: 'CPV',
          costVal: cpv > 0 ? cur + cpv.toFixed(3) : '—',
          barW: Math.min(((a.video_thruplay || 0) / Math.max((a.impressions || 0) * 0.1, 1)) * 100, 100),
          score: 'none'
        };
      }

      if (intent === 'engagement') {
        var engV = (a.reactions || 0) + (a.comments || 0) + (a.shares || 0);
        var cpe = engV > 0 ? a.spend / engV : 0;
        return {
          label: 'Engagements',
          val: engV > 0 ? engV.toLocaleString() : '—',
          costLabel: 'CPE',
          costVal: cpe > 0 ? cur + cpe.toFixed(2) : '—',
          barW: Math.min(engV / 10, 100),
          score: 'none'
        };
      }

      if (intent === 'reach') {
        return {
          label: 'Reach',
          val: (a.reach || 0) > 0 ? (a.reach || 0).toLocaleString() : '—',
          costLabel: 'CPM',
          costVal: (a.cpm || 0) > 0 ? cur + (a.cpm || 0).toFixed(2) : '—',
          barW: Math.min(((a.reach || 0) / Math.max(a.impressions || 1, 1)) * 100, 100),
          score: 'none'
        };
      }

      if (intent === 'conversation') {
        return {
          label: 'Conversations',
          val: '—',
          costLabel: 'CPM',
          costVal: (a.cpm || 0) > 0 ? cur + (a.cpm || 0).toFixed(2) : '—',
          barW: 0,
          score: 'none'
        };
      }

      var clickScore = (a.link_clicks || 0) === 0 ? 'none' : (a.cpc < 1 ? 'green' : a.cpc < 3 ? 'yellow' : 'red');
      return {
        label: 'Link Clicks',
        val: (a.link_clicks || 0) > 0 ? (a.link_clicks || 0).toLocaleString() : '—',
        costLabel: 'CPC',
        costVal: a.cpc > 0 ? cur + a.cpc.toFixed(2) : '—',
        barW: Math.min((a.ctr || 0) * 20, 100),
        score: clickScore
      };
    }

    function getCardScoreRowsJS(a) {
      var pc = getPrimaryConvJS(a);
      var intent = getOptimizationIntentJS(a);
      var engagementRow = {
        label: 'Engage',
        value: (a.engagementScore || 0) > 0 ? a.engagementScore.toFixed(2) + '%' : '—',
        barW: Math.min((a.engagementScore || 0) * 100, 100),
        score: (a.engagementScore || 0) > 0 ? a.engagementScoreRating : 'none'
      };
      var holdRow = {
        label: 'Hold',
        value: (a.hold_rate || 0) > 0 ? a.hold_rate.toFixed(1) + '%' : '—',
        barW: Math.min((a.hold_rate || 0) * 2, 100),
        score: (a.video_views || 0) > 0 ? ((a.hold_rate || 0) >= 25 ? 'green' : (a.hold_rate || 0) >= 12 ? 'yellow' : 'red') : 'none'
      };
      var frequencyRow = {
        label: 'Freq',
        value: (a.frequency || 0) > 0 ? a.frequency.toFixed(2) : '—',
        barW: Math.min((a.frequency || 0) * 25, 100),
        score: (a.frequency || 0) > 0 ? ((a.frequency || 0) <= 2 ? 'green' : (a.frequency || 0) <= 3 ? 'yellow' : 'red') : 'none'
      };
      var tail = intent === 'video' ? holdRow : (intent === 'reach' ? frequencyRow : engagementRow);
      return [
        {
          label: 'Hook',
          value: (a.hook_rate || 0) > 0 ? a.hook_rate.toFixed(1) + '%' : '—',
          barW: Math.min((a.hook_rate || 0) * 2, 100),
          score: (a.hook_rate || 0) > 0 ? a.hookScore : 'none'
        },
        {
          label: 'Click',
          value: (a.ctr || 0) > 0 ? a.ctr.toFixed(2) + '%' : '—',
          barW: Math.min((a.ctr || 0) * 20, 100),
          score: (a.ctr || 0) > 0 ? a.clickScore : 'none'
        },
        { label: pc.label, value: pc.val, barW: pc.barW, score: pc.score },
        tail
      ];
    }

    function getCardMetricsJS(a) {
      var intent = getOptimizationIntentJS(a);
      var pc = getPrimaryConvJS(a);
      var eng = (a.reactions || 0) + (a.comments || 0) + (a.shares || 0);
      var roas = a.spend > 0 ? (a.purchase_value || 0) / a.spend : 0;

      if (intent === 'lead') {
        return [
          { label: 'CPL', value: (a.leads || 0) > 0 ? '$' + a.cpl.toFixed(2) : '—' },
          { label: 'Leads', value: (a.leads || 0) > 0 ? (a.leads || 0).toLocaleString() : '0' },
          { label: 'Impr', value: (a.impressions || 0).toLocaleString() },
          { label: 'Link', value: (a.link_clicks || 0).toLocaleString() }
        ];
      }

      if (intent === 'purchase') {
        return [
          { label: pc.costLabel, value: pc.costVal },
          { label: 'ROAS', value: roas > 0 ? roas.toFixed(2) + 'x' : '—' },
          { label: 'Impr', value: (a.impressions || 0).toLocaleString() },
          { label: 'Purch', value: (a.purchases || 0) > 0 ? (a.purchases || 0).toLocaleString() : '—' }
        ];
      }

      if (intent === 'video') {
        var cpv = (a.video_thruplay || 0) > 0 ? (a.spend / a.video_thruplay) : 0;
        return [
          { label: 'CPV', value: cpv > 0 ? '$' + cpv.toFixed(3) : '—' },
          { label: 'Thru', value: (a.video_thruplay || 0) > 0 ? (a.video_thruplay || 0).toLocaleString() : '—' },
          { label: 'Hook', value: (a.hook_rate || 0) > 0 ? a.hook_rate.toFixed(1) + '%' : '—' },
          { label: 'Hold', value: (a.hold_rate || 0) > 0 ? a.hold_rate.toFixed(1) + '%' : '—' }
        ];
      }

      if (intent === 'engagement') {
        var cpe = eng > 0 ? a.spend / eng : 0;
        return [
          { label: 'CPE', value: cpe > 0 ? '$' + cpe.toFixed(2) : '—' },
          { label: 'Engage', value: eng > 0 ? eng.toLocaleString() : '—' },
          { label: 'Impr', value: (a.impressions || 0).toLocaleString() },
          { label: 'Link', value: (a.link_clicks || 0).toLocaleString() }
        ];
      }

      if (intent === 'reach') {
        return [
          { label: 'CPM', value: (a.cpm || 0) > 0 ? '$' + (a.cpm || 0).toFixed(2) : '—' },
          { label: 'Reach', value: (a.reach || 0) > 0 ? (a.reach || 0).toLocaleString() : '—' },
          { label: 'Freq', value: (a.frequency || 0) > 0 ? (a.frequency || 0).toFixed(2) : '—' },
          { label: 'Impr', value: (a.impressions || 0).toLocaleString() }
        ];
      }

      if (intent === 'conversation') {
        return [
          { label: 'CPM', value: (a.cpm || 0) > 0 ? '$' + (a.cpm || 0).toFixed(2) : '—' },
          { label: 'CPC', value: (a.cpc || 0) > 0 ? '$' + (a.cpc || 0).toFixed(2) : '—' },
          { label: 'Impr', value: (a.impressions || 0).toLocaleString() },
          { label: 'Clicks', value: (a.link_clicks || 0).toLocaleString() }
        ];
      }

      return [
        { label: 'CPC', value: (a.cpc || 0) > 0 ? '$' + (a.cpc || 0).toFixed(2) : '—' },
        { label: 'Link', value: (a.link_clicks || 0).toLocaleString() },
        { label: 'CTR', value: (a.link_clicks_ctr || 0) > 0 ? (a.link_clicks_ctr || 0).toFixed(2) + '%' : '—' },
        { label: 'Impr', value: (a.impressions || 0).toLocaleString() }
      ];
    }

    function renderCardDynamicStats(card, ad) {
      if (!card || !ad) return;

      var scoresContainer = card.querySelector('.scores');
      if (scoresContainer) {
        var rows = getCardScoreRowsJS(ad);
        scoresContainer.innerHTML = rows.map(function(row) {
          return '<div class="score-row">' +
            '<span class="score-label">' + escText(row.label) + '</span>' +
            '<div class="score-bar"><div class="score-fill" style="width:' + row.barW + '%;background:' + getScoreColor(row.score) + ';"></div></div>' +
            '<span class="score-value">' + escText(row.value) + '</span>' +
          '</div>';
        }).join('');
      }

      var metricsContainer = card.querySelector('.metrics');
      if (metricsContainer) {
        var metrics = getCardMetricsJS(ad);
        metricsContainer.innerHTML = metrics.map(function(m) {
          return '<div class="metric">' +
            '<span class="metric-label">' + escText(m.label) + ' </span>' +
            '<span class="metric-value">' + escText(m.value) + '</span>' +
          '</div>';
        }).join('');
      }
    }

    function getDateRange() {
      var startDate = new Date(currentDateStart);
      var endDate = new Date(currentDateEnd);
      var diff = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return months[startDate.getMonth()] + ' ' + startDate.getDate() + ' - ' +
             months[endDate.getMonth()] + ' ' + endDate.getDate() + ' (' + diff + ' days)';
    }

    function toggleSection(sectionName) {
      var section = document.getElementById('section-' + sectionName);
      if (section) {
        section.classList.toggle('collapsed');
      }
    }

    function loadVideoByAdId(adId) {
      var mediaDiv = document.querySelector('.ad-preview-media');
      if (!mediaDiv) return;
      mediaDiv.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">Loading preview...</div>';
      // Use Meta Ad Preview API -- works for ALL ad types including dynamic/catalog ads
      loadAdPreview(adId, mediaDiv);
    }

    function loadAdPreview(adId, container) {
      fetch('/api/ads/preview/' + adId + (portalExtraParams ? '?' + portalExtraParams.replace(/^&/, '') : '')).then(function(r) {
        if (r.ok) return r.json(); else throw new Error('no preview');
      }).then(function(data) {
        if (data.iframeUrl) {
          var iframe = document.createElement('iframe');
          iframe.src = data.iframeUrl;
          iframe.allowFullscreen = true;
          iframe.allow = 'autoplay; encrypted-media';
          container.innerHTML = '';
          container.appendChild(iframe);
        } else { throw new Error('no url'); }
      }).catch(function() {
        container.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;"><div style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">Preview not available</div><a href="https://www.facebook.com/ads/library/?id=' + adId + '" target="_blank" style="display:inline-block;background:var(--accent);color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;">View in Ad Library ↗</a></div>';
      });
    }

    function loadVideo(videoId) {
      var mediaDiv = document.querySelector('.ad-preview-media');
      if (!mediaDiv) return;
      fetch('/api/ads/video/' + videoId).then(function(r) {
        if (r.ok) return r.json(); else throw new Error('no video');
      }).then(function(data) {
        if (data.type === 'direct' && data.url) {
          mediaDiv.innerHTML = '<video src="' + data.url + '" controls autoplay playsinline style="width:100%;max-height:70vh;display:block;background:#000;border-radius:4px;"></video>';
        } else if (data.type === 'embed' && data.url) {
          mediaDiv.innerHTML = '<iframe src="' + data.url + '" style="width:100%;aspect-ratio:9/16;max-height:70vh;border:none;background:#000;border-radius:4px;" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>';
        } else { throw new Error('no url'); }
      }).catch(function() {
        var embedUrl = 'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D' + videoId + '&width=500&show_text=false';
        mediaDiv.innerHTML = '<iframe src="' + embedUrl + '" style="width:100%;aspect-ratio:9/16;max-height:70vh;border:none;background:#000;border-radius:4px;" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>';
      });
    }

    function openAdModal(index) {
      currentAdIndex = index;
      var modal = document.getElementById('ad-modal');
      var select = document.getElementById('modal-ad-select');
      if (modal && select) {
        select.value = index;
        populateModal(index);
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
      }
    }

    function closeAdModal() {
      var modal = document.getElementById('ad-modal');
      if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
        var video = document.querySelector('#modal-media-container video');
        if (video) video.pause();
      }
    }

    function switchAd(index) {
      currentAdIndex = parseInt(index);
      populateModal(currentAdIndex);
    }

    function populateModal(index) {
      var ad = adsData[index];
      if (!ad) return;

      var statusDot = document.getElementById('modal-status-dot');
      var statusText = document.getElementById('modal-status-text');
      var status = (ad.effectiveStatus || '').toLowerCase();
      statusDot.className = 'status-dot status-' + (status === 'active' ? 'active' : status === 'paused' ? 'paused' : 'other');
      statusText.textContent = ad.effectiveStatus || 'Unknown';

      // ID now lives in dimensions panel only

      var mds = document.getElementById('modal-date-start');
      var mde = document.getElementById('modal-date-end');
      if (mds) mds.value = currentDateStart;
      if (mde) mde.value = currentDateEnd;

      var mediaContainer = document.getElementById('modal-media-container');
      var thumbSrc = ad.thumbnailUrl || ad.imageUrl || '';
      var linkDomain = '';
      if (ad.linkUrl) {
        try { linkDomain = new URL(ad.linkUrl).hostname.replace('www.', '').replace('l.facebook.com', 'fb.me'); } catch(e) { linkDomain = ad.linkUrl; }
      }
      var ctaLabel = (ad.ctaType || '').replace(/_/g, ' ').toLowerCase().replace(/\\b\\w/g, function(c) { return c.toUpperCase(); });
      var displayTitle = (ad.title || '').trim();
      if (!displayTitle && ad.titleVariations && ad.titleVariations.length > 0) displayTitle = ad.titleVariations[0];
      var displayBody = (ad.body || '').trim();
      if (!displayBody && ad.bodyVariations && ad.bodyVariations.length > 0) displayBody = ad.bodyVariations[0];

      mediaContainer.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">Loading preview...</div>';
      loadAdPreview(ad.ad_id, mediaContainer);

      // === DIMENSIONS PANEL ===
      var dimHtml = '';
      dimHtml += '<div class="dim-section-header" onclick="toggleSection(\\'dimensions\\')"><span class="dim-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Meta</span><span class="dim-section-toggle">&#9660;</span></div>';
      dimHtml += '<div id="section-dimensions">';
      var adStatus = (ad.effectiveStatus || 'Unknown');
      var statusColor = status === 'active' ? 'var(--status-completed)' : status === 'paused' ? 'var(--status-active)' : 'var(--text-dim)';
      dimHtml += '<div class="dim-row"><span class="dim-row-label">Ad status</span><span class="dim-row-value"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusColor + ';margin-right:6px;"></span>' + adStatus + '</span></div>';
      dimHtml += '<div class="dim-row"><span class="dim-row-label">Optimization goal</span><span class="dim-row-value">' + (ad.optimizationGoal || '-').toLowerCase() + '</span></div>';
      if (ad.conversionEvent) dimHtml += '<div class="dim-row"><span class="dim-row-label">Conversion event</span><span class="dim-row-value">' + String(ad.conversionEvent).toLowerCase() + '</span></div>';
      if (ad.endDate) dimHtml += '<div class="dim-row"><span class="dim-row-label">End date</span><span class="dim-row-value">' + String(ad.endDate).split('T')[0] + '</span></div>';
      dimHtml += '<div class="dim-row"><span class="dim-row-label">Ad</span><div class="dim-row-value">' + ad.ad_name + '<span class="dim-sub">ID ' + ad.ad_id + '</span></div></div>';
      dimHtml += '<div class="dim-row"><span class="dim-row-label">Adset</span><span class="dim-row-value">' + (ad.adsetName || '-') + '</span></div>';
      dimHtml += '<div class="dim-row"><span class="dim-row-label">Campaign</span><span class="dim-row-value">' + ad.campaign_name + '</span></div>';
      if (linkDomain) dimHtml += '<div class="dim-row"><span class="dim-row-label">Landing page</span><span class="dim-row-value">' + linkDomain + '</span></div>';
      dimHtml += '<div class="dim-row"><span class="dim-row-label">Account</span><span class="dim-row-value">' + ad.account_name + '</span></div>';
      var adType = ad.videoId ? 'Video' : (ad.objectType === 'SHARE' ? 'Image' : (ad.objectType || 'Unknown'));
      dimHtml += '<div class="dim-row"><span class="dim-row-label">Ad type</span><span class="dim-row-value">' + adType + '</span></div>';
      if (ctaLabel) dimHtml += '<div class="dim-row"><span class="dim-row-label">Call to action</span><span class="dim-row-value">' + ctaLabel + '</span></div>';
      dimHtml += '</div>';
      document.getElementById('modal-dimensions').innerHTML = dimHtml;

      // === PRIMARY CONVERSION (dynamic by goal) ===
      var pc = getPrimaryConvJS(ad);

      // === HERO STATS ===
      var heroHtml = '';
      heroHtml += '<div class="modal-hero-item"><span class="modal-hero-val">CA$' + ad.spend.toFixed(2) + '</span><span class="modal-hero-lbl">Spent</span></div>';
      heroHtml += '<div class="modal-hero-item"><span class="modal-hero-val">' + pc.val + '</span><span class="modal-hero-lbl">' + pc.label + '</span></div>';
      heroHtml += '<div class="modal-hero-item"><span class="modal-hero-val">' + pc.costVal + '</span><span class="modal-hero-lbl">' + pc.costLabel + '</span></div>';
      heroHtml += '<div class="modal-hero-item"><span class="modal-hero-val">' + (ad.hook_rate > 0 ? ad.hook_rate.toFixed(1) + '%' : '—') + '</span><span class="modal-hero-lbl">Hook</span></div>';
      document.getElementById('modal-hero-stats').innerHTML = heroHtml;

      // === CTRL SCORES ===
      function scoreBar(width, color, val) {
        var isEmpty = width === 0;
        return '<div class="modal-score-bar"><div class="modal-score-fill" style="width:' + (isEmpty ? 0 : width) + '%;background:' + color + ';"></div></div><span class="modal-score-value">' + (isEmpty ? '—' : val) + '</span>';
      }
      function getScoreColor(s) { return s === 'green' ? 'var(--status-completed)' : s === 'yellow' ? 'var(--status-active)' : s === 'red' ? 'var(--status-overdue)' : 'var(--text-dim)'; }
      var scoresHtml = '';
      scoresHtml += '<div class="modal-score-row"><span class="modal-score-label">Hook Rate</span>' + scoreBar(Math.min(ad.hook_rate * 2, 100), getScoreColor(ad.hookScore), ad.hook_rate.toFixed(1) + '%') + '</div>';
      scoresHtml += '<div class="modal-score-row"><span class="modal-score-label">Click Rate</span>' + scoreBar(Math.min(ad.ctr * 20, 100), getScoreColor(ad.clickScore), ad.ctr.toFixed(2) + '%') + '</div>';
      scoresHtml += '<div class="modal-score-row"><span class="modal-score-label">' + pc.label + '</span>' + scoreBar(pc.barW, getScoreColor(pc.score), pc.val) + '</div>';
      scoresHtml += '<div class="modal-score-row"><span class="modal-score-label">Engagement</span>' + scoreBar(Math.min(ad.engagementScore * 100, 100), getScoreColor(ad.engagementScoreRating), ad.engagementScore.toFixed(2) + '%') + '</div>';
      document.getElementById('modal-scores').innerHTML = scoresHtml;

      var s = '';
      function mr(label, value) { return '<div class="metric-row"><span class="metric-row-label">' + label + '</span><span class="metric-row-value">' + value + '</span></div>'; }

      // Performance
      s += '<div class="metric-section" id="section-performance">';
      s += '<div class="metric-section-header" onclick="toggleSection(\\'performance\\')"><span class="metric-section-title">Performance</span><span class="metric-section-toggle">&#9660;</span></div>';
      s += '<div class="metric-section-content">';
      s += mr('Impressions', ad.impressions.toLocaleString());
      s += mr('Reach', (ad.reach || 0).toLocaleString());
      s += mr('Frequency', (ad.frequency || 0).toFixed(2));
      s += mr('Clicks', ad.clicks.toLocaleString());
      s += mr('Link Clicks', ad.link_clicks.toLocaleString());
      s += mr('Outbound Clicks', (ad.outbound_clicks || 0).toLocaleString());
      s += mr('CTR', ad.ctr.toFixed(2) + '%');
      s += mr('Outbound CTR', (ad.link_clicks_ctr || 0).toFixed(2) + '%');
      s += mr('CPC', 'CA$' + ad.cpc.toFixed(3));
      s += mr('Outbound CPC', (ad.cost_per_link_click || 0) > 0 ? 'CA$' + (ad.cost_per_link_click).toFixed(2) : '-');
      s += mr('CPM', 'CA$' + (ad.cpm || 0).toFixed(2));
      s += mr('Hold Rate', (ad.hold_rate || 0).toFixed(2) + '%');
      s += '</div></div>';

      // Video
      s += '<div class="metric-section collapsed" id="section-video">';
      s += '<div class="metric-section-header" onclick="toggleSection(\\'video\\')"><span class="metric-section-title">Video</span><span class="metric-section-toggle">&#9654;</span></div>';
      s += '<div class="metric-section-content">';
      s += mr('3 second video views', (ad.video_views || 0).toLocaleString());
      s += mr('Thruplay', (ad.video_thruplay || 0).toLocaleString());
      s += mr('Video 25% Watched', (ad.video_p25 || 0).toLocaleString());
      s += mr('Video 50% Watched', (ad.video_p50 || 0).toLocaleString());
      s += mr('Video 75% Watched', (ad.video_p75 || 0).toLocaleString());
      s += mr('Video 95% Watched', (ad.video_p95 || 0).toLocaleString());
      s += mr('Video 100% Watched', (ad.video_p100 || 0).toLocaleString());
      s += '</div></div>';

      // Engagement
      var pageEng = (ad.reactions || 0) + (ad.comments || 0) + (ad.shares || 0);
      var costPerEng = pageEng > 0 ? (ad.spend / pageEng).toFixed(3) : '0';
      var engCVR = ad.impressions > 0 ? ((pageEng / ad.impressions) * 100).toFixed(2) : '0';
      var costPerReaction = (ad.reactions || 0) > 0 ? (ad.spend / ad.reactions).toFixed(2) : '0';
      var reactionCVR = ad.impressions > 0 ? (((ad.reactions || 0) / ad.impressions) * 100).toFixed(2) : '0';
      var costPerShare = (ad.shares || 0) > 0 ? (ad.spend / ad.shares).toFixed(2) : '0';

      s += '<div class="metric-section collapsed" id="section-engagement">';
      s += '<div class="metric-section-header" onclick="toggleSection(\\'engagement\\')"><span class="metric-section-title">Engagement</span><span class="metric-section-toggle">&#9654;</span></div>';
      s += '<div class="metric-section-content">';
      s += mr('Total Engagement', pageEng.toLocaleString());
      s += mr('Cost Per Engagement', pageEng > 0 ? 'CA$' + costPerEng : '-');
      s += mr('Engagement Rate', engCVR + '%');
      s += mr('Reactions', (ad.reactions || 0).toLocaleString());
      s += mr('Cost Per Reaction', (ad.reactions || 0) > 0 ? 'CA$' + costPerReaction : '-');
      s += mr('Comments', (ad.comments || 0).toLocaleString());
      s += mr('Shares', (ad.shares || 0).toLocaleString());
      s += mr('Cost Per Share', (ad.shares || 0) > 0 ? 'CA$' + costPerShare : '-');
      s += mr('Saves', (ad.saves || 0).toLocaleString());
      s += '</div></div>';

      // Conversion
      var lpViews = ad.landing_page_views || ad.link_clicks || 0;
      var costPerLP = lpViews > 0 ? (ad.spend / lpViews).toFixed(2) : '-';
      var lpCVR = ad.impressions > 0 ? ((lpViews / ad.impressions) * 100).toFixed(2) : '0';
      var lpClickToLeadCVR = lpViews > 0 ? ((ad.leads / lpViews) * 100).toFixed(2) : '0';
      var leadsCVR = ad.impressions > 0 ? ((ad.leads / ad.impressions) * 100).toFixed(2) : '0';
      var costPerLead = ad.leads > 0 ? (ad.spend / ad.leads).toFixed(2) : '-';
      var clickToLeadCVR = ad.clicks > 0 ? ((ad.leads / ad.clicks) * 100).toFixed(2) : '0';

      s += '<div class="metric-section collapsed" id="section-conversion">';
      s += '<div class="metric-section-header" onclick="toggleSection(\\'conversion\\')"><span class="metric-section-title">Conversion</span><span class="metric-section-toggle">&#9654;</span></div>';
      s += '<div class="metric-section-content">';
      s += mr('Leads', ad.leads.toLocaleString());
      s += mr('Cost Per Lead', costPerLead === '-' ? '-' : 'CA$' + costPerLead);
      s += mr('Lead Conversion Rate', leadsCVR + '%');
      s += mr('Click-to-Lead Rate', clickToLeadCVR + '%');
      s += mr('Landing Page Views', lpViews.toLocaleString());
      s += mr('Cost Per Landing Page View', costPerLP === '-' ? '-' : 'CA$' + costPerLP);
      s += mr('LP View Rate', lpCVR + '%');
      s += mr('LP-to-Lead Rate', lpClickToLeadCVR + '%');
      s += '</div></div>';

      // Variations
      var hasVariations = (ad.bodyVariations && ad.bodyVariations.length > 0) || (ad.titleVariations && ad.titleVariations.length > 0);
      if (hasVariations) {
        s += '<div class="metric-section collapsed" id="section-variations">';
        s += '<div class="metric-section-header" onclick="toggleSection(\\'variations\\')"><span class="metric-section-title">Variations (' + ((ad.bodyVariations || []).length + (ad.titleVariations || []).length) + ')</span><span class="metric-section-toggle">&#9654;</span></div>';
        s += '<div class="metric-section-content">';
        if (ad.titleVariations && ad.titleVariations.length > 0) {
          s += '<div style="padding:12px 16px 4px;"><span style="font-size:11px;font-family:var(--font-mono);color:var(--accent);text-transform:uppercase;letter-spacing:1px;">Headlines</span></div>';
          for (var ti = 0; ti < ad.titleVariations.length; ti++) {
            s += '<div class="metric-row"><span class="metric-row-label" style="color:#fff;">' + (ti + 1) + '.</span><span class="metric-row-value" style="text-align:left;flex:1;margin-left:8px;white-space:normal;line-height:1.4;">' + ad.titleVariations[ti] + '</span></div>';
          }
        }
        if (ad.bodyVariations && ad.bodyVariations.length > 0) {
          s += '<div style="padding:12px 16px 4px;"><span style="font-size:11px;font-family:var(--font-mono);color:var(--accent);text-transform:uppercase;letter-spacing:1px;">Primary Text</span></div>';
          for (var bi = 0; bi < ad.bodyVariations.length; bi++) {
            s += '<div style="padding:10px 16px;border-top:1px solid var(--border);"><span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">Variation ' + (bi + 1) + '</span><div style="font-size:12px;color:var(--text);margin-top:6px;white-space:pre-wrap;line-height:1.5;">' + ad.bodyVariations[bi].split('\\n').join('<br>') + '</div></div>';
          }
        }
        s += '</div></div>';
      }

      document.getElementById('modal-sections').innerHTML = s;
    }

    // === CHARTS VIEW ===
    var chartRawRows = null;
    var chartPeriod = 'daily';
    var chartCampaignFilter = '';
    var chartAdFilter = '';

    var chartDateStart = '';
    var chartDateEnd = '';
    var adIntentById = {};
    var chartIntent = 'lead';
    var chartResultLabel = 'Leads';
    var chartCostLabel = 'CPL';

    function n(v) {
      var x = Number(v);
      return isFinite(x) ? x : 0;
    }

    function getIntentMeta(intent) {
      if (intent === 'purchase') return { resultLabel: 'Purchases', costLabel: 'CPA' };
      if (intent === 'video') return { resultLabel: 'Thruplays', costLabel: 'CPV' };
      if (intent === 'reach') return { resultLabel: 'Reach', costLabel: 'CPM' };
      if (intent === 'conversation') return { resultLabel: 'Conversations', costLabel: 'CPC' };
      if (intent === 'engagement') return { resultLabel: 'Engagements', costLabel: 'CPE' };
      if (intent === 'click') return { resultLabel: 'Link Clicks', costLabel: 'CPC' };
      return { resultLabel: 'Leads', costLabel: 'CPL' };
    }

    function refreshAdIntentMap() {
      adIntentById = {};
      if (!adsData || !adsData.length) return;
      for (var i = 0; i < adsData.length; i++) {
        var ad = adsData[i];
        if (!ad || !ad.ad_id) continue;
        adIntentById[ad.ad_id] = getOptimizationIntentJS(ad);
      }
    }

    function getIntentForRow(row) {
      var fromMap = adIntentById[row.ad_id];
      if (fromMap) return fromMap;
      if (n(row.leads) > 0) return 'lead';
      if (n(row.purchases) > 0 || n(row.purchase_value) > 0) return 'purchase';
      if (n(row.video_thruplay) > 50 && n(row.link_clicks) < 20) return 'video';
      return 'click';
    }

    function resolveChartIntent(rows) {
      var spendByIntent = { lead: 0, purchase: 0, video: 0, engagement: 0, reach: 0, conversation: 0, click: 0 };
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var intent = getIntentForRow(r);
        if (spendByIntent[intent] === undefined) spendByIntent[intent] = 0;
        spendByIntent[intent] += n(r.spend);
      }
      var bestIntent = 'lead';
      var bestSpend = -1;
      for (var k in spendByIntent) {
        if (spendByIntent[k] > bestSpend) {
          bestSpend = spendByIntent[k];
          bestIntent = k;
        }
      }
      chartIntent = bestIntent;
      var meta = getIntentMeta(chartIntent);
      chartResultLabel = meta.resultLabel;
      chartCostLabel = meta.costLabel;
    }

    function getResultValueByIntent(item, intent) {
      if (intent === 'purchase') return n(item.purchases);
      if (intent === 'video') return n(item.video_thruplay);
      if (intent === 'reach') return n(item.reach);
      if (intent === 'conversation' || intent === 'click') return n(item.link_clicks);
      if (intent === 'engagement') return n(item.link_clicks);
      return n(item.leads);
    }

    function getCostValueByIntent(item, intent) {
      if (intent === 'reach') {
        var impr = n(item.impressions);
        return impr > 0 ? (n(item.spend) / impr) * 1000 : 0;
      }
      var result = getResultValueByIntent(item, intent);
      return result > 0 ? n(item.spend) / result : 0;
    }

    function fmtResultValue(v) {
      var val = n(v);
      return val > 0 ? val.toLocaleString() : '0';
    }

    function normalizeDatePart(dateLike) {
      if (!dateLike) return null;
      var s = String(dateLike);
      if (!s) return null;
      return s.split('T')[0];
    }

    function resolveSelectionEndDate() {
      if (!adsData || !adsData.length) return null;

      if (chartAdFilter) {
        for (var i = 0; i < adsData.length; i++) {
          var ad = adsData[i];
          if (ad.ad_id === chartAdFilter) {
            return normalizeDatePart(ad.endDate);
          }
        }
        return null;
      }

      if (chartCampaignFilter) {
        var maxEnd = null;
        for (var j = 0; j < adsData.length; j++) {
          var cad = adsData[j];
          if (cad.campaign_id !== chartCampaignFilter) continue;
          var ed = normalizeDatePart(cad.endDate);
          if (!ed) continue;
          if (!maxEnd || ed > maxEnd) maxEnd = ed;
        }
        return maxEnd;
      }

      return null;
    }

    function stripEmptyCurrentDay(rows) {
      var today = new Date().toISOString().split('T')[0];
      return rows.filter(function(r) {
        if (!r || r.date !== today) return true;
        return n(r.spend) > 0
          || n(r.impressions) > 0
          || n(r.clicks) > 0
          || n(r.link_clicks) > 0
          || n(r.leads) > 0
          || n(r.purchases) > 0
          || n(r.video_views) > 0
          || n(r.video_thruplay) > 0
      });
    }

    refreshAdIntentMap();

    function getChartDates() {
      var cs = document.getElementById('chart-date-start');
      var ce = document.getElementById('chart-date-end');
      if (cs && cs.value && ce && ce.value) {
        chartDateStart = cs.value;
        chartDateEnd = ce.value;
      } else {
        chartDateStart = currentDateStart;
        chartDateEnd = currentDateEnd;
      }
    }

    async function loadCharts() {
      getChartDates();
      var accountEl = document.getElementById('account-select');
      var account = accountEl ? accountEl.value : '';
      var apiUrl = '/api/ads/daily?start=' + chartDateStart + '&end=' + chartDateEnd;
      if (account) apiUrl += '&account=' + encodeURIComponent(account);
      if (portalExtraParams) apiUrl += portalExtraParams;

      var loadingEl = document.getElementById('charts-loading');
      var contentEl = document.getElementById('charts-content');
      if (loadingEl) { loadingEl.style.display = 'block'; loadingEl.textContent = 'Loading chart data...'; }
      if (contentEl) contentEl.style.display = 'none';

      try {
        var resp = await fetch(apiUrl);
        var data = await resp.json();
        chartRawRows = stripEmptyCurrentDay(data.rows || []);
        chartsLoaded = true;
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
        populateChartFilters();
        renderAllCharts();
      } catch(e) {
        if (loadingEl) loadingEl.textContent = 'Error loading chart data';
      }
    }

    function reloadChartData() {
      var s = document.getElementById('chart-date-start');
      var e = document.getElementById('chart-date-end');
      if (s && e && s.value && e.value) {
        chartDateStart = s.value;
        chartDateEnd = e.value;
        loadCharts();
      }
    }

    function setChartPreset(days) {
      var end = new Date();
      var start = new Date();
      start.setDate(end.getDate() - Math.max(days - 1, 0));
      var startStr = start.toISOString().split('T')[0];
      var endStr = end.toISOString().split('T')[0];
      var s = document.getElementById('chart-date-start');
      var e = document.getElementById('chart-date-end');
      if (s) s.value = startStr;
      if (e) e.value = endStr;
      chartDateStart = startStr;
      chartDateEnd = endStr;
      document.querySelectorAll('.charts-date-picker .date-preset').forEach(function(b) { b.classList.remove('active'); });
      if (event && event.target) event.target.classList.add('active');
      loadCharts();
    }

    function showTT(containerId, x, y, html) {
      var container = document.getElementById(containerId);
      if (!container) return;
      var tt = container.querySelector('.chart-tt');
      if (!tt) { tt = document.createElement('div'); tt.className = 'chart-tt'; container.appendChild(tt); }
      tt.innerHTML = html;
      tt.style.display = 'block';
      var cRect = container.getBoundingClientRect();
      var ttW = tt.offsetWidth || 120;
      var left = x - cRect.left;
      if (left + ttW > cRect.width) left = left - ttW - 10;
      tt.style.left = Math.max(0, left) + 'px';
      tt.style.top = Math.max(0, y - cRect.top - 60) + 'px';
    }
    function hideTT(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;
      var tt = container.querySelector('.chart-tt');
      if (tt) tt.style.display = 'none';
    }

    function populateChartFilters() {
      if (!chartRawRows) return;
      var campaigns = {}, ads = {};
      for (var i = 0; i < chartRawRows.length; i++) {
        var r = chartRawRows[i];
        if (r.campaign_name && r.campaign_id) campaigns[r.campaign_id] = r.campaign_name;
        if (r.ad_id && r.ad_name) ads[r.ad_id] = { name: r.ad_name, cid: r.campaign_id };
      }
      var cSel = document.getElementById('chart-campaign-filter');
      cSel.innerHTML = '<option value="">All Campaigns</option>';
      Object.keys(campaigns).forEach(function(id) {
        cSel.innerHTML += '<option value="' + id + '">' + campaigns[id].replace(/</g,'&lt;') + '</option>';
      });
      updateAdFilterOptions();
    }

    function updateAdFilterOptions() {
      if (!chartRawRows) return;
      var ads = {};
      for (var i = 0; i < chartRawRows.length; i++) {
        var r = chartRawRows[i];
        if (chartCampaignFilter && r.campaign_id !== chartCampaignFilter) continue;
        if (r.ad_id && r.ad_name) ads[r.ad_id] = r.ad_name;
      }
      var aSel = document.getElementById('chart-ad-filter');
      aSel.innerHTML = '<option value="">All Ads</option>';
      Object.keys(ads).forEach(function(id) {
        aSel.innerHTML += '<option value="' + id + '">' + ads[id].replace(/</g,'&lt;') + '</option>';
      });
    }

    function onChartCampaignChange() {
      chartCampaignFilter = document.getElementById('chart-campaign-filter').value;
      chartAdFilter = '';
      updateAdFilterOptions();
      renderAllCharts();
    }
    function onChartAdChange() {
      chartAdFilter = document.getElementById('chart-ad-filter').value;
      renderAllCharts();
    }
    function setChartPeriod(p) {
      chartPeriod = p;
      document.querySelectorAll('.period-btn').forEach(function(b) { b.classList.remove('active'); });
      event.target.classList.add('active');
      renderAllCharts();
    }

    function getFilteredRows() {
      if (!chartRawRows) return [];
      var selectedEndDate = resolveSelectionEndDate();
      return chartRawRows.filter(function(r) {
        if (chartCampaignFilter && r.campaign_id !== chartCampaignFilter) return false;
        if (chartAdFilter && r.ad_id !== chartAdFilter) return false;
        if (selectedEndDate && r.date > selectedEndDate) return false;
        return true;
      });
    }

    function aggregateByPeriod(rows) {
      var byKey = {};
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var key = r.date;
        if (chartPeriod === 'weekly') {
          var d = new Date(r.date);
          var day = d.getDay(); var diff = d.getDate() - day + (day === 0 ? -6 : 1);
          key = new Date(d.setDate(diff)).toISOString().split('T')[0];
        } else if (chartPeriod === 'monthly') {
          key = r.date.substring(0, 7);
        }
        if (!byKey[key]) byKey[key] = { date: key, spend: 0, leads: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, link_clicks: 0, video_views: 0, video_thruplay: 0, reach: 0 };
        byKey[key].spend += r.spend || 0;
        byKey[key].leads += r.leads || 0;
        byKey[key].purchases += r.purchases || 0;
        byKey[key].purchase_value += r.purchase_value || 0;
        byKey[key].impressions += r.impressions || 0;
        byKey[key].clicks += r.clicks || 0;
        byKey[key].link_clicks += r.link_clicks || 0;
        byKey[key].video_views += r.video_views || 0;
        byKey[key].video_thruplay += r.video_thruplay || 0;
        byKey[key].reach += r.reach || 0;
      }
      return Object.keys(byKey).sort().map(function(k) { return byKey[k]; });
    }

    function aggregateByCampaign(rows) {
      var byC = {};
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var k = r.campaign_name || 'Unknown';
        if (!byC[k]) byC[k] = { campaign_name: k, spend: 0, leads: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, link_clicks: 0, video_views: 0, video_thruplay: 0, reach: 0 };
        byC[k].spend += r.spend || 0;
        byC[k].leads += r.leads || 0;
        byC[k].purchases += r.purchases || 0;
        byC[k].purchase_value += r.purchase_value || 0;
        byC[k].impressions += r.impressions || 0;
        byC[k].clicks += r.clicks || 0;
        byC[k].link_clicks += r.link_clicks || 0;
        byC[k].video_views += r.video_views || 0;
        byC[k].video_thruplay += r.video_thruplay || 0;
        byC[k].reach += r.reach || 0;
      }
      return Object.values(byC).sort(function(a,b) { return b.spend - a.spend; });
    }

    function aggregateByAd(rows) {
      var byA = {};
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var k = r.ad_id;
        if (!byA[k]) byA[k] = { ad_id: r.ad_id, ad_name: r.ad_name || 'Unnamed', campaign_name: r.campaign_name || '', spend: 0, leads: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, link_clicks: 0, video_views: 0, video_thruplay: 0, reach: 0 };
        byA[k].spend += r.spend || 0;
        byA[k].leads += r.leads || 0;
        byA[k].purchases += r.purchases || 0;
        byA[k].purchase_value += r.purchase_value || 0;
        byA[k].impressions += r.impressions || 0;
        byA[k].clicks += r.clicks || 0;
        byA[k].link_clicks += r.link_clicks || 0;
        byA[k].video_views += r.video_views || 0;
        byA[k].video_thruplay += r.video_thruplay || 0;
        byA[k].reach += r.reach || 0;
      }
      return Object.values(byA).sort(function(a,b) { return b.spend - a.spend; });
    }

    function renderAllCharts() {
      var filtered = getFilteredRows();
      resolveChartIntent(filtered);
      var daily = aggregateByPeriod(filtered);
      var campaigns = aggregateByCampaign(filtered);
      var topAds = aggregateByAd(filtered);

      var periodLabel = chartPeriod === 'weekly' ? 'Weekly' : chartPeriod === 'monthly' ? 'Monthly' : 'Daily';
      var titleEl = document.getElementById('chart-spend-leads-title');
      if (titleEl) titleEl.textContent = periodLabel + ' Spend & ' + chartResultLabel;
      var cprTitle = document.getElementById('chart-cpr-title');
      if (cprTitle) cprTitle.textContent = chartCostLabel + ' Trend';

      var bTitle = document.getElementById('chart-breakdown-title');
      if (bTitle) bTitle.textContent = chartAdFilter ? 'Ad Daily Breakdown' : chartCampaignFilter ? 'Ad Breakdown' : 'Campaign Breakdown';
      var tTitle = document.getElementById('chart-top-ads-title');
      if (tTitle) tTitle.textContent = chartCampaignFilter ? 'Ads in Campaign' : 'Top Ads by Spend';

      renderKPIs(daily);
      renderTopPerformers(topAds, campaigns);
      renderSpendResultsChart(daily);
      renderLineChart('chart-cpl', daily, function(d) {
        var c = getCostValueByIntent(d, chartIntent);
        return c > 0 ? c : null;
      }, '$', 'var(--status-active)');
      renderLineChart('chart-ctr', daily, function(d) { return d.impressions > 0 ? (d.clicks / d.impressions) * 100 : null; }, '%', '#b5a48e');
      renderDualLineChart('chart-hook-hold', daily,
        function(d) { return d.impressions > 0 ? (d.video_views / d.impressions) * 100 : null; },
        function(d) { return d.video_views > 0 ? (d.video_thruplay / d.video_views) * 100 : null; },
        'Hook', 'Hold', '#b5a48e', 'var(--status-completed)'
      );
      if (chartCampaignFilter || chartAdFilter) {
        renderBarChart('chart-campaigns', topAds.slice(0, 10), 'ad_name');
      } else {
        renderBarChart('chart-campaigns', campaigns.slice(0, 10), 'campaign_name');
      }
      renderBarChart('chart-top-ads', topAds.slice(0, 15), 'ad_name');
    }

    function renderTopPerformers(ads, campaigns) {
      var el = document.getElementById('charts-top-performers');
      if (!el) return;
      var items = ads.length > 0 ? ads : [];
      if (items.length === 0) { el.innerHTML = ''; return; }

      var bestCost = null, mostResults = null, bestHook = null, bestHold = null, highestSpend = null;
      for (var i = 0; i < items.length; i++) {
        var a = items[i];
        var res = getResultValueByIntent(a, chartIntent);
        var cost = getCostValueByIntent(a, chartIntent);
        if (res > 0 && cost > 0 && (!bestCost || cost < getCostValueByIntent(bestCost, chartIntent))) bestCost = a;
        if (res > 0 && (!mostResults || res > getResultValueByIntent(mostResults, chartIntent))) mostResults = a;
        var hook = a.impressions > 0 ? (a.video_views / a.impressions) * 100 : 0;
        if (hook > 0 && (!bestHook || hook > (bestHook.video_views / bestHook.impressions) * 100)) bestHook = a;
        var hold = a.video_views > 0 ? (a.video_thruplay / a.video_views) * 100 : 0;
        if (hold > 0 && (!bestHold || hold > (bestHold.video_thruplay / bestHold.video_views) * 100)) bestHold = a;
        if (!highestSpend || a.spend > highestSpend.spend) highestSpend = a;
      }

      var html = '<div class="top-performers">';
      if (bestCost) {
        var bc = getCostValueByIntent(bestCost, chartIntent);
        var bRes = getResultValueByIntent(bestCost, chartIntent);
        html += '<div class="top-perf-card"><div class="top-perf-label">Best ' + chartCostLabel + '</div><div class="top-perf-name">' + (bestCost.ad_name || bestCost.campaign_name || '').replace(/</g,'&lt;') + '</div><div class="top-perf-value green">$' + bc.toFixed(2) + '</div><div class="top-perf-sub">' + fmtResultValue(bRes) + ' ' + chartResultLabel.toLowerCase() + '</div></div>';
      }
      if (mostResults && (!bestCost || mostResults.ad_id !== bestCost.ad_id)) {
        var mr = getResultValueByIntent(mostResults, chartIntent);
        html += '<div class="top-perf-card"><div class="top-perf-label">Most ' + chartResultLabel + '</div><div class="top-perf-name">' + (mostResults.ad_name || '').replace(/</g,'&lt;') + '</div><div class="top-perf-value cyan">' + fmtResultValue(mr) + '</div><div class="top-perf-sub">$' + mostResults.spend.toFixed(2) + ' spent</div></div>';
      }
      if (bestHook) {
        var hookPct = ((bestHook.video_views / bestHook.impressions) * 100).toFixed(1);
        html += '<div class="top-perf-card"><div class="top-perf-label">Best Hook Rate</div><div class="top-perf-name">' + (bestHook.ad_name || '').replace(/</g,'&lt;') + '</div><div class="top-perf-value cyan">' + hookPct + '%</div><div class="top-perf-sub">' + bestHook.video_views.toLocaleString() + ' views</div></div>';
      }
      if (bestHold) {
        var holdPct = ((bestHold.video_thruplay / bestHold.video_views) * 100).toFixed(1);
        html += '<div class="top-perf-card"><div class="top-perf-label">Best Hold Rate</div><div class="top-perf-name">' + (bestHold.ad_name || '').replace(/</g,'&lt;') + '</div><div class="top-perf-value green">' + holdPct + '%</div><div class="top-perf-sub">' + bestHold.video_thruplay.toLocaleString() + ' thruplays</div></div>';
      }
      if (highestSpend) {
        var hRes = getResultValueByIntent(highestSpend, chartIntent);
        var hCost = getCostValueByIntent(highestSpend, chartIntent);
        var spendCpl = hRes > 0 ? '$' + hCost.toFixed(2) + ' ' + chartCostLabel : '0 ' + chartResultLabel.toLowerCase();
        html += '<div class="top-perf-card"><div class="top-perf-label">Highest Spend</div><div class="top-perf-name">' + (highestSpend.ad_name || '').replace(/</g,'&lt;') + '</div><div class="top-perf-value gold">$' + highestSpend.spend.toFixed(2) + '</div><div class="top-perf-sub">' + spendCpl + '</div></div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    function renderKPIs(daily) {
      var el = document.getElementById('charts-kpi-row');
      if (!el || daily.length === 0) { if(el) el.innerHTML = ''; return; }

      var totalSpend = 0, totalResults = 0, totalImpr = 0, totalClicks = 0, totalViews = 0, totalThru = 0, totalReach = 0, totalPurchaseValue = 0;
      for (var i = 0; i < daily.length; i++) {
        totalSpend += n(daily[i].spend);
        totalResults += getResultValueByIntent(daily[i], chartIntent);
        totalImpr += n(daily[i].impressions);
        totalClicks += n(daily[i].clicks);
        totalViews += n(daily[i].video_views);
        totalThru += n(daily[i].video_thruplay);
        totalReach += n(daily[i].reach);
        totalPurchaseValue += n(daily[i].purchase_value);
      }
      var avgCostPerResult = getCostValueByIntent({ spend: totalSpend, impressions: totalImpr, leads: totalResults, link_clicks: totalResults, purchases: totalResults, video_thruplay: totalResults, reach: totalReach }, chartIntent);
      var avgCTR = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
      var avgHook = totalImpr > 0 ? (totalViews / totalImpr) * 100 : 0;
      var avgHold = totalViews > 0 ? (totalThru / totalViews) * 100 : 0;
      var roas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;

      var kpis = [
        { label: 'Total Spend', value: '$' + totalSpend.toFixed(2), data: daily.map(function(d){return d.spend;}), color: '#b5a48e' },
        { label: 'Total ' + chartResultLabel, value: fmtResultValue(totalResults), data: daily.map(function(d){return getResultValueByIntent(d, chartIntent);}), color: 'var(--status-completed)' },
        { label: 'Avg ' + chartCostLabel, value: avgCostPerResult > 0 ? '$' + avgCostPerResult.toFixed(2) : '-', data: daily.map(function(d){return getCostValueByIntent(d, chartIntent);}), color: 'var(--status-active)' },
        { label: 'Avg CTR', value: avgCTR.toFixed(2) + '%', data: daily.map(function(d){return d.impressions>0?(d.clicks/d.impressions)*100:0;}), color: '#b5a48e' },
        { label: 'Hook Rate', value: avgHook.toFixed(1) + '%', data: daily.map(function(d){return d.impressions>0?(d.video_views/d.impressions)*100:0;}), color: '#9b6dff' },
        { label: 'Hold Rate', value: avgHold.toFixed(1) + '%', data: daily.map(function(d){return d.video_views>0?(d.video_thruplay/d.video_views)*100:0;}), color: '#10e898' },
        { label: 'Reach', value: totalReach.toLocaleString(), data: daily.map(function(d){return d.reach;}), color: '#f59e0b' }
      ];
      if (chartIntent === 'purchase') {
        kpis.splice(3, 0, { label: 'ROAS', value: roas > 0 ? roas.toFixed(2) + 'x' : '-', data: daily.map(function(d){ return n(d.spend) > 0 ? n(d.purchase_value) / n(d.spend) : 0; }), color: 'var(--status-completed)' });
      }

      var html = '';
      for (var k = 0; k < kpis.length; k++) {
        var kpi = kpis[k];
        var spark = buildSparkline(kpi.data, kpi.color, 120, 32);
        var mid = Math.floor(kpi.data.length / 2);
        var firstHalf = 0, secondHalf = 0, firstCount = 0, secondCount = 0;
        for (var j = 0; j < kpi.data.length; j++) {
          if (j < mid) { firstHalf += kpi.data[j]; firstCount++; }
          else { secondHalf += kpi.data[j]; secondCount++; }
        }
        var firstAvg = firstCount > 0 ? firstHalf / firstCount : 0;
        var secondAvg = secondCount > 0 ? secondHalf / secondCount : 0;
        var changePct = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg * 100) : 0;
        var changeClass = changePct > 1 ? 'up' : changePct < -1 ? 'down' : 'flat';
        var changeStr = changePct > 0 ? '+' + changePct.toFixed(1) + '%' : changePct.toFixed(1) + '%';

        html += '<div class="kpi-card">';
        html += '<div class="kpi-label">' + kpi.label + '</div>';
        html += '<div class="kpi-value">' + kpi.value + '</div>';
        html += '<div class="kpi-spark">' + spark + '</div>';
        html += '<div class="kpi-change ' + changeClass + '">' + changeStr + ' vs prev period</div>';
        html += '</div>';
      }
      el.innerHTML = html;
    }

    function buildSparkline(data, color, w, h) {
      if (!data || data.length < 2) return '';
      var max = Math.max.apply(null, data);
      var min = Math.min.apply(null, data);
      var range = max - min || 1;
      var points = [], areaPoints = [];
      for (var i = 0; i < data.length; i++) {
        var x = (i / (data.length - 1)) * w;
        var y = h - ((data[i] - min) / range) * (h - 4) - 2;
        points.push(x.toFixed(1) + ',' + y.toFixed(1));
        areaPoints.push(x.toFixed(1) + ',' + y.toFixed(1));
      }
      areaPoints.push(w + ',' + h);
      areaPoints.push('0,' + h);
      var gradId = 'sg-' + color.replace('#','') + '-' + Math.random().toString(36).substr(2,4);
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.3"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
        '<polygon points="' + areaPoints.join(' ') + '" fill="url(#' + gradId + ')"/>' +
        '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5"/>' +
        '</svg>';
    }

    function normalizeSeries(raw) {
      if (!raw || raw.length === 0) return null;
      var out = new Array(raw.length);
      var firstValid = null;
      for (var i = 0; i < raw.length; i++) {
        var v = Number(raw[i]);
        if (isFinite(v) && v >= 0) {
          out[i] = v;
          if (firstValid === null) firstValid = v;
        } else {
          out[i] = null;
        }
      }
      if (firstValid === null) return null;
      var last = firstValid;
      for (var j = 0; j < out.length; j++) {
        if (out[j] === null) out[j] = last;
        else last = out[j];
      }
      return out;
    }

    function renderSpendResultsChart(daily) {
      var el = document.getElementById('chart-spend-leads');
      if (!el || daily.length === 0) { if(el) el.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px;">No data</div>'; return; }

      var W = 700, H = 180, pad = { top: 10, right: 50, bottom: 30, left: 50 };
      var cW = W - pad.left - pad.right;
      var cH = H - pad.top - pad.bottom;

      var maxSpend = 0, maxResults = 0;
      for (var i = 0; i < daily.length; i++) {
        if (n(daily[i].spend) > maxSpend) maxSpend = n(daily[i].spend);
        var rv = getResultValueByIntent(daily[i], chartIntent);
        if (rv > maxResults) maxResults = rv;
      }
      maxSpend = maxSpend || 1;
      maxResults = maxResults || 1;

      var barWidth = Math.max(4, (cW / daily.length) * 0.5);
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
      svg += '<defs><linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b5a48e" stop-opacity="0.2"/><stop offset="100%" stop-color="#b5a48e" stop-opacity="0"/></linearGradient></defs>';

      for (var g = 0; g <= 4; g++) {
        var gy = pad.top + (g / 4) * cH;
        svg += '<line x1="' + pad.left + '" y1="' + gy + '" x2="' + (W - pad.right) + '" y2="' + gy + '" stroke="rgba(59,155,143,0.08)" stroke-width="1"/>';
        svg += '<text x="' + (pad.left - 4) + '" y="' + (gy + 3) + '" text-anchor="end" fill="#555" font-size="9" font-family="monospace">$' + (maxSpend * (4-g)/4).toFixed(0) + '</text>';
        svg += '<text x="' + (W - pad.right + 4) + '" y="' + (gy + 3) + '" text-anchor="start" fill="#555" font-size="9" font-family="monospace">' + Math.round(maxResults * (4-g)/4) + '</text>';
      }

      var spendPoints = [], spendArea = [];
      for (var i = 0; i < daily.length; i++) {
        var x = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var y = pad.top + cH - (n(daily[i].spend) / maxSpend) * cH;
        spendPoints.push(x.toFixed(1) + ',' + y.toFixed(1));
        spendArea.push(x.toFixed(1) + ',' + y.toFixed(1));
      }
      spendArea.push((pad.left + cW).toFixed(1) + ',' + (pad.top + cH));
      spendArea.push(pad.left + ',' + (pad.top + cH));
      svg += '<polygon points="' + spendArea.join(' ') + '" fill="url(#spendGrad)"/>';
      svg += '<polyline points="' + spendPoints.join(' ') + '" fill="none" stroke="#b5a48e" stroke-width="2"/>';

      // Dots on the spend line (hidden by default, shown on hover)
      for (var i = 0; i < daily.length; i++) {
        var dx = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var dy = pad.top + cH - (n(daily[i].spend) / maxSpend) * cH;
        svg += '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="4" fill="#b5a48e" stroke="var(--bg)" stroke-width="2" class="chart-dot" id="dot-sl-' + i + '" style="opacity:0;transition:opacity 0.15s;"/>';
      }

      for (var i = 0; i < daily.length; i++) {
        var resultVal = getResultValueByIntent(daily[i], chartIntent);
        if (resultVal > 0) {
          var bx = pad.left + (i / Math.max(daily.length - 1, 1)) * cW - barWidth / 2;
          var bh = (resultVal / maxResults) * cH;
          var by = pad.top + cH - bh;
          svg += '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barWidth + '" height="' + bh.toFixed(1) + '" fill="rgba(34,197,94,0.4)" rx="2"/>';
        }
      }

      // Vertical hover line + trigger zones
      svg += '<line id="hover-line-sl" x1="0" y1="' + pad.top + '" x2="0" y2="' + (pad.top + cH) + '" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,3" style="opacity:0;transition:opacity 0.15s;"/>';
      var hoverW = cW / Math.max(daily.length, 1);
      for (var i = 0; i < daily.length; i++) {
        var hx = pad.left + (i / Math.max(daily.length - 1, 1)) * cW - hoverW / 2;
        var dotX = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var d = daily[i];
        var result = getResultValueByIntent(d, chartIntent);
        var cost = getCostValueByIntent(d, chartIntent);
        var costText = cost > 0 ? '$' + cost.toFixed(2) : '-';
        var ttHtml = '<strong>' + d.date + '</strong><br>Spend: $' + n(d.spend).toFixed(2) + '<br>' + chartResultLabel + ': ' + fmtResultValue(result) + '<br>' + chartCostLabel + ': ' + costText + '<br>Impr: ' + n(d.impressions).toLocaleString();
        svg += '<rect x="' + hx.toFixed(1) + '" y="' + pad.top + '" width="' + hoverW.toFixed(1) + '" height="' + cH + '" fill="transparent" style="cursor:crosshair" onmouseenter="document.getElementById(\\'dot-sl-' + i + '\\').style.opacity=1;document.getElementById(\\'hover-line-sl\\').style.opacity=1;document.getElementById(\\'hover-line-sl\\').setAttribute(\\'x1\\',' + dotX.toFixed(1) + ');document.getElementById(\\'hover-line-sl\\').setAttribute(\\'x2\\',' + dotX.toFixed(1) + ');" onmouseleave="document.getElementById(\\'dot-sl-' + i + '\\').style.opacity=0;document.getElementById(\\'hover-line-sl\\').style.opacity=0;hideTT(\\'chart-spend-leads\\');" onmousemove="showTT(\\'chart-spend-leads\\',event.clientX,event.clientY,\\'' + ttHtml.replace(/'/g,"\\\\'") + '\\')" />';
      }

      var labelStep = Math.max(1, Math.floor(daily.length / 7));
      for (var i = 0; i < daily.length; i += labelStep) {
        var x = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var lbl = chartPeriod === 'monthly' ? daily[i].date : daily[i].date.split('-').slice(1).join('/');
        svg += '<text x="' + x + '" y="' + (H - 4) + '" text-anchor="middle" fill="#555" font-size="9" font-family="monospace">' + lbl + '</text>';
      }
      svg += '</svg>';
      svg += '<div class="chart-legend"><div class="legend-item"><div class="legend-dot" style="background:#b5a48e"></div>Spend</div><div class="legend-item"><div class="legend-dot" style="background:var(--status-completed)"></div>' + chartResultLabel + '</div></div>';
      el.innerHTML = svg;
    }

    function renderLineChart(containerId, daily, valueFn, suffix, color) {
      var el = document.getElementById(containerId);
      if (!el || daily.length === 0) { if(el) el.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px;">No data</div>'; return; }

      var W = 350, H = 180, pad = { top: 10, right: 10, bottom: 30, left: 45 };
      var cW = W - pad.left - pad.right;
      var cH = H - pad.top - pad.bottom;

      var rawValues = [];
      for (var i = 0; i < daily.length; i++) {
        rawValues.push(valueFn(daily[i]));
      }
      var values = normalizeSeries(rawValues);
      if (!values) { el.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px;">No data</div>'; return; }
      var max = Math.max.apply(null, values) || 1;
      var min = Math.min.apply(null, values.filter(function(v){return v > 0;})) || 0;
      min = Math.max(0, min * 0.8);
      var range = max - min || 1;

      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
      var gradId = 'lg-' + containerId + '-' + Math.random().toString(36).substr(2,4);
      svg += '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.15"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';

      for (var g = 0; g <= 3; g++) {
        var gy = pad.top + (g / 3) * cH;
        var val = max - (g / 3) * range;
        svg += '<line x1="' + pad.left + '" y1="' + gy + '" x2="' + (W - pad.right) + '" y2="' + gy + '" stroke="rgba(59,155,143,0.08)" stroke-width="1"/>';
        svg += '<text x="' + (pad.left - 4) + '" y="' + (gy + 3) + '" text-anchor="end" fill="#555" font-size="9" font-family="monospace">' + (suffix === '$' ? '$' + val.toFixed(0) : val.toFixed(1) + '%') + '</text>';
      }

      var points = [], areaPoints = [];
      for (var i = 0; i < daily.length; i++) {
        var x = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var y = pad.top + cH - ((values[i] - min) / range) * cH;
        points.push(x.toFixed(1) + ',' + y.toFixed(1));
        areaPoints.push(x.toFixed(1) + ',' + y.toFixed(1));
      }
      areaPoints.push((pad.left + cW) + ',' + (pad.top + cH));
      areaPoints.push(pad.left + ',' + (pad.top + cH));
      svg += '<polygon points="' + areaPoints.join(' ') + '" fill="url(#' + gradId + ')"/>';
      svg += '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2"/>';

      // Hover dots on line
      for (var i = 0; i < daily.length; i++) {
        var x = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var y = pad.top + cH - ((values[i] - min) / range) * cH;
        svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="' + color + '" stroke="var(--bg)" stroke-width="2" id="dot-' + containerId + '-' + i + '" style="opacity:0;transition:opacity 0.15s;"/>';
      }

      // Vertical hover line
      svg += '<line id="hover-line-' + containerId + '" x1="0" y1="' + pad.top + '" x2="0" y2="' + (pad.top + cH) + '" stroke="rgba(255,255,255,0.15)" stroke-width="1" stroke-dasharray="3,3" style="opacity:0;transition:opacity 0.15s;"/>';
      var hW = cW / Math.max(daily.length, 1);
      for (var i = 0; i < daily.length; i++) {
        var hx = pad.left + (i / Math.max(daily.length - 1, 1)) * cW - hW / 2;
        var dotX = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var val = rawValues[i];
        var ttVal = (val === null || !isFinite(Number(val)))
          ? 'No data'
          : (suffix === '$' ? '$' + Number(val).toFixed(2) : Number(val).toFixed(2) + '%');
        var ttHtml = '<strong>' + daily[i].date + '</strong><br>' + ttVal;
        svg += '<rect x="' + hx.toFixed(1) + '" y="' + pad.top + '" width="' + hW.toFixed(1) + '" height="' + cH + '" fill="transparent" style="cursor:crosshair" onmouseenter="document.getElementById(\\'dot-' + containerId + '-' + i + '\\').style.opacity=1;document.getElementById(\\'hover-line-' + containerId + '\\').style.opacity=1;document.getElementById(\\'hover-line-' + containerId + '\\').setAttribute(\\'x1\\',' + dotX.toFixed(1) + ');document.getElementById(\\'hover-line-' + containerId + '\\').setAttribute(\\'x2\\',' + dotX.toFixed(1) + ');" onmouseleave="document.getElementById(\\'dot-' + containerId + '-' + i + '\\').style.opacity=0;document.getElementById(\\'hover-line-' + containerId + '\\').style.opacity=0;hideTT(\\'' + containerId + '\\');" onmousemove="showTT(\\'' + containerId + '\\',event.clientX,event.clientY,\\'' + ttHtml.replace(/'/g,"\\\\'") + '\\')" />';
      }

      var labelStep = Math.max(1, Math.floor(daily.length / 5));
      for (var i = 0; i < daily.length; i += labelStep) {
        var x = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var lbl = chartPeriod === 'monthly' ? daily[i].date : daily[i].date.split('-').slice(1).join('/');
        svg += '<text x="' + x + '" y="' + (H - 4) + '" text-anchor="middle" fill="#555" font-size="9" font-family="monospace">' + lbl + '</text>';
      }
      svg += '</svg>';
      el.innerHTML = svg;
    }

    function renderDualLineChart(containerId, daily, fn1, fn2, label1, label2, color1, color2) {
      var el = document.getElementById(containerId);
      if (!el || daily.length === 0) { if(el) el.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px;">No data</div>'; return; }

      var W = 350, H = 180, pad = { top: 10, right: 10, bottom: 30, left: 45 };
      var cW = W - pad.left - pad.right;
      var cH = H - pad.top - pad.bottom;

      var r1 = [], r2 = [];
      for (var i = 0; i < daily.length; i++) {
        r1.push(fn1(daily[i]));
        r2.push(fn2(daily[i]));
      }
      var v1 = normalizeSeries(r1);
      var v2 = normalizeSeries(r2);
      var scaleVals = [];
      if (v1) scaleVals = scaleVals.concat(v1);
      if (v2) scaleVals = scaleVals.concat(v2);
      if (scaleVals.length === 0) { el.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px;">No data</div>'; return; }
      var max = Math.max.apply(null, scaleVals) || 1;

      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
      for (var g = 0; g <= 3; g++) {
        var gy = pad.top + (g / 3) * cH;
        svg += '<line x1="' + pad.left + '" y1="' + gy + '" x2="' + (W - pad.right) + '" y2="' + gy + '" stroke="rgba(59,155,143,0.08)" stroke-width="1"/>';
        svg += '<text x="' + (pad.left - 4) + '" y="' + (gy + 3) + '" text-anchor="end" fill="#555" font-size="9" font-family="monospace">' + (max * (3-g)/3).toFixed(0) + '%</text>';
      }

      function drawLine(vals, col) {
        var pts = [];
        for (var i = 0; i < daily.length; i++) {
          var x = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
          var y = pad.top + cH - (vals[i] / max) * cH;
          pts.push(x.toFixed(1) + ',' + y.toFixed(1));
        }
        return '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2"/>';
      }
      if (v1) svg += drawLine(v1, color1);
      if (v2) svg += drawLine(v2, color2);

      var hW2 = cW / Math.max(daily.length, 1);
      for (var i = 0; i < daily.length; i++) {
        var hx2 = pad.left + (i / Math.max(daily.length - 1, 1)) * cW - hW2 / 2;
        var tv1 = (r1[i] === null || !isFinite(Number(r1[i]))) ? 'No data' : Number(r1[i]).toFixed(1) + '%';
        var tv2 = (r2[i] === null || !isFinite(Number(r2[i]))) ? 'No data' : Number(r2[i]).toFixed(1) + '%';
        var ttH = '<strong>' + daily[i].date + '</strong><br>' + label1 + ': ' + tv1 + '<br>' + label2 + ': ' + tv2;
        svg += '<rect x="' + hx2.toFixed(1) + '" y="' + pad.top + '" width="' + hW2.toFixed(1) + '" height="' + cH + '" fill="transparent" style="cursor:crosshair" onmousemove="showTT(\\'' + containerId + '\\',event.clientX,event.clientY,\\'' + ttH.replace(/'/g,"\\\\'") + '\\')" onmouseleave="hideTT(\\'' + containerId + '\\')"/>';
      }

      var labelStep = Math.max(1, Math.floor(daily.length / 5));
      for (var i = 0; i < daily.length; i += labelStep) {
        var x = pad.left + (i / Math.max(daily.length - 1, 1)) * cW;
        var lbl = chartPeriod === 'monthly' ? daily[i].date : daily[i].date.split('-').slice(1).join('/');
        svg += '<text x="' + x + '" y="' + (H - 4) + '" text-anchor="middle" fill="#555" font-size="9" font-family="monospace">' + lbl + '</text>';
      }
      svg += '</svg>';
      svg += '<div class="chart-legend"><div class="legend-item"><div class="legend-dot" style="background:' + color1 + '"></div>' + label1 + '</div><div class="legend-item"><div class="legend-dot" style="background:' + color2 + '"></div>' + label2 + '</div></div>';
      el.innerHTML = svg;
    }

    function renderBarChart(containerId, items, nameKey) {
      var el = document.getElementById(containerId);
      if (!el || items.length === 0) { if(el) el.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:20px;">No data</div>'; return; }

      var maxSpend = items[0].spend || 1;
      var html = '';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var pct = (item.spend / maxSpend) * 100;
        var result = getResultValueByIntent(item, chartIntent);
        var cost = getCostValueByIntent(item, chartIntent);
        var costText = cost > 0 ? '$' + cost.toFixed(2) : '-';
        var hookRate = item.impressions > 0 ? ((item.video_views / item.impressions) * 100).toFixed(1) + '%' : '-';
        var name = (item[nameKey] || 'Unknown').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        html += '<div class="bar-row">';
        html += '<div class="bar-label" title="' + name + '">' + name + '</div>';
        html += '<div class="bar-track"><div class="bar-fill bar-fill-spend" style="width:' + pct.toFixed(1) + '%"></div></div>';
        html += '<div class="bar-stats"><div class="bar-stat"><strong>$' + item.spend.toFixed(0) + '</strong></div><div class="bar-stat">' + fmtResultValue(result) + ' ' + chartResultLabel.toLowerCase() + '</div><div class="bar-stat">' + chartCostLabel + ' ' + costText + '</div>';
        if (nameKey === 'ad_name') html += '<div class="bar-stat">Hook ' + hookRate + '</div>';
        html += '</div></div>';
      }
      el.innerHTML = html;
    }

    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
      var modal = document.getElementById('ad-modal');
      if (!modal || !modal.classList.contains('open')) return;

      if (e.key === 'Escape') {
        closeAdModal();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentAdIndex > 0) {
          switchAd(currentAdIndex - 1);
          document.getElementById('modal-ad-select').value = currentAdIndex;
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentAdIndex < adsData.length - 1) {
          switchAd(currentAdIndex + 1);
          document.getElementById('modal-ad-select').value = currentAdIndex;
        }
      }
    });

    // Auto-hydrate: fetch creatives + engagement after initial paint
    (function hydrateFromApi() {
      var params = new URLSearchParams(window.location.search);
      var apiUrl = '/api/ads/full?start=' + currentDateStart + '&end=' + currentDateEnd;
      if (params.get('account')) apiUrl += '&account=' + encodeURIComponent(params.get('account'));
      if (portalExtraParams) apiUrl += portalExtraParams;

      fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        if (!data.ads || !data.ads.length) return;

        var lookup = {};
        data.ads.forEach(function(ad) { lookup[ad.ad_id] = ad; });

        adsData.forEach(function(ad, i) {
          var fresh = lookup[ad.ad_id];
          if (!fresh) return;
          ['thumbnailUrl','imageUrl','objectType','videoId','videoUrl','effectiveStatus',
           'body','title','ctaType','linkUrl','adsetName','optimizationGoal','conversionEvent','endDate',
           'bodyVariations','titleVariations','reactions','comments','shares',
           'engagementScore','engagementScoreRating'].forEach(function(k) {
            if (fresh[k] !== undefined && fresh[k] !== null) {
              if ((k === 'thumbnailUrl' || k === 'imageUrl') && fresh[k]) {
                ad[k] = portalExtraParams ? fresh[k] : '/api/ads/thumb/' + encodeURIComponent(ad.ad_id);
              } else {
                ad[k] = fresh[k];
              }
            }
          });
        });
        refreshAdIntentMap();

        document.querySelectorAll('.ad-card').forEach(function(card, i) {
          var ad = adsData[i];
          if (!ad) return;
          // Update thumbnail - find .thumbnail container and replace placeholder
          var thumbContainer = card.querySelector('.thumbnail');
          if (thumbContainer && ad.thumbnailUrl) {
            var existingImg = thumbContainer.querySelector('img');
            var placeholder = thumbContainer.querySelector('.thumbnail-placeholder');
            if (!existingImg && placeholder) {
              // No image yet - replace placeholder with actual image
              var img = document.createElement('img');
              img.src = ad.thumbnailUrl;
              img.alt = ad.ad_name || '';
              img.loading = 'lazy';
              img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
              img.onerror = function() { img.style.display = 'none'; };
              placeholder.replaceWith(img);
            } else if (existingImg && placeholder) {
              // Image already rendered server-side - just remove the hidden placeholder
              placeholder.remove();
            }
            // Add type badge if missing
            if (ad.objectType && !thumbContainer.querySelector('.type-badge')) {
              var badge = document.createElement('span');
              badge.className = 'type-badge';
              badge.textContent = ad.objectType;
              thumbContainer.appendChild(badge);
            }
            // Update status dot
            var statusDot = thumbContainer.querySelector('.status-dot');
            if (statusDot && ad.effectiveStatus) {
              var st = (ad.effectiveStatus || '').toLowerCase();
              statusDot.className = 'status-dot status-' + (st === 'active' ? 'active' : st === 'paused' ? 'paused' : 'other');
              statusDot.style.position = 'absolute';
              statusDot.style.top = '8px';
              statusDot.style.right = '8px';
            }
          }
          // Re-render card stats once optimization/engagement fields are hydrated.
          renderCardDynamicStats(card, ad);
        });

        console.log('[ADS] Hydrated ' + data.ads.length + ' ads with creatives + engagement');
      }).catch(function(e) { console.warn('[ADS] Hydration failed:', e); });
    })();`

  // Wrap in layout (no sidebar - will be in iframe)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meta Ads | CTRL</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    ${dashboardCss()}

    /* Meta-dashboard legacy aliases — maps old token names to the shared shell
       palette so the large body of existing CSS continues to work without a
       full rewrite. Primary win: the sage accent demotes to warm off-white,
       hardcoded hexes resolve to warm-tinted tokens, and Geist replaces
       system-ui. */
    :root {
      --bg-base:          var(--bg);
      --bg-card:          var(--bg-panel);
      --bg-card-hover:    var(--bg-hover);
      --border-hover:     var(--border-strong);
      --accent-text:      var(--accent-fg);
      --accent-dim:       rgba(241, 237, 229, 0.08);
      --cream:            var(--text);
      --text-label:       var(--text-dim);
      --green:            var(--status-completed);
      --green-dim:        rgba(142, 150, 102, 0.15);
      --gold:             var(--status-active);
      --gold-dim:         rgba(217, 160, 64, 0.15);
      --red:              var(--status-overdue);
      --red-dim:          rgba(214, 96, 85, 0.15);
      --purple:           #b388ff;
      --purple-dim:       rgba(179, 136, 255, 0.12);
      --orange:           #ff9100;
      --pink:             #ff80ab;
      --sidebar-w:        0px;
      --glass-bg:         var(--bg-panel);
      --glass-border:     var(--border);
      --glass-border-strong: var(--border-strong);
      --glass-blur:       0px;
      --glass-shadow:     inset 0 1px 0 rgba(255,245,225,0.04), 0 2px 8px rgba(10,8,4,0.55);
      --glass-shadow-lg:  inset 0 1px 0 rgba(255,245,225,0.05), 0 12px 36px rgba(10,8,4,0.60);
      --glass-highlight:  inset 0 1px 0 rgba(255,245,225,0.04);
      --glass-reflection: none;
      --font-display:     var(--font-sans);
      --font-body:        var(--font-sans);
    }

    body { min-height: 100vh; overflow-x: hidden; padding: 0; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    ${pageCSS}
  </style>
</head>
<body>
  <div style="position:relative;z-index:1;">
    ${body}
  </div>
  <script>${script}</script>
</body>
</html>`
}

// Verify portal token and return allowed account IDs for that client
function verifyPortalAuth(portalSlug: string, portalToken: string): { allowed: true; accountIds: string[]; accountNames: Map<string, string> } | { allowed: false } {
  const db = getDb()
  const portal = db.prepare('SELECT * FROM portal_access WHERE client_slug = ? AND enabled = 1').get(portalSlug) as {
    password_hash: string | null; magic_link_token: string | null; client_slug: string
  } | undefined
  if (!portal) return { allowed: false }

  // Verify token
  if (portal.password_hash) {
    const validMagic = portal.magic_link_token && portalToken === portal.magic_link_token
    let validPw = false
    if (!validMagic && portalToken && portal.password_hash.includes(':')) {
      const [salt, hash] = portal.password_hash.split(':')
      const attempt = crypto.scryptSync(portalToken, salt, 64).toString('hex')
      validPw = hash.length === attempt.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(attempt))
    }
    if (!validMagic && !validPw) return { allowed: false }
  }

  // Get client's ad account IDs
  const clientRow = db.prepare('SELECT id FROM client_profiles WHERE slug = ?').get(portalSlug) as { id: number } | undefined
  if (!clientRow) return { allowed: false }
  const businesses = db.prepare('SELECT ad_account_id, name FROM client_businesses WHERE client_id = ? AND ad_account_id IS NOT NULL').all(clientRow.id) as { ad_account_id: string; name: string }[]
  const accountIds = businesses.map(b => b.ad_account_id)
  const accountNames = new Map<string, string>()
  businesses.forEach(b => accountNames.set(b.ad_account_id, b.name))
  return { allowed: true, accountIds, accountNames }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const portalSlug = searchParams.get('portal_slug')
  const portalToken = searchParams.get('portal_token')

  // Portal auth or owner auth
  let portalAccountIds: string[] | null = null
  let portalAccountNames: Map<string, string> | null = null
  let portalParams = ''
  if (portalSlug) {
    const result = verifyPortalAuth(portalSlug, portalToken || '')
    if (!result.allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    portalAccountIds = result.accountIds
    portalAccountNames = result.accountNames
    portalParams = `portal_slug=${encodeURIComponent(portalSlug)}&portal_token=${encodeURIComponent(portalToken || '')}`
    if (portalAccountIds.length === 0) {
      return new Response('<html><body style="background:var(--bg);color:#787f85;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">No ad accounts linked to this portal.</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
  } else {
    try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

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
    // Trigger background sync if data is stale (>4hrs) — non-blocking
    if (isSyncStale()) {
      syncAdsData(3).catch(console.error)
    }

    // For portal: validate the selected account is in the allowed list
    let effectiveAccountId = accountId
    if (portalAccountIds) {
      if (accountId && !portalAccountIds.includes(accountId)) {
        effectiveAccountId = null // Reset to all allowed accounts
      }
    }

    const performanceData = await fetchPerformanceData(effectiveAccountId, dateStart, dateEnd, portalAccountIds)
    const aggregated = aggregateByAdCampaign(performanceData)

    // Merge cached creative data into ads at render time (instant, no API calls)
    const creativeCache = getCreativeCacheSync()
    if (creativeCache) {
      for (const [, ad] of aggregated) {
        const creative = creativeCache.get(ad.ad_id)
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
          ad.conversionEvent = creative.conversionEvent
          ad.endDate = creative.endDate
          ad.bodyVariations = creative.bodyVariations || []
          ad.titleVariations = creative.titleVariations || []
        }
      }
    }

    let ads = Array.from(aggregated.values())
    if (sortBy === 'spend') {
      ads.sort((a, b) => b.spend - a.spend)
    } else if (sortBy === 'ctr') {
      ads.sort((a, b) => b.ctr - a.ctr)
    } else if (sortBy === 'hook') {
      ads.sort((a, b) => b.hook_rate - a.hook_rate)
    } else if (sortBy === 'engagement') {
      ads.sort((a, b) => b.engagementScore - a.engagementScore)
    }

    // Build account list for the dropdown (portal: only client's accounts; admin: all accounts)
    const dropdownAccounts = portalAccountIds
      ? portalAccountIds.map(id => ({ id, name: portalAccountNames?.get(id) || id, slug: '' }))
      : getAccounts()

    // JSON format for CLI / API consumers
    if (searchParams.get('format') === 'json' || request.headers.get('accept')?.includes('application/json')) {
      // Group by account for summary
      const byAccount = new Map<string, { account_name: string; total_spend: number; total_results: number; impressions: number; clicks: number; ads: number }>()
      for (const ad of ads) {
        const key = ad.account_name
        if (!byAccount.has(key)) {
          byAccount.set(key, { account_name: ad.account_name, total_spend: 0, total_results: 0, impressions: 0, clicks: 0, ads: 0 })
        }
        const acc = byAccount.get(key)!
        acc.total_spend += ad.spend || 0
        acc.total_results += ad.leads || 0
        acc.impressions += ad.impressions || 0
        acc.clicks += ad.clicks || 0
        acc.ads++
      }
      const accounts = Array.from(byAccount.values()).map(a => ({
        ...a,
        cpr: a.total_results > 0 ? a.total_spend / a.total_results : 0,
        ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0,
      }))
      return NextResponse.json({ accounts, ads, date_range: { start: dateStart, end: dateEnd }, total_ads: ads.length })
    }

    const html = renderDashboard(ads, effectiveAccountId, dateStart, dateEnd, sortBy, dropdownAccounts, portalParams)
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  } catch (err) {
    console.error('Dashboard error:', err)
    return new Response('Error loading dashboard', { status: 500 })
  }
}
