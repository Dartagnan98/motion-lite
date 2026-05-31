// /api/crm/booking-links — list + create booking links.
//
// HEADS UP: the legacy `booking_links` table is NOT workspace-scoped. It's a
// single-tenant artifact from before the CRM migration. We still list/create
// against it here for backward compat with the existing public /book/[slug]
// flow, but workspace-scoped booking lives on `crm_calendars` (see
// /api/crm/calendars if/when that lands). All workspace users see the same set
// until this table either gets a workspace_id column or gets retired.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getBookingLinks, createBookingLink, getUserWorkspaces } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!primaryWorkspaceId(user.id)) return NextResponse.json({ booking_links: [] })
  return NextResponse.json({ booking_links: getBookingLinks() })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!primaryWorkspaceId(user.id)) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let body: {
    name?: unknown; slug?: unknown; durations?: unknown; custom_hours?: unknown;
    daily_limit?: unknown; start_delay_days?: unknown; one_time?: unknown;
    buffer_before?: unknown; buffer_after?: unknown;
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 })

  const durations = Array.isArray(body.durations)
    ? (body.durations as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : undefined

  const link = createBookingLink({
    name,
    slug,
    durations,
    custom_hours: (body.custom_hours && typeof body.custom_hours === 'object')
      ? (body.custom_hours as Record<string, { start: string; end: string }[]>)
      : null,
    daily_limit: typeof body.daily_limit === 'number' ? body.daily_limit : undefined,
    start_delay_days: typeof body.start_delay_days === 'number' ? body.start_delay_days : undefined,
    one_time: typeof body.one_time === 'boolean' ? body.one_time : undefined,
    buffer_before: typeof body.buffer_before === 'number' ? body.buffer_before : undefined,
    buffer_after: typeof body.buffer_after === 'number' ? body.buffer_after : undefined,
  })
  return NextResponse.json({ booking_link: link })
}
