// Meta Graph API helper for fetching ad creatives, thumbnails, video sources, engagement
// Functions use getActiveToken() which prefers connected user OAuth tokens over env var
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || ''

// Rate-limiting knobs. Concurrent bursts across accounts are the bot signature Meta bans for.
const INTER_PAGE_DELAY_MS = 500
const INTER_ACCOUNT_DELAY_MS = 2000
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

import { getAllEnabledAdAccounts } from './db'

/** Get a valid access token -- prefers the first connected user's OAuth token, falls back to env var */
export function getActiveToken(): string {
  const accounts = getAllEnabledAdAccounts()
  if (accounts.length > 0 && accounts[0].token_expiry > Math.floor(Date.now() / 1000)) {
    return accounts[0].access_token
  }
  return META_ACCESS_TOKEN
}
const GRAPH_API_VERSION = 'v19.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface MetaAdCreative {
  id: string
  name: string
  thumbnailUrl: string | null
  imageUrl: string | null
  objectType: string | null
  videoId: string | null
  videoUrl: string | null
  effectiveStatus: string | null
  body: string | null
  title: string | null
  ctaType: string | null
  linkUrl: string | null
  adsetName: string | null
  campaignName: string | null
  optimizationGoal: string | null
  conversionEvent: string | null
  endDate: string | null
  bodyVariations: string[]
  titleVariations: string[]
}

export interface AdEngagementMetrics {
  adId: string
  reactions: number
  comments: number
  shares: number
  saves: number
  engagementScore: number
}

interface MetaApiError {
  error?: {
    message: string
    type: string
    code: number
  }
}

function upscaleThumbnail(url: string | null): string | null {
  if (!url) return null
  return url
    .replace(/p64x64/g, 'p1080x1080')
    .replace(/p128x128/g, 'p1080x1080')
    .replace(/p480x480/g, 'p1080x1080')
    .replace(/_q75_/g, '_q95_')
}

const customConversionNameCache = new Map<string, string>()

async function resolveCustomConversionName(customConversionId: string): Promise<string | null> {
  if (!getActiveToken()) return null
  try {
    const url = `${GRAPH_API_BASE}/${customConversionId}?access_token=${getActiveToken()}&fields=name`
    const resp = await fetch(url)
    const data = await resp.json() as MetaApiError & { name?: string }
    if (data.error) return null
    const name = (data.name || '').trim()
    return name || null
  } catch {
    return null
  }
}

