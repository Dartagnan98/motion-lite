// /api/crm/companies/[id]/promote — THE BRIDGE.
// Promote a CRM company to a productized client_profile:
//   1. create client_profiles (carry name/website/industry)
//   2. stamp client_profiles.crm_company_id = company.id
//   3. re-link the company's crm_contacts.client_profile_id
//   4. return { client }
// IDEMPOTENT: if a client_profile already points at this company, return it.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCrmCompanyById, getCrmContactsForCompany,
  createClientProfile, updateClientProfile, updateContact,
  getUserWorkspaces, getDb,
  type ClientProfile,
} from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

function resolveCompanyId(param: string): number | null {
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare('SELECT id FROM crm_companies WHERE public_id = ?').get(param) as { id: number } | undefined
  return row?.id ?? null
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client'
  // Ensure unique against existing slugs.
  let slug = base
  let n = 1
  const exists = getDb().prepare('SELECT 1 FROM client_profiles WHERE slug = ?')
  while (exists.get(slug)) { slug = `${base}-${++n}` }
  return slug
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const companyId = resolveCompanyId(id)
  if (!companyId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const company = getCrmCompanyById(companyId, workspaceId)
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Idempotency: already promoted → return the existing client.
  const existing = getDb()
    .prepare('SELECT * FROM client_profiles WHERE crm_company_id = ?')
    .get(company.id) as ClientProfile | undefined
  if (existing) return NextResponse.json({ client: existing, already_promoted: true })

  // 1. create the client carrying name/industry; 2. stamp the full brand/marketing
  //    surface so the client inherits everything the company already knew about itself.
  //    folder_id intentionally NOT copied — clients auto-bootstrap their own folder
  //    on first GET (added earlier this session).
  const client = createClientProfile({
    name: company.name,
    slug: slugify(company.name),
    industry: company.industry || undefined,
    avatar_color: company.avatar_color || undefined,
    context: company.context || undefined,
    workspace_id: workspaceId,
  })
  const patch: Record<string, unknown> = { crm_company_id: company.id }
  if (company.website) patch.website = company.website
  // Brand/marketing carry-over — only stamp when the source had a value, to avoid
  // clobbering defaults set by createClientProfile (e.g. avatar_color fallback).
  const carry = [
    'avatar_color', 'monthly_budget', 'status', 'brand_voice', 'goals', 'target_audience',
    'services', 'offer', 'offer_details', 'instagram_handle', 'tiktok_handle', 'facebook_page',
    'location', 'context', 'ad_account_id', 'page_id',
  ] as const
  for (const k of carry) {
    const v = (company as unknown as Record<string, unknown>)[k]
    if (v !== null && v !== undefined && v !== '') patch[k] = v
  }
  const updated = updateClientProfile(client.id, patch) ?? client

  // 3. re-link the company's contacts to the new client.
  const contacts = getCrmContactsForCompany(company.id, workspaceId)
  for (const c of contacts) {
    updateContact(c.id, { client_profile_id: client.id })
  }

  return NextResponse.json({ client: updated, linked_contacts: contacts.length })
}
