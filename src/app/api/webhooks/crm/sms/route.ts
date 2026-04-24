import crypto from 'crypto'
import { type NextRequest } from 'next/server'
import { createCrmContactActivity, createSmsMessage, findCrmContactsByPhone, getSmsMessageByTwilioSid } from '@/lib/db'
import { getSetting } from '@/lib/settings'

function xmlOkResponse(status: string) {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'X-CRM-Status': status,
    },
  })
}

function secureSignatureMatch(left: string, right: string): boolean {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  if (a.length !== b.length || !a.length) return false
  return crypto.timingSafeEqual(a, b)
}

function buildTwilioSignature(url: string, params: URLSearchParams, authToken: string): string {
  let payload = url
  const sortedEntries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))
  for (const [key, value] of sortedEntries) payload += `${key}${value}`
  return crypto.createHmac('sha1', authToken).update(payload).digest('base64')
}

function signatureCandidates(request: NextRequest): string[] {
  const values = new Set<string>()
  const pathnameWithSearch = `${request.nextUrl.pathname}${request.nextUrl.search}`
  values.add(request.url)
  values.add(`${request.nextUrl.protocol}//${request.nextUrl.host}${pathnameWithSearch}`)

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(':', '')
  if (forwardedHost) values.add(`${forwardedProto}://${forwardedHost}${pathnameWithSearch}`)

  const configuredBase = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim()
  if (configuredBase) values.add(`${configuredBase.replace(/\/+$/, '')}${pathnameWithSearch}`)

  return Array.from(values).filter(Boolean)
}

function verifyTwilioSignature(request: NextRequest, params: URLSearchParams, authToken: string): boolean {
  const incoming = String(request.headers.get('x-twilio-signature') || '').trim()
  if (!incoming) return false
  for (const candidateUrl of signatureCandidates(request)) {
    const expected = buildTwilioSignature(candidateUrl, params, authToken)
    if (secureSignatureMatch(expected, incoming)) return true
  }
  return false
}

function parseOptionalPositiveInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export async function POST(request: NextRequest) {
  const accountSid = String(getSetting('twilio_account_sid') || '').trim()
  const authToken = String(getSetting('twilio_auth_token') || '').trim()
  if (!accountSid || !authToken) return xmlOkResponse('twilio_not_configured')

  const form = await request.formData()
  const params = new URLSearchParams()
  for (const [key, value] of form.entries()) params.append(key, String(value))

  if (!verifyTwilioSignature(request, params, authToken)) return xmlOkResponse('invalid_signature')

  const inboundAccountSid = String(form.get('AccountSid') || '').trim()
  if (inboundAccountSid && inboundAccountSid !== accountSid) return xmlOkResponse('wrong_account')

  const from = String(form.get('From') || '').trim()
  const to = String(form.get('To') || '').trim()
  const body = String(form.get('Body') || '').trim()
  const twilioSid = String(form.get('MessageSid') || form.get('SmsSid') || '').trim()
  const workspaceId = parseOptionalPositiveInt(request.nextUrl.searchParams.get('workspace_id'))

  if (!from || !body) return xmlOkResponse('missing_fields')
  if (twilioSid && getSmsMessageByTwilioSid(twilioSid)) return xmlOkResponse('duplicate')

  const matches = findCrmContactsByPhone(from, workspaceId || undefined)
  if (!matches.length) return xmlOkResponse('contact_not_found')

  const contact = matches[0]
  const preview = body.length > 220 ? `${body.slice(0, 217)}...` : body

  createSmsMessage({
    contact_id: contact.id,
    direction: 'inbound',
    body,
    from_phone: from,
    to_phone: to || undefined,
    twilio_sid: twilioSid || undefined,
  })

  // No activity log for inbound SMS — the message already appears in the chat thread.

  if (matches.length > 1) {
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: contact.workspace_id,
      type: 'note',
      body: `Inbound SMS matched ${matches.length} contacts by phone. Routed to latest contact "${contact.name}".`,
    })
  }

  return xmlOkResponse(matches.length > 1 ? 'ok_ambiguous_match' : 'ok')
}