export async function fetchAdCreatives(accountId: string): Promise<MetaAdCreative[]> {
  if (!getActiveToken()) return []
  const creatives: MetaAdCreative[] = []
  const customConversionLookup = new Map<string, Promise<string | null>>()
  let url = `${GRAPH_API_BASE}/${accountId}/ads?access_token=${getActiveToken()}&fields=id,name,effective_status,adset%7Bname,optimization_goal,promoted_object,end_time,start_time%7D,campaign%7Bname,stop_time,start_time%7D,creative%7Bthumbnail_url,image_url,image_hash,object_type,video_id,body,title,call_to_action_type,object_story_spec,asset_feed_spec,effective_object_story_id%7D&limit=50`
  let rateLimitRetries = 0

  while (url) {
    const response = await fetch(url)
    const data = await response.json() as MetaApiError & {
      data?: Array<{
        id: string
        name: string
        effective_status?: string
        adset?: {
          name?: string
          optimization_goal?: string
          end_time?: string
          start_time?: string
          promoted_object?: {
            custom_conversion_id?: string
            custom_event_type?: string
          }
        }
        campaign?: { name?: string; stop_time?: string; start_time?: string }
        creative?: {
          thumbnail_url?: string
          image_url?: string
          object_type?: string
          video_id?: string
          body?: string
          title?: string
          call_to_action_type?: string
          effective_object_story_id?: string
          object_story_spec?: {
            link_data?: { link?: string; message?: string; name?: string; description?: string; picture?: string; image_hash?: string; call_to_action?: { type?: string } }
            video_data?: { message?: string; title?: string; image_url?: string; call_to_action?: { type?: string; value?: { link?: string } } }
            photo_data?: { message?: string; caption?: string; url?: string }
          }
          asset_feed_spec?: {
            bodies?: Array<{ text: string }>
            titles?: Array<{ text: string }>
          }
        }
      }>
      paging?: { next?: string }
    }

    if (data.error) {
      const code = data.error.code
      if ((code === 17 || code === 32 || code === 613 || code === 4) && rateLimitRetries < 3) {
        rateLimitRetries++
        console.warn(`[meta-api] Rate limited (code ${code}), retry ${rateLimitRetries}/3 in 30s`)
        await new Promise(r => setTimeout(r, 30000))
        continue
      }
      console.error('Meta API error:', data.error.message)
      break
    }
    rateLimitRetries = 0

    if (data.data) {
      for (const ad of data.data) {
        const spec = ad.creative?.object_story_spec
        const promoted = ad.adset?.promoted_object
        let conversionEvent: string | null = null

        if (promoted?.custom_conversion_id) {
          const convId = promoted.custom_conversion_id
          let lookup = customConversionLookup.get(convId)
          if (!lookup) {
            lookup = (async () => {
              if (customConversionNameCache.has(convId)) {
                return customConversionNameCache.get(convId) || null
              }
              const resolved = await resolveCustomConversionName(convId)
              if (resolved) customConversionNameCache.set(convId, resolved)
              return resolved
            })()
            customConversionLookup.set(convId, lookup)
          }
          const resolvedName = await lookup
          conversionEvent = resolvedName || `custom_conversion:${convId}`
        } else if (promoted?.custom_event_type) {
          conversionEvent = promoted.custom_event_type
        }

        const linkUrl = spec?.link_data?.link || spec?.video_data?.call_to_action?.value?.link || null
        const ctaType = ad.creative?.call_to_action_type || spec?.link_data?.call_to_action?.type || spec?.video_data?.call_to_action?.type || null
        const body = ad.creative?.body
          || spec?.link_data?.message
          || spec?.video_data?.message
          || spec?.photo_data?.message
          || null
        const title = ad.creative?.title
          || spec?.link_data?.name
          || spec?.video_data?.title
          || null
        // Get the best available full-size image
        const imageUrl = ad.creative?.image_url
          || spec?.link_data?.picture
          || spec?.video_data?.image_url
          || spec?.photo_data?.url
          || null
        creatives.push({
          id: ad.id,
          name: ad.name,
          thumbnailUrl: upscaleThumbnail(ad.creative?.thumbnail_url || null),
          imageUrl,
          objectType: ad.creative?.object_type || null,
          videoId: ad.creative?.video_id || null,
          videoUrl: null,
          effectiveStatus: ad.effective_status || null,
          body,
          title,
          ctaType,
          linkUrl,
          adsetName: ad.adset?.name || null,
          campaignName: ad.campaign?.name || null,
          optimizationGoal: ad.adset?.optimization_goal || null,
          conversionEvent,
          endDate: ad.adset?.end_time || ad.campaign?.stop_time || null,
          bodyVariations: (ad.creative?.asset_feed_spec?.bodies || []).map(b => b.text),
          titleVariations: (ad.creative?.asset_feed_spec?.titles || []).map(t => t.text),
        })
      }
    }

    url = data.paging?.next || ''
    if (url) await sleep(INTER_PAGE_DELAY_MS)
  }

  return creatives
}

export async function fetchAdAccounts(): Promise<Array<{ id: string; name: string }>> {
  if (!getActiveToken()) return []
  const url = `${GRAPH_API_BASE}/me/adaccounts?access_token=${getActiveToken()}&fields=name,account_id`
  const response = await fetch(url)
  const data = await response.json() as MetaApiError & {
    data?: Array<{ id: string; name: string; account_id: string }>
  }
  if (data.error) {
    console.error('Meta API error:', data.error.message)
    return []
  }
  return (data.data || []).map(acc => ({ id: acc.id, name: acc.name }))
}

