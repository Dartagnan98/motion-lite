// Meta Ads → Supabase sync engine
// Uses per-user OAuth tokens from connected Facebook accounts

import { getAllEnabledAdAccounts } from './db'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const GRAPH_API = 'https://graph.facebook.com/v19.0'

// Sync state
let lastSyncTimestamp = 0
let syncInProgress = false
const SYNC_COOLDOWN = 4 * 60 * 60 * 1000 // 4 hours

export function getLastSyncTime() { return lastSyncTimestamp }
export function isSyncInProgress() { return syncInProgress }
export function isSyncStale() { return (Date.now() - lastSyncTimestamp) > SYNC_COOLDOWN }

interface InsightRow {
  date: string
  ad_id: string
  ad_name: string
  account_id: string
  account_name: string
  client_slug: string
  campaign_id: string
  campaign_name: string
  ad_set_id: string | null
  ad_set_name: string | null
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  ctr: number
  cpc: number
  cpm: number
  leads: number
  cpl: number
  purchases: number
  purchase_value: number
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
}

async function fetchInsights(
  accessToken: string,
  accountId: string, accountName: string, slug: string,
  dateStart: string, dateEnd: string,
  userId?: number
): Promise<InsightRow[]> {
  const rows: InsightRow[] = []
  let url: string | null = `${GRAPH_API}/${accountId}/insights?access_token=${accessToken}&level=ad&fields=ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,action_values,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,reach,frequency,cpm,cpc,ctr&time_range={"since":"${dateStart}","until":"${dateEnd}"}&time_increment=1&limit=500`
  let rateLimitRetries = 0

  while (url) {
    try {
      const resp = await fetch(url)
      const data = await resp.json() as {
        error?: { message: string; code: number }
        data?: Array<{
          date_start: string
          ad_id: string; ad_name: string
          campaign_id: string; campaign_name: string
          adset_id?: string; adset_name?: string
          spend?: string; impressions?: string; clicks?: string
          ctr?: string; cpc?: string; cpm?: string
          reach?: string; frequency?: string
          actions?: Array<{ action_type: string; value: string }>
          action_values?: Array<{ action_type: string; value: string }>
          video_thruplay_watched_actions?: Array<{ value: string }>
          video_p25_watched_actions?: Array<{ value: string }>
          video_p50_watched_actions?: Array<{ value: string }>
          video_p75_watched_actions?: Array<{ value: string }>
          video_p95_watched_actions?: Array<{ value: string }>
        }>
        paging?: { next?: string }
      }

      if (data.error) {
        const code = data.error.code
        if ((code === 4 || code === 17 || code === 32 || code === 613) && rateLimitRetries < 3) {
          rateLimitRetries++
          console.warn(`[ads-sync] Rate limited for ${accountName} (code ${code}), retry ${rateLimitRetries}/3 in 30s`)
          await new Promise(r => setTimeout(r, 30000))
          continue
        }
        console.error(`[ads-sync] Error for ${accountName}:`, data.error.message)
        break
      }
      rateLimitRetries = 0

      if (data.data) {
        for (const row of data.data) {
          const actions = row.actions || []
          const actionValues = row.action_values || []
          const PURCHASE_TYPES = ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase']
          const LEAD_TYPES = [
            'lead',
            'onsite_conversion.lead_grouped',
            'offsite_conversion.fb_pixel_lead',
            'offsite_conversion.fb_pixel_complete_registration',
            'complete_registration',
            'offsite_conversion.fb_pixel_submit_application',
            'submit_application'
          ]
          const isLeadActionType = (actionType: string) =>
            LEAD_TYPES.includes(actionType) ||
            /(^|[._])(lead|complete_registration|submit_application|contact|schedule|book)([._]|$)/.test(actionType)

          const leads = actions
            .filter(a => isLeadActionType(a.action_type))
            .reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const purchases = actions
            .filter(a => PURCHASE_TYPES.includes(a.action_type))
            .reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const purchaseValue = actionValues
            .filter(a => PURCHASE_TYPES.includes(a.action_type))
            .reduce((s, a) => s + parseFloat(a.value || '0'), 0)
          const linkClicks = actions
            .filter(a => a.action_type === 'link_click')
            .reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const videoViews = actions
            .filter(a => a.action_type === 'video_view')
            .reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const impressions = parseInt(row.impressions || '0')
          const spend = parseFloat(row.spend || '0')
          const clicks = parseInt(row.clicks || '0')

          const videoThruplay = (row.video_thruplay_watched_actions || []).reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const videoP25 = (row.video_p25_watched_actions || []).reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const videoP50 = (row.video_p50_watched_actions || []).reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const videoP75 = (row.video_p75_watched_actions || []).reduce((s, a) => s + parseInt(a.value || '0'), 0)
          const videoP95 = (row.video_p95_watched_actions || []).reduce((s, a) => s + parseInt(a.value || '0'), 0)

          const hookRate = impressions > 0 ? (videoViews / impressions) * 100 : 0
          const holdRate = videoViews > 0 ? (videoThruplay / videoViews) * 100 : 0
          const cpl = leads > 0 ? spend / leads : 0

          rows.push({
            date: row.date_start,
            ad_id: row.ad_id, ad_name: row.ad_name,
            account_id: accountId, account_name: accountName, client_slug: slug,
            campaign_id: row.campaign_id, campaign_name: row.campaign_name,
            ad_set_id: row.adset_id || null, ad_set_name: row.adset_name || null,
            spend, impressions, clicks, link_clicks: linkClicks,
            ctr: parseFloat(row.ctr || '0'), cpc: parseFloat(row.cpc || '0'), cpm: parseFloat(row.cpm || '0'),
            leads, cpl, purchases, purchase_value: purchaseValue, hook_rate: hookRate, hold_rate: holdRate,
            video_views: videoViews, video_thruplay: videoThruplay,
            video_p25_watched: videoP25, video_p50_watched: videoP50,
            video_p75_watched: videoP75, video_p95_watched: videoP95,
            reach: parseInt(row.reach || '0'), frequency: parseFloat(row.frequency || '0'),
          })
        }
      }

      url = data.paging?.next || null
      if (url) await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.error(`[ads-sync] Fetch error for ${accountName}:`, err)
      break
    }
  }

  return rows
}

