// Meta Marketing API - Campaign Management (create, update, delete campaigns/adsets/ads)
// Uses the same token infrastructure as meta-api.ts

import { createHash } from 'crypto'
import { getActiveToken } from './meta-api'

const GRAPH_API_VERSION = 'v19.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

// ─── Types ───

export interface CampaignParams {
  name: string
  objective: string // OUTCOME_AWARENESS | OUTCOME_ENGAGEMENT | OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_APP_PROMOTION
  status?: string   // ACTIVE | PAUSED
  special_ad_categories?: string[] // NONE | HOUSING | EMPLOYMENT | CREDIT | ISSUES_ELECTIONS_POLITICS
  daily_budget?: number  // in cents
  lifetime_budget?: number // in cents
  bid_strategy?: string // LOWEST_COST_WITHOUT_CAP | LOWEST_COST_WITH_BID_CAP | COST_CAP | MINIMUM_ROAS
  buying_type?: string  // AUCTION | RESERVED
}

export interface AdSetParams {
  name: string
  campaign_id: string
  billing_event: string // IMPRESSIONS | LINK_CLICKS | APP_INSTALLS
  optimization_goal: string // REACH | IMPRESSIONS | LINK_CLICKS | LANDING_PAGE_VIEWS | LEAD_GENERATION | CONVERSIONS | VALUE | APP_INSTALLS | OFFSITE_CONVERSIONS | MESSAGES
  daily_budget?: number  // in cents
  lifetime_budget?: number // in cents
  bid_amount?: number  // in cents (for manual bidding)
  bid_strategy?: string
  start_time?: string  // ISO 8601
  end_time?: string    // ISO 8601
  status?: string      // ACTIVE | PAUSED
  targeting: TargetingSpec
  promoted_object?: {
    pixel_id?: string
    custom_event_type?: string // LEAD | PURCHASE | ADD_TO_CART | COMPLETE_REGISTRATION | CONTACT | CUSTOMIZE_PRODUCT | DONATE | FIND_LOCATION | INITIATED_CHECKOUT | SCHEDULE | SEARCH | START_TRIAL | SUBMIT_APPLICATION | SUBSCRIBE | VIEW_CONTENT | OTHER
    page_id?: string
    application_id?: string
    offer_id?: string
  }
  destination_type?: string // WEBSITE | APP | MESSENGER | INSTAGRAM_DIRECT | WHATSAPP | ON_AD | ON_POST | ON_VIDEO | ON_EVENT | SHOP | UNDEFINED
}

export interface TargetingSpec {
  age_min?: number     // 18-65
  age_max?: number     // 18-65
  genders?: number[]   // [0] = all, [1] = male, [2] = female
  geo_locations?: {
    countries?: string[]     // e.g. ["CA", "US"]
    regions?: Array<{ key: string; name?: string }>
    cities?: Array<{ key: string; name?: string; radius?: number; distance_unit?: string }>
    zips?: Array<{ key: string }>
    custom_locations?: Array<{ latitude: number; longitude: number; radius: number; distance_unit: string; name?: string }>
  }
  excluded_geo_locations?: {
    countries?: string[]
    regions?: Array<{ key: string }>
    cities?: Array<{ key: string }>
  }
  locales?: number[]  // language codes
  flexible_spec?: Array<{
    interests?: Array<{ id: string; name: string }>
    behaviors?: Array<{ id: string; name: string }>
    life_events?: Array<{ id: string; name: string }>
    family_statuses?: Array<{ id: string; name: string }>
    industries?: Array<{ id: string; name: string }>
    income?: Array<{ id: string; name: string }>
    work_employers?: Array<{ id: string; name: string }>
    work_positions?: Array<{ id: string; name: string }>
    education_schools?: Array<{ id: string; name: string }>
    education_majors?: Array<{ id: string; name: string }>
  }>
  exclusions?: {
    interests?: Array<{ id: string; name: string }>
    behaviors?: Array<{ id: string; name: string }>
  }
  custom_audiences?: Array<{ id: string; name?: string }>
  excluded_custom_audiences?: Array<{ id: string; name?: string }>
  publisher_platforms?: string[] // facebook | instagram | audience_network | messenger
  facebook_positions?: string[] // feed | right_hand_column | instant_article | marketplace | video_feeds | story | search | reels | profile_feed
  instagram_positions?: string[] // stream | story | explore | reels | profile_feed | ig_search
  messenger_positions?: string[] // messenger_home | sponsored_messages | story
  device_platforms?: string[] // mobile | desktop
}

