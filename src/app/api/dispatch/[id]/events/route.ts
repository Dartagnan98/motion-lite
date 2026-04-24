import { NextRequest, NextResponse } from 'next/server'
import { addDispatchEvents, getDispatchEvents, getDispatchById } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

function authenticateBridge(request: NextRequest): boolean {
  const secret = request.headers.get('x-bridge-secret')
  return !!secret && secret === process.env.BRIDGE_SECRET
}

/**
 * GET /api/dispatch/[id]/events?after=<lastId>
 *
 * Returns events for a dispatch. Client polls with ?after= to get only new
 * rows since the last fetch.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid dispatch ID' }, { status: 400 })
  }

  const dispatch = getDispatchById(id)
  if (!dispatch) {
    return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })
  }

  const afterParam = request.nextUrl.searchParams.get('after')
  const after = afterParam && Number.isFinite(Number(afterParam)) ? Number(afterParam) : 0

  const events = getDispatchEvents(id, after)
  const lastId = events.length > 0 ? events[events.length - 1].id : after

  return NextResponse.json({
    events,
    lastId,
    dispatchStatus: dispatch.status,
  })
}

/**
 * POST /api/dispatch/[id]/events
 * Body: { events: [{ ts?: number, kind: string, payload?: unknown }] }
 *
 * The Mac dispatch-bridge ships SDK message batches here while running a
 * dispatch. Fire-and-forget from the bridge's perspective; a failure to
 * ship events must not kill the dispatch, so we validate loosely.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authenticateBridge(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid dispatch ID' }, { status: 400 })
  }

  const dispatch = getDispatchById(id)
  if (!dispatch) {
    return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })
  }

  let body: { events?: Array<{ ts?: number; kind?: string; payload?: unknown }> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const incoming = Array.isArray(body?.events) ? body.events : []
  if (incoming.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 })
  }

  const valid = incoming
    .filter((ev): ev is { ts?: number; kind: string; payload?: unknown } => !!ev && typeof ev.kind === 'string' && ev.kind.length > 0)
    .slice(0, 200)

  const inserted = addDispatchEvents(id, valid)

  return NextResponse.json({ ok: true, inserted })
}
