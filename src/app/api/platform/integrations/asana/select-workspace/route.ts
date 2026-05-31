// POST /api/platform/integrations/asana/select-workspace
//
// Step 2 of the Asana multi-step connect flow.
// Reads the pending exchange from the signed cookie set by the callback route,
// verifies it, adds workspaceId + workspaceDisplayName, advances step to 'scope',
// re-signs + re-sets the cookie, and returns { ok: true }.
//
// The client-component form then pushes to /platform/connect/asana/select-scope.
// completeConnect and the first snapshot now live in the finalize route.
//
// Body: { workspaceId: string, workspaceDisplayName: string }
// Cookie: asana_pending_connect (signed HMAC payload from callback)
// Response: { ok: true }

import { NextRequest, NextResponse } from 'next/server'
import { verifyState, signState } from '@/lib/platform/state'

interface PendingPayload {
  provider: 'asana'
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  exchange_access_token: string
  exchange_refresh_token: string | null
  exchange_expires_in: number
  exchange_email: string | null
  exchange_scopes: string
  step?: string
  workspaceId?: string
  workspaceDisplayName?: string
}

export async function POST(req: NextRequest) {
  let body: { workspaceId?: unknown; workspaceDisplayName?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : null
  const workspaceDisplayName =
    typeof body.workspaceDisplayName === 'string'
      ? body.workspaceDisplayName.trim()
      : workspaceId || 'Asana Workspace'

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  // Read + verify the signed pending connect cookie.
  const pendingCookie = req.cookies.get('asana_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'asana') {
    return NextResponse.json(
      { error: 'Invalid session — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  // Merge workspaceId + workspaceDisplayName and advance the step.
  const updated: Record<string, unknown> = {
    ...payload,
    workspaceId,
    workspaceDisplayName,
    step: 'scope',
  }

  const signed = signState(updated)

  const response = NextResponse.json({ ok: true })
  response.cookies.set('asana_pending_connect', signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes from now
    path: '/',
  })
  return response
}