export interface AdCreativeParams {
  name: string
  object_story_spec?: {
    page_id: string
    instagram_actor_id?: string
    link_data?: {
      link: string
      message?: string
      name?: string       // headline
      description?: string // description under headline
      caption?: string
      call_to_action?: { type: string; value?: { link?: string } }
      image_hash?: string
      picture?: string    // image URL
      video_id?: string
      multi_share_end_card?: boolean
      child_attachments?: Array<{
        link: string
        name?: string
        description?: string
        image_hash?: string
        picture?: string
        video_id?: string
        call_to_action?: { type: string; value?: { link?: string } }
      }>
    }
    video_data?: {
      video_id: string
      image_hash?: string  // thumbnail
      image_url?: string   // thumbnail URL
      title?: string
      message?: string
      call_to_action?: { type: string; value?: { link?: string } }
    }
    photo_data?: {
      image_hash?: string
      url?: string
      caption?: string
    }
  }
  asset_feed_spec?: Record<string, unknown> // For dynamic creative
  degrees_of_freedom_spec?: {
    creative_features_spec?: {
      standard_enhancements?: { enroll_status: string } // OPT_IN | OPT_OUT
    }
  }
  url_tags?: string // UTM parameters
}

export interface AdParams {
  name: string
  adset_id: string
  creative: { creative_id: string } | AdCreativeParams
  status?: string // ACTIVE | PAUSED
  tracking_specs?: Array<Record<string, unknown>>
  conversion_domain?: string
}

export interface ImageUploadResult {
  hash: string
  url: string
  name: string
}

export interface VideoUploadResult {
  id: string
  title: string
}

// ─── Helpers ───

