import {
  addContactsToCrmList,
  advanceCrmDripEnrollment,
  computeNextRunAt,
  createCrmInvoice,
  createCrmPayment,
  createCrmCallLog,
  createCrmOpportunity,
  createCrmContactActivity,
  createCrmMessageTemplate,
  generateCrmAffiliatePayoutsForPeriod,
  getCrmAffiliateByContactId,
  getCrmMessageTemplateById,
  getCrmEmailThemeById,
  getDueAppointmentReminders,
  markAppointmentReminderResult,
  processDueScheduledCampaigns,
  createCrmWorkflowRun,
  createCrmWorkflowRunEvent,
  createDirectEmailSend,
  createEmailInboxEntry,
  createTask,
  createTaskActivity,
  ensureOutreachProject,
  createSmsMessage,
  getDueCrmTicketSlaBreaches,
  getLatestCrmTicketForContact,
  markCrmTicketSlaBreached,
  queueCrmWorkflowRunsForTicketSlaBreached,
  queueCrmWorkflowRunsForTicketUpdated,
  deleteCrmOpportunity,
  enrollContactInDrip,
  expireDueCrmContracts,
  addCrmBookingAttendees,
  createCrmAppointment,
  getCrmCalendarById,
  getCrmCalendars,
  getNextUpcomingCrmAppointmentForContact,
  pickRoundRobinHost,
  updateCrmAppointmentStatus,
  getCrmContactById,
  getCrmContractById,
  getCrmDripSequenceById,
  getCrmInvoiceById,
  getCrmProductById,
  getCrmListById,
  getCrmListContacts,
  getCrmOpportunities,
  getCrmPipelineStageById,
  getCrmSurveyByPublicId,
  createCrmSurveyResponseSession,
  getDueCrmSurveyCampaignDispatchRows,
  markCrmSurveyCampaignQueueResult,
  getCrmWorkflowById,
  getDefaultEmailAccount,
  getDueCrmDripEnrollments,
  getDueCrmWorkflowRuns,
  getDueCrmWorkflowSchedules,
  getScheduledSocialPostsDue,
  getDb,
  listPendingCrmConversionForwards,
  getTasks,
  getWorkspaceIntegration,
  listCrmAffiliatePayouts,
  listCrmDripSteps,
  markCrmSocialPostPublishing,
  markCrmWorkflowScheduleRan,
  queueCrmWorkflowRunsForContactChange,
  queueCrmWorkflowRunsForTrigger,
  removeContactFromCrmList,
  getWorkspaceById,
  markCrmWorkflowRunComplete,
  updateCrmMessageTemplate,
  updateCrmOpportunity,
  addCrmOpportunityTag,
  createCrmOpportunityNote,
  updateCrmAffiliate,
  updateCrmAffiliatePayout,
  updateCrmContact,
  updateCrmInvoice,
  updateCrmTicket,
  updateCrmWorkflowRun,
  updateCrmConversionForward,
  updateTask,
  listOverdueInvoices,
  markInvoiceOverdue,
  writeAuditLog,
  type CrmInvoiceLineItemInput,
  type CrmContactRecord,
  type CrmPaymentMethod,
  type CrmWorkflowGraph,
  type CrmWorkflowNode,
  type CrmWorkflowRunRecord,
  type PendingCrmConversionForward,
  syncCrmAffiliateReferralsFromPayments,
} from '@/lib/db'
import { parseEmailBlocks, renderEmailBlocksToHtml } from '@/lib/email-blocks'
import { sendEmail } from '@/lib/gmail-send'
import { generateCrmAiText, parseEmailDraftText } from '@/lib/crm-ai-service'
import { getSetting } from '@/lib/settings'
import { notifyContactOwner, notifyUser } from '@/lib/user-notify'
import { buildCrmConversionForwardRequest, sendCrmConversionForwardLive } from '@/lib/crm-attribution'

// renderPlainTextEmailHtml wraps plain-text workflow emails in a pre-styled
// block so line breaks survive Gmail's rendering. processGoogleBusinessProfileSync
// has no implementation yet — the GBP webhook route notes the eventual cadence.
const renderPlainTextEmailHtml = (text: string): string =>
  `<pre style="font-family:inherit;white-space:pre-wrap;">${String(text || '')}</pre>`
const processGoogleBusinessProfileSync: () => Promise<void> = async () => undefined

const TWENTY_SECONDS_MS = 20 * 1000
const TWO_MINUTES_MS = 2 * 60 * 1000
const CALENDAR_RECONCILE_INTERVAL_MS = 2 * 60 * 1000
const MAX_STEPS_PER_TICK = 12

declare global {
  // eslint-disable-next-line no-var
  var __crmWorkflowWorkerStarted: boolean | undefined
  // eslint-disable-next-line no-var
  var __crmWorkflowWorkerRunning: boolean | undefined
  // eslint-disable-next-line no-var
  var __crmTicketSlaPassAt: number | undefined
  // eslint-disable-next-line no-var
  var __lastAffiliatePayoutPassKey: string | undefined
  // eslint-disable-next-line no-var
  var __crmUpcomingApptLastRunMs: number | undefined
}

type WorkflowBranch = 'default' | 'true' | 'false' | 'a' | 'b'
type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'includes'
  | 'not_includes'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'

function buildEmailVariantContext(contact: NonNullable<ReturnType<typeof getCrmContactById>>) {
  return {
    segment: contact.lifecycle_stage || null,
    region: contact.state || contact.country || null,
    tags: contact.tags_list || [],
  }
}

function normalizeBranch(value: unknown): WorkflowBranch {
  if (value === 'true' || value === 'false' || value === 'a' || value === 'b') return value
  return 'default'
}

function getOutgoingEdges(graph: CrmWorkflowGraph, sourceId: string) {
  return graph.edges.filter((edge) => edge.source === sourceId)
}

function getNextNodeId(graph: CrmWorkflowGraph, sourceId: string, preferredBranch: WorkflowBranch = 'default'): string | null {
  const outgoing = getOutgoingEdges(graph, sourceId)
  if (!outgoing.length) return null

  const direct = outgoing.find((edge) => normalizeBranch(edge.branch) === preferredBranch)
  if (direct) return direct.target

  if (preferredBranch !== 'default') {
    const fallback = outgoing.find((edge) => normalizeBranch(edge.branch) === 'default')
    if (fallback) return fallback.target
  }

  return outgoing[0]?.target || null
}

function resolveNodeById(graph: CrmWorkflowGraph, nodeId: string | null): CrmWorkflowNode | null {
  if (!nodeId) return null
  return graph.nodes.find((node) => node.id === nodeId) || null
}

function resolveCurrentNode(graph: CrmWorkflowGraph, runNextNodeId: string | null): CrmWorkflowNode | null {
  const direct = resolveNodeById(graph, runNextNodeId)
  if (direct) return direct
  const startNode = graph.nodes.find((node) => node.type === 'start')
  if (!startNode) return graph.nodes[0] || null
  const firstId = getNextNodeId(graph, startNode.id, 'default')
  if (!firstId) return null
  return resolveNodeById(graph, firstId)
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

function computeWaitSeconds(config: Record<string, unknown>): number {
  const amount = Math.max(1, parsePositiveInt(config.amount, 1))
  const unitRaw = typeof config.unit === 'string' ? config.unit.trim().toLowerCase() : 'minutes'
  if (unitRaw === 'days') return amount * 24 * 60 * 60
  if (unitRaw === 'hours') return amount * 60 * 60
  return amount * 60
}

function createRunEvent(run: CrmWorkflowRunRecord, eventType: string, options?: {
  node?: CrmWorkflowNode | null
  message?: string | null
  payload?: Record<string, unknown> | null
}) {
  createCrmWorkflowRunEvent({
    run_id: run.id,
    workflow_id: run.workflow_id,
    workspace_id: run.workspace_id,
    contact_id: run.contact_id,
    node_id: options?.node?.id ?? null,
    node_type: options?.node?.type ?? null,
    event_type: eventType,
    message: options?.message ?? null,
    payload: options?.payload ?? null,
  })
}

function boolFromUnknown(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const raw = String(value ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function normalizeConditionOperator(raw: unknown): ConditionOperator {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'eq' || value === 'equals' || value === 'equal') return 'equals'
  if (value === 'neq' || value === 'not_equals' || value === 'not_equal') return 'not_equals'
  if (value === 'contains') return 'contains'
  if (value === 'not_contains') return 'not_contains'
  if (value === 'includes') return 'includes'
  if (value === 'not_includes') return 'not_includes'
  if (value === 'is_empty' || value === 'empty') return 'is_empty'
  if (value === 'is_not_empty' || value === 'not_empty') return 'is_not_empty'
  if (value === 'gt' || value === 'greater_than') return 'greater_than'
  if (value === 'gte' || value === 'greater_or_equal') return 'greater_or_equal'
  if (value === 'lt' || value === 'less_than') return 'less_than'
  if (value === 'lte' || value === 'less_or_equal') return 'less_or_equal'
  return 'includes'
}

function getConditionFieldValue(contact: CrmContactRecord, fieldRaw: unknown): string | number | boolean | string[] | null {
  const field = String(fieldRaw || 'tags').trim().toLowerCase()
  if (field === 'name') return contact.name
  if (field === 'email') return contact.email
  if (field === 'phone') return contact.phone
  if (field === 'company') return contact.company
  if (field === 'source') return contact.source
  if (field === 'lifecycle_stage') return contact.lifecycle_stage
  if (field === 'pipeline_stage_id') return contact.pipeline_stage_id
  if (field === 'unsubscribed') return Boolean(contact.unsubscribed)
  if (field === 'dnd_sms') return Boolean(contact.dnd_sms)
  if (field === 'dnd_email') return Boolean(contact.dnd_email)
  if (field === 'dnd_calls') return Boolean(contact.dnd_calls)
  if (field === 'tags') return contact.tags_list
  return null
}

function isEmptyValue(value: string | number | boolean | string[] | null): boolean {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'number') return Number.isNaN(value)
  if (typeof value === 'boolean') return false
  return !String(value).trim()
}

function evaluateConditionValue(
  value: string | number | boolean | string[] | null,
  operator: ConditionOperator,
  expectedRaw: unknown,
): boolean {
  const expected = String(expectedRaw ?? '').trim()
  const expectedLower = expected.toLowerCase()

  if (operator === 'is_empty') return isEmptyValue(value)
  if (operator === 'is_not_empty') return !isEmptyValue(value)
  if (value === null || value === undefined) return false

  if (Array.isArray(value)) {
    const values = value.map((item) => item.trim().toLowerCase()).filter(Boolean)
    if (operator === 'includes' || operator === 'contains' || operator === 'equals') return values.includes(expectedLower)
    if (operator === 'not_includes' || operator === 'not_contains' || operator === 'not_equals') return !values.includes(expectedLower)
    return false
  }

  if (typeof value === 'boolean') {
    const expectedBool = boolFromUnknown(expected)
    if (operator === 'equals' || operator === 'includes' || operator === 'contains') return value === expectedBool
    if (operator === 'not_equals' || operator === 'not_includes' || operator === 'not_contains') return value !== expectedBool
    return false
  }

  const asNumber = Number(value)
  const expectedNumber = Number(expected)
  const bothNumeric = Number.isFinite(asNumber) && Number.isFinite(expectedNumber)
  if (bothNumeric) {
    if (operator === 'greater_than') return asNumber > expectedNumber
    if (operator === 'greater_or_equal') return asNumber >= expectedNumber
    if (operator === 'less_than') return asNumber < expectedNumber
    if (operator === 'less_or_equal') return asNumber <= expectedNumber
  }

  const valueString = String(value).trim().toLowerCase()
  if (operator === 'equals') return valueString === expectedLower
  if (operator === 'not_equals') return valueString !== expectedLower
  if (operator === 'contains' || operator === 'includes') return valueString.includes(expectedLower)
  if (operator === 'not_contains' || operator === 'not_includes') return !valueString.includes(expectedLower)
  return false
}

function evaluateConditionNode(contact: CrmContactRecord, node: CrmWorkflowNode): {
  field: string
  operator: ConditionOperator
  expected: string
  matched: boolean
} {
  const field = String(node.config?.field || 'tags').trim().toLowerCase()
  const operator = normalizeConditionOperator(node.config?.operator)
  const expected = String(node.config?.value ?? '').trim()
  const actual = getConditionFieldValue(contact, field)
  const matched = evaluateConditionValue(actual, operator, expected)
  return { field, operator, expected, matched }
}

function resolveConditionBranch(graph: CrmWorkflowGraph, node: CrmWorkflowNode, matched: boolean): {
  branch: WorkflowBranch
  targetId: string | null
} {
  const preferredBranch: WorkflowBranch = matched ? 'true' : 'false'
  const preferred = getNextNodeId(graph, node.id, preferredBranch)
  if (preferred) return { branch: preferredBranch, targetId: preferred }
  return { branch: 'default', targetId: getNextNodeId(graph, node.id, 'default') }
}

/** Find a goal_event node whose condition currently matches this contact,
 *  if any. Used by the worker at each step to implement the GHL-style
 *  "skip ahead to the goal when it's been reached" behaviour. Returns null
 *  when no goal matches. */
function findMatchingGoal(graph: CrmWorkflowGraph, contact: CrmContactRecord, currentNodeId: string | null): CrmWorkflowNode | null {
  for (const node of graph.nodes) {
    if (node.type !== 'goal_event') continue
    if (node.id === currentNodeId) continue // already at the goal
    const field = String(node.config?.field || '').trim().toLowerCase()
    const operator = normalizeConditionOperator(node.config?.operator)
    const expected = String(node.config?.value ?? '').trim()
    if (!field || !expected) continue
    const actual = getConditionFieldValue(contact, field)
    if (evaluateConditionValue(actual, operator, expected)) return node
  }
  return null
}

async function executeEmailNode(run: CrmWorkflowRunRecord, node: CrmWorkflowNode): Promise<{ outcome: 'sent' | 'skipped'; detail: string }> {
  const contact = getCrmContactById(run.contact_id, run.workspace_id)
  if (!contact) throw new Error('Contact not found')
  if (contact.unsubscribed || contact.dnd_email) {
    return { outcome: 'skipped', detail: 'Skipped email because contact is unsubscribed or DND email is on' }
  }
  const to = String(node.config?.to || contact.email || '').trim()
  const subject = String(node.config?.subject || '').trim()
  const bodyHtml = String(node.config?.body_html || '').trim()
  if (!to) throw new Error('Email node has no recipient')
  if (!subject) throw new Error('Email node subject is required')
  if (!bodyHtml) throw new Error('Email node body is required')

  const workspaceOwnerId = getWorkspaceById(run.workspace_id)?.owner_id || contact.owner_id || 1
  const sendResult = await sendEmail(workspaceOwnerId, to, subject, bodyHtml)
  if (!sendResult.success) throw new Error(sendResult.error || 'Email send failed')

  const threadId = `workflow:${run.workflow_id}:${run.id}`
  const account = getDefaultEmailAccount(run.workspace_id)
  const sendRecord = createDirectEmailSend({
    workspaceId: run.workspace_id,
    contactId: contact.id,
    subject,
    bodyHtml,
    accountId: account?.id ?? null,
    threadId,
  })
  if (!sendRecord) throw new Error('Failed to record workflow email send')

  createCrmContactActivity({
    contactId: contact.id,
    workspaceId: run.workspace_id,
    type: 'email',
    body: `Workflow email sent: "${subject}" → ${to}`,
  })
  if (account) {
    createEmailInboxEntry({
      account_id: account.id,
      contact_id: contact.id,
      direction: 'outbound',
      subject,
      body_html: bodyHtml,
      from_email: account.email,
      to_email: to,
      received_at: sendRecord.sent_at ?? Math.floor(Date.now() / 1000),
      is_read: 1,
      thread_id: threadId,
    })
  }
  return { outcome: 'sent', detail: `Email sent to ${to}` }
}

async function executeSmsNode(run: CrmWorkflowRunRecord, node: CrmWorkflowNode): Promise<{ outcome: 'sent' | 'skipped'; detail: string }> {
  const contact = getCrmContactById(run.contact_id, run.workspace_id)
  if (!contact) throw new Error('Contact not found')
  if (contact.unsubscribed || contact.dnd_sms) {
    return { outcome: 'skipped', detail: 'Skipped SMS because contact is unsubscribed or DND SMS is on' }
  }

  // Prefer workspace-level Twilio integration, fall back to global settings
  // for backward compat with the older single-tenant config.
  const integration = getWorkspaceIntegration(run.workspace_id, 'twilio')
  const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
  const authToken  = String(integration?.config.auth_token  || getSetting('twilio_auth_token')  || '').trim()
  const fromPhone  = String(integration?.config.from_number || getSetting('twilio_phone_number') || '').trim()
  if (!accountSid || !authToken || !fromPhone) throw new Error('Twilio is not configured')

  const to = String(node.config?.to || contact.phone || '').trim()
  const message = String(node.config?.message || '').trim()
  if (!to) throw new Error('SMS node has no recipient')
  if (!message) throw new Error('SMS message is required')

  const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: fromPhone,
      Body: message,
    }),
  })

  const raw = await twilioRes.text()
  let payload: Record<string, unknown> | null = null
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    payload = null
  }
  if (!twilioRes.ok) {
    const errorMessage = typeof payload?.message === 'string' ? payload.message : raw || 'Twilio send failed'
    throw new Error(errorMessage)
  }

  createSmsMessage({
    contact_id: contact.id,
    direction: 'outbound',
    body: message,
    from_phone: fromPhone,
    to_phone: to,
    twilio_sid: typeof payload?.sid === 'string' ? payload.sid : undefined,
  })
  // No activity log — SMS already appears in the chat thread.
  return { outcome: 'sent', detail: `SMS sent to ${to}` }
}

