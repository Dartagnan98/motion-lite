// /api/crm/booking-links/[id] — GET, PATCH, DELETE on a booking link.
//
// Same workspace-less caveat as the list route: booking_links is global.
// Still gated on logged-in user with a workspace to keep public traffic out.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getBookingLinkById, updateBookingLink, deleteBookingLink, getUserWorkspaces } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!primaryWorkspaceId(user.id)) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { id } = await params
  const linkId = Number(id)
  if (!Number.isFinite(linkId) || linkId <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const link = getBookingLinkById(linkId)
  if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ booking_link: link })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!primaryWorkspaceId(user.id)) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { id } = await params
  const linkId = Number(id)
  if (!Number.isFinite(linkId) || linkId <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const existing = getBookingLinkById(linkId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // updateBookingLink applies its own column allow-list, so we forward as-is.
  const updated = updateBookingLink(linkId, body)
  return NextResponse.json({ booking_link: updated })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!primaryWorkspaceId(user.id)) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const { id } = await params
  const linkId = Number(id)
  if (!Number.isFinite(linkId) || linkId <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const existing = getBookingLinkById(linkId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  deleteBookingLink(linkId)
  return NextResponse.json({ ok: true })
}
