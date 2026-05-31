// /api/crm/leads — lead inbox: recent inbound lead-ad submissions + report.
// Read-only wrapper over the lead-ads backend (webhooks already upsert
// contacts). ?days= window for the report, ?limit= for recent leads.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getRecentCrmNewLeads, getCrmLeadAdsReport, getUserWorkspaces } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ recentLeads: [], report: null })

  const sp = req.nextUrl.searchParams
  const limit = Math.min(parseInt(sp.get('limit') || '20', 10) || 20, 50)
  const days = Math.min(parseInt(sp.get('days') || '30', 10) || 30, 3650)

  return NextResponse.json({
    recentLeads: getRecentCrmNewLeads(workspaceId, limit),
    report: getCrmLeadAdsReport(workspaceId, days),
  })
}