export async function fetchVideoSource(videoId: string): Promise<string | null> {
  if (!getActiveToken()) return null

  // Try with user token first
  async function tryWithToken(token: string): Promise<string | null> {
    const url = `${GRAPH_API_BASE}/${videoId}?access_token=${token}&fields=source,format`
    const response = await fetch(url)
    const data = await response.json() as MetaApiError & {
      source?: string
      format?: Array<{ embed_html: string; filter: string; width: number; height: number }>
    }
    if (data.source) return data.source
    if (data.format && data.format.length > 0) {
      const nativeFormat = data.format.find(f => f.filter === 'native') || data.format[data.format.length - 1]
      if (nativeFormat?.embed_html) {
        const match = nativeFormat.embed_html.match(/src="([^"]+)"/)
        if (match) return `embed:${match[1]}`
      }
    }
    return null
  }

  try {
    // 1. Try user token
    const result = await tryWithToken(getActiveToken())
    if (result) return result

    // 2. Try each page token (video may belong to a page)
    const pagesResp = await fetch(`${GRAPH_API_BASE}/me/accounts?access_token=${getActiveToken()}&fields=access_token&limit=50`)
    const pagesData = await pagesResp.json() as { data?: Array<{ access_token: string }> }
    if (pagesData.data) {
      for (const page of pagesData.data) {
        const pageResult = await tryWithToken(page.access_token)
        if (pageResult) return pageResult
      }
    }

    return null
  } catch (err) {
    console.error('Error fetching video source:', err)
    return null
  }
}

export async function fetchAdThumbnailBuffer(adId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const cache = getCreativeCacheSync()
  const creative = cache?.get(adId)
  const MIN_SIZE = 3000 // min bytes for a usable image

  async function tryFetchImage(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const resp = await fetch(url, { redirect: 'follow' })
      if (!resp.ok) return null
      const contentType = resp.headers.get('content-type') || 'image/jpeg'
      const buffer = Buffer.from(await resp.arrayBuffer())
      return buffer.length > MIN_SIZE ? { buffer, contentType } : null
    } catch { return null }
  }

  // 1. For VIDEO ads, fetch HD frame from /{videoId}/thumbnails
  if (creative?.videoId && getActiveToken()) {
    try {
      const vidResp = await fetch(`${GRAPH_API_BASE}/${creative.videoId}/thumbnails?access_token=${getActiveToken()}`)
      const vidData = await vidResp.json() as MetaApiError & { data?: Array<{ uri: string; width: number; height: number }> }
      if (vidData.data && vidData.data.length > 0) {
        const best = vidData.data.reduce((a, b) => (b.width > a.width ? b : a), vidData.data[0])
        const result = await tryFetchImage(best.uri)
        if (result) return result
      }
    } catch { /* fall through */ }
  }

  // 2. Try imageUrl (may be facebook.com/ads/image redirect -> full-size CDN)
  if (creative?.imageUrl) {
    const result = await tryFetchImage(creative.imageUrl)
    if (result) return result
  }

  // 3. For any ad with a videoId, try the video's picture field directly
  if (creative?.videoId && getActiveToken()) {
    try {
      const vidResp = await fetch(`${GRAPH_API_BASE}/${creative.videoId}?access_token=${getActiveToken()}&fields=source,picture`)
      const vidData = await vidResp.json() as { picture?: string }
      if (vidData.picture) {
        const result = await tryFetchImage(vidData.picture)
        if (result) return result
      }
    } catch { /* fall through */ }
  }

  // 4. Try thumbnailUrl from cache (may be small but better than nothing)
  if (creative?.thumbnailUrl) {
    const result = await tryFetchImage(creative.thumbnailUrl)
    if (result) return result
  }

  // Last resort fallback: fetch from Meta API directly with full image fields
  if (!getActiveToken()) return null
  const url = `${GRAPH_API_BASE}/${adId}?access_token=${getActiveToken()}&fields=creative%7Bthumbnail_url,image_url,object_type,effective_object_story_id,object_story_spec%7D`
  try {
    const response = await fetch(url)
    const data = await response.json() as MetaApiError & {
      creative?: {
        thumbnail_url?: string
        image_url?: string
        object_type?: string
        effective_object_story_id?: string
        object_story_spec?: {
          video_data?: { image_url?: string }
          link_data?: { picture?: string }
        }
      }
    }
    if (data.error) {
      console.error('Meta API error fetching thumbnail:', data.error.message)
      return null
    }

    // Try fetching full_picture from the post (highest quality for SHARE ads)
    const storyId = data.creative?.effective_object_story_id
    if (storyId) {
      try {
        const postResp = await fetch(`${GRAPH_API_BASE}/${storyId}?access_token=${getActiveToken()}&fields=full_picture`)
        const postData = await postResp.json() as MetaApiError & { full_picture?: string }
        if (postData.full_picture) {
          const fpResp = await fetch(postData.full_picture)
          if (fpResp.ok) {
            const buf = Buffer.from(await fpResp.arrayBuffer())
            if (buf.length > 5000) return { buffer: buf, contentType: fpResp.headers.get('content-type') || 'image/jpeg' }
          }
        }
      } catch { /* fall through */ }
    }

    const spec = data.creative?.object_story_spec
    const thumbUrl = spec?.video_data?.image_url
      || spec?.link_data?.picture
      || data.creative?.image_url
      || data.creative?.thumbnail_url
      || null
    if (!thumbUrl) return null
    const imgResponse = await fetch(thumbUrl)
    if (!imgResponse.ok) return null
    const contentType = imgResponse.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await imgResponse.arrayBuffer())
    return { buffer, contentType }
  } catch (err) {
    console.error('Error fetching ad thumbnail:', err)
    return null
  }
}

