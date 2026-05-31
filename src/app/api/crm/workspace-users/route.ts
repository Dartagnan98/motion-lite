// /api/crm/workspace-users — list members of the caller's primary workspace.
// Powers the `owner_id` picker on the contact card (Sprint 3 — CRM Contact Depth).

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getUserWorkspaces, getWorkspaceUsers } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ users: [] })
  const users = getWorkspaceUsers(workspaceId)
  return NextResponse.json({ users })
}
