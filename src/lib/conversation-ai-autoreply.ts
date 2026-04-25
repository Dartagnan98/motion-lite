/**
 * Conversation AI auto-reply runtime.
 *
 * The CRM inbox already has a Claude Haiku 4.5 draft button (see
 * `src/app/api/crm/conversations/[contactId]/ai-draft/route.ts`). This module
 * turns that draft into an actual outbound message when the workspace has
 * opted into auto-reply and the model reports high enough confidence.
 *
 * The three inbound webhooks fire this function async so the webhook response
 * never blocks on an LLM round-trip:
 *   - Twilio SMS inbound  → channel 'sms'
 *   - Mailgun / Postmark  → channel 'email'
 *   - Webchat widget POST → channel 'chat'
 *
 * Every decision is logged to `crm_ai_autoreply_log` — a 'sent' row is the
 * only outcome that actually sent a message; everything else explains why we
 * stayed quiet. The /crm/reports/ai-autoreply dashboard reads these rows.
 */

import {
  createCrmContactActivity,
  createDirectEmailSend,
  createEmailInboxEntry,
  createInstagramMessage,
  createSmsMessage,
  createWhatsAppMessage,
  getChatMessagesByContact,
  getCrmContactById,
  getCrmInstagramAccount,
  getCrmWhatsAppAccount,
  getDefaultEmailAccount,
  getDb,
  getInstagramMessagesByContact,
  getSmsMessages,
  getWhatsAppMessagesByContact,
  getWorkspaceById,
  getWorkspaceIntegration,
  logCrmAiAutoReply,
  queueCrmWorkflowRunsForTrigger,
  recordChatMessage,
  countCrmAiAutoReplySentForContactToday,
  type CrmAiAutoReplyOutcome,
  type CrmContactRecord,
} from '@/lib/db'
import type { Workspace } from '@/lib/types'
import { sendEmail } from '@/lib/gmail-send'
import { getSetting } from '@/lib/settings'

export type AutoReplyChannel = 'sms' | 'email' | 'chat' | 'whatsapp' | 'instagram'

interface AutoReplyParams {
  workspaceId: number
  contactId: number
  channel: AutoReplyChannel
  messageBody: string
}

export interface AutoReplyResult {
  outcome: CrmAiAutoReplyOutcome
  confidence?: number
  sent?: boolean
  reason?: string
}

/**
 * Public entry point. Never throws — every failure path funnels into a log
 * row with outcome='error' so the webhook that called us stays healthy.
 */
export async function runAutoReplyForInbound(params: AutoReplyParams): Promise<AutoReplyResult> {
  try {
    return await runInternal(params)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Auto-reply crashed'
    try {
      logCrmAiAutoReply({
        workspaceId: params.workspaceId,
        contactId: params.contactId,
        channel: params.channel,
        inboundMessage: params.messageBody,
        outcome: 'error',
        errorMessage,
      })
    } catch { /* swallow — logging must not recurse */ }
    return { outcome: 'error', sent: false, reason: errorMessage }
  }
}

