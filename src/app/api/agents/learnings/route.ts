import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const agentId = req.nextUrl.searchParams.get('agent_id')
  if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 })

  const db = getDb()
  const learnings = db.prepare(`
    SELECT id, agent_id, skill_id, type, content, promoted, created_at
    FROM agent_learnings
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT 200
  `).all(agentId)

  return NextResponse.json({ learnings })
}

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const body = await req.json()
    if (!body.agent_id || !body.type || !body.content) {
      return NextResponse.json({ error: 'agent_id, type, and content required' }, { status: 400 })
    }

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO agent_learnings (agent_id, skill_id, type, content)
      VALUES (?, ?, ?, ?)
    `).run(body.agent_id, body.skill_id || null, body.type, body.content)

    return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = getDb()
  db.prepare('DELETE FROM agent_learnings WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
