import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import {
  addCrmBookingAttendees,
  createCrmAppointment,
  createCrmContact,
  createCrmContactActivity,
  createCrmVoiceCall,
  findCrmContactsByPhone,
  getActiveCrmVoiceAgentForWorkspace,
  getCrmAppointments,
  getCrmCalendarById,
  getCrmCalendarByPublicId,
  getCrmContactByEmail,
  getCrmContactById,
  getCrmVoiceAgentByAssistantId,
  getCrmVoiceCallByVapiId,
  getDb,
  getHostBusyBlocks,
  hasCalendarConflict,
  pickRoundRobinAssignee,
  pickRoundRobinHost,
  getWorkspaceByPublicId,
  queueCrmWorkflowRunsForTrigger,
  updateCrmContact,
  updateCrmVoiceCall,
  type CrmCalendarRecord,
  type CrmVoiceAgent,
} from '@/lib/db'
import { fetchFreeBusyMap, pushAppointmentToExternal } from '@/lib/calendar-sync'

/**
 * Vapi voice-assistant webhook ingress. One endpoint per workspace — the
 * workspace public_id identifies which workspace owns the call.
 *
 *   POST /api/webhooks/vapi/:publicId
 *
 * Vapi posts JSON for several event types. We care about:
 *   - call-start     → open a crm_voice_calls row, match/create contact.
 *   - function-call  → run one of our exposed tools and return the result.
 *   - call-end       → finalize the row, write an activity, fire the
 *                      ai_call_completed workflow trigger.
 *
 * Signature: Vapi sends x-vapi-signature (HMAC SHA-256 of the raw body using
 * VAPI_WEBHOOK_SECRET). If the env var is absent we skip verification — dev
 * mode only.
 *
 * Never throws. Always returns 200. Tool responses go back inline as JSON so
 * Vapi can relay them to the model mid-call.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params
    const workspace = publicId ? getWorkspaceByPublicId(publicId) : null
    if (!workspace) return ok({ status: 'workspace_not_found' })

    const rawBody = await request.text()
    if (!verifySignature(request, rawBody)) {
      return ok({ status: 'invalid_signature' })
    }

    const payload = safeJson(rawBody)
    if (!payload) return ok({ status: 'invalid_payload' })

    // Vapi wraps events under a "message" object (current API) — fall back to
    // the top-level payload if a caller posts unwrapped data (useful in tests).
    const event = (payload.message && typeof payload.message === 'object')
      ? payload.message as Record<string, unknown>
      : payload
    const type = typeof event.type === 'string' ? event.type : ''

    switch (type) {
      case 'call-start':
      case 'status-update': {
        if (type === 'status-update' && event.status !== 'in-progress') return ok({ status: 'ignored' })
        return ok(await handleCallStart(workspace.id, event))
      }
      case 'function-call':
      case 'tool-calls': {
        return ok(await handleFunctionCall(workspace.id, event))
      }
      case 'call-end':
      case 'end-of-call-report': {
        return ok(await handleCallEnd(workspace.id, event))
      }
      default:
        return ok({ status: 'ignored', type })
    }
  } catch (err) {
    console.error('[vapi webhook] unexpected error', err)
    return ok({ status: 'error' })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// call-start
// ────────────────────────────────────────────────────────────────────────────

async function handleCallStart(workspaceId: number, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = extractCall(event)
  const vapiCallId = call.id
  if (!vapiCallId) return { status: 'missing_call_id' }

  const agent = resolveAgent(workspaceId, event, call)
  if (!agent) return { status: 'no_active_agent' }

  const fromNumber = (call.fromNumber || '').trim()
  const toNumber = (call.toNumber || '').trim()
  const startedAt = call.startedAt || new Date().toISOString()

  let contactId: number | null = null
  if (fromNumber) {
    const matches = findCrmContactsByPhone(fromNumber, workspaceId)
    if (matches[0]?.id) contactId = matches[0].id
    if (!contactId) {
      try {
        const created = createCrmContact({
          workspaceId,
          name: fromNumber,
          phone: fromNumber,
        })
        contactId = created.id
        try {
          getDb()
            .prepare("UPDATE crm_contacts SET source = ? WHERE id = ?")
            .run('voice_ai', created.id)
        } catch { /* source update is best-effort */ }
      } catch { /* contact creation must not break the call */ }
    }
  }

  createCrmVoiceCall({
    workspace_id: workspaceId,
    voice_agent_id: agent.id,
    contact_id: contactId,
    vapi_call_id: vapiCallId,
    from_number: fromNumber || null,
    to_number: toNumber || null,
    started_at: startedAt,
  })

  return { status: 'ok', contact_id: contactId }
}

