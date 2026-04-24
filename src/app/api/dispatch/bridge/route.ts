import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireOwner } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getSetting, setSetting } from '@/lib/settings'

function readBridgeStatus() {
  const now = Math.floor(Date.now() / 1000)
  const lastPollRaw = getSetting<unknown>('dispatchBridgeLastPoll')
  const lastPoll = typeof lastPollRaw === 'number' ? lastPollRaw : null
  const pollAge = lastPoll ? now - lastPoll : null
  const online = pollAge !== null && pollAge < 120
  const restartToken = Number(getSetting<number>('dispatchBridgeRestartToken') || 0)
  const autoApprove = (() => {
    const raw = getSetting<unknown>('dispatchAutoApprove')
    if (typeof raw === 'boolean') return raw
    return process.env.DISPATCH_AUTO_APPROVE !== 'false'
  })()

  const d = getDb()
  const counts = d.prepare(`
    SELECT status, COUNT(*) AS count
    FROM dispatch_queue
    WHERE status != 'cancelled'
      AND COALESCE(run_type, 'single') != 'team_child'
    GROUP BY status
  `).all() as { status: string; count: number }[]

  const queueCounts = counts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row.count
    return acc
  }, {})

  return {
    online,
    lastPoll,
    pollAgeSeconds: pollAge,
    restartToken,
    autoApprove,
    queueCounts,
  }
}

export async function GET() {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(readBridgeStatus())
}

export async function POST(request: NextRequest) {
  try {
    await requireOwner()
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const action = body?.action as string | undefined

  if (action === 'restart') {
    setSetting('dispatchBridgeRestartToken', Date.now())
    return NextResponse.json({ ok: true, action: 'restart', ...readBridgeStatus() })
  }

  if (action === 'set_auto_approve') {
    setSetting('dispatchAutoApprove', !!body?.enabled)
    return NextResponse.json({ ok: true, action: 'set_auto_approve', ...readBridgeStatus() })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
