import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), '..', 'store', 'motion.db')

let _db: Database.Database

function getDb(): Database.Database {
  if (!_db || !_db.open) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('busy_timeout = 5000')
    _db.pragma('foreign_keys = ON')
  }
  return _db
}

// ─── Types ───

export interface GoogleAccount {
  id: number
  email: string
  access_token: string
  refresh_token: string
  token_expiry: number
  created_at: number
}

export interface GoogleCalendar {
  id: string
  account_id: number
  name: string
  color: string
  visible: number
  use_for_conflicts: number
  is_primary: number
  default_busy_status?: string | null
}

export interface CalendarEvent {
  id: string
  calendar_id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  all_day: number
  location: string | null
  status: string
  synced_at: number
  project_id: number | null
  busy_status: string | null
  travel_time_before?: number | null
  travel_time_after?: number | null
  recurring_event_id?: string | null
  guests?: string | null
  conferencing?: string | null
  conference_url?: string | null
  response_status?: string | null
  color?: string | null
}

// ─── OAuth ───

export function getOAuthUrl(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/google/callback'
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not set')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number; email: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/google/callback'

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await tokenRes.json()
  if (!tokens.access_token) throw new Error('Failed to exchange code: ' + JSON.stringify(tokens))

  // Get email
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const user = await userRes.json()

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    email: user.email,
  }
}

// Guard against concurrent token refreshes per account
const refreshLocks = new Map<number, Promise<string>>()

async function refreshAccessToken(account: GoogleAccount): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Failed to refresh token')

  const db = getDb()
  const expiry = Math.floor(Date.now() / 1000) + data.expires_in
  db.prepare('UPDATE google_accounts SET access_token = ?, token_expiry = ? WHERE id = ?')
    .run(data.access_token, expiry, account.id)

  return data.access_token
}

async function getValidToken(accountId: number): Promise<string> {
  const db = getDb()
  const account = db.prepare('SELECT * FROM google_accounts WHERE id = ?').get(accountId) as GoogleAccount | undefined
  if (!account) throw new Error('Google account not found')

  const now = Math.floor(Date.now() / 1000)
  if (account.token_expiry > now + 60) return account.access_token

  // Prevent concurrent refresh requests for the same account
  const existing = refreshLocks.get(accountId)
  if (existing) return existing

  const refreshPromise = refreshAccessToken(account).finally(() => {
    refreshLocks.delete(accountId)
  })
  refreshLocks.set(accountId, refreshPromise)
  return refreshPromise
}

// ─── Account CRUD ───

export function getGoogleAccounts(): GoogleAccount[] {
  return getDb().prepare('SELECT * FROM google_accounts ORDER BY created_at').all() as GoogleAccount[]
}

export function createGoogleAccount(email: string, accessToken: string, refreshToken: string, expiresIn: number): GoogleAccount {
  const db = getDb()
  const expiry = Math.floor(Date.now() / 1000) + expiresIn
  // Upsert by email
  db.prepare(
    `INSERT INTO google_accounts (email, access_token, refresh_token, token_expiry)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, token_expiry = excluded.token_expiry`
  ).run(email, accessToken, refreshToken, expiry)
  return db.prepare('SELECT * FROM google_accounts WHERE email = ?').get(email) as GoogleAccount
}

export function deleteGoogleAccount(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM calendar_events WHERE calendar_id IN (SELECT id FROM google_calendars WHERE account_id = ?)').run(id)
  db.prepare('DELETE FROM google_calendars WHERE account_id = ?').run(id)
  db.prepare('DELETE FROM google_accounts WHERE id = ?').run(id)
}

// ─── Calendar CRUD ───

export function getGoogleCalendars(accountId?: number): GoogleCalendar[] {
  const db = getDb()
  if (accountId) return db.prepare('SELECT * FROM google_calendars WHERE account_id = ?').all(accountId) as GoogleCalendar[]
  return db.prepare('SELECT * FROM google_calendars').all() as GoogleCalendar[]
}

export function updateCalendarVisibility(calendarId: string, visible: boolean): void {
  getDb().prepare('UPDATE google_calendars SET visible = ? WHERE id = ?').run(visible ? 1 : 0, calendarId)
}

