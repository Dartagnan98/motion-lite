import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return NextResponse.json({
    ai_dev_mode: process.env.AI_DEV_MODE === 'true',
  })
}