function applyContactTemplate(input: string, contact: CrmContactRecord): string {
  const source = String(input || '')
  if (!source) return ''
  const valueMap: Record<string, string> = {
    id: String(contact.id),
    public_id: contact.public_id || '',
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    company: contact.company || '',
    source: contact.source || '',
    lifecycle_stage: contact.lifecycle_stage || '',
    pipeline_stage: contact.pipeline_stage_name || '',
    pipeline_stage_id: contact.pipeline_stage_id ? String(contact.pipeline_stage_id) : '',
    tags: contact.tags_list.join(', '),
    unsubscribed: contact.unsubscribed ? 'true' : 'false',
    dnd_sms: contact.dnd_sms ? 'true' : 'false',
    dnd_email: contact.dnd_email ? 'true' : 'false',
    dnd_calls: contact.dnd_calls ? 'true' : 'false',
  }
  return source.replace(/\{\{\s*contact\.([a-zA-Z0-9_]+)\s*\}\}/g, (_match, rawKey: string) => valueMap[String(rawKey || '').trim().toLowerCase()] ?? '')
}

function applyWorkflowTemplate(input: string, run: CrmWorkflowRunRecord, contact: CrmContactRecord): string {
  const source = String(input || '')
  if (!source) return ''
  const nowUnix = Math.floor(Date.now() / 1000)
  const nowIso = new Date(nowUnix * 1000).toISOString()
  const base = applyContactTemplate(source, contact)
  // Compute the public unsubscribe link so templates can embed it in email
  // bodies. Respects APP_URL / NEXT_PUBLIC_APP_URL / app_base_url setting;
  // falls back to the production domain.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || getSetting('app_base_url') || '').toString().replace(/\/+$/, '') || 'https://app.example.com'
  const unsubscribeLink = contact.public_id ? `${baseUrl}/u/${contact.public_id}` : ''
  const valueMap: Record<string, string> = {
    'run.id': String(run.id),
    'run.workflow_id': String(run.workflow_id),
    'run.workspace_id': String(run.workspace_id),
    'run.contact_id': String(run.contact_id),
    'run.status': run.status,
    'run.attempt_count': String(run.attempt_count),
    'workflow.id': String(run.workflow_id),
    'workflow.name': run.workflow_name || '',
    'workspace.id': String(run.workspace_id),
    'now.unix': String(nowUnix),
    'now.iso': nowIso,
    'unsubscribe_link': unsubscribeLink,
  }
  return base.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, rawKey: string) => valueMap[String(rawKey || '').trim().toLowerCase()] ?? '')
}

function normalizeWebhookMethod(raw: unknown): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  const method = String(raw || 'POST').trim().toUpperCase()
  if (method === 'GET' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') return method
  return 'POST'
}

function parseWebhookHeaders(raw: unknown, run: CrmWorkflowRunRecord, contact: CrmContactRecord): Record<string, string> {
  if (raw === null || raw === undefined || raw === '') return {}
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Webhook headers must be valid JSON')
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Webhook headers must be a JSON object')
  }
  const headers: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(rawKey || '').trim()
    if (!key) continue
    if (rawValue === null || rawValue === undefined) continue
    headers[key] = applyWorkflowTemplate(String(rawValue), run, contact)
  }
  return headers
}

async function executeWebhookNode(run: CrmWorkflowRunRecord, node: CrmWorkflowNode): Promise<{ outcome: 'sent'; detail: string }> {
  const contact = getCrmContactById(run.contact_id, run.workspace_id)
  if (!contact) throw new Error('Contact not found')

  const url = applyWorkflowTemplate(String(node.config?.url || ''), run, contact).trim()
  if (!url) throw new Error('Webhook URL is required')
  if (!/^https?:\/\//i.test(url)) throw new Error('Webhook URL must start with http:// or https://')

  const method = normalizeWebhookMethod(node.config?.method)
  const headersMap = parseWebhookHeaders(node.config?.headers_json ?? node.config?.headers, run, contact)
  const headers = new Headers()
  for (const [key, value] of Object.entries(headersMap)) headers.set(key, value)

  const bodyTemplate = String(node.config?.body_template ?? node.config?.body ?? '')
  const body = (method === 'GET')
    ? undefined
    : applyWorkflowTemplate(bodyTemplate, run, contact)
  if (body && !headers.has('content-type')) {
    headers.set('content-type', String(node.config?.content_type || 'application/json'))
  }

  const timeoutMs = Math.min(120000, Math.max(1000, parsePositiveInt(node.config?.timeout_ms, 15000)))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') throw new Error(`Webhook timed out after ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timeout)
  }

  const responseBody = (await response.text()).slice(0, 500)
  if (!response.ok) {
    throw new Error(`Webhook ${method} failed (${response.status})${responseBody ? `: ${responseBody}` : ''}`)
  }

  createCrmContactActivity({
    contactId: contact.id,
    workspaceId: run.workspace_id,
    type: 'note',
    body: `Workflow webhook sent: ${method} ${url} (${response.status})`,
  })
  return { outcome: 'sent', detail: `Webhook ${method} delivered (${response.status})` }
}

/**
 * Given a workflow's business_hours_json string, return:
 *   null                — allowed to run right now
 *   unix timestamp (s)  — next allowed window when it's currently off-hours
 *
 * Config shape: { enabled, start_hour, end_hour, days: [0-6] }.
 * start_hour and end_hour are 24-hour local time. end is exclusive.
 */
function nextBusinessHoursWindow(configJson: string | null, nowMs: number): number | null {
  if (!configJson) return null
  let config: { enabled?: boolean; start_hour?: number; end_hour?: number; days?: number[] }
  try { config = JSON.parse(configJson) } catch { return null }
  if (!config?.enabled) return null

  const start = Math.max(0, Math.min(23, Math.floor(config.start_hour ?? 9)))
  const end   = Math.max(start + 1, Math.min(24, Math.floor(config.end_hour ?? 17)))
  const allowedDays = Array.isArray(config.days) && config.days.length > 0
    ? new Set(config.days.map((d) => Math.max(0, Math.min(6, Math.floor(d)))))
    : new Set([0, 1, 2, 3, 4, 5, 6])

  const now = new Date(nowMs)
  const inHours = allowedDays.has(now.getDay()) && now.getHours() >= start && now.getHours() < end
  if (inHours) return null

  // Walk forward up to 14 days to find the next open window.
  for (let i = 0; i < 14 * 24; i += 1) {
    const candidate = new Date(nowMs)
    candidate.setHours(candidate.getHours() + i, 0, 0, 0)
    if (!allowedDays.has(candidate.getDay())) continue
    if (candidate.getHours() < start) {
      candidate.setHours(start, 0, 0, 0)
      if (candidate.getTime() > nowMs) return Math.floor(candidate.getTime() / 1000)
      continue
    }
    if (candidate.getHours() >= end) continue
    if (candidate.getTime() > nowMs) return Math.floor(candidate.getTime() / 1000)
  }
  // Fallback: try again in an hour.
  return Math.floor(nowMs / 1000) + 3600
}

/** Lowercase-trim + SHA-256 hex digest. Used for Facebook Conversions API
 *  user_data fields (email, phone) which require the Meta-specific hashing. */
async function sha256Lower(raw: string): Promise<string> {
  const normalized = raw.trim().toLowerCase()
  const data = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function parsePositiveNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, numeric)
}

function parseBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function getUserEmailById(userId: number): string | null {
  const row = getDb().prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined
  return row?.email ?? null
}

function startOfCurrentUtcDay(): number {
  const day = new Date().toISOString().slice(0, 10)
  return Math.floor(new Date(`${day}T00:00:00.000Z`).getTime() / 1000)
}

function getPublicAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || getSetting('app_base_url') || '')
    .toString()
    .replace(/\/+$/, '')
    || 'https://app.example.com'
}

type SurveySendResult = { outcome: 'sent' | 'skipped'; detail: string; link: string }

async function sendSurveyLinkMessage(data: {
  workspaceId: number
  contact: NonNullable<ReturnType<typeof getCrmContactById>>
  surveyPublicId: string
  channel: 'sms' | 'email'
  messageTemplate: string
  subjectTemplate?: string | null
  activityLabel: string
}): Promise<SurveySendResult> {
  const survey = getCrmSurveyByPublicId(data.surveyPublicId, data.workspaceId)
  if (!survey) throw new Error(`Survey "${data.surveyPublicId}" not found`)
  if (survey.status === 'archived') return { outcome: 'skipped', detail: 'Survey is archived', link: '' }
  const response = createCrmSurveyResponseSession({
    survey_id: survey.id,
    workspace_id: data.workspaceId,
    contact_id: data.contact.id,
    source: data.channel,
  })
  if (!response) throw new Error('Could not create survey response session')

  const link = `${getPublicAppBaseUrl()}/s/${survey.slug}/${response.session_id}`
  const message = data.messageTemplate.replace(/\{\{\s*survey_link\s*\}\}/gi, link).trim()
  if (!message) throw new Error('Survey message is empty')

  if (data.channel === 'sms') {
    if (data.contact.unsubscribed || data.contact.dnd_sms) {
      return { outcome: 'skipped', detail: 'Skipped SMS survey send due to unsubscribe/DND', link }
    }
    if (!data.contact.phone) return { outcome: 'skipped', detail: 'Skipped SMS survey send (no phone)', link }
    const integration = getWorkspaceIntegration(data.workspaceId, 'twilio')
    const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
    const authToken  = String(integration?.config.auth_token  || getSetting('twilio_auth_token')  || '').trim()
    const fromPhone  = String(integration?.config.from_number || getSetting('twilio_phone_number') || '').trim()
    if (!accountSid || !authToken || !fromPhone) {
      return { outcome: 'skipped', detail: 'Skipped SMS survey send (Twilio not configured)', link }
    }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: data.contact.phone,
        From: fromPhone,
        Body: message,
      }),
    })
    const raw = await res.text()
    let payload: Record<string, unknown> | null = null
    try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = null }
    if (!res.ok) {
      const providerMessage = typeof payload?.message === 'string' ? payload.message : raw
      throw new Error(`Twilio survey SMS failed: ${providerMessage || `status ${res.status}`}`)
    }
    createSmsMessage({
      contact_id: data.contact.id,
      direction: 'outbound',
      body: message,
      from_phone: fromPhone,
      to_phone: data.contact.phone,
      twilio_sid: typeof payload?.sid === 'string' ? payload.sid : undefined,
    })
    // No activity log — SMS already appears in the chat thread.
    return { outcome: 'sent', detail: `Survey SMS sent to ${data.contact.phone}`, link }
  }

  if (data.contact.unsubscribed || data.contact.dnd_email) {
    return { outcome: 'skipped', detail: 'Skipped email survey send due to unsubscribe/DND', link }
  }
  if (!data.contact.email) return { outcome: 'skipped', detail: 'Skipped email survey send (no email)', link }
  const workspace = getWorkspaceById(data.workspaceId)
  const senderUserId = workspace?.owner_id || data.contact.owner_id || 1
  const subject = String(data.subjectTemplate || '').trim() || 'Quick feedback?'
  const html = `<p>${message.replace(/\n/g, '<br>')}</p>`
  const result = await sendEmail(senderUserId, data.contact.email, subject, html)
  if (!result.success) throw new Error(`Survey email failed: ${result.error || 'unknown error'}`)
  createCrmContactActivity({
    contactId: data.contact.id,
    workspaceId: data.workspaceId,
    type: 'email',
    body: `${data.activityLabel} (email): ${link}`,
  })
  return { outcome: 'sent', detail: `Survey email sent to ${data.contact.email}`, link }
}

async function processDueSurveyCampaignQueue(): Promise<void> {
  const due = getDueCrmSurveyCampaignDispatchRows(Math.floor(Date.now() / 1000), 50)
  for (const row of due) {
    const contact = getCrmContactById(row.contact_id, row.workspace_id)
    if (!contact) {
      markCrmSurveyCampaignQueueResult(row.queue_id, 'skipped', 'Contact no longer exists')
      continue
    }
    let sentCount = 0
    const failures: string[] = []
    const skipped: string[] = []

    if (row.channel === 'sms' || row.channel === 'both') {
      try {
        const smsTemplate = row.sms_template?.trim() || 'Hey {{contact.name}} — could you share quick feedback? {{survey_link}}'
        const smsResult = await sendSurveyLinkMessage({
          workspaceId: row.workspace_id,
          contact,
          surveyPublicId: row.survey_public_id,
          channel: 'sms',
          messageTemplate: applyContactTemplate(smsTemplate, contact),
          activityLabel: `Survey campaign "${row.campaign_name}" sent`,
        })
        if (smsResult.outcome === 'sent') sentCount += 1
        else skipped.push(smsResult.detail)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'SMS send failed')
      }
    }

    if (row.channel === 'email' || row.channel === 'both') {
      try {
        const subjectTemplate = row.email_subject_template?.trim() || 'Quick feedback?'
        const bodyTemplate = row.email_body_template?.trim() || 'Hey {{contact.name}} — we would love your feedback: {{survey_link}}'
        const emailResult = await sendSurveyLinkMessage({
          workspaceId: row.workspace_id,
          contact,
          surveyPublicId: row.survey_public_id,
          channel: 'email',
          messageTemplate: applyContactTemplate(bodyTemplate, contact),
          subjectTemplate: applyContactTemplate(subjectTemplate, contact),
          activityLabel: `Survey campaign "${row.campaign_name}" sent`,
        })
        if (emailResult.outcome === 'sent') sentCount += 1
        else skipped.push(emailResult.detail)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Email send failed')
      }
    }

    if (sentCount > 0) {
      const note = [...failures, ...skipped].join(' | ')
      markCrmSurveyCampaignQueueResult(row.queue_id, 'sent', note || null)
      continue
    }
    if (failures.length > 0) {
      markCrmSurveyCampaignQueueResult(row.queue_id, 'failed', failures.join(' | '))
      continue
    }
    markCrmSurveyCampaignQueueResult(row.queue_id, 'skipped', skipped.join(' | ') || 'No eligible delivery channel')
  }
}