async function runInternal(params: AutoReplyParams): Promise<AutoReplyResult> {
  const { workspaceId, contactId, channel, messageBody } = params
  const trimmed = messageBody.trim()
  if (!trimmed) return { outcome: 'error', sent: false, reason: 'Empty inbound body' }

  const workspace = getWorkspaceById(workspaceId)
  if (!workspace) {
    return { outcome: 'error', sent: false, reason: 'Workspace not found' }
  }

  // 1. Enabled check
  if (!workspace.ai_autoreply_enabled) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'skipped_disabled',
    })
    return { outcome: 'skipped_disabled', sent: false }
  }

  // 2. Channel subscription
  const enabledChannels = parseChannelList(workspace.ai_autoreply_channels)
  if (!enabledChannels.has(channel)) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'skipped_channel',
    })
    return { outcome: 'skipped_channel', sent: false }
  }

  // 3. Business-hours gate — the toggle means "only auto-reply OUTSIDE hours
  //    so humans can handle during the day." When on, we run only when we're
  //    OUTSIDE the open window.
  if (workspace.ai_autoreply_business_hours_only && isWithinBusinessHours(workspace)) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'skipped_hours',
    })
    return { outcome: 'skipped_hours', sent: false }
  }

  // 4. Per-contact daily quota
  const cap = Math.max(0, workspace.ai_autoreply_max_per_contact_per_day ?? 5)
  if (cap > 0) {
    const sentToday = countCrmAiAutoReplySentForContactToday(contactId, workspaceId)
    if (sentToday >= cap) {
      logCrmAiAutoReply({
        workspaceId, contactId, channel,
        inboundMessage: trimmed,
        outcome: 'skipped_quota',
      })
      return { outcome: 'skipped_quota', sent: false }
    }
  }

  // 5. Handoff keyword scan (case-insensitive word-boundary match)
  const handoffHit = matchHandoffKeyword(trimmed, workspace.ai_autoreply_handoff_keywords || '')
  if (handoffHit) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'handoff_keyword',
      errorMessage: `Matched keyword: ${handoffHit}`,
    })
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId,
        contactId,
        triggerType: 'customer_requested_human',
        triggerValue: handoffHit,
      })
    } catch { /* keep going */ }
    return { outcome: 'handoff_keyword', sent: false, reason: `Matched keyword: ${handoffHit}` }
  }

  const contact = getCrmContactById(contactId, workspaceId)
  if (!contact) {
    return { outcome: 'error', sent: false, reason: 'Contact not found' }
  }

  // Respect DND for the channel we'd be replying on.
  if (channel === 'sms' && (contact.dnd_sms || contact.unsubscribed)) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'error',
      errorMessage: 'Contact has DND SMS or is unsubscribed',
    })
    return { outcome: 'error', sent: false, reason: 'DND/unsubscribed' }
  }
  if (channel === 'email' && (contact.dnd_email || contact.unsubscribed)) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'error',
      errorMessage: 'Contact has DND email or is unsubscribed',
    })
    return { outcome: 'error', sent: false, reason: 'DND/unsubscribed' }
  }
  if ((channel === 'whatsapp' || channel === 'instagram') && contact.unsubscribed) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'error',
      errorMessage: 'Contact is unsubscribed',
    })
    return { outcome: 'error', sent: false, reason: 'unsubscribed' }
  }

  // 6. LLM call — ask for a JSON envelope with confidence + handoff signal.
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'error',
      errorMessage: 'ANTHROPIC_API_KEY not configured',
    })
    return { outcome: 'error', sent: false, reason: 'ANTHROPIC_API_KEY not set' }
  }

  const modelReply = await callClaudeHaiku({
    apiKey,
    workspace,
    contact,
    channel,
    inboundBody: trimmed,
  })

  if (!modelReply) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outcome: 'error',
      errorMessage: 'Empty model response',
    })
    return { outcome: 'error', sent: false, reason: 'Empty model response' }
  }

  // 7. Model-flagged handoff
  if (modelReply.should_handoff) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      confidence: modelReply.confidence ?? null,
      outcome: 'handoff_keyword',
      errorMessage: modelReply.handoff_reason || 'Model flagged handoff',
    })
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId,
        contactId,
        triggerType: 'customer_requested_human',
        triggerValue: (modelReply.handoff_reason || 'model_flagged').slice(0, 120),
      })
    } catch { /* keep going */ }
    return {
      outcome: 'handoff_keyword',
      sent: false,
      confidence: modelReply.confidence,
      reason: modelReply.handoff_reason || 'Model flagged handoff',
    }
  }

  const threshold = Math.max(0, Math.min(100, workspace.ai_autoreply_confidence_threshold ?? 80))
  const confidence = typeof modelReply.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(modelReply.confidence))) : 0

  if (confidence < threshold) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outboundMessage: modelReply.reply || null,
      confidence,
      outcome: 'skipped_low_confidence',
    })
    return { outcome: 'skipped_low_confidence', sent: false, confidence }
  }

  const reply = (modelReply.reply || '').trim()
  if (!reply) {
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      confidence,
      outcome: 'error',
      errorMessage: 'Model returned empty reply body',
    })
    return { outcome: 'error', sent: false, confidence, reason: 'Empty reply body' }
  }

  // 8. Actually send on the right channel. Errors here log as 'error'.
  try {
    if (channel === 'sms') {
      await sendCrmSms({ workspaceId, contact, body: reply })
    } else if (channel === 'chat') {
      await sendCrmChat({ workspaceId, contact, body: reply })
    } else if (channel === 'whatsapp') {
      await sendCrmWhatsApp({ workspaceId, contact, body: reply })
    } else if (channel === 'instagram') {
      await sendCrmInstagram({ workspaceId, contact, body: reply })
    } else {
      await sendCrmEmail({ workspaceId, contact, body: reply, inboundExcerpt: trimmed })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Send failed'
    logCrmAiAutoReply({
      workspaceId, contactId, channel,
      inboundMessage: trimmed,
      outboundMessage: reply,
      confidence,
      outcome: 'error',
      errorMessage,
    })
    return { outcome: 'error', sent: false, confidence, reason: errorMessage }
  }

  // 9. Log + activity. The `[AI]` prefix is how the inbox surfaces the chip.
  logCrmAiAutoReply({
    workspaceId, contactId, channel,
    inboundMessage: trimmed,
    outboundMessage: reply,
    confidence,
    outcome: 'sent',
  })
  try {
    const activityType: 'email' | 'sms' | 'note' = channel === 'email' ? 'email' : channel === 'sms' ? 'sms' : 'note'
    createCrmContactActivity({
      contactId,
      workspaceId,
      type: activityType,
      body: `[AI] ${channel.toUpperCase()} auto-reply (confidence ${confidence}): ${reply}`,
    })
  } catch { /* activity is nice-to-have */ }

  return { outcome: 'sent', sent: true, confidence }
}

