import { type NextRequest, NextResponse } from 'next/server'
import {
  getCrmLeadAdsIntegrationSettings,
  getWorkspaceByPublicId,
  queueCrmWorkflowRunsForTrigger,
  recordCrmLeadAdSubmission,
  writeAuditLog,
} from '@/lib/db'
import { upsertContactForLead } from '@/lib/lead-ads'

/**
 * Google Ads Lead Form webhook.
 *
 *   POST /api/webhooks/lead-ads/google/:publicId
 *
 * Google posts the lead as JSON:
 *   {
 *     lead_id, api_version, form_id, campaign_id, ad_group_id, creative_id,
 *     google_key, user_column_data: [{ column_name, string_value }]
 *   }
 *
 * Auth: `Authorization: Bearer <token>`. Check against
 *   workspaces.google_ads_api_token first. Fall back to the
 *   GOOGLE_LEADS_SHARED_SECRET env var if present so you can run a single
 *   shared secret across every workspace during early rollout.
 *
 * Always returns 200 JSON so Google does not retry for our internal errors.
 */

interface GoogleLeadColumn {
  column_name?: string
  string_value?: string
}

interface GoogleLeadPayload {
  lead_id?: string
  api_version?: string
  form_id?: string | number
  campaign_id?: string | number
  ad_group_id?: string | number
  creative_id?: string | number
  google_key?: string
  user_column_data?: GoogleLeadColumn[]
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params
    const workspace = publicId ? getWorkspaceByPublicId(publicId) : null
    if (!workspace) return ok({ status: 'workspace_not_found' })

    const settings = getCrmLeadAdsIntegrationSettings(workspace.id)
    if (!verifyAuth(request, settings?.google_ads_api_token || null)) {
      return NextResponse.json({ received: true, status: 'unauthorized' }, { status: 403 })
    }

    const raw = await request.text()
    let payload: GoogleLeadPayload
    try {
      payload = JSON.parse(raw) as GoogleLeadPayload
    } catch {
      return ok({ status: 'parse_failed' })
    }

    const leadId = String(payload.lead_id || '').trim()
    if (!leadId) {
      // Google sometimes fires a test ping without lead_id. Acknowledge it
      // but do not store anything.
      return ok({ status: 'missing_lead_id' })
    }

    const mapped = mapUserColumns(payload.user_column_data || [])

    const { contactId, created } = await upsertContactForLead(workspace.id, {
      email: mapped.email,
      phone: mapped.phone,
      fullName: mapped.fullName,
      formName: null,
      source: 'google',
    })

    const { inserted, submission } = recordCrmLeadAdSubmission({
      workspaceId: workspace.id,
      source: 'google',
      platformLeadId: leadId,
      adId: payload.creative_id != null ? String(payload.creative_id) : null,
      adsetId: payload.ad_group_id != null ? String(payload.ad_group_id) : null,
      campaignId: payload.campaign_id != null ? String(payload.campaign_id) : null,
      formId: payload.form_id != null ? String(payload.form_id) : null,
      rawJson: raw,
      contactId,
      email: mapped.email,
      phone: mapped.phone,
      fullName: mapped.fullName,
    })

    if (!inserted) return ok({ status: 'duplicate', contact_id: contactId })

    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId: workspace.id,
        contactId,
        triggerType: 'google_lead_submitted',
        triggerValue: payload.form_id != null ? String(payload.form_id) : null,
      })
    } catch { /* ignore */ }

    writeAuditLog({
      workspaceId: workspace.id,
      entity: 'lead_ad_submission',
      entityId: submission.id,
      action: 'received',
      summary: `Lead from google: ${mapped.fullName || mapped.email || mapped.phone || leadId}`,
      payload: {
        source: 'google',
        form_id: payload.form_id != null ? String(payload.form_id) : null,
        campaign_id: payload.campaign_id != null ? String(payload.campaign_id) : null,
      },
    })

    return ok({ status: 'ok', contact_id: contactId })
  } catch (err) {
    console.error('[lead-ads/google] unexpected error', err)
    return ok({ status: 'error' })
  }
}

interface MappedGoogleFields {
  email: string | null
  phone: string | null
  fullName: string | null
}

function mapUserColumns(columns: GoogleLeadColumn[]): MappedGoogleFields {
  const map: Record<string, string> = {}
  for (const column of columns) {
    const key = String(column.column_name || '').trim().toUpperCase()
    const value = String(column.string_value || '').trim()
    if (!key || !value) continue
    map[key] = value
  }

  const firstName = map.FIRST_NAME || map.GIVEN_NAME || ''
  const lastName = map.LAST_NAME || map.FAMILY_NAME || ''
  const combined = [firstName, lastName].filter(Boolean).join(' ').trim()

  return {
    email: (map.EMAIL || '').toLowerCase() || null,
    phone: map.PHONE_NUMBER || map.PHONE || null,
    fullName: map.FULL_NAME || combined || null,
  }
}

function verifyAuth(request: NextRequest, workspaceToken: string | null): boolean {
  const header = (request.headers.get('authorization') || '').trim()
  if (!header.toLowerCase().startsWith('bearer ')) return false
  const provided = header.slice(7).trim()
  if (!provided) return false

  const wsToken = (workspaceToken || '').trim()
  if (wsToken && constantTimeEqual(provided, wsToken)) return true

  const sharedSecret = (process.env.GOOGLE_LEADS_SHARED_SECRET || '').trim()
  if (sharedSecret && constantTimeEqual(provided, sharedSecret)) return true

  return false
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  // Manual constant-time compare to avoid importing crypto just for this one
  // route — Google bearer tokens fit fine in JS strings.
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function ok(body: Record<string, unknown>) {
  return NextResponse.json({ received: true, ...body }, { status: 200 })
}
