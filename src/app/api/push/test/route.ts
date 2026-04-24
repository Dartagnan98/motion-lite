import { NextResponse } from 'next/server'
import { sendPushToAll } from '@/lib/push'
import { requireOwner } from '@/lib/auth'

export async function POST() {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  await sendPushToAll({
    title: 'Motion Lite',
    body: 'Push notifications are working.',
    url: '/',
  })

  return NextResponse.json({ ok: true })
}