/** Normalize account ID - strip 'act_' prefix if present to avoid double-prefixing, validate format */
function normalizeAccountId(accountId: string): string {
  const normalized = accountId.replace(/^act_/, '')
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid ad account ID: ${accountId}`)
  }
  return normalized
}

function getToken(): string {
  const token = getActiveToken()
  if (!token) throw new Error('No Meta access token available. Connect Meta in Settings.')
  return token
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])

async function metaPost(url: string, body: Record<string, unknown>, retries = 0): Promise<Record<string, unknown>> {
  const token = getToken()
  const params = new URLSearchParams()
  params.set('access_token', token)

  // Flatten body into form params (Meta API prefers form-encoded for most endpoints)
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object') {
      params.set(key, JSON.stringify(value))
    } else {
      params.set(key, String(value))
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const data = await res.json()
  if (data.error) {
    if (RATE_LIMIT_CODES.has(data.error.code) && retries < 2) {
      console.warn(`[meta-campaign] Rate limited (code ${data.error.code}), retry ${retries + 1}/2 in 30s`)
      await new Promise(r => setTimeout(r, 30000))
      return metaPost(url, body, retries + 1)
    }
    const msg = data.error.message || 'Meta API error'
    const detail = data.error.error_user_msg || data.error.error_user_title || ''
    const code = data.error.code ? ` (code: ${data.error.code})` : ''
    throw new Error(`${msg}${code}${detail ? ` -- ${detail}` : ''}`)
  }
  return data
}

async function metaGet(url: string, params?: Record<string, string>, retries = 0): Promise<Record<string, unknown>> {
  const token = getToken()
  const searchParams = new URLSearchParams({ access_token: token, ...params })
  const res = await fetch(`${url}?${searchParams.toString()}`)
  const data = await res.json()
  if (data.error) {
    if (RATE_LIMIT_CODES.has(data.error.code) && retries < 2) {
      console.warn(`[meta-campaign] Rate limited (code ${data.error.code}), retry ${retries + 1}/2 in 30s`)
      await new Promise(r => setTimeout(r, 30000))
      return metaGet(url, params, retries + 1)
    }
    throw new Error(data.error.message || 'Meta API error')
  }
  return data
}

async function metaDelete(url: string, retries = 0): Promise<Record<string, unknown>> {
  const token = getToken()
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(`${url}${sep}access_token=${token}`, { method: 'DELETE' })
  const data = await res.json()
  if (data.error) {
    if (RATE_LIMIT_CODES.has(data.error.code) && retries < 2) {
      console.warn(`[meta-campaign] DELETE rate limited (code ${data.error.code}), retry ${retries + 1}/2 in 30s`)
      await new Promise(r => setTimeout(r, 30000))
      return metaDelete(url, retries + 1)
    }
    throw new Error(data.error.message || 'Meta API error')
  }
  return data
}

// ─── Campaigns ───

export async function createCampaign(accountId: string, params: CampaignParams) {
  if (params.daily_budget !== undefined && (params.daily_budget < 0 || !Number.isFinite(params.daily_budget))) {
    throw new Error('daily_budget must be a positive number')
  }
  if (params.lifetime_budget !== undefined && (params.lifetime_budget < 0 || !Number.isFinite(params.lifetime_budget))) {
    throw new Error('lifetime_budget must be a positive number')
  }
  const body: Record<string, unknown> = {
    name: params.name,
    objective: params.objective,
    status: params.status || 'PAUSED',
    special_ad_categories: params.special_ad_categories || ['NONE'],
  }
  if (params.daily_budget) body.daily_budget = params.daily_budget
  if (params.lifetime_budget) body.lifetime_budget = params.lifetime_budget
  if (params.bid_strategy) body.bid_strategy = params.bid_strategy
  if (params.buying_type) body.buying_type = params.buying_type
  // Meta requires this field when not using CBO (campaign budget optimization)
  if (!body.daily_budget && !body.lifetime_budget) {
    body.is_adset_budget_sharing_enabled = false
  }

  return metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/campaigns`, body)
}

export async function updateCampaign(campaignId: string, params: Partial<CampaignParams>) {
  const body: Record<string, unknown> = {}
  if (params.name) body.name = params.name
  if (params.status) body.status = params.status
  if (params.daily_budget) body.daily_budget = params.daily_budget
  if (params.lifetime_budget) body.lifetime_budget = params.lifetime_budget
  if (params.bid_strategy) body.bid_strategy = params.bid_strategy

  return metaPost(`${GRAPH_API_BASE}/${campaignId}`, body)
}

export async function getCampaigns(accountId: string, params?: { status?: string; limit?: number }) {
  const fields = 'id,name,objective,status,daily_budget,lifetime_budget,bid_strategy,buying_type,special_ad_categories,created_time,updated_time,start_time,stop_time'
  const queryParams: Record<string, string> = { fields, limit: String(params?.limit || 50) }
  if (params?.status) {
    queryParams.filtering = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [params.status] }])
  }
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/campaigns`, queryParams)
}

export async function getCampaign(campaignId: string) {
  const fields = 'id,name,objective,status,daily_budget,lifetime_budget,bid_strategy,buying_type,special_ad_categories,created_time,updated_time,start_time,stop_time'
  return metaGet(`${GRAPH_API_BASE}/${campaignId}`, { fields })
}

export async function deleteCampaign(campaignId: string) {
  return metaPost(`${GRAPH_API_BASE}/${campaignId}`, { status: 'DELETED' })
}

// ─── Ad Sets ───

export async function createAdSet(accountId: string, params: AdSetParams) {
  if (params.daily_budget !== undefined && (params.daily_budget < 0 || !Number.isFinite(params.daily_budget))) {
    throw new Error('daily_budget must be a positive number')
  }
  if (params.lifetime_budget !== undefined && (params.lifetime_budget < 0 || !Number.isFinite(params.lifetime_budget))) {
    throw new Error('lifetime_budget must be a positive number')
  }
  if (params.bid_amount !== undefined && (params.bid_amount < 0 || !Number.isFinite(params.bid_amount))) {
    throw new Error('bid_amount must be a positive number')
  }
  const body: Record<string, unknown> = {
    name: params.name,
    campaign_id: params.campaign_id,
    billing_event: params.billing_event || 'IMPRESSIONS',
    optimization_goal: params.optimization_goal,
    targeting: params.targeting,
    status: params.status || 'PAUSED',
  }
  if (params.daily_budget) body.daily_budget = params.daily_budget
  if (params.lifetime_budget) body.lifetime_budget = params.lifetime_budget
  if (params.bid_amount) body.bid_amount = params.bid_amount
  if (params.bid_strategy) body.bid_strategy = params.bid_strategy
  if (params.start_time) body.start_time = params.start_time
  if (params.end_time) body.end_time = params.end_time
  if (params.promoted_object) body.promoted_object = params.promoted_object
  if (params.destination_type) body.destination_type = params.destination_type

  return metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/adsets`, body)
}

