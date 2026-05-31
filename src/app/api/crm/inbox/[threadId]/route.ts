// /api/crm/inbox/[threadId] — GET messages on a thread, POST a new outbound message.
//
// threadId === crm_contacts.id (see /api/crm/inbox for the merged-thread model).
//
// GET returns { thread, messages } where:
//   - thread is the CrmConversationThread summary
//   - messages is a chronologically-sorted, normalized union of every channel's
//     rows for this contact: { id, channel, direction, body, sent_at, raw }
//
// POST { channel, body } records the outbound message in the matching db table.
//
// ─── HARD CONSTRAINT — provider delivery is NOT wired ────────────────────────
// This endpoint persists the outbound row so the UI shows the message in the
// thread. It does NOT call Twilio (sms/whatsapp), SendGrid (email), Instagram
// Graph, or the chat widget transport. The messaging-provider sprint hooks the
// actual send into the same code path right after the row is created.
// Look for `// OUTBOUND DELIVERY TODO:` below.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getConversationThreads,
  getCrmContactById,
  getSmsMessages,
  getChatMessagesByContact,
  getWhatsAppMessagesByContact,
  getInstagramMessagesByContact,
  createSmsMessage,
  createWhatsAppMessage,
  createInstagramMessage,
  createInboxMessage,
  recordChatMessage,
  getDefaultEmailAccount,
  getUserWorkspaces,
  getDb,
  type EmailInboxMessage,
  type CrmSmsMessage,
  type CrmChatMessage,
  type CrmWhatsAppMessage,
  type CrmInstagramMessage,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

type NormalizedMessage = {
  id: number
  channel: 'email' | 'sms' | 'chat' | 'whatsapp' | 'instagram'
  direction: 'inbound' | 'outbound'
  body: string
  sent_at: number
  // Channel-specific extras (subject for email, from/to phone for sms, etc.)
  meta: Record<string, unknown>
}

function normalizeEmail(m: EmailInboxMessage): NormalizedMessage {
  return {
    id: m.id,
    channel: 'email',
    direction: m.direction as 'inbound' | 'outbound',
    body: (m.body_html || '').replace(/<[^>]+>/g, '').trim(),
    sent_at: m.received_at,
    meta: { subject: m.subject, from_email: m.from_email, to_email: m.to_email, thread_id: m.thread_id, account_id: m.account_id },
  }
}
function normalizeSms(m: CrmSmsMessage): NormalizedMessage {
  return { id: m.id, channel: 'sms', direction: m.direction, body: m.body, sent_at: m.sent_at, meta: { from_phone: m.from_phone, to_phone: m.to_phone } }
}
function normalizeChat(m: CrmChatMessage): NormalizedMessage {
  return { id: m.id, channel: 'chat', direction: m.direction, body: m.body, sent_at: m.sent_at, meta: { widget_id: m.widget_id, session_token: m.session_token } }
}
function normalizeWhatsApp(m: CrmWhatsAppMessage): NormalizedMessage {
  return { id: m.id, channel: 'whatsapp', direction: m.direction, body: m.body, sent_at: m.sent_at, meta: { from_phone: m.from_phone, to_phone: m.to_phone, wa_message_id: m.wa_message_id } }
}
function normalizeInstagram(m: CrmInstagramMessage): NormalizedMessage {
  return { id: m.id, channel: 'instagram', direction: m.direction, body: m.body, sent_at: m.sent_at, meta: { ig_sender_id: m.ig_sender_id, ig_recipient_id: m.ig_recipient_id, ig_message_id: m.ig_message_id } }
}

function getEmailMessagesByContact(contactId: number): EmailInboxMessage[] {
  return getDb()
    .prepare('SELECT * FROM email_inboxes WHERE contact_id = ? ORDER BY received_at ASC')
    .all(contactId) as EmailInboxMessage[]
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { threadId } = await params
  const contactId = Number(threadId)
  if (!Number.isFinite(contactId) || contactId <= 0) {
    return NextResponse.json({ error: 'Invalid threadId' }, { status: 400 })
  }
  const contact = getCrmContactById(contactId, workspaceId)
  if (!contact) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '200', 10) || 200, 1000)

  const merged: NormalizedMessage[] = [
    ...getEmailMessagesByContact(contactId).map(normalizeEmail),
    ...getSmsMessages(contactId).map(normalizeSms),
    ...getChatMessagesByContact(contactId).map(normalizeChat),
    ...getWhatsAppMessagesByContact(contactId).map(normalizeWhatsApp),
    ...getInstagramMessagesByContact(contactId).map(normalizeInstagram),
  ].sort((a, b) => a.sent_at - b.sent_at)

  const messages = merged.length > limit ? merged.slice(-limit) : merged

  // Surface the thread summary too so the UI doesn't need a second roundtrip.
  // getConversationThreads doesn't expose a per-id getter, so we filter the
  // workspace list. It's already cached server-side per request.
  const threads = getConversationThreads(workspaceId)
  const thread = threads.find((t) => t.contact_id === contactId) ?? {
    contact_id: contact.id,
    contact_name: contact.name,
    contact_email: contact.email,
    contact_phone: contact.phone,
    latest_at: 0,
    unread_count: 0,
    latest_body: null,
    latest_direction: null,
    channels: '',
    assigned_user_id: contact.owner_id,
    assigned_user_name: null,
  }

  return NextResponse.json({ thread, messages })
}

