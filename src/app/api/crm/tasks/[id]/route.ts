import { NextRequest, NextResponse } from 'next/server'
import { updateTask, getTask } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

// Stub for the lite fork: /today calls PATCH /api/crm/tasks/{id} when the
// "complete" checkbox is clicked. Mirrors the relevant subset of /api/tasks PATCH
// (status update only; no scheduling/dependency recompute). Response is wrapped
// in `{ data, error }` because the page calls it via `crmFetch`.

const ALLOWED_FIELDS = new Set(['status', 'priority', 'due_date', 'assignee', 'title'])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idStr } = await params
  const id = Number(idStr)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ data: null, error: 'Invalid id' }, { status: 400 })
  }

  const existing = getTask(id)
  if (!existing) {
    return NextResponse.json({ data: null, error: 'Task not found' }, { status: 404 })
  }

  const body = await request.json()
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(k)) patch[k] = body[k]
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ data: null, error: 'No allowed fields to update' }, { status: 400 })
  }

  updateTask(id, patch)
  const updated = getTask(id)
  return NextResponse.json({ data: updated, error: null })
}