// ────────────────────────────────────────────────────────────────────────────
// function-call (tool dispatch)
// ────────────────────────────────────────────────────────────────────────────

async function handleFunctionCall(workspaceId: number, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = extractCall(event)
  const agent = resolveAgent(workspaceId, event, call)
  if (!agent) return { result: null, error: 'no_active_agent' }

  // Vapi sends either a single functionCall or a tool-calls array.
  const functionCall = pickFunctionCall(event)
  const name = (functionCall?.name || '').trim()
  const args = functionCall?.arguments || {}

  if (!name) return { result: null, error: 'missing_function_name' }
  if (!agent.tools_enabled.includes(name as never)) {
    return { result: null, error: 'tool_not_enabled', tool: name }
  }

  const voiceCall = call.id ? getCrmVoiceCallByVapiId(call.id) : null
  const contactId = voiceCall?.contact_id ?? null

  switch (name) {
    case 'lookup_contact':
      return { result: await toolLookupContact(workspaceId, args) }
    case 'check_availability':
      return { result: await toolCheckAvailability(workspaceId, args) }
    case 'book_appointment':
      return { result: await toolBookAppointment(workspaceId, contactId, args) }
    case 'take_message':
      return { result: await toolTakeMessage(workspaceId, contactId, args) }
    case 'transfer_to_human':
      return {
        result: {
          status: agent.transfer_to_number ? 'transferring' : 'unavailable',
          message: agent.transfer_to_number ? 'Connecting you to a teammate now.' : 'No human line is configured yet.',
        },
        // Vapi uses transferDestinationNumber to bridge the live call.
        transferDestinationNumber: agent.transfer_to_number || null,
      }
    default:
      return { result: null, error: 'unknown_tool' }
  }
}

async function toolLookupContact(workspaceId: number, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const email = typeof args.email === 'string' ? args.email.trim() : ''
  const phone = typeof args.phone === 'string' ? args.phone.trim() : ''

  let contact: any = null
  if (email) contact = getCrmContactByEmail(workspaceId, email)
  if (!contact && phone) {
    const matches = findCrmContactsByPhone(phone, workspaceId)
    contact = matches[0] || null
  }
  if (!contact) return null
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
    tags: contact.tags_list,
    lifecycle_stage: contact.lifecycle_stage,
  }
}

async function toolCheckAvailability(workspaceId: number, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const slugOrId = typeof args.booking_page_slug === 'string'
    ? args.booking_page_slug.trim()
    : typeof args.booking_page_id === 'string' ? args.booking_page_id.trim() : ''
  const requestedDuration = Number(args.duration_min)
  const dateHint = typeof args.date === 'string' ? args.date.trim() : ''

  const calendar = resolveCalendar(workspaceId, slugOrId)
  if (!calendar) return { status: 'booking_page_not_found', slots: [] }

  const durationMinutes = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? Math.floor(requestedDuration)
    : calendar.duration_minutes

  const slots = await computeAvailability(calendar, {
    durationMinutes,
    fromIso: dateHint || null,
    maxSlots: 5,
  })

  return {
    calendar: {
      id: calendar.id,
      public_id: calendar.public_id,
      name: calendar.name,
      timezone: calendar.timezone,
      duration_minutes: calendar.duration_minutes,
    },
    slots,
  }
}

