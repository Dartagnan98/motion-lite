import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WEBHOOK_SECRET = process.env.TRANSCRIPT_WEBHOOK_SECRET || process.env.INTERNAL_API_SECRET || ''

const processing = new Set<string>()

/**
 * Generic transcript ingest webhook.
 *
 * Wire any meeting-bot or recording tool to POST here. Tested adapters:
 *   - Plaud (their webhook ships JSON with title + transcript)
 *   - Zoom (use /api/webhooks/transcript/zoom which adapts Zoom's
 *     `recording.transcript_completed` payload to this shape)
 *   - Otter / Fireflies / Read.ai — POST with the body below
 *   - cron job that scrapes any source and POSTs here
 *
 * Auth: x-webhook-secret header must match TRANSCRIPT_WEBHOOK_SECRET env var.
 *
 * Body:
 *   {
 *     title:       string,            // meeting title
 *     transcript:  string,            // full transcript text
 *     summary?:    string,            // optional pre-summary; AI will write
 *                                     // its own if missing
 *     source?:     string,            // e.g. "plaud", "zoom", "otter" — for
 *                                     // logging only
 *     recorded_at?: string,           // ISO timestamp; defaults to now
 *     external_id?: string,           // de-dupe key from your source system
 *     user_id?:    number,            // which Motion Lite user owns it
 *                                     // (defaults to first owner)
 *   }
 */
export async function POST(request: NextRequest) {
  // Auth (fail-closed)
  if (!WEBHOOK_SECRET) {
    console.error('[transcript-webhook] TRANSCRIPT_WEBHOOK_SECRET not set — rejecting')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  const provided = request.headers.get('x-webhook-secret')
  if (provided !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const title = String(body.title || '').trim()
  const transcript = String(body.transcript || '').trim()
  if (!title || !transcript) {
    return NextResponse.json({ error: 'title + transcript required' }, { status: 400 })
  }

  const summary = String(body.summary || '')
  const source = String(body.source || 'webhook')
  const externalId = body.external_id ? String(body.external_id) : null
  const recordedAt = body.recorded_at ? String(body.recorded_at) : new Date().toISOString()
  const userId = Number(body.user_id || 0) || resolveDefaultUserId()

  // De-dupe by external_id (idempotent retries)
  const dedupeKey = externalId ? `${source}:${externalId}` : `${source}:${title}:${recordedAt}`
  if (processing.has(dedupeKey)) {
    return NextResponse.json({ ok: true, deduped: true })
  }
  processing.add(dedupeKey)

  try {
    // Persist transcript so it shows up in /meeting-notes UI
    const d = getDb()
    ensureTranscriptsTable(d)

    if (externalId) {
      const existing = d.prepare('SELECT id FROM transcripts WHERE external_id = ?').get(externalId) as { id: number } | undefined
      if (existing) {
        return NextResponse.json({ ok: true, deduped: true, id: existing.id })
      }
    }

    const result = d.prepare(`
      INSERT INTO transcripts (title, transcript, summary, source, external_id, recorded_at, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, transcript, summary || '', source, externalId, recordedAt, new Date().toISOString(), userId)

    const id = Number(result.lastInsertRowid)
    console.log(`[transcript-webhook] stored transcript ${id} from ${source}: "${title}"`)

    // Hand off to AI processor (async — don't block the webhook)
    import('@/lib/meeting-processor').then(async ({ processTranscriptAI }) => {
      try {
        const r = await processTranscriptAI(
          { id, title, summary, transcript, recorded_at: recordedAt, created_at: new Date().toISOString() },
          userId,
        )
        console.log(`[transcript-webhook] AI: doc=${r.docId}, tasks=${r.taskIds?.length || 0}`)
        if (r.success) {
          d.prepare('UPDATE transcripts SET processed_at = ?, doc_id = ? WHERE id = ?')
            .run(new Date().toISOString(), r.docId || null, id)
        }
      } catch (err) {
        console.error(`[transcript-webhook] AI processing failed for ${id}:`, err)
      }
    })

    return NextResponse.json({ ok: true, id })
  } finally {
    setTimeout(() => processing.delete(dedupeKey), 10000)
  }
}

function ensureTranscriptsTable(d: ReturnType<typeof getDb>) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      transcript TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      external_id TEXT UNIQUE,
      recorded_at TEXT,
      created_at TEXT,
      processed_at TEXT,
      doc_id INTEGER,
      user_id INTEGER
    )
  `)
}

function resolveDefaultUserId(): number {
  try {
    const row = getDb().prepare("SELECT id FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined
    return row?.id || 1
  } catch {
    return 1
  }
}
