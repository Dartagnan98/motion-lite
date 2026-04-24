import { NextRequest, NextResponse } from 'next/server'
import { replaceExternalSchedules } from '@/lib/db'

export const runtime = 'nodejs'

function authenticateBridge(request: NextRequest): boolean {
  const secret = request.headers.get('x-bridge-secret')
  return !!secret && secret === process.env.BRIDGE_SECRET
}

/**
 * POST /api/dispatch/schedules/external/sync
 *
 * Called by the Mac dispatch-bridge on boot (and periodically) to sync its
 * live launchctl inventory into Motion's DB. Atomic full-replace per source:
 * entries not in the POST body get removed so disabled/uninstalled jobs
 * stop showing up in the external-mirrors list.
 *
 * Auth: x-bridge-secret header (same as /api/dispatch/queue bridge claim).
 *
 * Body shape:
 * {
 *   source: 'mac-launchd' | 'hetzner-crontab',
 *   entries: Array<{ label: string, raw: string, schedule_hint?, program?, location? }>
 * }
 */
export async function POST(request: NextRequest) {
  if (!authenticateBridge(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    source?: unknown
    entries?: unknown
  } | null

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const source = body.source
  if (source !== 'mac-launchd' && source !== 'hetzner-crontab') {
    return NextResponse.json(
      { error: "source must be 'mac-launchd' or 'hetzner-crontab'" },
      { status: 400 }
    )
  }

  if (!Array.isArray(body.entries)) {
    return NextResponse.json({ error: 'entries must be an array' }, { status: 400 })
  }

  const cleaned: Array<{ label: string; raw: string; schedule_hint?: string | null; program?: string | null; location?: string | null }> = []
  for (const raw of body.entries) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, 200) : ''
    const rawStr = typeof e.raw === 'string' ? e.raw.trim().slice(0, 200) : ''
    if (!label || !rawStr) continue
    cleaned.push({
      label,
      raw: rawStr,
      schedule_hint: typeof e.schedule_hint === 'string' ? e.schedule_hint.slice(0, 200) : null,
      program: typeof e.program === 'string' ? e.program.slice(0, 400) : null,
      location: typeof e.location === 'string' ? e.location.slice(0, 400) : null,
    })
  }

  replaceExternalSchedules(source, cleaned)

  return NextResponse.json({
    ok: true,
    source,
    synced: cleaned.length,
  })
}