async function toolBookAppointment(
  workspaceId: number,
  voiceContactId: number | null,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const slugOrId = typeof args.booking_page_slug === 'string'
    ? args.booking_page_slug.trim()
    : typeof args.booking_page_id === 'string' ? args.booking_page_id.trim() : ''
  const startIso = typeof args.start_iso === 'string' ? args.start_iso.trim() : ''
  const notes = typeof args.notes === 'string' ? args.notes.trim() : null

  const calendar = resolveCalendar(workspaceId, slugOrId)
  if (!calendar) return { status: 'booking_page_not_found' }

  const startSec = Math.floor(new Date(startIso).getTime() / 1000)
  if (!Number.isFinite(startSec) || startSec <= 0) return { status: 'invalid_start_iso' }
  const endSec = startSec + calendar.duration_minutes * 60
  if (hasCalendarConflict(calendar.id, startSec, endSec)) return { status: 'slot_unavailable' }

  let assignedUserId: number | null = null
  let coHostIds: number[] = []
  if (calendar.booking_mode === 'round_robin') {
    if (calendar.host_user_ids.length === 0) return { status: 'no_hosts_configured' }
    const busyMap = getHostBusyBlocks(workspaceId, calendar.host_user_ids, startSec, endSec)
    const externalBusyMap = await fetchFreeBusyMap({
      userIds: calendar.host_user_ids,
      workspaceId,
      startAt: startSec,
      endAt: endSec,
    })
    const freeHosts = calendar.host_user_ids.filter((userId) => {
      const internalBlocks = busyMap.get(userId) || []
      const externalBlocks = externalBusyMap.get(userId) || []
      return ![...internalBlocks, ...externalBlocks].some((block) => block.starts_at < endSec && block.ends_at > startSec)
    })
    assignedUserId = pickRoundRobinHost(calendar.id, freeHosts, calendar.round_robin_strategy)
    if (!assignedUserId) return { status: 'no_host_available' }
  } else if (calendar.booking_mode === 'collective') {
    if (calendar.host_user_ids.length === 0) return { status: 'no_hosts_configured' }
    const busyMap = getHostBusyBlocks(workspaceId, calendar.host_user_ids, startSec, endSec)
    const externalBusyMap = await fetchFreeBusyMap({
      userIds: calendar.host_user_ids,
      workspaceId,
      startAt: startSec,
      endAt: endSec,
    })
    const everyoneFree = calendar.host_user_ids.every((userId) => {
      const internalBlocks = busyMap.get(userId) || []
      const externalBlocks = externalBusyMap.get(userId) || []
      return ![...internalBlocks, ...externalBlocks].some((block) => block.starts_at < endSec && block.ends_at > startSec)
    })
    if (!everyoneFree) return { status: 'slot_unavailable' }
    assignedUserId = calendar.host_user_ids[0]
    coHostIds = calendar.host_user_ids.slice(1)
  } else if (calendar.owner_id) {
    assignedUserId = calendar.owner_id
    const externalBusyMap = await fetchFreeBusyMap({
      userIds: [calendar.owner_id],
      workspaceId,
      startAt: startSec,
      endAt: endSec,
    })
    const ownerBlocks = externalBusyMap.get(calendar.owner_id) || []
    if (ownerBlocks.some((block) => block.starts_at < endSec && block.ends_at > startSec)) {
      return { status: 'slot_unavailable' }
    }
  }

  // Resolve the contact: prefer explicit id, fall back to phone/email lookup,
  // finally fall back to the call's matched contact.
  let contactId: number | null = null
  const explicitId = Number(args.contact_id)
  if (Number.isFinite(explicitId) && explicitId > 0) {
    const existing = getCrmContactById(explicitId, workspaceId)
    if (existing) contactId = existing.id
  }
  if (!contactId) {
    const phone = typeof args.phone === 'string' ? args.phone.trim() : ''
    const email = typeof args.email === 'string' ? args.email.trim() : ''
    if (email) {
      const emailMatch = getCrmContactByEmail(workspaceId, email)
      if (emailMatch) contactId = emailMatch.id
    }
    if (!contactId && phone) {
      const phoneMatches = findCrmContactsByPhone(phone, workspaceId)
      if (phoneMatches[0]?.id) contactId = phoneMatches[0].id
    }
    if (!contactId && (phone || email)) {
      try {
        const created = createCrmContact({
          workspaceId,
          name: typeof args.name === 'string' ? args.name.trim() || phone || email : (phone || email),
          phone: phone || null,
          email: email || null,
        })
        contactId = created.id
      } catch { /* noop */ }
    }
  }
  if (!contactId) contactId = voiceContactId
  if (!contactId) return { status: 'missing_contact' }

  if (calendar.booking_mode === 'single') {
    const rotatedUserId = pickRoundRobinAssignee(calendar.id)
    if (rotatedUserId) {
      assignedUserId = rotatedUserId
      updateCrmContact(contactId, workspaceId, { owner_id: rotatedUserId })
    }
  } else if (assignedUserId) {
    updateCrmContact(contactId, workspaceId, { owner_id: assignedUserId })
  }

  const appointment = createCrmAppointment({
    calendar_id: calendar.id,
    workspace_id: workspaceId,
    contact_id: contactId,
    starts_at: startSec,
    ends_at: endSec,
    notes,
    assigned_user_id: assignedUserId,
  })

  if (calendar.booking_mode === 'collective' && coHostIds.length > 0) {
    addCrmBookingAttendees(appointment.id, coHostIds)
  }

  const pushResult = await pushAppointmentToExternal(appointment)
  if (pushResult.status === 'conflict') {
    return {
      status: 'conflict_detected',
      appointment_id: appointment.id,
    }
  }

  try {
    queueCrmWorkflowRunsForTrigger({
      workspaceId,
      contactId,
      triggerType: 'appointment_booked',
      triggerValue: calendar.public_id,
    })
  } catch { /* keep booking resilient */ }

  return {
    status: 'booked',
    appointment_id: appointment.id,
    starts_at: new Date(appointment.starts_at * 1000).toISOString(),
    ends_at: new Date(appointment.ends_at * 1000).toISOString(),
    assigned_user_id: assignedUserId,
  }
}