async function executeContactActionNode(run: CrmWorkflowRunRecord, node: CrmWorkflowNode): Promise<string> {
  const contact = getCrmContactById(run.contact_id, run.workspace_id)
  if (!contact) throw new Error('Contact not found')
  const value = String(node.config?.value || '').trim()

  if (node.type === 'add_tag') {
    if (!value) throw new Error('Action value is required')
    const nextTags = Array.from(new Set([...contact.tags_list, value]))
    updateCrmContact(contact.id, run.workspace_id, { tags: nextTags })
    const updatedContact = getCrmContactById(contact.id, run.workspace_id)
    if (updatedContact) {
      queueCrmWorkflowRunsForContactChange({
        workspaceId: run.workspace_id,
        beforeContact: contact,
        afterContact: updatedContact,
      })
    }
    createCrmContactActivity({ contactId: contact.id, workspaceId: run.workspace_id, type: 'note', body: `Workflow added tag: ${value}` })
    return `Added tag "${value}"`
  }
  if (node.type === 'remove_tag') {
    if (!value) throw new Error('Action value is required')
    const target = value.toLowerCase()
    const nextTags = contact.tags_list.filter((tag) => tag.trim().toLowerCase() !== target)
    updateCrmContact(contact.id, run.workspace_id, { tags: nextTags })
    const updatedContact = getCrmContactById(contact.id, run.workspace_id)
    if (updatedContact) {
      queueCrmWorkflowRunsForContactChange({
        workspaceId: run.workspace_id,
        beforeContact: contact,
        afterContact: updatedContact,
      })
    }
    createCrmContactActivity({ contactId: contact.id, workspaceId: run.workspace_id, type: 'note', body: `Workflow removed tag: ${value}` })
    return `Removed tag "${value}"`
  }
  if (node.type === 'set_lifecycle_stage') {
    if (!value) throw new Error('Action value is required')
    updateCrmContact(contact.id, run.workspace_id, { lifecycle_stage: value })
    const updatedContact = getCrmContactById(contact.id, run.workspace_id)
    if (updatedContact) {
      queueCrmWorkflowRunsForContactChange({
        workspaceId: run.workspace_id,
        beforeContact: contact,
        afterContact: updatedContact,
      })
    }
    createCrmContactActivity({ contactId: contact.id, workspaceId: run.workspace_id, type: 'note', body: `Workflow set lifecycle stage: ${value}` })
    return `Set lifecycle stage to "${value}"`
  }
  if (node.type === 'set_pipeline_stage') {
    if (!value) throw new Error('Action value is required')
    const stageId = Number(value)
    if (!Number.isInteger(stageId) || stageId <= 0 || !getCrmPipelineStageById(stageId, run.workspace_id)) {
      throw new Error(`Invalid pipeline stage id: ${value}`)
    }
    updateCrmContact(contact.id, run.workspace_id, { pipeline_stage_id: stageId })
    const updatedContact = getCrmContactById(contact.id, run.workspace_id)
    if (updatedContact) {
      queueCrmWorkflowRunsForContactChange({
        workspaceId: run.workspace_id,
        beforeContact: contact,
        afterContact: updatedContact,
      })
    }
    createCrmContactActivity({ contactId: contact.id, workspaceId: run.workspace_id, type: 'note', body: `Workflow moved stage to #${stageId}` })
    return `Moved contact to pipeline stage #${stageId}`
  }
  if (node.type === 'add_to_list') {
    const listId = Number(node.config?.list_id || value)
    if (!Number.isInteger(listId) || listId <= 0) throw new Error('List id is required')
    const added = addContactsToCrmList(listId, run.workspace_id, [contact.id])
    const detail = added > 0 ? `Added contact to list #${listId}` : `Contact already in list #${listId}`
    createCrmContactActivity({ contactId: contact.id, workspaceId: run.workspace_id, type: 'note', body: `Workflow list action: ${detail}` })
    return detail
  }
  if (node.type === 'remove_from_list') {
    const listId = Number(node.config?.list_id || value)
    if (!Number.isInteger(listId) || listId <= 0) throw new Error('List id is required')
    const removed = removeContactFromCrmList(listId, run.workspace_id, contact.id)
    const detail = removed ? `Removed contact from list #${listId}` : `Contact not present in list #${listId}`
    createCrmContactActivity({ contactId: contact.id, workspaceId: run.workspace_id, type: 'note', body: `Workflow list action: ${detail}` })
    return detail
  }
  if (node.type === 'create_task') {
    const titleTemplate = String(node.config?.title || '').trim()
    const title = applyWorkflowTemplate(titleTemplate, run, contact).trim()
    if (!title) throw new Error('Task title is required')
    const description = applyWorkflowTemplate(String(node.config?.description || ''), run, contact).trim()
    const dueDate = String(node.config?.due_date || '').trim()
    const priorityRaw = String(node.config?.priority || 'medium').trim().toLowerCase()
    const statusRaw = String(node.config?.status || 'todo').trim().toLowerCase()
    const priority = (priorityRaw === 'urgent' || priorityRaw === 'high' || priorityRaw === 'low') ? priorityRaw : 'medium'
    const status = (
      statusRaw === 'backlog'
      || statusRaw === 'in_progress'
      || statusRaw === 'review'
      || statusRaw === 'done'
      || statusRaw === 'blocked'
      || statusRaw === 'cancelled'
      || statusRaw === 'archived'
    ) ? statusRaw : 'todo'
    const assignee = String(node.config?.assignee || '').trim()
    const configProjectId = Number(node.config?.project_id)
    const projectId = Number.isFinite(configProjectId) && configProjectId > 0
      ? configProjectId
      : ensureOutreachProject(run.workspace_id).id
    const task = createTask({
      title,
      workspaceId: run.workspace_id,
      crmContactId: contact.id,
      projectId,
      description: description || undefined,
      due_date: dueDate || undefined,
      priority,
      status,
      assignee: assignee || undefined,
      duration_minutes: Math.max(1, Math.floor(parsePositiveNumber(node.config?.duration_minutes, 30))),
    })
    createTaskActivity(task.id, 'comment', `Created by workflow "${run.workflow_name}"`)
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'task',
      body: `Workflow created task: ${task.title}`,
    })
    return `Created task "${task.title}"`
  }
  if (node.type === 'create_opportunity') {
    const nameTemplate = String(node.config?.name || '').trim()
    const name = applyWorkflowTemplate(nameTemplate, run, contact).trim()
    if (!name) throw new Error('Opportunity name is required')
    const stage = String(node.config?.stage || 'Prospect').trim() || 'Prospect'
    const statusRaw = String(node.config?.status || 'open').trim().toLowerCase()
    const status = (statusRaw === 'won' || statusRaw === 'lost') ? statusRaw : 'open'
    const closeDate = String(node.config?.close_date || '').trim()
    const notes = applyWorkflowTemplate(String(node.config?.notes || ''), run, contact).trim()
    const created = createCrmOpportunity(run.workspace_id, {
      contact_id: contact.id,
      name,
      value: parsePositiveNumber(node.config?.value_amount ?? node.config?.value, 0),
      stage,
      close_date: closeDate || null,
      probability: parsePositiveNumber(node.config?.probability, 0),
      notes: notes || null,
      status,
    })
    if (!created) throw new Error('Failed to create opportunity')
    queueCrmWorkflowRunsForTrigger({
      workspaceId: run.workspace_id,
      contactId: contact.id,
      triggerType: 'opportunity_created',
    })
    if (created.stage) {
      queueCrmWorkflowRunsForTrigger({
        workspaceId: run.workspace_id,
        contactId: contact.id,
        triggerType: 'opportunity_stage_changed',
        triggerValue: created.stage,
      })
    }
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `Workflow created opportunity: ${created.name} (${created.stage})`,
    })
    return `Created opportunity "${created.name}"`
  }
  if (node.type === 'update_opportunity_stage') {
    const stage = String(node.config?.stage || '').trim()
    const createIfMissing = parseBool(node.config?.create_if_missing)
    const openOps = getCrmOpportunities({
      workspaceId: run.workspace_id,
      contactId: contact.id,
      status: 'open',
    })
    let target = openOps.reduce((best, candidate) => {
      if (!best) return candidate
      return candidate.id > best.id ? candidate : best
    }, null as (typeof openOps[number] | null))

    if (!target && createIfMissing) {
      const fallbackName = applyWorkflowTemplate(String(node.config?.create_name || `Opportunity - ${contact.name}`), run, contact).trim()
      target = createCrmOpportunity(run.workspace_id, {
        contact_id: contact.id,
        name: fallbackName || `Opportunity - ${contact.name}`,
        stage: stage || 'Prospect',
        status: 'open',
        value: parsePositiveNumber(node.config?.value_amount ?? node.config?.value, 0),
        probability: parsePositiveNumber(node.config?.probability, 0),
      })
      if (!target) throw new Error('Failed to create fallback opportunity')
    }
    if (!target) throw new Error('No open opportunity found for contact')

    const statusRaw = String(node.config?.status || '').trim().toLowerCase()
    const status = (statusRaw === 'open' || statusRaw === 'won' || statusRaw === 'lost') ? statusRaw : undefined
    const previousStage = target.stage
    const updated = updateCrmOpportunity(target.id, run.workspace_id, {
      stage: stage || undefined,
      status,
      value: node.config?.value_amount !== undefined || node.config?.value !== undefined
        ? parsePositiveNumber(node.config?.value_amount ?? node.config?.value, 0)
        : undefined,
      probability: node.config?.probability !== undefined
        ? parsePositiveNumber(node.config?.probability, 0)
        : undefined,
    })
    if (!updated) throw new Error('Failed to update opportunity')
    if (updated.stage && updated.stage !== previousStage) {
      queueCrmWorkflowRunsForTrigger({
        workspaceId: run.workspace_id,
        contactId: contact.id,
        triggerType: 'opportunity_stage_changed',
        triggerValue: updated.stage,
      })
    }

    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `Workflow updated opportunity "${updated.name}" to stage "${updated.stage}"`,
    })
    return `Updated opportunity "${updated.name}" to stage "${updated.stage}"`
  }
  // ── Actions below run without external integrations ─────────────────────

  if (node.type === 'update_contact_field') {
    const field = String(node.config?.field || '').trim()
    const raw = String(node.config?.value ?? '').trim()
    const value = applyWorkflowTemplate(raw, run, contact)
    const allowed = new Set(['name','email','phone','company','job_title','website','source'])
    if (!field || !allowed.has(field)) throw new Error(`Unsupported contact field: ${field}`)
    updateCrmContact(contact.id, run.workspace_id, { [field]: value || null } as Parameters<typeof updateCrmContact>[2])
    const updatedContact = getCrmContactById(contact.id, run.workspace_id)
    if (updatedContact) {
      queueCrmWorkflowRunsForContactChange({
        workspaceId: run.workspace_id, beforeContact: contact, afterContact: updatedContact,
      })
    }
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow updated ${field}: ${value || '(cleared)'}`,
    })
    return `Updated ${field}`
  }

  if (node.type === 'update_custom_field') {
    const fieldKey = String(node.config?.field_key || '').trim()
    if (!fieldKey) throw new Error('Custom field key is required')
    const raw = String(node.config?.value ?? '').trim()
    const value = applyWorkflowTemplate(raw, run, contact)
    const nextCustom = { ...contact.custom_fields_json, [fieldKey]: value }
    updateCrmContact(contact.id, run.workspace_id, { custom_fields: nextCustom })
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow set custom field ${fieldKey} = ${value || '(empty)'}`,
    })
    return `Set custom field ${fieldKey}`
  }

  if (node.type === 'toggle_dnd') {
    const channel = String(node.config?.channel || '').trim()
    const state = String(node.config?.state || '').trim()
    if (!['email','sms','call','all'].includes(channel)) throw new Error(`Invalid DND channel: ${channel}`)
    if (!['on','off'].includes(state)) throw new Error(`Invalid DND state: ${state}`)
    const flag = state === 'on'
    const patch: Parameters<typeof updateCrmContact>[2] = {}
    if (channel === 'email' || channel === 'all') patch.dnd_email = flag
    if (channel === 'sms'   || channel === 'all') patch.dnd_sms = flag
    if (channel === 'call'  || channel === 'all') patch.dnd_calls = flag
    updateCrmContact(contact.id, run.workspace_id, patch)
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow turned DND ${state} for ${channel}`,
    })
    return `DND ${state} · ${channel}`
  }

  if (node.type === 'add_note') {
    const template = String(node.config?.body || '').trim()
    if (!template) throw new Error('Note body is required')
    const body = applyWorkflowTemplate(template, run, contact)
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note', body,
    })
    return `Added note`
  }

  if (node.type === 'assign_ticket') {
    const userId = Number(node.config?.user_id)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Assignee user id is required')
    const target = getLatestCrmTicketForContact(contact.id, run.workspace_id, { excludeClosed: true })
    if (!target) return 'No open ticket to assign'
    const updated = updateCrmTicket(target.id, run.workspace_id, { assignee_user_id: userId })
    if (!updated) throw new Error('Failed to assign ticket')
    queueCrmWorkflowRunsForTicketUpdated(target, updated)
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow assigned ticket #${updated.ticket_number} to user #${userId}`,
    })
    return `Assigned ticket #${updated.ticket_number} to user #${userId}`
  }

  if (node.type === 'set_ticket_status') {
    const statusRaw = String(node.config?.status || '').trim().toLowerCase()
    if (!['open', 'pending', 'on_hold', 'solved', 'closed'].includes(statusRaw)) throw new Error('Valid ticket status is required')
    const target = getLatestCrmTicketForContact(contact.id, run.workspace_id, { excludeClosed: false })
    if (!target) return 'No ticket found for contact'
    const updated = updateCrmTicket(target.id, run.workspace_id, { status: statusRaw as 'open' | 'pending' | 'on_hold' | 'solved' | 'closed' })
    if (!updated) throw new Error('Failed to update ticket status')
    queueCrmWorkflowRunsForTicketUpdated(target, updated)
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow set ticket #${updated.ticket_number} to ${updated.status}`,
    })
    return `Set ticket #${updated.ticket_number} to ${updated.status}`
  }

  if (node.type === 'add_ticket_tag') {
    const tag = String(node.config?.tag || node.config?.value || '').trim()
    if (!tag) throw new Error('Ticket tag is required')
    const target = getLatestCrmTicketForContact(contact.id, run.workspace_id, { excludeClosed: true })
    if (!target) return 'No open ticket to tag'
    const updated = updateCrmTicket(target.id, run.workspace_id, { tags: [...target.tags_list, tag] })
    if (!updated) throw new Error('Failed to tag ticket')
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow tagged ticket #${updated.ticket_number} with ${tag}`,
    })
    return `Tagged ticket #${updated.ticket_number} with ${tag}`
  }

  if (node.type === 'math_on_field') {
    const fieldKey = String(node.config?.field_key || '').trim()
    const operator = String(node.config?.operator || '').trim()
    if (!fieldKey) throw new Error('Field key is required')
    const current = Number(contact.custom_fields_json[fieldKey] ?? 0) || 0
    const operand = Number(node.config?.value ?? 0) || 0
    let next = current
    switch (operator) {
      case 'add':      next = current + operand; break
      case 'subtract': next = current - operand; break
      case 'multiply': next = current * operand; break
      case 'set':      next = operand; break
      default: throw new Error(`Unsupported math operator: ${operator}`)
    }
    const nextCustom = { ...contact.custom_fields_json, [fieldKey]: next }
    updateCrmContact(contact.id, run.workspace_id, { custom_fields: nextCustom })
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow math: ${fieldKey} ${operator} ${operand} = ${next}`,
    })
    return `${fieldKey}: ${current} → ${next}`
  }

  if (node.type === 'delete_opportunity') {
    const openOps = getCrmOpportunities({
      workspaceId: run.workspace_id, contactId: contact.id, status: 'open',
    })
    const target = openOps[openOps.length - 1] || null
    if (!target) return 'No open opportunity to delete'
    deleteCrmOpportunity(target.id, run.workspace_id)
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow deleted opportunity: ${target.name}`,
    })
    return `Deleted opportunity "${target.name}"`
  }

  if (node.type === 'assign_opportunity') {
    const userId = Number(node.config?.user_id)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Assignee user id is required')
    const openOps = getCrmOpportunities({
      workspaceId: run.workspace_id, contactId: contact.id, status: 'open',
    })
    const target = openOps[openOps.length - 1] || null
    if (!target) throw new Error('No open opportunity to assign')
    updateCrmOpportunity(target.id, run.workspace_id, { owner_id: userId })
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow assigned opportunity "${target.name}" to user #${userId}`,
    })
    return `Assigned "${target.name}" to user #${userId}`
  }

  if (node.type === 'mark_opportunity_abandoned') {
    const reason = typeof node.config?.reason === 'string' ? node.config.reason : null
    const openOps = getCrmOpportunities({
      workspaceId: run.workspace_id, contactId: contact.id, status: 'open',
    })
    const target = openOps[openOps.length - 1] || null
    if (!target) return 'No open opportunity to abandon'
    updateCrmOpportunity(target.id, run.workspace_id, {
      status: 'abandoned',
      lost_reason: reason || target.lost_reason || null,
    })
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow abandoned opportunity "${target.name}"${reason ? `: ${reason}` : ''}`,
    })
    return `Abandoned "${target.name}"`
  }

  if (node.type === 'add_opportunity_tag') {
    const tag = typeof node.config?.tag === 'string' ? node.config.tag.trim() : ''
    if (!tag) throw new Error('Tag is required')
    const openOps = getCrmOpportunities({
      workspaceId: run.workspace_id, contactId: contact.id, status: 'open',
    })
    const target = openOps[openOps.length - 1] || null
    if (!target) return 'No open opportunity to tag'
    addCrmOpportunityTag(target.id, run.workspace_id, tag)
    return `Tagged "${target.name}" with ${tag}`
  }

  if (node.type === 'add_opportunity_note') {
    const body = typeof node.config?.body === 'string' ? node.config.body.trim() : ''
    if (!body) throw new Error('Note body is required')
    const openOps = getCrmOpportunities({
      workspaceId: run.workspace_id, contactId: contact.id, status: 'open',
    })
    const target = openOps[openOps.length - 1] || null
    if (!target) return 'No open opportunity to note'
    createCrmOpportunityNote({
      opportunity_id: target.id,
      workspace_id: run.workspace_id,
      body,
    })
    return `Note added to "${target.name}"`
  }

  if (node.type === 'assign_contact') {
    // Sets the contact owner, which is how the inbox + Today view route
    // conversation ownership.
    const userId = Number(node.config?.user_id)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Assignee user id is required')
    updateCrmContact(contact.id, run.workspace_id, { owner_id: userId })
    const updatedContact = getCrmContactById(contact.id, run.workspace_id)
    if (updatedContact) {
      queueCrmWorkflowRunsForContactChange({
        workspaceId: run.workspace_id,
        beforeContact: contact,
        afterContact: updatedContact,
      })
    }
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow assigned conversation to user #${userId}`,
    })
    return `Assigned conversation to user #${userId}`
  }

  if (node.type === 'add_to_workflow') {
    // Enroll this contact into another workflow mid-run. The target workflow
    // still honours its own allow_reentry setting via queueCrmWorkflowRunsForTrigger's
    // hasActiveCrmWorkflowRun guard handled in createCrmWorkflowRun-path, but we
    // enqueue directly to bypass trigger matching (the user explicitly asked).
    const targetWorkflowId = Number(node.config?.workflow_id)
    if (!Number.isInteger(targetWorkflowId) || targetWorkflowId <= 0) throw new Error('Target workflow id is required')
    const targetWorkflow = getCrmWorkflowById(targetWorkflowId, run.workspace_id)
    if (!targetWorkflow) throw new Error(`Workflow #${targetWorkflowId} not found`)
    if (!targetWorkflow.is_active_bool) {
      return `Target workflow "${targetWorkflow.name}" is paused — skipped`
    }
    createCrmWorkflowRun({
      workflow_id: targetWorkflow.id,
      workspace_id: run.workspace_id,
      contact_id: contact.id,
      next_node_id: null,
      run_at: Math.floor(Date.now() / 1000),
      status: 'queued',
    })
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow enrolled contact in "${targetWorkflow.name}"`,
    })
    return `Enrolled in "${targetWorkflow.name}"`
  }

  if (node.type === 'enroll_in_drip') {
    const sequenceId = Number(node.config?.sequence_id)
    if (!Number.isInteger(sequenceId) || sequenceId <= 0) throw new Error('Drip sequence id is required')
    const seq = getCrmDripSequenceById(sequenceId, run.workspace_id)
    if (!seq) throw new Error(`Drip sequence #${sequenceId} not found`)
    const result = enrollContactInDrip(sequenceId, contact.id, run.workspace_id)
    if (!result.enrolled) {
      return `Skipped drip enrollment: ${result.reason || 'unknown'}`
    }
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow enrolled contact in drip "${seq.name}"`,
    })
    return `Enrolled in drip "${seq.name}"`
  }

  if (node.type === 'send_internal_notification') {
    const channel = String(node.config?.channel || '').trim()
    const userId = Number(node.config?.user_id)
    const subject = applyWorkflowTemplate(String(node.config?.subject || '').trim(), run, contact)
    const message = applyWorkflowTemplate(String(node.config?.message || '').trim(), run, contact)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Recipient user id is required')
    if (!message.trim()) throw new Error('Message body is required')
    if (channel === 'email') {
      const recipient = getUserEmailById(userId)
      if (!recipient) throw new Error(`User #${userId} has no email on file`)
      const workspace = getWorkspaceById(run.workspace_id)
      const senderUserId = workspace?.owner_id || userId
      const result = await sendEmail(
        senderUserId,
        recipient,
        subject || `Workflow notification from "${run.workflow_name}"`,
        `<p>${message.replace(/\n/g, '<br>')}</p>`,
      )
      if (!result.success) throw new Error(`Internal email send failed: ${result.error || 'unknown error'}`)
      return `Emailed user #${userId}`
    }
    if (channel === 'sms' || channel === 'app') {
      // Internal SMS/app push requires Twilio/push provider not yet wired — log
      // so the operator sees the request and can follow up manually.
      createCrmContactActivity({
        contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
        body: `Workflow requested internal ${channel} to user #${userId}: ${message}`,
      })
      return `Logged internal ${channel} request (provider not connected yet)`
    }
    throw new Error(`Unknown notification channel: ${channel}`)
  }

  if (node.type === 'send_survey') {
    const channel = (node.config?.channel === 'sms' ? 'sms' : 'email') as 'sms' | 'email'
    const surveyPublicId = String(node.config?.survey_id || '').trim()
    const rawMessage = String(node.config?.message || '').trim()
    const rawSubject = String(node.config?.subject || '').trim() || 'Quick feedback?'
    if (!surveyPublicId) throw new Error('Survey public id is required')
    if (!rawMessage) throw new Error('Survey message is required')

    const sendResult = await sendSurveyLinkMessage({
      workspaceId: run.workspace_id,
      contact,
      surveyPublicId,
      channel,
      messageTemplate: applyWorkflowTemplate(rawMessage, run, contact),
      subjectTemplate: channel === 'email' ? applyWorkflowTemplate(rawSubject, run, contact) : null,
      activityLabel: `Workflow survey sent`,
    })
    if (sendResult.outcome === 'skipped') return sendResult.detail
    return `Survey sent via ${channel}`
  }

  if (node.type === 'approve_affiliate') {
    const affiliate = getCrmAffiliateByContactId(contact.id, run.workspace_id)
    if (!affiliate) return 'No affiliate linked to this contact'
    if (affiliate.status === 'active') return `Affiliate "${affiliate.name}" is already active`
    updateCrmAffiliate(affiliate.id, run.workspace_id, { status: 'active' })
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `Workflow approved affiliate "${affiliate.name}"`,
    })
    return `Approved affiliate "${affiliate.name}"`
  }

  if (node.type === 'pay_affiliate_payout') {
    const affiliate = getCrmAffiliateByContactId(contact.id, run.workspace_id)
    if (!affiliate) return 'No affiliate linked to this contact'
    const payout = listCrmAffiliatePayouts(run.workspace_id, { affiliateId: affiliate.id, status: 'pending', limit: 1 })[0]
      || listCrmAffiliatePayouts(run.workspace_id, { affiliateId: affiliate.id, status: 'processing', limit: 1 })[0]
    if (!payout) return 'No pending payout to mark paid'
    const externalRef = String(node.config?.external_ref || '').trim() || payout.external_ref || null
    updateCrmAffiliatePayout(payout.id, run.workspace_id, { status: 'paid', external_ref: externalRef })
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `Workflow marked affiliate payout paid for ${payout.period_start.slice(0, 10)} to ${payout.period_end.slice(0, 10)}`,
    })
    return `Marked payout paid for "${affiliate.name}"`
  }

  if (node.type === 'ai_draft_email') {
    const promptIdRaw = Number(node.config?.prompt_id)
    const promptId = Number.isInteger(promptIdRaw) && promptIdRaw > 0 ? promptIdRaw : null
    const saveTemplateIdRaw = Number(node.config?.save_to_template_id)
    const saveTemplateId = Number.isInteger(saveTemplateIdRaw) && saveTemplateIdRaw > 0 ? saveTemplateIdRaw : null
    const goal = applyWorkflowTemplate(String(node.config?.goal || value || 'Write a follow-up email for this contact'), run, contact).trim()
    if (!goal) throw new Error('Goal is required')
    const offer = applyWorkflowTemplate(String(node.config?.offer || ''), run, contact).trim()
    const cta = applyWorkflowTemplate(String(node.config?.cta || ''), run, contact).trim()
    const extraContext = applyWorkflowTemplate(String(node.config?.context_text || ''), run, contact).trim()
    const audience = [contact.name, contact.company, contact.job_title].filter(Boolean).join(' | ') || 'CRM contact'
    const contextText = [
      extraContext,
      contact.notes?.trim() ? `Contact notes: ${contact.notes.trim()}` : '',
      contact.source ? `Lead source: ${contact.source}` : '',
      contact.lifecycle_stage ? `Lifecycle stage: ${contact.lifecycle_stage}` : '',
      contact.pipeline_stage_name ? `Pipeline stage: ${contact.pipeline_stage_name}` : '',
      cta ? `CTA: ${cta}` : '',
    ].filter(Boolean).join('\n')
    const result = await generateCrmAiText({
      workspaceId: run.workspace_id,
      userId: null,
      category: 'email',
      promptId,
      context: {
        goal,
        audience,
        offer,
        cta,
        context_text: contextText,
        contact_name: contact.name,
        first_name: contact.name.split(/\s+/)[0] || contact.name,
        company: contact.company || '',
        job_title: contact.job_title || '',
        source: contact.source || '',
        lifecycle_stage: contact.lifecycle_stage || '',
        workflow_name: run.workflow_name || '',
        tags: contact.tags_list,
      },
    })
    const parsed = parseEmailDraftText(result.text)
    const subject = parsed.subject || `Draft for ${contact.name}`
    const bodyText = parsed.body || result.text
    const bodyHtml = renderPlainTextEmailHtml(bodyText)
    const template = saveTemplateId
      ? updateCrmMessageTemplate(saveTemplateId, run.workspace_id, {
          channel: 'email',
          subject,
          body: bodyHtml,
          category: 'ai_draft',
        })
      : createCrmMessageTemplate(run.workspace_id, {
          name: `AI draft ${contact.name} ${new Date().toISOString().slice(0, 10)}`,
          channel: 'email',
          subject,
          body: bodyHtml,
          category: 'ai_draft',
        })
    if (!template) throw new Error('Failed to save AI draft template')
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'email',
      body: `Workflow saved AI email draft "${subject}" to template #${template.id}`,
    })
    writeAuditLog({
      workspaceId: run.workspace_id,
      userId: null,
      entity: 'crm_message_template',
      entityId: template.id,
      action: saveTemplateId ? 'workflow_ai_draft_updated' : 'workflow_ai_draft_created',
      summary: `Workflow saved AI email draft for ${contact.name}`,
      payload: {
        workflow_id: run.workflow_id,
        workflow_name: run.workflow_name,
        contact_id: contact.id,
        prompt_id: promptId,
      },
    })
    notifyContactOwner(run.workspace_id, contact.id, 'ai_handoff', (currentContact) => ({
      title: 'AI drafted an email template',
      body: `Workflow "${run.workflow_name}" saved a draft for ${currentContact.name}.`,
      href: '/crm/templates',
      entity: 'crm_message_template',
      entity_id: template.id,
    }))
    return `Saved AI draft template #${template.id}`
  }

  if (node.type === 'update_task' || node.type === 'complete_task') {
    const matchTitle = String(node.config?.match_title || '').trim().toLowerCase()
    const tasks = getTasks({ workspaceId: run.workspace_id })
    const candidate = tasks.find((t) => {
      if (t.status === 'done' || t.status === 'cancelled' || t.status === 'archived') return false
      if (!matchTitle) return true
      return (t.title || '').toLowerCase().includes(matchTitle)
    })
    if (!candidate) return 'No matching open task'
    const patch: Record<string, unknown> = { updated_at: Math.floor(Date.now() / 1000) }
    if (node.type === 'complete_task') {
      patch.status = 'done'
      patch.completed_at = Math.floor(Date.now() / 1000)
    } else {
      const priority = String(node.config?.priority || '').trim().toLowerCase()
      const status = String(node.config?.status || '').trim().toLowerCase()
      const dueDate = String(node.config?.due_date || '').trim()
      if (priority) patch.priority = priority
      if (status) patch.status = status
      if (dueDate) patch.due_date = dueDate
    }
    updateTask(candidate.id, patch)
    createTaskActivity(candidate.id, 'comment',
      node.type === 'complete_task'
        ? `Completed by workflow "${run.workflow_name}"`
        : `Updated by workflow "${run.workflow_name}"`,
    )
    return node.type === 'complete_task'
      ? `Completed task "${candidate.title}"`
      : `Updated task "${candidate.title}"`
  }

  if (node.type === 'remove_from_workflow') {
    const targetWorkflowId = Number(node.config?.workflow_id) || 0
    const stopAll = parseBool(node.config?.stop_all)
    const dueRuns = getDueCrmWorkflowRuns(Math.floor(Date.now() / 1000) + 31_536_000, 500) // broad fetch
    let cancelled = 0
    for (const r of dueRuns) {
      if (r.workspace_id !== run.workspace_id) continue
      if (r.contact_id !== contact.id) continue
      if (r.id === run.id) continue
      if (!stopAll && r.workflow_id !== targetWorkflowId) continue
      updateCrmWorkflowRun(r.id, { status: 'completed', next_node_id: null, last_error: 'Cancelled by another workflow' })
      cancelled += 1
    }
    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: stopAll
        ? `Workflow cancelled ${cancelled} other active runs for this contact`
        : `Workflow cancelled ${cancelled} run(s) of workflow #${targetWorkflowId}`,
    })
    return `Cancelled ${cancelled} other run(s)`
  }

  if (node.type === 'voicemail_drop') {
    const integration = getWorkspaceIntegration(run.workspace_id, 'twilio')
    if (!integration?.is_active) return 'Skipped — Twilio integration not connected'
    const accountSid = integration.config.account_sid
    const authToken = integration.config.auth_token
    const fromNumber = String(node.config?.from_number || integration.config.from_number || '').trim()
    const recordingUrl = String(node.config?.recording_url || '').trim()
    const to = String(contact.phone || '').trim()
    if (!accountSid || !authToken) return 'Skipped — Twilio credentials missing'
    if (!fromNumber) throw new Error('From number is required')
    if (!recordingUrl) throw new Error('Recording URL is required')
    if (!to) throw new Error('Contact has no phone number')
    if (contact.dnd_calls) return 'Skipped — contact has DND calls on'

    // AMD flow: Twilio calls us at /api/webhooks/twilio/amd with AnsweredBy
    // once answering-machine detection resolves. The route returns TwiML that
    // either plays the recording (machine_end_beep/silence) or hangs up.
    // We pass recording_url in the query string so the webhook is stateless.
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || getSetting('app_base_url') || '').toString().replace(/\/+$/, '') || 'https://app.example.com'
    const amdUrl = `${baseUrl}/api/webhooks/twilio/amd?recording_url=${encodeURIComponent(recordingUrl)}`

    const body = new URLSearchParams({
      To: to,
      From: fromNumber,
      Url: amdUrl,
      MachineDetection: 'DetectMessageEnd',
      AsyncAmd: 'false',
    })

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Twilio responded ${response.status}: ${text.slice(0, 160)}`)
    }
    let callSid: string | null = null
    try {
      const payload = await response.json() as { sid?: string }
      if (typeof payload.sid === 'string') callSid = payload.sid
    } catch { /* ignore */ }

    // Log the outbound call — the AMD route updates status when it answers.
    try {
      createCrmCallLog({
        workspace_id: run.workspace_id,
        contact_id: contact.id,
        twilio_call_sid: callSid,
        from_number: fromNumber,
        to_number: to,
        direction: 'outbound',
        status: 'queued',
        source_label: 'voicemail_drop',
      })
    } catch { /* ignore */ }

    createCrmContactActivity({
      contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
      body: `Workflow queued voicemail drop to ${to}`,
    })
    return `Voicemail drop queued to ${to}`
  }

  if (node.type === 'google_analytics_event') {
    const integration = getWorkspaceIntegration(run.workspace_id, 'google_analytics')
    if (!integration?.is_active) return 'Skipped — Google Analytics integration not connected'
    const measurementId = integration.config.measurement_id
    const apiSecret = integration.config.api_secret
    if (!measurementId || !apiSecret) return 'Skipped — measurement_id and api_secret missing'
    const eventName = String(node.config?.event_name || '').trim()
    if (!eventName) throw new Error('GA4 event_name is required')
    const clientId = `ctrlmotion.${contact.id}`
    const params: Record<string, unknown> = {}
    if (node.config?.value !== undefined) params.value = Number(node.config.value)
    try {
      const response = await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, events: [{ name: eventName, params }] }),
        },
      )
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`GA4 responded ${response.status}: ${text.slice(0, 120)}`)
      }
      createCrmContactActivity({
        contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
        body: `Workflow fired GA4 event "${eventName}"`,
      })
      return `GA4 event "${eventName}" fired`
    } catch (error) {
      throw new Error(`GA4 send failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  if (node.type === 'facebook_pixel_event') {
    const integration = getWorkspaceIntegration(run.workspace_id, 'facebook_pixel')
    if (!integration?.is_active) return 'Skipped — Facebook Pixel integration not connected'
    const pixelId = integration.config.pixel_id
    const accessToken = integration.config.access_token
    if (!pixelId || !accessToken) return 'Skipped — pixel_id and access_token missing'
    const eventName = String(node.config?.event_name || '').trim()
    if (!eventName) throw new Error('Facebook Pixel event_name is required')
    const eventData: Record<string, unknown> = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {
        em: contact.email ? [await sha256Lower(contact.email)] : undefined,
        ph: contact.phone ? [await sha256Lower(contact.phone)] : undefined,
      },
    }
    const customData: Record<string, unknown> = {}
    if (node.config?.value !== undefined) customData.value = Number(node.config.value)
    if (node.config?.currency) customData.currency = String(node.config.currency)
    if (Object.keys(customData).length > 0) eventData.custom_data = customData
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: [eventData] }),
        },
      )
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`Facebook responded ${response.status}: ${text.slice(0, 200)}`)
      }
      createCrmContactActivity({
        contactId: contact.id, workspaceId: run.workspace_id, type: 'note',
        body: `Workflow fired Facebook Pixel event "${eventName}"`,
      })
      return `Pixel event "${eventName}" fired`
    } catch (error) {
      throw new Error(`Facebook Pixel send failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  if (node.type === 'send_contract') {
    const templateId = Number(node.config?.template_id)
    if (!templateId || Number.isNaN(templateId)) throw new Error('send_contract requires template_id')

    const requestedContactId = Number(node.config?.contact_id)
    const targetContact = Number.isInteger(requestedContactId) && requestedContactId > 0
      ? getCrmContactById(requestedContactId, run.workspace_id)
      : contact
    if (!targetContact) throw new Error('send_contract could not resolve contact')
    if (!targetContact.email) return 'Skipped — contact has no email to send a contract to'

    const {
      createCrmContract,
      getCrmContractTemplateById,
      markCrmContractSent,
      mergeContractBodyToHtml,
      getWorkspaceById,
    } = await import('@/lib/db')
    const template = getCrmContractTemplateById(templateId, run.workspace_id)
    if (!template) throw new Error(`send_contract: template ${templateId} not found`)

    const title = String(node.config?.title || template.name).trim() || template.name
    const expiresDays = Number(node.config?.expires_in_days)
    const expiresAt = Number.isFinite(expiresDays) && expiresDays > 0
      ? new Date(Date.now() + Math.floor(expiresDays * 86_400_000)).toISOString()
      : null

    const created = createCrmContract(run.workspace_id, null, {
      title,
      template_id: template.id,
      body_html: template.body_html,
      contact_id: targetContact.id,
      expires_at: expiresAt,
    })
    writeAuditLog({
      workspaceId: run.workspace_id,
      entity: 'crm_contract',
      entityId: created.id,
      action: 'created',
      summary: `Workflow drafted contract "${created.title}"`,
    })

    const workspace = getWorkspaceById(run.workspace_id)
    const merged = mergeContractBodyToHtml(created.body_html, {
      contact: {
        name: targetContact.name,
        email: targetContact.email,
        phone: targetContact.phone,
        company: targetContact.company,
      },
      workspace: { name: workspace?.name ?? null },
    })
    const subject = `Signature requested: ${title}`
    const sent = markCrmContractSent(created.id, run.workspace_id, {
      subject,
      expires_at: expiresAt,
      merged_html: merged,
    })
    if (!sent) throw new Error('send_contract could not load sent contract')

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || getSetting('app_base_url') || '').toString().replace(/\/+$/, '') || 'https://app.example.com'
    const signUrl = `${baseUrl}/c/${sent.public_token}`
    const workspaceName = workspace?.name || 'Your team'
    const expiresLine = sent.expires_at
      ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#5c5850;">This contract expires on ${new Date(sent.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.</p>`
      : ''
    const emailHtml = `
      <div style="background:#f2efe8;padding:32px 18px;font-family:Geist Sans,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1b19;">
        <div style="max-width:620px;margin:0 auto;background:#fbf8f1;border:1px solid rgba(60,45,20,0.1);border-radius:16px;padding:32px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8478;font-family:'JetBrains Mono',ui-monospace,monospace;">Contract</div>
          <h1 style="margin:10px 0 8px;font-size:28px;line-height:1.1;">${title}</h1>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#5c5850;">${workspaceName} requested your signature. Review the agreement and sign online.</p>
          <div style="margin-top:22px;">
            <a href="${signUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#D97757;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">Review and sign</a>
          </div>
          ${expiresLine}
          <p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:#8a8478;">If the button does not work, open ${signUrl}</p>
        </div>
      </div>
    `
    const senderUserId = workspace?.owner_id || targetContact.owner_id || 1
    const sendResult = await sendEmail(senderUserId, targetContact.email, subject, emailHtml)
    if (!sendResult.success) throw new Error(sendResult.error || 'Contract email failed to send')

    writeAuditLog({
      workspaceId: run.workspace_id,
      entity: 'crm_contract',
      entityId: sent.id,
      action: 'sent',
      summary: `Workflow sent contract "${sent.title}" to ${targetContact.email}`,
    })
    queueCrmWorkflowRunsForTrigger({
      workspaceId: run.workspace_id,
      contactId: targetContact.id,
      triggerType: 'contract_sent',
    })
    return `Contract "${title}" sent to ${targetContact.email}`
  }

  if (node.type === 'cancel_appointment') {
    const calendarIdRaw = Number(node.config?.calendar_id)
    const calendarId = Number.isFinite(calendarIdRaw) && calendarIdRaw > 0 ? calendarIdRaw : null
    const reasonTemplate = String(node.config?.reason || '').trim()
    const reason = applyWorkflowTemplate(reasonTemplate, run, contact).trim()
    const appointment = getNextUpcomingCrmAppointmentForContact(run.workspace_id, contact.id, calendarId)
    if (!appointment) return 'No upcoming appointment to cancel'
    const updated = updateCrmAppointmentStatus(appointment.id, run.workspace_id, 'cancelled')
    if (!updated) throw new Error('Failed to cancel appointment')
    const when = new Date(appointment.starts_at * 1000).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: reason
        ? `Workflow cancelled appointment on ${when}: ${reason}`
        : `Workflow cancelled appointment on ${when}`,
    })
    queueCrmWorkflowRunsForTrigger({
      workspaceId: run.workspace_id,
      contactId: contact.id,
      triggerType: 'appointment_cancelled',
    })
    return `Cancelled appointment on ${when}`
  }

  if (node.type === 'manual_call_task') {
    const userIdRaw = String(node.config?.user_id || '').trim()
    if (!userIdRaw) throw new Error('Assignee is required for manual call task')
    const scriptTemplate = String(node.config?.script || '').trim()
    const script = applyWorkflowTemplate(scriptTemplate, run, contact).trim()
    const dueDate = String(node.config?.due_date || '').trim()
    const firstName = (contact.name || '').trim().split(/\s+/)[0] || contact.email || 'contact'
    const phoneLine = contact.phone ? ` (${contact.phone})` : ''
    const title = `Call ${firstName}${phoneLine}`
    const descriptionLines = [script, contact.phone ? `Phone: ${contact.phone}` : null, contact.email ? `Email: ${contact.email}` : null]
      .filter((line): line is string => Boolean(line && line.length))
    const task = createTask({
      title,
      workspaceId: run.workspace_id,
      crmContactId: contact.id,
      projectId: ensureOutreachProject(run.workspace_id).id,
      description: descriptionLines.join('\n\n') || undefined,
      due_date: dueDate || undefined,
      priority: 'high',
      status: 'todo',
      assignee: userIdRaw,
      duration_minutes: 15,
    })
    createTaskActivity(task.id, 'comment', `Workflow "${run.workflow_name}" queued a call-back task`)
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'task',
      body: `Workflow queued call task: ${task.title}`,
    })
    return `Created call task "${task.title}"`
  }

  if (node.type === 'send_calendar_link') {
    const calendarId = Number(node.config?.calendar_id)
    if (!Number.isInteger(calendarId) || calendarId <= 0) throw new Error('Calendar id is required')
    const calendar = getCrmCalendarById(calendarId, run.workspace_id)
    if (!calendar) throw new Error(`Calendar #${calendarId} not found in this workspace`)
    if (!calendar.is_active) return `Booking link skipped — calendar "${calendar.name}" is inactive`

    const channel = (node.config?.channel === 'sms' ? 'sms' : 'email') as 'sms' | 'email'
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || getSetting('app_base_url') || '').toString().replace(/\/+$/, '') || 'https://app.example.com'
    const bookingLink = `${baseUrl}/b/${calendar.public_id}`
    const firstName = (contact.name || '').trim().split(/\s+/)[0] || ''
    const rawMessage = String(node.config?.message || 'Book a time: {{booking_link}}').trim() || 'Book a time: {{booking_link}}'
    const rawSubject = String(node.config?.subject || '').trim() || `Book a time with us`
    const rendered = applyWorkflowTemplate(rawMessage, run, contact)
      .replace(/\{\{\s*booking_link\s*\}\}/g, bookingLink)
      .replace(/\{\{\s*booking_page_name\s*\}\}/g, calendar.name)
      .replace(/\{\{\s*contact_first_name\s*\}\}/g, firstName)

    if (channel === 'sms') {
      if (contact.dnd_sms || contact.unsubscribed) return 'Booking link skipped — contact has SMS DND or unsubscribed'
      if (!contact.phone) return 'Booking link skipped — no phone on contact'
      const integration = getWorkspaceIntegration(run.workspace_id, 'twilio')
      const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
      const authToken  = String(integration?.config.auth_token  || getSetting('twilio_auth_token')  || '').trim()
      const fromPhone  = String(integration?.config.from_number || getSetting('twilio_phone_number') || '').trim()
      if (!accountSid || !authToken || !fromPhone) return 'Booking link queued — Twilio not connected'
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: contact.phone, From: fromPhone, Body: rendered }),
      })
      if (!res.ok) throw new Error(`Twilio rejected booking link SMS: ${await res.text()}`)
      createSmsMessage({
        contact_id: contact.id,
        direction: 'outbound',
        body: rendered,
        from_phone: fromPhone,
        to_phone: contact.phone,
      })
    } else {
      if (contact.dnd_email || contact.unsubscribed) return 'Booking link skipped — contact has email DND or unsubscribed'
      if (!contact.email) return 'Booking link skipped — no email on contact'
      const workspace = getWorkspaceById(run.workspace_id)
      const senderUserId = workspace?.owner_id || contact.owner_id || 1
      const subject = applyWorkflowTemplate(rawSubject, run, contact)
      const emailHtml = `
        <div style="background:#f2efe8;padding:32px 18px;font-family:Geist Sans,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1b19;">
          <div style="max-width:560px;margin:0 auto;background:#fbf8f1;border:1px solid rgba(60,45,20,0.1);border-radius:16px;padding:32px;">
            <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8478;font-family:'JetBrains Mono',ui-monospace,monospace;">${calendar.name}</div>
            <p style="margin:14px 0 18px;font-size:14px;line-height:1.7;color:#1c1b19;">${rendered.replace(/\n/g, '<br>')}</p>
            <a href="${bookingLink}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#D97757;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">Book a time</a>
            <p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:#8a8478;">If the button does not work, open ${bookingLink}</p>
          </div>
        </div>
      `
      const result = await sendEmail(senderUserId, contact.email, subject, emailHtml)
      if (!result.success) throw new Error(`Booking link email failed: ${result.error || 'unknown error'}`)
    }

    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: channel === 'sms' ? 'sms' : 'email',
      body: `Booking link sent (${channel}): ${bookingLink}`,
    })
    return `Booking link sent via ${channel}`
  }

  if (node.type === 'facebook_audience_add' || node.type === 'facebook_audience_remove') {
    const audienceId = String(node.config?.audience_id || '').trim()
    if (!audienceId) throw new Error('Facebook audience id is required')
    if (!/^\d+$/.test(audienceId)) throw new Error('Facebook audience id must be numeric')
    if (!contact.email && !contact.phone) {
      return 'Audience sync skipped — contact has no email or phone'
    }
    const { addContactToCustomAudience, removeContactFromCustomAudience } = await import('@/lib/meta-campaign-api')
    const matchInput = { email: contact.email, phone: contact.phone }
    const result = node.type === 'facebook_audience_add'
      ? await addContactToCustomAudience(audienceId, matchInput)
      : await removeContactFromCustomAudience(audienceId, matchInput)
    const received = Number((result as { num_received?: number }).num_received ?? 0)
    const invalid = Number((result as { num_invalid_entries?: number }).num_invalid_entries ?? 0)
    const verb = node.type === 'facebook_audience_add' ? 'Added to' : 'Removed from'
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `${verb} Facebook audience #${audienceId} (received=${received}, invalid=${invalid})`,
    })
    if (invalid > 0 && received === 0) {
      throw new Error(`Meta rejected the identity payload for audience #${audienceId} (${invalid} invalid entries)`)
    }
    return `${verb} Facebook audience #${audienceId}`
  }

  if (node.type === 'create_invoice_from_products' || node.type === 'send_invoice') {
    const dueDaysRaw = Number(node.config?.due_days)
    const dueDays = Number.isFinite(dueDaysRaw) && dueDaysRaw > 0 ? Math.min(365, Math.floor(dueDaysRaw)) : null
    const dueDate = dueDays ? Math.floor(Date.now() / 1000) + dueDays * 86_400 : null

    const lineItems: CrmInvoiceLineItemInput[] = []
    let currency: string | undefined

    if (node.type === 'create_invoice_from_products') {
      const raw = String(node.config?.product_ids ?? '').trim()
      if (!raw) throw new Error('create_invoice_from_products requires product_ids')
      const productIds = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
      if (productIds.length === 0) throw new Error('No valid product ids parsed')
      for (const pid of productIds) {
        const product = getCrmProductById(pid, run.workspace_id)
        if (!product) throw new Error(`Product #${pid} not found`)
        lineItems.push({
          product_id: product.id,
          description: product.name,
          quantity: 1,
          unit_amount_cents: product.amount_cents,
          tax_rate_bps: product.tax_rate_bps,
        })
        if (!currency) currency = product.currency
      }
    } else {
      const productIdRaw = Number(String(node.config?.product_id ?? '').trim())
      const amountOverride = Number(node.config?.amount_cents)
      const description = String(node.config?.description ?? '').trim()
      let amountCents: number | null = null
      let lineDescription = description
      if (Number.isInteger(productIdRaw) && productIdRaw > 0) {
        const product = getCrmProductById(productIdRaw, run.workspace_id)
        if (!product) throw new Error(`Product #${productIdRaw} not found`)
        amountCents = product.amount_cents
        if (!lineDescription) lineDescription = product.name
        currency = product.currency
        lineItems.push({
          product_id: product.id,
          description: lineDescription,
          quantity: 1,
          unit_amount_cents: amountCents,
          tax_rate_bps: product.tax_rate_bps,
        })
      } else {
        if (!Number.isFinite(amountOverride) || amountOverride <= 0) {
          throw new Error('send_invoice requires a product_id or a positive amount_cents')
        }
        if (!lineDescription) lineDescription = 'Invoice'
        lineItems.push({
          product_id: null,
          description: lineDescription,
          quantity: 1,
          unit_amount_cents: Math.round(amountOverride),
        })
      }
    }

    const invoice = createCrmInvoice(run.workspace_id, {
      contact_id: contact.id,
      currency,
      due_date: dueDate,
      notes: node.type === 'create_invoice_from_products' ? (String(node.config?.notes ?? '') || null) : null,
      line_items: lineItems,
    })

    writeAuditLog({
      workspaceId: run.workspace_id,
      entity: 'crm_invoice',
      entityId: invoice.id,
      action: 'created',
      summary: `Workflow created invoice ${invoice.number} for ${contact.name || contact.email || `contact #${contact.id}`}`,
      payload: { workflow_run_id: run.id, workflow_id: run.workflow_id, source: 'workflow' },
    })
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `Workflow created invoice ${invoice.number} (${invoice.currency} ${(invoice.total_cents / 100).toFixed(2)})`,
    })

    const sendImmediately = node.type === 'send_invoice' && String(node.config?.send_immediately ?? 'true') !== 'false'
    if (sendImmediately) {
      const recipient = contact.email?.trim()
      if (!recipient) {
        return `Invoice ${invoice.number} created (skipped email — contact has no email)`
      }
      const baseUrl = process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const publicUrl = `${baseUrl.replace(/\/$/, '')}/pay/${invoice.public_token || invoice.public_id}`
      const dueLabel = invoice.due_date ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10) : null
      const amount = `${invoice.currency} ${(invoice.total_cents / 100).toFixed(2)}`
      const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f3f0ec;padding:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e2dc;border-radius:8px;">
