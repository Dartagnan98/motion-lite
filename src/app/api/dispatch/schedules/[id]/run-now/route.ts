import { NextRequest, NextResponse } from 'next/server'
import {
  getScheduledDispatch,
  enqueueDispatch,
  addDispatchDependency,
  recordScheduledDispatchFire,
  createTaskActivity,
  getTask,
  instantiateRoutineAsTasks,
} from '@/lib/db'
import type { Task } from '@/lib/types'
import { computeNextRun } from '@/lib/schedules/cron'
import { notifyBridge } from '@/lib/dispatch/notify-bridge'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

const ASSIGNEE_TO_AGENT: Record<string, string> = {
  claude: 'claude',
  orchestrator: 'orchestrator',
  team: 'orchestrator',
  jimmy: 'jimmy',
  gary: 'gary',
  ricky: 'ricky',
  sofia: 'sofia',
  marcus: 'marcus',
  nina: 'nina',
  theo: 'theo',
  qc: 'qc',
}

function inferAgent(a: string | null | undefined): string {
  if (!a) return 'orchestrator'
  return ASSIGNEE_TO_AGENT[a.trim().toLowerCase()] || 'orchestrator'
}

function parseBlockedBy(v: string | null | undefined): number[] {
  if (!v) return []
  return String(v).split(',').map(s => parseInt(s.trim())).filter(n => Number.isFinite(n) && n > 0)
}

function buildSubtaskPrompt(parent: Task, subtask: Task): string {
  const parts: string[] = []
  parts.push(`Pipeline parent: ${parent.title}`)
  if (parent.description) {
    parts.push('', 'Parent context:', parent.description.trim())
  }
  parts.push('', `Your step: ${subtask.title}`)
  if (subtask.description) {
    parts.push('', subtask.description.trim())
  }
  return parts.join('\n')
}

/**
 * POST /api/dispatch/schedules/[id]/run-now
 *
 * Fires a schedule on demand regardless of its next_run_at. Mirrors the
 * cron tick branching (cron / heartbeat / multistep) but does NOT require
 * the CRON_SECRET header -- this is a user-authenticated action.
 *
 * Always recomputes the schedule's next_run_at so the manual fire slots
 * into the regular cadence rather than double-firing a minute later.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: idStr } = await ctx.params
  const id = Number(idStr)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const row = getScheduledDispatch(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = Math.floor(Date.now() / 1000)
  const nextRunAt = computeNextRun(row.cron_expr, row.timezone, new Date(now * 1000))

  try {
    if (row.type === 'multistep') {
      if (!row.routine_id) throw new Error('multistep schedule missing routine_id')

      const runLabel = new Date(now * 1000).toISOString().slice(0, 16).replace('T', ' ')
      const result = instantiateRoutineAsTasks(row.routine_id, { runLabel: `${runLabel} (manual)` })
      if (!result) throw new Error(`routine ${row.routine_id} not found or empty`)

      const subtasks = result.subtaskIds
        .map(sid => getTask(sid))
        .filter((t): t is Task => !!t)
      const parent = getTask(result.parentTaskId)
      if (!parent) throw new Error('parent task vanished after instantiate')

      const dispatchBySubtaskId = new Map<number, number>()
      const enqueuedIds: number[] = []

      for (const sub of subtasks) {
        const agentId = inferAgent(sub.assignee)
        const dispatch = enqueueDispatch({
          taskId: sub.id,
          agentId,
          triggerType: 'schedule',
          priority: 5,
          inputContext: buildSubtaskPrompt(parent, sub),
          sourceTaskId: parent.id,
          sourceAgentId: 'schedule-multistep',
          sourceScheduleId: row.id,
        })
        dispatchBySubtaskId.set(sub.id, dispatch.id)
        enqueuedIds.push(dispatch.id)
        createTaskActivity(
          sub.id,
          'dispatch_queued',
          `Queued by schedule "${row.name}" (manual run, dispatch #${dispatch.id})`,
          agentId,
          JSON.stringify({ schedule_id: row.id, parent_task_id: parent.id, dispatch_id: dispatch.id, manual: true })
        )
      }

      for (const sub of subtasks) {
        const dispatchId = dispatchBySubtaskId.get(sub.id)
        if (!dispatchId) continue
        for (const depTaskId of parseBlockedBy(sub.blocked_by)) {
          const depDispatchId = dispatchBySubtaskId.get(depTaskId)
          if (depDispatchId) addDispatchDependency(dispatchId, depDispatchId)
        }
      }

      recordScheduledDispatchFire(row.id, {
        dispatchId: enqueuedIds[0] ?? null,
        nextRunAt,
        status: 'ok',
        failureCountOp: 'reset',
      })

      if (enqueuedIds.length > 0) {
        notifyBridge({
          event: 'run_now',
          reason: 'schedule-multistep',
          dispatch_ids: enqueuedIds,
          schedule_id: row.id,
          schedule_name: row.name,
          parent_task_id: parent.id,
        })
      }

      return NextResponse.json({
        ok: true,
        type: 'multistep',
        parent_task_id: parent.id,
        dispatch_ids: enqueuedIds,
      })
    }

    // cron + heartbeat single-dispatch path
    const sourceAgentId = row.type === 'heartbeat' ? 'heartbeat' : 'cron'
    const dispatch = enqueueDispatch({
      taskId: row.task_id ?? undefined,
      agentId: row.agent_id,
      triggerType: 'schedule',
      priority: 5,
      inputContext: row.input_context ?? null,
      sourceAgentId,
      sourceScheduleId: row.id,
    })

    if (row.task_id) {
      const t = getTask(row.task_id)
      if (t) {
        createTaskActivity(
          row.task_id,
          'dispatch_queued',
          `Manually run by schedule "${row.name}" (dispatch #${dispatch.id})`,
          row.agent_id,
          JSON.stringify({ schedule_id: row.id, dispatch_id: dispatch.id, manual: true })
        )
      }
    }

    recordScheduledDispatchFire(row.id, {
      dispatchId: dispatch.id,
      nextRunAt,
      status: 'ok',
      failureCountOp: 'reset',
    })

    notifyBridge({
      event: 'run_now',
      reason: row.type === 'heartbeat' ? 'schedule-heartbeat' : 'schedule',
      dispatch_ids: [dispatch.id],
      schedule_id: row.id,
      schedule_name: row.name,
    })

    return NextResponse.json({
      ok: true,
      type: row.type,
      dispatch_id: dispatch.id,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    recordScheduledDispatchFire(row.id, {
      dispatchId: null,
      nextRunAt,
      status: 'error',
      error: message.slice(0, 500),
      failureCountOp: 'bump',
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