// Caches — in-memory + disk persistence
import { readFileSync, writeFileSync, existsSync } from 'fs'
const CREATIVE_CACHE_PATH = '/tmp/ctrl-creative-cache.json'
let creativeCache: Map<string, MetaAdCreative> | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

function writeCacheToDisk(map: Map<string, MetaAdCreative>) {
  try {
    const obj: Record<string, MetaAdCreative> = {}
    for (const [k, v] of map) obj[k] = v
    writeFileSync(CREATIVE_CACHE_PATH, JSON.stringify({ ts: Date.now(), data: obj }))
  } catch { /* ignore write errors */ }
}

function readCacheFromDisk(): Map<string, MetaAdCreative> | null {
  try {
    if (!existsSync(CREATIVE_CACHE_PATH)) return null
    const raw = JSON.parse(readFileSync(CREATIVE_CACHE_PATH, 'utf-8'))
    if (!raw.data || (Date.now() - raw.ts) > CACHE_TTL_MS) return null
    const map = new Map<string, MetaAdCreative>()
    for (const [k, v] of Object.entries(raw.data)) map.set(k, v as MetaAdCreative)
    cacheTimestamp = raw.ts
    return map
  } catch { return null }
}

/** Get cached creative data instantly (no API calls). Returns null if no cache. */
export function getCreativeCacheSync(): Map<string, MetaAdCreative> | null {
  if (creativeCache && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) return creativeCache
  const disk = readCacheFromDisk()
  if (disk) {
    creativeCache = disk
    return disk
  }
  return null
}

export function clearCreativeCache() {
  creativeCache = null
  cacheTimestamp = 0
  try { if (existsSync(CREATIVE_CACHE_PATH)) writeFileSync(CREATIVE_CACHE_PATH, '') } catch { /* */ }
}

const engagementCache = new Map<string, { data: Map<string, AdEngagementMetrics>; ts: number }>()
const ENGAGEMENT_CACHE_TTL = 15 * 60 * 1000

// Thumbnail buffer cache (30 min)
const thumbCache = new Map<string, { buffer: Buffer; contentType: string; ts: number }>()
const THUMB_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

