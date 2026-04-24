import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { processTranscriptAI } from '@/lib/meeting-processor'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/process
 * Manually trigger AI processing for a Plaud transcript.
 * Body: { transcriptId: number }
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { transcriptId } = await request.json()
  if (!transcriptId) {
    return NextResponse.json({ error: 'transcriptId required' }, { status: 400 })
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  // Fetch transcript from Supabase
  const res = await fetch(`${SUPABASE_URL}/rest/v1/plaud_transcripts?id=eq.${transcriptId}&limit=1`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 })
  }

  const rows = await res.json()
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
  }

  const transcript = rows[0]
  const result = await processTranscriptAI(transcript, user.id, { manual: true })

  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Processing failed' }, { status: 500 })
  }

  // Mark as processed in Supabase
  await fetch(`${SUPABASE_URL}/rest/v1/plaud_transcripts?id=eq.${transcriptId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      processed_by_jimmy: true,
      jimmy_processed_at: new Date().toISOString(),
    }),
  })

  return NextResponse.json({
    success: true,
    docId: result.docId,
    taskIds: result.taskIds,
    clientName: result.clientName,
  })
}
