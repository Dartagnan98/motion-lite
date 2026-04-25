import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { deleteProviderToken } from '@/lib/provider-tokens'
import { getDb } from '@/lib/db'

export async function POST() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  await deleteProviderToken(user.id, 'facebook')

  // Also remove ad accounts and pages
  const db = getDb()
  db.prepare('DELETE FROM user_ad_accounts WHERE user_id = ?').run(user.id)
  db.prepare('DELETE FROM user_pages WHERE user_id = ?').run(user.id)

  return NextResponse.json({ ok: true })
}
