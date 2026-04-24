import { NextRequest, NextResponse } from 'next/server'
import { getCustomFields, createCustomField, updateCustomField, deleteCustomField, getTaskCustomFieldValues, setTaskCustomFieldValue, getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  return row?.id || null
}

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const workspaceId = resolveId('workspaces', request.nextUrl.searchParams.get('workspaceId')) || 0
  const taskId = resolveId('tasks', request.nextUrl.searchParams.get('taskId')) || 0
  const values = request.nextUrl.searchParams.get('values')

  if (taskId && values) {
    return NextResponse.json({ values: getTaskCustomFieldValues(taskId) })
  }

  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  return NextResponse.json({ fields: getCustomFields(workspaceId) })
}

export async function PUT(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const taskIdResolved = resolveId('tasks', body.taskId ? String(body.taskId) : null)
  const { fieldId, value } = body
  if (!taskIdResolved || !fieldId) return NextResponse.json({ error: 'Missing taskId or fieldId' }, { status: 400 })
  setTaskCustomFieldValue(taskIdResolved, fieldId, value || null)
  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const wsId = resolveId('workspaces', body.workspaceId ? String(body.workspaceId) : null)
  const { name, fieldType, options } = body
  if (!wsId || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  const field = createCustomField(wsId, name, fieldType || 'text', options)
  return NextResponse.json(field)
}

export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const field = updateCustomField(id, data)
  return NextResponse.json(field)
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteCustomField(id)
  return NextResponse.json({ ok: true })
}
