// POST /api/platform/integrations/asana/finalize
//
// Step 3 of the Asana multi-step connect flow.
// Reads + verifies the pending cookie (step must be 'scope').
//
// Portfolio scope: calls listPortfolioProjects() server-side to resolve
//   actual projectIds + projectNames from the portfolioGid, then persists.
//   If the portfolio has 0 projects, returns 400 — PM should reconnect with
//   a different portfolio or switch to projects mode.
//
// Projects scope: uses the submitted projectIds + projectNames directly.
//
// After persisting the integration row, fires the first snapshot (non-fatal).
// Clears the cookie.
//
// Body (portfolio scope): { scope: 'portfolio', portfolioGid: string, portfolioName: string }
// Body (projects scope):  { scope: 'projects',  projectIds: string[], projectNames: string[] }
// Response: { ok: true, integrationId: number }

import { NextRequest, NextResponse } from 'next/server'
import { verifyState } from '@/lib/platform/state'
import { completeConnect } from '@/lib/platform/integrations/asana/connect-flow'
import { listPortfolioProjects } from '@/lib/platform/integrations/asana/oauth'
import { asanaAdapter } from '@/lib/platform/integrations/asana/adapter'
import { persistSnapshot } from '@/lib/platform/snapshots'
import type { CallbackState } from '@/lib/platform/integrations/asana/connect-flow'

interface PendingPayload extends CallbackState {
  exchange_access_token: string
  exchange_refresh_token: string | null
  exchange_expires_in: number
  exchange_email: string | null
  exchange_scopes: string
  step: string
  workspaceId: string
  workspaceDisplayName: string
}

type FinalizeBody =
  | { scope: 'portfolio'; portfolioGid: string; portfolioName: string }
  | { scope: 'projects'; projectIds: string[]; projectNames: string[] }

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate body shape.
  const scope = body.scope
  if (scope !== 'portfolio' && scope !== 'projects') {
    return NextResponse.json(
      { error: 'scope must be "portfolio" or "projects"' },
      { status: 400 }
    )
  }

  if (scope === 'portfolio') {
    if (typeof body.portfolioGid !== 'string' || !body.portfolioGid) {
      return NextResponse.json({ error: 'portfolioGid is required' }, { status: 400 })
    }
    if (typeof body.portfolioName !== 'string') {
      return NextResponse.json({ error: 'portfolioName is required' }, { status: 400 })
    }
  }

  if (scope === 'projects') {
    if (!Array.isArray(body.projectIds) || body.projectIds.length === 0) {
      return NextResponse.json(
        { error: 'projectIds must be a non-empty array' },
        { status: 400 }
      )
    }
    if (!Array.isArray(body.projectNames)) {
      return NextResponse.json({ error: 'projectNames must be an array' }, { status: 400 })
    }
  }

  const typedBody = body as unknown as FinalizeBody

  // Read + verify pending cookie.
  const pendingCookie = req.cookies.get('asana_pending_connect')?.value
  if (!pendingCookie) {
    return NextResponse.json(
      { error: 'Session expired — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  const payload = verifyState<PendingPayload>(pendingCookie)
  if (!payload || payload.provider !== 'asana' || payload.step !== 'scope') {
    return NextResponse.json(
      { error: 'Invalid session — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  if (!payload.workspaceId) {
    return NextResponse.json(
      { error: 'Session is missing workspace selection — please reconnect from the beginning' },
      { status: 400 }
    )
  }

  try {
    let projectIds: string[]
    let projectNames: string[]
    let portfolioId: string | undefined
    let portfolioName: string | undefined

    if (typedBody.scope === 'portfolio') {
      // Resolve projects from the portfolio server-side.
      portfolioId = typedBody.portfolioGid
      portfolioName = typedBody.portfolioName

      const portfolioProjects = await listPortfolioProjects({
        accessToken: payload.exchange_access_token,
        portfolioGid: portfolioId,
      })

      if (portfolioProjects.length === 0) {
        return NextResponse.json(
          {
            error: `The portfolio "${portfolioName}" contains no active projects. Please select a different portfolio or switch to Projects mode.`,
          },
          { status: 400 }
        )
      }

      projectIds = portfolioProjects.map((p) => p.gid)
      projectNames = portfolioProjects.map((p) => p.name)
    } else {
      // Projects mode: use submitted lists directly.
      projectIds = (typedBody.projectIds as unknown[]).filter(
        (v) => typeof v === 'string'
      ) as string[]
      projectNames = (typedBody.projectNames as unknown[]).filter(
        (v) => typeof v === 'string'
      ) as string[]

      if (projectIds.length === 0) {
        return NextResponse.json(
          { error: 'At least one projectId is required' },
          { status: 400 }
        )
      }
    }

    // Persist the integration row + token.
    const { integrationId } = completeConnect({
      state: {
        provider: 'asana',
        tenantId: payload.tenantId,
        level: payload.level,
        agencyId: payload.agencyId,
        accountId: payload.accountId,
        domainId: payload.domainId,
      },
      workspaceId: payload.workspaceId,
      workspaceDisplayName: payload.workspaceDisplayName,
      scope: typedBody.scope,
      portfolioId,
      portfolioName,
      projectIds,
      projectNames,
      exchange: {
        access_token: payload.exchange_access_token,
        refresh_token: payload.exchange_refresh_token,
        expires_in: payload.exchange_expires_in,
        data: payload.exchange_email ? { email: payload.exchange_email } : undefined,
        scopes: payload.exchange_scopes,
      },
    })

    const accountId = payload.accountId ?? 0

    // Fire the first snapshot (last 30 days). Non-fatal if it fails.
    try {
      const end = new Date()
      end.setDate(end.getDate() - 1)
      const start = new Date(end)
      start.setDate(start.getDate() - 29)

      const raw = await asanaAdapter.fetchSnapshot({
        integrationId,
        accountId,
        period: { start, end },
      })
      const normalized = asanaAdapter.normalize(raw)
      await persistSnapshot({
        tenant_id: payload.tenantId,
        integration_id: integrationId,
        account_id: accountId,
        period_start: normalized.periodStart,
        period_end: normalized.periodEnd,
        raw,
        normalized,
      })
    } catch (snapErr) {
      console.error('[platform/asana/finalize] initial snapshot failed:', snapErr)
    }

    // Clear the pending cookie.
    const response = NextResponse.json({ ok: true, integrationId })
    response.cookies.set('asana_pending_connect', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[platform/asana/finalize]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
