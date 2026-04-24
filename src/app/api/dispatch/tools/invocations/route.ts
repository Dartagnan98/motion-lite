import { NextRequest, NextResponse } from 'next/server'
import { listToolInvocations } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * GET /api/dispatch/tools/invocations?tool_id=&limit=
 *
 * Recent tool invocations. Used by the ToolsPanel detail pane to show a
 * scrolling log per tool. Omit tool_id to list all tools interleaved.
 */
export async function GET(request: NextRequest) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const toolIdRaw = searchParams.get('tool_id')
  const toolId = toolIdRaw && Number.isFinite(Number(toolIdRaw)) ? Number(toolIdRaw) : undefined
  const limitRaw = searchParams.get('limit')
  const limit = limitRaw && Number.isFinite(Number(limitRaw)) ? Math.min(Number(limitRaw), 200) : 50
  const invocations = listToolInvocations(toolId, limit)
  return NextResponse.json({ invocations })
}
