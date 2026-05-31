// /api/crm/companies — list (+ ?q= search, ?show_promoted=1 toggle) + create.
// Thin wrapper over the existing db.ts company backend; workspace-scoped.
// Mirrors /api/crm/contacts: getCurrentUser, primary-workspace scope.
// Default list HIDES promoted companies (already graduated to client_profiles).

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getCrmCompanies, createCrmCompany, getUserWorkspaces } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ companies: [] })

  const search = req.nextUrl.searchParams.get('q')?.trim() || undefined
  const showPromoted = req.nextUrl.searchParams.get('show_promoted') === '1'
  const companies = getCrmCompanies(workspaceId, search, showPromoted)
  return NextResponse.json({ companies })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }
  const company = createCrmCompany(workspaceId, {
    name,
    website: str(body.website),
    phone: str(body.phone),
    industry: str(body.industry),
    company_size: str(body.company_size),
    notes: str(body.notes),
    ownerId: user.id,
    // Brand/marketing fields (all optional).
    avatar_color: str(body.avatar_color),
    avatar_url: str(body.avatar_url),
    monthly_budget: num(body.monthly_budget),
    status: str(body.status),
    brand_voice: str(body.brand_voice),
    goals: str(body.goals),
    target_audience: str(body.target_audience),
    services: str(body.services),
    offer: str(body.offer),
    offer_details: str(body.offer_details),
    instagram_handle: str(body.instagram_handle),
    tiktok_handle: str(body.tiktok_handle),
    facebook_page: str(body.facebook_page),
    location: str(body.location),
    context: str(body.context),
    folder_id: num(body.folder_id),
    ad_account_id: str(body.ad_account_id),
    page_id: str(body.page_id),
  })
  return NextResponse.json({ company })
}