async function toolTakeMessage(
  workspaceId: number,
  voiceContactId: number | null,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
  const urgency = typeof args.urgency === 'string' ? args.urgency.trim().toLowerCase() : 'normal'
  if (!summary) return { status: 'missing_summary' }
  if (!voiceContactId) return { status: 'no_contact' }

  try {
    createCrmContactActivity({
      contactId: voiceContactId,
      workspaceId,
      type: 'note',
      body: `Voicemail (AI): ${summary}`.slice(0, 2000),
    })
  } catch { /* swallow */ }

  if (urgency === 'high' || urgency === 'urgent') {
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId,
        contactId: voiceContactId,
        triggerType: 'urgent_message',
        triggerValue: 'high',
      })
    } catch { /* swallow */ }
  }

  return { status: 'recorded', urgency }
}

// ────────────────────────────────────────────────────────────────────────────
// call-end
// ────────────────────────────────────────────────────────────────────────────

async function handleCallEnd(workspaceId: number, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = extractCall(event)
  const vapiCallId = call.id
  if (!vapiCallId) return { status: 'missing_call_id' }

  const endedReason = typeof event.endedReason === 'string' ? event.endedReason
    : typeof call.endedReason === 'string' ? call.endedReason : null
  const summary = typeof event.summary === 'string' ? event.summary : null
  const transcriptText = extractTranscript(event)
  const recordingUrl = typeof event.recordingUrl === 'string' ? event.recordingUrl
    : typeof (event.artifact as Record<string, unknown> | undefined)?.recordingUrl === 'string'
      ? (event.artifact as { recordingUrl: string }).recordingUrl
      : null
  const endedAt = call.endedAt || new Date().toISOString()
  const startedAt = call.startedAt || null
  const durationSeconds = computeDurationSeconds(event, startedAt, endedAt)
  const costCents = computeCostCents(event)

  const updated = updateCrmVoiceCall(vapiCallId, {
    ended_reason: endedReason,
    summary,
    transcript_text: transcriptText,
    recording_url: recordingUrl,
    duration_seconds: durationSeconds,
    cost_cents: costCents,
    ended_at: endedAt,
    started_at: startedAt,
  })

  if (updated?.contact_id) {
    const summarySnippet = (summary || '').trim().slice(0, 200)
    const durationLabel = durationSeconds !== null ? `${durationSeconds} sec` : 'unknown duration'
    try {
      createCrmContactActivity({
        contactId: updated.contact_id,
        workspaceId,
        type: 'call',
        body: `AI voice call — ${durationLabel}${summarySnippet ? ' — ' + summarySnippet : ''}`.slice(0, 2000),
      })
    } catch { /* swallow */ }
    try {
      queueCrmWorkflowRunsForTrigger({
        workspaceId,
        contactId: updated.contact_id,
        triggerType: 'ai_call_completed',
      })
    } catch { /* swallow */ }
  }

  return { status: 'ok' }
}

