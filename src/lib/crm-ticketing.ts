import nodemailer from 'nodemailer'
import {
  createCrmContact,
  createCrmTicket,
  createCrmTicketMessage,
  createDirectEmailSend,
  createEmailInboxEntry,
  getChatMessagesByContact,
  getChatMessagesBySession,
  getCrmContactByEmail,
  getCrmContactById,
  getCrmTicketById,
  getCrmTicketBySourceMessageId,
  getCrmTicketSupportEmail,
  getCrmWebchatWidgetByPublicId,
  getDefaultEmailAccount,
  getLatestCrmTicketForContact,
  queueCrmWorkflowRunsForTicketCreated,
  queueCrmWorkflowRunsForTicketUpdated,
  recordChatMessage,
  updateCrmTicket,
  writeAuditLog,
  type CrmTicketRecord,
} from '@/lib/db'
import { decryptSmtpPassword } from '@/lib/crm-email'
import { notifyContactOwner } from '@/lib/user-notify'

function normalizeThreadSubject(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?):\s*)+/i, '').trim().toLowerCase() || '(no subject)'
}

function ticketEmailThreadId(ticket: Pick<CrmTicketRecord, 'source_message_id' | 'id'>): string {
  const source = ticket.source_message_id || ''
  if (source.startsWith('email:')) return source.slice('email:'.length)
  return `ticket:${ticket.id}`
}

function getCrmTicketByIdOrThrow(workspaceId: number, ticketId: number): CrmTicketRecord {
  const ticket = getCrmTicketById(ticketId, workspaceId)
  if (!ticket) throw new Error('Ticket not found after write')
  return ticket
}

