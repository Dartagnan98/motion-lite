import { NextRequest, NextResponse } from 'next/server'
import { getTask, updateTask } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// "Start Task" -- starts a timer on the task (tracks completion time)
// Does NOT reschedule or set ASAP. Just toggles in_progress + records started_at.
export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { taskId } = await req.json()
  if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })

  const task = getTask(taskId)
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const now = new Date().toISOString()

  if (task.status === 'in_progress') {
    // Stop the timer
    const startedAt = (task as any).started_at ? new Date((task as any).started_at) : null
    const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60000) : 0
    updateTask(taskId, {
      status: 'todo',
      started_at: null,
    } as any)
    return NextResponse.json({
      ok: true,
      action: 'stopped',
      elapsed_minutes: elapsed,
      task: getTask(taskId),
      message: `Stopped timer on "${task.title}" (${elapsed}m tracked)`,
    })
  } else {
    // Start the timer
    updateTask(taskId, {
      status: 'in_progress',
      started_at: now,
    } as any)
    return NextResponse.json({
      ok: true,
      action: 'started',
      task: getTask(taskId),
      message: `Timer started on "${task.title}"`,
    })
  }
}
