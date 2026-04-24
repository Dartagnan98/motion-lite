import { NextRequest, NextResponse } from 'next/server'
import { getTask, updateTask, deleteTask } from '@/lib/db'
import { detachFromSeries, editAllOccurrences, deleteAllOccurrences } from '@/lib/recurrence'
import { requireAuth } from '@/lib/auth'

// POST /api/tasks/recurrence
// Actions: detach (edit this occurrence), edit_all, delete_one, delete_all
export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { action, taskId, changes } = body as {
    action: 'detach' | 'edit_all' | 'delete_one' | 'delete_all'
    taskId: number
    changes?: Record<string, unknown>
  }

  if (!taskId || !action) {
    return NextResponse.json({ error: 'Missing taskId or action' }, { status: 400 })
  }

  const task = getTask(taskId)
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  switch (action) {
    case 'detach': {
      // Detach from series, then apply changes to this task only
      detachFromSeries(taskId)
      if (changes && Object.keys(changes).length > 0) {
        updateTask(taskId, changes)
      }
      const updated = getTask(taskId)
      return NextResponse.json({ ok: true, task: updated })
    }

    case 'edit_all': {
      // Apply changes to the master task
      if (!changes || Object.keys(changes).length === 0) {
        return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
      }
      const master = editAllOccurrences(taskId, changes)
      return NextResponse.json({ ok: true, task: master })
    }

    case 'delete_one': {
      // Delete just this occurrence
      deleteTask(taskId)
      return NextResponse.json({ ok: true })
    }

    case 'delete_all': {
      // Delete the entire series
      deleteAllOccurrences(taskId)
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
