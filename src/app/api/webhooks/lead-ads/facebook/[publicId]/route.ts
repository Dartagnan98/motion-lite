import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getCrmLeadAdsIntegrationSettings,
  getFacebookPageAccessToken,
  getWorkspaceByPublicId,
  queueCrmWorkflowRunsForTrigger,
  recordCrmLeadAdSubmission,
  writeAuditLog,
} from '@/lib/db'
import { upsertContactForLead } from '@/lib/lead-ads'

/**
 * Facebook Lead Ads webhook.
 *
 *   GET  /api/webhooks/lead-ads/facebook/:publicId    — verify handshake
 *   POST /api/webhooks/lead-ads/facebook/:publicId    — leadgen change events
 *
 * publicId maps to a workspace via workspaces.public_id (same pattern used by
 * inbound-email). Each workspace stores:
 *   - facebook_webhook_verify_token — compared to hub.verify_token on GET
 *   - facebook_page_access_tokens    — JSON map { pageId: accessToken } used
 *                                      to pull full lead details from the
 *                                      Graph API after the change event
 *
 * Always returns 200 on POST so Facebook does not retry for our internal
 * errors. Signature verification uses FACEBOOK_APP_SECRET — if unset we skip
 * the check (dev convenience), matching the Mailgun pattern in
 * inbound-email.
 */

const GRAPH_API_VERSION = 'v19.0'

// ─── GET: verify handshake ─────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const search = request.nextUrl.searchParams
  const mode = search.get('hub.mode') || ''
  const challenge = search.get('hub.challenge') || ''
  const token = search.get('hub.verify_token') || ''

  const workspace = publicId ? getWorkspaceByPublicId(publicId) : null
  if (!workspace) return new NextResponse('not_found', { status: 403 })

  const settings = getCrmLeadAdsIntegrationSettings(workspace.id)
  const expected = (settings?.facebook_webhook_verify_token || '').trim()
  if (mode !== 'subscribe' || !expected || token !== expected) {
    return new NextResponse('forbidden', { status: 403 })
  }

  // Facebook expects the raw challenge string echoed back with 200.
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// ─── POST: leadgen events ─────────────────────────────────────────────────

interface LeadgenChangeValue {
  leadgen_id?: string
  page_id?: string
  form_id?: string
  adgroup_id?: string
  ad_id?: string
  created_time?: number
}

interface LeadgenChange {
  field?: string
  value?: LeadgenChangeValue
}

interface LeadgenEntry {
  id?: string
  changes?: LeadgenChange[]
}

interface LeadgenPayload {
  object?: string
  entry?: LeadgenEntry[]
}

interface LeadFieldEntry {
  name?: string
  values?: string[]
}

interface GraphLeadResponse {
  id?: string
  field_data?: LeadFieldEntry[]
  ad_id?: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
  form_id?: string
  form_name?: string
  created_time?: string
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params
    const workspace = publicId ? getWorkspaceByPublicId(publicId) : null
    if (!workspace) return ok({ status: 'workspace_not_found' })

    const raw = await request.text()

    if (!verifySignature(request, raw)) {
      return ok({ status: 'invalid_signature' })
    }

    let payload: LeadgenPayload
    try {
      payload = JSON.parse(raw) as LeadgenPayload
    } catch {
      return ok({ status: 'parse_failed' })
    }

    if (payload.object !== 'page' || !Array.isArray(payload.entry)) {
      // Acknowledge but don't process — Facebook subscribes multiple objects
      // on the same endpoint sometimes.
      return ok({ status: 'ignored' })
    }

    let processed = 0
    for (const entry of payload.entry) {
      if (!Array.isArray(entry.changes)) continue
      for (const change of entry.changes) {
        if (change.field !== 'leadgen' || !change.value) continue
        try {
          const outcome = await processLeadgenChange(workspace.id, change.value)
          if (outcome) processed += 1
        } catch (err) {
          console.error('[lead-ads/facebook] change handler failed', err)
        }
      }
    }

    return ok({ status: 'ok', processed })
  } catch (err) {
    console.error('[lead-ads/facebook] unexpected error', err)
    return ok({ status: 'error' })
  }
}

