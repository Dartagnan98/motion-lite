import { type NextRequest, NextResponse } from 'next/server'
import { getCrmCallLogByTwilioSid, updateCrmCallLog } from '@/lib/db'

/**
 * Answering-machine detection callback for the `voicemail_drop` workflow action.
 *
 *   POST /api/webhooks/twilio/amd?recording_url=https://…mp3
 *
 * Twilio places the outbound call with `MachineDetection=DetectMessageEnd` and
 * this route as `Url`. When AMD resolves Twilio re-requests this URL with
 * `AnsweredBy` populated:
 *   - `machine_end_beep` / `machine_end_silence` / `machine_end_other`
 *       → play the recording, then hang up (that's the drop)
 *   - `human` or anything else → hang up clean. We don't want a human to
 *     hear the voicemail recording.
 *
 * The recording URL travels in the query string so this endpoint is
 * stateless and not tied to a specific workspace. The call log row was
 * inserted upfront by the workflow runner with the Twilio CallSid; we update
 * its status here so the calls report shows the right outcome.
 */

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function twiml(body: string): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  })
}

const MACHINE_BUCKETS = new Set([
  'machine_end_beep',
  'machine_end_silence',
  'machine_end_other',
])

export async function POST(request: NextRequest) {
  const recordingUrl = request.nextUrl.searchParams.get('recording_url')?.trim() || ''

  const raw = await request.text()
  const form = new URLSearchParams(raw)
  const answeredBy = (form.get('AnsweredBy') || '').trim().toLowerCase()
  const callSid = (form.get('CallSid') || '').trim()

  const log = callSid ? getCrmCallLogByTwilioSid(callSid) : null

  if (MACHINE_BUCKETS.has(answeredBy) && recordingUrl) {
    if (log) {
      try {
        updateCrmCallLog(log.id, {
          status: 'in-progress',
          completed_at: new Date().toISOString(),
        })
      } catch { /* ignore */ }
    }
    return twiml(`<Response><Play>${escapeXml(recordingUrl)}</Play><Hangup/></Response>`)
  }

  // Human or unknown: do not leave a voicemail on a live answer.
  if (log) {
    const status = answeredBy === 'human' ? 'completed' : 'no-answer'
    try {
      updateCrmCallLog(log.id, {
        status,
        completed_at: new Date().toISOString(),
      })
    } catch { /* ignore */ }
  }
  return twiml('<Response><Hangup/></Response>')
}
