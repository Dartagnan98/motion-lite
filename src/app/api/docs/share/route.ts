import { NextRequest, NextResponse } from 'next/server'
import { getDocShares, addDocShare, removeDocShare, updateDoc, getDoc } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const docId = Number(request.nextUrl.searchParams.get('docId'))
    if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 })
    return NextResponse.json(getDocShares(docId))
  } catch (err) {
    console.error('Share GET error:', err)
    return NextResponse.json({ error: 'Failed to load shares' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { docId, email, role } = await request.json()
    if (!docId || !email) return NextResponse.json({ error: 'docId and email required' }, { status: 400 })
    const share = addDocShare(docId, email, role || 'viewer')
    // Update doc share_mode to 'shared' if it was private
    const doc = getDoc(docId)
    if (doc && doc.share_mode === 'private') {
      updateDoc(docId, { share_mode: 'shared' })
    }
    return NextResponse.json(share)
  } catch (err) {
    console.error('Share POST error:', err)
    return NextResponse.json({ error: 'Failed to add share' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const docId = Number(request.nextUrl.searchParams.get('docId'))
    const email = request.nextUrl.searchParams.get('email')
    if (!docId || !email) return NextResponse.json({ error: 'docId and email required' }, { status: 400 })
    removeDocShare(docId, email)
    // Check if any shares remain
    const remaining = getDocShares(docId)
    if (remaining.length === 0) {
      updateDoc(docId, { share_mode: 'private' })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Share DELETE error:', err)
    return NextResponse.json({ error: 'Failed to remove share' }, { status: 500 })
  }
}
