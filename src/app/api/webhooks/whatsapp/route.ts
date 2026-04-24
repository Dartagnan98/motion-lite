import { type NextRequest, NextResponse } from 'next/server'
import {
  createWhatsAppMessage,
  createCrmContact,
  findCrmContactsByPhone,
  findWorkspaceIdByWhatsAppPhoneNumberId,
  getCrmWhatsAppAccount,
  getDb,
  queueCrmWorkflowRunsForTrigger,
} from '@/lib/db'
import { fireAutoReplyAsync } from '@/lib/conversation-ai-autoreply'
import { notifyContactOwner } from '@/lib/user-notify'

/**
 * WhatsApp Business Cloud API webhook.
 *
 *   GET  /api/webhooks/whatsapp   — verify handshake. Meta sends
 *      hub.mode, hub.challenge, hub.verify_token. We look up every
 *      connected account and echo the challenge if any workspace's
 *      verify_token matches.
 *   POST /api/webhooks/whatsapp   — inbound messages + status callbacks.
 *
 * Always returns 200 on POST so Meta does not retry on our internal errors.
 * Mirrors the Twilio SMS webhook flow: resolve workspace by the receiving
 * phone_number_id, upsert a contact by `from` phone, insert a crm_whatsapp_
 * messages row, fire customer_replied + whatsapp_message_received triggers,
 * and kick the auto-reply runtime asynchronously.
 */

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  const mode = search.get('hub.mode') || ''
  const challenge = search.get('hub.challenge') || ''
  const token = search.get('hub.verify_token') || ''

  if (mode !== 'subscribe' || !token) {
    return new NextResponse('forbidden', { status: 403 })
  }

  // The WhatsApp webhook is a single global endpoint shared by every
  // workspace that connects their own phone_number_id. To verify we accept
  // the challenge if ANY active account has this verify_token.
  try {
    const row = getDb()
      .prepare("SELECT id FROM crm_whatsapp_accounts WHERE verify_token = ? AND disconnected_at IS NULL LIMIT 1")
      .get(token) as { id?: number } | undefined
    if (!row?.id) return new NextResponse('forbidden', { status: 403 })
  } catch {
    return new NextResponse('forbidden', { status: 403 })
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

interface WhatsAppTextMessage {
  from?: string
  id?: string
  type?: string
  text?: { body?: string }
  timestamp?: string
}

interface WhatsAppChangeValue {
  messaging_product?: string
  metadata?: {
    display_phone_number?: string
    phone_number_id?: string
  }
  contacts?: Array<{
    profile?: { name?: string }
    wa_id?: string
  }>
  messages?: WhatsAppTextMessage[]
}

interface WhatsAppChange {
  field?: string
  value?: WhatsAppChangeValue
}

interface WhatsAppEntry {
  id?: string
  changes?: WhatsAppChange[]
}

interface WhatsAppPayload {
  object?: string
  entry?: WhatsAppEntry[]
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    let payload: WhatsAppPayload
    try {
      payload = JSON.parse(raw) as WhatsAppPayload
    } catch {
      return ok()
    }
    if (!payload || typeof payload !== 'object') return ok()

    const entries = Array.isArray(payload.entry) ? payload.entry : []
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : []
      for (const change of changes) {
        await handleChange(change)
      }
    }
    return ok()
  } catch (err) {
    console.error('[whatsapp webhook] unexpected error', err)
    return ok()
  }
}

async function handleChange(change: WhatsAppChange): Promise<void> {
  const value = change.value || {}
  const messages = Array.isArray(value.messages) ? value.messages : []
  if (messages.length === 0) return

  const phoneNumberId = value.metadata?.phone_number_id || ''
  if (!phoneNumberId) return

  const workspaceId = findWorkspaceIdByWhatsAppPhoneNumberId(phoneNumberId)
  if (!workspaceId) return

  const account = getCrmWhatsAppAccount(workspaceId)
  const toPhone = account?.display_phone || value.metadata?.display_phone_number || ''

  const contactProfile = Array.isArray(value.contacts) && value.contacts[0]
    ? value.contacts[0]
    : null
  const profileName = contactProfile?.profile?.name?.trim() || null

  for (const message of messages) {
    if (!message || message.type !== 'text') continue
    const from = String(message.from || '').trim()
    const body = message.text?.body?.trim() || ''
    if (!from || !body) continue

    // Resolve or create the contact. Match by the sender phone first so
    // existing SMS/email contacts are reused across channels.
    const matches = findCrmContactsByPhone(from, workspaceId)
    let contactId = matches[0]?.id ?? null
    if (!contactId) {
      const created = createCrmContact({
        workspaceId,
        name: profileName || from,
        phone: from,
      })
      contactId = created.id
    }

    createWhatsAppMessage({
      contact_id: contactId,
      workspace_id: workspaceId,
      direction: 'inbound',
      body,
      from_phone: from,
      to_phone: toPhone || null,
      wa_message_id: message.id || null,
    })

    // Fire triggers — both the cross-channel customer_replied and the
    // WhatsApp-specific one so workflows can scope to either.
    queueCrmWorkflowRunsForTrigger({
      workspaceId,
      contactId,
      triggerType: 'whatsapp_message_received',
    })
    queueCrmWorkflowRunsForTrigger({
      workspaceId,
      contactId,
      triggerType: 'customer_replied',
      triggerValue: 'whatsapp',
    })

    notifyContactOwner(workspaceId, contactId, 'inbound_reply', (c) => ({
      title: `New WhatsApp from ${c.name}`,
      body: body.length > 140 ? body.slice(0, 137) + '...' : body,
      href: `/crm/contacts/${c.id}`,
      entity: 'contact',
      entity_id: c.id,
    }))

    fireAutoReplyAsync({
      workspaceId,
      contactId,
      channel: 'whatsapp',
      messageBody: body,
    })
  }
}

function ok(): Response {
  return NextResponse.json({ received: true }, { status: 200 })
}