// ────────────────────────────────────────────────────────────────────────────
// Channel send helpers — scoped to the auto-reply runtime so we can layer
// logging + DND checks without depending on the full workflow runner.
// ────────────────────────────────────────────────────────────────────────────

export async function sendCrmSms(opts: { workspaceId: number; contact: CrmContactRecord; body: string }): Promise<void> {
  const { workspaceId, contact, body } = opts
  if (!contact.phone) throw new Error('Contact has no phone number')

  const integration = getWorkspaceIntegration(workspaceId, 'twilio')
  const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
  const authToken  = String(integration?.config.auth_token  || getSetting('twilio_auth_token')  || '').trim()
  const fromPhone  = String(integration?.config.from_number || getSetting('twilio_phone_number') || '').trim()
  if (!accountSid || !authToken || !fromPhone) throw new Error('Twilio is not configured')

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: contact.phone, From: fromPhone, Body: body }),
  })
  const raw = await res.text()
  let payload: Record<string, unknown> | null = null
  try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = null }
  if (!res.ok) {
    const msg = typeof payload?.message === 'string' ? payload.message : raw || 'Twilio send failed'
    throw new Error(msg)
  }

  createSmsMessage({
    contact_id: contact.id,
    direction: 'outbound',
    body,
    from_phone: fromPhone,
    to_phone: contact.phone,
    twilio_sid: typeof payload?.sid === 'string' ? payload.sid : undefined,
  })
}

export async function sendCrmChat(opts: { workspaceId: number; contact: CrmContactRecord; body: string }): Promise<void> {
  const { workspaceId, contact, body } = opts
  const history = getChatMessagesByContact(contact.id)
  const latestInbound = [...history].reverse().find((m) => m.direction === 'inbound' && m.session_token)
  if (!latestInbound || !latestInbound.session_token) {
    throw new Error('No live chat session to reply to')
  }
  recordChatMessage({
    widgetId: latestInbound.widget_id,
    contactId: contact.id,
    workspaceId,
    direction: 'outbound',
    body,
    sessionToken: latestInbound.session_token,
  })
}

