import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { buildDispatchInputFromDoc, manualDispatchMeeting } from '@/lib/meeting-dispatch'
import { getLatestMeetingDispatch, getMeetingDispatchesForDoc } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/dispatch
 * Manually push a meeting-note pointer to Jimmy (Mac) via the Tailscale
 * inject endpoint. Skips triage, always sends.
 *
 * Body: { docId: number, urgency?: 'low'|'medium'|'high' }
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { docId, urgency } = body as { docId?: number; urgency?: 'low' | 'medium' | 'high' }
  if (!docId) {
    return NextResponse.json({ error: 'docId required' }, { status: 400 })
  }

  const input = buildDispatchInputFromDoc(docId)
  if (!input) {
    return NextResponse.json({ error: 'Meeting doc not found' }, { status: 404 })
  }

  const result = await manualDispatchMeeting(input, urgency ? { urgency } : undefined)
  const latest = getLatestMeetingDispatch(docId)

  return NextResponse.json({
    dispatched: result.dispatched,
    reason: result.reason,
    dispatch: latest,
  })
}

/**
 * GET /api/meetings/dispatch?docId=123
 * Return dispatch history for a meeting doc (for the UI status badge).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const docIdStr = url.searchParams.get('docId')
  const docId = docIdStr ? parseInt(docIdStr, 10) : NaN
  if (!Number.isFinite(docId)) {
    return NextResponse.json({ error: 'docId required' }, { status: 400 })
  }

  const history = getMeetingDispatchesForDoc(docId)
  return NextResponse.json({ history })
}
