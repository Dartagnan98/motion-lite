import { NextRequest, NextResponse } from 'next/server'
import { listRoutines, createRoutine } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

const AGENT_ALIAS: Record<string, string> = {
  claude: 'claude',
  orchestrator: 'orchestrator',
  team: 'orchestrator',
  jimmy: 'jimmy',
  gary: 'gary',
  ricky: 'ricky',
  sofia: 'sofia',
  marcus: 'marcus',
  nina: 'nina',
  theo: 'theo',
  qc: 'qc',
}

function normalizeAgent(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!s || !/^[a-z0-9_-]{2,32}$/.test(s)) return null
  return AGENT_ALIAS[s] ?? s
}

interface StepInput {
  title?: unknown
  agent_id?: unknown
  input_context?: unknown
  blocked_by_order?: unknown
}

function validateSteps(raw: unknown): Array<{
  title: string
  agent_id: string
  input_context: string | null
  blocked_by_order: number | null
}> | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'At least one step is required' }
  }
  const out: Array<{
    title: string
    agent_id: string
    input_context: string | null
    blocked_by_order: number | null
  }> = []
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] as StepInput
    const title = typeof s.title === 'string' ? s.title.trim() : ''
    if (!title) return { error: `Step ${i + 1}: title is required` }
    const agentId = normalizeAgent(s.agent_id)
    if (!agentId) return { error: `Step ${i + 1}: agent_id is required` }
    const ctxRaw = typeof s.input_context === 'string' ? s.input_context.trim() : ''
    const blockedByRaw = Number(s.blocked_by_order)
    const blockedBy = Number.isFinite(blockedByRaw) && blockedByRaw >= 0 && blockedByRaw < i
      ? blockedByRaw
      : null
    out.push({
      title,
      agent_id: agentId,
      input_context: ctxRaw || null,
      blocked_by_order: blockedBy,
    })
  }
  return out
}

export async function GET() {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const routines = listRoutines()
  return NextResponse.json({ routines })
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as {
    name?: unknown
    description?: unknown
    steps?: unknown
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : null

  const stepsOrError = validateSteps(body.steps)
  if ('error' in stepsOrError) {
    return NextResponse.json({ error: stepsOrError.error }, { status: 400 })
  }

  const routine = createRoutine({ name, description, steps: stepsOrError })
  return NextResponse.json({ routine }, { status: 201 })
}
