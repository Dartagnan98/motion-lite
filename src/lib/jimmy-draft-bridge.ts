/**
 * Jimmy Draft Bridge
 *
 * When an inbound message lands on SMS/WhatsApp/Instagram/etc., we:
 *   1. Generate a short reply draft via Claude Haiku.
 *   2. POST the draft to the Mac-side dispatch bridge (/draft-from-inbound).
 *
 * The Mac bridge inserts a row into agent-session's approval_queue and pops a
 * Telegram card with Approve / Edit / Trash buttons. Approve calls back into
 * motion-lite's /api/bridge/sms/send (or equivalent) to actually send the reply.
 *
 * Every path is fire-and-forget so the webhook that called us stays healthy.
 */

import { runCrmAiCompletion } from '@/lib/crm-ai'
import { getSetting } from '@/lib/settings'
import {
  getCrmContactById,
  getSmsMessages,
  getChatMessagesByContact,
  type CrmContactRecord,
} from '@/lib/db'

export type JimmyDraftChannel = 'sms' | 'whatsapp' | 'instagram' | 'imessage'

interface RequestDraftParams {
  workspaceId: number
  contactId: number
  channel: JimmyDraftChannel
  inboundBody: string
}

type HistoryLine = { ts: number; role: 'contact' | 'us'; body: string }

function gatherHistory(contactId: number): HistoryLine[] {
  const history: HistoryLine[] = []
  try {
    for (const m of getSmsMessages(contactId)) {
      history.push({ ts: m.sent_at, role: m.direction === 'inbound' ? 'contact' : 'us', body: m.body })
    }
  } catch { /* ignore */ }
  try {
    for (const m of getChatMessagesByContact(contactId)) {
      history.push({ ts: m.sent_at, role: m.direction === 'inbound' ? 'contact' : 'us', body: m.body })
    }
  } catch { /* ignore */ }
  history.sort((a, b) => a.ts - b.ts)
  return history.slice(-10)
}

function buildSystemPrompt(channel: JimmyDraftChannel, contact: CrmContactRecord): string {
  const profile = [
    contact.name ? `Name: ${contact.name}` : null,
    contact.company ? `Company: ${contact.company}` : null,
    contact.lifecycle_stage ? `Lifecycle: ${contact.lifecycle_stage}` : null,
    contact.tags ? `Tags: ${contact.tags}` : null,
  ].filter(Boolean).join(' | ')
  return [
    `You draft short, direct replies for Operator (founder, Example Co — a solopreneur Meta ads agency).`,
    `Tone: chill, grounded, straight up. No em dashes. No AI clichés. No sycophancy. Tight.`,
    `Channel: ${channel}. Keep SMS/iMessage/WhatsApp under 220 chars when possible.`,
    `Write ONLY the reply body — no preamble, no sign-off unless natural.`,
    profile ? `Contact profile: ${profile}` : '',
  ].filter(Boolean).join('\n')
}

async function generateDraft(params: RequestDraftParams, contact: CrmContactRecord): Promise<string> {
  const history = gatherHistory(params.contactId)
  const transcript = history.map((h) => `${h.role === 'contact' ? 'Contact' : 'Us'}: ${h.body}`).join('\n')
  const userPrompt = [
    transcript ? `Recent conversation:\n${transcript}` : '',
    `Contact just sent (${params.channel}):\n${params.inboundBody}`,
    `Draft the reply.`,
  ].filter(Boolean).join('\n\n')
  const result = await runCrmAiCompletion({
    systemPrompt: buildSystemPrompt(params.channel, contact),
    userPrompt,
    maxTokens: 320,
    temperature: 0.4,
  })
  return result.text.trim()
}

export async function requestJimmyDraft(params: RequestDraftParams): Promise<void> {
  try {
    const contact = getCrmContactById(params.contactId, params.workspaceId)
    if (!contact) return
    const phone = contact.phone || contact.email || ''
    if (!phone) return

    const draft = await generateDraft(params, contact)

    const webhookUrl = getSetting<string>('dispatchWebhookUrl')
    const webhookToken = getSetting<string>('dispatchWebhookToken')
    if (!webhookUrl) return

    const base = webhookUrl.replace(/\/+$/, '')
    const target = `${base}/draft-from-inbound`

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (webhookToken) headers['x-push-token'] = webhookToken

    await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        channel: params.channel,
        recipient: phone,
        contact_name: contact.name || '',
        inbound_body: params.inboundBody,
        ai_draft: draft,
        context: `workspace=${params.workspaceId} contact=${params.contactId}`,
        tier: 'other',
      }),
    }).catch(() => { /* ignore transport errors */ })
  } catch {
    // Draft flow should never break the calling webhook.
  }
}

/** Fire-and-forget wrapper; webhook handlers call this then return immediately. */
export function fireJimmyDraftAsync(params: RequestDraftParams): void {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  Promise.resolve().then(() => requestJimmyDraft(params))
}
