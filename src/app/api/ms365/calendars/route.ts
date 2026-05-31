// GET /api/ms365/calendars — flatten this user's MS365 calendars across all
// connected accounts. Returns the same shape as /api/google/calendars rows so
// the frontend can render both providers with shared components:
//
//   { calendars: [{ id, account_id, name, color, visible, is_primary, default_busy_status }, ...] }
//
// Reads calendars_json off each crm_user_calendar_accounts row. No Graph call.
// Safe without MS365 env vars configured (returns []).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { getCrmUserCalendarAccountsByUser } from '@/lib/db'
import { flattenAccountCalendars } from '@/lib/ms365'

export async function GET(req: NextRequest) {
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

  const accounts = getCrmUserCalendarAccountsByUser(userId, workspaceId, {
    provider: 'microsoft',
  })
  const calendars = accounts.flatMap((a) => flattenAccountCalendars(a))
  return NextResponse.json({ calendars })
}
