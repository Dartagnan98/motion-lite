import { type NextRequest, NextResponse } from 'next/server'
import {
  createCrmContact,
  createInstagramMessage,
  findCrmContactByInstagramId,
  findWorkspaceIdByInstagramBusinessId,
  getDb,
  queueCrmWorkflowRunsForTrigger,
} from '@/lib/db'
import { fireAutoReplyAsync } from '@/lib/conversation-ai-autoreply'
import { notifyContactOwner } from '@/lib/user-notify'

/**
 * Instagram Messaging API (DMs) webhook.
 *
 *   GET  /api/webhooks/instagram   — verify handshake, same scheme as
 *      WhatsApp. hub.verify_token is compared against every active
 *      workspace's stored verify_token.
 *   POST /api/webhooks/instagram   — inbound DMs + read receipts.
 *
 * Meta sends a top-level `{ object: 'instagram', entry: [...] }` payload.
 * Each entry has `id` (= IG business account id) and `messaging[]` with
 * one message per inbound DM. Sender is identified by IGSID in
 * `sender.id`.
 *
 * Always returns 200 so Meta does not retry on our side.
 */

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  const mode = search.get('hub.mode') || ''
  const challenge = search.get('hub.challenge') || ''
  const token = search.get('hub.verify_token') || ''

  if (mode !== 'subscribe' || !token) {
    return new NextResponse('forbidden', { status: 403 })
  }

  try {
    const row = getDb()
      .prepare("SELECT id FROM crm_instagram_accounts WHERE verify_token = ? AND disconnected_at IS NULL LIMIT 1")
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

interface InstagramMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
  }
}

interface InstagramEntry {
  id?: string
  time?: number
  messaging?: InstagramMessagingEvent[]
}

interface InstagramPayload {
  object?: string
  entry?: InstagramEntry[]
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    let payload: InstagramPayload
    try {
      payload = JSON.parse(raw) as InstagramPayload
    } catch {
      return ok()
    }
    if (!payload || typeof payload !== 'object') return ok()

    const entries = Array.isArray(payload.entry) ? payload.entry : []
    for (const entry of entries) {
      await handleEntry(entry)
    }
    return ok()
  } catch (err) {
    console.error('[instagram webhook] unexpected error', err)
    return ok()
  }
}

async function handleEntry(entry: InstagramEntry): Promise<void> {
  const igBusinessId = String(entry.id || '').trim()
  if (!igBusinessId) return

  const workspaceId = findWorkspaceIdByInstagramBusinessId(igBusinessId)
  if (!workspaceId) return

  const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : []
  for (const event of messagingEvents) {
    // Echo events are our own outbound messages bounced back — ignore so
    // the inbox doesn't double up.
    if (event?.message?.is_echo) continue

    const senderId = String(event?.sender?.id || '').trim()
    const recipientId = String(event?.recipient?.id || '').trim()
    const body = (event?.message?.text || '').trim()
    if (!senderId || !body) continue
    // Ignore messages where the sender is our own business account.
    if (senderId === igBusinessId) continue

    // Resolve or create the contact by IGSID.
    let contact = findCrmContactByInstagramId(workspaceId, senderId)
    if (!contact) {
      const created = createCrmContact({
        workspaceId,
        name: `Instagram ${senderId.slice(0, 8)}`,
      })
      try {
        getDb()
          .prepare('UPDATE crm_contacts SET external_instagram_id = ?, source = COALESCE(source, ?) WHERE id = ?')
          .run(senderId, 'instagram', created.id)
      } catch (err) {
        console.error('[instagram webhook] failed to set IGSID on contact', err)
      }
      const refreshed = findCrmContactByInstagramId(workspaceId, senderId)
      contact = refreshed || created
    }

    if (!contact) continue

    createInstagramMessage({
      contact_id: contact.id,
      workspace_id: workspaceId,
      direction: 'inbound',
      body,
      ig_sender_id: senderId,
      ig_recipient_id: recipientId || igBusinessId,
      ig_message_id: event?.message?.mid || null,
    })

    queueCrmWorkflowRunsForTrigger({
      workspaceId,
      contactId: contact.id,
      triggerType: 'instagram_message_received',
    })
    queueCrmWorkflowRunsForTrigger({
      workspaceId,
      contactId: contact.id,
      triggerType: 'customer_replied',
      triggerValue: 'instagram',
    })

    notifyContactOwner(workspaceId, contact.id, 'inbound_reply', (c) => ({
      title: `New Instagram DM from ${c.name}`,
      body: body.length > 140 ? body.slice(0, 137) + '...' : body,
      href: `/crm/contacts/${c.id}`,
      entity: 'contact',
      entity_id: c.id,
    }))

    fireAutoReplyAsync({
      workspaceId,
      contactId: contact.id,
      channel: 'instagram',
      messageBody: body,
    })
  }
}

function ok(): Response {
  return NextResponse.json({ received: true }, { status: 200 })
}
