import crypto from 'crypto'
import {
  generatePublicId,
  getCrmAppointments,
  getCrmCalendarById,
  getDb,
  getHostBusyBlocks,
  updateCrmAppointmentStatus,
  writeAuditLog,
  type CrmAppointment,
  type CrmCalendarRecord,
} from './db'
import { encryptToken } from './supabase'
import { notifyUser } from './user-notify'

export type CalendarProvider = 'google' | 'microsoft' | 'icloud' | 'ical_url'
export type CalendarSyncDirection = 'both' | 'push_only' | 'pull_only' | 'none'
export type CalendarSyncLogDirection = 'pull' | 'push' | 'reconcile' | 'manual'
export type ExternalCalendarEventStatus = 'busy' | 'free' | 'tentative' | 'cancelled'

export interface CalendarConnectionSelection {
  id: string
  name: string
  selected: boolean
  push: boolean
  primary: boolean
  read_only: boolean
}

interface CalendarConnectionRow {
  id: number
  user_id: number
  workspace_id: number
  provider: CalendarProvider
  provider_account_id: string
  display_email: string | null
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_expires_at: number | null
  ical_url: string | null
  sync_direction: CalendarSyncDirection
  last_synced_at: number | null
  last_sync_error: string | null
  calendars_json: string
  is_primary_for_bookings: number
  connected_at: number
  disconnected_at: number | null
}

export interface CalendarConnectionRecord extends Omit<CalendarConnectionRow, 'calendars_json'> {
  calendars: CalendarConnectionSelection[]
  has_access_token: boolean
  has_refresh_token: boolean
}

interface ExternalEventRow {
  id: number
  calendar_account_id: number
  user_id: number
  workspace_id: number
  external_id: string
  calendar_external_id: string | null
  title: string | null
  start_at: number
  end_at: number
  tz: string | null
  all_day: number
  status: ExternalCalendarEventStatus
  source_etag: string | null
  last_updated_at: number
  crm_appointment_id: number | null
}

export interface ExternalCalendarEventRecord extends ExternalEventRow {
  all_day: number
}

export interface CalendarSyncLogRecord {
  id: number
  calendar_account_id: number
  direction: CalendarSyncLogDirection
  success: number
  error: string | null
  events_changed: number
  ran_at: number
}

export interface BusyInterval {
  starts_at: number
  ends_at: number
  calendar_account_id: number
  external_id: string
  status: ExternalCalendarEventStatus
  crm_appointment_id: number | null
}

export interface PullExternalEventInput {
  external_id: string
  calendar_external_id: string | null
  title: string | null
  start_at: number
  end_at: number
  tz: string | null
  all_day: boolean
  status: ExternalCalendarEventStatus
  source_etag?: string | null
  last_updated_at?: number | null
  crm_appointment_id?: number | null
}

export interface CreateCalendarConnectionInput {
  userId: number
  workspaceId: number
  provider: CalendarProvider
  providerAccountId: string
  displayEmail?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: number | null
  icalUrl?: string | null
  syncDirection?: CalendarSyncDirection
  calendars?: CalendarConnectionSelection[]
  isPrimaryForBookings?: boolean
}

export interface UpdateCalendarConnectionInput {
  displayEmail?: string | null
  icalUrl?: string | null
  syncDirection?: CalendarSyncDirection
  calendars?: CalendarConnectionSelection[]
  isPrimaryForBookings?: boolean
}

export interface FetchFreeBusyInput {
  userId: number
  workspaceId?: number
  startAt: number
  endAt: number
  forceRefresh?: boolean
}

export interface FetchFreeBusyMapInput {
  userIds: number[]
  workspaceId?: number
  startAt: number
  endAt: number
  forceRefresh?: boolean
}

export interface PushAppointmentResult {
  status: 'pushed' | 'conflict' | 'no_assignee' | 'no_primary_account' | 'noop'
  eventId?: number
  message?: string
}

const SYNC_STALE_SECONDS = 60
const FEED_LOOKBACK_SECONDS = 90 * 86_400
const FEED_LOOKAHEAD_SECONDS = 365 * 86_400

function parseSelections(json: string | null, provider: CalendarProvider): CalendarConnectionSelection[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return normalizeSelections(parsed as Array<Record<string, unknown>>, provider)
  } catch {
    return []
  }
}