export function updateCalendarBusyStatus(calendarId: string, status: string): void {
  getDb().prepare('UPDATE google_calendars SET default_busy_status = ? WHERE id = ?').run(status, calendarId)
}

export function updateCalendarConflicts(calendarId: string, useForConflicts: boolean): void {
  getDb().prepare('UPDATE google_calendars SET use_for_conflicts = ? WHERE id = ?').run(useForConflicts ? 1 : 0, calendarId)
}

export function shouldUseCalendarForConflicts(calendar: Pick<GoogleCalendar, 'visible' | 'use_for_conflicts' | 'default_busy_status'>): boolean {
  // Hidden calendars should never block scheduling.
  if (calendar.visible !== 1) return false
  // Explicit opt-out wins.
  if (calendar.use_for_conflicts !== 1) return false
  // Legacy "free" setting was presented as "don't block my schedule" in UI.
  if ((calendar.default_busy_status || 'busy') === 'free') return false
  return true
}

// ─── Sync ───

export async function syncCalendarList(accountId: number): Promise<void> {
  const token = await getValidToken(accountId)
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!data.items) return

  const db = getDb()
  // Don't overwrite is_primary on sync -- that's a user-controlled setting
  const upsert = db.prepare(
    `INSERT INTO google_calendars (id, account_id, name, color, visible, use_for_conflicts, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       color = excluded.color`
  )

  for (const cal of data.items) {
    const selected = cal.selected !== false
    upsert.run(
      cal.id,
      accountId,
      cal.summary || 'Untitled',
      cal.backgroundColor || '#4285f4',
      selected ? 1 : 0,
      selected ? 1 : 0,
      cal.primary ? 1 : 0,
    )
  }
}

