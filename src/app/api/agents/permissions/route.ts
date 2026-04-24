import { NextRequest, NextResponse } from 'next/server'
import { getAgentPermissions, setAgentPermissions, ALL_PERMISSIONS } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const agentId = req.nextUrl.searchParams.get('agentId')
  if (!agentId) {
    return NextResponse.json({ error: 'agentId required' }, { status: 400 })
  }
  const permissions = getAgentPermissions(agentId)
  return NextResponse.json({ permissions, allPermissions: [...ALL_PERMISSIONS] })
}

export async function PUT(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await req.json()
  if (!body.agentId || !Array.isArray(body.permissions)) {
    return NextResponse.json({ error: 'agentId and permissions[] required' }, { status: 400 })
  }
  setAgentPermissions(body.agentId, body.permissions)
  const permissions = getAgentPermissions(body.agentId)
  return NextResponse.json({ permissions })
}
