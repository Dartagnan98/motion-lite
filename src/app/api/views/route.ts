import { NextRequest, NextResponse } from 'next/server'
import { getViews, createView, updateView, deleteView } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return NextResponse.json(getViews())
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { name, view_type, config } = await request.json()
  const view = createView(name || 'Untitled View', view_type || 'list', config ? JSON.stringify(config) : '{}')
  return NextResponse.json(view)
}

export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (data.config && typeof data.config === 'object') data.config = JSON.stringify(data.config)
  const view = updateView(id, data)
  return NextResponse.json(view)
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteView(id)
  return NextResponse.json({ success: true })
}
