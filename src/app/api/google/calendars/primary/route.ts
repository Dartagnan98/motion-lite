import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { calendarId } = await req.json()
  if (!calendarId) return NextResponse.json({ error: 'Missing calendarId' }, { status: 400 })

  const db = getDb()

  // Clear all primary flags, then set the chosen one
  db.prepare('UPDATE google_calendars SET is_primary = 0').run()
  db.prepare('UPDATE google_calendars SET is_primary = 1 WHERE id = ?').run(calendarId)

  return NextResponse.json({ ok: true })
}
