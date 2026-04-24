import { NextRequest, NextResponse } from 'next/server'
import { getSchedules, createSchedule, updateSchedule, deleteSchedule } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return NextResponse.json(getSchedules())
}

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { name, blocks, color, is_default } = await req.json()
  const schedule = createSchedule(name, blocks || '[]', color, is_default)
  return NextResponse.json(schedule)
}

export async function PATCH(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id, ...data } = await req.json()
  const schedule = updateSchedule(id, data)
  return NextResponse.json(schedule)
}

export async function DELETE(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await req.json()
  deleteSchedule(id)
  return NextResponse.json({ ok: true })
}
