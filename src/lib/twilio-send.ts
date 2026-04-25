import { getSetting } from '@/lib/settings'
import { getWorkspaceIntegration } from '@/lib/db'

export function toE164(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/\D/g, '')
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits ? `+${digits}` : ''
}

export type TwilioCreds = {
  accountSid: string
  authToken: string
  fromPhone: string
  messagingServiceSid: string
}

export function resolveTwilioCreds(workspaceId: number): TwilioCreds {
  const integration = getWorkspaceIntegration(workspaceId, 'twilio')
  const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
  const authToken = String(integration?.config.auth_token || getSetting('twilio_auth_token') || '').trim()
  const fromPhoneRaw = String(integration?.config.from_number || getSetting('twilio_phone_number') || '').trim()
  const messagingServiceSid = String(integration?.config.messaging_service_sid || getSetting('twilio_messaging_service_sid') || '').trim()
  const fromPhone = fromPhoneRaw ? (toE164(fromPhoneRaw) || fromPhoneRaw) : ''
  return { accountSid, authToken, fromPhone, messagingServiceSid }
}

export type TwilioSendResult = {
  ok: boolean
  status: number
  sid: string | null
  /** 'sms' | 'rcs' | 'whatsapp' — Twilio returns the actual delivered channel in webhooks but the create call returns 'messaging_service_sid' or 'from' with the rendered channel on `messaging_channel` (newer SDKs) */
  channel: string | null
  error: string | null
  raw: Record<string, unknown> | null
}

export async function sendTwilioMessage(opts: {
  workspaceId: number
  to: string
  body: string
  /** Pass explicit creds to override the workspace lookup. Useful for broadcasts that already resolved them. */
  creds?: TwilioCreds
}): Promise<TwilioSendResult> {
  const creds = opts.creds ?? resolveTwilioCreds(opts.workspaceId)
  if (!creds.accountSid || !creds.authToken) {
    return { ok: false, status: 400, sid: null, channel: null, error: 'Twilio is not configured', raw: null }
  }
  if (!creds.messagingServiceSid && !creds.fromPhone) {
    return { ok: false, status: 400, sid: null, channel: null, error: 'Twilio requires a Messaging Service SID or From number', raw: null }
  }

  const to = toE164(opts.to)
  if (!to) {
    return { ok: false, status: 400, sid: null, channel: null, error: `Invalid phone number: ${opts.to}`, raw: null }
  }

  const params = new URLSearchParams({ To: to, Body: opts.body })
  // MessagingServiceSid enables automatic RCS upgrade + SMS fallback when the
  // service is configured with an RCS Agent + SMS sender pool.
  if (creds.messagingServiceSid) {
    params.set('MessagingServiceSid', creds.messagingServiceSid)
  } else {
    params.set('From', creds.fromPhone)
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })

  const text = await res.text()
  let payload: Record<string, unknown> | null = null
  try { payload = JSON.parse(text) as Record<string, unknown> } catch { payload = null }

  if (!res.ok) {
    const errorMessage = typeof payload?.message === 'string' ? payload.message : text || 'Twilio send failed'
    return { ok: false, status: res.status, sid: null, channel: null, error: errorMessage, raw: payload }
  }

  const sid = typeof payload?.sid === 'string' ? payload.sid : null
  // The Messages create response can include `messaging_channel` with values
  // like "sms", "rcs", "whatsapp". Older API versions return `channel` instead.
  const channelRaw = (payload?.messaging_channel ?? payload?.channel) as unknown
  const channel = typeof channelRaw === 'string' ? channelRaw.toLowerCase() : null

  return { ok: true, status: res.status, sid, channel, error: null, raw: payload }
}
