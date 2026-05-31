// /api/crm/inbox — list inbox threads across all channels (email, sms, chat, whatsapp, instagram).
//
// Thin wrapper over getConversationThreads(workspaceId). The "thread id" in this
// API is the underlying crm_contacts.id — db.ts merges every channel into one
// thread per contact and surfaces the channels-list + unread totals across all
// of them. There is no separate threads table.
//
// Query params:
//   ?contact_id=N → filter to a single contact (useful for a "drill in" view)
//   ?status=unread → only threads with unread_count > 0
//   ?limit=N      → cap result count (default 100, max 500)

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getConversationThreads, getUserWorkspaces } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ threads: [] })

  const sp = req.nextUrl.searchParams
  const contactIdParam = sp.get('contact_id')
  const contactId = contactIdParam ? Number(contactIdParam) : null
  const status = sp.get('status')
  const limit = Math.min(parseInt(sp.get('limit') || '100', 10) || 100, 500)

  let threads = getConversationThreads(workspaceId)

  if (contactId && contactId > 0) {
    threads = threads.filter((t) => t.contact_id === contactId)
  }
  if (status === 'unread') {
    threads = threads.filter((t) => t.unread_count > 0)
  }
  if (threads.length > limit) threads = threads.slice(0, limit)

  return NextResponse.json({ threads })
}
