import { NextRequest, NextResponse } from 'next/server'
import {
  finalizeToolInvocation,
  getToolInvocation,
  updateDispatch,
} from '@/lib/db'

export const runtime = 'nodejs'

function authenticateBridge(request: NextRequest): boolean {
  const secret = request.headers.get('x-bridge-secret')
  return !!secret && secret === process.env.BRIDGE_SECRET
}

/**
 * POST /api/dispatch/tools/invocations/[id]/complete
 *
 * Bridge-only endpoint for closing out a bridge-forward tool call. The Mac
 * dispatch-bridge claims a dispatch with source_agent_id='tool-forward',
 * runs the tool's endpoint command locally, and POSTs the outcome here so
 * the invocation row flips from pending → ok|error.
 *
 * Body: { status: 'ok' | 'error', result?, error?, duration_ms? }
 * Auth: x-bridge-secret header (same as queue claim).
 *
 * Also nudges the forwarding dispatch row to done/failed so it doesn't stay
 * "working" in the board forever.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authenticateBridge(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: idRaw } = await params
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid invocation id' }, { status: 400 })
  }
  const existing = getToolInvocation(id)
  if (!existing) {
    return NextResponse.json({ error: 'invocation not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const status = body.status === 'error' ? 'error' : 'ok'
  const error = typeof body.error === 'string' ? body.error.slice(0, 1000) : null
  const durationRaw = Number(body.duration_ms)
  const durationMs = Number.isFinite(durationRaw) && durationRaw >= 0
    ? Math.floor(durationRaw)
    : null

  const updated = finalizeToolInvocation(id, {
    status,
    result: body.result,
    error,
    durationMs,
  })

  // Mirror the outcome on the forward dispatch row if one is linked.
  if (existing.forward_dispatch_id) {
    try {
      const resultText = typeof body.result === 'string'
        ? body.result.slice(0, 4000)
        : body.result !== undefined
          ? JSON.stringify(body.result).slice(0, 4000)
          : null
      updateDispatch(existing.forward_dispatch_id, {
        status: status === 'ok' ? 'done' : 'failed',
        result: resultText,
        error,
        completed_at: Math.floor(Date.now() / 1000),
      })
    } catch { /* dispatch row may already be closed — keep going */ }
  }

  return NextResponse.json({ ok: true, invocation: updated })
}