<tr><td style="padding:32px;">
<div style="font-size:12px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">Invoice</div>
<h1 style="margin:0 0 16px;font-size:24px;color:#111;">${invoice.number}</h1>
<p style="color:#374151;line-height:1.5;margin:0 0 24px;">You have a new invoice for <strong>${amount}</strong>${dueLabel ? `, due <strong>${dueLabel}</strong>` : ''}.</p>
<a href="${publicUrl}" style="display:inline-block;padding:12px 20px;background:#D97757;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">View &amp; pay invoice</a>
<p style="color:#6b7280;font-size:12px;margin-top:24px;">Or copy this link: ${publicUrl}</p>
</td></tr></table></body></html>`
      const subject = `Invoice ${invoice.number} - ${amount}`
      const senderUserId = getWorkspaceById(run.workspace_id)?.owner_id || contact.owner_id || 1
      const result = await sendEmail(senderUserId, recipient, subject, html)
      if (!result.success) {
        throw new Error(`Invoice ${invoice.number} created but email send failed: ${result.error || 'unknown error'}`)
      }
      const nowSec = Math.floor(Date.now() / 1000)
      updateCrmInvoice(invoice.id, run.workspace_id, {
        sent_at: nowSec,
        issued_at: nowSec,
        status: 'sent',
      })
      try {
        queueCrmWorkflowRunsForTrigger({
          workspaceId: run.workspace_id,
          contactId: contact.id,
          triggerType: 'invoice_sent',
          triggerValue: null,
        })
      } catch { /* noop */ }
      return `Invoice ${invoice.number} sent to ${recipient}`
    }

    return `Invoice ${invoice.number} drafted (${invoice.currency} ${(invoice.total_cents / 100).toFixed(2)})`
  }

  if (node.type === 'mark_invoice_paid') {
    const invoiceIdRaw = Number(String(node.config?.invoice_id ?? '').trim())
    if (!Number.isInteger(invoiceIdRaw) || invoiceIdRaw <= 0) {
      throw new Error('mark_invoice_paid requires invoice_id')
    }
    const invoice = getCrmInvoiceById(invoiceIdRaw, run.workspace_id)
    if (!invoice) throw new Error(`Invoice #${invoiceIdRaw} not found`)
    if (invoice.voided_at) throw new Error(`Invoice ${invoice.number} is voided`)
    if (invoice.amount_due_cents <= 0) return `Invoice ${invoice.number} already has no balance due`

    const method = String(node.config?.method ?? 'other').trim() as CrmPaymentMethod
    const externalRef = String(node.config?.external_ref ?? '').trim() || null
    const payment = createCrmPayment(run.workspace_id, {
      invoice_id: invoice.id,
      contact_id: invoice.contact_id,
      amount_cents: invoice.amount_due_cents,
      currency: invoice.currency,
      method,
      status: 'succeeded',
      external_ref: externalRef,
      memo: `Marked paid by workflow run #${run.id}`,
      created_by: null,
    })
    writeAuditLog({
      workspaceId: run.workspace_id,
      entity: 'crm_invoice',
      entityId: invoice.id,
      action: 'mark_paid',
      summary: `Workflow marked invoice ${invoice.number} paid`,
      payload: { payment_id: payment.id, method, workflow_run_id: run.id },
    })
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `Workflow marked invoice ${invoice.number} paid (${method})`,
    })
    if (invoice.contact_id) {
      try {
        queueCrmWorkflowRunsForTrigger({
          workspaceId: run.workspace_id,
          contactId: invoice.contact_id,
          triggerType: 'payment_received',
          triggerValue: null,
        })
      } catch { /* noop */ }
      try {
        queueCrmWorkflowRunsForTrigger({
          workspaceId: run.workspace_id,
          contactId: invoice.contact_id,
          triggerType: 'invoice_paid',
          triggerValue: null,
        })
      } catch { /* noop */ }
    }
    return `Marked invoice ${invoice.number} paid`
  }

  if (node.type === 'book_appointment') {
    const rawCalendarId = String(node.config?.calendar_id ?? '').trim()
    if (!rawCalendarId) throw new Error('Calendar id is required')
    let calendar = null as ReturnType<typeof getCrmCalendarById>
    const numericId = Number(rawCalendarId)
    if (Number.isInteger(numericId) && numericId > 0) {
      calendar = getCrmCalendarById(numericId, run.workspace_id)
    }
    if (!calendar) {
      calendar = getCrmCalendars(run.workspace_id).find((c) => c.public_id === rawCalendarId || c.slug === rawCalendarId) ?? null
    }
    if (!calendar) throw new Error(`Calendar not found: ${rawCalendarId}`)
    if (!calendar.is_active) return `Booking skipped — calendar "${calendar.name}" is inactive`

    const horizonDays = 14
    const nowSec = Math.floor(Date.now() / 1000)
    const { findNextAvailableSlot } = await import('@/lib/calendar-sync')
    const slot = await findNextAvailableSlot(calendar, nowSec, horizonDays)
    if (!slot) {
      createCrmContactActivity({
        contactId: contact.id,
        workspaceId: run.workspace_id,
        type: 'note',
        body: `Auto-book skipped — no available slot in "${calendar.name}" within ${horizonDays} days`,
      })
      return `Booking skipped — no slot free within ${horizonDays} days`
    }

    let assignedUserId: number | null = null
    let coHostIds: number[] = []
    if (calendar.booking_mode === 'round_robin') {
      assignedUserId = pickRoundRobinHost(calendar.id, slot.freeHostIds, calendar.round_robin_strategy)
      if (!assignedUserId) throw new Error('Round-robin slot found but no host resolved')
    } else if (calendar.booking_mode === 'collective') {
      assignedUserId = slot.freeHostIds[0] ?? null
      coHostIds = slot.freeHostIds.slice(1)
    } else if (calendar.owner_id) {
      assignedUserId = calendar.owner_id
    }

    const appointment = createCrmAppointment({
      calendar_id: calendar.id,
      workspace_id: run.workspace_id,
      contact_id: contact.id,
      starts_at: slot.startsSec,
      ends_at: slot.endsSec,
      notes: `Auto-booked by workflow run #${run.id}`,
      assigned_user_id: assignedUserId,
    })

    if (coHostIds.length > 0) addCrmBookingAttendees(appointment.id, coHostIds)
    if (assignedUserId) {
      updateCrmContact(contact.id, run.workspace_id, { owner_id: assignedUserId })
    }

    writeAuditLog({
      workspaceId: run.workspace_id,
      userId: null,
      entity: 'crm_appointment',
      entityId: appointment.id,
      action: 'booking_created',
      summary: `Auto-booked via workflow (${calendar.booking_mode})`,
      payload: {
        booking_mode: calendar.booking_mode,
        assigned_user_id: assignedUserId,
        co_host_user_ids: coHostIds,
        calendar_public_id: calendar.public_id,
        workflow_run_id: run.id,
      },
    })

    queueCrmWorkflowRunsForTrigger({
      workspaceId: run.workspace_id,
      contactId: contact.id,
      triggerType: 'appointment_booked',
      triggerValue: calendar.public_id,
    })

    const hostIds = new Set<number>()
    if (assignedUserId) hostIds.add(assignedUserId)
    for (const uid of coHostIds) hostIds.add(uid)
    if (hostIds.size > 0) {
      const localStart = new Date(slot.startsSec * 1000).toLocaleString()
      const title = `Auto-booked: ${calendar.name}`
      const body = `${localStart} · ${contact.name || contact.email || contact.phone || 'Contact'}`
      for (const hostId of hostIds) {
        notifyUser({
          user_id: hostId,
          workspace_id: run.workspace_id,
          kind: 'appointment_booked',
          title,
          body,
          href: '/crm/appointments',
          entity: 'appointment',
          entity_id: appointment.id,
        })
      }
    }

    const whenLabel = new Date(slot.startsSec * 1000).toLocaleString()
    createCrmContactActivity({
      contactId: contact.id,
      workspaceId: run.workspace_id,
      type: 'note',
      body: `Auto-booked into "${calendar.name}" at ${whenLabel}${assignedUserId ? ` (host #${assignedUserId})` : ''}`,
    })

    return `Booked into "${calendar.name}" at ${whenLabel}`
  }

  // Unknown / not-yet-implemented action: log and skip without erroring.
  // The catalog (src/lib/crm-actions.ts) may include actions that haven't
  // been wired to a real executor yet — we want the workflow to continue
  // rather than fail the whole run.
  console.warn(`[crm-workflow-runner] Skipping unimplemented action: ${node.type}`)
  return `Skipped (${node.type} is not yet wired to run live)`
}

