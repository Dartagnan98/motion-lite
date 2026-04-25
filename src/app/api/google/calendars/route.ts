import { NextResponse } from 'next/server'
import { getGoogleCalendars } from '@/lib/google'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    return NextResponse.json(getGoogleCalendars())
  } catch {
    return NextResponse.json([])
  }
}