export async function syncEvents(calendarId: string, accountId: number, timeMin?: string, timeMax?: string): Promise<void> {
  const token = await getValidToken(accountId)
  const db = getDb()

  // Check for stored sync token for incremental sync
  const calInfo = db.prepare('SELECT sync_token, default_busy_status FROM google_calendars WHERE id = ?').get(calendarId) as { sync_token?: string; default_busy_status?: string } | undefined
  const storedSyncToken = calInfo?.sync_token || null
  const calDefault = calInfo?.default_busy_status || 'busy'

  let allItems: any[] = []
  let nextSyncToken: string | null = null
  let useIncremental = !!storedSyncToken && !timeMin && !timeMax

  if (useIncremental) {
    // Incremental sync -- only get changes since last sync
    try {
      const params = new URLSearchParams({ syncToken: storedSyncToken!, maxResults: '500' })
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.status === 410) {
        // Token expired/invalid, fall back to full sync
        useIncremental = false
        db.prepare('UPDATE google_calendars SET sync_token = NULL WHERE id = ?').run(calendarId)
      } else {
        const data = await res.json()
        allItems = data.items || []
        nextSyncToken = data.nextSyncToken || null
        // Handle pagination
        let pageToken = data.nextPageToken
        while (pageToken) {
          const pParams = new URLSearchParams({ syncToken: storedSyncToken!, pageToken, maxResults: '500' })
          const pRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${pParams}`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          const pData = await pRes.json()
          allItems.push(...(pData.items || []))
          nextSyncToken = pData.nextSyncToken || nextSyncToken
          pageToken = pData.nextPageToken
        }
      }
    } catch {
      useIncremental = false
    }
  }

  if (!useIncremental) {
    // Full sync with time range
    const now = new Date()
    const min = timeMin || new Date(now.getTime() - 30 * 86400000).toISOString()
    const max = timeMax || new Date(now.getTime() + 180 * 86400000).toISOString()

    const params = new URLSearchParams({
      timeMin: min,
      timeMax: max,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '500',
    })

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Google Calendar sync failed (${res.status}): ${errBody}`)
    }
    const data = await res.json()
    allItems = data.items || []
    nextSyncToken = data.nextSyncToken || null
  }

  if (allItems.length === 0 && !nextSyncToken) return

  // Get account email to identify current user in attendees
  const accountRow = db.prepare('SELECT email FROM google_accounts WHERE id = ?').get(accountId) as { email: string } | undefined
  const accountEmail = accountRow?.email?.toLowerCase() || ''

  const upsertWithBusy = db.prepare(
    `INSERT INTO calendar_events (id, calendar_id, title, description, start_time, end_time, all_day, location, status, busy_status, response_status, recurring_event_id, guests, conferencing, conference_url, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(id, calendar_id) DO UPDATE SET title = excluded.title, description = excluded.description,
     start_time = excluded.start_time, end_time = excluded.end_time, all_day = excluded.all_day,
     location = excluded.location, status = excluded.status, busy_status = excluded.busy_status, response_status = COALESCE(calendar_events.response_status, excluded.response_status), recurring_event_id = excluded.recurring_event_id, guests = excluded.guests, conferencing = excluded.conferencing, conference_url = excluded.conference_url, synced_at = excluded.synced_at`
  )
  const upsertNoBusy = db.prepare(
    `INSERT INTO calendar_events (id, calendar_id, title, description, start_time, end_time, all_day, location, status, busy_status, response_status, recurring_event_id, guests, conferencing, conference_url, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
     ON CONFLICT(id, calendar_id) DO UPDATE SET title = excluded.title, description = excluded.description,
     start_time = excluded.start_time, end_time = excluded.end_time, all_day = excluded.all_day,
     location = excluded.location, status = excluded.status, response_status = COALESCE(calendar_events.response_status, excluded.response_status), recurring_event_id = excluded.recurring_event_id, guests = excluded.guests, conferencing = excluded.conferencing, conference_url = excluded.conference_url, synced_at = excluded.synced_at`
  )

  const deleteStmt = db.prepare('DELETE FROM calendar_events WHERE id = ? AND calendar_id = ?')
  for (const ev of allItems) {
    if (ev.status === 'cancelled') {
      deleteStmt.run(ev.id, calendarId)
      continue
    }
    // Incremental sync may return events without start/end (deleted recurring instances)
    if (!ev.start) continue

    const allDay = ev.start?.date ? 1 : 0
    const startTime = ev.start?.dateTime || ev.start?.date || ''
    const endTime = ev.end?.dateTime || ev.end?.date || ''
    const hasExplicitTransparency = ev.transparency === 'transparent' || ev.transparency === 'opaque'
    const busyStatus = ev.transparency === 'transparent' ? 'free' : (ev.transparency === 'opaque' ? 'busy' : calDefault)

    let responseStatus: string | null = null
    let guestsJson: string | null = null
    if (ev.attendees && Array.isArray(ev.attendees)) {
      const self = ev.attendees.find((a: { self?: boolean; email?: string }) =>
        a.self || (a.email && a.email.toLowerCase() === accountEmail)
      )
      if (self) responseStatus = self.responseStatus || null
      const attendeeEmails = ev.attendees
        .map((a: { email?: string }) => a.email)
        .filter((e: string | undefined): e is string => !!e)
      if (attendeeEmails.length > 0) guestsJson = JSON.stringify(attendeeEmails)
    }

    let confType: string | null = null
    let confUrl: string | null = null
    if (ev.conferenceData?.entryPoints) {
      const videoEntry = ev.conferenceData.entryPoints.find((ep: { entryPointType?: string }) => ep.entryPointType === 'video')
      if (videoEntry?.uri) {
        confUrl = videoEntry.uri
        const url = confUrl as string
        if (url.includes('zoom.us')) confType = 'zoom'
        else if (url.includes('meet.google')) confType = 'meet'
        else confType = 'custom'
      }
    }

    const recurringEventId = ev.recurringEventId || null

    if (hasExplicitTransparency) {
      upsertWithBusy.run(ev.id, calendarId, ev.summary || '(No title)', ev.description || null, startTime, endTime, allDay, ev.location || null, ev.status || 'confirmed', busyStatus, responseStatus, recurringEventId, guestsJson, confType, confUrl)
    } else {
      upsertNoBusy.run(ev.id, calendarId, ev.summary || '(No title)', ev.description || null, startTime, endTime, allDay, ev.location || null, ev.status || 'confirmed', busyStatus, responseStatus, recurringEventId, guestsJson, confType, confUrl)
    }
  }

  // Propagate project_id from existing recurring instances to new ones without it
  // Only targets recurring events (has recurring_event_id or instance-pattern ID)
  // Source match: same recurring_event_id, OR same title with source also being recurring
  db.prepare(
    `UPDATE calendar_events SET project_id = (
       SELECT ce2.project_id FROM calendar_events ce2
       WHERE ce2.project_id IS NOT NULL
         AND ce2.calendar_id = calendar_events.calendar_id
         AND (
           (calendar_events.recurring_event_id IS NOT NULL AND ce2.recurring_event_id = calendar_events.recurring_event_id)
           OR (ce2.recurring_event_id IS NOT NULL AND ce2.title = calendar_events.title AND ce2.title != '')
         )
       LIMIT 1
     )
     WHERE calendar_id = ?
       AND project_id IS NULL
       AND (recurring_event_id IS NOT NULL OR id GLOB '*_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z')`
  ).run(calendarId)

  // Save sync token for next incremental sync
  if (nextSyncToken) {
    db.prepare('UPDATE google_calendars SET sync_token = ? WHERE id = ?').run(nextSyncToken, calendarId)
  }
}

