// /api/crm/pipelines — list (each with nested stages) + create.
// Seeds a sensible default pipeline + stages on first GET if none exist.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmPipelines, getCrmPipelineStages, getDefaultCrmPipeline,
  createCrmPipeline, createCrmPipelineStage, getUserWorkspaces,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

const DEFAULT_STAGES: Array<{ name: string; color: string }> = [
  { name: 'New Lead', color: '#9aa7b2' },
  { name: 'Contacted', color: '#6ba3d6' },
  { name: 'Qualified', color: '#7a9e87' },
  { name: 'Proposal', color: '#c9a45b' },
  { name: 'Won', color: '#4f9d69' },
  { name: 'Lost', color: '#b46b6b' },
]

function withStages(workspaceId: number) {
  return getCrmPipelines(workspaceId).map((p) => ({
    ...p,
    stages: getCrmPipelineStages(workspaceId, p.id),
  }))
}

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ pipelines: [] })

  let pipelines = getCrmPipelines(workspaceId)
  // Seed a default pipeline + stages on first access.
  if (pipelines.length === 0) {
    const def = getDefaultCrmPipeline(workspaceId) // creates the row if missing
    if (getCrmPipelineStages(workspaceId, def.id).length === 0) {
      for (const s of DEFAULT_STAGES) createCrmPipelineStage(workspaceId, s.name, s.color, def.id)
    }
    pipelines = getCrmPipelines(workspaceId)
  }
  return NextResponse.json({ pipelines: withStages(workspaceId) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let body: { name?: unknown; stages?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const pipeline = createCrmPipeline(workspaceId, { name })
  // Optional explicit stages, else seed the default set so the board is usable.
  const requested = Array.isArray(body.stages)
    ? body.stages.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => ({ name: s.trim(), color: '#7a9e87' }))
    : DEFAULT_STAGES
  for (const s of requested) createCrmPipelineStage(workspaceId, s.name, s.color, pipeline.id)

  const stages = getCrmPipelineStages(workspaceId, pipeline.id)
  return NextResponse.json({ pipeline: { ...pipeline, stages } })
}
