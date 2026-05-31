import { NextRequest, NextResponse } from 'next/server'
import { getClientProfiles, getClientProfile, createClientProfile, updateClientProfile, deleteClientProfile, getClientBusinesses, getFolderContents, getUserWorkspaces, isWorkspaceMember, getDb, createFolder } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  // Try public_id first (universal), then slug (some tables have it, e.g. client_profiles)
  const byPublic = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  if (byPublic?.id) return byPublic.id
  try {
    const bySlug = getDb().prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(param) as { id: number } | undefined
    return bySlug?.id || null
  } catch {
    // table has no slug column — fall through
    return null
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = resolveId('client_profiles', req.nextUrl.searchParams.get('id'))
  if (id) {
    const profile = getClientProfile(id)
    if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Check user has access to this client's workspace
    if (profile.workspace_id && !isWorkspaceMember(user.id, profile.workspace_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Bootstrap a folder for the client on first access — the Assets tab is
    // gated on folder_id, and historical clients (Glenvalley/Advance/etc.) were
    // created before folders were auto-provisioned, leaving the tab empty.
    if (!profile.folder_id && profile.workspace_id) {
      const folder = createFolder(profile.workspace_id, profile.name, profile.avatar_color || undefined)
      updateClientProfile(profile.id, { folder_id: folder.id })
      profile.folder_id = folder.id
    }
    const contents = req.nextUrl.searchParams.get('contents') === '1' && profile.folder_id
      ? getFolderContents(profile.folder_id)
      : undefined
    const businesses = getClientBusinesses(profile.id)
    return NextResponse.json({ profile, contents, businesses })
  }
  const wsIds = getUserWorkspaces(user.id).map(w => w.id)
  return NextResponse.json({ profiles: getClientProfiles(wsIds) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  // Ensure workspace_id belongs to user
  if (body.workspace_id && !isWorkspaceMember(user.id, body.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  // Default workspace_id to the user's primary workspace when the form doesn't
  // send one — otherwise the new client gets workspace_id=NULL and is invisible
  // in /clients (which filters by the user's workspaces).
  const wsIds = getUserWorkspaces(user.id).map(w => w.id)
  const workspace_id = body.workspace_id ?? wsIds[0] ?? null
  const profile = createClientProfile({ ...body, slug, workspace_id })
  // createClientProfile only inserts a fixed column set — persist website (and
  // other known fields the form may send) so the domain is kept on the client.
  if (profile && typeof body.website === 'string' && body.website.trim()) {
    updateClientProfile(profile.id, { website: body.website.trim() })
    profile.website = body.website.trim()
  }
  return NextResponse.json({ profile })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const id = resolveId('client_profiles', body.id ? String(body.id) : null)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // Check user has access to this client
  const existing = getClientProfile(id)
  if (existing?.workspace_id && !isWorkspaceMember(user.id, existing.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: _rawId, ...data } = body
  try {
    const profile = updateClientProfile(id, data)
    if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ profile })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = resolveId('client_profiles', req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // Check user has access
  const existing = getClientProfile(id)
  if (existing?.workspace_id && !isWorkspaceMember(user.id, existing.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    deleteClientProfile(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
