import { NextRequest, NextResponse } from 'next/server'
import { getDb, getWorkspaceById, isWorkspaceMember } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const num = Number(id)
  const workspaceId = (!isNaN(num) && num > 0) ? num : (getDb().prepare('SELECT id FROM workspaces WHERE public_id = ?').get(id) as { id: number } | undefined)?.id || 0
  const ws = getWorkspaceById(workspaceId)
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Verify caller is a member of this workspace
  if (!isWorkspaceMember(user.id, workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const d = getDb()

  // Get members from user_workspace_members joined with users
  const members = d.prepare(`
    SELECT u.id, u.name, u.email, u.avatar_url as avatar, uwm.role, uwm.joined_at
    FROM user_workspace_members uwm
    JOIN users u ON u.id = uwm.user_id
    WHERE uwm.workspace_id = ?
    ORDER BY uwm.role, u.name
  `).all(workspaceId)

  // Get all agents (not workspace-scoped)
  const agents = d.prepare(`
    SELECT id, name, role, avatar_url as avatar, avatar_color as color, schedule_id
    FROM agents
    ORDER BY name
  `).all()

  return NextResponse.json({
    workspace: { id: ws.id, name: ws.name, color: ws.color },
    members,
    agents,
  })
}
