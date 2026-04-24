import { NextRequest, NextResponse } from 'next/server'
import { listTools, createTool, getToolByName, type ToolHandlerType } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

const HANDLER_TYPES: readonly ToolHandlerType[] = ['motion-internal', 'webhook', 'bridge-forward']

/** GET /api/dispatch/tools -- list registered tools with invocation stats. */
export async function GET() {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tools = listTools()
  return NextResponse.json({ tools })
}

/**
 * POST /api/dispatch/tools
 * Body: { name, description?, handler_type?, endpoint?, input_schema?, enabled? }
 *
 * Only user-authored tools go through here — built-ins are seeded on db boot.
 * Rejects duplicate names (the table has a UNIQUE constraint; we surface it
 * with a cleaner error).
 */
export async function POST(request: NextRequest) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || !/^[a-z0-9_]{2,64}$/.test(name)) {
    return NextResponse.json({ error: 'name must be snake_case, 2-64 chars, [a-z0-9_]' }, { status: 400 })
  }
  if (getToolByName(name)) {
    return NextResponse.json({ error: 'tool with that name already exists' }, { status: 409 })
  }

  const handlerTypeRaw = typeof body.handler_type === 'string' ? body.handler_type : 'motion-internal'
  if (!HANDLER_TYPES.includes(handlerTypeRaw as ToolHandlerType)) {
    return NextResponse.json({ error: 'invalid handler_type' }, { status: 400 })
  }
  const handlerType = handlerTypeRaw as ToolHandlerType

  let inputSchema = '{}'
  if (body.input_schema !== undefined) {
    const raw = typeof body.input_schema === 'string' ? body.input_schema : JSON.stringify(body.input_schema)
    try {
      JSON.parse(raw)
      inputSchema = raw
    } catch {
      return NextResponse.json({ error: 'input_schema must be valid JSON' }, { status: 400 })
    }
  }

  if (handlerType === 'webhook' && (typeof body.endpoint !== 'string' || !body.endpoint.trim())) {
    return NextResponse.json({ error: 'webhook tools require an endpoint url' }, { status: 400 })
  }

  const tool = createTool({
    name,
    description: typeof body.description === 'string' ? body.description : null,
    handlerType,
    endpoint: typeof body.endpoint === 'string' ? body.endpoint : null,
    inputSchema,
    enabled: body.enabled === false ? false : true,
    builtin: false,
  })

  return NextResponse.json({ tool }, { status: 201 })
}
