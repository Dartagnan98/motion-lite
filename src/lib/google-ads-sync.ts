// Google Ads -> Supabase sync engine
// Mirrors ads-sync.ts pattern but for Google Ads API via GAQL + REST
import { getAllEnabledGoogleAdsAccounts } from './db'
import { refreshGoogleAdsToken, executeGaqlQuery } from './google-ads'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''

// Sync state
let lastSyncTimestamp = 0
let syncInProgress = false
const SYNC_COOLDOWN = 4 * 60 * 60 * 1000 // 4 hours

export function getLastGoogleAdsSyncTime() { return lastSyncTimestamp }
export function isGoogleAdsSyncInProgress() { return syncInProgress }
export function isGoogleAdsSyncStale() { return (Date.now() - lastSyncTimestamp) > SYNC_COOLDOWN }

interface GoogleAdsInsightRow {
  date: string
  customer_id: string
  account_name: string
  client_slug: string
  campaign_id: string
  campaign_name: string
  campaign_type: string | null
  campaign_status: string | null
  bidding_strategy_type: string | null
  ad_group_id: string | null
  ad_group_name: string | null
  cost: number
  impressions: number
  clicks: number
  ctr: number
  avg_cpc: number
  avg_cpm: number
  conversions: number
  conversion_value: number
  cost_per_conversion: number
  conversion_rate: number
  roas: number
  search_impression_share: number | null
  search_lost_is_budget: number | null
  search_lost_is_rank: number | null
  search_top_impression_share: number | null
  search_abs_top_impression_share: number | null
  absolute_top_impression_pct: number | null
  top_impression_pct: number | null
  all_conversions: number
  all_conversions_value: number
  view_through_conversions: number
  video_views: number
  video_view_rate: number
  engagements: number
  engagement_rate: number
  interactions: number
  interaction_rate: number
}

// Map Google's channel type enum to readable names
function mapChannelType(type: string | undefined): string {
  if (!type) return 'UNKNOWN'
  const map: Record<string, string> = {
    'SEARCH': 'SEARCH',
    'DISPLAY': 'DISPLAY',
    'SHOPPING': 'SHOPPING',
    'VIDEO': 'VIDEO',
    'MULTI_CHANNEL': 'PMAX',
    'PERFORMANCE_MAX': 'PMAX',
    'LOCAL': 'LOCAL',
    'SMART': 'SMART',
    'DISCOVERY': 'DEMAND_GEN',
    'DEMAND_GEN': 'DEMAND_GEN',
  }
  return map[type] || type
}

// Campaign-level query: catches every campaign type (Search, Display, PMax,
// Video, Discovery, Local) including those without ad_groups. Runs off the
// `campaign` resource so impression-share metrics are available.
function buildGaqlQuery(dateStart: string, dateEnd: string): string {
  return `
    SELECT
      segments.date,
      customer.id,
      customer.descriptive_name,
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign.status,
      campaign.bidding_strategy_type,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.average_cpm,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion,
      metrics.all_conversions,
      metrics.all_conversions_value,
      metrics.view_through_conversions,
      metrics.interactions,
      metrics.interaction_rate,
      metrics.engagements,
      metrics.engagement_rate,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share,
      metrics.search_top_impression_share,
      metrics.search_absolute_top_impression_share,
      metrics.absolute_top_impression_percentage,
      metrics.top_impression_percentage
    FROM campaign
    WHERE segments.date BETWEEN '${dateStart}' AND '${dateEnd}'
    ORDER BY segments.date DESC
  `.trim()
}

