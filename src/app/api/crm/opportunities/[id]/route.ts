// /api/crm/opportunities/[id] — detail / update (stage move, won/lost) / delete.
// getCrmOpportunityById resolves id|public_id internally.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmOpportunityById, updateCrmOpportunity, deleteCrmOpportunity,
  getCrmOpportunityActivity, getUserWorkspaces,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

async function authOpportunity(param: string) {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return { error: NextResponse.json({ error: 'No workspace' }, { status: 400 }) }
  const opportunity = getCrmOpportunityById(param, workspaceId)
  if (!opportunity) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { user, workspaceId, opportunity }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authOpportunity(id)
  if (r.error) return r.error
  const activity = getCrmOpportunityActivity(r.opportunity.id, r.workspaceId)
  return NextResponse.json({ opportunity: r.opportunity, activity })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authOpportunity(id)
  if (r.error) return r.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const allowed = [
    'contact_id', 'name', 'value', 'stage', 'close_date',
    'probability', 'notes', 'status', 'owner_id', 'source', 'lost_reason',
  ] as const
  const data: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) data[k] = body[k]
  const opportunity = updateCrmOpportunity(r.opportunity.id, r.workspaceId, {
    ...data,
    _actor_user_id: r.user.id,
  })
  return NextResponse.json({ opportunity })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authOpportunity(id)
  if (r.error) return r.error
  const ok = deleteCrmOpportunity(r.opportunity.id, r.workspaceId)
  return NextResponse.json({ ok })
}
