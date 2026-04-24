import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const WEBHOOK_SECRET = process.env.INTERNAL_API_SECRET || ''

// In-flight processing guard (prevents duplicate concurrent processing)
const processing = new Set<number>()

/**
 * POST /api/webhooks/transcript
 * Supabase Database Webhook fires on INSERT to plaud_transcripts.
 * Auto-processes via AI: cleans transcript, identifies client, creates doc + tasks.
 * Also sends to Jimmy chat session for conversational follow-up.
 *
 * Authentication: requires x-internal-token header matching INTERNAL_API_SECRET,
 * or Authorization header matching Supabase service role key.
 */
export async function POST(request: NextRequest) {
  // Authenticate: accept internal token or Supabase service key
  const internalToken = request.headers.get('x-internal-token')
  const authHeader = request.headers.get('authorization')
  const supabaseAuth = authHeader?.replace('Bearer ', '')

  // Always require auth. If no secret is configured, reject everything (fail-closed).
  if (!WEBHOOK_SECRET && !SUPABASE_KEY) {
    console.error('[transcript-webhook] No INTERNAL_API_SECRET or SUPABASE_SERVICE_ROLE_KEY configured -- rejecting all requests')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const tokenValid = WEBHOOK_SECRET && internalToken === WEBHOOK_SECRET
  const supabaseValid = SUPABASE_KEY && supabaseAuth === SUPABASE_KEY
  if (!tokenValid && !supabaseValid) {
    console.warn('[transcript-webhook] Unauthorized request rejected')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { type, record } = body ?? {}

    if (type === 'INSERT' && record?.id) {
      const id = Number(record.id)

      // Concurrency guard: skip if already processing this transcript
      if (processing.has(id)) {
        console.log(`[transcript-webhook] Already processing transcript ${id}, skipping duplicate`)
        return NextResponse.json({ ok: true })
      }
      processing.add(id)

      console.log(`[transcript-webhook] Received INSERT for transcript ${id}: "${record.title}"`)

      // 1. AI auto-processing: create doc + tasks (async, don't block webhook)
      import('@/lib/meeting-processor').then(async ({ processTranscriptAI }) => {
        try {
          // Fetch full transcript from Supabase
          const res = await fetch(`${SUPABASE_URL}/rest/v1/plaud_transcripts?id=eq.${id}&limit=1`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
          })
          if (!res.ok) {
            console.error(`[transcript-webhook] Supabase fetch failed for ${id}: ${res.status}`)
            return
          }
          const rows = await res.json()
          if (!rows?.[0]) {
            console.error(`[transcript-webhook] Transcript ${id} not found in Supabase`)
            return
          }

          const result = await processTranscriptAI(rows[0], 1)
          console.log(`[transcript-webhook] AI processing: success=${result.success}, doc=${result.docId}, tasks=${result.taskIds?.length || 0}`)

          // Mark as processed in Supabase
          if (result.success) {
            await fetch(`${SUPABASE_URL}/rest/v1/plaud_transcripts?id=eq.${id}`, {
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
          }
        } finally {
          processing.delete(id)
        }
      }).catch(err => {
        console.error(`[transcript-webhook] AI processing failed for ${id}:`, err)
        processing.delete(id)
      })

      // 2. Also send to Jimmy chat session for conversational processing
      import('@/lib/transcript-watcher').then(async ({ processTranscriptById }) => {
        await processTranscriptById(id)
      }).catch(err => {
        console.error(`[transcript-webhook] Jimmy processing failed for ${id}:`, err)
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[transcript-webhook] Unhandled error:', err)
    return NextResponse.json({ ok: true }) // always 200 for Supabase to prevent retries
  }
}
