import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET: Fetch and clear pending notifications
export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const since = req.nextUrl.searchParams.get('since') || '0'
  const db = getDb()

  // Create table if not exists
  db.exec(`CREATE TABLE IF NOT EXISTS notification_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`)

  const rows = db.prepare(
    'SELECT * FROM notification_queue WHERE id > ? ORDER BY id ASC LIMIT 10'
  ).all(Number(since))

  return NextResponse.json({ notifications: rows })
}
