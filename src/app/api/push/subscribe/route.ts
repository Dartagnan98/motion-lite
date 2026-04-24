import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// POST: Store a push subscription
export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await req.json()
  const { endpoint, keys } = body

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  const db = getDb()
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, keys_p256dh, keys_auth)
    VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      keys_p256dh = excluded.keys_p256dh,
      keys_auth = excluded.keys_auth
  `).run(endpoint, keys.p256dh, keys.auth)

  return NextResponse.json({ ok: true })
}

// DELETE: Remove a push subscription
export async function DELETE(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { endpoint } = await req.json()
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })

  const db = getDb()
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
  return NextResponse.json({ ok: true })
}

// GET: Return VAPID public key for client-side subscription
export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
  if (!vapidPublicKey) {
    return NextResponse.json({ error: 'Push not configured' }, { status: 503 })
  }
  return NextResponse.json({ vapidPublicKey })
}