function completeWorkflowRun(run: CrmWorkflowRunRecord, message: string, node?: CrmWorkflowNode | null) {
  markCrmWorkflowRunComplete(run.id)
  createRunEvent(run, 'run_completed', { node: node ?? null, message })
}

async function executeWorkflowRun(run: CrmWorkflowRunRecord) {
  createRunEvent(run, 'run_tick', {
    message: 'Worker picked up run',
    payload: {
      current_status: run.status,
      next_node_id: run.next_node_id,
      attempt_count: run.attempt_count,
    },
  })

  const workflow = getCrmWorkflowById(run.workflow_id, run.workspace_id)
  if (!workflow) {
    const message = 'Workflow not found'
    updateCrmWorkflowRun(run.id, { status: 'failed', last_error: message, attempt_count: run.attempt_count + 1 })
    createRunEvent(run, 'run_failed', { message })
    return
  }
  if (!workflow.is_active_bool) {
    const message = 'Workflow is inactive'
    updateCrmWorkflowRun(run.id, { status: 'failed', last_error: message, attempt_count: run.attempt_count + 1 })
    createRunEvent(run, 'run_failed', { message })
    return
  }

  // Business-hours gating. If the workflow is outside its allowed hours / days,
  // reschedule the run to the next open minute instead of executing now.
  const nextAllowed = nextBusinessHoursWindow(workflow.business_hours_json, Date.now())
  if (nextAllowed !== null) {
    updateCrmWorkflowRun(run.id, {
      next_node_id: run.next_node_id,
      run_at: nextAllowed,
      status: 'waiting',
      last_error: null,
      attempt_count: run.attempt_count + 1,
    })
    createRunEvent(run, 'run_rescheduled', {
      message: 'Outside of business hours — deferred to next allowed window',
      payload: { resume_at: nextAllowed },
    })
    return
  }

  const now = Math.floor(Date.now() / 1000)
  let currentNode = resolveCurrentNode(workflow.graph, run.next_node_id)
  let attemptCount = run.attempt_count + 1

  for (let steps = 0; steps < MAX_STEPS_PER_TICK; steps += 1) {
    if (!currentNode) {
      completeWorkflowRun(run, 'Run completed: no next node')
      return
    }

    if (currentNode.type === 'end' || currentNode.type === 'end_workflow') {
      const reason = currentNode.type === 'end_workflow'
        ? String(currentNode.config?.reason || 'Ended by workflow step')
        : 'Run reached end node'
      completeWorkflowRun(run, reason, currentNode)
      return
    }

    if (currentNode.type === 'start') {
      const nextId = getNextNodeId(workflow.graph, currentNode.id, 'default')
      if (!nextId) {
        completeWorkflowRun(run, 'Start node has no outgoing edge', currentNode)
        return
      }
      currentNode = resolveNodeById(workflow.graph, nextId)
      continue
    }

    // Goal-event scan: before executing the current step, check if any
    // goal_event node in the graph has become true. If so, jump to it.
    // This mirrors GHL's "goal reached" behaviour.
    {
      const contactForGoal = getCrmContactById(run.contact_id, run.workspace_id)
      if (contactForGoal) {
        const goal = findMatchingGoal(workflow.graph, contactForGoal, currentNode.id)
        if (goal) {
          createRunEvent(run, 'goal_reached', {
            node: goal,
            message: `Goal "${goal.config?.name || goal.label || 'unnamed'}" reached — jumping ahead`,
            payload: { from_node_id: currentNode.id, goal_node_id: goal.id },
          })
          // The goal node itself acts as a waypoint: move past it to the
          // next step in the goal's own default edge.
          const afterGoalId = getNextNodeId(workflow.graph, goal.id, 'default')
          currentNode = afterGoalId ? resolveNodeById(workflow.graph, afterGoalId) : null
          continue
        }
      }
    }

    // A goal_event node that we arrive at naturally is a no-op waypoint —
    // it's only meaningful when scanning ahead. Pass straight through.
    if (currentNode.type === 'goal_event') {
      const nextId = getNextNodeId(workflow.graph, currentNode.id, 'default')
      currentNode = nextId ? resolveNodeById(workflow.graph, nextId) : null
      continue
    }

    createRunEvent(run, 'node_started', { node: currentNode })

    if (currentNode.type === 'wait') {
      const waitSeconds = computeWaitSeconds((currentNode.config || {}) as Record<string, unknown>)
      const nextId = getNextNodeId(workflow.graph, currentNode.id, 'default')
      if (!nextId) {
        completeWorkflowRun(run, 'Wait node has no next edge', currentNode)
        return
      }
      const resumeAt = now + waitSeconds
      updateCrmWorkflowRun(run.id, {
        next_node_id: nextId,
        run_at: resumeAt,
        status: 'waiting',
        last_error: null,
        attempt_count: attemptCount,
      })
      createRunEvent(run, 'node_waiting', {
        node: currentNode,
        message: `Waiting ${waitSeconds}s before next step`,
        payload: { wait_seconds: waitSeconds, next_node_id: nextId, resume_at: resumeAt },
      })
      return
    }

    if (currentNode.type === 'condition') {
      const contact = getCrmContactById(run.contact_id, run.workspace_id)
      if (!contact) {
        const message = 'Condition node failed: contact not found'
        updateCrmWorkflowRun(run.id, {
          status: 'failed',
          last_error: message,
          attempt_count: attemptCount,
        })
        createRunEvent(run, 'node_failed', { node: currentNode, message })
        createRunEvent(run, 'run_failed', { node: currentNode, message })
        return
      }

      const evaluation = evaluateConditionNode(contact, currentNode)
      const selection = resolveConditionBranch(workflow.graph, currentNode, evaluation.matched)
      if (!selection.targetId) {
        const message = `Condition node "${currentNode.label || currentNode.id}" has no valid outgoing branch`
        updateCrmWorkflowRun(run.id, {
          status: 'failed',
          last_error: message,
          attempt_count: attemptCount,
        })
        createRunEvent(run, 'node_failed', { node: currentNode, message })
        createRunEvent(run, 'run_failed', { node: currentNode, message })
        return
      }

      createRunEvent(run, 'branch_selected', {
        node: currentNode,
        message: `Condition ${evaluation.matched ? 'matched' : 'did not match'} (${selection.branch} branch)`,
        payload: {
          field: evaluation.field,
          operator: evaluation.operator,
          expected: evaluation.expected,
          matched: evaluation.matched,
          branch: selection.branch,
          target_node_id: selection.targetId,
        },
      })
      createRunEvent(run, 'node_succeeded', {
        node: currentNode,
        payload: { target_node_id: selection.targetId, branch: selection.branch },
      })

      currentNode = resolveNodeById(workflow.graph, selection.targetId)
      attemptCount += 1
      continue
    }

    if (currentNode.type === 'ab_split') {
      const rawWeight = Number(currentNode.config?.weight_a)
      const weightA = Number.isFinite(rawWeight) ? Math.min(100, Math.max(0, rawWeight)) : 50
      const roll = Math.random() * 100
      const pickedBranch: WorkflowBranch = roll <= weightA ? 'a' : 'b'
      const preferred = getNextNodeId(workflow.graph, currentNode.id, pickedBranch)
      const selection = preferred
        ? { branch: pickedBranch, targetId: preferred }
        : { branch: 'default' as WorkflowBranch, targetId: getNextNodeId(workflow.graph, currentNode.id, 'default') }

      if (!selection.targetId) {
        const message = `A/B split node "${currentNode.label || currentNode.id}" has no valid outgoing branch`
        updateCrmWorkflowRun(run.id, {
          status: 'failed',
          last_error: message,
          attempt_count: attemptCount,
        })
        createRunEvent(run, 'node_failed', { node: currentNode, message })
        createRunEvent(run, 'run_failed', { node: currentNode, message })
        return
      }

      createRunEvent(run, 'branch_selected', {
        node: currentNode,
        message: `A/B split rolled ${roll.toFixed(1)} (weight A = ${weightA}) → branch ${selection.branch}`,
        payload: {
          weight_a: weightA,
          weight_b: 100 - weightA,
          roll,
          branch: selection.branch,
          target_node_id: selection.targetId,
        },
      })
      createRunEvent(run, 'node_succeeded', {
        node: currentNode,
        payload: { target_node_id: selection.targetId, branch: selection.branch },
      })

      currentNode = resolveNodeById(workflow.graph, selection.targetId)
      attemptCount += 1
      continue
    }

    try {
      let detail = 'Node executed'
      let outcome: 'sent' | 'skipped' | 'applied' = 'applied'
      if (currentNode.type === 'send_email') {
        const result = await executeEmailNode(run, currentNode)
        detail = result.detail
        outcome = result.outcome
      } else if (currentNode.type === 'send_sms') {
        const result = await executeSmsNode(run, currentNode)
        detail = result.detail
        outcome = result.outcome
      } else if (currentNode.type === 'webhook') {
        const result = await executeWebhookNode(run, currentNode)
        detail = result.detail
        outcome = result.outcome
      } else {
        detail = await executeContactActionNode(run, currentNode)
        outcome = 'applied'
      }
      createRunEvent(run, 'node_succeeded', {
        node: currentNode,
        message: detail,
        payload: { outcome },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow step failed'
      updateCrmWorkflowRun(run.id, {
        status: 'failed',
        last_error: message,
        attempt_count: attemptCount,
      })
      createRunEvent(run, 'node_failed', { node: currentNode, message })
      createRunEvent(run, 'run_failed', { node: currentNode, message })
      createCrmContactActivity({
        contactId: run.contact_id,
        workspaceId: run.workspace_id,
        type: 'note',
        body: `Workflow "${workflow.name}" failed: ${message}`,
      })
      return
    }

    const nextId = getNextNodeId(workflow.graph, currentNode.id, 'default')
    if (!nextId) {
      completeWorkflowRun(run, 'Run completed after last action step', currentNode)
      return
    }
    currentNode = resolveNodeById(workflow.graph, nextId)
    attemptCount += 1
  }

  updateCrmWorkflowRun(run.id, {
    status: 'queued',
    next_node_id: currentNode?.id || null,
    run_at: now + 1,
    last_error: null,
    attempt_count: attemptCount,
  })
  createRunEvent(run, 'run_rescheduled', {
    node: currentNode,
    message: 'Run paused to continue on next worker tick',
    payload: { next_node_id: currentNode?.id ?? null, run_at: now + 1 },
  })
}

async function processDueWorkflowRuns() {
  if (globalThis.__crmWorkflowWorkerRunning) return
  globalThis.__crmWorkflowWorkerRunning = true
  try {
    const now = Math.floor(Date.now() / 1000)
    const runs = getDueCrmWorkflowRuns(now, 25)
    for (const run of runs) {
      // eslint-disable-next-line no-await-in-loop
      await executeWorkflowRun(run)
    }
  } finally {
    globalThis.__crmWorkflowWorkerRunning = false
  }
}

/** Replace every {token} occurrence in a template string. */
function renderReminderTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => tokens[key] ?? `{${key}}`)
}

