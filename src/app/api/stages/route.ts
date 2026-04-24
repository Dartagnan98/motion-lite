import { NextRequest, NextResponse } from 'next/server'
import { getStages, createStage, updateStage, deleteStage, reassignStageTasks, reorderStages, getProject, getDb, isWorkspaceMember } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  return row?.id || null
}

export async function GET(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const projectId = resolveId('projects', request.nextUrl.searchParams.get('projectId'))
  if (!projectId) return NextResponse.json([])
  const project = getProject(projectId)
  if (project?.workspace_id && !isWorkspaceMember(user.id, project.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(getStages(projectId))
}

export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { projectId, name, color } = body
  if (!projectId || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const project = getProject(projectId)
  if (project?.workspace_id && !isWorkspaceMember(user.id, project.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const stage = createStage(projectId, name, color)
  return NextResponse.json(stage)
}

export async function PATCH(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  // Look up stage's project to verify workspace membership
  const stage = getDb().prepare('SELECT project_id FROM stages WHERE id = ?').get(id) as { project_id: number } | undefined
  if (stage) {
    const project = getProject(stage.project_id)
    if (project?.workspace_id && !isWorkspaceMember(user.id, project.workspace_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  updateStage(id, data)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, reassignTo } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const stage = getDb().prepare('SELECT project_id FROM stages WHERE id = ?').get(id) as { project_id: number } | undefined
  if (stage) {
    const project = getProject(stage.project_id)
    if (project?.workspace_id && !isWorkspaceMember(user.id, project.workspace_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  reassignStageTasks(id, reassignTo ?? null)
  deleteStage(id)
  return NextResponse.json({ ok: true })
}

export async function PUT(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { projectId, stageIds } = body
  if (!projectId || !Array.isArray(stageIds)) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const project = getProject(projectId)
  if (project?.workspace_id && !isWorkspaceMember(user.id, project.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  reorderStages(projectId, stageIds)
  return NextResponse.json({ ok: true })
}
