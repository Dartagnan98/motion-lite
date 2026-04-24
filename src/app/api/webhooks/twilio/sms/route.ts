import { type NextRequest, NextResponse } from 'next/server'
import {
  addContactsToCrmList,
  createCrmContact,
  createCrmContactActivity,
  createSmsMessage,
  findCrmContactsByPhone,
  findCrmSmsKeyword,
  findWorkspaceIdByTwilioFromNumber,
  getCrmContactById,
  getWorkspaceIntegration,
  queueCrmWorkflowRunsForContactChange,
  queueCrmWorkflowRunsForTrigger,
  updateCrmContact,
  writeAuditLog,
  type CrmSmsKeyword,
} from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { fireJimmyDraftAsync } from '@/lib/jimmy-draft-bridge'
import { notifyContactOwner } from '@/lib/user-notify'

/**
 * Twilio inbound SMS webhook.
 *
 *   POST /api/webhooks/twilio/sms
 *   Content-Type: application/x-www-form-urlencoded
 *   Body (selected fields Twilio sends):
 *     From:  E.164 sender number (the contact)
 *     To:    the Twilio number that received it (lets us match workspace)
 *     Body:  message text
 *     MessageSid: Twilio message id
 *
 * Flow:
 *   1. Match workspace by To → workspace_integrations[provider='twilio'].from_number
 *   2. Resolve / upsert the contact by From
 *   3. Insert a crm_sms_messages row (direction='inbound')
 *   4. Fire customer_replied + inbound_sms workflow triggers
 *   5. Run keyword responders (tag, list, opt in/out, fire_workflow, auto-reply)
 *   6. Return empty TwiML so Twilio doesn't auto-reply
 *
 * No HMAC check yet — Twilio's X-Twilio-Signature validation lives behind
 * an auth_token lookup and can be layered on next pass.
 */

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const form = new URLSearchParams(raw)
  const from = form.get('From')?.trim() || ''
  const to = form.get('To')?.trim() || ''
  const body = form.get('Body')?.trim() || ''
  const sid = form.get('MessageSid')?.trim() || ''

  if (!from || !to || !body) {
    return twimlResponse() // ignore malformed pings, don't error back
  }

  const workspaceId = findWorkspaceIdByTwilioFromNumber(to)
  if (!workspaceId) {
    // No workspace owns this Twilio number. Respond clean so Twilio doesn't
    // retry — the admin can wire the integration then resend manually.
    return twimlResponse()
  }

  // Contact resolution: match by phone first, otherwise create a minimal row
  // from the inbound number.
  const matches = findCrmContactsByPhone(from, workspaceId)
  let contactId = matches[0]?.id ?? null
  if (!contactId) {
    const created = createCrmContact({
      workspaceId,
      name: from,
      email: null,
      phone: from,
    })
    contactId = created.id
  }

  createSmsMessage({
    contact_id: contactId,
    direction: 'inbound',
    body,
    from_phone: from,
    to_phone: to,
    twilio_sid: sid || undefined,
  })

  // Fire both triggers. customer_replied is the cross-channel one the rest
  // of the CRM uses (webchat fires the same). inbound_sms is SMS-specific
  // and can filter against it directly.
  queueCrmWorkflowRunsForTrigger({
    workspaceId,
    contactId,
    triggerType: 'inbound_sms',
  })
  queueCrmWorkflowRunsForTrigger({
    workspaceId,
    contactId,
    triggerType: 'customer_replied',
    triggerValue: 'sms',
  })

  // Inbound-reply notification for the contact's owner.
  notifyContactOwner(workspaceId, contactId, 'inbound_reply', (c) => ({
    title: `New reply from ${c.name}`,
    body: body.length > 140 ? body.slice(0, 137) + '...' : body,
    href: `/crm/contacts/${c.id}`,
    entity: 'contact',
    entity_id: c.id,
  }))

  // Keyword parsing: normalize the first token and look up a match.
  const firstToken = extractFirstToken(body)
  if (firstToken) {
    const match = findCrmSmsKeyword(workspaceId, firstToken)
    if (match) {
      try {
        await applyKeywordAction({ workspaceId, contactId, keyword: match, fromPhone: from, toPhone: to })
      } catch {
        // Never let keyword execution break the webhook response.
      }
    }
  }

  // Draft-to-Telegram: generate a reply draft and POST to the Mac dispatch
  // bridge. The bridge pops an Approve/Edit/Trash card; nothing goes out
  // without the user confirming. Fire-and-forget so Twilio isn't blocked.
  fireJimmyDraftAsync({ workspaceId, contactId, channel: 'sms', inboundBody: body })

  return twimlResponse()
}

function twimlResponse(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  })
}

function extractFirstToken(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const firstSpace = trimmed.search(/\s/)
  const token = firstSpace === -1 ? trimmed.slice(0, 20) : trimmed.slice(0, firstSpace)
  return token.trim().toUpperCase()
}

