import { NextRequest, NextResponse } from 'next/server'
import {
  getWorkspaceById,
  isWorkspaceMember,
  getWorkspaceMemberRole,
  addUserToWorkspace,
  removeUserFromWorkspace,
  getWorkspaceMembers,
  getMsgChannels,
  addChannelMember,
  getDb,
} from '@/lib/db'
import { requireAuth, getUserByEmail, getUsers } from '@/lib/auth'

function resolveWorkspaceId(param: string): number | null {
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare('SELECT id FROM workspaces WHERE public_id = ?').get(param) as { id: number } | undefined
  return row?.id || null
}

// GET: list workspace members (users + agents)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id } = await params
  const workspaceId = resolveWorkspaceId(id)
  if (!workspaceId) return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })

  if (!isWorkspaceMember(user.id, workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data = getWorkspaceMembers(workspaceId)
  return NextResponse.json(data)
}

// POST: invite user by email
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id } = await params
  const workspaceId = resolveWorkspaceId(id)
  if (!workspaceId) return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })

  const ws = getWorkspaceById(workspaceId)
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Only owner/admin can invite
  const callerRole = getWorkspaceMemberRole(user.id, workspaceId)
  if (!callerRole || !['owner', 'admin'].includes(callerRole)) {
    return NextResponse.json({ error: 'Only owner or admin can invite members' }, { status: 403 })
  }

  const body = await request.json()
  const { email, role } = body
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Find user by email
  const targetUser = await getUserByEmail(email)
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found. They must sign up first.' }, { status: 404 })
  }

  // Check if already a member
  if (isWorkspaceMember(targetUser.id, workspaceId)) {
    return NextResponse.json({ error: 'User is already a member of this workspace' }, { status: 409 })
  }

  // Add to workspace
  try {
    addUserToWorkspace(targetUser.id, workspaceId, role || 'member')
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'PRIVATE_WORKSPACE_RESTRICTED') {
      return NextResponse.json({ error: 'Cannot invite members to a private workspace' }, { status: 403 })
    }
    throw err
  }

  // Auto-add to default/general channels in this workspace
  const channels = getMsgChannels(undefined, workspaceId)
  const defaultChannels = channels.filter((c: any) => c.is_default === 1)
  for (const ch of defaultChannels) {
    addChannelMember(ch.id, targetUser.id)
  }

  return NextResponse.json({
    ok: true,
    member: {
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: role || 'member',
    },
  })
}

// DELETE: remove member from workspace
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id } = await params
  const workspaceId = resolveWorkspaceId(id)
  if (!workspaceId) return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })

  // Only owner/admin can remove
  const callerRole = getWorkspaceMemberRole(user.id, workspaceId)
  if (!callerRole || !['owner', 'admin'].includes(callerRole)) {
    return NextResponse.json({ error: 'Only owner or admin can remove members' }, { status: 403 })
  }

  const body = await request.json()
  const { user_id } = body
  if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  // Can't remove workspace owner
  const ws = getWorkspaceById(workspaceId)
  if (ws && (ws as any).owner_id === user_id) {
    return NextResponse.json({ error: 'Cannot remove workspace owner' }, { status: 403 })
  }

  removeUserFromWorkspace(user_id, workspaceId)

  return NextResponse.json({ ok: true })
}