// ─── Event Queries ───

export function getCalendarEvents(start: string, end: string): CalendarEvent[] {
  // Return ALL events regardless of calendar visibility -- client handles visibility filtering
  // Filter date range in JS because SQLite text comparison can't handle mixed timezone offsets vs Z
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const all = getDb().prepare(
    `SELECT ce.* FROM calendar_events ce
     JOIN google_calendars gc ON ce.calendar_id = gc.id
     ORDER BY ce.start_time`
  ).all() as CalendarEvent[]
  return all.filter(e => {
    const eEnd = new Date(e.end_time).getTime()
    const eStart = new Date(e.start_time).getTime()
    return eEnd > startMs && eStart < endMs
  })
}

export function getConflictEvents(start: string, end: string): CalendarEvent[] {
  // Only calendars that are both visible and explicitly enabled for conflicts should block scheduling.
  // Filter in JS because SQLite text comparison can't handle mixed timezone offsets vs Z.
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const all = getDb().prepare(
    `SELECT ce.* FROM calendar_events ce
     JOIN google_calendars gc ON ce.calendar_id = gc.id
     WHERE gc.visible = 1
       AND gc.use_for_conflicts = 1
       AND COALESCE(gc.default_busy_status, 'busy') != 'free'
       AND COALESCE(ce.busy_status, 'busy') != 'free'
       AND COALESCE(ce.response_status, 'accepted') NOT IN ('declined', 'needsAction')
       AND ce.status != 'cancelled'
     ORDER BY ce.start_time`
  ).all() as CalendarEvent[]
  return all.filter(e => {
    const eEnd = new Date(e.end_time).getTime()
    const eStart = new Date(e.start_time).getTime()
    return eEnd > startMs && eStart < endMs
  })
}

// ─── Google Calendar Event CRUD ───

function getPrimaryCalendar(): { calendarId: string; accountId: number } | null {
  const db = getDb()
  const cal = db.prepare('SELECT gc.id, gc.account_id FROM google_calendars gc WHERE gc.is_primary = 1 LIMIT 1').get() as { id: string; account_id: number } | undefined
  if (cal) return { calendarId: cal.id, accountId: cal.account_id }
  // Fallback: first calendar
  const first = db.prepare('SELECT gc.id, gc.account_id FROM google_calendars gc LIMIT 1').get() as { id: string; account_id: number } | undefined
  return first ? { calendarId: first.id, accountId: first.account_id } : null
}

