// /api/crm/contacts — list + create (CRM Contacts revival).
// Thin wrapper over the existing db.ts contact backend; workspace-scoped.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getContacts, createContact, getUserWorkspaces, getDb } from '@/lib/db'

function primaryWorkspaceId(userId: number): number | null {
  return getUserWorkspaces(userId).map((w) => w.id)[0] ?? null
}

// Resolve a client_id param (numeric id | slug | public_id) to a client_profiles.id.
// Mirrors the resolveId pattern in /api/businesses, extended for the slug column.
function resolveClientProfileId(param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb()
    .prepare('SELECT id FROM client_profiles WHERE public_id = ? OR slug = ?')
    .get(param, param) as { id: number } | undefined
  return row?.id ?? null
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ contacts: [] })

  const sp = req.nextUrl.searchParams
  const search = sp.get('q')?.trim() || null
  const tag = sp.get('tag')?.trim() || null
  const clientProfileId = resolveClientProfileId(sp.get('client_id'))
  const limit = Math.min(parseInt(sp.get('limit') || '100', 10) || 100, 500)
  const offset = parseInt(sp.get('offset') || '0', 10) || 0

  const contacts = getContacts({ workspaceId, search, tag, clientProfileId, limit, offset })
  return NextResponse.json({ contacts })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = primaryWorkspaceId(user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let body: { name?: unknown; email?: unknown; phone?: unknown; company?: unknown; tags?: unknown; notes?: unknown; client_profile_id?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const clientProfileId = typeof body.client_profile_id === 'number' && body.client_profile_id > 0
    ? body.client_profile_id
    : null

  const contact = createContact({
    workspace_id: workspaceId,
    name,
    email: typeof body.email === 'string' ? body.email.trim() || null : null,
    phone: typeof body.phone === 'string' ? body.phone.trim() || null : null,
    company: typeof body.company === 'string' ? body.company.trim() || null : null,
    tags: typeof body.tags === 'string' ? body.tags : null,
    notes: typeof body.notes === 'string' ? body.notes : null,
    client_profile_id: clientProfileId,
  })
  return NextResponse.json({ contact })
}