/**
 * Sends pending appointment reminders whose due_at has passed. Honors the
 * booking page's optional SMS/email template overrides and falls back to a
 * sensible default body when no template is set. Merge tokens supported:
 * {contact_name}, {appointment_time}, {host_name}, {booking_page_name}.
 */
export async function processDueAppointmentReminders(): Promise<void> {
  const due = getDueAppointmentReminders(50)
  for (const reminder of due) {
    try {
      const contact = getCrmContactById(reminder.contact_id, reminder.workspace_id)
      if (!contact) {
        markAppointmentReminderResult(reminder.id, 'skipped', 'Contact gone')
        continue
      }
      const appt = getDb().prepare('SELECT starts_at, calendar_id FROM crm_appointments WHERE id = ?').get(reminder.appointment_id) as { starts_at: number; calendar_id: number } | undefined
      if (!appt) {
        markAppointmentReminderResult(reminder.id, 'skipped', 'Appointment gone')
        continue
      }
      const calendar = getDb().prepare(
        'SELECT name, timezone, owner_id, reminder_sms_template_id, reminder_email_template_id FROM crm_calendars WHERE id = ?'
      ).get(appt.calendar_id) as {
        name: string; timezone: string; owner_id: number | null;
        reminder_sms_template_id: number | null; reminder_email_template_id: number | null;
      } | undefined
      const tz = calendar?.timezone || 'America/Vancouver'
      const when = new Date(appt.starts_at * 1000).toLocaleString('en-US', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
      const firstName = (contact.name || '').trim().split(/\s+/)[0] || (contact.email || 'there')
      const bookingPageName = calendar?.name || 'your appointment'

      let hostName = ''
      if (calendar?.owner_id) {
        const owner = getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(calendar.owner_id) as { name: string | null; email: string | null } | undefined
        hostName = owner?.name || owner?.email || ''
      }
      if (!hostName) {
        const workspace = getWorkspaceById(reminder.workspace_id)
        hostName = workspace?.name || ''
      }

      const tokens: Record<string, string> = {
        contact_name: firstName,
        appointment_time: when,
        host_name: hostName,
        booking_page_name: bookingPageName,
      }

      if (reminder.kind === 'sms') {
        if (contact.dnd_sms || contact.unsubscribed || !contact.phone) {
          markAppointmentReminderResult(reminder.id, 'skipped', 'DND, unsubscribed, or no phone')
          continue
        }
        const integration = getWorkspaceIntegration(reminder.workspace_id, 'twilio')
        const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
        const authToken  = String(integration?.config.auth_token  || getSetting('twilio_auth_token')  || '').trim()
        const fromPhone  = String(integration?.config.from_number || getSetting('twilio_phone_number') || '').trim()
        if (!accountSid || !authToken || !fromPhone) {
          markAppointmentReminderResult(reminder.id, 'skipped', 'Twilio not connected')
          continue
        }

        let bodyTemplate: string | null = null
        if (calendar?.reminder_sms_template_id) {
          const tpl = getCrmMessageTemplateById(calendar.reminder_sms_template_id, reminder.workspace_id)
          if (tpl && tpl.channel === 'sms') bodyTemplate = tpl.body
        }
        const body = renderReminderTemplate(
          bodyTemplate ?? `Hey {contact_name} — reminder: your {booking_page_name} is {appointment_time}. Reply STOP to cancel.`,
          tokens,
        )

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: contact.phone, From: fromPhone, Body: body }),
        })
        if (!res.ok) {
          markAppointmentReminderResult(reminder.id, 'failed', (await res.text()).slice(0, 300))
          continue
        }
        const payload = await res.json().catch(() => ({} as Record<string, unknown>))
        createSmsMessage({
          contact_id: contact.id,
          direction: 'outbound',
          body,
          from_phone: fromPhone,
          to_phone: contact.phone,
          twilio_sid: typeof payload.sid === 'string' ? payload.sid : undefined,
        })
        // No activity log — reminder SMS already appears in the chat thread.
        markAppointmentReminderResult(reminder.id, 'sent')
      } else if (reminder.kind === 'email') {
        if (contact.dnd_email || contact.unsubscribed || !contact.email) {
          markAppointmentReminderResult(reminder.id, 'skipped', 'DND, unsubscribed, or no email')
          continue
        }
        const workspace = getWorkspaceById(reminder.workspace_id)
        const senderUserId = workspace?.owner_id || 1

        let subjectTemplate: string | null = null
        let bodyTemplate: string | null = null
        if (calendar?.reminder_email_template_id) {
          const tpl = getCrmMessageTemplateById(calendar.reminder_email_template_id, reminder.workspace_id)
          if (tpl && tpl.channel === 'email') {
            subjectTemplate = tpl.subject
            bodyTemplate = tpl.body
          }
        }
        const subject = renderReminderTemplate(
          subjectTemplate ?? `Reminder: {booking_page_name} {appointment_time}`,
          tokens,
        )
        const bodyPlain = renderReminderTemplate(
          bodyTemplate ?? `Hey {contact_name},\n\nFriendly reminder about your upcoming {booking_page_name} on {appointment_time}.\n\nSee you soon.`,
          tokens,
        )
        const result = await sendEmail(
          senderUserId,
          contact.email,
          subject,
          `<p>${bodyPlain.replace(/\n/g, '<br>')}</p>`,
        )
        if (!result.success) {
          markAppointmentReminderResult(reminder.id, 'failed', result.error || 'email send failed')
        } else {
          createCrmContactActivity({
            contactId: contact.id,
            workspaceId: reminder.workspace_id,
            type: 'email',
            body: 'Appointment reminder sent',
          })
          markAppointmentReminderResult(reminder.id, 'sent')
        }
      } else {
        markAppointmentReminderResult(reminder.id, 'skipped', `Unknown kind: ${reminder.kind}`)
      }
    } catch (e) {
      markAppointmentReminderResult(reminder.id, 'failed', e instanceof Error ? e.message.slice(0, 300) : 'unknown')
    }
  }
}