export async function updateAdSet(adSetId: string, params: Partial<AdSetParams>) {
  const body: Record<string, unknown> = {}
  if (params.name) body.name = params.name
  if (params.status) body.status = params.status
  if (params.daily_budget) body.daily_budget = params.daily_budget
  if (params.lifetime_budget) body.lifetime_budget = params.lifetime_budget
  if (params.bid_amount) body.bid_amount = params.bid_amount
  if (params.targeting) body.targeting = params.targeting
  if (params.start_time) body.start_time = params.start_time
  if (params.end_time) body.end_time = params.end_time
  if (params.optimization_goal) body.optimization_goal = params.optimization_goal
  if (params.promoted_object) body.promoted_object = params.promoted_object

  return metaPost(`${GRAPH_API_BASE}/${adSetId}`, body)
}

export async function getAdSets(accountId: string, params?: { campaign_id?: string; status?: string; limit?: number }) {
  const fields = 'id,name,campaign_id,status,daily_budget,lifetime_budget,bid_amount,bid_strategy,billing_event,optimization_goal,targeting,start_time,end_time,promoted_object,destination_type,created_time,updated_time'
  const queryParams: Record<string, string> = { fields, limit: String(params?.limit || 50) }
  const filters: Array<Record<string, unknown>> = []
  if (params?.campaign_id) {
    filters.push({ field: 'campaign.id', operator: 'EQUAL', value: params.campaign_id })
  }
  if (params?.status) {
    filters.push({ field: 'effective_status', operator: 'IN', value: [params.status] })
  }
  if (filters.length > 0) queryParams.filtering = JSON.stringify(filters)
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/adsets`, queryParams)
}

export async function getAdSet(adSetId: string) {
  const fields = 'id,name,campaign_id,status,daily_budget,lifetime_budget,bid_amount,bid_strategy,billing_event,optimization_goal,targeting,start_time,end_time,promoted_object,destination_type,created_time,updated_time'
  return metaGet(`${GRAPH_API_BASE}/${adSetId}`, { fields })
}

export async function deleteAdSet(adSetId: string) {
  return metaPost(`${GRAPH_API_BASE}/${adSetId}`, { status: 'DELETED' })
}

// ─── Ad Creatives ───

export async function createAdCreative(accountId: string, params: AdCreativeParams) {
  const body: Record<string, unknown> = { name: params.name }
  if (params.object_story_spec) body.object_story_spec = params.object_story_spec
  if (params.asset_feed_spec) body.asset_feed_spec = params.asset_feed_spec
  if (params.degrees_of_freedom_spec) body.degrees_of_freedom_spec = params.degrees_of_freedom_spec
  if (params.url_tags) body.url_tags = params.url_tags

  return metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/adcreatives`, body)
}

