// /api/crm/activities — read + log timeline entries on a contact or opportunity.
//   GET ?contact_id=    → getCrmContactActivities
//   GET ?opportunity_id= → getCrmOpportunityActivity
//   POST {type, body, contact_id? | opportunity_id?}
//     contact → createCrmContactActivity (crm_activities)
//     opportunity → recordCrmOpportunityActivity (crm_opportunity_activity)

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmContactActivities, getCrmOpportunityActivity,
  createCrmContactActivity, recordCrmOpportunityActivity,
  getCrmOpportunityById, getUserWorkspaces,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

const CONTACT_TYPES = new Set(['note', 'email', 'call', 'sms', 'task'])

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ activities: [] })

  const sp = req.nextUrl.searchParams
  const contactId = Number(sp.get('contact_id'))
  const opportunityId = Number(sp.get('opportunity_id'))

  if (!isNaN(opportunityId) && opportunityId > 0) {
    const opp = getCrmOpportunityById(opportunityId, workspaceId)
    if (!opp) return NextResponse.json({ activities: [] })
    return NextResponse.json({ activities: getCrmOpportunityActivity(opp.id, workspaceId) })
  }
  if (!isNaN(contactId) && contactId > 0) {
    return NextResponse.json({ activities: getCrmContactActivities(contactId, workspaceId) })
  }
  return NextResponse.json({ error: 'contact_id or opportunity_id required' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let body: { type?: unknown; body?: unknown; contact_id?: unknown; opportunity_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'body is required' }, { status: 400 })

  const opportunityId = Number(body.opportunity_id)
  if (!isNaN(opportunityId) && opportunityId > 0) {
    const opp = getCrmOpportunityById(opportunityId, workspaceId)
    if (!opp) return NextResponse.json({ error: 'opportunity not found' }, { status: 404 })
    const kind = typeof body.type === 'string' && body.type ? body.type : 'note'
    const activityId = recordCrmOpportunityActivity({
      opportunity_id: opp.id,
      workspace_id: workspaceId,
      kind,
      body: text,
      created_by_user_id: user.id,
    })
    if (!activityId) return NextResponse.json({ error: 'Failed' }, { status: 500 })
    return NextResponse.json({ activity: getCrmOpportunityActivity(opp.id, workspaceId, 1)[0] ?? null })
  }

  const contactId = Number(body.contact_id)
  if (!isNaN(contactId) && contactId > 0) {
    const type = typeof body.type === 'string' && CONTACT_TYPES.has(body.type) ? body.type : 'note'
    const activity = createCrmContactActivity({
      contactId,
      workspaceId,
      type: type as 'note' | 'email' | 'call' | 'sms' | 'task',
      body: text,
      createdBy: user.id,
    })
    if (!activity) return NextResponse.json({ error: 'contact not found' }, { status: 404 })
    return NextResponse.json({ activity })
  }

  return NextResponse.json({ error: 'contact_id or opportunity_id required' }, { status: 400 })
}
