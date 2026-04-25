import { createHash } from 'crypto'
import {
  CRM_PAID_UTM_MEDIA,
  getActiveCrmAttributionModel,
  getCrmContactById,
  listCrmTrackingConversionEvents,
  listCrmTrackingSessionsForAttribution,
  type CrmAttributionEventRow,
  type CrmAttributionModelType,
  type CrmTrackingPixelSession,
  type PendingCrmConversionForward,
} from '@/lib/db'
import { decryptToken } from '@/lib/supabase'

export interface CrmAttributionBucket {
  source: string
  conversions: number
  revenue_cents: number
  share: number
}

export interface CrmAttributionPathRow {
  first_touch: string
  last_touch: string
  conversions: number
  revenue_cents: number
}

export interface CrmAttributionOverview {
  window_days: number
  active_model: CrmAttributionModelType
  totals: {
    conversions: number
    revenue_cents: number
    paid_conversions: number
    paid_revenue_cents: number
  }
  attributed_by_source: CrmAttributionBucket[]
  first_touch: CrmAttributionBucket[]
  last_touch: CrmAttributionBucket[]
  path_rows: CrmAttributionPathRow[]
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeHost(value: string): string | null {
  try {
    return new URL(value, 'https://ctrl.local').hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function normalizeSourceLabel(parts: {
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  referrer?: string | null
}): string {
  const source = parts.utmSource?.trim()
  const medium = parts.utmMedium?.trim()
  const campaign = parts.utmCampaign?.trim()
  if (source && medium && campaign) return `${source} / ${medium} / ${campaign}`
  if (source && medium) return `${source} / ${medium}`
  if (source) return source
  const referrerHost = parts.referrer ? normalizeHost(parts.referrer) : null
  if (referrerHost) return referrerHost
  return 'Direct'
}

function firstTouchLabel(session: CrmTrackingPixelSession): string {
  return normalizeSourceLabel({
    utmSource: session.first_utm_source,
    utmMedium: session.first_utm_medium,
    utmCampaign: session.first_utm_campaign,
    referrer: session.first_referrer,
  })
}

function lastTouchLabel(session: CrmTrackingPixelSession): string {
  return normalizeSourceLabel({
    utmSource: session.last_utm_source,
    utmMedium: session.last_utm_medium,
    utmCampaign: session.last_utm_campaign,
    referrer: session.last_referrer,
  })
}

function extractRevenueCents(eventData: Record<string, unknown> | null): number {
  if (!eventData) return 0
  const candidates = [
    eventData.value_cents,
    eventData.revenue_cents,
    eventData.amount_cents,
    eventData.order_value_cents,
    eventData.purchase_value_cents,
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) return Math.max(0, Math.round(value))
  }
  return 0
}

export function isPaidUtmMedium(value: string | null | undefined): boolean {
  const medium = String(value || '').trim().toLowerCase()
  return (CRM_PAID_UTM_MEDIA as readonly string[]).includes(medium)
}

export function isCrmConversionEventName(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'form_submit' || normalized === 'booking' || normalized === 'purchase'
}

function bucketRow(map: Map<string, { conversions: number; revenue_cents: number }>, key: string, revenueCents: number, weight = 1): void {
  const existing = map.get(key) || { conversions: 0, revenue_cents: 0 }
  existing.conversions += weight
  existing.revenue_cents += revenueCents * weight
  map.set(key, existing)
}

function finalizeBuckets(map: Map<string, { conversions: number; revenue_cents: number }>): CrmAttributionBucket[] {
  const total = Array.from(map.values()).reduce((sum, row) => sum + row.conversions, 0)
  return Array.from(map.entries())
    .map(([source, row]) => ({
      source,
      conversions: Number(row.conversions.toFixed(4)),
      revenue_cents: Math.round(row.revenue_cents),
      share: total > 0 ? row.conversions / total : 0,
    }))
    .sort((a, b) => {
      if (b.revenue_cents !== a.revenue_cents) return b.revenue_cents - a.revenue_cents
      return b.conversions - a.conversions
    })
}

function buildTouchSequence(event: CrmAttributionEventRow, sessionById: Map<string, CrmTrackingPixelSession>, sessionsByContact: Map<number, CrmTrackingPixelSession[]>): {
  firstTouch: string
  lastTouch: string
  sequence: string[]
} {
  const eventSession = sessionById.get(event.session_id)
  const firstTouch = eventSession ? firstTouchLabel(eventSession) : normalizeSourceLabel({
    utmSource: event.first_utm_source,
    utmMedium: event.first_utm_medium,
    utmCampaign: event.first_utm_campaign,
    referrer: event.first_referrer,
  })
  const lastTouch = eventSession ? lastTouchLabel(eventSession) : normalizeSourceLabel({
    utmSource: event.last_utm_source,
    utmMedium: event.last_utm_medium,
    utmCampaign: event.last_utm_campaign,
    referrer: event.last_referrer,
  })

  if (!event.contact_id) {
    const singleSession = firstTouch === lastTouch ? [firstTouch] : [firstTouch, lastTouch]
    return { firstTouch, lastTouch, sequence: singleSession }
  }

  const contactSessions = (sessionsByContact.get(event.contact_id) || [])
    .filter((session) => session.first_seen_at <= event.created_at)
    .sort((left, right) => left.first_seen_at.localeCompare(right.first_seen_at))

  if (contactSessions.length === 0) {
    const singleSession = firstTouch === lastTouch ? [firstTouch] : [firstTouch, lastTouch]
    return { firstTouch, lastTouch, sequence: singleSession }
  }

  const sequence = contactSessions.map((session) => firstTouchLabel(session))
  sequence[sequence.length - 1] = lastTouchLabel(contactSessions[contactSessions.length - 1] as CrmTrackingPixelSession)
  return { firstTouch, lastTouch, sequence }
}

function weightsForModel(model: CrmAttributionModelType, sequence: string[]): Array<{ source: string; weight: number }> {
  if (sequence.length === 0) return []
  if (model === 'first_click') return [{ source: sequence[0] as string, weight: 1 }]
  if (model === 'last_click') return [{ source: sequence[sequence.length - 1] as string, weight: 1 }]
  if (model === 'linear') {
    const weight = 1 / sequence.length
    return sequence.map((source) => ({ source, weight }))
  }
  if (sequence.length === 1) return [{ source: sequence[0] as string, weight: 1 }]
  if (sequence.length === 2) {
    return [
      { source: sequence[0] as string, weight: 0.5 },
      { source: sequence[1] as string, weight: 0.5 },
    ]
  }
  const middleWeight = 0.2 / Math.max(1, sequence.length - 2)
  return sequence.map((source, index) => {
    if (index === 0) return { source, weight: 0.4 }
    if (index === sequence.length - 1) return { source, weight: 0.4 }
    return { source, weight: middleWeight }
  })
}

export function buildCrmAttributionOverview(workspaceId: number, windowDays: number, requestedModel?: CrmAttributionModelType): CrmAttributionOverview {
  const activeModel = requestedModel || getActiveCrmAttributionModel(workspaceId).model_type
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const events = listCrmTrackingConversionEvents(workspaceId, sinceIso)
  const sessions = listCrmTrackingSessionsForAttribution(workspaceId)
  const sessionById = new Map(sessions.map((session) => [session.session_id, session]))
  const sessionsByContact = new Map<number, CrmTrackingPixelSession[]>()

  for (const session of sessions) {
    if (!session.contact_id) continue
    const bucket = sessionsByContact.get(session.contact_id) || []
    bucket.push(session)
    sessionsByContact.set(session.contact_id, bucket)
  }

  const attributed = new Map<string, { conversions: number; revenue_cents: number }>()
  const firstTouch = new Map<string, { conversions: number; revenue_cents: number }>()
  const lastTouch = new Map<string, { conversions: number; revenue_cents: number }>()
  const pathRows = new Map<string, { conversions: number; revenue_cents: number }>()

  let totalConversions = 0
  let totalRevenue = 0
  let paidConversions = 0
  let paidRevenue = 0

  for (const event of events) {
    const revenueCents = extractRevenueCents(event.event_data)
    const eventSession = sessionById.get(event.session_id)
    const paid = isPaidUtmMedium(eventSession?.last_utm_medium || eventSession?.first_utm_medium || event.last_utm_medium || event.first_utm_medium)
    const touchData = buildTouchSequence(event, sessionById, sessionsByContact)
    const weights = weightsForModel(activeModel, touchData.sequence)

    totalConversions += 1
    totalRevenue += revenueCents
    if (paid) {
      paidConversions += 1
      paidRevenue += revenueCents
    }

    bucketRow(firstTouch, touchData.firstTouch, revenueCents)
    bucketRow(lastTouch, touchData.lastTouch, revenueCents)
    for (const weighted of weights) bucketRow(attributed, weighted.source, revenueCents, weighted.weight)

    const pathKey = `${touchData.firstTouch}|||${touchData.lastTouch}`
    const existingPath = pathRows.get(pathKey) || { conversions: 0, revenue_cents: 0 }
    existingPath.conversions += 1
    existingPath.revenue_cents += revenueCents
    pathRows.set(pathKey, existingPath)
  }

  return {
    window_days: windowDays,
    active_model: activeModel,
    totals: {
      conversions: totalConversions,
      revenue_cents: totalRevenue,
      paid_conversions: paidConversions,
      paid_revenue_cents: paidRevenue,
    },
    attributed_by_source: finalizeBuckets(attributed),
    first_touch: finalizeBuckets(firstTouch),
    last_touch: finalizeBuckets(lastTouch),
    path_rows: Array.from(pathRows.entries())
      .map(([key, row]) => {
        const [first, last] = key.split('|||')
        return {
          first_touch: first,
          last_touch: last,
          conversions: row.conversions,
          revenue_cents: row.revenue_cents,
        }
      })
      .sort((a, b) => {
        if (b.revenue_cents !== a.revenue_cents) return b.revenue_cents - a.revenue_cents
        return b.conversions - a.conversions
      }),
  }
}

function metaEventName(name: string): string {
  if (name === 'page_view') return 'PageView'
  if (name === 'form_submit') return 'Lead'
  if (name === 'booking') return 'Schedule'
  if (name === 'purchase') return 'Purchase'
  return name
}

function tiktokEventName(name: string): string {
  if (name === 'page_view') return 'PageView'
  if (name === 'form_submit') return 'SubmitForm'
  if (name === 'booking') return 'Schedule'
  if (name === 'purchase') return 'CompletePayment'
  return name
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Normalize + SHA256 an email per Meta CAPI rules (lowercase, trim). */
function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  return trimmed ? sha256Hex(trimmed) : null
}

/** Normalize + SHA256 a phone per Meta CAPI rules (digits only, no leading zeros). */
function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D+/g, '').replace(/^0+/, '')
  return digits ? sha256Hex(digits) : null
}

