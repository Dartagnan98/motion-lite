import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { calendarId, color } = await req.json()
  if (!calendarId || !color) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const db = getDb()
  db.prepare('UPDATE google_calendars SET color = ? WHERE id = ?').run(color, calendarId)

  return NextResponse.json({ ok: true })
}
