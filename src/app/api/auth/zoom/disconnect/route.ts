import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { deleteProviderToken } from '@/lib/provider-tokens'

export async function POST() {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await deleteProviderToken(user.id, 'zoom')

  return NextResponse.json({ ok: true })
}