export async function sendCrmWhatsApp(opts: { workspaceId: number; contact: CrmContactRecord; body: string }): Promise<void> {
  const { workspaceId, contact, body } = opts
  if (!contact.phone) throw new Error('Contact has no phone number')

  const account = getCrmWhatsAppAccount(workspaceId)
  // When no account is connected OR the caller is in dev with no token, we
  // still record the outbound row so the inbox transcript is complete and
  // log a TODO. Real send is the same Graph API call Meta recommends.
  if (!account || !account.access_token || !account.phone_number_id) {
    console.log('[whatsapp-send] TODO wire real send — recording outbound only', { workspaceId, contactId: contact.id })
    createWhatsAppMessage({
      contact_id: contact.id,
      workspace_id: workspaceId,
      direction: 'outbound',
      body,
      from_phone: account?.display_phone ?? null,
      to_phone: contact.phone,
    })
    return
  }

  const res = await fetch(`https://graph.facebook.com/v18.0/${account.phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: contact.phone.replace(/\D+/g, ''),
      type: 'text',
      text: { body },
    }),
  })
  const raw = await res.text()
  let payload: Record<string, unknown> | null = null
  try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = null }
  if (!res.ok) {
    const err = payload && typeof (payload as { error?: { message?: string } }).error?.message === 'string'
      ? (payload as { error: { message: string } }).error.message
      : raw || 'WhatsApp send failed'
    throw new Error(err)
  }

  const messages = Array.isArray((payload as { messages?: Array<{ id?: string }> } | null)?.messages)
    ? (payload as { messages: Array<{ id?: string }> }).messages
    : []
  const waMessageId = messages[0]?.id ?? null

  createWhatsAppMessage({
    contact_id: contact.id,
    workspace_id: workspaceId,
    direction: 'outbound',
    body,
    from_phone: account.display_phone ?? null,
    to_phone: contact.phone,
    wa_message_id: waMessageId,
  })
}

export async function sendCrmInstagram(opts: { workspaceId: number; contact: CrmContactRecord; body: string }): Promise<void> {
  const { workspaceId, contact, body } = opts
  const igSenderId = (contact.external_instagram_id || '').trim()
  if (!igSenderId) throw new Error('Contact has no Instagram sender id (IGSID)')

  const account = getCrmInstagramAccount(workspaceId)
  if (!account || !account.access_token || !account.ig_business_id) {
    console.log('[instagram-send] TODO wire real send — recording outbound only', { workspaceId, contactId: contact.id })
    createInstagramMessage({
      contact_id: contact.id,
      workspace_id: workspaceId,
      direction: 'outbound',
      body,
      ig_sender_id: account?.ig_business_id ?? null,
      ig_recipient_id: igSenderId,
    })
    return
  }

  const res = await fetch(`https://graph.facebook.com/v18.0/${account.ig_business_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: igSenderId },
      message: { text: body },
    }),
  })
  const raw = await res.text()
  let payload: Record<string, unknown> | null = null
  try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = null }
  if (!res.ok) {
    const err = payload && typeof (payload as { error?: { message?: string } }).error?.message === 'string'
      ? (payload as { error: { message: string } }).error.message
      : raw || 'Instagram send failed'
    throw new Error(err)
  }

  const igMessageId = typeof (payload as { message_id?: string } | null)?.message_id === 'string'
    ? (payload as { message_id: string }).message_id
    : null

  createInstagramMessage({
    contact_id: contact.id,
    workspace_id: workspaceId,
    direction: 'outbound',
    body,
    ig_sender_id: account.ig_business_id,
    ig_recipient_id: igSenderId,
    ig_message_id: igMessageId,
  })
}