async function fetchGoogleAdsInsights(
  accessToken: string,
  customerId: string,
  accountName: string,
  slug: string,
  dateStart: string,
  dateEnd: string
): Promise<GoogleAdsInsightRow[]> {
  const rows: GoogleAdsInsightRow[] = []
  const query = buildGaqlQuery(dateStart, dateEnd)

  const results = await executeGaqlQuery(accessToken, customerId, query)

  for (const batch of results) {
    if (!batch.results) continue
    for (const result of batch.results) {
      const r = result as {
        segments?: { date?: string }
        customer?: { id?: string; descriptiveName?: string }
        campaign?: { id?: string; name?: string; advertisingChannelType?: string; status?: string; biddingStrategyType?: string }
        metrics?: {
          costMicros?: string
          impressions?: string
          clicks?: string
          ctr?: number
          averageCpc?: string
          averageCpm?: string
          conversions?: number
          conversionsValue?: number
          costPerConversion?: number
          allConversions?: number
          allConversionsValue?: number
          viewThroughConversions?: string
          interactions?: string
          interactionRate?: number
          engagements?: string
          engagementRate?: number
          videoViews?: string
          videoViewRate?: number
          searchImpressionShare?: number
          searchBudgetLostImpressionShare?: number
          searchRankLostImpressionShare?: number
          searchTopImpressionShare?: number
          searchAbsoluteTopImpressionShare?: number
          absoluteTopImpressionPercentage?: number
          topImpressionPercentage?: number
        }
      }

      const costMicros = parseInt(r.metrics?.costMicros || '0')
      const cost = costMicros / 1_000_000
      const impressions = parseInt(r.metrics?.impressions || '0')
      const clicks = parseInt(r.metrics?.clicks || '0')
      const avgCpmMicros = parseInt(r.metrics?.averageCpm || '0')
      const avgCpm = avgCpmMicros / 1_000_000
      const conversions = r.metrics?.conversions || 0
      const conversionValue = r.metrics?.conversionsValue || 0

      rows.push({
        date: r.segments?.date || dateStart,
        customer_id: customerId,
        account_name: accountName,
        client_slug: slug,
        campaign_id: String(r.campaign?.id || ''),
        campaign_name: r.campaign?.name || 'Unknown',
        campaign_type: mapChannelType(r.campaign?.advertisingChannelType),
        campaign_status: r.campaign?.status || null,
        bidding_strategy_type: r.campaign?.biddingStrategyType || null,
        ad_group_id: null,           // campaign-level rows
        ad_group_name: null,
        cost,
        impressions,
        clicks,
        ctr: r.metrics?.ctr || (impressions > 0 ? clicks / impressions : 0),
        avg_cpc: cost > 0 && clicks > 0 ? cost / clicks : 0,
        avg_cpm: avgCpm,
        conversions,
        conversion_value: conversionValue,
        cost_per_conversion: conversions > 0 ? cost / conversions : 0,
        conversion_rate: clicks > 0 ? (conversions / clicks) * 100 : 0,
        roas: cost > 0 ? conversionValue / cost : 0,
        search_impression_share: r.metrics?.searchImpressionShare ?? null,
        search_lost_is_budget: r.metrics?.searchBudgetLostImpressionShare ?? null,
        search_lost_is_rank: r.metrics?.searchRankLostImpressionShare ?? null,
        search_top_impression_share: r.metrics?.searchTopImpressionShare ?? null,
        search_abs_top_impression_share: r.metrics?.searchAbsoluteTopImpressionShare ?? null,
        absolute_top_impression_pct: r.metrics?.absoluteTopImpressionPercentage ?? null,
        top_impression_pct: r.metrics?.topImpressionPercentage ?? null,
        all_conversions: r.metrics?.allConversions || 0,
        all_conversions_value: r.metrics?.allConversionsValue || 0,
        view_through_conversions: parseInt(r.metrics?.viewThroughConversions || '0'),
        video_views: 0,
        video_view_rate: 0,
        engagements: parseInt(r.metrics?.engagements || '0'),
        engagement_rate: r.metrics?.engagementRate || 0,
        interactions: parseInt(r.metrics?.interactions || '0'),
        interaction_rate: r.metrics?.interactionRate || 0,
      })
    }
  }

  return rows
}