async function processLeadgenChange(workspaceId: number, value: LeadgenChangeValue): Promise<boolean> {
  const leadgenId = String(value.leadgen_id || '').trim()
  const pageId = String(value.page_id || '').trim()
  if (!leadgenId || !pageId) return false

  const accessToken = getFacebookPageAccessToken(workspaceId, pageId)
  if (!accessToken) {
    console.error('[lead-ads/facebook] no page access token configured', { workspaceId, pageId })
    return false
  }

  const lead = await fetchLeadgenRecord(leadgenId, accessToken)
  if (!lead) return false

  const mapped = mapFieldData(lead.field_data || [])
  const rawJson = JSON.stringify(lead)

  // Upsert the contact by email (preferred) or phone.
  const { contactId, created } = await upsertContactForLead(workspaceId, {
    email: mapped.email,
    phone: mapped.phone,
    fullName: mapped.fullName,
    formName: lead.form_name || null,
    source: 'facebook',
  })

  const { inserted, submission } = recordCrmLeadAdSubmission({
    workspaceId,
    source: 'facebook',
    platformLeadId: leadgenId,
    adId: lead.ad_id || null,
    adName: lead.ad_name || null,
    adsetId: lead.adset_id || null,
    adsetName: lead.adset_name || null,
    campaignId: lead.campaign_id || null,
    campaignName: lead.campaign_name || null,
    formId: lead.form_id || null,
    formName: lead.form_name || null,
    rawJson,
    contactId: contactId,
    email: mapped.email,
    phone: mapped.phone,
    fullName: mapped.fullName,
  })

  if (!inserted) {
    // Duplicate event (Facebook retries) — don't fire triggers again.
    return false
  }

  // Fire the trigger catalog events.
  try {
    queueCrmWorkflowRunsForTrigger({
      workspaceId,
      contactId,
      triggerType: 'facebook_lead_submitted',
      triggerValue: lead.form_name || lead.form_id || null,
    })
  } catch { /* keep webhook resilient */ }

  writeAuditLog({
    workspaceId,
    entity: 'lead_ad_submission',
    entityId: submission.id,
    action: 'received',
    summary: `Lead from facebook: ${mapped.fullName || mapped.email || mapped.phone || leadgenId}`,
    payload: {
      source: 'facebook',
      form_name: lead.form_name || null,
      ad_name: lead.ad_name || null,
      campaign_name: lead.campaign_name || null,
    },
  })

  return true
}

async function fetchLeadgenRecord(leadgenId: string, accessToken: string): Promise<GraphLeadResponse | null> {
  const fields = 'id,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,created_time'
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(leadgenId)}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) {
      console.error('[lead-ads/facebook] graph api non-ok', res.status)
      return null
    }
    const json = (await res.json()) as GraphLeadResponse
    return json
  } catch (err) {
    console.error('[lead-ads/facebook] graph api fetch failed', err)
    return null
  }
}

interface MappedFields {
  email: string | null
  phone: string | null
  fullName: string | null
}

function mapFieldData(fieldData: LeadFieldEntry[]): MappedFields {
  const fields: Record<string, string> = {}
  for (const entry of fieldData) {
    const key = String(entry.name || '').trim().toLowerCase()
    const value = Array.isArray(entry.values) ? String(entry.values[0] || '').trim() : ''
    if (!key || !value) continue
    // Last write wins; Facebook sometimes emits the same field twice.
    fields[key] = value
  }

  const firstName = fields.first_name || ''
  const lastName = fields.last_name || ''
  const nameFromParts = [firstName, lastName].filter(Boolean).join(' ').trim()

  return {
    email: (fields.email || '').trim().toLowerCase() || null,
    phone: (fields.phone_number || fields.phone || '').trim() || null,
    fullName: (fields.full_name || nameFromParts || '').trim() || null,
  }
}

// ─── Signature verification ────────────────────────────────────────────────

function verifySignature(request: NextRequest, raw: string): boolean {
  const secret = (process.env.FACEBOOK_APP_SECRET || '').trim()
  if (!secret) return true // dev mode — no verification configured

  const header = request.headers.get('x-hub-signature-256') || ''
  if (!header.startsWith('sha256=')) return false
  const provided = header.slice(7).trim()
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  if (provided.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

function ok(body: Record<string, unknown>) {
  return NextResponse.json({ received: true, ...body }, { status: 200 })
}
