import { NextRequest, NextResponse } from 'next/server'
import { getFolders, createFolder, updateFolder, deleteFolder, getFolder, isWorkspaceMember, getDb } from '@/lib/db'
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
  const workspaceId = resolveId('workspaces', request.nextUrl.searchParams.get('workspaceId'))
  if (!workspaceId) return NextResponse.json([])
  if (!isWorkspaceMember(user.id, workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(getFolders(workspaceId))
}

export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { workspaceId, name, color, parentId } = body
  if (!workspaceId || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  if (!isWorkspaceMember(user.id, workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const folder = createFolder(workspaceId, name, color, parentId)
  return NextResponse.json(folder)
}

export async function PATCH(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id: rawId, ...data } = body
  const id = resolveId('folders', rawId ? String(rawId) : null)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const folder = getFolder(id)
  if (folder?.workspace_id && !isWorkspaceMember(user.id, folder.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    updateFolder(id, data)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = resolveId('folders', request.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const folder = getFolder(id)
  if (folder?.workspace_id && !isWorkspaceMember(user.id, folder.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    deleteFolder(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
