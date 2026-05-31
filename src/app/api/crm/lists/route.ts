// /api/crm/lists — list + create (static or smart).
// Smart lists carry filter_rules JSON; the existing engine resolves members.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getCrmLists, createCrmList, getUserWorkspaces, type CrmListFilter, type CrmListFilterRules } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ lists: [] })
  return NextResponse.json({ lists: getCrmLists(workspaceId) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let body: { name?: unknown; description?: unknown; kind?: unknown; is_smart?: unknown; filter_rules?: unknown; filter?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const kind = body.kind === 'smart' || body.is_smart === true ? 'smart' : 'static'
  const list = createCrmList(workspaceId, {
    name,
    description: typeof body.description === 'string' ? body.description : null,
    kind,
    is_smart: kind === 'smart',
    filter_rules: (body.filter_rules ?? null) as CrmListFilterRules | null,
    filter: (body.filter ?? null) as CrmListFilter | null,
  })
  return NextResponse.json({ list })
}