function getCalendarForEvent(eventId: string, calendarId?: string): { calendarId: string; accountId: number } | null {
  const db = getDb()
  if (calendarId) {
    // Composite PK lookup -- exact match
    const ev = db.prepare('SELECT ce.calendar_id, gc.account_id FROM calendar_events ce JOIN google_calendars gc ON ce.calendar_id = gc.id WHERE ce.id = ? AND ce.calendar_id = ?').get(eventId, calendarId) as { calendar_id: string; account_id: number } | undefined
    return ev ? { calendarId: ev.calendar_id, accountId: ev.account_id } : null
  }
  // Fallback: find any calendar with this event (prefers primary calendar)
  const ev = db.prepare('SELECT ce.calendar_id, gc.account_id FROM calendar_events ce JOIN google_calendars gc ON ce.calendar_id = gc.id WHERE ce.id = ? ORDER BY gc.is_primary DESC LIMIT 1').get(eventId) as { calendar_id: string; account_id: number } | undefined
  return ev ? { calendarId: ev.calendar_id, accountId: ev.account_id } : null
}

function getCalendarOwnerEmail(calendarId: string, accountId: number): string | null {
  const db = getDb()
  const row = db.prepare(
    `SELECT ga.email
     FROM google_calendars gc
     JOIN google_accounts ga ON gc.account_id = ga.id
     WHERE gc.id = ? AND gc.account_id = ?
     LIMIT 1`
  ).get(calendarId, accountId) as { email?: string | null } | undefined
  return row?.email || null
}

