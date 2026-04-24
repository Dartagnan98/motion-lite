import { NextRequest, NextResponse } from 'next/server'
import { getLabels, createLabel, deleteLabel } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return NextResponse.json(getLabels())
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { name, color } = await request.json()
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  try {
    const label = createLabel(name.trim(), color || '#7a6b55')
    return NextResponse.json(label)
  } catch {
    return NextResponse.json({ error: 'Label already exists' }, { status: 409 })
  }
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteLabel(id)
  return NextResponse.json({ success: true })
}
