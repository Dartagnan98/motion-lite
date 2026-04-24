import { NextRequest, NextResponse } from 'next/server'
import { applyTemplateToProject } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  if (!body.templateId || !body.projectId) {
    return NextResponse.json({ error: 'Missing templateId or projectId' }, { status: 400 })
  }
  const ok = applyTemplateToProject(body.projectId, body.templateId)
  if (!ok) return NextResponse.json({ error: 'Template or project not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
