import { NextRequest, NextResponse } from 'next/server'
import {
  getScheduledDispatch,
  updateScheduledDispatch,
  deleteScheduledDispatch,
  getTask,
  getRoutineWithSteps,
  type ScheduleType,
} from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { computeNextRun, isValidCron } from '@/lib/schedules/cron'

export const runtime = 'nodejs'

async function resolveId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  return Number.isFinite(id) && id > 0 ? id : null
}

/**
 * PATCH /api/dispatch/schedules/[id]
 * Body: partial patch. If cron_expr or timezone change, next_run_at is
 * recomputed. Toggling enabled off clears next_run_at so the tick endpoint
 * stops seeing the row as due; toggling back on recomputes from the stored
 * cron expression.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = await resolveId(params)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const existing = getScheduledDispatch(id)
  if (!existing) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const patch: Record<string, unknown> = {}

  if (typeof body.name === 'string' && body.name.trim()) {
    patch.name = body.name.trim()
  }

  const newCronExpr = typeof body.cron_expr === 'string' ? body.cron_expr.trim() : undefined
  const newTimezone = typeof body.timezone === 'string' && body.timezone.trim()
    ? body.timezone.trim()
    : undefined

  const effectiveCron = newCronExpr ?? existing.cron_expr
  const effectiveTz = newTimezone ?? existing.timezone

  if (newCronExpr !== undefined || newTimezone !== undefined) {
    if (!isValidCron(effectiveCron, effectiveTz)) {
      return NextResponse.json({ error: 'Invalid cron expression' }, { status: 400 })
    }
    if (newCronExpr !== undefined) patch.cron_expr = newCronExpr
    if (newTimezone !== undefined) patch.timezone = newTimezone
  }

  if (typeof body.agent_id === 'string' && /^[a-z0-9_-]{2,32}$/.test(body.agent_id.trim().toLowerCase())) {
    patch.agent_id = body.agent_id.trim().toLowerCase()
  }

  if (body.task_id === null) {
    patch.task_id = null
  } else if (Number.isFinite(Number(body.task_id)) && Number(body.task_id) > 0) {
    const task = getTask(Number(body.task_id))
    if (!task) return NextResponse.json({ error: 'Linked task not found' }, { status: 400 })
    patch.task_id = Number(body.task_id)
  }

  if (typeof body.input_context === 'string') {
    patch.input_context = body.input_context.trim() || null
  } else if (body.input_context === null) {
    patch.input_context = null
  }

  if (typeof body.type === 'string') {
    const t = body.type.trim().toLowerCase()
    if (t === 'cron' || t === 'heartbeat' || t === 'multistep') {
      patch.type = t as ScheduleType
    }
  }

  if (body.routine_id === null) {
    patch.routine_id = null
  } else if (Number.isFinite(Number(body.routine_id)) && Number(body.routine_id) > 0) {
    const routine = getRoutineWithSteps(Number(body.routine_id))
    if (!routine) return NextResponse.json({ error: 'Routine not found' }, { status: 400 })
    if (routine.steps.length === 0) return NextResponse.json({ error: 'Routine has no steps' }, { status: 400 })
    patch.routine_id = Number(body.routine_id)
  }

  // Ensure the row still has something to run on after the patch.
  const effectiveType: ScheduleType = ('type' in patch ? patch.type : existing.type) as ScheduleType
  if (effectiveType === 'multistep') {
    const willHaveRoutine = 'routine_id' in patch ? patch.routine_id : existing.routine_id
    if (!willHaveRoutine) {
      return NextResponse.json(
        { error: 'Multistep schedule requires a routine' },
        { status: 400 }
      )
    }
  } else {
    const willHaveTask = 'task_id' in patch ? patch.task_id : existing.task_id
    const willHaveContext = 'input_context' in patch ? patch.input_context : existing.input_context
    if (!willHaveTask && !willHaveContext) {
      return NextResponse.json(
        { error: 'Schedule must have either a linked task or input_context' },
        { status: 400 }
      )
    }
  }

  // enabled flag. Clearing enabled=0 also wipes next_run_at so the tick query
  // can ignore the row cheaply. Re-enabling recomputes the next fire time.
  if (typeof body.enabled === 'boolean') {
    patch.enabled = body.enabled ? 1 : 0
    if (!body.enabled) {
      patch.next_run_at = null
    }
  }

  if (typeof body.skip_if_running === 'boolean') {
    patch.skip_if_running = body.skip_if_running ? 1 : 0
  }
  if (typeof body.retry_on_failure === 'boolean') {
    patch.retry_on_failure = body.retry_on_failure ? 1 : 0
    // Resetting the failure counter when retry policy changes so a stuck
    // schedule doesn't stay over-budget from a prior config.
    patch.failure_count = 0
  }
  if (body.max_retries !== undefined) {
    const mr = Number(body.max_retries)
    if (Number.isFinite(mr)) {
      patch.max_retries = Math.max(0, Math.min(20, Math.floor(mr)))
    }
  }

  // Recompute next_run_at if cron/tz/enabled changed to true. We do this
  // after the enabled branch so disabling wins.
  const cronChanged = 'cron_expr' in patch || 'timezone' in patch
  const beingEnabled = patch.enabled === 1
  const nowEnabled = patch.enabled === 1 || (!('enabled' in patch) && existing.enabled === 1)

  if (nowEnabled && (cronChanged || beingEnabled) && !('next_run_at' in patch)) {
    patch.next_run_at = computeNextRun(effectiveCron, effectiveTz)
  }

  updateScheduledDispatch(id, patch)
  const updated = getScheduledDispatch(id)
  return NextResponse.json({ schedule: updated })
}

/** DELETE /api/dispatch/schedules/[id] */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = await resolveId(params)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const existing = getScheduledDispatch(id)
  if (!existing) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  deleteScheduledDispatch(id)
  return NextResponse.json({ ok: true })
}
