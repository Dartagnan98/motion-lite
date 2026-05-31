// /api/crm/appointments/[id] — GET, PATCH (status + notes), DELETE.
//
// db.ts ships `updateCrmAppointmentStatus` and `rescheduleCrmAppointment` but
// no general PATCH helper. Notes-only edits + delete go through scoped raw SQL
// here with an allow-list so we don't reach for an "update anything" foot-gun.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmAppointmentById,
  updateCrmAppointmentStatus,
  rescheduleCrmAppointment,
  getUserWorkspaces,
  getDb,
  type CrmAppointment,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

const ALLOWED_STATUSES: CrmAppointment['status'][] = ['confirmed', 'cancelled', 'showed', 'no_show', 'rescheduled', 'conflict_detected']

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { id } = await params
  const appointmentId = Number(id)
  if (!Number.isFinite(appointmentId) || appointmentId <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const appointment = getCrmAppointmentById(appointmentId, workspaceId)
  if (!appointment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ appointment })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { id } = await params
  const appointmentId = Number(id)
  if (!Number.isFinite(appointmentId) || appointmentId <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const existing = getCrmAppointmentById(appointmentId, workspaceId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { status?: unknown; notes?: unknown; starts_at?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let appointment = existing

  // Reschedule (cascades reminders).
  if (typeof body.starts_at === 'number' && Number.isFinite(body.starts_at)) {
    const updated = rescheduleCrmAppointment(appointmentId, workspaceId, body.starts_at)
    if (updated) appointment = updated
  }

  // Status (cancels stale reminders via db.ts side-effect).
  if (typeof body.status === 'string' && (ALLOWED_STATUSES as string[]).includes(body.status)) {
    const updated = updateCrmAppointmentStatus(appointmentId, workspaceId, body.status as CrmAppointment['status'])
    if (updated) appointment = updated
  }

  // Notes — no helper, scoped raw update.
  if (typeof body.notes === 'string') {
    getDb().prepare('UPDATE crm_appointments SET notes = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(body.notes, Math.floor(Date.now() / 1000), appointmentId, workspaceId)
    appointment = getCrmAppointmentById(appointmentId, workspaceId) ?? appointment
  }

  return NextResponse.json({ appointment })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { id } = await params
  const appointmentId = Number(id)
  if (!Number.isFinite(appointmentId) || appointmentId <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const existing = getCrmAppointmentById(appointmentId, workspaceId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Tombstone via status rather than hard-delete; preserves the audit trail
  // and lets cancellation flows fire reminder cancels. Hard-delete would orphan
  // crm_booking_attendees + crm_appointment_reminders.
  updateCrmAppointmentStatus(appointmentId, workspaceId, 'cancelled')
  return NextResponse.json({ ok: true })
}
