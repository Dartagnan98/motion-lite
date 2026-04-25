import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth'

export async function GET() {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return NextResponse.json({
    hasDevToken: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    hasMccId: !!process.env.GOOGLE_ADS_MCC_ID,
  })
}
