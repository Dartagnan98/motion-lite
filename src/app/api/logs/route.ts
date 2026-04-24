import { NextRequest, NextResponse } from 'next/server'
import { listScheduledTasks, getConversationHistory, getAllTaskActivities } from '@/lib/db'
import { requireOwner } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const type = req.nextUrl.searchParams.get('type') || 'all'
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')

  const scheduled = listScheduledTasks()
  const activities = type === 'scheduled' ? [] : getAllTaskActivities(limit)
  const conversations = type === 'conversations' || type === 'all'
    ? getConversationHistory(undefined, limit)
    : []

  return NextResponse.json({
    scheduled,
    activities,
    conversations,
  })
}
