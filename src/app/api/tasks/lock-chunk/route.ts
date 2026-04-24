import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { lockTaskChunk } from '@/lib/db'
import { triggerRescheduleServer } from '@/lib/schedule-trigger'

export async function POST(request: Request) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const body = await request.json()
  const { task_id, old_chunk_start, new_chunk_start, new_chunk_end } = body

  if (!task_id || !old_chunk_start || !new_chunk_start || !new_chunk_end) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    lockTaskChunk(task_id, old_chunk_start, new_chunk_start, new_chunk_end)
    await triggerRescheduleServer().catch(() => {})
    return NextResponse.json({ ok: true, rescheduled: true })
  } catch (err) {
    console.error('[lock-chunk] Error:', err)
    return NextResponse.json({ error: 'Failed to lock chunk' }, { status: 500 })
  }
}
