import { NextRequest, NextResponse } from 'next/server'
import { getRoutineWithSteps, updateRoutine, deleteRoutine } from '@/lib/db'
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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: idStr } = await ctx.params
  const id = Number(idStr)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const routine = getRoutineWithSteps(id)
  if (!routine) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ routine })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: idStr } = await ctx.params
  const id = Number(idStr)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({})) as {
    name?: unknown
    description?: unknown
    steps?: unknown
  }

  const patch: {
    name?: string
    description?: string | null
    steps?: Array<{
      title: string
      agent_id: string
      input_context: string | null
      blocked_by_order: number | null
    }>
  } = {}

  if (body.name !== undefined) {
    const n = typeof body.name === 'string' ? body.name.trim() : ''
    if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    patch.name = n
  }
  if (body.description !== undefined) {
    patch.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null
  }
  if (body.steps !== undefined) {
    const stepsOrError = validateSteps(body.steps)
    if ('error' in stepsOrError) {
      return NextResponse.json({ error: stepsOrError.error }, { status: 400 })
    }
    patch.steps = stepsOrError
  }

  const updated = updateRoutine(id, patch)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ routine: updated })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: idStr } = await ctx.params
  const id = Number(idStr)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  deleteRoutine(id)
  return NextResponse.json({ ok: true })
}
