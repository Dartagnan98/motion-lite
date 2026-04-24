import { NextRequest, NextResponse } from 'next/server'
import { getUserWorkspaces, isWorkspaceMember, createWorkspace, updateWorkspace, deleteWorkspace, getWorkspaceById, getDb, addChannelMember, getTeamMembers, addUserToWorkspace } from '@/lib/db'
import { requireAuth, getCurrentUser, requireOwner } from '@/lib/auth'

function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  return row?.id || null
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = resolveId('workspaces', request.nextUrl.searchParams.get('id'))
  if (id) {
    // Verify membership before returning workspace
    if (!isWorkspaceMember(user.id, id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(getWorkspaceById(id))
  }
  return NextResponse.json(getUserWorkspaces(user.id))
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const { name, color, copyFromId } = body
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const ws = createWorkspace(name, slug, color, copyFromId)

  // Add creator as owner of the new workspace
  addUserToWorkspace(user.id, ws.id, 'owner')

  // Auto-create general channel and add all team members
  if (!(ws as any).is_private) {
    const d = getDb()
    const result = d.prepare(
      "INSERT INTO msg_channels (name, slug, type, workspace_id, is_default, created_by, description) VALUES (?, ?, 'public', ?, 1, ?, ?)"
    ).run('general', `general-ws-${ws.id}`, ws.id, user.id, 'Company-wide announcements and chat')
    const channelId = Number(result.lastInsertRowid)
    const members = getTeamMembers()
    for (const tm of members) {
      addChannelMember(channelId, tm.id)
    }
  }

  return NextResponse.json(ws)
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const { id: rawId, ...data } = body
  const id = resolveId('workspaces', rawId ? String(rawId) : null)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  // Only workspace owner can modify workspace settings
  const existing = getWorkspaceById(id)
  if (!existing || existing.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const updated = updateWorkspace(id, data)
  return NextResponse.json(updated)
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = resolveId('workspaces', request.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  // Only workspace owner can delete workspace
  const ws = getWorkspaceById(id)
  if (!ws || ws.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  deleteWorkspace(id)
  return NextResponse.json({ ok: true })
}
