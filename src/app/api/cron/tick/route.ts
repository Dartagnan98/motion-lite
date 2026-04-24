import { NextRequest, NextResponse } from 'next/server'
import {
  claimDueScheduledDispatches,
  enqueueDispatch,
  addDispatchDependency,
  recordScheduledDispatchFire,
  createTaskActivity,
  getTask,
  instantiateRoutineAsTasks,
  countActiveDispatchesForSchedule,
  getSchedulesPauseState,
} from '@/lib/db'
import type { Task } from '@/lib/types'
import { computeNextRun } from '@/lib/schedules/cron'
import { notifyBridge } from '@/lib/dispatch/notify-bridge'

export const runtime = 'nodejs'

function authenticateCron(request: NextRequest): boolean {
  const secret = request.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET
  return !!expected && !!secret && secret === expected
}

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
 * POST /api/cron/tick
 *
 * Called by Hetzner's crontab once a minute. Finds every enabled schedule
 * whose next_run_at is due, fires the appropriate work based on `type`:
 *
 *   cron       → single dispatch (task_id or input_context)
 *   heartbeat  → single dispatch tagged sourceAgentId='heartbeat' so the
 *                bridge can gather local context before handing off
 *   multistep  → instantiate a routine into parent task + subtasks, then
 *                enqueue one dispatch per subtask with blocked_by wired
 *                into dispatch_dependencies (same DAG the pipeline uses)
 *
 * Auth: x-cron-secret header must match CRON_SECRET env. The middleware
 * passes /api/cron/ through without a session cookie, so this handler is
 * the sole gate. Safe to re-run at any cadence — each fire atomically
 * records the new next_run_at before returning.
 */
export async function POST(request: NextRequest) {
  if (!authenticateCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Math.floor(Date.now() / 1000)

  // Kill switch: if a human paused all schedules from the UI, the tick is a
  // no-op. Queued dispatches still flow through the bridge — pause only stops
  // the next scheduled enqueue round.
  const pause = getSchedulesPauseState()
  if (pause.paused) {
    return NextResponse.json({
      ok: true,
      now,
      paused: true,
      since: pause.since,
      reason: pause.reason,
      by: pause.by,
      due: 0,
      fired: 0,
      errors: 0,
    })
  }

  const due = claimDueScheduledDispatches(now, 20)

  const fired: Array<{
    schedule_id: number
    schedule_type: string
    dispatch_id: number | null
    dispatch_ids?: number[]
    parent_task_id?: number | null
    name: string
  }> = []
  const errors: Array<{ schedule_id: number; name: string; error: string }> = []

  for (const row of due) {
    // Advance next_run_at based on the current clock, not the (possibly stale)
    // previous next_run_at — avoids double-firing when a tick runs late.
    const nextRunAt = computeNextRun(row.cron_expr, row.timezone, new Date(now * 1000))

    // Concurrency guard: if the schedule opted into skip_if_running and a
    // prior fire is still queued/working, advance next_run_at without enqueuing.
    if (row.skip_if_running && countActiveDispatchesForSchedule(row.id) > 0) {
      recordScheduledDispatchFire(row.id, {
        dispatchId: null,
        nextRunAt,
        status: 'skipped',
        error: 'skipped: prior run still active',
      })
      fired.push({
        schedule_id: row.id,
        schedule_type: row.type,
        dispatch_id: null,
        name: row.name,
      })
      continue
    }

    try {
      if (row.type === 'multistep') {
        if (!row.routine_id) throw new Error('multistep schedule missing routine_id')

        const runLabel = new Date(now * 1000).toISOString().slice(0, 16).replace('T', ' ')
        const result = instantiateRoutineAsTasks(row.routine_id, { runLabel })
        if (!result) throw new Error(`routine ${row.routine_id} not found or empty`)

        // Use the subtaskIds array directly (in routine-step order) rather than
        // getSubtasks() which orders by tasks.sort_order and would tie at 0.
        const subtasks = result.subtaskIds
          .map(sid => getTask(sid))
          .filter((t): t is Task => !!t)
        const parent = getTask(result.parentTaskId)
        if (!parent) throw new Error('parent task vanished after instantiate')

        // Enqueue one dispatch per subtask, then wire deps in a second pass
        // so blocked_by can reference siblings without forward declarations.
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
            `Queued by schedule "${row.name}" (routine step, dispatch #${dispatch.id})`,
            agentId,
            JSON.stringify({
              schedule_id: row.id,
              parent_task_id: parent.id,
              dispatch_id: dispatch.id,
            })
          )
        }

        // Wire dispatch dependencies from sibling blocked_by edges.
        for (const sub of subtasks) {
          const dispatchId = dispatchBySubtaskId.get(sub.id)
          if (!dispatchId) continue
          const blockedByIds = parseBlockedBy(sub.blocked_by)
          for (const depTaskId of blockedByIds) {
            const depDispatchId = dispatchBySubtaskId.get(depTaskId)
            if (!depDispatchId) continue
            addDispatchDependency(dispatchId, depDispatchId)
          }
        }

        // Record the first dispatch id as last_dispatch_id so the UI can link
        // the schedule row to the run. Parent task is the logical entry point.
        recordScheduledDispatchFire(row.id, {
          dispatchId: enqueuedIds[0] ?? null,
          nextRunAt,
          status: 'ok',
          failureCountOp: 'reset',
        })

        if (enqueuedIds.length > 0) {
          notifyBridge({
            event: 'scheduled',
            reason: 'schedule-multistep',
            dispatch_ids: enqueuedIds,
            schedule_id: row.id,
            schedule_name: row.name,
            parent_task_id: parent.id,
          })
        }

        fired.push({
          schedule_id: row.id,
          schedule_type: 'multistep',
          dispatch_id: enqueuedIds[0] ?? null,
          dispatch_ids: enqueuedIds,
          parent_task_id: parent.id,
          name: row.name,
        })
      } else {
        // cron (current default) + heartbeat share the single-dispatch path.
        // The only difference is sourceAgentId, which the bridge inspects to
        // decide whether to gather local context before running the agent.
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
              `Queued by schedule "${row.name}" (dispatch #${dispatch.id})`,
              row.agent_id,
              JSON.stringify({ schedule_id: row.id, dispatch_id: dispatch.id })
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
          event: 'scheduled',
          reason: row.type === 'heartbeat' ? 'schedule-heartbeat' : 'schedule',
          dispatch_ids: [dispatch.id],
          schedule_id: row.id,
          schedule_name: row.name,
        })

        fired.push({
          schedule_id: row.id,
          schedule_type: row.type,
          dispatch_id: dispatch.id,
          name: row.name,
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      // Retry policy: if the schedule asked for retries and we're under the cap,
      // re-fire on the next minute instead of jumping to the full cadence. Else
      // advance next_run_at normally so a wedged schedule doesn't pile up.
      const nextFailures = (row.failure_count ?? 0) + 1
      const wantsRetry = row.retry_on_failure === 1 && nextFailures <= row.max_retries
      const retryNext = wantsRetry ? now + 60 : nextRunAt
      recordScheduledDispatchFire(row.id, {
        dispatchId: null,
        nextRunAt: retryNext,
        status: 'error',
        error: message.slice(0, 500),
        failureCountOp: 'bump',
      })
      errors.push({ schedule_id: row.id, name: row.name, error: message })
    }
  }

  return NextResponse.json({
    ok: true,
    now,
    due: due.length,
    fired: fired.length,
    errors: errors.length,
    fired_details: fired,
    error_details: errors,
  })
}
