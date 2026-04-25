import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { analyzeVoiceSample } from '@/lib/brand-voice'
import { getApiKey } from '@/lib/agent-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { sample?: string }
  const sample = String(body.sample || '').trim()
  if (!sample) return NextResponse.json({ error: 'sample required' }, { status: 400 })
  if (sample.length < 80) return NextResponse.json({ error: 'sample too short — paste a longer chunk for a useful analysis' }, { status: 400 })

  // Resolve Anthropic key from DB or env (same path the meeting processor uses)
  const keyConfig = getApiKey(1)
  const apiKey = keyConfig?.apiKey || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey || !apiKey.startsWith('sk-ant')) {
    return NextResponse.json({ error: 'Anthropic API key not configured. Add it in Settings or set ANTHROPIC_API_KEY env var.' }, { status: 400 })
  }

  try {
    const result = await analyzeVoiceSample(sample, apiKey)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Analysis failed' }, { status: 500 })
  }
}
