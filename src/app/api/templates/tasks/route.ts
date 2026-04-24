import { NextRequest, NextResponse } from 'next/server'
import { getTaskTemplates, createTaskTemplate, deleteTaskTemplate, getTaskTemplate, createTaskFromTemplate } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const wsId = request.nextUrl.searchParams.get('workspace_id')
  const templates = wsId ? getTaskTemplates(Number(wsId)) : getTaskTemplates()
  return NextResponse.json(templates)
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()

  // Create task(s) from template
  if (body.templateId) {
    const tasks = createTaskFromTemplate(body.templateId, {
      project_id: body.project_id,
      workspace_id: body.workspace_id,
      stage_id: body.stage_id,
    })
    if (tasks.length === 0) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    return NextResponse.json({ tasks })
  }

  // Create new template
  if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  const template = createTaskTemplate({
    name: body.name,
    description: body.description,
    default_title: body.default_title,
    default_priority: body.default_priority,
    default_duration_minutes: body.default_duration_minutes,
    default_status: body.default_status,
    subtasks: body.subtasks ? JSON.stringify(body.subtasks) : undefined,
    workspace_id: body.workspace_id,
  })
  return NextResponse.json(template)
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteTaskTemplate(body.id)
  return NextResponse.json({ ok: true })
}
