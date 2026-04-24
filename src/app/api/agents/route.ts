import { NextRequest, NextResponse } from 'next/server'
import { getAgents, getAgent, createAgent, updateAgent, deleteAgent } from '@/lib/db'
import { requireOwner } from '@/lib/auth'

export async function GET() {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const agents = getAgents()
  return NextResponse.json({ agents })
}

export async function POST(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await req.json()
  if (!body.id || !body.name) {
    return NextResponse.json({ error: 'id and name required' }, { status: 400 })
  }

  const existing = getAgent(body.id)
  if (existing) {
    return NextResponse.json({ error: 'Agent with this ID already exists' }, { status: 409 })
  }

  const agent = createAgent({
    id: body.id,
    name: body.name,
    role: body.role,
    system_prompt: body.system_prompt,
    soul_md: body.soul_md,
    memory_md: body.memory_md,
    avatar_color: body.avatar_color,
    can_delegate_to: body.can_delegate_to,
    task_types: body.task_types ? JSON.stringify(body.task_types) : undefined,
    schedule_id: body.schedule_id,
    max_daily_minutes: body.max_daily_minutes,
  })

  return NextResponse.json({ agent })
}

export async function PATCH(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await req.json()
  if (!body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const { id, ...data } = body
  if (data.task_types && Array.isArray(data.task_types)) {
    data.task_types = JSON.stringify(data.task_types)
  }

  const agent = updateAgent(id, data)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  return NextResponse.json({ agent })
}

export async function DELETE(req: NextRequest) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  deleteAgent(id)
  return NextResponse.json({ ok: true })
}
