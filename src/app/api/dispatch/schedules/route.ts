import { NextRequest, NextResponse } from 'next/server'
import {
  insertScheduledDispatch,
  listScheduledDispatches,
  getTask,
  getRoutineWithSteps,
  type ScheduleType,
} from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { computeNextRun, isValidCron } from '@/lib/schedules/cron'

export const runtime = 'nodejs'

const AGENT_ALIAS: Record<string, string> = {
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

function normalizeAgent(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!s || !/^[a-z0-9_-]{2,32}$/.test(s)) return null
  return AGENT_ALIAS[s] ?? s
}

/** GET /api/dispatch/schedules -- list all schedules for the dashboard */
export async function GET() {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const schedules = listScheduledDispatches()
  return NextResponse.json({ schedules })
}

/**
 * POST /api/dispatch/schedules
 * Body: {
 *   name, cron_expr, timezone?, agent_id,
 *   task_id? | input_context?   (exactly one required),
 *   enabled?
 * }
 */
export async function POST(request: NextRequest) {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as {
    name?: unknown
    cron_expr?: unknown
    timezone?: unknown
    agent_id?: unknown
    task_id?: unknown
    input_context?: unknown
    enabled?: unknown
    type?: unknown
    routine_id?: unknown
    skip_if_running?: unknown
    retry_on_failure?: unknown
    max_retries?: unknown
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const cronExpr = typeof body.cron_expr === 'string' ? body.cron_expr.trim() : ''
  const timezone = typeof body.timezone === 'string' && body.timezone.trim()
    ? body.timezone.trim()
    : 'America/Vancouver'

  if (!cronExpr || !isValidCron(cronExpr, timezone)) {
    return NextResponse.json({ error: 'Invalid cron expression' }, { status: 400 })
  }

  const typeRaw = typeof body.type === 'string' ? body.type.trim().toLowerCase() : 'cron'
  const type: ScheduleType = (typeRaw === 'heartbeat' || typeRaw === 'multistep') ? typeRaw : 'cron'

  const routineIdRaw = Number(body.routine_id)
  const routineId = Number.isFinite(routineIdRaw) && routineIdRaw > 0 ? routineIdRaw : null

  const taskIdRaw = Number(body.task_id)
  const taskId = Number.isFinite(taskIdRaw) && taskIdRaw > 0 ? taskIdRaw : null
  const inputContextRaw = typeof body.input_context === 'string' ? body.input_context.trim() : ''
  const inputContext = inputContextRaw || null

  if (type === 'multistep') {
    if (!routineId) {
      return NextResponse.json({ error: 'routine_id is required for multistep schedules' }, { status: 400 })
    }
    const routine = getRoutineWithSteps(routineId)
    if (!routine) return NextResponse.json({ error: 'Routine not found' }, { status: 400 })
    if (routine.steps.length === 0) {
      return NextResponse.json({ error: 'Routine has no steps' }, { status: 400 })
    }
  } else {
    if (!taskId && !inputContext) {
      return NextResponse.json(
        { error: 'Either task_id or input_context is required' },
        { status: 400 }
      )
    }
    if (taskId) {
      const task = getTask(taskId)
      if (!task) return NextResponse.json({ error: 'Linked task not found' }, { status: 400 })
    }
  }

  const agentId = type === 'multistep'
    ? 'orchestrator'
    : normalizeAgent(body.agent_id)
  if (!agentId) return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })

  const nextRunAt = computeNextRun(cronExpr, timezone)

  const maxRetriesRaw = Number(body.max_retries)
  const maxRetries = Number.isFinite(maxRetriesRaw) ? Math.max(0, Math.min(20, Math.floor(maxRetriesRaw))) : 0

  const schedule = insertScheduledDispatch({
    name,
    cronExpr,
    timezone,
    agentId,
    taskId: type === 'multistep' ? null : taskId,
    inputContext: type === 'multistep' ? null : inputContext,
    nextRunAt,
    enabled: body.enabled === false ? false : true,
    type,
    routineId: type === 'multistep' ? routineId : null,
    skipIfRunning: body.skip_if_running === true,
    retryOnFailure: body.retry_on_failure === true,
    maxRetries,
  })

  return NextResponse.json({ schedule }, { status: 201 })
}