function buildMetaUserData(forward: PendingCrmConversionForward): Record<string, unknown> {
  const contact = forward.event_contact_id
    ? getCrmContactById(forward.event_contact_id, forward.workspace_id)
    : null
  const em = hashEmail(contact?.email)
  const ph = hashPhone(contact?.phone)
  const externalId = forward.event_contact_id
    ? sha256Hex(String(forward.event_contact_id))
    : null
  const user: Record<string, unknown> = {}
  if (em) user.em = [em]
  if (ph) user.ph = [ph]
  if (externalId) user.external_id = [externalId]
  if (forward.fbp) user.fbp = forward.fbp
  if (forward.fbc) user.fbc = forward.fbc
  if (forward.ua) user.client_user_agent = forward.ua
  return user
}

function buildTiktokUserData(forward: PendingCrmConversionForward): Record<string, unknown> {
  const contact = forward.event_contact_id
    ? getCrmContactById(forward.event_contact_id, forward.workspace_id)
    : null
  const email = hashEmail(contact?.email)
  const phone = hashPhone(contact?.phone)
  const externalId = forward.event_contact_id
    ? sha256Hex(String(forward.event_contact_id))
    : null
  const user: Record<string, unknown> = {}
  if (email) user.email = email
  if (phone) user.phone = phone
  if (externalId) user.external_id = externalId
  if (forward.fbp) user.ttp = forward.fbp
  if (forward.gclid) user.ttclid = forward.gclid
  if (forward.ua) user.user_agent = forward.ua
  return user
}