export async function processCrmTicketSlaBreaches(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000)
  if (globalThis.__crmTicketSlaPassAt && nowSec - globalThis.__crmTicketSlaPassAt < 60) return
  globalThis.__crmTicketSlaPassAt = nowSec
  const nowIso = new Date(nowSec * 1000).toISOString()
  const due = getDueCrmTicketSlaBreaches(nowIso, 50)
  for (const ticket of due) {
    const updated = markCrmTicketSlaBreached(ticket.id, ticket.workspace_id, nowIso)
    if (!updated) continue
    queueCrmWorkflowRunsForTicketSlaBreached(updated)
  }
}

/**
 * Fires recurring workflow schedules. For each schedule whose next_run_at has
 * passed, resolves the bound list's members and queues a fresh workflow run
 * for each. Then pushes next_run_at forward (offset by +60s so the schedule
 * can't immediately re-qualify in the same tick).
 */
export async function processDueWorkflowSchedules(): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const due = getDueCrmWorkflowSchedules(now)
  for (const schedule of due) {
    try {
      const workflow = getCrmWorkflowById(schedule.workflow_id, schedule.workspace_id)
      if (!workflow) {
        // Workflow gone — roll the schedule forward anyway so we don't
        // busy-loop on a dangling row. Deletion via FK cascade is the
        // normal path, but belt-and-suspenders.
        const nextRunAt = computeNextRunAt(schedule, now + 60)
        markCrmWorkflowScheduleRan(schedule.id, now, nextRunAt)
        continue
      }

      let enrolled = 0
      let listName: string | null = null
      if (schedule.list_id) {
        const list = getCrmListById(schedule.list_id, schedule.workspace_id)
        listName = list?.name ?? null
        const contacts = getCrmListContacts(schedule.list_id, schedule.workspace_id)
        for (const contact of contacts) {
          const run = createCrmWorkflowRun({
            workflow_id: schedule.workflow_id,
            workspace_id: schedule.workspace_id,
            contact_id: contact.id,
            next_node_id: null,
            run_at: now,
            status: 'queued',
          })
          if (run) {
            enrolled += 1
            // One visibility event per enrolled run (FK requires a real run_id).
            createCrmWorkflowRunEvent({
              run_id: run.id,
              workflow_id: schedule.workflow_id,
              workspace_id: schedule.workspace_id,
              contact_id: contact.id,
              event_type: 'schedule_enrolled',
              message: `Enrolled by recurring schedule (${schedule.cadence}${listName ? ` · ${listName}` : ''})`,
              payload: {
                schedule_id: schedule.id,
                cadence: schedule.cadence,
                list_id: schedule.list_id,
              },
            })
          }
        }
      }

      const nextRunAt = computeNextRunAt(schedule, now + 60)
      markCrmWorkflowScheduleRan(schedule.id, now, nextRunAt)
    } catch {
      // If anything blows up for a single schedule, push it forward so we
      // don't spin. The audit/event log above captures the enrolled count
      // on success; failures get skipped and retried at the next cadence.
      try {
        const nextRunAt = computeNextRunAt(schedule, now + 60)
        markCrmWorkflowScheduleRan(schedule.id, now, nextRunAt)
      } catch {
        // give up — next tick will try again
      }
    }
  }
}

/**
 * Drip sequence worker. Runs on the same 20s tick as workflow runs.
 *
 * For each enrollment whose status is 'active' and next_send_at <= now:
 *   1. Fetch the step at `next_step_position`.
 *   2. Send email / SMS (skip if contact unsubscribed/DND at send time).
 *   3. Advance next_step_position. If there's another step, schedule it
 *      from enrolled_at + cumulative delay. If not, mark 'completed'.
 *
 * Errors on an individual send still advance the enrollment (like workflow
 * runs) so one bad address can't stall a sequence forever.
 */
