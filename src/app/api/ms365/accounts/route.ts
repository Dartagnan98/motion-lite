// GET /api/ms365/accounts — list this user's MS365 calendar accounts
//   (workspace-scoped). Tokens are NEVER returned — only metadata + the parsed
//   calendars list from calendars_json.
//
// DELETE /api/ms365/accounts?id=N — soft-disconnect. Clears tokens, sets
//   disconnected_at. Row stays for audit (preserves crm_external_events FK +
//   appointment history). Does not delete.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import {
  disconnectCrmUserCalendarAccount,
  getCrmUserCalendarAccountById,
  getCrmUserCalendarAccountsByUser,
} from '@/lib/db'
import { parseStoredCalendars } from '@/lib/ms365'

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

  const rows = getCrmUserCalendarAccountsByUser(userId, workspaceId, {
    provider: 'microsoft',
  })
  const accounts = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    provider_account_id: r.provider_account_id,
    display_email: r.display_email,
    is_primary_for_bookings: r.is_primary_for_bookings === 1,
    sync_direction: r.sync_direction,
    connected_at: r.connected_at,
    last_synced_at: r.last_synced_at,
    last_sync_error: r.last_sync_error,
    calendars: parseStoredCalendars(r.calendars_json),
  }))
  return NextResponse.json({ accounts })
}

export async function DELETE(req: NextRequest) {
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

  const idRaw = req.nextUrl.searchParams.get('id')
  const id = idRaw ? parseInt(idRaw, 10) : NaN
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Missing or invalid id' }, { status: 400 })
  }

  const account = getCrmUserCalendarAccountById(id)
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }
  // Ownership check — must belong to caller within caller's workspace.
  if (
    account.user_id !== userId ||
    account.workspace_id !== workspaceId ||
    account.provider !== 'microsoft'
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const changed = disconnectCrmUserCalendarAccount(id)
  return NextResponse.json({ ok: true, changed })
}
