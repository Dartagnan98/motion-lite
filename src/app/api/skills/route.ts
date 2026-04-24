import { NextRequest, NextResponse } from 'next/server'
import {
  getInstalledSkills, getInstalledSkill, toggleSkill, deleteSkill,
  scanLocalSkills, installFromGithub, autoAssignSkills,
  checkAllSkillsHealth, checkSkillHealth,
  getSkillAgents, assignSkillToAgent,
  getRecentLearnings,
} from '@/lib/skills'
import { requireAuth } from '@/lib/auth'

// GET /api/skills - list all, or get one by id, or run actions
export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const action = request.nextUrl.searchParams.get('action')
  const id = Number(request.nextUrl.searchParams.get('id'))

  if (action === 'scan') {
    const result = scanLocalSkills()
    autoAssignSkills()
    return NextResponse.json(result)
  }

  if (action === 'health') {
    if (id) {
      return NextResponse.json(checkSkillHealth(id))
    }
    return NextResponse.json({ results: checkAllSkillsHealth() })
  }

  if (action === 'agents' && id) {
    return NextResponse.json({ agents: getSkillAgents(id) })
  }

  if (action === 'learnings') {
    const agentId = request.nextUrl.searchParams.get('agent_id') || 'jimmy'
    return NextResponse.json({ learnings: getRecentLearnings(agentId, 50) })
  }

  if (id) {
    const skill = getInstalledSkill(id)
    if (!skill) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const agents = getSkillAgents(id)
    return NextResponse.json({ skill, agents })
  }

  const skills = getInstalledSkills()
  return NextResponse.json({ skills })
}

// POST /api/skills - install from github or assign to agent
export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()

  if (body.github_url) {
    const result = installFromGithub(body.github_url)
    if (result.success) autoAssignSkills()
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  }

  if (body.skill_id && body.agent_id !== undefined) {
    assignSkillToAgent(body.skill_id, body.agent_id, body.enabled !== false)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Provide github_url or skill_id + agent_id' }, { status: 400 })
}

// PATCH /api/skills - toggle enabled/disabled
export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (body.enabled !== undefined) {
    toggleSkill(body.id, body.enabled)
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/skills?id=N
export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteSkill(id)
  return NextResponse.json({ ok: true })
}
