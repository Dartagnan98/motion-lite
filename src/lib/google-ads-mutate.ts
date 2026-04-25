// Google Ads API v22 mutate helpers
// All functions return the resourceName of the created entity.
// Every call goes through the MCC login-customer-id header (set in google-ads.ts adsHeaders).

const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v22'

interface MutateResponse {
  results?: Array<{ resourceName: string }>
  partialFailureError?: { message: string; code: number }
  error?: { message: string; status?: string; details?: unknown }
}

function headers(accessToken: string, devToken: string, mccId: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': devToken,
    'login-customer-id': mccId.replace(/-/g, ''),
    'Content-Type': 'application/json',
  }
}

async function mutate(
  ctx: MutateCtx,
  resource: string,
  operations: unknown[],
): Promise<MutateResponse> {
  const url = `${GOOGLE_ADS_API}/customers/${ctx.customerId}/${resource}:mutate`
  const body: Record<string, unknown> = { operations }
  if (ctx.validateOnly) body.validateOnly = true
  if (ctx.partialFailure) body.partialFailure = true

  const res = await fetch(url, {
    method: 'POST',
    headers: headers(ctx.accessToken, ctx.devToken, ctx.mccId),
    body: JSON.stringify(body),
  })
  const data = await res.json() as MutateResponse
  if (data.error) {
    throw new Error(`[${resource}] ${data.error.message}`)
  }
  return data
}

export interface MutateCtx {
  accessToken: string
  devToken: string
  mccId: string
  customerId: string            // clean (no dashes)
  validateOnly?: boolean
  partialFailure?: boolean
}

// ─── Budgets ───

export async function createCampaignBudget(ctx: MutateCtx, opts: {
  name: string
  amountMicros: number          // $5 = 5_000_000
  deliveryMethod?: 'STANDARD' | 'ACCELERATED'
}): Promise<string> {
  const res = await mutate(ctx, 'campaignBudgets', [{
    create: {
      name: opts.name,
      amountMicros: String(opts.amountMicros),
      deliveryMethod: opts.deliveryMethod || 'STANDARD',
      explicitlyShared: false,
    },
  }])
  return res.results?.[0]?.resourceName || ''
}

// ─── Campaigns ───

export async function createSearchCampaign(ctx: MutateCtx, opts: {
  name: string
  budgetResourceName: string
  status?: 'PAUSED' | 'ENABLED'
  startDate?: string            // YYYY-MM-DD
  endDate?: string              // YYYY-MM-DD
  targetCpaMicros?: number      // optional, for TARGET_CPA
}): Promise<string> {
  const create: Record<string, unknown> = {
    name: opts.name,
    status: opts.status || 'PAUSED',
    advertisingChannelType: 'SEARCH',
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: false,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    },
    campaignBudget: opts.budgetResourceName,
    // Maximize Clicks
    targetSpend: {},
    // v22 requires EU political advertising declaration
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  }

  if (opts.startDate) create.startDate = opts.startDate
  if (opts.endDate) create.endDate = opts.endDate

  const res = await mutate(ctx, 'campaigns', [{ create }])
  return res.results?.[0]?.resourceName || ''
}

export async function pauseCampaign(ctx: MutateCtx, campaignResourceName: string): Promise<void> {
  await mutate(ctx, 'campaigns', [{
    update: { resourceName: campaignResourceName, status: 'PAUSED' },
    updateMask: 'status',
  }])
}

export async function enableCampaign(ctx: MutateCtx, campaignResourceName: string): Promise<void> {
  await mutate(ctx, 'campaigns', [{
    update: { resourceName: campaignResourceName, status: 'ENABLED' },
    updateMask: 'status',
  }])
}

// ─── Ad Groups ───

export async function createAdGroup(ctx: MutateCtx, opts: {
  name: string
  campaignResourceName: string
  cpcBidMicros?: number
  status?: 'PAUSED' | 'ENABLED'
}): Promise<string> {
  const res = await mutate(ctx, 'adGroups', [{
    create: {
      name: opts.name,
      campaign: opts.campaignResourceName,
      status: opts.status || 'ENABLED',
      type: 'SEARCH_STANDARD',
      cpcBidMicros: opts.cpcBidMicros ? String(opts.cpcBidMicros) : undefined,
    },
  }])
  return res.results?.[0]?.resourceName || ''
}

