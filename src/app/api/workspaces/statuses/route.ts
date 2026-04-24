import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceStatuses, createWorkspaceStatus, updateWorkspaceStatus, deleteWorkspaceStatus, getDb } from '@/lib/db'
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
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  return NextResponse.json(getWorkspaceStatuses(workspaceId))
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const wsId = resolveId('workspaces', body.workspaceId ? String(body.workspaceId) : null)
  const { name, color } = body
  if (!wsId || !name) return NextResponse.json({ error: 'Missing workspaceId or name' }, { status: 400 })
  const status = createWorkspaceStatus(wsId, name, color || '#7a6b55')
  return NextResponse.json(status)
}

export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const updated = updateWorkspaceStatus(id, data)
  return NextResponse.json(updated)
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteWorkspaceStatus(id)
  return NextResponse.json({ ok: true })
}