// ────────────────────────────────────────────────────────────────────────────
// Availability computation (mirrors /api/calendars/:publicId/availability)
// ────────────────────────────────────────────────────────────────────────────

interface BusyBlock { starts_at: number; ends_at: number }

async function computeAvailability(calendar: CrmCalendarRecord, opts: {
  durationMinutes: number
  fromIso: string | null
  maxSlots: number
}): Promise<string[]> {
  const days = 14
  const fromDate = parseDayStartUTC(opts.fromIso) ?? startOfTodayUTC()
  const windowEnd = fromDate + days * 86_400
  const durationSec = Math.max(60, opts.durationMinutes * 60)
  const bufferSec = calendar.buffer_minutes * 60
  const stepSec = durationSec + bufferSec
  const nowSec = Math.floor(Date.now() / 1000)

  const taken = getCrmAppointments(calendar.workspace_id, {
    calendarId: calendar.id,
    from: fromDate,
    to: windowEnd,
    limit: 500,
  }).filter((a) => ['confirmed', 'showed', 'rescheduled'].includes(a.status))

  const hostIds = calendar.booking_mode === 'single'
    ? (calendar.owner_id ? [calendar.owner_id] : [])
    : calendar.host_user_ids
  const hostBusy = hostIds.length > 0
    ? getHostBusyBlocks(calendar.workspace_id, hostIds, fromDate, windowEnd)
    : new Map<number, BusyBlock[]>()
  const externalBusy = hostIds.length > 0
    ? await fetchFreeBusyMap({
        userIds: hostIds,
        workspaceId: calendar.workspace_id,
        startAt: fromDate,
        endAt: windowEnd,
      })
    : new Map<number, BusyBlock[]>()
  const globalBusy = getSyncedBusyEvents(fromDate, windowEnd)

  function hostFree(uid: number, s: number, e: number): boolean {
    const internalBlocks = hostBusy.get(uid) || []
    const externalBlocks = externalBusy.get(uid) || []
    return ![...internalBlocks, ...externalBlocks].some((b) => b.starts_at < e && b.ends_at > s)
  }

  const slots: string[] = []
  for (let dayOffset = 0; dayOffset < days && slots.length < opts.maxSlots; dayOffset += 1) {
    const dayStart = fromDate + dayOffset * 86_400
    const dow = new Date(dayStart * 1000).getUTCDay()
    const windows = calendar.weekly_hours[String(dow)] || []
    for (const [startMin, endMin] of windows) {
      const windowStart = dayStart + startMin * 60
      const windowEndSec = dayStart + endMin * 60
      for (let s = windowStart; s + durationSec <= windowEndSec && slots.length < opts.maxSlots; s += stepSec) {
        if (s < nowSec) continue
        const slotEnd = s + durationSec
        if (taken.some((a) => a.starts_at < slotEnd && a.ends_at > s)) continue
        if (globalBusy.some((b) => b.starts_at < slotEnd && b.ends_at > s)) continue
        if (calendar.booking_mode === 'round_robin') {
          if (hostIds.length === 0) continue
          if (!hostIds.some((uid) => hostFree(uid, s, slotEnd))) continue
        } else if (calendar.booking_mode === 'collective') {
          if (hostIds.length === 0) continue
          if (!hostIds.every((uid) => hostFree(uid, s, slotEnd))) continue
        } else {
          if (hostIds.length > 0 && !hostIds.every((uid) => hostFree(uid, s, slotEnd))) continue
        }
        slots.push(new Date(s * 1000).toISOString())
      }
    }
  }
  return slots
}

