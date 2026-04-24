import { NextRequest, NextResponse } from 'next/server'
import { getAllSettings, setSetting } from '@/lib/settings'
import { requireAuth, requireOwner } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const settings = getAllSettings()
  return NextResponse.json(settings)
}

export async function PATCH(req: NextRequest) {
  try { await requireOwner() } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json()
  for (const [key, value] of Object.entries(body)) {
    setSetting(key, value)
  }
  const settings = getAllSettings()
  return NextResponse.json(settings)
}
