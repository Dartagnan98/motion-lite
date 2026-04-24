import { NextRequest, NextResponse } from 'next/server'
import { browseMemories, getMemorySourceStats, getMemorySectorStats, deleteMemory } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const query = req.nextUrl.searchParams.get('q') || undefined
  const sector = req.nextUrl.searchParams.get('sector') || undefined
  const source = req.nextUrl.searchParams.get('source') || undefined
  const clientSlug = req.nextUrl.searchParams.get('client') || undefined
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1')
  const limit = 50
  const offset = (page - 1) * limit

  const { rows, total } = browseMemories({ query, sector, source, clientSlug, offset, limit })
  const sourceStats = getMemorySourceStats()
  const sectorStats = getMemorySectorStats()

  return NextResponse.json({
    rows,
    total,
    page,
    pages: Math.ceil(total / limit),
    sourceStats,
    sectorStats,
  })
}

export async function DELETE(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  deleteMemory(id)
  return NextResponse.json({ ok: true })
}