export async function processCrmDripEnrollments(now: number): Promise<void> {
  const nowMs = typeof now === 'number' && isFinite(now) ? now : Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const due = getDueCrmDripEnrollments(nowIso, 25)
  for (const enrollment of due) {
    try {
      const seq = getCrmDripSequenceById(enrollment.sequence_id, enrollment.workspace_id)
      if (!seq || !seq.is_active) {
        advanceCrmDripEnrollment(enrollment.id, { status: 'canceled', next_send_at: null })
        continue
      }
      const contact = getCrmContactById(enrollment.contact_id, enrollment.workspace_id)
      if (!contact) {
        advanceCrmDripEnrollment(enrollment.id, { status: 'canceled', next_send_at: null })
        continue
      }

      const allSteps = listCrmDripSteps(enrollment.sequence_id, enrollment.workspace_id)
      const step = allSteps.find((s) => s.position === enrollment.next_step_position) || null
      if (!step) {
        advanceCrmDripEnrollment(enrollment.id, { status: 'completed', next_send_at: null })
        continue
      }

      if (step.channel === 'email') {
        if (contact.unsubscribed || contact.dnd_email) {
          // skipped
        } else if (contact.email) {
          const subject = (step.subject || '').trim() || `Message from ${seq.name}`
          const theme = step.theme_id ? getCrmEmailThemeById(step.theme_id, enrollment.workspace_id) : null
          const bodyHtml = step.content_kind === 'blocks' && step.body_blocks
            ? renderEmailBlocksToHtml(parseEmailBlocks(step.body_blocks), {
                theme,
                variantContext: buildEmailVariantContext(contact),
              })
            : (step.body_html || '').trim() || (step.body_text ? `<p>${(step.body_text).replace(/\n/g, '<br>')}</p>` : '<p></p>')
          const workspaceOwnerId = getWorkspaceById(enrollment.workspace_id)?.owner_id || contact.owner_id || 1
          try {
            const result = await sendEmail(workspaceOwnerId, contact.email, subject, bodyHtml)
            if (result.success) {
              createDirectEmailSend({
                workspaceId: enrollment.workspace_id,
                contactId: contact.id,
                subject,
                bodyHtml,
                accountId: getDefaultEmailAccount(enrollment.workspace_id)?.id ?? null,
                threadId: `drip:${seq.id}:${enrollment.id}`,
              })
              createCrmContactActivity({
                contactId: contact.id,
                workspaceId: enrollment.workspace_id,
                type: 'email',
                body: `Drip "${seq.name}" sent step ${step.position + 1}: "${subject}"`,
              })
            }
          } catch { /* swallow — still advance */ }
        }
      } else if (step.channel === 'sms') {
        if (contact.unsubscribed || contact.dnd_sms) {
          // skipped
        } else if (contact.phone) {
          const message = (step.body_text || '').trim()
          if (message) {
            const integration = getWorkspaceIntegration(enrollment.workspace_id, 'twilio')
            const accountSid = String(integration?.config.account_sid || getSetting('twilio_account_sid') || '').trim()
            const authToken  = String(integration?.config.auth_token  || getSetting('twilio_auth_token')  || '').trim()
            const fromPhone  = String(integration?.config.from_number || getSetting('twilio_phone_number') || '').trim()
            if (accountSid && authToken && fromPhone) {
              try {
                const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams({ To: contact.phone, From: fromPhone, Body: message }),
                })
                const raw = await twilioRes.text()
                let payload: Record<string, unknown> | null = null
                try { payload = JSON.parse(raw) as Record<string, unknown> } catch { payload = null }
                if (twilioRes.ok) {
                  createSmsMessage({
                    contact_id: contact.id,
                    direction: 'outbound',
                    body: message,
                    from_phone: fromPhone,
                    to_phone: contact.phone,
                    twilio_sid: typeof payload?.sid === 'string' ? payload.sid : undefined,
                  })
                  // No activity log — drip SMS already appears in the chat thread.
                }
              } catch { /* swallow */ }
            }
          }
        }
      }

      // Advance. If there's a next step by position order, schedule it using
      // the delay from enrolled_at; otherwise mark completed.
      const sortedSteps = [...allSteps].sort((a, b) => a.position - b.position)
      const idxCurrent = sortedSteps.findIndex((s) => s.id === step.id)
      const nextStep = idxCurrent >= 0 ? sortedSteps[idxCurrent + 1] : undefined
      if (!nextStep) {
        advanceCrmDripEnrollment(enrollment.id, { status: 'completed', next_send_at: null, next_step_position: step.position + 1 })
      } else {
        const enrolledMs = Date.parse(enrollment.enrolled_at)
        const offsetMs = (nextStep.delay_days * 86400 + nextStep.delay_hours * 3600) * 1000
        const nextSendMs = Math.max(enrolledMs + offsetMs, nowMs + 1_000)
        advanceCrmDripEnrollment(enrollment.id, {
          next_step_position: nextStep.position,
          next_send_at: new Date(nextSendMs).toISOString(),
        })
      }
    } catch {
      // Swallow per-enrollment errors so one bad row doesn't stall the tick.
      // Push next_send_at forward by a minute so we don't spin on it.
      try {
        advanceCrmDripEnrollment(enrollment.id, { next_send_at: new Date(nowMs + 60_000).toISOString() })
      } catch { /* noop */ }
    }
  }
}

/**
 * Course drip worker. Runs on the same 20s tick.
 *
 * Scans every enrollment whose course has drip-scheduled lessons and unlocks
 * any whose `drip_release_at` (absolute unix time) or `drip_day_offset` (days
 * after the member enrolled) has arrived. Seeds an empty progress row so we
 * don't re-unlock, fires a `lesson_unlocked` trigger for workflow hooks, and
 * drops a contact activity note so the timeline reflects the unlock.
 */
export async function processDripLessonUnlocks(): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const { getDueCrmCourseLessonUnlocks, markCrmLessonUnlocked } = await import('@/lib/db')
    const due = getDueCrmCourseLessonUnlocks(now, 50)
    for (const row of due) {
      try {
        markCrmLessonUnlocked(row.member_id, row.lesson_id)
        queueCrmWorkflowRunsForTrigger({
          workspaceId: row.workspace_id,
          contactId: row.contact_id,
          triggerType: 'lesson_unlocked',
          triggerValue: String(row.lesson_id),
        })
        try {
          createCrmContactActivity({
            contactId: row.contact_id,
            workspaceId: row.workspace_id,
            type: 'note',
            body: `Lesson #${row.lesson_id} unlocked (course #${row.course_id})`,
          })
        } catch { /* activity is best-effort */ }
      } catch { /* per-row swallow so one bad row can't stall the tick */ }
    }
  } catch { /* swallow — drip is best-effort */ }
}

/**
 * Overdue invoice pass. Runs once per UTC day shortly after midnight and:
 *   1) flips any past-due sent/viewed/partial invoice to 'overdue'
 *   2) fires the 'invoice_overdue' trigger for matching workflows
 *   3) writes both audit + contact timeline entries for operator visibility
 */
export async function processOverdueInvoices(now: number = Math.floor(Date.now() / 1000)): Promise<void> {
  const globalScope = globalThis as unknown as { __lastOverduePassKey?: string }
  const passKey = new Date(now * 1000).toISOString().slice(0, 10)
  if (globalScope.__lastOverduePassKey === passKey) return
  globalScope.__lastOverduePassKey = passKey

  let rows: ReturnType<typeof listOverdueInvoices>
  try {
    const cutoff = Math.floor(new Date(`${passKey}T00:00:00.000Z`).getTime() / 1000)
    rows = listOverdueInvoices(cutoff)
  } catch {
    return
  }

  for (const inv of rows) {
    try {
      markInvoiceOverdue(inv.id)
      writeAuditLog({
        workspaceId: inv.workspace_id,
        userId: null,
        entity: 'crm_invoice',
        entityId: inv.id,
        action: 'overdue',
        summary: `Marked invoice ${inv.number} overdue`,
      })
      if (inv.contact_id) {
        try {
          queueCrmWorkflowRunsForTrigger({
            workspaceId: inv.workspace_id,
            contactId: inv.contact_id,
            triggerType: 'invoice_overdue',
            triggerValue: null,
          })
        } catch { /* noop */ }
        try {
          createCrmContactActivity({
            workspaceId: inv.workspace_id,
            contactId: inv.contact_id,
            type: 'note',
            body: `Invoice ${inv.number} is overdue (due ${inv.due_date ? new Date(inv.due_date * 1000).toISOString().slice(0, 10) : 'unknown'}).`,
          })
        } catch { /* noop */ }
      }
    } catch { /* per-row failure should never stall the pass */ }
  }
}

function formatAffiliateCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100)
}

async function processAffiliatePaymentConversions(): Promise<void> {
  const created = syncCrmAffiliateReferralsFromPayments(100)
  for (const referral of created) {
    notifyContactOwner(referral.workspace_id, referral.contact_id, 'affiliate_conversion', (contact) => ({
      title: `Affiliate conversion: ${contact.name}`,
      body: `${referral.affiliate_name} earned ${formatAffiliateCurrency(referral.commission_cents)} from ${formatAffiliateCurrency(referral.order_value_cents)}`,
      href: `/crm/contacts/${referral.contact_id}`,
      entity: 'affiliate_referral',
      entity_id: referral.id,
    }))
  }
}

async function processMonthlyAffiliatePayouts(): Promise<void> {
  const now = new Date()
  if (now.getUTCDate() !== 1) return
  const passKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  if (globalThis.__lastAffiliatePayoutPassKey === passKey) return
  globalThis.__lastAffiliatePayoutPassKey = passKey
  const workspaces = getDb().prepare('SELECT id FROM workspaces ORDER BY id ASC').all() as Array<{ id: number }>
  for (const workspace of workspaces) {
    try {
      generateCrmAffiliatePayoutsForPeriod(workspace.id)
    } catch (error) {
      console.error('[crm-workflow-runner] Failed generating affiliate payouts', workspace.id, error)
    }
  }
}

/**
 * "Starting in 15 minutes" in-app push to the appointment host.
 *
 * Selects confirmed appointments whose starts_at falls in the next 15 minutes,
 * have an assigned host, and haven't been notified yet. For each row, fires
 * `notifyUser({ kind: 'appointment_booked' })` and stamps `reminder_sent_at`
 * so the same booking never alerts twice.
 *
 * Idempotent via the `reminder_sent_at IS NULL` filter — safe to call every
 * tick. Gated to run at most every 2 minutes to keep the sweep cheap.
 */
export function processUpcomingAppointmentAlerts(): void {
  const nowSec = Math.floor(Date.now() / 1000)
  const fifteenMinAhead = nowSec + 15 * 60
  const db = getDb()

  type Row = {
    id: number
    workspace_id: number
    contact_id: number | null
    assigned_user_id: number
    starts_at: number
  }
  const due = db.prepare(`
    SELECT id, workspace_id, contact_id, assigned_user_id, starts_at
      FROM crm_appointments
     WHERE status = 'confirmed'
       AND assigned_user_id IS NOT NULL
       AND reminder_sent_at IS NULL
       AND starts_at BETWEEN ? AND ?
     ORDER BY starts_at ASC
     LIMIT 100
  `).all(nowSec, fifteenMinAhead) as Row[]

  if (due.length === 0) return

  const markSent = db.prepare(
    'UPDATE crm_appointments SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL'
  )

  for (const row of due) {
    try {
      let contactName = 'Appointment'
      if (row.contact_id) {
        const contact = getCrmContactById(row.contact_id, row.workspace_id)
        if (contact) {
          contactName = (contact.name || contact.email || contact.phone || 'Appointment').trim() || 'Appointment'
        }
      }
      notifyUser({
        user_id: row.assigned_user_id,
        workspace_id: row.workspace_id,
        kind: 'appointment_booked',
        title: 'Starting in 15 minutes',
        body: contactName,
        href: row.contact_id ? `/crm/contacts/${row.contact_id}` : null,
        entity: 'appointment',
        entity_id: row.id,
      })
      markSent.run(nowSec, row.id)
    } catch {
      try { markSent.run(nowSec, row.id) } catch { /* noop */ }
    }
  }
}

async function processPendingCrmConversionForwards(): Promise<void> {
  const pending = listPendingCrmConversionForwards(20)
  for (const forward of pending) {
    let requestPayload: Record<string, unknown> | null = null
    try {
      if (!forward.endpoint_is_active) {
        updateCrmConversionForward(forward.id, {
          status: 'failed',
          response_json: JSON.stringify({ ok: false, error: 'Endpoint is inactive' }),
        })
        continue
      }

      const result = await sendCrmConversionForwardLive(forward)
      requestPayload = result.request ?? buildCrmConversionForwardRequest(forward)

      updateCrmConversionForward(forward.id, {
        status: result.ok ? 'sent' : 'failed',
        request_json: JSON.stringify(requestPayload),
        response_json: JSON.stringify({
          ok: result.ok,
          skipped: result.skipped ?? false,
          status: result.status,
          body: result.body,
          error: result.error,
          platform: forward.endpoint_platform,
          sent_at: new Date().toISOString(),
        }),
      })
    } catch (error) {
      updateCrmConversionForward(forward.id, {
        status: 'failed',
        request_json: requestPayload ? JSON.stringify(requestPayload) : undefined,
        response_json: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      })
    }
  }
}

/**
 * Birthday triggers fire once per calendar day. We scan at most once per day
 * (tracked in-process) by comparing today's YYYY-MM-DD against the stored
 * last-run date. For every active birthday workflow we compute `today +
 * days_before` (days_before parsed from the workflow's trigger_value), then
 * find contacts whose birthday MM-DD matches that target. Each match is
 * enrolled via queueCrmWorkflowRunsForTrigger so the workflow's allow_reentry
 * setting and normal enrollment guards still apply.
 */
function processDueBirthdayTriggers(): void {
  try {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const g = globalThis as unknown as { __crmBirthdayLastRunDate?: string }
    if (g.__crmBirthdayLastRunDate === today) return

    const workflows = getDb()
      .prepare("SELECT id, workspace_id, trigger_value FROM crm_workflows WHERE is_active = 1 AND trigger_type = 'birthday'")
      .all() as Array<{ id: number; workspace_id: number; trigger_value: string | null }>

    for (const wf of workflows) {
      const daysBefore = Math.max(0, Math.min(365, Math.floor(Number(wf.trigger_value) || 0)))
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysBefore)
      const mmDd = `${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
      const contacts = getDb().prepare(`
        SELECT id FROM crm_contacts
        WHERE workspace_id = ?
          AND birthday IS NOT NULL AND length(birthday) = 10
          AND substr(birthday, 6, 5) = ?
          AND (deleted_at IS NULL OR deleted_at = 0)
      `).all(wf.workspace_id, mmDd) as Array<{ id: number }>

      for (const row of contacts) {
        queueCrmWorkflowRunsForTrigger({
          workspaceId: wf.workspace_id,
          contactId: row.id,
          triggerType: 'birthday',
          triggerValue: String(daysBefore),
        })
      }
    }

    g.__crmBirthdayLastRunDate = today
  } catch { /* worker must never throw */ }
}

function processDueContractExpiry(): void {
  try {
    const rows = expireDueCrmContracts()
    for (const row of rows) {
      const contract = getCrmContractById(row.id, row.workspace_id)
      if (!contract) continue
      writeAuditLog({
        workspaceId: row.workspace_id,
        entity: 'crm_contract',
        entityId: row.id,
        action: 'expired',
        summary: `Contract "${contract.title}" expired before signature`,
      })
      if (!contract.contact_id) continue
      queueCrmWorkflowRunsForTrigger({
        workspaceId: row.workspace_id,
        contactId: contract.contact_id,
        triggerType: 'contract_expired',
      })
    }
  } catch { /* worker must never throw */ }
}

export function startCrmWorkflowWorker() {
  if (globalThis.__crmWorkflowWorkerStarted) return
  globalThis.__crmWorkflowWorkerStarted = true
  processDueWorkflowRuns().catch(() => {})
  processDueAppointmentReminders().catch(() => {})
  processDueWorkflowSchedules().catch(() => {})
  processCrmTicketSlaBreaches().catch(() => {})
  processCrmDripEnrollments(Date.now()).catch(() => {})
  processDripLessonUnlocks().catch(() => {})
  processOverdueInvoices().catch(() => {})
  processAffiliatePaymentConversions().catch(() => {})
  processMonthlyAffiliatePayouts().catch(() => {})
  processDueContractExpiry()
  try { processDueBirthdayTriggers() } catch { /* noop */ }
  try { processUpcomingAppointmentAlerts(); globalThis.__crmUpcomingApptLastRunMs = Date.now() } catch { /* noop */ }
  try { processDueScheduledCampaigns(Math.floor(Date.now() / 1000)) } catch { /* noop */ }
  processDueSurveyCampaignQueue().catch(() => {})
  processPendingCrmConversionForwards().catch(() => {})
  setInterval(() => {
    processDueWorkflowRuns().catch(() => {})
    processDueAppointmentReminders().catch(() => {})
    processDueWorkflowSchedules().catch(() => {})
    processCrmTicketSlaBreaches().catch(() => {})
    processCrmDripEnrollments(Date.now()).catch(() => {})
    processDripLessonUnlocks().catch(() => {})
    processOverdueInvoices().catch(() => {})
    processAffiliatePaymentConversions().catch(() => {})
    processMonthlyAffiliatePayouts().catch(() => {})
        processDueContractExpiry()
    try { processDueBirthdayTriggers() } catch { /* noop */ }
    const lastRun = globalThis.__crmUpcomingApptLastRunMs || 0
    if (Date.now() - lastRun >= TWO_MINUTES_MS) {
      try { processUpcomingAppointmentAlerts(); globalThis.__crmUpcomingApptLastRunMs = Date.now() } catch { /* noop */ }
    }
    try { processDueScheduledCampaigns(Math.floor(Date.now() / 1000)) } catch { /* noop */ }
    processDueSurveyCampaignQueue().catch(() => {})
    processPendingCrmConversionForwards().catch(() => {})
  }, TWENTY_SECONDS_MS).unref?.()

  // Separate interval for GBP sync — every 30 min rather than every 20s so we
  // don't hammer the API (when the real call lands).
  setInterval(() => {
    processGoogleBusinessProfileSync().catch(() => {})
  }, 30 * 60 * 1000).unref?.()
}
