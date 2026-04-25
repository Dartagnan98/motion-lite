import { NextRequest, NextResponse } from 'next/server'
import { deleteGoogleAccount } from '@/lib/google'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await req.json()
  deleteGoogleAccount(id)
  return NextResponse.json({ ok: true })
}
