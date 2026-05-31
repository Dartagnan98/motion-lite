import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/db'
import { requireOwner } from '@/lib/auth'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 60

function loadAnthropicKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const envPath = path.join(homedir(), '.brand-voice/.env')
  if (existsSync(envPath)) {
    const txt = readFileSync(envPath, 'utf8')
    const m = txt.match(/^ANTHROPIC_API_KEY=(.+)$/m)
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '')
  }
  return null
}

const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
  auto: 'claude-sonnet-4-6',  // default for "auto"
}

export async function POST(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const body = await req.json().catch(() => ({})) as { agentId?: string; message?: string }
  if (!body.agentId || !body.message) {
    return NextResponse.json({ error: 'agentId and message required' }, { status: 400 })
  }

  const agent = getAgent(body.agentId)
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 })

  const apiKey = loadAnthropicKey()
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

  const modelKey = (agent.model_preference || 'auto').toLowerCase()
  const model = MODEL_MAP[modelKey] || MODEL_MAP.auto

  const systemPrompt = agent.system_prompt || ''

  const start = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: body.message }],
    }),
  })

  const elapsedMs = Date.now() - start

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return NextResponse.json(
      { error: `Anthropic ${res.status}: ${errText.slice(0, 500)}`, model },
      { status: 502 },
    )
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens: number; output_tokens: number } }
  const text = data.content?.find(c => c.type === 'text')?.text || ''

  return NextResponse.json({
    response: text,
    model,
    agent: { id: agent.id, name: agent.name },
    elapsed_ms: elapsedMs,
    usage: data.usage,
  })
}
