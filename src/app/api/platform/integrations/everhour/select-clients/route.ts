// POST /api/platform/integrations/everhour/select-clients
//
// Step 2 of the Everhour multi-step connect flow.
// Reads the signed everhour_pending_connect cookie, verifies it, adds
// clientIds + clientNames to the payload, re-signs, re-sets the cookie.
//
// Body: { clientIds: string[], clientNames: string[] }
// Response: { ok: true }
// Updates cookie: everhour_pending_connect (new signed HMAC, same maxAge)

import { NextRequest, NextResponse } from 'next/server'
import { verifyState, signState } from '@/lib/platform/state'

interface PendingPayload {
  provider: string
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  apiKey: string
  step: string
  clientIds?: string[]
  clientNames?: string[]
}

export async function POST(req: NextRequest) {
  let body: { clientIds?: unknown; clientNames?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.clientIds) || body.clientIds.length === 0) {
    return NextResponse.json({ error: 'clientIds must be a non-empty array' }, { status: 400 })
  }
  if (!Array.isArray(body.clientNames)) {
    return NextResponse.json({ error: 'clientNames must be an array' }, { status: 400 })
  }

  const clientIds = (body.clientIds as unknown[]).filter((v) => typeof v === 'string') as string[]
  const clientNames = (body.clientNames as unknown[]).filter((v) => typeof v === 'string') as string[]

  if (clientIds.length === 0) {
    return NextResponse.json({ error: 'At least one clientId is required' }, { status: 400 })
  }

  // Read + verify pending cookie.
  const pendingCookie = req.cookies.get('everhour_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'everhour') {
    return NextResponse.json(
      { error: 'Invalid session — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  // Merge clientIds + clientNames into the cookie payload and advance the step.
  const updated: Record<string, unknown> = {
    ...payload,
    clientIds,
    clientNames,
    step: 'projects',
  }

  const signed = signState(updated)

  const response = NextResponse.json({ ok: true })
  response.cookies.set('everhour_pending_connect', signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes from now
    path: '/',
  })
  return response
}
