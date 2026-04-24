/**
 * Reprocess all Plaud transcripts through the new AI Meeting pipeline.
 * Run from the app directory: npx tsx scripts/reprocess-meetings.ts
 *
 * Processes sequentially with a delay between each to avoid rate limits.
 */

// Load .env.local before anything else
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '..', '.env.local') })

/**
 * Skips transcripts that already have a doc created.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const DELAY_MS = 3000 // 3s between each to avoid rate limits

async function supabaseGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`)
  return res.json()
}

async function supabasePatch(path: string, body: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  })
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const mode = process.argv[2] || 'reprocess' // 'reprocess' (update notes only) or 'fresh' (create tasks too)

  // Dynamic import to get the processor (needs db initialized)
  const { processTranscriptAI, reprocessMeetingNotes } = await import('../src/lib/meeting-processor')

  // Fetch all transcripts
  const transcripts = await supabaseGet('plaud_transcripts?order=recorded_at.asc&limit=200')
  console.log(`Found ${transcripts.length} transcripts (mode: ${mode})\n`)

  let processed = 0
  let skipped = 0
  let failed = 0

  for (const t of transcripts) {
    // Skip if no meaningful content
    const hasContent = (t.transcript && t.transcript.trim().length > 50) ||
                       (t.summary && t.summary.trim().length > 20)
    if (!hasContent) {
      console.log(`[SKIP] #${t.id} "${t.title}" - no content`)
      skipped++
      continue
    }

    const idx = processed + skipped + failed + 1
    console.log(`[${idx}/${transcripts.length}] Processing #${t.id}: "${t.title}"`)

    try {
      if (mode === 'fresh') {
        // Full processing: creates tasks + doc
        const result = await processTranscriptAI(t, 1, { manual: true })
        if (result.success) {
          console.log(`  -> Doc: ${result.docId}, Tasks: ${result.taskIds?.length || 0}, Client: ${result.clientName || 'unknown'}`)
          await supabasePatch(`plaud_transcripts?id=eq.${t.id}`, {
            processed_by_jimmy: true,
            jimmy_processed_at: new Date().toISOString(),
          })
          processed++
        } else {
          console.log(`  -> Skipped: ${result.error}`)
          skipped++
        }
      } else {
        // Reprocess: update notes + business detection only, preserve existing tasks
        const result = await reprocessMeetingNotes(t, 1)
        if (result.success) {
          console.log(`  -> Doc: ${result.docId}, Client: ${result.clientName || 'none'}, Business: ${result.businessName || 'none'}`)
          processed++
        } else {
          console.log(`  -> Skipped: ${result.error}`)
          skipped++
        }
      }
    } catch (err) {
      console.error(`  -> FAILED:`, err)
      failed++
    }

    // Rate limit delay
    await sleep(DELAY_MS)
  }

  console.log(`\nDone! Processed: ${processed}, Skipped: ${skipped}, Failed: ${failed}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