function getSyncedBusyEvents(fromSec: number, toSec: number): BusyBlock[] {
  const fromIso = new Date(fromSec * 1000).toISOString()
  const toIso = new Date(toSec * 1000).toISOString()
  try {
    const rows = getDb().prepare(`
      SELECT e.start_time, e.end_time
      FROM calendar_events e
      JOIN google_calendars g ON g.id = e.calendar_id
      WHERE g.use_for_conflicts = 1
        AND e.all_day = 0
        AND (e.status IS NULL OR e.status != 'cancelled')
        AND e.start_time < ?
        AND e.end_time > ?
    `).all(toIso, fromIso) as Array<{ start_time: string; end_time: string }>
    const out: BusyBlock[] = []
    for (const row of rows) {
      const s = Math.floor(new Date(row.start_time).getTime() / 1000)
      const e = Math.floor(new Date(row.end_time).getTime() / 1000)
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ starts_at: s, ends_at: e })
    }
    return out
  } catch {
    return []
  }
}

function parseDayStartUTC(iso: string | null): number | null {
  if (!iso) return null
  const parts = iso.split('T')[0].split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const [year, month, day] = parts
  return Math.floor(Date.UTC(year, month - 1, day) / 1000)
}

function startOfTodayUTC(): number {
  const now = new Date()
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000)
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

interface ExtractedCall {
  id: string | null
  fromNumber: string
  toNumber: string
  startedAt: string | null
  endedAt: string | null
  endedReason: string | null
  assistantId: string | null
}

function extractCall(event: Record<string, unknown>): ExtractedCall {
  const call = (event.call && typeof event.call === 'object') ? event.call as Record<string, unknown> : event
  const customer = (call.customer && typeof call.customer === 'object') ? call.customer as Record<string, unknown> : {}
  const phoneNumber = (call.phoneNumber && typeof call.phoneNumber === 'object') ? call.phoneNumber as Record<string, unknown> : {}
  const id = typeof call.id === 'string' ? call.id : null
  const fromNumber = typeof customer.number === 'string'
    ? customer.number
    : typeof call.customerNumber === 'string' ? call.customerNumber : ''
  const toNumber = typeof phoneNumber.number === 'string'
    ? phoneNumber.number
    : typeof call.toNumber === 'string' ? call.toNumber : ''
  const startedAt = typeof call.startedAt === 'string' ? call.startedAt : null
  const endedAt = typeof call.endedAt === 'string' ? call.endedAt : null
  const endedReason = typeof call.endedReason === 'string' ? call.endedReason : null
  const assistantId = typeof call.assistantId === 'string'
    ? call.assistantId
    : typeof (call.assistant as Record<string, unknown> | undefined)?.id === 'string'
      ? (call.assistant as { id: string }).id
      : null
  return { id, fromNumber, toNumber, startedAt, endedAt, endedReason, assistantId }
}

function pickFunctionCall(event: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } | null {
  const direct = event.functionCall
  if (direct && typeof direct === 'object') {
    const fc = direct as Record<string, unknown>
    return { name: String(fc.name || ''), arguments: parseArgs(fc.parameters ?? fc.arguments) }
  }
  if (Array.isArray(event.toolCalls) && event.toolCalls.length > 0) {
    const first = event.toolCalls[0] as Record<string, unknown>
    const fn = (first.function && typeof first.function === 'object') ? first.function as Record<string, unknown> : null
    if (fn) return { name: String(fn.name || ''), arguments: parseArgs(fn.arguments) }
  }
  return null
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {}
    } catch { return {} }
  }
  return {}
}

