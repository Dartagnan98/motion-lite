// /api/crm/opportunities — list (?pipeline_id= / ?company_id= filters) + create.
// Thin wrapper over the existing opportunity backend; workspace-scoped.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmOpportunities, getCrmOpportunitiesForCompany, createCrmOpportunity,
  getCrmPipelineStages, getUserWorkspaces,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ opportunities: [] })

  const sp = req.nextUrl.searchParams
  const companyId = Number(sp.get('company_id'))
  const pipelineId = Number(sp.get('pipeline_id'))
  const status = sp.get('status')?.trim() || undefined
  const search = sp.get('q')?.trim() || null

  // company filter routes through the dedicated getter (joins on company_id).
  if (!isNaN(companyId) && companyId > 0) {
    return NextResponse.json({ opportunities: getCrmOpportunitiesForCompany(companyId, workspaceId) })
  }

  // Pipeline scope: opportunities carry a stage NAME (TEXT), so resolve the
  // pipeline's stages to their names and filter on those.
  let stages: string[] | undefined
  if (!isNaN(pipelineId) && pipelineId > 0) {
    stages = getCrmPipelineStages(workspaceId, pipelineId).map((s) => s.name)
    if (stages.length === 0) return NextResponse.json({ opportunities: [] })
  }

  const opportunities = getCrmOpportunities({
    workspaceId,
    status: (status as 'open' | 'won' | 'lost' | 'abandoned' | 'all') ?? undefined,
    stages,
    search,
  })
  return NextResponse.json({ opportunities })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let body: {
    contact_id?: unknown; name?: unknown; value?: unknown; stage?: unknown
    close_date?: unknown; probability?: unknown; notes?: unknown
    status?: unknown; source?: unknown; company_id?: unknown
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const contactId = Number(body.contact_id)
  if (isNaN(contactId) || contactId <= 0) return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const opportunity = createCrmOpportunity(workspaceId, {
    contact_id: contactId,
    name,
    value: typeof body.value === 'number' ? body.value : null,
    stage: typeof body.stage === 'string' ? body.stage : null,
    close_date: typeof body.close_date === 'string' ? body.close_date : null,
    probability: typeof body.probability === 'number' ? body.probability : null,
    notes: typeof body.notes === 'string' ? body.notes : null,
    status: typeof body.status === 'string' ? (body.status as 'open' | 'won' | 'lost' | 'abandoned') : undefined,
    source: typeof body.source === 'string' ? body.source : null,
    owner_id: user.id,
    created_by_user_id: user.id,
  })
  if (!opportunity) return NextResponse.json({ error: 'contact not found' }, { status: 400 })

  // company_id is set by the create path via the contact; allow an explicit
  // company link by patching it on after creation if provided.
  if (typeof body.company_id === 'number' && body.company_id > 0) {
    const { getDb } = await import('@/lib/db')
    getDb().prepare('UPDATE crm_opportunities SET company_id = ? WHERE id = ? AND workspace_id = ?')
      .run(body.company_id, opportunity.id, workspaceId)
  }
  return NextResponse.json({ opportunity })
}