// ─── Responsive Search Ads ───

export async function createResponsiveSearchAd(ctx: MutateCtx, opts: {
  adGroupResourceName: string
  finalUrls: string[]
  headlines: string[]           // up to 15, each max 30 chars
  descriptions: string[]        // up to 4, each max 90 chars
  path1?: string
  path2?: string
}): Promise<string> {
  if (opts.headlines.length < 3) throw new Error('RSA requires at least 3 headlines')
  if (opts.descriptions.length < 2) throw new Error('RSA requires at least 2 descriptions')

  const ad: Record<string, unknown> = {
    finalUrls: opts.finalUrls,
    responsiveSearchAd: {
      headlines: opts.headlines.slice(0, 15).map(text => ({ text })),
      descriptions: opts.descriptions.slice(0, 4).map(text => ({ text })),
      path1: opts.path1,
      path2: opts.path2,
    },
  }

  const res = await mutate(ctx, 'adGroupAds', [{
    create: {
      adGroup: opts.adGroupResourceName,
      status: 'ENABLED',
      ad,
    },
  }])
  return res.results?.[0]?.resourceName || ''
}

// ─── Keywords ───

export async function addKeywords(ctx: MutateCtx, opts: {
  adGroupResourceName: string
  keywords: string[]
  matchType: 'EXACT' | 'PHRASE' | 'BROAD'
  cpcBidMicros?: number
}): Promise<string[]> {
  const operations = opts.keywords.map(text => ({
    create: {
      adGroup: opts.adGroupResourceName,
      status: 'ENABLED',
      keyword: { text, matchType: opts.matchType },
      cpcBidMicros: opts.cpcBidMicros ? String(opts.cpcBidMicros) : undefined,
    },
  }))
  const res = await mutate(ctx, 'adGroupCriteria', operations)
  return (res.results || []).map(r => r.resourceName)
}

// ─── Campaign Criteria (location, schedule, negatives) ───

export async function addProximity(ctx: MutateCtx, opts: {
  campaignResourceName: string
  lat: number
  lng: number
  radiusKm: number
}): Promise<string> {
  const res = await mutate(ctx, 'campaignCriteria', [{
    create: {
      campaign: opts.campaignResourceName,
      proximity: {
        geoPoint: {
          latitudeInMicroDegrees: Math.round(opts.lat * 1_000_000),
          longitudeInMicroDegrees: Math.round(opts.lng * 1_000_000),
        },
        radius: opts.radiusKm,
        radiusUnits: 'KILOMETERS',
      },
    },
  }])
  return res.results?.[0]?.resourceName || ''
}

export type DayOfWeek = 'MONDAY'|'TUESDAY'|'WEDNESDAY'|'THURSDAY'|'FRIDAY'|'SATURDAY'|'SUNDAY'

export async function addAdSchedule(ctx: MutateCtx, opts: {
  campaignResourceName: string
  schedules: Array<{
    dayOfWeek: DayOfWeek
    startHour: number             // 0-23
    endHour: number               // 0-24
    bidModifier?: number          // e.g. 1.3 for +30%
  }>
}): Promise<string[]> {
  const operations = opts.schedules.map(s => ({
    create: {
      campaign: opts.campaignResourceName,
      adSchedule: {
        dayOfWeek: s.dayOfWeek,
        startHour: s.startHour,
        startMinute: 'ZERO',
        endHour: s.endHour,
        endMinute: 'ZERO',
      },
      bidModifier: s.bidModifier,
    },
  }))
  const res = await mutate(ctx, 'campaignCriteria', operations)
  return (res.results || []).map(r => r.resourceName)
}

export async function addNegativeKeywords(ctx: MutateCtx, opts: {
  campaignResourceName: string
  keywords: string[]
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
}): Promise<string[]> {
  const matchType = opts.matchType || 'BROAD'
  const operations = opts.keywords.map(text => ({
    create: {
      campaign: opts.campaignResourceName,
      negative: true,
      keyword: { text, matchType },
    },
  }))
  const res = await mutate(ctx, 'campaignCriteria', operations)
  return (res.results || []).map(r => r.resourceName)
}
