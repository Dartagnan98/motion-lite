// /api/crm/conversations — array-shaped feed for InboxBell.
//
// InboxBell calls `crmFetch<CrmConversationThread[]>('/api/crm/conversations')`,
// which unwraps { data, error }. We return the same merged-thread set as
// /api/crm/inbox, but the wire shape is `{ data: CrmConversationThread[] }` to
// satisfy crmFetch.

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getConversationThreads, getUserWorkspaces } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ data: [], error: null })

  const threads = getConversationThreads(workspaceId)
  return NextResponse.json({ data: threads, error: null })
}