export function buildCrmConversionForwardRequest(forward: PendingCrmConversionForward): Record<string, unknown> {
  const eventData = safeJsonParse<Record<string, unknown> | null>(forward.event_data_json, null) || {}
  const revenueCents = extractRevenueCents(eventData)
  const eventTime = Math.floor(new Date(forward.event_created_at).getTime() / 1000)
  if (forward.endpoint_platform === 'meta') {
    return {
      platform: 'meta',
      endpoint: `https://graph.facebook.com/v18.0/${encodeURIComponent(forward.endpoint_pixel_id_or_dataset)}/events`,
      body: {
        data: [
          {
            event_name: metaEventName(forward.event_name),
            event_time: eventTime,
            action_source: 'website',
            event_source_url: forward.event_url,
            user_data: buildMetaUserData(forward),
            custom_data: {
              ...eventData,
              value_cents: revenueCents || undefined,
            },
          },
        ],
        test_event_code: forward.endpoint_test_event_code || undefined,
      },
    }
  }
  if (forward.endpoint_platform === 'google_ads') {
    return {
      platform: 'google_ads',
      endpoint: 'https://googleads.googleapis.com/v18/customers/{customerId}:uploadClickConversions',
      body: {
        destination: forward.endpoint_pixel_id_or_dataset,
        conversions: [
          {
            gclid: forward.gclid,
            conversion_date_time: forward.event_created_at,
            conversion_action: forward.endpoint_pixel_id_or_dataset,
            conversion_value: revenueCents > 0 ? Number((revenueCents / 100).toFixed(2)) : undefined,
            currency_code: typeof eventData.currency === 'string' ? eventData.currency : 'USD',
            event_name: forward.event_name,
          },
        ],
      },
    }
  }
  return {
    platform: 'tiktok',
    endpoint: 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
    body: {
      event_source: 'web',
      event_source_id: forward.endpoint_pixel_id_or_dataset,
      test_event_code: forward.endpoint_test_event_code || undefined,
      data: [
        {
          event: tiktokEventName(forward.event_name),
          event_time: eventTime,
          event_id: String(forward.id),
          user: buildTiktokUserData(forward),
          page: { url: forward.event_url },
          properties: {
            ...eventData,
            value_cents: revenueCents || undefined,
            value: revenueCents > 0 ? Number((revenueCents / 100).toFixed(2)) : undefined,
            currency: typeof eventData.currency === 'string' ? eventData.currency : 'USD',
          },
        },
      ],
    },
  }
}