async function upsertToSupabase(rows: GoogleAdsInsightRow[]): Promise<number> {
  let inserted = 0
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    // Replace null ad_group_id with '' so the unique constraint groups properly
    const safe = batch.map(r => ({ ...r, ad_group_id: r.ad_group_id || '' }))
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/google_ads_daily?on_conflict=date,customer_id,campaign_id,ad_group_id`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(safe),
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[google-ads-sync] Upsert error:`, resp.status, text.substring(0, 300))
    } else {
      inserted += batch.length
    }
  }
  return inserted
}

export async function syncGoogleAdsData(daysBack = 3, accountFilter?: string): Promise<{ ok: boolean; rows: number; error?: string }> {
  if (syncInProgress) return { ok: false, rows: 0, error: 'Sync already in progress' }
  if (!DEV_TOKEN) return { ok: false, rows: 0, error: 'GOOGLE_ADS_DEVELOPER_TOKEN not configured' }

  const allAccounts = getAllEnabledGoogleAdsAccounts()
  if (allAccounts.length === 0) {
    return { ok: false, rows: 0, error: 'No connected Google Ads accounts. Connect in Settings > Google Ads.' }
  }

  syncInProgress = true
  let totalRows = 0

  try {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(endDate.getDate() - daysBack)
    const dateStart = startDate.toISOString().split('T')[0]
    const dateEnd = endDate.toISOString().split('T')[0]

    const accounts = accountFilter
      ? allAccounts.filter(a => a.customer_id === accountFilter)
      : allAccounts

    console.log(`[google-ads-sync] Syncing ${daysBack} days (${dateStart} to ${dateEnd}) for ${accounts.length} accounts`)

    for (const account of accounts) {
      // Refresh token if needed
      let token = account.access_token
      const now = Math.floor(Date.now() / 1000)
      if (account.token_expiry < now + 300) {
        try {
          token = await refreshGoogleAdsToken(account.user_id)
        } catch (err) {
          console.warn(`[google-ads-sync] Token refresh failed for ${account.account_name}:`, err)
          continue
        }
      }

      try {
        const rows = await fetchGoogleAdsInsights(
          token,
          account.customer_id,
          account.account_name,
          account.client_slug || '',
          dateStart,
          dateEnd
        )
        let inserted = 0
        if (rows.length > 0) {
          inserted = await upsertToSupabase(rows)
          totalRows += inserted
        }
        console.log(`[google-ads-sync] ${account.account_name}: ${rows.length} fetched, ${inserted} written`)
      } catch (err) {
        console.error(`[google-ads-sync] Error syncing ${account.account_name}:`, err)
      }

      // Small delay between accounts
      await new Promise(r => setTimeout(r, 1000))
    }

    lastSyncTimestamp = Date.now()
    console.log(`[google-ads-sync] Done! ${totalRows} total rows synced`)
    return { ok: true, rows: totalRows }
  } catch (err) {
    console.error('[google-ads-sync] Sync failed:', err)
    return { ok: false, rows: totalRows, error: String(err) }
  } finally {
    syncInProgress = false
  }
}

// Auto-sync scheduler
let autoSyncScheduled = false
export function scheduleGoogleAdsAutoSync() {
  if (autoSyncScheduled) return
  if (!DEV_TOKEN) return // Don't schedule if no dev token
  autoSyncScheduled = true

  setTimeout(() => {
    if (isGoogleAdsSyncStale()) {
      console.log('[google-ads-sync] Auto-sync triggered (stale data)')
      syncGoogleAdsData(3).catch(console.error)
    }
  }, 15000) // 15s after startup

  setInterval(() => {
    if (isGoogleAdsSyncStale() && !syncInProgress) {
      console.log('[google-ads-sync] Scheduled sync triggered')
      syncGoogleAdsData(3).catch(console.error)
    }
  }, SYNC_COOLDOWN)
}
