import { NextRequest, NextResponse } from 'next/server'
import {
  getTask,
  getSubtasks,
  enqueueDispatch,
  addDispatchDependency,
  createTaskActivity,
  getDb,
} from '@/lib/db'
import type { Task } from '@/lib/types'
import { requireAuth } from '@/lib/auth'
import { notifyBridge } from '@/lib/dispatch/notify-bridge'

export const runtime = 'nodejs'

// Keep in sync with TaskDetailPanel / RichTaskDispatchButton inference. Any
// subtask whose assignee isn't mapped falls back to the orchestrator team so
// at least something takes the work.
const ASSIGNEE_TO_AGENT: Record<string, string> = {
  claude: 'claude',
  orchestrator: 'orchestrator',
  team: 'orchestrator',
  jimmy: 'jimmy',
  gary: 'gary',
  ricky: 'ricky',
  sofia: 'sofia',
}

function inferAgent(assignee: string | null | undefined): string {
  if (!assignee) return 'orchestrator'
  return ASSIGNEE_TO_AGENT[assignee.trim().toLowerCase()] || 'orchestrator'
}

function parseBlockedBy(val: string | null | undefined): number[] {
  if (!val) return []
  return String(val).split(',').map(s => parseInt(s.trim())).filter(n => Number.isFinite(n) && n > 0)
}

function buildSubtaskPrompt(parent: Task, subtask: Task): string {
  const parts: string[] = []
  parts.push(`Pipeline parent: ${parent.title}`)
  if (parent.description) {
    parts.push('')
    parts.push('Parent context:')
    parts.push(parent.description.trim())
  }
  parts.push('')
  parts.push(`Your step: ${subtask.title}`)
  if (subtask.description) {
    parts.push('')
    parts.push(subtask.description.trim())
  }
  return parts.join('\n')
}

/**
 * POST /api/dispatch/pipeline
 * Body: { taskId: number, priority?: number }
 *
 * Takes a parent task, reads its subtasks, and enqueues one dispatch per
 * subtask. Sibling `blocked_by` relationships become dispatch_dependencies
 * so downstream dispatches only start after their upstream finishes.
 *
 * Skips subtasks whose status is done/cancelled/archived.
 */
export async function POST(request: NextRequest) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { taskId?: number; priority?: number }
  const taskId = Number(body.taskId)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
  }

  const parent = getTask(taskId)
  if (!parent) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const subtasks = getSubtasks(parent.id)
  if (subtasks.length === 0) {
    return NextResponse.json({
      error: 'Task has no subtasks. Add subtasks with assignees first, then run the pipeline.',
    }, { status: 400 })
  }

  const priority = Number.isFinite(body.priority) ? Number(body.priority) : 5
  // 'blocked' means the user has explicitly halted the task -- don't pull it
  // into a pipeline. done/cancelled/archived are already finished.
  const RUNNABLE_STATUSES = new Set(['backlog', 'todo', 'in_progress', 'review'])

  // Subtasks that already have a non-terminal dispatch in flight should NOT
  // get a duplicate queued on top. Otherwise clicking "Run pipeline" twice
  // stacks work on the same step.
  const activeDispatchBySubtask = (() => {
    const ids = subtasks.map(s => s.id)
    if (ids.length === 0) return new Map<number, number>()
    const placeholders = ids.map(() => '?').join(',')
    const rows = getDb().prepare(`
      SELECT task_id, MAX(id) AS id
      FROM dispatch_queue
      WHERE task_id IN (${placeholders})
        AND status IN ('queued', 'working')
        AND COALESCE(run_type, 'single') != 'team_child'
      GROUP BY task_id
    `).all(...ids) as { task_id: number; id: number }[]
    return new Map<number, number>(rows.map(r => [r.task_id, r.id]))
  })()

  // Build dispatches for runnable subtasks. We need all of them enqueued first,
  // then wire dependencies in a second pass so blocked_by can reference later
  // siblings without forward-declaration headaches.
  const dispatchBySubtaskId = new Map<number, number>() // subtask.id -> dispatch.id
  const created: Array<{
    dispatch_id: number
    task_id: number
    task_title: string
    agent_id: string
    depends_on_task_ids: number[]
  }> = []
  const skipped: Array<{ task_id: number; task_title: string; reason: string }> = []

  for (const sub of subtasks) {
    if (!RUNNABLE_STATUSES.has(sub.status)) {
      skipped.push({ task_id: sub.id, task_title: sub.title, reason: `status=${sub.status}` })
      continue
    }
    const existingDispatchId = activeDispatchBySubtask.get(sub.id)
    if (existingDispatchId) {
      // Reuse the existing in-flight dispatch so blocked_by edges in this pass
      // can still wire up against it; skip re-enqueuing.
      dispatchBySubtaskId.set(sub.id, existingDispatchId)
      skipped.push({
        task_id: sub.id,
        task_title: sub.title,
        reason: `existing dispatch #${existingDispatchId} still in flight`,
      })
      continue
    }
    const agentId = inferAgent(sub.assignee)
    const dispatch = enqueueDispatch({
      taskId: sub.id,
      agentId,
      priority,
      inputContext: buildSubtaskPrompt(parent, sub),
      triggerType: 'manual',
      sourceTaskId: parent.id,
      sourceAgentId: 'pipeline',
    })
    dispatchBySubtaskId.set(sub.id, dispatch.id)
    created.push({
      dispatch_id: dispatch.id,
      task_id: sub.id,
      task_title: sub.title,
      agent_id: agentId,
      depends_on_task_ids: [],
    })
    createTaskActivity(
      sub.id,
      'dispatch_queued',
      `Queued as pipeline step (dispatch #${dispatch.id}, agent ${agentId})`,
      agentId,
      JSON.stringify({ pipeline_parent_task_id: parent.id, dispatch_id: dispatch.id })
    )
  }

  // Wire dependencies. Only edges between siblings of this pipeline count --
  // external blocked_by entries are ignored because they point at work that
  // isn't part of this run.
  for (const sub of subtasks) {
    const dispatchId = dispatchBySubtaskId.get(sub.id)
    if (!dispatchId) continue
    const blockedByIds = parseBlockedBy(sub.blocked_by)
    const createdEntry = created.find(c => c.task_id === sub.id)
    for (const depTaskId of blockedByIds) {
      const depDispatchId = dispatchBySubtaskId.get(depTaskId)
      if (!depDispatchId) continue // not in this pipeline, skip
      addDispatchDependency(dispatchId, depDispatchId)
      if (createdEntry) createdEntry.depends_on_task_ids.push(depTaskId)
    }
  }

  // Wake the Mac bridge once after all pipeline subtasks are enqueued and
  // dep edges wired. Without this the bridge wouldn't claim the first
  // runnable step until its next 30s poll.
  if (created.length > 0) {
    notifyBridge({
      event: 'pipeline_enqueued',
      reason: 'pipeline',
      dispatch_ids: created.map(c => c.dispatch_id),
      task_id: parent.id,
      task_title: parent.title,
    })
  }

  return NextResponse.json({
    ok: true,
    parent_task_id: parent.id,
    created,
    skipped,
  })
}
