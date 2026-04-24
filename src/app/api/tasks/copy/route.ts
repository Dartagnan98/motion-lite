import { NextRequest, NextResponse } from 'next/server'
import { getTask, createTask } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const original = getTask(id)
  if (!original) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const copy = createTask({
    title: `${original.title} (copy)`,
    workspaceId: original.workspace_id ?? undefined,
    projectId: original.project_id ?? undefined,
    stageId: original.stage_id ?? undefined,
    folderId: original.folder_id ?? undefined,
    assignee: original.assignee ?? undefined,
    priority: original.priority,
    status: 'todo',
    due_date: original.due_date ?? undefined,
    description: original.description ?? undefined,
    duration_minutes: original.duration_minutes,
  })

  return NextResponse.json({ task: copy })
}
