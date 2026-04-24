import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getRecentMeetingProcessingEvents } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/meeting-processing/events
 * Returns the last N meeting processing runs for the AI Dispatch page.
 */
export async function GET() {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const events = getRecentMeetingProcessingEvents(50)
  return NextResponse.json({ events })
}