export async function getAdCreatives(accountId: string, limit = 50) {
  const fields = 'id,name,object_story_spec,asset_feed_spec,thumbnail_url,effective_object_story_id,url_tags,status'
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/adcreatives`, { fields, limit: String(limit) })
}

// ─── Ads ───

export async function createAd(accountId: string, params: AdParams) {
  const body: Record<string, unknown> = {
    name: params.name,
    adset_id: params.adset_id,
    creative: params.creative,
    status: params.status || 'PAUSED',
  }
  if (params.tracking_specs) body.tracking_specs = params.tracking_specs
  if (params.conversion_domain) body.conversion_domain = params.conversion_domain

  return metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/ads`, body)
}

export async function updateAd(adId: string, params: Partial<AdParams>) {
  const body: Record<string, unknown> = {}
  if (params.name) body.name = params.name
  if (params.status) body.status = params.status
  if (params.creative) body.creative = params.creative
  if (params.adset_id) body.adset_id = params.adset_id

  return metaPost(`${GRAPH_API_BASE}/${adId}`, body)
}

export async function getAds(accountId: string, params?: { adset_id?: string; campaign_id?: string; status?: string; limit?: number }) {
  const fields = 'id,name,adset_id,campaign_id,status,creative{id,name,body,title,thumbnail_url,object_story_spec,asset_feed_spec,url_tags},created_time,updated_time,conversion_domain,tracking_specs'
  const queryParams: Record<string, string> = { fields, limit: String(params?.limit || 50) }
  const filters: Array<Record<string, unknown>> = []
  if (params?.adset_id) {
    filters.push({ field: 'adset.id', operator: 'EQUAL', value: params.adset_id })
  }
  if (params?.campaign_id) {
    filters.push({ field: 'campaign.id', operator: 'EQUAL', value: params.campaign_id })
  }
  if (params?.status) {
    filters.push({ field: 'effective_status', operator: 'IN', value: [params.status] })
  }
  if (filters.length > 0) queryParams.filtering = JSON.stringify(filters)
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/ads`, queryParams)
}

export async function getAd(adId: string) {
  const fields = 'id,name,adset_id,campaign_id,status,creative{id,name,body,title,thumbnail_url,object_story_spec,asset_feed_spec,url_tags},created_time,updated_time'
  return metaGet(`${GRAPH_API_BASE}/${adId}`, { fields })
}

export async function deleteAd(adId: string) {
  return metaPost(`${GRAPH_API_BASE}/${adId}`, { status: 'DELETED' })
}

// ─── Image Upload ───

export async function uploadImage(accountId: string, imageUrl: string, name?: string): Promise<ImageUploadResult> {
  // Upload via URL
  const data = await metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/adimages`, {
    url: imageUrl,
    name: name || `image_${Date.now()}`,
  })
  const images = (data.images || {}) as Record<string, { hash: string; url: string; name: string }>
  const first = Object.values(images)[0]
  if (!first) throw new Error('Image upload failed: no image returned')
  return { hash: first.hash, url: first.url, name: first.name }
}

export async function uploadImageBytes(accountId: string, buffer: Buffer, filename: string): Promise<ImageUploadResult> {
  const token = getToken()
  const formData = new FormData()
  formData.append('access_token', token)
  formData.append('filename', new Blob([new Uint8Array(buffer)]), filename)

  const res = await fetch(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/adimages`, {
    method: 'POST',
    body: formData,
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  const images = (data.images || {}) as Record<string, { hash: string; url: string; name: string }>
  const first = Object.values(images)[0]
  if (!first) throw new Error('Image upload failed')
  return { hash: first.hash, url: first.url, name: first.name }
}

// ─── Video Upload ───

export async function uploadVideo(accountId: string, videoUrl: string, title?: string): Promise<VideoUploadResult> {
  const data = await metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/advideos`, {
    file_url: videoUrl,
    title: title || `video_${Date.now()}`,
  })
  return { id: data.id as string, title: title || '' }
}

// ─── Targeting Search ───

export async function searchInterests(query: string, limit = 30) {
  return metaGet(`${GRAPH_API_BASE}/search`, {
    type: 'adinterest',
    q: query,
    limit: String(limit),
  })
}

