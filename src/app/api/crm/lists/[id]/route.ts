// /api/crm/lists/[id] — detail (list + members) / update / delete.
// getCrmListById resolves id|public_id; members resolve via the engine
// (smart lists evaluate filter_rules at read time).

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmListById, getCrmListContacts, updateCrmList, deleteCrmList,
  getUserWorkspaces,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

async function authList(param: string) {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return { error: NextResponse.json({ error: 'No workspace' }, { status: 400 }) }
  const list = getCrmListById(param, workspaceId)
  if (!list) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { user, workspaceId, list }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authList(id)
  if (r.error) return r.error
  const contacts = getCrmListContacts(r.list.id, r.workspaceId)
  return NextResponse.json({ list: r.list, contacts })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authList(id)
  if (r.error) return r.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const data: Record<string, unknown> = {}
  if ('name' in body) data.name = body.name
  if ('description' in body) data.description = body.description
  if ('kind' in body) data.kind = body.kind
  if ('is_smart' in body) data.is_smart = body.is_smart
  if ('filter_rules' in body) data.filter_rules = body.filter_rules
  if ('filter' in body) data.filter = body.filter
  const list = updateCrmList(r.list.id, r.workspaceId, data)
  return NextResponse.json({ list })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authList(id)
  if (r.error) return r.error
  const ok = deleteCrmList(r.list.id, r.workspaceId)
  return NextResponse.json({ ok })
}
