import { NextRequest, NextResponse } from 'next/server'
import { runAgent } from '@/lib/agent-runtime'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// POST: Run an agent with a message
export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { agent_id, message, task_id } = await req.json()
  if (!agent_id || !message) {
    return NextResponse.json({ error: 'Missing agent_id and message' }, { status: 400 })
  }

  const result = await runAgent(agent_id, message, { taskId: task_id })
  return NextResponse.json(result)
}

// GET: List recent agent runs
export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const agentId = req.nextUrl.searchParams.get('agent_id')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20')

  const db = getDb()
  const where = agentId ? 'WHERE agent_id = ?' : ''
  const params = agentId ? [agentId, limit] : [limit]

  const runs = db.prepare(`
    SELECT r.*, a.name as agent_name FROM agent_runs r
    LEFT JOIN agents a ON r.agent_id = a.id
    ${where}
    ORDER BY r.started_at DESC LIMIT ?
  `).all(...params)

  return NextResponse.json(runs)
}