export async function getCachedThumbnail(adId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const cached = thumbCache.get(adId)
  if (cached && (Date.now() - cached.ts) < THUMB_CACHE_TTL) {
    return { buffer: cached.buffer, contentType: cached.contentType }
  }
  const result = await fetchAdThumbnailBuffer(adId)
  if (result) {
    thumbCache.set(adId, { ...result, ts: Date.now() })
  }
  return result
}

export async function fetchAdEngagement(
  accountId: string,
  dateStart: string,
  dateEnd: string
): Promise<Map<string, AdEngagementMetrics>> {
  if (!getActiveToken()) return new Map()
  const cacheKey = `${accountId}:${dateStart}:${dateEnd}`
  const cached = engagementCache.get(cacheKey)
  if (cached && (Date.now() - cached.ts) < ENGAGEMENT_CACHE_TTL) {
    return cached.data
  }

  const metrics = new Map<string, AdEngagementMetrics>()
  let url = `${GRAPH_API_BASE}/${accountId}/insights?access_token=${getActiveToken()}&level=ad&fields=ad_id,impressions,actions&time_range={"since":"${dateStart}","until":"${dateEnd}"}&limit=500`
  let rateLimitRetries = 0

  while (url) {
    try {
      const response = await fetch(url)
      const data = await response.json() as MetaApiError & {
        data?: Array<{
          ad_id: string
          impressions: string
          actions?: Array<{ action_type: string; value: string }>
        }>
        paging?: { next?: string }
      }
      if (data.error) {
        const code = data.error.code
        if ((code === 17 || code === 32 || code === 613 || code === 4) && rateLimitRetries < 3) {
          rateLimitRetries++
          console.warn(`[meta-api] Engagement rate limited (code ${code}), retry ${rateLimitRetries}/3 in 30s`)
          await new Promise(r => setTimeout(r, 30000))
          continue
        }
        console.error('Meta API error fetching engagement:', data.error.message)
        break
      }
      rateLimitRetries = 0
      if (data.data) {
        for (const insight of data.data) {
          let reactions = 0, comments = 0, shares = 0, saves = 0
          if (insight.actions) {
            for (const action of insight.actions) {
              switch (action.action_type) {
                case 'post_reaction': case 'like': reactions += parseInt(action.value) || 0; break
                case 'comment': comments += parseInt(action.value) || 0; break
                case 'post': shares += parseInt(action.value) || 0; break
                case 'onsite_web_save': saves += parseInt(action.value) || 0; break
              }
            }
          }
          const impressions = parseInt(insight.impressions) || 0
          const engagementScore = impressions > 0 ? ((reactions + comments * 2 + shares * 3) / impressions) * 100 : 0
          metrics.set(insight.ad_id, { adId: insight.ad_id, reactions, comments, shares, saves, engagementScore })
        }
      }
      url = data.paging?.next || ''
    } catch (err) {
      console.error('Error fetching engagement metrics:', err)
      break
    }
  }

  engagementCache.set(cacheKey, { data: metrics, ts: Date.now() })
  return metrics
}

export async function buildCreativeMap(accountIds: string[]): Promise<Map<string, MetaAdCreative>> {
  const now = Date.now()
  if (creativeCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return creativeCache
  }
  // Try disk cache before hitting Meta API
  const diskCache = readCacheFromDisk()
  if (diskCache) {
    creativeCache = diskCache
    return diskCache
  }
  const map = new Map<string, MetaAdCreative>()
  // Sequential — parallel account fetches on one token reads as bot traffic to Meta.
  for (let i = 0; i < accountIds.length; i++) {
    const creatives = await fetchAdCreatives(accountIds[i])
    for (const creative of creatives) {
      map.set(creative.id, creative)
    }
    if (i < accountIds.length - 1) await sleep(INTER_ACCOUNT_DELAY_MS)
  }
  creativeCache = map
  cacheTimestamp = now
  writeCacheToDisk(map)
  return map
}
