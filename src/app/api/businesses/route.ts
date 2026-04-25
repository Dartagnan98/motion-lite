import { NextRequest, NextResponse } from 'next/server'
import { getBusinesses, getBusinessById, createClientBusiness, updateClientBusiness, deleteClientBusiness, getClientBusinesses, getFolderContents, getUserWorkspaces, isWorkspaceMember, getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  return row?.id || null
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const wsIds = getUserWorkspaces(user.id).map(w => w.id)
  const id = resolveId('client_businesses', req.nextUrl.searchParams.get('id'))
  const clientId = resolveId('client_profiles', req.nextUrl.searchParams.get('client_id'))

  if (id) {
    const biz = getBusinessById(id)
    if (!biz) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (biz.workspace_id && !isWorkspaceMember(user.id, biz.workspace_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const contents = biz.folder_id ? getFolderContents(biz.folder_id) : undefined
    return NextResponse.json({ business: biz, contents })
  }

  if (clientId) {
    const businesses = getClientBusinesses(clientId)
    return NextResponse.json({ businesses })
  }

  return NextResponse.json({ businesses: getBusinesses(wsIds) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (body.workspace_id && !isWorkspaceMember(user.id, body.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const business = createClientBusiness(body)
  return NextResponse.json({ business })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const id = resolveId('client_businesses', body.id ? String(body.id) : null)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const existing = getBusinessById(id)
  if (existing?.workspace_id && !isWorkspaceMember(user.id, existing.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: _rawId, ...data } = body
  try {
    const business = updateClientBusiness(id, data)
    if (!business) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ business })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = resolveId('client_businesses', req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const existing = getBusinessById(id)
  if (existing?.workspace_id && !isWorkspaceMember(user.id, existing.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    deleteClientBusiness(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
