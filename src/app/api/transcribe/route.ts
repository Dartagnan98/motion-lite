import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getAttachmentTranscript, setAttachmentTranscript } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET: Check if a transcription already exists for an attachment
 */
export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const attachmentId = req.nextUrl.searchParams.get('attachment_id')
  if (!attachmentId) return NextResponse.json({ error: 'Missing attachment_id' }, { status: 400 })

  const transcript = getAttachmentTranscript(Number(attachmentId))
  return NextResponse.json({ text: transcript })
}

/**
 * POST: Transcribe audio using Groq Whisper API (free).
 * Falls back to OpenAI Whisper if OPENAI_API_KEY is set and GROQ is not.
 * Accepts FormData with an 'audio' file field and optional 'attachment_id'.
 */
export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const GROQ_KEY = process.env.GROQ_API_KEY
  const OPENAI_KEY = process.env.OPENAI_API_KEY

  if (!GROQ_KEY && !OPENAI_KEY) {
    return NextResponse.json({ error: 'No transcription API key configured' }, { status: 503 })
  }

  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as File
    const attachmentId = formData.get('attachment_id') as string | null

    if (!audio) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Check if we already have a transcript stored
    if (attachmentId) {
      const existing = getAttachmentTranscript(Number(attachmentId))
      if (existing) {
        return NextResponse.json({ text: existing })
      }
    }

    const whisperForm = new FormData()
    whisperForm.append('file', audio, audio.name || 'recording.webm')
    whisperForm.append('model', GROQ_KEY ? 'whisper-large-v3' : 'whisper-1')
    whisperForm.append('language', 'en')

    const apiUrl = GROQ_KEY
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions'
    const apiKey = GROQ_KEY || OPENAI_KEY

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: whisperForm,
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Transcription API error: ${err}` }, { status: 502 })
    }

    const data = await res.json()
    const text = data.text || ''

    // Persist to DB if we have an attachment ID
    if (attachmentId && text) {
      setAttachmentTranscript(Number(attachmentId), text)
    }

    return NextResponse.json({ text })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
