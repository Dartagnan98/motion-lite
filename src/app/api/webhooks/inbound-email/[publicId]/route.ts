import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createCrmContact,
  createCrmContactActivity,
  getCrmContactByEmail,
  getDb,
  getWorkspaceByPublicId,
  queueCrmWorkflowRunsForTrigger,
} from '@/lib/db'
import { fireAutoReplyAsync } from '@/lib/conversation-ai-autoreply'
import { ingestSupportEmailTicket, workspaceSupportEmailMatches } from '@/lib/crm-ticketing'
import { notifyContactOwner } from '@/lib/user-notify'

/**
 * Public inbound-email ingress. Mailgun or Postmark POSTs a parsed reply here;
 * we resolve/create the contact, log the activity, and fire the
 * inbound_email + customer_replied workflow triggers.
 *
 *   POST /api/webhooks/inbound-email/:publicId
 *
 * publicId is the per-workspace webhook id (reuses the workspace `public_id`
 * column, same pattern the workflow webhook_received trigger uses with its
 * per-row webhook_token).
 *
 * Always returns 200 so the provider does not retry. Errors are logged but
 * swallowed — this endpoint must never break the provider's delivery loop.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params
    const workspace = publicId ? getWorkspaceByPublicId(publicId) : null
    if (!workspace) return ok({ status: 'workspace_not_found' })

    const contentType = (request.headers.get('content-type') || '').toLowerCase()
    const isPostmark = contentType.includes('application/json')

    const rawBody = await request.text()

    if (isPostmark) {
      if (!verifyPostmark(request)) return ok({ status: 'invalid_signature' })
      const parsed = parsePostmark(rawBody)
      if (!parsed) return ok({ status: 'parse_failed' })
      return await ingest(workspace.id, parsed)
    }

    const formParams = await parseFormBody(rawBody, contentType)
    if (!verifyMailgun(formParams)) return ok({ status: 'invalid_signature' })
    const parsed = parseMailgun(formParams)
    if (!parsed) return ok({ status: 'parse_failed' })
    return await ingest(workspace.id, parsed)
  } catch (err) {
    console.error('[inbound-email] unexpected error', err)
    return ok({ status: 'error' })
  }
}

interface ParsedEmail {
  fromEmail: string
  fromName: string | null
  toEmail: string | null
  subject: string
  body: string
  bodyHtml: string | null
  messageId: string | null
}

async function ingest(workspaceId: number, email: ParsedEmail): Promise<Response> {
  const normalizedEmail = email.fromEmail.toLowerCase().trim()
  if (!normalizedEmail) return ok({ status: 'missing_sender' })

  let contact = getCrmContactByEmail(workspaceId, normalizedEmail)
  if (!contact) {
    const name = (email.fromName && email.fromName.trim()) || normalizedEmail
    contact = createCrmContact({
      workspaceId,
      name,
      email: normalizedEmail,
    })
    try {
      getDb()
        .prepare("UPDATE crm_contacts SET source = ? WHERE id = ?")
        .run('email', contact.id)
    } catch (err) {
      console.error('[inbound-email] failed to set contact source', err)
    }
  }

  const subject = email.subject.trim() || '(no subject)'
  const bodyPreview = email.body.trim().slice(0, 500)
  const activityBody = `${subject} - ${bodyPreview}`.slice(0, 2000)
  let ticketResult: { ticket: { id: number; ticket_number: number }; created: boolean } | null = null

  if (workspaceSupportEmailMatches(workspaceId, email.toEmail)) {
    try {
      const ticket = ingestSupportEmailTicket({
        workspaceId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        toEmail: email.toEmail,
        subject: email.subject,
        body: email.body,
        bodyHtml: email.bodyHtml,
        messageId: email.messageId,
        notifyOwner: false,
      })
      ticketResult = {
        ticket: { id: ticket.ticket.id, ticket_number: ticket.ticket.ticket_number },
        created: ticket.created,
      }
    } catch (err) {
      console.error('[inbound-email] failed to create ticket', err)
    }
  }

  try {
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId,
      type: 'email',
      body: `Inbound email: ${activityBody}`,
    })
  } catch (err) {
    console.error('[inbound-email] failed to write activity', err)
  }

  for (const triggerType of ['inbound_email', 'customer_replied'] as const) {
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId,
        contactId: contact.id,
        triggerType,
      })
    } catch (err) {
      console.error(`[inbound-email] failed to queue ${triggerType} runs`, err)
    }
  }

  fireAutoReplyAsync({
    workspaceId,
    contactId: contact.id,
    channel: 'email',
    messageBody: `${email.subject}

${email.body}`.trim(),
  })

  notifyContactOwner(workspaceId, contact.id, 'inbound_reply', (c) => ({
    title: ticketResult ? `${ticketResult.created ? 'New ticket' : 'Ticket updated'} #${ticketResult.ticket.ticket_number}` : `New reply from ${c.name}`,
    body: email.subject,
    href: ticketResult ? `/crm/tickets/${ticketResult.ticket.id}` : `/crm/contacts/${c.id}`,
    entity: ticketResult ? 'ticket' : 'contact',
    entity_id: ticketResult ? ticketResult.ticket.id : c.id,
  }))

  return ok({ status: 'ok', contact_id: contact.id, ticket_id: ticketResult?.ticket.id || null })
}

function parseMailgun(params: URLSearchParams): ParsedEmail | null {
  const fromRaw = (params.get('from') || params.get('sender') || '').trim()
  if (!fromRaw) return null
  const { email: fromEmail, name: fromName } = splitAddress(fromRaw)
  if (!fromEmail) return null
  const subject = params.get('subject') || ''
  const body = params.get('stripped-text') || params.get('body-plain') || ''
  const bodyHtml = params.get('stripped-html') || params.get('body-html') || null
  const toEmail = firstAddress(
    params.get('recipient')
    || params.get('To')
    || params.get('to')
    || params.get('X-Original-To')
    || params.get('Delivered-To')
    || null,
  )
  const messageId = params.get('Message-Id') || params.get('message-id') || null
  return { fromEmail, fromName, toEmail, subject, body, bodyHtml, messageId }
}

function parsePostmark(raw: string): ParsedEmail | null {
  if (!raw.trim()) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const fromFull = payload.FromFull as { Email?: string; Name?: string } | undefined
  const fromEmail = (fromFull?.Email || (payload.From as string) || '').toLowerCase().trim()
  if (!fromEmail) return null
  const fromName = (fromFull?.Name || '').trim() || null
  const subject = typeof payload.Subject === 'string' ? payload.Subject : ''
  const body = typeof payload.TextBody === 'string' ? payload.TextBody : ''
  const bodyHtml = typeof payload.HtmlBody === 'string' ? payload.HtmlBody : null
  const toEmail = firstAddress(
    typeof payload.OriginalRecipient === 'string' ? payload.OriginalRecipient
      : typeof payload.To === 'string' ? payload.To
      : Array.isArray(payload.ToFull) && payload.ToFull.length > 0 && typeof payload.ToFull[0] === 'object'
        ? String((payload.ToFull[0] as { Email?: string }).Email || '')
        : null,
  )
  const messageId = typeof payload.MessageID === 'string' ? payload.MessageID : null
  return { fromEmail, fromName, toEmail, subject, body, bodyHtml, messageId }
}

async function parseFormBody(raw: string, contentType: string): Promise<URLSearchParams> {
  if (contentType.includes('multipart/form-data')) {
    const params = new URLSearchParams()
    for (const rawLine of raw.split('\n')) {
      const line = rawLine.replace(/\r/g, '')
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx)
      const value = line.slice(idx + 1)
      if (key && !params.has(key)) params.append(key, value)
    }
    return params
  }
  return new URLSearchParams(raw)
}

function splitAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/)
  if (match) {
    const name = (match[1] || '').trim() || null
    const email = (match[2] || '').toLowerCase().trim()
    return { email, name }
  }
  return { email: raw.toLowerCase().trim(), name: null }
}

function firstAddress(raw: string | null): string | null {
  if (!raw) return null
  const parts = raw.split(',').map((part) => splitAddress(part).email).filter(Boolean)
  return parts[0] || null
}

function verifyMailgun(params: URLSearchParams): boolean {
  const signingKey = (process.env.MAILGUN_SIGNING_KEY || '').trim()
  if (!signingKey) return true
  const timestamp = params.get('timestamp') || ''
  const token = params.get('token') || ''
  const signature = params.get('signature') || ''
  if (!timestamp || !token || !signature) return false
  const expected = crypto.createHmac('sha256', signingKey).update(timestamp + token).digest('hex')
  return timingSafeEqualHex(expected, signature)
}

function verifyPostmark(request: NextRequest): boolean {
  const user = (process.env.POSTMARK_WEBHOOK_USER || '').trim()
  const pass = (process.env.POSTMARK_WEBHOOK_PASS || '').trim()
  if (!user && !pass) return true
  const header = request.headers.get('authorization') || ''
  if (!header.toLowerCase().startsWith('basic ')) return false
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
  const idx = decoded.indexOf(':')
  if (idx < 0) return false
  const gotUser = decoded.slice(0, idx)
  const gotPass = decoded.slice(idx + 1)
  return timingSafeEqualStr(gotUser, user) && timingSafeEqualStr(gotPass, pass)
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length || bufA.length === 0) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

function ok(body: Record<string, unknown>) {
  return NextResponse.json({ received: true, ...body }, { status: 200 })
}
