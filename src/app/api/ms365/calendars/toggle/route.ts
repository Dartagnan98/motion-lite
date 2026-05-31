// POST /api/ms365/calendars/toggle
// Body: { calendarId, visible?, default_busy_status?, set_primary? }
//
// Updates per-calendar visibility / busy default / primary flags by mutating
// the parent account's calendars_json blob (no parallel ms365_calendars
// table — see src/lib/ms365.ts for the storage decision).
//
// The calendarId is the Graph calendar id (a string). We find the owning
// account by scanning calendars_json on the caller's MS365 accounts (calendar
// ids are globally unique per Microsoft tenant — and per-user in practice).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import {
  getCrmUserCalendarAccountsByUser,
  updateCrmUserCalendarAccountCalendarsJson,
} from '@/lib/db'
import { applyCalendarToggle, parseStoredCalendars } from '@/lib/ms365'

export async function POST(req: NextRequest) {
  let userId: number
  let workspaceId: number
  try {
    const ctx = await requireAuthWithWorkspace(req)
    userId = ctx.user.id
    workspaceId = ctx.workspaceId
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'UNAUTHORIZED'
    return NextResponse.json(
      { error: msg },
      { status: msg === 'FORBIDDEN' || msg === 'NO_WORKSPACE' ? 403 : 401 },
    )
  }

  let body: {
    calendarId?: string
    visible?: boolean
    default_busy_status?: 'busy' | 'free'
    set_primary?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { calendarId, visible, default_busy_status, set_primary } = body
  if (!calendarId || typeof calendarId !== 'string') {
    return NextResponse.json({ error: 'Missing calendarId' }, { status: 400 })
  }
  if (
    default_busy_status !== undefined &&
    default_busy_status !== 'busy' &&
    default_busy_status !== 'free'
  ) {
    return NextResponse.json(
      { error: "default_busy_status must be 'busy' or 'free'" },
      { status: 400 },
    )
  }

  const accounts = getCrmUserCalendarAccountsByUser(userId, workspaceId, {
    provider: 'microsoft',
  })

  let updatedAccountId: number | null = null
  for (const account of accounts) {
    const list = parseStoredCalendars(account.calendars_json)
    if (!list.some((c) => c.id === calendarId)) continue

    const next = applyCalendarToggle({
      account,
      calendarId,
      visible,
      default_busy_status,
      set_primary,
    })
    updateCrmUserCalendarAccountCalendarsJson(account.id, JSON.stringify(next))
    updatedAccountId = account.id
    break
  }

  if (!updatedAccountId) {
    return NextResponse.json(
      { error: 'Calendar not found on any connected MS365 account' },
      { status: 404 },
    )
  }
  return NextResponse.json({ ok: true, account_id: updatedAccountId })
}