async function upsertToSupabase(rows: InsightRow[]) {
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/ad_performance_daily?on_conflict=date,ad_id`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    })
    if (!resp.ok) {
      const text = await resp.text()
      console.error(`[ads-sync] Upsert error:`, resp.status, text.substring(0, 200))
    }
  }
}

/**
 * Sync recent ad data from Meta API to Supabase.
 * Uses per-user OAuth tokens from connected Facebook accounts.
 * @param daysBack How many days to sync (default 3 for freshness, use 90 for backfill)
 * @param accountFilter Optional single account ID to sync
 */
export async function syncAdsData(daysBack = 3, accountFilter?: string): Promise<{ ok: boolean; rows: number; error?: string }> {
  if (syncInProgress) return { ok: false, rows: 0, error: 'Sync already in progress' }

  // Get all enabled ad accounts with their user's Facebook token
  const allAccounts = getAllEnabledAdAccounts()

  if (allAccounts.length === 0) {
    return { ok: false, rows: 0, error: 'No connected ad accounts. Connect Facebook in Settings > Meta Ads and select accounts.' }
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
      ? allAccounts.filter(a => a.account_id === accountFilter)
      : allAccounts

    console.log(`[ads-sync] Syncing ${daysBack} days (${dateStart} to ${dateEnd}) for ${accounts.length} accounts`)

    for (const account of accounts) {
      const now = Math.floor(Date.now() / 1000)
      if (account.token_expiry < now) {
        console.warn(`[ads-sync] Skipping ${account.account_name}: token expired`)
        continue
      }

      const rows = await fetchInsights(
        account.access_token,
        account.account_id,
        account.account_name,
        account.client_slug || '',
        dateStart, dateEnd,
        account.user_id
      )
      if (rows.length > 0) {
        await upsertToSupabase(rows)
        totalRows += rows.length
      }
      console.log(`[ads-sync] ${account.account_name}: ${rows.length} rows`)
      // Small delay between accounts to avoid rate limits
      await new Promise(r => setTimeout(r, 1500))
    }

    lastSyncTimestamp = Date.now()
    console.log(`[ads-sync] Done! ${totalRows} total rows synced`)
    return { ok: true, rows: totalRows }
  } catch (err) {
    console.error('[ads-sync] Sync failed:', err)
    return { ok: false, rows: totalRows, error: String(err) }
  } finally {
    syncInProgress = false
  }
}

// Auto-sync: check on import if we should sync in background
let autoSyncScheduled = false
export function scheduleAutoSync() {
  if (autoSyncScheduled) return
  autoSyncScheduled = true
  // Run first sync after 10s (let server start up)
  setTimeout(() => {
    if (isSyncStale()) {
      console.log('[ads-sync] Auto-sync triggered (stale data)')
      syncAdsData(3).catch(console.error)
    }
  }, 10000)
  // Then check every 4 hours
  setInterval(() => {
    if (isSyncStale() && !syncInProgress) {
      console.log('[ads-sync] Scheduled sync triggered')
      syncAdsData(3).catch(console.error)
    }
  }, SYNC_COOLDOWN)
}
