import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { reprocessMeetingNotes } from '@/lib/meeting-processor'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min max for batch processing

interface PlaudTranscript {
  id: number
  title: string
  summary: string
  transcript: string
  created_at: string
  recorded_at: string
}

async function supabaseGet(path: string): Promise<PlaudTranscript[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return []
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) return []
  return res.json()
}

/**
 * POST /api/meetings/reprocess
 * Reprocess meeting notes with enhanced AI (notes + business detection).
 * Does NOT recreate tasks.
 * Body: { transcriptId?: number } -- single transcript, or omit for all
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { transcriptId } = body as { transcriptId?: number }

  if (transcriptId) {
    // Single transcript reprocess
    const rows = await supabaseGet(`plaud_transcripts?id=eq.${transcriptId}&limit=1`)
    if (!rows.length) return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })

    const result = await reprocessMeetingNotes(rows[0], user.id)
    return NextResponse.json(result)
  }

  // Batch reprocess all transcripts
  const transcripts = await supabaseGet('plaud_transcripts?order=recorded_at.desc&limit=100')
  if (!transcripts.length) return NextResponse.json({ error: 'No transcripts found' }, { status: 404 })

  const results: { id: number; title: string; success: boolean; clientName?: string | null; businessName?: string | null; error?: string }[] = []

  for (const t of transcripts) {
    try {
      const result = await reprocessMeetingNotes(t, user.id)
      results.push({
        id: t.id,
        title: t.title,
        success: result.success,
        clientName: result.clientName,
        businessName: result.businessName,
        error: result.error,
      })
      console.log(`[reprocess] ${results.length}/${transcripts.length}: ${t.title} -> ${result.success ? 'OK' : result.error}`)
    } catch (err) {
      results.push({ id: t.id, title: t.title, success: false, error: String(err) })
    }
  }

  const successCount = results.filter(r => r.success).length
  return NextResponse.json({
    total: transcripts.length,
    success: successCount,
    failed: transcripts.length - successCount,
    results,
  })
}
