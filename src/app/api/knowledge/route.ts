import { NextRequest, NextResponse } from 'next/server'
import { getKnowledgeEntries, createKnowledgeEntry, updateKnowledgeEntry, deleteKnowledgeEntry } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const workspaceId = request.nextUrl.searchParams.get('workspace_id')
  const entries = getKnowledgeEntries(workspaceId ? Number(workspaceId) : undefined)
  return NextResponse.json(entries)
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { type, title, content, url, workspace_id, private: isPrivate } = body

  if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })

  const entry = createKnowledgeEntry({
    type: type || 'text',
    title,
    content,
    url,
    workspace_id,
    private: !!isPrivate,
  })
  return NextResponse.json(entry)
}

export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, ...data } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (data.private !== undefined) {
    data.private = !!data.private
  }

  const entry = updateKnowledgeEntry(id, data)
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entry)
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteKnowledgeEntry(body.id)
  return NextResponse.json({ success: true })
}
