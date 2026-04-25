import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { getBrandVoice, updateBrandVoice } from '@/lib/brand-voice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await requireAuthWithWorkspace(request)
    return NextResponse.json(getBrandVoice(workspaceId))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unauthorized' }, { status: 401 })
  }
}

export async function PATCH(request: NextRequest) {
  let workspaceId: number
  try {
    ;({ workspaceId } = await requireAuthWithWorkspace(request))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const updated = updateBrandVoice(workspaceId, {
    voice_sample_text: typeof body.voice_sample_text === 'string' ? body.voice_sample_text : undefined,
    tone_words: body.tone_words,
    do_words: body.do_words,
    avoid_words: body.avoid_words,
    style_rules: body.style_rules,
  })
  return NextResponse.json(updated)
}