export interface GoogleEventInput {
  title: string
  start_time: string
  end_time: string
  all_day?: boolean
  location?: string
  description?: string
  conferencing?: string // 'zoom' | 'meet' | 'custom' | 'none'
  conference_url?: string
  busy_status?: string
  visibility?: string
  guests?: string[]
  recurrence?: string[] // RRULE strings
  travel_time_before?: number
  travel_time_after?: number
  color_id?: string
  calendar_id?: string // Target calendar ID (defaults to primary)
  timezone?: string // IANA timezone (e.g. 'America/Los_Angeles')
  response_status?: string // 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

export async function createGoogleEvent(input: GoogleEventInput): Promise<{ id: string } | null> {
  // Use specified calendar or fall back to primary
  let target: { calendarId: string; accountId: number } | null = null
  if (input.calendar_id) {
    const db = getDb()
    const cal = db.prepare('SELECT gc.id, gc.account_id FROM google_calendars gc WHERE gc.id = ?').get(input.calendar_id) as { id: string; account_id: number } | undefined
    if (cal) target = { calendarId: cal.id, accountId: cal.account_id }
  }
  if (!target) target = getPrimaryCalendar()
  if (!target) return null

  const token = await getValidToken(target.accountId)
  const body: Record<string, unknown> = {
    summary: input.title,
    location: input.location || undefined,
    description: input.description || undefined,
    visibility: input.visibility === 'default' ? undefined : input.visibility,
    transparency: input.busy_status === 'free' ? 'transparent' : undefined,
  }

  const tz = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

  if (input.all_day) {
    const startDate = input.start_time.split('T')[0]
    const endDate = input.end_time.split('T')[0]
    body.start = { date: startDate, timeZone: tz }
    body.end = { date: endDate, timeZone: tz }
  } else {
    body.start = { dateTime: input.start_time, timeZone: tz }
    body.end = { dateTime: input.end_time, timeZone: tz }
  }

  if (input.guests?.length) {
    body.attendees = input.guests.map(email => ({ email }))
  }

  if (input.response_status) {
    const ownerEmail = getCalendarOwnerEmail(target.calendarId, target.accountId)
    if (ownerEmail) {
      const attendees = (body.attendees as Array<Record<string, unknown>>) || []
      const alreadyPresent = attendees.some(
        a => (a.email as string)?.toLowerCase() === ownerEmail.toLowerCase()
      )
      if (alreadyPresent) {
        for (const a of attendees) {
          if ((a.email as string)?.toLowerCase() === ownerEmail.toLowerCase()) {
            a.responseStatus = input.response_status
            a.self = true
          }
        }
      } else {
        attendees.push({
          email: ownerEmail,
          responseStatus: input.response_status,
          self: true,
        })
      }
      body.attendees = attendees
    }
  }

  if (input.conferencing === 'meet') {
    body.conferenceData = { createRequest: { requestId: `ctrl-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }

  if (input.recurrence?.length) {
    body.recurrence = input.recurrence
  }

  if (input.color_id) {
    body.colorId = input.color_id
  }

  const calId = encodeURIComponent(target.calendarId)
  const conferenceParam = input.conferencing === 'meet' ? '&conferenceDataVersion=1' : ''
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events?sendUpdates=all${conferenceParam}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || !data.id) {
    const msg = data?.error?.message || JSON.stringify(data)
    throw new Error(`Google Calendar create failed (${res.status}): ${msg}`)
  }

  // Store locally (INSERT OR REPLACE works fine with composite PK)
  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO calendar_events (id, calendar_id, title, description, start_time, end_time, all_day, location, status, busy_status, travel_time_before, travel_time_after, conferencing, conference_url, guests, color, response_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id, target.calendarId, input.title, input.description || null,
    input.start_time, input.end_time, input.all_day ? 1 : 0,
    input.location || null, input.busy_status || 'busy',
    input.travel_time_before || 0, input.travel_time_after || 0,
    input.conferencing || null, input.conference_url || null,
    input.guests?.length ? JSON.stringify(input.guests) : null,
    null, // color is set via colorId on Google, resolved on next sync
    input.response_status ?? null,
  )

  return { id: data.id }
}

export async function updateGoogleEvent(eventId: string, input: Partial<GoogleEventInput>, eventCalendarId?: string, sendUpdates?: string): Promise<boolean> {
  const cal = getCalendarForEvent(eventId, eventCalendarId)
  if (!cal) return false

  const token = await getValidToken(cal.accountId)
  const body: Record<string, unknown> = {}

  if (input.title !== undefined) body.summary = input.title
  if (input.location !== undefined) body.location = input.location
  if (input.description !== undefined) body.description = input.description
  if (input.visibility !== undefined && input.visibility !== 'default') body.visibility = input.visibility
  if (input.busy_status !== undefined) body.transparency = input.busy_status === 'free' ? 'transparent' : 'opaque'

  if (input.color_id !== undefined) body.colorId = input.color_id || undefined

  if (input.start_time && input.end_time) {
    const tz = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    if (input.all_day) {
      body.start = { date: input.start_time.split('T')[0], timeZone: tz }
      body.end = { date: input.end_time.split('T')[0], timeZone: tz }
    } else {
      body.start = { dateTime: input.start_time, timeZone: tz }
      body.end = { dateTime: input.end_time, timeZone: tz }
    }
  }

  if (input.guests !== undefined) {
    body.attendees = input.guests.map(email => ({ email }))
  }

  // RSVP: update self attendance status via attendees array
  if ((input as any).response_status !== undefined) {
    const accountRow = getDb().prepare('SELECT email FROM google_accounts WHERE id = ?').get(cal.accountId) as { email: string } | undefined
    const accountEmail = accountRow?.email || cal.calendarId
    // Fetch current attendees to preserve them
    try {
      const getRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendarId)}/events/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (getRes.ok) {
        const existingEvent = await getRes.json()
        const attendees = existingEvent.attendees || []
        const selfIdx = attendees.findIndex((a: any) => a.email?.toLowerCase() === accountEmail.toLowerCase() || a.self)
        if (selfIdx >= 0) {
          attendees[selfIdx].responseStatus = (input as any).response_status
        } else {
          attendees.push({ email: accountEmail, responseStatus: (input as any).response_status, self: true })
        }
        body.attendees = attendees
      }
    } catch { /* ignore, local update still works */ }
  }

  if (input.recurrence !== undefined) {
    body.recurrence = input.recurrence
  }

  // Push conferencing data to Google
  if (input.conference_url) {
    if (input.conference_url.includes('zoom.us')) {
      body.conferenceData = {
        entryPoints: [{ entryPointType: 'video', uri: input.conference_url, label: 'Zoom Meeting' }],
        conferenceSolution: { key: { type: 'addOn' }, name: 'Zoom Meeting' },
      }
    } else if (input.conference_url.includes('meet.google')) {
      // Google Meet links are managed by Google, don't overwrite
    } else if (input.conference_url) {
      body.conferenceData = {
        entryPoints: [{ entryPointType: 'video', uri: input.conference_url, label: 'Video Meeting' }],
        conferenceSolution: { key: { type: 'addOn' }, name: 'Video Meeting' },
      }
    }
  } else if (input.conferencing === 'meet') {
    body.conferenceData = { createRequest: { requestId: `ctrl-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }

  const calId = encodeURIComponent(cal.calendarId)
  const sendParam = sendUpdates || 'none'
  const hasConferenceUpdate = input.conference_url || input.conferencing === 'meet'
  const conferenceParam = hasConferenceUpdate ? '&conferenceDataVersion=1' : ''
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}?sendUpdates=${sendParam}${conferenceParam}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) return false

  // Update local DB
  const db = getDb()
  const updates: string[] = []
  const params: unknown[] = []
  if (input.title !== undefined) { updates.push('title = ?'); params.push(input.title) }
  if (input.description !== undefined) { updates.push('description = ?'); params.push(input.description) }
  if (input.location !== undefined) { updates.push('location = ?'); params.push(input.location) }
  if (input.start_time) { updates.push('start_time = ?'); params.push(input.start_time) }
  if (input.end_time) { updates.push('end_time = ?'); params.push(input.end_time) }
  if (input.all_day !== undefined) { updates.push('all_day = ?'); params.push(input.all_day ? 1 : 0) }
  if (input.busy_status !== undefined) { updates.push('busy_status = ?'); params.push(input.busy_status) }
  if (input.travel_time_before !== undefined) { updates.push('travel_time_before = ?'); params.push(input.travel_time_before) }
  if (input.travel_time_after !== undefined) { updates.push('travel_time_after = ?'); params.push(input.travel_time_after) }
  if (input.conferencing !== undefined) { updates.push('conferencing = ?'); params.push(input.conferencing) }
  if (input.conference_url !== undefined) { updates.push('conference_url = ?'); params.push(input.conference_url) }
  if (input.guests !== undefined) { updates.push('guests = ?'); params.push(JSON.stringify(input.guests)) }
  if (updates.length > 0) {
    params.push(eventId, cal.calendarId)
    db.prepare(`UPDATE calendar_events SET ${updates.join(', ')} WHERE id = ? AND calendar_id = ?`).run(...params)
  }

  return true
}

export async function deleteGoogleEvent(eventId: string, eventCalendarId?: string, deleteAll?: boolean): Promise<boolean> {
  const db = getDb()

  // If deleteAll and this is a recurring instance, delete the parent recurring event on Google
  if (deleteAll) {
    const row = db.prepare('SELECT recurring_event_id, calendar_id FROM calendar_events WHERE id = ? AND calendar_id = ?').get(eventId, eventCalendarId || '') as { recurring_event_id?: string; calendar_id: string } | undefined
    const recurringId = row?.recurring_event_id
    if (recurringId) {
      const cal = getCalendarForEvent(eventId, eventCalendarId)
      if (cal) {
        const token = await getValidToken(cal.accountId)
        const calId = encodeURIComponent(cal.calendarId)
        // Delete the parent event which cancels ALL instances
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${recurringId}?sendUpdates=all`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
      // Delete all local instances of this recurring event
      db.prepare('DELETE FROM calendar_events WHERE recurring_event_id = ? AND calendar_id = ?').run(recurringId, eventCalendarId || row?.calendar_id)
      return true
    }
  }

  const cal = getCalendarForEvent(eventId, eventCalendarId)
  if (!cal) {
    // Just delete locally (all copies if no calendarId specified)
    if (eventCalendarId) {
      db.prepare('DELETE FROM calendar_events WHERE id = ? AND calendar_id = ?').run(eventId, eventCalendarId)
    } else {
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId)
    }
    return true
  }

  const token = await getValidToken(cal.accountId)
  const calId = encodeURIComponent(cal.calendarId)
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}?sendUpdates=all`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })

  // Delete locally (just this calendar's copy)
  db.prepare('DELETE FROM calendar_events WHERE id = ? AND calendar_id = ?').run(eventId, cal.calendarId)
  return res.ok || res.status === 404 || res.status === 410
}