function normalizeAddressList(value: string | null | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

export function workspaceSupportEmailMatches(workspaceId: number, toEmail: string | null | undefined): boolean {
  const configured = (getCrmTicketSupportEmail(workspaceId) || '').trim().toLowerCase()
  if (!configured) return false
  return normalizeAddressList(toEmail).includes(configured)
}

export function ingestSupportEmailTicket(input: {
  workspaceId: number
  fromEmail: string
  fromName?: string | null
  toEmail?: string | null
  subject?: string | null
  body: string
  bodyHtml?: string | null
  messageId?: string | null
  notifyOwner?: boolean
}): { ticket: CrmTicketRecord; created: boolean; contactId: number } {
  const normalizedEmail = input.fromEmail.trim().toLowerCase()
  if (!normalizedEmail) throw new Error('Sender email is required')

  let contact = getCrmContactByEmail(input.workspaceId, normalizedEmail)
  if (!contact) {
    contact = createCrmContact({
      workspaceId: input.workspaceId,
      name: (input.fromName && input.fromName.trim()) || normalizedEmail,
      email: normalizedEmail,
    })
  }

  const subject = (input.subject || '').trim() || '(no subject)'
  const sourceRef = `email:${(input.messageId || crypto.randomUUID()).trim()}`
  const existingBySource = getCrmTicketBySourceMessageId(input.workspaceId, sourceRef)
  if (existingBySource) {
    return { ticket: existingBySource, created: false, contactId: contact.id }
  }

  const latest = getLatestCrmTicketForContact(contact.id, input.workspaceId, { excludeClosed: true })
  const canAppend = latest
    && latest.channel === 'email'
    && normalizeThreadSubject(latest.subject) === normalizeThreadSubject(subject)

  if (canAppend) {
    createCrmTicketMessage(input.workspaceId, {
      ticket_id: latest.id,
      contact_id: contact.id,
      direction: 'inbound',
      body: input.body,
      body_html: input.bodyHtml ?? null,
    })
    const updated = updateCrmTicket(latest.id, input.workspaceId, {
      status: latest.status === 'pending' || latest.status === 'on_hold' ? 'open' : latest.status,
    }) || getCrmTicketByIdOrThrow(input.workspaceId, latest.id)
    if (updated.status !== latest.status) {
      queueCrmWorkflowRunsForTicketUpdated(latest, updated)
    }
    writeAuditLog({
      workspaceId: input.workspaceId,
      entity: 'ticket',
      entityId: updated.id,
      action: 'customer_replied',
      summary: `Inbound email appended to ticket #${updated.ticket_number}`,
      payload: {
        channel: 'email',
        source_message_id: sourceRef,
      },
    })
    if (input.notifyOwner !== false) {
      notifyContactOwner(input.workspaceId, contact.id, 'inbound_reply', () => ({
        title: `Ticket #${updated.ticket_number} updated`,
        body: subject,
        href: `/crm/tickets/${updated.id}`,
        entity: 'ticket',
        entity_id: updated.id,
      }))
    }
    return { ticket: updated, created: false, contactId: contact.id }
  }

  const ticket = createCrmTicket(input.workspaceId, {
    contact_id: contact.id,
    subject,
    body: input.body,
    channel: 'email',
    source_message_id: sourceRef,
  })
  createCrmTicketMessage(input.workspaceId, {
    ticket_id: ticket.id,
    contact_id: contact.id,
    direction: 'inbound',
    body: input.body,
    body_html: input.bodyHtml ?? null,
  })
  queueCrmWorkflowRunsForTicketCreated(ticket)
  const created = getCrmTicketByIdOrThrow(input.workspaceId, ticket.id)
  writeAuditLog({
    workspaceId: input.workspaceId,
    entity: 'ticket',
    entityId: created.id,
    action: 'created',
    summary: `Inbound email created ticket #${created.ticket_number}`,
    payload: {
      channel: 'email',
      source_message_id: sourceRef,
    },
  })
  if (input.notifyOwner !== false) {
    notifyContactOwner(input.workspaceId, contact.id, 'inbound_reply', () => ({
      title: `New ticket #${created.ticket_number}`,
      body: subject,
      href: `/crm/tickets/${created.id}`,
      entity: 'ticket',
      entity_id: created.id,
    }))
  }
  return { ticket: created, created: true, contactId: contact.id }
}

export function escalateWebchatToTicket(input: {
  publicId: string
  session: string
  subject?: string | null
  body?: string | null
}): { ticket: CrmTicketRecord; created: boolean } {
  const widget = getCrmWebchatWidgetByPublicId(input.publicId)
  if (!widget || !widget.is_active) throw new Error('Widget not found')
  const session = input.session.trim()
  if (!session) throw new Error('session is required')
  const chatMessages = getChatMessagesBySession(session).filter((message) => message.widget_id === widget.id)
  if (chatMessages.length === 0) throw new Error('No chat history for this session')
  const contactId = chatMessages[0]?.contact_id
  const contact = contactId ? getCrmContactById(contactId, widget.workspace_id) : null
  if (!contact) throw new Error('Contact not found for chat session')

  const sourceRef = `chat:${widget.id}:${session}`
  const existing = getCrmTicketBySourceMessageId(widget.workspace_id, sourceRef)
  if (existing) return { ticket: existing, created: false }

  const latestInbound = [...chatMessages].reverse().find((message) => message.direction === 'inbound') || chatMessages[chatMessages.length - 1]
  const body = (input.body && input.body.trim()) || latestInbound.body
  const subject = (input.subject && input.subject.trim()) || `Webchat escalation · ${contact.name}`
  const ticket = createCrmTicket(widget.workspace_id, {
    contact_id: contact.id,
    subject,
    body,
    channel: 'chat',
    source_message_id: sourceRef,
  })
  for (const message of chatMessages) {
    createCrmTicketMessage(widget.workspace_id, {
      ticket_id: ticket.id,
      contact_id: contact.id,
      direction: message.direction === 'outbound' ? 'outbound' : 'inbound',
      body: message.body,
      created_at: new Date(message.sent_at * 1000).toISOString(),
    })
  }
  queueCrmWorkflowRunsForTicketCreated(ticket)
  const created = getCrmTicketByIdOrThrow(widget.workspace_id, ticket.id)
  notifyContactOwner(widget.workspace_id, contact.id, 'inbound_reply', () => ({
    title: `New chat ticket #${created.ticket_number}`,
    body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
    href: `/crm/tickets/${created.id}`,
    entity: 'ticket',
    entity_id: created.id,
  }))
  return { ticket: created, created: true }
}

export async function deliverTicketReply(ticket: CrmTicketRecord, body: string, workspaceId: number): Promise<void> {
  const message = body.trim()
  if (!message) throw new Error('Reply body is required')

  if (ticket.channel === 'email') {
    const contact = ticket.contact_id ? getCrmContactById(ticket.contact_id, workspaceId) : null
    if (!contact?.email) throw new Error('Ticket contact has no email address')
    const account = getDefaultEmailAccount(workspaceId)
    if (!account || !account.smtp_host || !account.smtp_port || !account.smtp_user || !account.smtp_pass_encrypted) {
      throw new Error('Default CRM email account is not configured for SMTP sending')
    }
    const threadId = ticketEmailThreadId(ticket)
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: {
        user: account.smtp_user,
        pass: decryptSmtpPassword(account.smtp_pass_encrypted),
      },
    })
    const subject = /^re:/i.test(ticket.subject) ? ticket.subject : `Re: ${ticket.subject}`
    const html = `<p>${message.replace(/\n/g, '<br>')}</p>`
    const result = await transporter.sendMail({
      from: `${account.label} <${account.email}>`,
      to: contact.email,
      subject,
      html,
      inReplyTo: threadId,
      references: [threadId],
    })
    createDirectEmailSend({
      workspaceId,
      contactId: contact.id,
      subject,
      bodyHtml: html,
      accountId: account.id,
      messageId: result.messageId,
      threadId,
    })
    createEmailInboxEntry({
      account_id: account.id,
      contact_id: contact.id,
      direction: 'outbound',
      subject,
      body_html: html,
      from_email: account.email,
      to_email: contact.email,
      received_at: Math.floor(Date.now() / 1000),
      is_read: 1,
      thread_id: threadId || result.messageId,
    })
    return
  }

  if (ticket.channel === 'chat') {
    const source = ticket.source_message_id || ''
    let widgetId: number | null = null
    let sessionToken: string | null = null
    const match = source.match(/^chat:(\d+):(.+)$/)
    if (match) {
      widgetId = Number(match[1])
      sessionToken = match[2]
    }
    if (!widgetId || !sessionToken) {
      const history = ticket.contact_id ? getChatMessagesByContact(ticket.contact_id) : []
      const latestInbound = [...history].reverse().find((row) => row.direction === 'inbound' && row.session_token)
      widgetId = latestInbound?.widget_id ?? null
      sessionToken = latestInbound?.session_token ?? null
    }
    if (!ticket.contact_id || !widgetId || !sessionToken) throw new Error('No live webchat session available for this ticket')
    recordChatMessage({
      widgetId,
      contactId: ticket.contact_id,
      workspaceId,
      direction: 'outbound',
      body: message,
      sessionToken,
    })
  }
}
