import { type NextRequest, NextResponse } from 'next/server'
import {
  createCrmContactActivity,
  getCrmCallLogByTwilioSid,
  getWorkspaceByPublicId,
  queueCrmWorkflowRunsForTrigger,
  updateCrmCallLog,
  type CrmCallStatus,
} from '@/lib/db'

/**
 * Twilio Dial action callback + recording status callback.
 *
 *   POST /api/webhooks/twilio/voice/[publicId]/status
 *
 * Two shapes land here, both form-encoded:
 *   (a) Dial action — fired when the forwarded call hangs up. Includes
 *       CallSid (the inbound leg), DialCallStatus, DialCallDuration,
 *       DialCallSid (the outbound bridge leg).
 *   (b) Recording status callback — fired when the recording finishes.
 *       Includes CallSid, RecordingUrl, RecordingSid, RecordingDuration.
 *
 * We update the crm_call_logs row keyed on the inbound CallSid and fire
 * call_completed / missed_call workflow triggers where appropriate.
 */

const VALID_STATUSES = new Set<CrmCallStatus>([
  'queued', 'ringing', 'in-progress', 'completed',
  'busy', 'no-answer', 'failed', 'canceled',
])

function normalizeStatus(raw: string | null): CrmCallStatus | null {
  if (!raw) return null
  const lower = raw.trim().toLowerCase().replace(/_/g, '-')
  return VALID_STATUSES.has(lower as CrmCallStatus) ? (lower as CrmCallStatus) : null
}

function emptyTwiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const workspace = getWorkspaceByPublicId(publicId)
  if (!workspace) return emptyTwiml()

  const raw = await request.text()
  const form = new URLSearchParams(raw)
  const callSid = form.get('CallSid')?.trim() || ''
  if (!callSid) return emptyTwiml()

  const log = getCrmCallLogByTwilioSid(callSid)
  if (!log || log.workspace_id !== workspace.id) return emptyTwiml()

  // Recording-branch: RecordingUrl/RecordingSid present, optionally
  // RecordingStatus = 'completed'. We just stamp the recording fields and
  // bail out before firing hangup triggers.
  const recordingUrl = form.get('RecordingUrl')?.trim() || ''
  const recordingSid = form.get('RecordingSid')?.trim() || ''
  if (recordingUrl || recordingSid) {
    updateCrmCallLog(log.id, {
      recording_url: recordingUrl || log.recording_url,
      recording_sid: recordingSid || log.recording_sid,
    })
    return emptyTwiml()
  }

  // Dial-action branch. Twilio sends DialCallStatus / DialCallDuration.
  const status = normalizeStatus(form.get('DialCallStatus') || form.get('CallStatus')) || 'completed'
  const durationRaw = form.get('DialCallDuration') || form.get('CallDuration') || form.get('Duration') || '0'
  const duration = Number.parseInt(durationRaw, 10)
  const durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : 0
  const completedAt = new Date().toISOString()

  updateCrmCallLog(log.id, {
    status,
    duration_seconds: durationSeconds,
    completed_at: completedAt,
  })

  const sourceLabel = log.source_label || ''
  const contactId = log.contact_id

  if (contactId) {
    // Timeline activity with the summary the task spec asked for.
    const parts = [`Call from ${sourceLabel || 'untagged source'}`]
    parts.push(`${durationSeconds} sec`)
    if (log.recording_url) parts.push(log.recording_url)
    try {
      createCrmContactActivity({
        contactId,
        workspaceId: workspace.id,
        type: 'call',
        body: parts.join(' — '),
      })
    } catch { /* ignore */ }

    // call_completed always fires — the trigger value is the source label,
    // and the runner can branch on status via filters if the author wants.
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId: workspace.id,
        contactId,
        triggerType: 'call_completed',
        triggerValue: sourceLabel,
      })
    } catch { /* ignore */ }

    // missed_call: fire when the forwarded call never connected.
    if (status === 'no-answer' || status === 'busy' || status === 'failed' || status === 'canceled') {
      try {
        queueCrmWorkflowRunsForTrigger({
          workspaceId: workspace.id,
          contactId,
          triggerType: 'missed_call',
          triggerValue: sourceLabel,
        })
      } catch { /* ignore */ }
    }

    // call_status_changed: generic status trigger the runner supports.
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId: workspace.id,
        contactId,
        triggerType: 'call_status_changed',
        triggerValue: status,
      })
    } catch { /* ignore */ }
  }

  return emptyTwiml()
}
