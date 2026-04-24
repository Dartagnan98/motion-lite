import { NextRequest, NextResponse } from 'next/server'
import { getTemplates, createTemplate, createTemplateFromProject, updateTemplate, deleteTemplate } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return NextResponse.json(getTemplates())
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()

  if (body.fromProjectId) {
    const template = createTemplateFromProject(body.fromProjectId, body.name, body.description)
    return NextResponse.json(template)
  }

  if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  const template = createTemplate({
    name: body.name,
    description: body.description,
    stages: body.stages || '[]',
    default_tasks: body.default_tasks || '[]',
    workspace_id: body.workspace_id,
    roles: body.roles || '[]',
  })
  return NextResponse.json(template)
}

export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const template = updateTemplate(body.id, {
    name: body.name,
    description: body.description,
    stages: body.stages,
    default_tasks: body.default_tasks,
    roles: body.roles,
    text_variables: body.text_variables,
  })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  return NextResponse.json(template)
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteTemplate(body.id)
  return NextResponse.json({ ok: true })
}
