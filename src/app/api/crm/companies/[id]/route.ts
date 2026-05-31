// /api/crm/companies/[id] — detail / update / delete a single company.
// Detail bundles the company + its contacts + its opportunities + a merged
// activity feed (one entry per opportunity-activity row). id|public_id.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmCompanyById, updateCrmCompany, deleteCrmCompany,
  getCrmContactsForCompany, getCrmOpportunitiesForCompany, getCrmOpportunityActivity,
  getUserWorkspaces, getDb, createFolder, getFolderContents,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

// crm_companies getters take a numeric id; resolve public_id → id first.
function resolveCompanyId(param: string): number | null {
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare('SELECT id FROM crm_companies WHERE public_id = ?').get(param) as { id: number } | undefined
  return row?.id ?? null
}

async function authCompany(param: string) {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return { error: NextResponse.json({ error: 'No workspace' }, { status: 400 }) }
  const id = resolveCompanyId(param)
  if (!id) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const company = getCrmCompanyById(id, workspaceId)
  if (!company) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { user, workspaceId, company }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authCompany(id)
  if (r.error) return r.error
  const { workspaceId, company } = r
  // Bootstrap a folder for the company on first access if missing — the Assets
  // tab is gated on folder_id. Mirrors /api/clients GET behavior so companies
  // can host Projects/Docs/Tasks/Databases pre-promote.
  if (!company.folder_id && company.workspace_id) {
    const folder = createFolder(company.workspace_id, company.name, company.avatar_color || undefined)
    // updateCrmCompany takes (id, workspaceId, data) — the workspace is the
    // tenant scope, the data is the patch. Without the workspace_id arg the
    // patch silently no-ops and each GET re-creates a fresh folder.
    updateCrmCompany(company.id, workspaceId, { folder_id: folder.id })
    company.folder_id = folder.id
  }
  const contents = req.nextUrl.searchParams.get('contents') === '1' && company.folder_id
    ? getFolderContents(company.folder_id)
    : undefined
  const contacts = getCrmContactsForCompany(company.id, workspaceId)
  const opportunities = getCrmOpportunitiesForCompany(company.id, workspaceId)
  // Merge each opportunity's activity into one company-level feed, newest first.
  const activity = opportunities
    .flatMap((o) => getCrmOpportunityActivity(o.id, workspaceId, 50))
    .sort((a, b) => b.created_at - a.created_at)
  return NextResponse.json({ company, contacts, opportunities, activity, contents })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authCompany(id)
  if (r.error) return r.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  // Brand/marketing fields mirror client_profiles so promote-bridge handoff is seamless.
  // Allow-list enforced again in db.updateCrmCompany via ALLOWED_CRM_COMPANY_COLUMNS.
  const allowed = [
    'name', 'website', 'phone', 'industry', 'company_size', 'notes', 'owner_id',
    'avatar_color', 'avatar_url', 'monthly_budget', 'status', 'brand_voice', 'goals',
    'target_audience', 'services', 'offer', 'offer_details',
    'instagram_handle', 'tiktok_handle', 'facebook_page', 'location', 'context',
    'folder_id', 'ad_account_id', 'page_id',
  ] as const
  const data: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) data[k] = body[k]
  const company = updateCrmCompany(r.company.id, r.workspaceId, data)
  return NextResponse.json({ company })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await authCompany(id)
  if (r.error) return r.error
  const ok = deleteCrmCompany(r.company.id, r.workspaceId)
  return NextResponse.json({ ok })
}