function resolveAgent(
  workspaceId: number,
  event: Record<string, unknown>,
  call: ExtractedCall,
): CrmVoiceAgent | null {
  if (call.assistantId) {
    const byAssistant = getCrmVoiceAgentByAssistantId(call.assistantId)
    if (byAssistant && byAssistant.workspace_id === workspaceId) return byAssistant
  }
  // If Vapi gave us the assistant inline, try its id too.
  const assistantBlock = (event.assistant && typeof event.assistant === 'object')
    ? event.assistant as Record<string, unknown>
    : null
  if (assistantBlock && typeof assistantBlock.id === 'string') {
    const byAssistant = getCrmVoiceAgentByAssistantId(assistantBlock.id)
    if (byAssistant && byAssistant.workspace_id === workspaceId) return byAssistant
  }
  return getActiveCrmVoiceAgentForWorkspace(workspaceId)
}

function resolveCalendar(workspaceId: number, slugOrId: string): CrmCalendarRecord | null {
  if (!slugOrId) return null
  // Try slug first (operator-facing), then public_id (the one in routes), then numeric id.
  const bySlug = getDb()
    .prepare('SELECT id FROM crm_calendars WHERE workspace_id = ? AND slug = ? LIMIT 1')
    .get(workspaceId, slugOrId) as { id: number } | undefined
  if (bySlug) return getCrmCalendarById(bySlug.id, workspaceId)
  const byPublic = getCrmCalendarByPublicId(slugOrId)
  if (byPublic && byPublic.workspace_id === workspaceId) return byPublic
  const asNumber = Number(slugOrId)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return getCrmCalendarById(asNumber, workspaceId)
  }
  return null
}

function extractTranscript(event: Record<string, unknown>): string | null {
  if (typeof event.transcript === 'string') return event.transcript
  if (Array.isArray(event.messages)) {
    const lines = event.messages
      .filter((m): m is { role: string; message?: string; content?: string } => !!m && typeof m === 'object')
      .map((m) => {
        const role = typeof m.role === 'string' ? m.role : 'system'
        const text = typeof m.message === 'string' ? m.message
          : typeof m.content === 'string' ? m.content : ''
        return `[${role}] ${text}`
      })
      .filter((line) => line.trim().length > 0)
    if (lines.length > 0) return lines.join('\n')
  }
  const artifact = (event.artifact && typeof event.artifact === 'object')
    ? event.artifact as Record<string, unknown>
    : null
  if (artifact && typeof artifact.transcript === 'string') return artifact.transcript
  return null
}

function computeDurationSeconds(event: Record<string, unknown>, startedAt: string | null, endedAt: string | null): number | null {
  if (typeof event.durationSeconds === 'number' && Number.isFinite(event.durationSeconds)) {
    return Math.max(0, Math.floor(event.durationSeconds))
  }
  if (startedAt && endedAt) {
    const s = Date.parse(startedAt)
    const e = Date.parse(endedAt)
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) return Math.floor((e - s) / 1000)
  }
  return null
}

function computeCostCents(event: Record<string, unknown>): number | null {
  const cost = event.cost
  if (typeof cost === 'number' && Number.isFinite(cost)) {
    return Math.round(cost * 100)
  }
  return null
}

function verifySignature(request: NextRequest, rawBody: string): boolean {
  const secret = (process.env.VAPI_WEBHOOK_SECRET || '').trim()
  if (!secret) return true // dev mode
  const signature = (request.headers.get('x-vapi-signature') || '').trim()
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return timingSafeEqualHex(expected, signature)
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

function safeJson(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    return (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function ok(body: Record<string, unknown>) {
  return NextResponse.json({ received: true, ...body }, { status: 200 })
}