async function applyKeywordAction(opts: {
  workspaceId: number
  contactId: number
  keyword: CrmSmsKeyword
  fromPhone: string
  toPhone: string
}): Promise<void> {
  const { workspaceId, contactId, keyword, toPhone } = opts
  const payload = parseKeywordPayload(keyword.payload)
  const contact = getCrmContactById(contactId, workspaceId)
  if (!contact) return

  let summary = `Keyword matched: "${keyword.keyword}"`

  if (keyword.action === 'add_tag') {
    const tag = String(payload.tag || '').trim()
    if (tag) {
      const nextTags = Array.from(new Set([...contact.tags_list, tag]))
      updateCrmContact(contact.id, workspaceId, { tags: nextTags })
      const after = getCrmContactById(contact.id, workspaceId)
      if (after) queueCrmWorkflowRunsForContactChange({ workspaceId, beforeContact: contact, afterContact: after })
      summary += ` → added tag '${tag}'`
    }
  } else if (keyword.action === 'remove_tag') {
    const tag = String(payload.tag || '').trim()
    if (tag) {
      const target = tag.toLowerCase()
      const nextTags = contact.tags_list.filter((t) => t.trim().toLowerCase() !== target)
      updateCrmContact(contact.id, workspaceId, { tags: nextTags })
      const after = getCrmContactById(contact.id, workspaceId)
      if (after) queueCrmWorkflowRunsForContactChange({ workspaceId, beforeContact: contact, afterContact: after })
      summary += ` → removed tag '${tag}'`
    }
  } else if (keyword.action === 'add_to_list') {
    const listId = Number(payload.list_id)
    if (Number.isInteger(listId) && listId > 0) {
      addContactsToCrmList(listId, workspaceId, [contact.id])
      summary += ` → added to list #${listId}`
    }
  } else if (keyword.action === 'opt_in') {
    updateCrmContact(contact.id, workspaceId, { unsubscribed: false, dnd_sms: false })
    summary += ' → opted back in'
  } else if (keyword.action === 'opt_out') {
    updateCrmContact(contact.id, workspaceId, { unsubscribed: true, dnd_sms: true })
    summary += ' → opted out (unsubscribed + DND SMS)'
  } else if (keyword.action === 'fire_workflow') {
    summary += ' → fired keyword_matched trigger'
  }

  // keyword_matched trigger always fires so workflows can listen regardless
  // of which built-in action is configured.
  queueCrmWorkflowRunsForTrigger({
    workspaceId,
    contactId: contact.id,
    triggerType: 'keyword_matched',
    triggerValue: keyword.keyword,
  })

  // Auto-reply if response_message is set. Respects the new opt-out state —
  // a STOP keyword (opt_out) with a response_message would still try to send,
  // which is fine: Twilio handles final opt-out confirmation at the carrier.
  if (keyword.response_message && keyword.response_message.trim()) {
    try {
      await sendTwilioReply({ workspaceId, to: opts.fromPhone, from: toPhone, body: keyword.response_message.trim() })
      summary += ' (auto-reply sent)'
    } catch {
      summary += ' (auto-reply failed)'
    }
  }

  createCrmContactActivity({
    contactId: contact.id,
    workspaceId,
    type: 'note',
    body: summary,
  })
  writeAuditLog({
    workspaceId,
    entity: 'sms_keyword',
    entityId: keyword.id,
    action: 'matched',
    summary,
  })
}

function parseKeywordPayload(json: string | null): { tag?: string; list_id?: number; workflow_id?: number } {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json) as { tag?: unknown; list_id?: unknown; workflow_id?: unknown }
    return {
      tag: typeof parsed.tag === 'string' ? parsed.tag : undefined,
      list_id: typeof parsed.list_id === 'number' ? parsed.list_id : undefined,
      workflow_id: typeof parsed.workflow_id === 'number' ? parsed.workflow_id : undefined,
    }
  } catch {
    return {}
  }
}

async function sendTwilioReply(opts: { workspaceId: number; to: string; from: string; body: string }): Promise<void> {
  const integration = getWorkspaceIntegration(opts.workspaceId, 'twilio')
  const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
  const authToken = String(integration?.config.auth_token || getSetting('twilio_auth_token') || '').trim()
  const fromPhone = String(integration?.config.from_number || getSetting('twilio_phone_number') || opts.from).trim()
  if (!accountSid || !authToken || !fromPhone) return

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: opts.to, From: fromPhone, Body: opts.body }),
  })
  const raw = await res.text()
  let payload: Record<string, unknown> | null = null
  try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = null }
  if (res.ok) {
    // Log the outbound auto-reply as an SMS message on the contact thread.
    const contacts = findCrmContactsByPhone(opts.to, opts.workspaceId)
    const contactId = contacts[0]?.id
    if (contactId) {
      createSmsMessage({
        contact_id: contactId,
        direction: 'outbound',
        body: opts.body,
        from_phone: fromPhone,
        to_phone: opts.to,
        twilio_sid: typeof payload?.sid === 'string' ? payload.sid : undefined,
      })
    }
  }
}
