import { NextRequest, NextResponse } from 'next/server'
import { fetchVideoSource } from '@/lib/meta-api'
import { requireOwner } from '@/lib/auth'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try { await requireOwner() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { videoId } = await params
  if (!videoId) {
    return NextResponse.json({ error: 'Missing videoId' }, { status: 400 })
  }

  const source = await fetchVideoSource(videoId)
  if (!source) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  // If it's an embed URL, return the embed info
  if (source.startsWith('embed:')) {
    return NextResponse.json({ type: 'embed', url: source.slice(6) })
  }

  // Direct video URL - redirect to it
  return NextResponse.json({ type: 'direct', url: source })
}
