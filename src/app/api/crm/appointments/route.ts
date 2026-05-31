// /api/crm/appointments — list + create CRM appointments.
//
// GET ?range=upcoming|past|today|all  ?contact_id= ?calendar_id= ?limit=
//   Wraps getCrmAppointments(workspaceId, { from, to, calendarId, limit }) and
//   augments each row with contact_name + calendar_name (single batched lookup)
//   so the widget doesn't need a second roundtrip per row.
//
// POST { contact_id, calendar_id?, starts_at, ends_at, title?, notes? }
//   Wraps createCrmAppointment. `title` is not a column on crm_appointments —
//   the calendar's name is used as the displayed title, so we fold any provided
//   title into notes for now. starts_at / ends_at are unix seconds.
//
// Response shape: { data: AppointmentRow[], error: null } — the existing
// UpcomingAppointmentsWidget uses crmFetch which unwraps `data`.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmAppointments,
  createCrmAppointment,
  getCrmCalendars,
  getCrmCalendarById,
  getCrmContactById,
  getUserWorkspaces,
  getDb,
  type CrmAppointment,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

interface AppointmentRow extends CrmAppointment {
  contact_name: string | null
  calendar_name: string | null
}

function enrich(workspaceId: number, rows: CrmAppointment[]): AppointmentRow[] {
  if (rows.length === 0) return []
  const d = getDb()

  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter((id): id is number => id !== null)))
  const contactNames = new Map<number, string>()
  if (contactIds.length > 0) {
    const placeholders = contactIds.map(() => '?').join(',')
    const contactRows = d.prepare(
      `SELECT id, name FROM crm_contacts WHERE workspace_id = ? AND id IN (${placeholders})`
    ).all(workspaceId, ...contactIds) as Array<{ id: number; name: string }>
    for (const c of contactRows) contactNames.set(c.id, c.name)
  }

  const calendarIds = Array.from(new Set(rows.map((r) => r.calendar_id)))
  const calendarNames = new Map<number, string>()
  if (calendarIds.length > 0) {
    const placeholders = calendarIds.map(() => '?').join(',')
    const calRows = d.prepare(
      `SELECT id, name FROM crm_calendars WHERE workspace_id = ? AND id IN (${placeholders})`
    ).all(workspaceId, ...calendarIds) as Array<{ id: number; name: string }>
    for (const c of calRows) calendarNames.set(c.id, c.name)
  }

  return rows.map((r) => ({
    ...r,
    contact_name: r.contact_id ? (contactNames.get(r.contact_id) ?? null) : null,
    calendar_name: calendarNames.get(r.calendar_id) ?? null,
  }))
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ data: [], error: null })

  const sp = req.nextUrl.searchParams
  const range = (sp.get('range') || 'upcoming') as 'upcoming' | 'past' | 'today' | 'all'
  const contactIdParam = sp.get('contact_id')
  const calendarIdParam = sp.get('calendar_id')
  const contactId = contactIdParam ? Number(contactIdParam) : null
  const calendarId = calendarIdParam ? Number(calendarIdParam) : null
  const limit = Math.min(parseInt(sp.get('limit') || '100', 10) || 100, 500)

  const now = Math.floor(Date.now() / 1000)
  const opts: { calendarId?: number; from?: number; to?: number; limit?: number } = { limit }
  if (calendarId && calendarId > 0) opts.calendarId = calendarId
  if (range === 'upcoming') opts.from = now
  else if (range === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)
    opts.from = Math.floor(start.getTime() / 1000)
    opts.to = Math.floor(end.getTime() / 1000)
  } else if (range === 'past') {
    opts.to = now
  }
  // range === 'all' → no bounds

  let rows = getCrmAppointments(workspaceId, opts)
  if (contactId && contactId > 0) {
    rows = rows.filter((r) => r.contact_id === contactId)
  }
  if (range === 'past') {
    // getCrmAppointments orders ASC; flip so callers see most-recent first.
    rows = rows.slice().reverse()
  }

  return NextResponse.json({ data: enrich(workspaceId, rows), error: null })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ data: null, error: 'No workspace' }, { status: 400 })

  let body: { contact_id?: unknown; calendar_id?: unknown; starts_at?: unknown; ends_at?: unknown; title?: unknown; notes?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ data: null, error: 'Invalid JSON' }, { status: 400 }) }

  const startsAt = Number(body.starts_at)
  const endsAt = Number(body.ends_at)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    return NextResponse.json({ data: null, error: 'starts_at and ends_at (unix seconds) are required' }, { status: 400 })
  }

  const contactIdRaw = Number(body.contact_id)
  const contactId = Number.isFinite(contactIdRaw) && contactIdRaw > 0 ? contactIdRaw : null
  if (contactId) {
    const c = getCrmContactById(contactId, workspaceId)
    if (!c) return NextResponse.json({ data: null, error: 'contact not found' }, { status: 404 })
  }

  let calendarId = Number(body.calendar_id)
  if (!Number.isFinite(calendarId) || calendarId <= 0) {
    // Default to the workspace's first calendar so the simple "book on default"
    // path works without the caller having to know calendar ids.
    const cals = getCrmCalendars(workspaceId)
    if (cals.length === 0) return NextResponse.json({ data: null, error: 'No calendars configured for workspace' }, { status: 400 })
    calendarId = cals[0].id
  } else {
    const cal = getCrmCalendarById(calendarId, workspaceId)
    if (!cal) return NextResponse.json({ data: null, error: 'calendar not found' }, { status: 404 })
  }

  // No `title` column on crm_appointments; fold into notes if provided.
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const combinedNotes = [title, notes].filter(Boolean).join('\n\n') || null

  const appointment = createCrmAppointment({
    calendar_id: calendarId,
    workspace_id: workspaceId,
    contact_id: contactId,
    starts_at: startsAt,
    ends_at: endsAt,
    notes: combinedNotes,
    assigned_user_id: user.id,
  })
  const [enriched] = enrich(workspaceId, [appointment])
  return NextResponse.json({ data: enriched, error: null })
}
