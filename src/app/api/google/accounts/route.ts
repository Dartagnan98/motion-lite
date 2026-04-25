import { NextResponse } from 'next/server'
import { getGoogleAccounts } from '@/lib/google'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const accounts = getGoogleAccounts()
    return NextResponse.json(accounts.map(a => ({ id: a.id, email: a.email })))
  } catch {
    return NextResponse.json([])
  }
}