function normalizeSelections(
  selections: Array<Record<string, unknown>> | CalendarConnectionSelection[],
  provider: CalendarProvider,
): CalendarConnectionSelection[] {
  const out: CalendarConnectionSelection[] = []
  const seen = new Set<string>()
  for (const raw of selections) {
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name,
      selected: Boolean(raw.selected),
      push: Boolean(raw.push),
      primary: Boolean(raw.primary),
      read_only: provider === 'ical_url' ? true : Boolean(raw.read_only),
    })
  }
  if (provider === 'ical_url') {
    for (const item of out) {
      item.push = false
      item.read_only = true
    }
  } else {
    let pushAssigned = false
    for (const item of out) {
      if (!item.selected) item.push = false
      if (item.push) {
        if (pushAssigned) item.push = false
        pushAssigned = item.push
      }
    }
    if (!pushAssigned) {
      const firstSelected = out.find((item) => item.selected)
      if (firstSelected) firstSelected.push = true
    }
  }
  let primaryAssigned = false
  for (const item of out) {
    if (item.primary) {
      if (primaryAssigned) item.primary = false
      primaryAssigned = item.primary
    }
  }
  if (!primaryAssigned && out[0]) out[0].primary = true
  return out
}

function defaultSelections(provider: CalendarProvider, label: string): CalendarConnectionSelection[] {
  if (provider === 'ical_url') {
    return [{ id: 'feed', name: label, selected: true, push: false, primary: true, read_only: true }]
  }
  if (provider === 'icloud') {
    return [{ id: 'icloud-primary', name: label, selected: true, push: true, primary: true, read_only: false }]
  }
  return [{ id: 'primary', name: label, selected: true, push: true, primary: true, read_only: false }]
}

function toRecord(row: CalendarConnectionRow): CalendarConnectionRecord {
  return {
    ...row,
    calendars: parseSelections(row.calendars_json, row.provider),
    has_access_token: Boolean(row.access_token_encrypted),
    has_refresh_token: Boolean(row.refresh_token_encrypted),
  }
}

function applyPrimaryAccount(db: ReturnType<typeof getDb>, userId: number, workspaceId: number, accountId: number) {
  db.prepare(
    'UPDATE crm_user_calendar_accounts SET is_primary_for_bookings = 0 WHERE user_id = ? AND workspace_id = ? AND disconnected_at IS NULL AND id != ?',
  ).run(userId, workspaceId, accountId)
  db.prepare(
    'UPDATE crm_user_calendar_accounts SET is_primary_for_bookings = 1 WHERE id = ?',
  ).run(accountId)
}

function buildConnectionWhere(mode?: 'pull' | 'push') {
  const clauses = ['disconnected_at IS NULL']
  if (mode === 'pull') clauses.push("sync_direction IN ('both','pull_only')")
  if (mode === 'push') clauses.push("sync_direction IN ('both','push_only')")
  return clauses.join(' AND ')
}

export function listCalendarConnectionsForUser(userId: number, workspaceId: number): CalendarConnectionRecord[] {
  const rows = getDb().prepare(`
    SELECT *
    FROM crm_user_calendar_accounts
    WHERE user_id = ? AND workspace_id = ? AND disconnected_at IS NULL
    ORDER BY is_primary_for_bookings DESC, connected_at DESC, id DESC
  `).all(userId, workspaceId) as CalendarConnectionRow[]
  return rows.map(toRecord)
}

export function getCalendarConnectionById(id: number, userId: number, workspaceId: number): CalendarConnectionRecord | null {
  const row = getDb().prepare(`
    SELECT *
    FROM crm_user_calendar_accounts
    WHERE id = ? AND user_id = ? AND workspace_id = ?
  `).get(id, userId, workspaceId) as CalendarConnectionRow | undefined
  if (!row || row.disconnected_at) return null
  return toRecord(row)
}

