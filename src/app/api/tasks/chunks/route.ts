import { NextRequest, NextResponse } from 'next/server'
import { getDb, getTask } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const taskId = request.nextUrl.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const task = getTask(Number(taskId))
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const d = getDb()
  const chunks = d.prepare(
    'SELECT id, task_id, chunk_start, chunk_end, completed FROM task_chunks WHERE task_id = ? ORDER BY chunk_start'
  ).all(Number(taskId))

  return NextResponse.json({
    taskId: task.id,
    title: task.title,
    scheduled_start: task.scheduled_start,
    scheduled_end: task.scheduled_end,
    auto_schedule: task.auto_schedule,
    schedule_id: task.schedule_id,
    chunks,
  })
}