export async function searchLocations(query: string, type: string = 'adgeolocation', locationTypes?: string[], limit = 30) {
  const params: Record<string, string> = {
    type,
    q: query,
    limit: String(limit),
  }
  if (locationTypes) params.location_types = JSON.stringify(locationTypes)
  return metaGet(`${GRAPH_API_BASE}/search`, params)
}

export async function searchBehaviors(query?: string, limit = 100) {
  const params: Record<string, string> = {
    type: 'adTargetingCategory',
    class: 'behaviors',
    limit: String(limit),
  }
  if (query) params.q = query
  return metaGet(`${GRAPH_API_BASE}/search`, params)
}

export async function searchDemographics(type: 'education_schools' | 'education_majors' | 'work_employers' | 'work_positions' | 'life_events' | 'family_statuses' | 'industries' | 'income', query?: string) {
  const params: Record<string, string> = {
    type: 'adTargetingCategory',
    class: type,
  }
  if (query) params.q = query
  return metaGet(`${GRAPH_API_BASE}/search`, params)
}

export async function searchLocales(limit = 200) {
  return metaGet(`${GRAPH_API_BASE}/search`, {
    type: 'adlocale',
    limit: String(limit),
  })
}

// ─── Targeting Reach Estimate ───

export async function getReachEstimate(accountId: string, targeting: TargetingSpec, optimizationGoal?: string) {
  const params: Record<string, string> = {
    targeting_spec: JSON.stringify(targeting),
  }
  if (optimizationGoal) params.optimization_goal = optimizationGoal
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/reachestimate`, params)
}

// ─── Custom Audiences ───

export async function getCustomAudiences(accountId: string, limit = 50) {
  const fields = 'id,name,description,approximate_count_lower_bound,approximate_count_upper_bound,data_source,delivery_status,subtype,time_created,time_updated'
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/customaudiences`, { fields, limit: String(limit) })
}

export async function createCustomAudience(accountId: string, params: {
  name: string
  description?: string
  subtype: string // CUSTOM | WEBSITE | APP | OFFLINE_CONVERSION | LOOKALIKE | ENGAGEMENT
  customer_file_source?: string
  lookalike_spec?: { origin_audience_id: string; starting_ratio: number; ratio: number; country: string }
  rule?: Record<string, unknown> // For website/engagement audiences
}) {
  return metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/customaudiences`, params as Record<string, unknown>)
}

/**
 * Hash a value for a Meta Custom Audience payload. Meta expects SHA256 hex of
 * the normalized value: emails lowercased/trimmed, phones reduced to digits.
 */
function normalizeAudienceEmail(email: string): string {
  return email.trim().toLowerCase()
}
function normalizeAudiencePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '')
  // Strip a single leading zero from national numbers; Meta wants E.164-ish.
  return digits.replace(/^0+/, '')
}
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Add a single contact to a Meta custom audience. Sends both email + phone
 * rows when available so Meta can match on either. Returns the Meta response
 * which includes `num_received` and `num_invalid_entries`.
 */
export async function addContactToCustomAudience(
  audienceId: string,
  contact: { email?: string | null; phone?: string | null },
): Promise<Record<string, unknown>> {
  const payload = buildAudienceUserPayload(contact)
  if (!payload) throw new Error('Contact has no email or phone to match against the audience')
  return metaPost(`${GRAPH_API_BASE}/${audienceId}/users`, { payload })
}

/**
 * Remove a single contact from a Meta custom audience. Same payload format
 * as add, but via DELETE.
 */
export async function removeContactFromCustomAudience(
  audienceId: string,
  contact: { email?: string | null; phone?: string | null },
): Promise<Record<string, unknown>> {
  const payload = buildAudienceUserPayload(contact)
  if (!payload) throw new Error('Contact has no email or phone to match against the audience')
  // Graph API requires the payload in the query string for DELETE on /{audience}/users.
  const url = `${GRAPH_API_BASE}/${audienceId}/users?payload=${encodeURIComponent(JSON.stringify(payload))}`
  return metaDelete(url)
}

function buildAudienceUserPayload(contact: { email?: string | null; phone?: string | null }): { schema: string[]; data: string[][] } | null {
  const schema: string[] = []
  const row: string[] = []
  const email = contact.email ? normalizeAudienceEmail(contact.email) : ''
  const phone = contact.phone ? normalizeAudiencePhone(contact.phone) : ''
  if (email) { schema.push('EMAIL'); row.push(sha256Hex(email)) }
  if (phone) { schema.push('PHONE'); row.push(sha256Hex(phone)) }
  if (schema.length === 0) return null
  return { schema, data: [row] }
}

export async function createLookalikeAudience(accountId: string, params: {
  name: string
  origin_audience_id: string
  country: string  // e.g. "CA"
  ratio: number    // 0.01 to 0.20 (1% to 20%)
  description?: string
}) {
  return metaPost(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/customaudiences`, {
    name: params.name,
    subtype: 'LOOKALIKE',
    description: params.description || '',
    lookalike_spec: JSON.stringify({
      origin_audience_id: params.origin_audience_id,
      starting_ratio: 0,
      ratio: params.ratio,
      country: params.country,
    }),
  })
}

