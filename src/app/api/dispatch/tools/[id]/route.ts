import { NextRequest, NextResponse } from 'next/server'
import { getTool, updateTool, deleteTool, type ToolHandlerType } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

const HANDLER_TYPES: readonly ToolHandlerType[] = ['motion-internal', 'webhook', 'bridge-forward']

async function resolveId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = await resolveId(ctx.params)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const existing = getTool(id)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  if (typeof body.description === 'string') patch.description = body.description
  if (typeof body.endpoint === 'string') patch.endpoint = body.endpoint.trim() || null

  if (typeof body.handler_type === 'string') {
    if (!HANDLER_TYPES.includes(body.handler_type as ToolHandlerType)) {
      return NextResponse.json({ error: 'invalid handler_type' }, { status: 400 })
    }
    // Built-in tools must keep their motion-internal handler — swapping to
    // webhook would silently break the handler switch in invoke.ts.
    if (existing.builtin && body.handler_type !== 'motion-internal') {
      return NextResponse.json({ error: 'cannot change handler_type on built-in tools' }, { status: 400 })
    }
    patch.handler_type = body.handler_type
  }

  if (body.input_schema !== undefined) {
    const raw = typeof body.input_schema === 'string' ? body.input_schema : JSON.stringify(body.input_schema)
    try {
      JSON.parse(raw)
      patch.input_schema = raw
    } catch {
      return NextResponse.json({ error: 'input_schema must be valid JSON' }, { status: 400 })
    }
  }

  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled ? 1 : 0

  updateTool(id, patch)
  return NextResponse.json({ tool: getTool(id) })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = await resolveId(ctx.params)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const existing = getTool(id)
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (existing.builtin) {
    return NextResponse.json({ error: 'built-in tools cannot be deleted; disable instead' }, { status: 400 })
  }
  deleteTool(id)
  return NextResponse.json({ ok: true })
}