type Channel = 'sms' | 'whatsapp' | 'email' | 'chat' | 'instagram'
const CHANNELS: Channel[] = ['sms', 'whatsapp', 'email', 'chat', 'instagram']

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { threadId } = await params
  const contactId = Number(threadId)
  if (!Number.isFinite(contactId) || contactId <= 0) {
    return NextResponse.json({ error: 'Invalid threadId' }, { status: 400 })
  }
  const contact = getCrmContactById(contactId, workspaceId)
  if (!contact) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  let body: { channel?: unknown; body?: unknown; subject?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const channel = typeof body.channel === 'string' && (CHANNELS as string[]).includes(body.channel) ? (body.channel as Channel) : null
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!channel) return NextResponse.json({ error: 'channel must be one of: ' + CHANNELS.join(', ') }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 })

  // OUTBOUND DELIVERY TODO: after the row is created, hand off to the provider.
  // sms       → Twilio Messages.create
  // whatsapp  → Twilio (or Meta) WhatsApp
  // email     → SendGrid or SMTP via EmailAccount
  // instagram → Meta Graph send
  // chat      → push to live socket / poll inbox for the widget visitor
  // Until then, the message is persisted and shown in the UI but the recipient
  // never receives it.

  if (channel === 'sms') {
    if (!contact.phone) return NextResponse.json({ error: 'Contact has no phone' }, { status: 400 })
    const message = createSmsMessage({
      contact_id: contactId,
      direction: 'outbound',
      body: text,
      to_phone: contact.phone,
    })
    return NextResponse.json({ channel, message })
  }

  if (channel === 'whatsapp') {
    if (!contact.phone) return NextResponse.json({ error: 'Contact has no phone' }, { status: 400 })
    const message = createWhatsAppMessage({
      contact_id: contactId,
      workspace_id: workspaceId,
      direction: 'outbound',
      body: text,
      to_phone: contact.phone,
    })
    return NextResponse.json({ channel, message })
  }

  if (channel === 'instagram') {
    if (!contact.external_instagram_id) return NextResponse.json({ error: 'Contact has no Instagram id' }, { status: 400 })
    const message = createInstagramMessage({
      contact_id: contactId,
      workspace_id: workspaceId,
      direction: 'outbound',
      body: text,
      ig_recipient_id: contact.external_instagram_id,
    })
    return NextResponse.json({ channel, message })
  }

  if (channel === 'email') {
    if (!contact.email) return NextResponse.json({ error: 'Contact has no email' }, { status: 400 })
    const account = getDefaultEmailAccount(workspaceId)
    if (!account) return NextResponse.json({ error: 'No default email account configured for workspace' }, { status: 400 })
    const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : '(no subject)'
    const message = createInboxMessage({
      account_id: account.id,
      contact_id: contactId,
      direction: 'outbound',
      subject,
      body_html: text,
      from_email: account.email,
      to_email: contact.email,
    })
    return NextResponse.json({ channel, message })
  }

  if (channel === 'chat') {
    // Webchat outbound needs a widget_id. Pick the contact's most recent
    // chat row to inherit its widget + session, since we don't have a
    // "the workspace's default widget" concept yet.
    const lastChat = getChatMessagesByContact(contactId).slice(-1)[0]
    if (!lastChat) {
      return NextResponse.json({ error: 'Cannot reply via chat — no prior chat session for this contact' }, { status: 400 })
    }
    const message = recordChatMessage({
      widgetId: lastChat.widget_id,
      contactId,
      workspaceId,
      direction: 'outbound',
      body: text,
      sessionToken: lastChat.session_token,
    })
    return NextResponse.json({ channel, message })
  }

  return NextResponse.json({ error: 'Unhandled channel' }, { status: 400 })
}
