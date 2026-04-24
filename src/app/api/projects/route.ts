import { NextRequest, NextResponse } from 'next/server'
import { getProject, getProjectByPublicId, getProjects, getAllProjects, createProject, createProjectFromTemplate, createStage, updateProject, deleteProject, archiveProject, unarchiveProject, getUserWorkspaces, getProjectTemplateUsage } from '@/lib/db'
import { requireAuth, getCurrentUser, getWorkspaceIdFromRequest } from '@/lib/auth'
import { isWorkspaceMember } from '@/lib/db'
import { triggerRescheduleServer } from '@/lib/schedule-trigger'

function resolveProjectId(param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const project = getProjectByPublicId(param)
  return project?.id || null
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = Number(request.nextUrl.searchParams.get('workspaceId'))
  const id = resolveProjectId(request.nextUrl.searchParams.get('id'))
  const all = request.nextUrl.searchParams.get('all')
  const templateUsage = request.nextUrl.searchParams.get('template_usage') === '1'
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === '1'
  if (id) {
    const project = getProject(id)
    if (project?.workspace_id && !isWorkspaceMember(user.id, project.workspace_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(project)
  }
  if (all === '1') {
    // Use header workspace ID if provided, otherwise scope to user's workspaces
    const headerWsId = getWorkspaceIdFromRequest(request)
    if (headerWsId && !isWorkspaceMember(user.id, headerWsId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const wsFilter = headerWsId || getUserWorkspaces(user.id).map(w => w.id)
    return NextResponse.json(getAllProjects(wsFilter))
  }
  if (templateUsage) {
    const headerWsId = getWorkspaceIdFromRequest(request)
    if (workspaceId && !isWorkspaceMember(user.id, workspaceId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (headerWsId && !isWorkspaceMember(user.id, headerWsId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const wsFilter = workspaceId || headerWsId || getUserWorkspaces(user.id).map(w => w.id)
    const usageRows = getProjectTemplateUsage(wsFilter)
    const usageByTemplate: Record<number, { id: number; name: string }[]> = {}
    for (const row of usageRows) {
      if (!usageByTemplate[row.template_id]) usageByTemplate[row.template_id] = []
      usageByTemplate[row.template_id].push({ id: row.id, name: row.name })
    }
    return NextResponse.json({ usageByTemplate })
  }
  if (workspaceId) {
    if (!isWorkspaceMember(user.id, workspaceId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(getProjects(workspaceId, undefined, includeArchived))
  }
  return NextResponse.json([])
}

export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { workspaceId, name, folderId, color, templateId, startDate, deadline, roleAssignments, textVariables } = body
  if (!workspaceId || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!isWorkspaceMember(user.id, workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Create from project template if templateId provided
  if (templateId) {
    const project = createProjectFromTemplate(workspaceId, templateId, name, {
      folderId, color, startDate, deadline, roleAssignments, textVariables
    })
    if (!project) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    // Trigger scheduler to place all new tasks on the calendar
    triggerRescheduleServer().catch(() => {})
    return NextResponse.json(project)
  }

  const project = createProject(workspaceId, name, folderId, color)
  // Create default stages
  createStage(project.id, 'Todo', '#42a5f5')
  createStage(project.id, 'In Progress', '#ffd740')
  createStage(project.id, 'Done', '#00e676')
  return NextResponse.json(project)
}

export async function PATCH(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const existingProject = getProject(id)
  if (existingProject?.workspace_id && !isWorkspaceMember(user.id, existingProject.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Handle archive/unarchive shortcut
  if (data.archived === 1) {
    archiveProject(id)
  } else if (data.archived === 0) {
    unarchiveProject(id)
  }
  // Apply remaining updates (archived is also handled by updateProject if passed)
  const { archived, ...rest } = data
  if (Object.keys(rest).length > 0) {
    updateProject(id, rest)
  }
  const result = getProject(id)
  return NextResponse.json(result ? { ...result } : { error: 'Not found' })
}

export async function DELETE(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const existingProject = getProject(id)
  if (existingProject?.workspace_id && !isWorkspaceMember(user.id, existingProject.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    deleteProject(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
