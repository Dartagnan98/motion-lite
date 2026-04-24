import { NextRequest, NextResponse } from 'next/server'
import { getDb, getTemplates, createProjectFromTemplate, getFolders, getUserWorkspaces } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { triggerRescheduleServer } from '@/lib/schedule-trigger'

/**
 * Quick-create a project from a template with minimal input.
 *
 * POST /api/projects/quick-create
 * {
 *   "template": "Campaign Launch" or template ID,
 *   "name": "1610 Hillcrest",
 *   "client": "Client D" (optional - matches folder name),
 *   "workspace": "Example Co" (optional - matches workspace name, defaults to first),
 *   "startDate": "2026-03-24" (optional - defaults to today),
 *   "roles": { "Account Manager": "Operator" } (optional - auto-maps if not provided)
 * }
 */
export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const body = await request.json()
  const { template: templateRef, name, client, workspace, startDate, roles } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
  }

  // Resolve template by name or ID
  const templates = getTemplates()
  let tmpl = typeof templateRef === 'number'
    ? templates.find(t => t.id === templateRef)
    : templates.find(t => t.name.toLowerCase() === templateRef?.toLowerCase())

  // Fuzzy match if exact match fails
  if (!tmpl && typeof templateRef === 'string') {
    const q = templateRef.toLowerCase()
    tmpl = templates.find(t => t.name.toLowerCase().includes(q))
  }

  if (!tmpl) {
    return NextResponse.json({
      error: `Template "${templateRef}" not found`,
      available: templates.map(t => ({ id: t.id, name: t.name })),
    }, { status: 404 })
  }

  // Resolve workspace
  const workspaces = getUserWorkspaces(user.id)
  let ws = workspace
    ? workspaces.find(w => w.name.toLowerCase() === workspace.toLowerCase()) || workspaces.find(w => w.name.toLowerCase().includes(workspace.toLowerCase()))
    : tmpl.workspace_id ? workspaces.find(w => w.id === tmpl!.workspace_id) : workspaces[0]

  if (!ws) ws = workspaces[0]
  if (!ws) return NextResponse.json({ error: 'No workspace available' }, { status: 400 })

  // Resolve folder by client name
  let folderId: number | undefined
  if (client) {
    const folders = getFolders(ws.id)
    const folder = folders.find(f => f.name.toLowerCase() === client.toLowerCase())
      || folders.find(f => f.name.toLowerCase().includes(client.toLowerCase()))
    if (folder) folderId = folder.id
  }

  // Build text variables
  const textVariables: Record<string, string> = {
    project_name: name.trim(),
  }
  if (client) textVariables.client_name = client
  else if (folderId) {
    const folders = getFolders(ws.id)
    const folder = folders.find(f => f.id === folderId)
    if (folder) textVariables.client_name = folder.name
  }

  // Build role assignments (if provided)
  const roleAssignments: Record<string, string> = roles || {}

  // Default start date to today
  const projectStartDate = startDate || new Date().toISOString().split('T')[0]

  // Calculate deadline from template stage durations
  let deadline: string | undefined
  try {
    const stages = JSON.parse(tmpl.stages)
    let totalDays = 0
    for (const s of stages) {
      const val = s.expected_duration_value || 1
      const unit = s.expected_duration_unit || 'weeks'
      if (unit === 'weeks') totalDays += val * 7
      else if (unit === 'months') totalDays += val * 30
      else totalDays += val
    }
    if (totalDays > 0) {
      const dl = new Date(projectStartDate)
      dl.setDate(dl.getDate() + totalDays)
      deadline = dl.toISOString().split('T')[0]
    }
  } catch { /* skip */ }

  // Create the project
  const project = createProjectFromTemplate(ws.id, tmpl.id, name.trim(), {
    folderId,
    startDate: projectStartDate,
    deadline,
    roleAssignments,
    textVariables,
  })

  if (!project) {
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }

  // Trigger scheduler to place tasks on calendar
  triggerRescheduleServer().catch(() => {})

  return NextResponse.json({
    id: project.id,
    public_id: (project as any).public_id,
    name: project.name,
    workspace: ws.name,
    folder: folderId ? textVariables.client_name : null,
    template: tmpl.name,
    startDate: projectStartDate,
    deadline,
    url: `https://app.example.com/project/${(project as any).public_id || project.id}`,
  })
}

/** GET: List available templates and folders for quick reference */
export async function GET(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const templates = getTemplates().map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    stages: (() => { try { return JSON.parse(t.stages).map((s: any) => s.name) } catch { return [] } })(),
    roles: (() => { try { return JSON.parse(t.roles || '[]').map((r: any) => r.name) } catch { return [] } })(),
  }))

  const workspaces = getUserWorkspaces(user.id).map(w => {
    const folders = getFolders(w.id).map(f => ({ id: f.id, name: f.name }))
    return { id: w.id, name: w.name, folders }
  })

  return NextResponse.json({ templates, workspaces })
}
