import { NextRequest, NextResponse } from 'next/server'
import { publishDoc, unpublishDoc, getDoc } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { docId, action } = await request.json()
    if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 })

    if (action === 'unpublish') {
      unpublishDoc(docId)
      return NextResponse.json({ ok: true, published: false })
    }

    // Publish
    const doc = getDoc(docId)
    if (!doc) return NextResponse.json({ error: 'Doc not found' }, { status: 404 })

    // If already published, return existing slug
    if (doc.published && doc.publish_slug) {
      return NextResponse.json({ ok: true, published: true, slug: doc.publish_slug })
    }

    const slug = publishDoc(docId)
    return NextResponse.json({ ok: true, published: true, slug })
  } catch (err) {
    console.error('Publish error:', err)
    return NextResponse.json({ error: 'Publish operation failed' }, { status: 500 })
  }
}
