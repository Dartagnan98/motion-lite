import { NextRequest, NextResponse } from 'next/server'
import { cascadeFolderColor, getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

function resolveId(table: string, param: string | number | null | undefined): number | null {
  if (param == null) return null
  const str = String(param)
  const num = Number(str)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(str) as { id: number } | undefined
  return row?.id || null
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const id = resolveId('folders', body.id)
  const { color } = body
  if (!id || !color) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  cascadeFolderColor(id, color)
  return NextResponse.json({ ok: true })
}
