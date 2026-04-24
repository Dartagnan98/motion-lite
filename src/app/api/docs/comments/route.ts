import { NextRequest, NextResponse } from 'next/server'
import { getDocComments, createDocComment, resolveDocComment, deleteDocComment } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const docId = Number(request.nextUrl.searchParams.get('docId'))
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 })

  const comments = getDocComments(docId)

  // Build threaded structure
  const topLevel = comments.filter(c => !c.parent_comment_id)
  const threaded = topLevel.map(c => ({
    ...c,
    replies: comments.filter(r => r.parent_comment_id === c.id),
  }))

  return NextResponse.json(threaded)
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { docId, blockId, parentCommentId, content, author } = body
  if (!docId || !content) return NextResponse.json({ error: 'docId and content required' }, { status: 400 })

  const comment = createDocComment({ docId, blockId, parentCommentId, author, content })
  return NextResponse.json(comment)
}

export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id, action } = await request.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (action === 'resolve') {
    resolveDocComment(id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  deleteDocComment(id)
  return NextResponse.json({ ok: true })
}