export async function sendCrmEmail(opts: { workspaceId: number; contact: CrmContactRecord; body: string; inboundExcerpt: string }): Promise<void> {
  const { workspaceId, contact, body, inboundExcerpt } = opts
  if (!contact.email) throw new Error('Contact has no email address')

  const workspace = getWorkspaceById(workspaceId)
  const workspaceOwnerId = workspace?.owner_id || contact.owner_id || 1
  const subject = deriveSubjectFromInbound(inboundExcerpt)
  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br/>')

  const sendResult = await sendEmail(workspaceOwnerId, contact.email, subject, bodyHtml)
  if (!sendResult.success) throw new Error(sendResult.error || 'Email send failed')

  const threadId = `ai-autoreply:${workspaceId}:${contact.id}`
  const account = getDefaultEmailAccount(workspaceId)
  const sendRecord = createDirectEmailSend({
    workspaceId,
    contactId: contact.id,
    subject,
    bodyHtml,
    accountId: account?.id ?? null,
    threadId,
  })

  if (account && sendRecord) {
    createEmailInboxEntry({
      account_id: account.id,
      contact_id: contact.id,
      direction: 'outbound',
      subject,
      body_html: bodyHtml,
      from_email: account.email,
      to_email: contact.email,
      received_at: sendRecord.sent_at ?? Math.floor(Date.now() / 1000),
      is_read: 1,
      thread_id: threadId,
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Claude call
// ────────────────────────────────────────────────────────────────────────────

interface ModelReply {
  confidence?: number
  reply?: string
  should_handoff?: boolean
  handoff_reason?: string
}

async function callClaudeHaiku(opts: {
  apiKey: string
  workspace: Workspace
  contact: CrmContactRecord
  channel: AutoReplyChannel
  inboundBody: string
}): Promise<ModelReply | null> {
  const { apiKey, workspace, contact, channel, inboundBody } = opts
  const systemBase = (workspace.ai_autoreply_system_prompt || '').trim() || defaultSystemPrompt()
  const context = buildContactContext(workspace.id, contact)

  const systemPrompt = [
    systemBase,
    '',
    'RUNTIME CONTRACT — read carefully.',
    `You are auto-replying on channel: ${channel}.`,
    'Keep SMS, chat, WhatsApp, and Instagram DMs under 240 characters when possible. Email can be longer.',
    'Never invent facts the contact did not share and do not promise anything outside the CRM context.',
    'If the message is ambiguous, emotionally charged, a complaint, pricing negotiation, legal, or clearly needs a human, set should_handoff=true and leave reply as a brief holding line.',
    '',
    'Return ONLY a JSON object with this shape — no prose before or after, no code fences:',
    '{ "confidence": 0-100, "reply": "...", "should_handoff": true|false, "handoff_reason": "..." }',
    '',
    'CRM CONTEXT',
    context,
  ].join('\n')

  const userPrompt = `Inbound ${channel} message from ${contact.name || 'the contact'}:\n"""\n${inboundBody}\n"""\n\nDraft the next outbound reply and rate your confidence.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: channel === 'email' ? 700 : 320,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> }
  const joined = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('\n').trim()
  if (!joined) return null
  return parseModelJson(joined)
}

function parseModelJson(raw: string): ModelReply | null {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim()
  // Try straight JSON first, then fall back to the first {...} block.
  const tryParse = (s: string): ModelReply | null => {
    try {
      const parsed = JSON.parse(s) as ModelReply
      if (parsed && typeof parsed === 'object') return parsed
    } catch { /* ignore */ }
    return null
  }
  const direct = tryParse(cleaned)
  if (direct) return direct
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1)
    const block = tryParse(slice)
    if (block) return block
  }
  return null
}

function defaultSystemPrompt(): string {
  return [
    'You are the Conversation AI for this workspace. You reply on the workspace\'s behalf to inbound SMS, webchat, and email messages.',
    'Be warm, direct, professional. Mirror the contact\'s tone. Prefer concrete next steps over filler.',
    'If a contact is asking about booking or pricing and the CRM has no explicit detail, gather the missing info rather than inventing it.',
  ].join(' ')
}

function buildContactContext(workspaceId: number, contact: CrmContactRecord): string {
  const lines: string[] = []
  if (contact.name) lines.push(`Name: ${contact.name}`)
  if (contact.email) lines.push(`Email: ${contact.email}`)
  if (contact.phone) lines.push(`Phone: ${contact.phone}`)
  if (contact.company) lines.push(`Company: ${contact.company}`)
  if (contact.lifecycle_stage) lines.push(`Lifecycle stage: ${contact.lifecycle_stage}`)
  if (contact.tags_list?.length) lines.push(`Tags: ${contact.tags_list.join(', ')}`)

  // Last 10 activities — gives the model a sense of recent history without
  // a full timeline round-trip.
  try {
    const rows = getDb().prepare(`
      SELECT type, body, created_at FROM crm_activities
      WHERE contact_id = ? ORDER BY created_at DESC, id DESC LIMIT 10
    `).all(contact.id) as Array<{ type: string; body: string; created_at: number }>
    if (rows.length) {
      lines.push('Recent activity:')
      for (const row of rows.reverse()) {
        lines.push(`  - [${row.type}] ${truncate(row.body, 140)}`)
      }
    }
  } catch { /* best-effort */ }

  // Most recent inbound/outbound messages across SMS for shorter-term context.
  try {
    const sms = getSmsMessages(contact.id).slice(-6)
    if (sms.length) {
      lines.push('Recent SMS:')
      for (const m of sms) {
        lines.push(`  - ${m.direction === 'inbound' ? 'Contact' : 'Us'}: ${truncate(m.body, 140)}`)
      }
    }
  } catch { /* best-effort */ }

  try {
    const wa = getWhatsAppMessagesByContact(contact.id).slice(-6)
    if (wa.length) {
      lines.push('Recent WhatsApp:')
      for (const m of wa) {
        lines.push(`  - ${m.direction === 'inbound' ? 'Contact' : 'Us'}: ${truncate(m.body, 140)}`)
      }
    }
  } catch { /* best-effort */ }

  try {
    const ig = getInstagramMessagesByContact(contact.id).slice(-6)
    if (ig.length) {
      lines.push('Recent Instagram DMs:')
      for (const m of ig) {
        lines.push(`  - ${m.direction === 'inbound' ? 'Contact' : 'Us'}: ${truncate(m.body, 140)}`)
      }
    }
  } catch { /* best-effort */ }

  // Latest opportunity (if any) — best-effort raw SQL so we don't take a hard
  // dependency on a helper.
  try {
    const opp = getDb().prepare(`
      SELECT title, amount_cents, status, stage_id
      FROM crm_opportunities
      WHERE contact_id = ? AND workspace_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(contact.id, workspaceId) as { title: string; amount_cents: number | null; status: string; stage_id: number | null } | undefined
    if (opp) {
      const amount = typeof opp.amount_cents === 'number' ? ` ($${(opp.amount_cents / 100).toFixed(0)})` : ''
      lines.push(`Latest opportunity: ${opp.title}${amount} — status ${opp.status}`)
    }
  } catch { /* best-effort */ }

  return lines.join('\n') || '(no CRM context on file)'
}

// ────────────────────────────────────────────────────────────────────────────
// Parsers & helpers
// ────────────────────────────────────────────────────────────────────────────

function parseChannelList(raw: string | null | undefined): Set<AutoReplyChannel> {
  const out = new Set<AutoReplyChannel>()
  for (const token of (raw || '').split(',')) {
    const normalized = token.trim().toLowerCase()
    if (
      normalized === 'sms' ||
      normalized === 'email' ||
      normalized === 'chat' ||
      normalized === 'whatsapp' ||
      normalized === 'instagram'
    ) {
      out.add(normalized as AutoReplyChannel)
    }
  }
  return out
}

export function matchHandoffKeyword(message: string, keywordsRaw: string): string | null {
  const body = message.toLowerCase()
  const keywords = keywordsRaw.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
  for (const keyword of keywords) {
    if (!keyword) continue
    if (keyword.includes(' ')) {
      // Multi-word phrase — substring match is enough.
      if (body.includes(keyword)) return keyword
      continue
    }
    // Single word — require word boundaries so "humans" doesn't trip "human"
    // and "agenda" doesn't trip "agent".
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`, 'i')
    if (re.test(body)) return keyword
  }
  return null
}

/**
 * Is the current moment inside the workspace's business window?
 *
 * Uses the workspace's local hours + days mask. The mask encoding is defined
 * in the multi-tenant migration (Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32,
 * Sat=64). We evaluate in the workspace's configured timezone via Intl so
 * that "9 AM Pacific" is honored no matter where the server lives.
 */
export function isWithinBusinessHours(workspace: Workspace, atMs: number = Date.now()): boolean {
  const start = Math.max(0, Math.min(23, workspace.business_hours_start ?? 9))
  const end = Math.max(start + 1, Math.min(24, workspace.business_hours_end ?? 17))
  const mask = typeof workspace.business_days_mask === 'number' ? workspace.business_days_mask : 62
  const tz = workspace.timezone || 'America/Vancouver'
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
  })
  const parts = formatter.formatToParts(new Date(atMs))
  const hourPart = parts.find((p) => p.type === 'hour')?.value || '0'
  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value || 'Mon'
  const hour = Number(hourPart)
  const dayBit: Record<string, number> = {
    Sun: 1, Mon: 2, Tue: 4, Wed: 8, Thu: 16, Fri: 32, Sat: 64,
  }
  const bit = dayBit[weekdayPart] ?? 0
  const dayOpen = (mask & bit) !== 0
  return dayOpen && hour >= start && hour < end
}

function deriveSubjectFromInbound(inbound: string): string {
  const firstLine = inbound.split(/\n/)[0].trim()
  if (!firstLine) return 'Re: your message'
  const snippet = firstLine.slice(0, 60)
  return snippet.toLowerCase().startsWith('re:') ? snippet : `Re: ${snippet}`
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncate(raw: string, limit: number): string {
  if (raw.length <= limit) return raw
  return raw.slice(0, limit - 1) + '…'
}

/**
 * Fire-and-forget wrapper for webhook handlers. Returns immediately; the
 * work happens on the next microtask so the webhook response isn't blocked.
 */
export function fireAutoReplyAsync(params: AutoReplyParams): void {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  Promise.resolve().then(() => runAutoReplyForInbound(params).catch(() => { /* logged inside */ }))
}
