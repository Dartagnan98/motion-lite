import { NextRequest, NextResponse } from 'next/server'
import { setWorkspacePrimary, getWorkspaceById, isWorkspaceMember, getMsgChannelBySlug, createMsgChannel, addChannelMember, getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id } = await params
  const num = Number(id)
  const workspaceId = (!isNaN(num) && num > 0) ? num : (getDb().prepare('SELECT id FROM workspaces WHERE public_id = ?').get(id) as { id: number } | undefined)?.id || 0
  if (!workspaceId) return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })

  // Verify user is a member of this workspace
  if (!isWorkspaceMember(user.id, workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ws = getWorkspaceById(workspaceId)
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Only workspace owner can set primary
  if ((ws as any).owner_id !== user.id) {
    return NextResponse.json({ error: 'Only workspace owner can set primary' }, { status: 403 })
  }

  // Set as primary (clears others)
  setWorkspacePrimary(user.id, workspaceId)

  // Auto-create #general channel if missing
  const slug = `general-${workspaceId}`
  const existingGeneral = getMsgChannelBySlug(slug) || getMsgChannelBySlug('general')
  if (!existingGeneral || (existingGeneral as any).workspace_id !== workspaceId) {
    try {
      const channel = createMsgChannel({
        name: 'general',
        slug,
        type: 'public',
        workspace_id: workspaceId,
        description: 'General discussion',
        created_by: user.id,
      })
      addChannelMember(channel.id, user.id)
    } catch {
      // Channel may already exist or workspace is private -- ignore
    }
  }

  return NextResponse.json({ ok: true, workspace_id: workspaceId })
}
