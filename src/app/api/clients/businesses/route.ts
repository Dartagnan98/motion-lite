import { NextRequest, NextResponse } from 'next/server'
import { getClientBusinesses, createClientBusiness, updateClientBusiness, deleteClientBusiness, getClientProfile, isWorkspaceMember } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  // Verify user has access to this client's workspace
  const client = getClientProfile(Number(clientId))
  if (client?.workspace_id && !isWorkspaceMember(user.id, client.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const businesses = getClientBusinesses(Number(clientId))
  return NextResponse.json({ businesses })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (!body.client_id || !body.name) return NextResponse.json({ error: 'client_id and name required' }, { status: 400 })
  // Verify user has access to this client's workspace
  const client = getClientProfile(body.client_id)
  if (client?.workspace_id && !isWorkspaceMember(user.id, client.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const business = createClientBusiness(body)
  return NextResponse.json({ business })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { id, ...data } = body
  const business = updateClientBusiness(id, data)
  if (!business) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ business })
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  deleteClientBusiness(Number(id))
  return NextResponse.json({ ok: true })
}
