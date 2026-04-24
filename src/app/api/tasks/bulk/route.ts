import { NextRequest, NextResponse } from 'next/server'
import { updateTask, deleteTask, syncDependencies, getTask, getProject, isWorkspaceMember, checkStageCompletion, clearTaskChunks } from '@/lib/db'
import { fireWebhook } from '@/lib/webhook'
import { requireAuth } from '@/lib/auth'
import { triggerRescheduleServer } from '@/lib/schedule-trigger'
import { getTaskMutationRescheduleScope } from '@/lib/task-reschedule'

export async function POST(req: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await req.json()

  // Support both old shape { ids, action, data } and new shape { taskIds, action, value }
  const taskIds: number[] = body.taskIds || body.ids
  const action: string = body.action
  const value: unknown = body.value
  const data: Record<string, unknown> | undefined = body.data

  if (!taskIds?.length || !action) {
    return NextResponse.json({ error: 'taskIds and action required' }, { status: 400 })
  }

  // Verify workspace membership: load first task, check membership, reject cross-workspace
  const firstTask = getTask(taskIds[0])
  if (firstTask) {
    const wsId = firstTask.workspace_id
    if (wsId) {
      if (!isWorkspaceMember(user.id, wsId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Reject if any task is in a different workspace
      for (const tid of taskIds.slice(1)) {
        const t = getTask(tid)
        if (t && t.workspace_id && t.workspace_id !== wsId) {
          return NextResponse.json({ error: 'Cross-workspace bulk operations not allowed' }, { status: 403 })
        }
      }
    }
  }

  let count = 0
  let shouldReschedule = false

  function markBulkSchedulingEffects(taskId: number, before: ReturnType<typeof getTask>, updates: Record<string, unknown>) {
    const changedFields = Object.keys(updates)
    if (changedFields.length === 0) return

    if (Object.prototype.hasOwnProperty.call(updates, 'scheduled_start') || Object.prototype.hasOwnProperty.call(updates, 'scheduled_end')) {
      clearTaskChunks(taskId)
    }

    if (getTaskMutationRescheduleScope(before as any, updates, changedFields).shouldReschedule) {
      shouldReschedule = true
    }
  }

  switch (action) {
    case 'set_priority': {
      for (const id of taskIds) {
        const before = getTask(id)
        const updates = { priority: value as string }
        const result = updateTask(id, updates)
        if (result) count++
        markBulkSchedulingEffects(id, before, updates)
      }
      break
    }

    case 'set_status': {
      const updates: Record<string, unknown> = { status: value as string }
      if (value === 'done') updates.completed_at = Math.floor(Date.now() / 1000)
      if (value !== 'done') updates.completed_at = null
      for (const id of taskIds) {
        const before = getTask(id)
        const result = updateTask(id, updates)
        if (result) {
          count++
          if (value === 'done') fireWebhook('task.completed', result as unknown as Record<string, unknown>)
        }
        markBulkSchedulingEffects(id, before, updates)
      }
      break
    }

    case 'set_assignee': {
      for (const id of taskIds) {
        const before = getTask(id)
        const updates = { assignee: value as string | null }
        const result = updateTask(id, updates)
        if (result) count++
        markBulkSchedulingEffects(id, before, updates)
      }
      break
    }

    case 'set_project': {
      const targetProjectId = value as number | null
      const targetProject = targetProjectId ? getProject(targetProjectId) : null

      if (targetProjectId && !targetProject) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }

      if (targetProject?.workspace_id && !isWorkspaceMember(user.id, targetProject.workspace_id)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      for (const id of taskIds) {
        const before = getTask(id)
        const updates: Record<string, unknown> = { project_id: targetProjectId }
        if (targetProject?.workspace_id) {
          updates.workspace_id = targetProject.workspace_id
        }
        const result = updateTask(id, updates)
        if (result) count++
        markBulkSchedulingEffects(id, before, updates)
      }
      break
    }

    case 'delete': {
      for (const id of taskIds) {
        const before = getTask(id)
        deleteTask(id)
        count++
        if (before?.auto_schedule || before?.scheduled_start || before?.scheduled_end || before?.locked_at) {
          shouldReschedule = true
        }
      }
      break
    }

    case 'sync_dependencies': {
      const taskId = body.taskId as number
      const oldBlockedBy = (body.oldBlockedBy || []) as number[]
      const newBlockedBy = (body.newBlockedBy || []) as number[]
      if (!taskId) {
        return NextResponse.json({ error: 'taskId required for sync_dependencies' }, { status: 400 })
      }
      syncDependencies(taskId, oldBlockedBy, newBlockedBy)
      return NextResponse.json({ ok: true, success: true })
    }

    // Legacy actions
    case 'update': {
      if (!data) {
        return NextResponse.json({ error: 'data required for update' }, { status: 400 })
      }
      for (const id of taskIds) {
        const before = getTask(id)
        const result = updateTask(id, data)
        if (result) count++
        markBulkSchedulingEffects(id, before, data)
      }
      break
    }

    case 'complete': {
      const now = Math.floor(Date.now() / 1000)
      for (const id of taskIds) {
        const before = getTask(id)
        const updates = { status: 'done', completed_at: now }
        const result = updateTask(id, updates)
        if (result) {
          count++
          fireWebhook('task.completed', result as unknown as Record<string, unknown>)
        }
        markBulkSchedulingEffects(id, before, updates)
      }
      break
    }

    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
  }

  if (shouldReschedule) {
    await triggerRescheduleServer().catch(() => {})
  }

  // Check stage auto-progression after bulk completions
  if ((action === 'set_status' && value === 'done') || action === 'complete') {
    const checkedPairs = new Set<string>()
    for (const id of taskIds) {
      const task = getTask(id)
      if (task?.project_id && task?.stage_id) {
        const key = `${task.project_id}:${task.stage_id}`
        if (!checkedPairs.has(key)) {
          checkedPairs.add(key)
          checkStageCompletion(task.project_id, task.stage_id)
        }
      }
    }
  }

  return NextResponse.json({ updated: count, success: true, count })
}