export function createCalendarConnection(input: CreateCalendarConnectionInput): CalendarConnectionRecord {
  const db = getDb()
  const calendars = normalizeSelections(
    (input.calendars && input.calendars.length > 0 ? input.calendars : defaultSelections(input.provider, input.provider === 'ical_url' ? 'Subscribed feed' : 'Primary')) as CalendarConnectionSelection[],
    input.provider,
  )
  const syncDirection = input.syncDirection ?? (input.provider === 'ical_url' ? 'pull_only' : 'both')
  const result = db.prepare(`
    INSERT INTO crm_user_calendar_accounts (
      user_id, workspace_id, provider, provider_account_id, display_email,
      access_token_encrypted, refresh_token_encrypted, token_expires_at,
      ical_url, sync_direction, calendars_json, is_primary_for_bookings,
      connected_at, disconnected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    input.userId,
    input.workspaceId,
    input.provider,
    input.providerAccountId,
    input.displayEmail ?? null,
    input.accessToken ? encryptToken(input.accessToken) : null,
    input.refreshToken ? encryptToken(input.refreshToken) : null,
    input.tokenExpiresAt ?? null,
    input.icalUrl ?? null,
    syncDirection,
    JSON.stringify(calendars),
    input.isPrimaryForBookings ? 1 : 0,
    Math.floor(Date.now() / 1000),
  )
  const accountId = Number(result.lastInsertRowid)
  if (input.isPrimaryForBookings) applyPrimaryAccount(db, input.userId, input.workspaceId, accountId)
  return getCalendarConnectionById(accountId, input.userId, input.workspaceId) as CalendarConnectionRecord
}

export function updateCalendarConnection(
  id: number,
  userId: number,
  workspaceId: number,
  patch: UpdateCalendarConnectionInput,
): CalendarConnectionRecord | null {
  const existing = getCalendarConnectionById(id, userId, workspaceId)
  if (!existing) return null
  const sets: string[] = []
  const params: Array<string | number | null> = []
  if ('displayEmail' in patch) {
    sets.push('display_email = ?')
    params.push(patch.displayEmail?.trim() || null)
  }
  if ('icalUrl' in patch) {
    sets.push('ical_url = ?')
    params.push(patch.icalUrl?.trim() || null)
  }
  if (patch.syncDirection) {
    sets.push('sync_direction = ?')
    params.push(patch.syncDirection)
  }
  if (patch.calendars) {
    sets.push('calendars_json = ?')
    params.push(JSON.stringify(normalizeSelections(patch.calendars, existing.provider)))
  }
  if (patch.isPrimaryForBookings !== undefined) {
    sets.push('is_primary_for_bookings = ?')
    params.push(patch.isPrimaryForBookings ? 1 : 0)
  }
  if (!sets.length) return existing
  params.push(id, userId, workspaceId)
  getDb().prepare(`
    UPDATE crm_user_calendar_accounts
    SET ${sets.join(', ')}
    WHERE id = ? AND user_id = ? AND workspace_id = ?
  `).run(...params)
  if (patch.isPrimaryForBookings) applyPrimaryAccount(getDb(), userId, workspaceId, id)
  return getCalendarConnectionById(id, userId, workspaceId)
}

export function disconnectCalendarConnection(id: number, userId: number, workspaceId: number): boolean {
  const result = getDb().prepare(`
    UPDATE crm_user_calendar_accounts
    SET disconnected_at = ?, is_primary_for_bookings = 0
    WHERE id = ? AND user_id = ? AND workspace_id = ? AND disconnected_at IS NULL
  `).run(Math.floor(Date.now() / 1000), id, userId, workspaceId)
  return result.changes > 0
}

function listActiveConnectionsForUser(
  userId: number,
  workspaceId: number | undefined,
  mode: 'pull' | 'push',
): CalendarConnectionRecord[] {
  const clauses = ['user_id = ?', buildConnectionWhere(mode)]
  const params: Array<number> = [userId]
  if (workspaceId) {
    clauses.push('workspace_id = ?')
    params.push(workspaceId)
  }
  const rows = getDb().prepare(`
    SELECT *
    FROM crm_user_calendar_accounts
    WHERE ${clauses.join(' AND ')}
    ORDER BY is_primary_for_bookings DESC, connected_at DESC, id DESC
  `).all(...params) as CalendarConnectionRow[]
  return rows.map(toRecord)
}

function listActiveConnectionsForWorkspace(workspaceId?: number): CalendarConnectionRecord[] {
  const clauses = [buildConnectionWhere('pull')]
  const params: Array<number> = []
  if (workspaceId) {
    clauses.push('workspace_id = ?')
    params.push(workspaceId)
  }
  const rows = getDb().prepare(`
    SELECT *
    FROM crm_user_calendar_accounts
    WHERE ${clauses.join(' AND ')}
    ORDER BY connected_at DESC, id DESC
  `).all(...params) as CalendarConnectionRow[]
  return rows.map(toRecord)
}

function enabledCalendarIds(account: CalendarConnectionRecord): Set<string> | null {
  const enabled = account.calendars.filter((item) => item.selected).map((item) => item.id)
  return enabled.length > 0 ? new Set(enabled) : null
}

function pickPushCalendar(account: CalendarConnectionRecord): CalendarConnectionSelection | null {
  return account.calendars.find((item) => item.selected && item.push) || account.calendars.find((item) => item.selected) || account.calendars[0] || null
}

function getPrimaryPushAccount(userId: number, workspaceId: number): CalendarConnectionRecord | null {
  return listActiveConnectionsForUser(userId, workspaceId, 'push').find((item) => item.is_primary_for_bookings === 1) || null
}

function recordCalendarSync(
  accountId: number,
  direction: CalendarSyncLogDirection,
  success: boolean,
  error: string | null,
  eventsChanged: number,
) {
  const db = getDb()
  const ranAt = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO crm_calendar_sync_log (calendar_account_id, direction, success, error, events_changed, ran_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(accountId, direction, success ? 1 : 0, error, eventsChanged, ranAt)
  db.prepare(`
    UPDATE crm_user_calendar_accounts
    SET last_synced_at = ?, last_sync_error = ?
    WHERE id = ?
  `).run(ranAt, success ? null : error, accountId)
}

export function listCalendarSyncLogs(accountId: number, limit = 20): CalendarSyncLogRecord[] {
  return getDb().prepare(`
    SELECT *
    FROM crm_calendar_sync_log
    WHERE calendar_account_id = ?
    ORDER BY ran_at DESC, id DESC
    LIMIT ?
  `).all(accountId, Math.max(1, Math.min(100, limit))) as CalendarSyncLogRecord[]
}

function upsertExternalEvents(account: CalendarConnectionRecord, events: PullExternalEventInput[]): number {
  if (events.length === 0) return 0
  const insert = getDb().prepare(`
    INSERT INTO crm_external_events (
      calendar_account_id, user_id, workspace_id, external_id, calendar_external_id,
      title, start_at, end_at, tz, all_day, status, source_etag, last_updated_at, crm_appointment_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(calendar_account_id, external_id) DO UPDATE SET
      calendar_external_id = excluded.calendar_external_id,
      title = excluded.title,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      tz = excluded.tz,
      all_day = excluded.all_day,
      status = excluded.status,
      source_etag = excluded.source_etag,
      last_updated_at = excluded.last_updated_at,
      crm_appointment_id = excluded.crm_appointment_id
  `)
  let changed = 0
  for (const event of events) {
    const result = insert.run(
      account.id,
      account.user_id,
      account.workspace_id,
      event.external_id,
      event.calendar_external_id,
      event.title ?? null,
      event.start_at,
      event.end_at,
      event.tz ?? null,
      event.all_day ? 1 : 0,
      event.status,
      event.source_etag ?? null,
      event.last_updated_at ?? Math.floor(Date.now() / 1000),
      event.crm_appointment_id ?? null,
    )
    changed += Number(result.changes || 0)
  }
  return changed
}

export async function pullExternalEvents(account: CalendarConnectionRecord): Promise<PullExternalEventInput[]> {
  console.info(`[calendar-sync] TODO pull provider changes for ${account.provider} account ${account.id}`)
  return []
}

async function reconcileAccount(
  account: CalendarConnectionRecord,
  direction: CalendarSyncLogDirection,
): Promise<{ success: boolean; eventsChanged: number; error: string | null }> {
  try {
    const events = await pullExternalEvents(account)
    const eventsChanged = upsertExternalEvents(account, events)
    recordCalendarSync(account.id, direction, true, null, eventsChanged)
    return { success: true, eventsChanged, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Calendar sync failed'
    recordCalendarSync(account.id, direction, false, message, 0)
    return { success: false, eventsChanged: 0, error: message }
  }
}

export async function fetchFreeBusy(input: FetchFreeBusyInput): Promise<BusyInterval[]> {
  const accounts = listActiveConnectionsForUser(input.userId, input.workspaceId, 'pull')
  if (accounts.length === 0) return []
  const now = Math.floor(Date.now() / 1000)
  const stale = input.forceRefresh
    ? accounts
    : accounts.filter((account) => !account.last_synced_at || now - account.last_synced_at > SYNC_STALE_SECONDS)
  if (stale.length > 0) {
    await Promise.all(stale.map((account) => reconcileAccount(account, 'pull')))
  }
  const placeholders = accounts.map(() => '?').join(',')
  const accountIds = accounts.map((account) => account.id)
  const rows = getDb().prepare(`
    SELECT *
    FROM crm_external_events
    WHERE calendar_account_id IN (${placeholders})
      AND start_at < ?
      AND end_at > ?
      AND status IN ('busy','tentative')
    ORDER BY start_at ASC, end_at ASC
  `).all(...accountIds, input.endAt, input.startAt) as ExternalEventRow[]
  const allowedCalendars = new Map<number, Set<string> | null>()
  for (const account of accounts) allowedCalendars.set(account.id, enabledCalendarIds(account))
  return rows
    .filter((row) => {
      const enabled = allowedCalendars.get(row.calendar_account_id) ?? null
      if (!enabled) return true
      return row.calendar_external_id ? enabled.has(row.calendar_external_id) : true
    })
    .map((row) => ({
      starts_at: row.start_at,
      ends_at: row.end_at,
      calendar_account_id: row.calendar_account_id,
      external_id: row.external_id,
      status: row.status,
      crm_appointment_id: row.crm_appointment_id,
    }))
}

export async function fetchFreeBusyMap(input: FetchFreeBusyMapInput): Promise<Map<number, BusyInterval[]>> {
  const out = new Map<number, BusyInterval[]>()
  const uniqueUserIds = Array.from(new Set(input.userIds.filter((value) => Number.isFinite(value) && value > 0)))
  if (uniqueUserIds.length === 0) return out
  const results = await Promise.all(uniqueUserIds.map(async (userId) => ({
    userId,
    intervals: await fetchFreeBusy({
      userId,
      workspaceId: input.workspaceId,
      startAt: input.startAt,
      endAt: input.endAt,
      forceRefresh: input.forceRefresh,
    }),
  })))
  for (const result of results) out.set(result.userId, result.intervals)
  return out
}

export interface NextAvailableSlot {
  startsSec: number
  endsSec: number
  /** Host ids that are free at the returned slot. Empty when the calendar has no roster. */
  freeHostIds: number[]
}

/**
 * Find the first bookable slot on a calendar within the given horizon.
 *
 * Mirrors GET /api/calendars/:publicId/availability: iterates weekly_hours
 * windows, steps by duration+buffer, rejects slots colliding with calendar-local
 * appointments, global synced busy, and per-host busy (internal + external).
 * For round_robin/collective modes the returned slot satisfies the mode's
 * host-free predicate; the caller picks the final assignee.
 *
 * Returns null when no slot is free in the window.
 */
export async function findNextAvailableSlot(
  calendar: CrmCalendarRecord,
  fromSec: number,
  maxDays: number,
): Promise<NextAvailableSlot | null> {
  const days = Math.max(1, Math.min(60, Math.floor(maxDays)))
  const windowStart = Math.max(fromSec, Math.floor(Date.now() / 1000))
  const windowEnd = fromSec + days * 86_400

  const durationSec = calendar.duration_minutes * 60
  const bufferSec = calendar.buffer_minutes * 60
  const stepSec = durationSec + bufferSec

  const taken = getCrmAppointments(calendar.workspace_id, {
    calendarId: calendar.id,
    from: fromSec,
    to: windowEnd,
    limit: 500,
  }).filter((a) => ['confirmed', 'showed', 'rescheduled'].includes(a.status))

  const hostIds = calendar.booking_mode === 'single'
    ? (calendar.owner_id ? [calendar.owner_id] : [])
    : calendar.host_user_ids

  const hostBusy = hostIds.length > 0
    ? getHostBusyBlocks(calendar.workspace_id, hostIds, fromSec, windowEnd)
    : new Map<number, Array<{ starts_at: number; ends_at: number }>>()
  const externalBusy = hostIds.length > 0
    ? await fetchFreeBusyMap({
        userIds: hostIds,
        workspaceId: calendar.workspace_id,
        startAt: fromSec,
        endAt: windowEnd,
      })
    : new Map<number, BusyInterval[]>()
  const globalBusy = getSyncedBusyEventsBlocks(fromSec, windowEnd)

  function hostFree(uid: number, s: number, e: number): boolean {
    const internalBlocks = hostBusy.get(uid) || []
    const externalBlocks = externalBusy.get(uid) || []
    return ![...internalBlocks, ...externalBlocks].some((b) => b.starts_at < e && b.ends_at > s)
  }

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const dayStart = fromSec + dayOffset * 86_400
    const dow = new Date(dayStart * 1000).getUTCDay()
    const windows = calendar.weekly_hours[String(dow)] || []
    for (const [startMin, endMin] of windows) {
      const wStart = dayStart + startMin * 60
      const wEnd = dayStart + endMin * 60
      for (let s = wStart; s + durationSec <= wEnd; s += stepSec) {
        if (s < windowStart) continue
        const slotEnd = s + durationSec

        if (taken.some((a) => a.starts_at < slotEnd && a.ends_at > s)) continue
        if (globalBusy.some((b) => b.starts_at < slotEnd && b.ends_at > s)) continue

        let freeHostIds: number[] = []
        if (calendar.booking_mode === 'round_robin') {
          if (hostIds.length === 0) continue
          freeHostIds = hostIds.filter((uid) => hostFree(uid, s, slotEnd))
          if (freeHostIds.length === 0) continue
        } else if (calendar.booking_mode === 'collective') {
          if (hostIds.length === 0) continue
          if (!hostIds.every((uid) => hostFree(uid, s, slotEnd))) continue
          freeHostIds = hostIds.slice()
        } else {
          // single — check owner if we have one, else accept.
          if (hostIds.length > 0 && !hostIds.every((uid) => hostFree(uid, s, slotEnd))) continue
          freeHostIds = hostIds.slice()
        }

        return { startsSec: s, endsSec: slotEnd, freeHostIds }
      }
    }
  }

  return null
}

/**
 * Global busy events from every Google-synced calendar flagged use_for_conflicts.
 * Ported inline so findNextAvailableSlot doesn't depend on the availability
 * route module. Event times are ISO strings; we convert to epoch seconds.
 */
function getSyncedBusyEventsBlocks(fromSec: number, toSec: number): Array<{ starts_at: number; ends_at: number }> {
  const fromIso = new Date(fromSec * 1000).toISOString()
  const toIso = new Date(toSec * 1000).toISOString()
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

  const out: Array<{ starts_at: number; ends_at: number }> = []
  for (const row of rows) {
    const s = Math.floor(new Date(row.start_time).getTime() / 1000)
    const e = Math.floor(new Date(row.end_time).getTime() / 1000)
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      out.push({ starts_at: s, ends_at: e })
    }
  }
  return out
}

function findAppointmentMirror(appointmentId: number, accountId: number): ExternalEventRow | null {
  const row = getDb().prepare(`
    SELECT *
    FROM crm_external_events
    WHERE crm_appointment_id = ? AND calendar_account_id = ?
    LIMIT 1
  `).get(appointmentId, accountId) as ExternalEventRow | undefined
  return row ?? null
}

export async function pushAppointmentToExternal(appointment: CrmAppointment): Promise<PushAppointmentResult> {
  const calendar = getCrmCalendarById(appointment.calendar_id, appointment.workspace_id)
  if (!calendar) return { status: 'noop', message: 'Calendar not found' }
  const assigneeId = appointment.assigned_user_id ?? calendar.owner_id ?? null
  if (!assigneeId) return { status: 'no_assignee', message: 'Booking has no assignee' }

  const account = getPrimaryPushAccount(assigneeId, appointment.workspace_id)
  if (!account) return { status: 'no_primary_account', message: 'No primary push calendar connected' }

  const existingMirror = findAppointmentMirror(appointment.id, account.id)
  if (existingMirror) {
    return { status: 'pushed', eventId: existingMirror.id }
  }

  const blockers = (await fetchFreeBusy({
    userId: assigneeId,
    workspaceId: appointment.workspace_id,
    startAt: appointment.starts_at,
    endAt: appointment.ends_at,
    forceRefresh: true,
  })).filter((interval) => interval.crm_appointment_id !== appointment.id)

  if (blockers.some((interval) => interval.starts_at < appointment.ends_at && interval.ends_at > appointment.starts_at)) {
    updateCrmAppointmentStatus(appointment.id, appointment.workspace_id, 'conflict_detected')
    const message = 'External calendar conflict detected before booking push'
    writeAuditLog({
      workspaceId: appointment.workspace_id,
      entity: 'crm_appointment',
      entityId: appointment.id,
      action: 'calendar_push_conflict',
      summary: message,
      payload: {
        calendar_account_id: account.id,
        blocker_count: blockers.length,
      },
    })
    notifyUser({
      user_id: assigneeId,
      workspace_id: appointment.workspace_id,
      kind: 'appointment_conflict',
      title: 'Appointment conflict detected',
      body: `A connected ${account.provider} calendar filled this slot before the CRM booking could be pushed.`,
      href: '/crm/appointments',
      entity: 'appointment',
      entity_id: appointment.id,
    })
    return { status: 'conflict', message }
  }

  const contact = appointment.contact_id
    ? (getDb().prepare('SELECT name, email FROM crm_contacts WHERE id = ?').get(appointment.contact_id) as { name: string | null; email: string | null } | undefined)
    : undefined
  const targetCalendar = pickPushCalendar(account)
  const title = contact?.name || contact?.email || calendar.name
  const result = getDb().prepare(`
    INSERT INTO crm_external_events (
      calendar_account_id, user_id, workspace_id, external_id, calendar_external_id,
      title, start_at, end_at, tz, all_day, status, source_etag, last_updated_at, crm_appointment_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'busy', ?, ?, ?)
  `).run(
    account.id,
    account.user_id,
    account.workspace_id,
    `crm-${appointment.id}-${generatePublicId()}`,
    targetCalendar?.id ?? null,
    title,
    appointment.starts_at,
    appointment.ends_at,
    calendar.timezone,
    null,
    Math.floor(Date.now() / 1000),
    appointment.id,
  )
  recordCalendarSync(account.id, 'push', true, null, 1)
  return { status: 'pushed', eventId: Number(result.lastInsertRowid) }
}

export async function reconcile(options?: { workspaceId?: number; accountId?: number; direction?: CalendarSyncLogDirection }) {
  let accounts = options?.accountId
    ? (() => {
        const row = getDb().prepare('SELECT * FROM crm_user_calendar_accounts WHERE id = ? AND disconnected_at IS NULL').get(options.accountId) as CalendarConnectionRow | undefined
        return row ? [toRecord(row)] : []
      })()
    : listActiveConnectionsForWorkspace(options?.workspaceId)
  if (accounts.length === 0) return []
  return Promise.all(accounts.map((account) => reconcileAccount(account, options?.direction ?? 'reconcile')))
}

export async function syncCalendarConnectionNow(id: number, userId: number, workspaceId: number) {
  const account = getCalendarConnectionById(id, userId, workspaceId)
  if (!account) return null
  await reconcile({ accountId: id, direction: 'manual' })
  return getCalendarConnectionById(id, userId, workspaceId)
}

function generateIcalToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

export function getOrCreateUserIcalToken(userId: number): string | null {
  const existing = getDb().prepare('SELECT crm_ical_token FROM users WHERE id = ?').get(userId) as { crm_ical_token: string | null } | undefined
  if (!existing) return null
  if (existing.crm_ical_token) return existing.crm_ical_token
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateIcalToken()
    const alreadyUsed = getDb().prepare('SELECT id FROM users WHERE crm_ical_token = ?').get(token) as { id: number } | undefined
    if (alreadyUsed) continue
    const result = getDb().prepare('UPDATE users SET crm_ical_token = ? WHERE id = ? AND crm_ical_token IS NULL').run(token, userId)
    if (result.changes > 0) return token
    const retry = getDb().prepare('SELECT crm_ical_token FROM users WHERE id = ?').get(userId) as { crm_ical_token: string | null } | undefined
    if (retry?.crm_ical_token) return retry.crm_ical_token
  }
  return null
}

function escapeIcal(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function toIcalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function toIcalDateOnly(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function generateUserIcalFeed(userIcalToken: string, options?: { includeTasks?: boolean }): { filename: string; body: string } | null {
  const user = getDb().prepare('SELECT id, name, email FROM users WHERE crm_ical_token = ?').get(userIcalToken) as { id: number; name: string; email: string } | undefined
  if (!user) return null
  const now = Math.floor(Date.now() / 1000)
  const appointments = getDb().prepare(`
    SELECT DISTINCT
      a.id,
      a.starts_at,
      a.ends_at,
      a.notes,
      cal.name AS calendar_name,
      cal.timezone AS calendar_timezone,
      c.name AS contact_name,
      c.email AS contact_email
    FROM crm_appointments a
    JOIN crm_calendars cal ON cal.id = a.calendar_id
    LEFT JOIN crm_contacts c ON c.id = a.contact_id
    LEFT JOIN crm_booking_attendees ba ON ba.booking_id = a.id
    WHERE (a.assigned_user_id = ? OR ba.user_id = ?)
      AND a.status IN ('confirmed','showed','rescheduled')
      AND a.starts_at >= ?
      AND a.starts_at <= ?
    ORDER BY a.starts_at ASC
  `).all(user.id, user.id, now - FEED_LOOKBACK_SECONDS, now + FEED_LOOKAHEAD_SECONDS) as Array<{
    id: number
    starts_at: number
    ends_at: number
    notes: string | null
    calendar_name: string
    calendar_timezone: string | null
    contact_name: string | null
    contact_email: string | null
  }>

  const includeTasks = Boolean(options?.includeTasks)
  const tasks = includeTasks
    ? getDb().prepare(`
        SELECT id, title, scheduled_start, scheduled_end, priority, status
        FROM tasks
        WHERE deleted_at IS NULL
          AND status NOT IN ('done','cancelled','archived')
          AND scheduled_start IS NOT NULL
          AND scheduled_end IS NOT NULL
          AND (assignee = ? OR assignee = ?)
          AND scheduled_start >= ?
          AND scheduled_start <= ?
        ORDER BY scheduled_start ASC
      `).all(
        user.name,
        user.email,
        new Date((now - FEED_LOOKBACK_SECONDS) * 1000).toISOString(),
        new Date((now + FEED_LOOKAHEAD_SECONDS) * 1000).toISOString(),
      ) as Array<{
        id: number
        title: string
        scheduled_start: string
        scheduled_end: string
        priority: string
        status: string
      }>
    : []

  let body = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Motion Lite//CRM//EN\r\n'
  body += `X-WR-CALNAME:${escapeIcal(`${user.name} CRM`)}\r\n`

  for (const appointment of appointments) {
    const dtStart = new Date(appointment.starts_at * 1000)
    const dtEnd = new Date(appointment.ends_at * 1000)
    const summary = appointment.contact_name || appointment.contact_email || appointment.calendar_name
    body += 'BEGIN:VEVENT\r\n'
    body += `UID:crm-appointment-${appointment.id}@ctrlmotion\r\n`
    body += `DTSTART:${toIcalDate(dtStart)}\r\n`
    body += `DTEND:${toIcalDate(dtEnd)}\r\n`
    body += `SUMMARY:${escapeIcal(summary)}\r\n`
    body += `CATEGORIES:CRM Appointment\r\n`
    body += 'TRANSP:OPAQUE\r\n'
    if (appointment.notes) body += `DESCRIPTION:${escapeIcal(appointment.notes)}\r\n`
    if (appointment.calendar_timezone) body += `X-CTRL-TIMEZONE:${escapeIcal(appointment.calendar_timezone)}\r\n`
    body += 'END:VEVENT\r\n'
  }

  for (const task of tasks) {
    const dtStart = new Date(task.scheduled_start)
    const dtEnd = new Date(task.scheduled_end)
    body += 'BEGIN:VEVENT\r\n'
    body += `UID:task-${task.id}@ctrlmotion\r\n`
    body += `DTSTART:${toIcalDate(dtStart)}\r\n`
    body += `DTEND:${toIcalDate(dtEnd)}\r\n`
    body += `SUMMARY:${escapeIcal(`[Task] ${task.title}`)}\r\n`
    body += `DESCRIPTION:${escapeIcal(`Priority: ${task.priority}\nStatus: ${task.status}`)}\r\n`
    body += 'CATEGORIES:Task\r\n'
    body += 'TRANSP:OPAQUE\r\n'
    body += 'END:VEVENT\r\n'
  }

  if (appointments.length === 0 && tasks.length === 0) {
    const today = new Date()
    body += 'BEGIN:VEVENT\r\n'
    body += `UID:empty-${user.id}@ctrlmotion\r\n`
    body += `DTSTART;VALUE=DATE:${toIcalDateOnly(today)}\r\n`
    body += `DTEND;VALUE=DATE:${toIcalDateOnly(new Date(today.getTime() + 86_400_000))}\r\n`
    body += 'SUMMARY:No upcoming CRM events\r\n'
    body += 'TRANSP:TRANSPARENT\r\n'
    body += 'END:VEVENT\r\n'
  }

  body += 'END:VCALENDAR\r\n'
  return {
    filename: `${user.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'calendar'}.ics`,
    body,
  }
}

export function createStubOAuthCalendarConnection(input: {
  provider: 'google' | 'microsoft'
  userId: number
  workspaceId: number
  displayEmail: string
}) {
  return createCalendarConnection({
    userId: input.userId,
    workspaceId: input.workspaceId,
    provider: input.provider,
    providerAccountId: `${input.provider}-${generatePublicId()}`,
    displayEmail: input.displayEmail,
    accessToken: `todo-${input.provider}-access-token`,
    refreshToken: `todo-${input.provider}-refresh-token`,
    tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    syncDirection: 'both',
    calendars: defaultSelections(input.provider, 'Primary'),
    isPrimaryForBookings: listCalendarConnectionsForUser(input.userId, input.workspaceId).length === 0,
  })
}
