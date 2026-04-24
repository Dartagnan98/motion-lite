import { NextRequest, NextResponse } from 'next/server'
import { getAllSkills, getAgentSkills, createAgentSkill, updateAgentSkill, deleteAgentSkill } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const agentId = req.nextUrl.searchParams.get('agentId')
  const skills = agentId ? getAgentSkills(agentId) : getAllSkills()
  return NextResponse.json({ skills })
}

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await req.json()

  // Handle "run" action to execute a skill
  if (body.action === 'run' && body.skillId) {
    const { executeSkill } = await import('@/lib/agent-executor')
    if (!body.agentId) {
      return NextResponse.json({ error: 'agentId required for run action' }, { status: 400 })
    }
    executeSkill(body.skillId, body.agentId).catch(() => {})
    return NextResponse.json({ ok: true, message: 'Skill execution started' })
  }

  if (!body.agent_id || !body.name) {
    return NextResponse.json({ error: 'agent_id and name required' }, { status: 400 })
  }
  const skill = createAgentSkill(body)
  return NextResponse.json({ skill })
}

export async function PATCH(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await req.json()
  if (!body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const { id, ...data } = body
  const skill = updateAgentSkill(id, data)
  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }
  return NextResponse.json({ skill })
}

export async function DELETE(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  deleteAgentSkill(Number(id))
  return NextResponse.json({ ok: true })
}