// ─── Pixels ───

export async function getPixels(accountId: string) {
  const fields = 'id,name,code,creation_time,is_unavailable,last_fired_time'
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}/adspixels`, { fields })
}

// ─── Ad Account Info ───

export async function getAdAccountInfo(accountId: string) {
  const fields = 'id,name,account_id,account_status,currency,timezone_name,timezone_offset_hours_utc,business_name,spend_cap,amount_spent,balance,min_daily_budget,funding_source_details'
  return metaGet(`${GRAPH_API_BASE}/act_${normalizeAccountId(accountId)}`, { fields })
}

// ─── Insights (performance data for specific objects) ───

export async function getInsights(objectId: string, params?: {
  date_preset?: string   // today | yesterday | last_7d | last_14d | last_30d | lifetime
  time_range?: { since: string; until: string }
  fields?: string
  level?: string  // campaign | adset | ad
  breakdowns?: string
  limit?: number
}) {
  const queryParams: Record<string, string> = {
    fields: params?.fields || 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,conversions,conversion_values',
    limit: String(params?.limit || 100),
  }
  if (params?.date_preset) queryParams.date_preset = params.date_preset
  if (params?.time_range) queryParams.time_range = JSON.stringify(params.time_range)
  if (params?.level) queryParams.level = params.level
  if (params?.breakdowns) queryParams.breakdowns = params.breakdowns

  return metaGet(`${GRAPH_API_BASE}/${objectId}/insights`, queryParams)
}

// ─── Duplicate ───

export async function duplicateCampaign(campaignId: string, params?: { name?: string; status?: string }) {
  const body: Record<string, unknown> = {
    deep_copy: true,
    status_option: params?.status || 'PAUSED',
  }
  if (params?.name) body.rename_options = { rename_suffix: ` - ${params.name}` }
  return metaPost(`${GRAPH_API_BASE}/${campaignId}/copies`, body)
}

export async function duplicateAdSet(adSetId: string, campaignId: string, params?: { name?: string; status?: string }) {
  const body: Record<string, unknown> = {
    deep_copy: true,
    campaign_id: campaignId,
    status_option: params?.status || 'PAUSED',
  }
  if (params?.name) body.rename_options = { rename_suffix: ` - ${params.name}` }
  return metaPost(`${GRAPH_API_BASE}/${adSetId}/copies`, body)
}

export async function duplicateAd(adId: string, adSetId: string, params?: { name?: string; status?: string }) {
  const body: Record<string, unknown> = {
    adset_id: adSetId,
    status_option: params?.status || 'PAUSED',
  }
  if (params?.name) body.rename_options = { rename_suffix: ` - ${params.name}` }
  return metaPost(`${GRAPH_API_BASE}/${adId}/copies`, body)
}
