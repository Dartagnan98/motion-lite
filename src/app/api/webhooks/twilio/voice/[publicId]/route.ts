import { type NextRequest, NextResponse } from 'next/server'
import {
  createCrmCallLog,
  createCrmContact,
  findCrmContactsByPhone,
  findCrmTrackingNumberByPhone,
  getWorkspaceByPublicId,
  queueCrmWorkflowRunsForTrigger,
  updateCrmContact,
} from '@/lib/db'

/**
 * Twilio inbound voice webhook.
 *
 *   POST /api/webhooks/twilio/voice/[publicId]
 *
 * Flow:
 *   1. Match workspace by public_id (URL) — also enforces that every tracking
 *      number's "A call comes in" webhook in Twilio is workspace-scoped.
 *   2. Resolve tracking number by the Twilio `To` parameter.
 *   3. Upsert contact by `From` phone.
 *   4. Insert a crm_call_logs row (status = ringing, direction = inbound).
 *   5. Fire call_received + inbound_sms-equivalent trigger `call_received`,
 *      plus the cross-channel `customer_replied` (channel = call).
 *   6. Return TwiML that <Dial record="record-from-answer"> to the real
 *      forward-to number, with action callback to .../status so we update
 *      the log on hangup.
 */

function twimlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { 'Content-Type': 'application/xml' },
  })
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const workspace = getWorkspaceByPublicId(publicId)
  if (!workspace) {
    // Unknown workspace — return an empty <Response/> so Twilio doesn't retry.
    return twimlResponse('<Response/>')
  }

  const raw = await request.text()
  const form = new URLSearchParams(raw)
  const callSid = form.get('CallSid')?.trim() || ''
  const from = form.get('From')?.trim() || ''
  const to = form.get('To')?.trim() || ''

  if (!from || !to) {
    return twimlResponse('<Response><Hangup/></Response>')
  }

  const tracking = findCrmTrackingNumberByPhone(to)
  if (!tracking || tracking.workspace_id !== workspace.id || !tracking.is_active) {
    // Tracking number not registered for this workspace — hang up cleanly.
    return twimlResponse('<Response><Hangup/></Response>')
  }

  // Contact resolution — match by From phone, otherwise create a skeleton row.
  const matches = findCrmContactsByPhone(from, workspace.id)
  let contactId = matches[0]?.id ?? null
  if (!contactId) {
    const created = createCrmContact({
      workspaceId: workspace.id,
      name: from,
      email: null,
      phone: from,
    })
    contactId = created.id
    // Stamp the source so reports/attribution can see where the lead came from.
    try {
      updateCrmContact(contactId, workspace.id, { source: tracking.source_label })
    } catch { /* ignore */ }
  }

  createCrmCallLog({
    workspace_id: workspace.id,
    tracking_number_id: tracking.id,
    contact_id: contactId,
    twilio_call_sid: callSid || null,
    from_number: from,
    to_number: to,
    direction: 'inbound',
    status: 'ringing',
    source_label: tracking.source_label,
  })

  // Fire triggers — call_received is the new call-specific one, customer_replied
  // is the cross-channel one other parts of the CRM already listen on.
  try {
    queueCrmWorkflowRunsForTrigger({
      workspaceId: workspace.id,
      contactId,
      triggerType: 'call_received',
      triggerValue: tracking.source_label,
    })
  } catch { /* keep webhook resilient */ }
  try {
    queueCrmWorkflowRunsForTrigger({
      workspaceId: workspace.id,
      contactId,
      triggerType: 'customer_replied',
      triggerValue: 'call',
    })
  } catch { /* ignore */ }

  const forwardTo = escapeXml(tracking.forward_to_number)
  const actionUrl = escapeXml(`${request.nextUrl.origin}/api/webhooks/twilio/voice/${publicId}/status`)
  const recordAttr = tracking.record_calls ? ' record="record-from-answer" recordingStatusCallback="' + actionUrl + '"' : ''

  const twiml = `<Response><Dial answerOnBridge="true" action="${actionUrl}" method="POST"${recordAttr}><Number>${forwardTo}</Number></Dial></Response>`
  return twimlResponse(twiml)
}
