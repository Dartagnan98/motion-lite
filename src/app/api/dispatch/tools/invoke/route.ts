import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { invokeToolByName } from '@/lib/tools/invoke'

export const runtime = 'nodejs'

/**
 * POST /api/dispatch/tools/invoke
 * Body: { name, args?, dispatch_id? }
 *
 * Single entry point for calling a tool by name. Session auth required --
 * the bridge forwards this from Claude Code sub-agents with the user's cookie
 * jar set, or via a separate secret (future). For now user-authenticated.
 *
 * Returns { ok, tool, result?, error?, invocation_id, duration_ms }. Never
 * throws to the caller; errors go in the envelope.
 */
export async function POST(request: NextRequest) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const args = (body.args && typeof body.args === 'object') ? body.args as Record<string, unknown> : {}
  const dispatchId = Number.isFinite(Number(body.dispatch_id)) ? Number(body.dispatch_id) : null
  const result = await invokeToolByName(name, args, { caller: 'user', dispatchId })
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
