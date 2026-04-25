import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ZOOM_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || ''
const ZOOM_VERIFICATION_TOKEN = process.env.ZOOM_VERIFICATION_TOKEN || ''
const TRANSCRIPT_WEBHOOK_SECRET = process.env.TRANSCRIPT_WEBHOOK_SECRET || ''

/**
 * Zoom webhook adapter for transcript ingest.
 *
 * Wire this URL into your Zoom Marketplace app:
 *   Event: recording.transcript_completed
 *   URL:   https://your-app.example.com/api/webhooks/transcript/zoom
 *
 * Zoom requires an endpoint URL validation handshake (event = "endpoint.url_validation")
 * which this route handles automatically. Set ZOOM_WEBHOOK_SECRET_TOKEN env var
 * to the secret token from your Zoom app's "Feature" page.
 *
 * On receipt of recording.transcript_completed, this fetches the transcript
 * file, then forwards to /api/webhooks/transcript with the generic shape.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── Zoom URL validation handshake ──
  if (body.event === 'endpoint.url_validation') {
    const payload = body.payload as { plainToken?: string } | undefined
    const plainToken = payload?.plainToken
    if (!plainToken || !ZOOM_SECRET_TOKEN) {
      return NextResponse.json({ error: 'ZOOM_WEBHOOK_SECRET_TOKEN not configured' }, { status: 500 })
    }
    const encryptedToken = crypto.createHmac('sha256', ZOOM_SECRET_TOKEN).update(plainToken).digest('hex')
    return NextResponse.json({ plainToken, encryptedToken })
  }

  // ── Verify webhook signature ──
  const signature = request.headers.get('x-zm-signature') || ''
  const timestamp = request.headers.get('x-zm-request-timestamp') || ''
  if (ZOOM_SECRET_TOKEN && signature && timestamp) {
    const message = `v0:${timestamp}:${JSON.stringify(body)}`
    const expected = `v0=${crypto.createHmac('sha256', ZOOM_SECRET_TOKEN).update(message).digest('hex')}`
    if (signature !== expected) {
      console.warn('[zoom-webhook] signature mismatch')
      return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
    }
  } else if (ZOOM_VERIFICATION_TOKEN) {
    // Legacy verification token fallback
    const token = request.headers.get('authorization') || ''
    if (token !== ZOOM_VERIFICATION_TOKEN) {
      return NextResponse.json({ error: 'Bad token' }, { status: 401 })
    }
  }

  // ── Handle recording.transcript_completed ──
  if (body.event !== 'recording.transcript_completed') {
    // Ignore other events (recording.completed, etc.)
    return NextResponse.json({ ok: true, ignored: body.event })
  }

  const payload = body.payload as { object?: { topic?: string; recording_files?: Array<{ file_type?: string; download_url?: string; recording_start?: string }>; uuid?: string }; download_token?: string } | undefined
  const meeting = payload?.object
  const downloadToken = payload?.download_token

  if (!meeting?.recording_files?.length) {
    return NextResponse.json({ ok: true, note: 'no recording_files' })
  }

  const transcriptFile = meeting.recording_files.find(f => f.file_type === 'TRANSCRIPT' || f.file_type === 'CC')
  if (!transcriptFile?.download_url) {
    return NextResponse.json({ ok: true, note: 'no transcript file in payload' })
  }

  // Fetch the transcript file (VTT format)
  const fetchUrl = downloadToken ? `${transcriptFile.download_url}?access_token=${downloadToken}` : transcriptFile.download_url
  const res = await fetch(fetchUrl)
  if (!res.ok) {
    console.error(`[zoom-webhook] transcript fetch failed: ${res.status}`)
    return NextResponse.json({ error: 'transcript fetch failed' }, { status: 502 })
  }
  const vtt = await res.text()
  const transcript = vttToPlainText(vtt)

  // Forward to generic transcript ingest
  const baseUrl = new URL(request.url).origin
  const forward = await fetch(`${baseUrl}/api/webhooks/transcript`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': TRANSCRIPT_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      title: meeting.topic || 'Zoom meeting',
      transcript,
      source: 'zoom',
      external_id: meeting.uuid,
      recorded_at: transcriptFile.recording_start || new Date().toISOString(),
    }),
  })

  const data = await forward.json().catch(() => ({}))
  return NextResponse.json({ ok: forward.ok, forward_status: forward.status, ...data })
}

/** Strip VTT timestamps + cue numbers, keep just spoken text */
function vttToPlainText(vtt: string): string {
  return vtt
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (!t) return false
      if (t === 'WEBVTT') return false
      if (/^\d+$/.test(t)) return false
      if (/-->/.test(t)) return false
      return true
    })
    .join('\n')
    .trim()
}