export interface CrmConversionForwardSendResult {
  ok: boolean
  skipped?: boolean
  status?: number
  body?: unknown
  error?: string
  request?: Record<string, unknown>
}

export async function sendCrmConversionForwardLive(
  forward: PendingCrmConversionForward,
): Promise<CrmConversionForwardSendResult> {
  const request = buildCrmConversionForwardRequest(forward)

  if (forward.endpoint_platform !== 'meta' && forward.endpoint_platform !== 'tiktok') {
    return {
      ok: false,
      skipped: true,
      error: `Live send not yet wired for platform "${forward.endpoint_platform}"`,
      request,
    }
  }

  let accessToken: string
  try {
    accessToken = decryptToken(forward.endpoint_access_token_encrypted)
  } catch (error) {
    return {
      ok: false,
      error: `Failed to decrypt access token: ${error instanceof Error ? error.message : 'unknown error'}`,
      request,
    }
  }
  if (!accessToken) {
    return { ok: false, error: 'Access token is empty after decryption', request }
  }

  const body = request.body as Record<string, unknown>
  const platformLabel = forward.endpoint_platform === 'meta' ? 'Meta CAPI' : 'TikTok Events API'

  const endpoint =
    forward.endpoint_platform === 'meta'
      ? `${String(request.endpoint)}?access_token=${encodeURIComponent(accessToken)}`
      : String(request.endpoint)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (forward.endpoint_platform === 'tiktok') {
    headers['Access-Token'] = accessToken
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const rawText = await response.text()
    let parsed: unknown = rawText
    try {
      parsed = rawText ? JSON.parse(rawText) : null
    } catch {
      parsed = rawText
    }

    let ok = response.ok
    if (ok && forward.endpoint_platform === 'tiktok' && parsed && typeof parsed === 'object') {
      const code = (parsed as { code?: number }).code
      if (typeof code === 'number' && code !== 0) ok = false
    }

    return {
      ok,
      status: response.status,
      body: parsed,
      error: ok ? undefined : `${platformLabel} returned HTTP ${response.status}`,
      request,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Fetch failed',
      request,
    }
  }
}
