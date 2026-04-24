import {
  createTask,
  updateTask,
  createTaskActivity,
  enqueueDispatch,
  insertScheduledDispatch,
  getRoutineWithSteps,
  getTool,
  getToolByName,
  recordToolInvocation,
  setToolInvocationForwardDispatch,
  type ToolRow,
  type ScheduleType,
} from '@/lib/db'
import { computeNextRun, isValidCron } from '@/lib/schedules/cron'
import { notifyBridge } from '@/lib/dispatch/notify-bridge'

export interface ToolInvokeResult {
  ok: boolean
  tool: string
  result?: unknown
  error?: string
  duration_ms: number
  invocation_id: number
}

export interface InvokeOpts {
  caller?: string
  dispatchId?: number | null
}

/**
 * Resolve a tool by name, run its handler, record the invocation, and return
 * a normalized result envelope. Callers never call handlers directly — they
 * go through here so every invocation is logged consistently.
 *
 * Handler routing:
 *   motion-internal → switch below (in-process function call)
 *   webhook         → POST args to `endpoint` with 5s timeout
 *   bridge-forward  → throws; bridge is expected to pick this up via /queue
 *                     and invoke the tool itself on the Mac. v1 doesn't wire
 *                     the callback yet.
 */
export async function invokeToolByName(
  name: string,
  args: Record<string, unknown>,
  opts: InvokeOpts = {}
): Promise<ToolInvokeResult> {
  const started = Date.now()
  const tool = getToolByName(name)
  if (!tool) {
    return errorEnvelope(null, name, 'tool not found', started, opts)
  }
  return runWithTool(tool, args, opts, started)
}

export async function invokeToolById(
  id: number,
  args: Record<string, unknown>,
  opts: InvokeOpts = {}
): Promise<ToolInvokeResult> {
  const started = Date.now()
  const tool = getTool(id)
  if (!tool) {
    return errorEnvelope(null, String(id), 'tool not found', started, opts)
  }
  return runWithTool(tool, args, opts, started)
}

async function runWithTool(
  tool: ToolRow,
  args: Record<string, unknown>,
  opts: InvokeOpts,
  started: number
): Promise<ToolInvokeResult> {
  if (!tool.enabled) {
    return errorEnvelope(tool, tool.name, 'tool is disabled', started, opts)
  }
  const schemaError = validateAgainstSchema(tool.input_schema, args)
  if (schemaError) {
    return errorEnvelope(tool, tool.name, schemaError, started, opts, args)
  }
  // Bridge-forward doesn't return synchronously — it enqueues a dispatch for
  // the Mac bridge to claim, execute, and POST a completion back. Early-return
  // a pending envelope so the caller can poll or react to the invocation row.
  if (tool.handler_type === 'bridge-forward') {
    return handleBridgeForward(tool, args, opts, started)
  }
  try {
    let result: unknown
    if (tool.handler_type === 'motion-internal') {
      result = handleMotionInternal(tool.name, args)
    } else if (tool.handler_type === 'webhook') {
      result = await handleWebhook(tool, args)
    } else {
      throw new Error(`unsupported handler_type: ${tool.handler_type}`)
    }
    const duration = Date.now() - started
    const inv = recordToolInvocation({
      toolId: tool.id,
      toolName: tool.name,
      caller: opts.caller ?? null,
      dispatchId: opts.dispatchId ?? null,
      args,
      result,
      status: 'ok',
      durationMs: duration,
    })
    return { ok: true, tool: tool.name, result, duration_ms: duration, invocation_id: inv.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return errorEnvelope(tool, tool.name, message, started, opts, args)
  }
}

function errorEnvelope(
  tool: ToolRow | null,
  name: string,
  message: string,
  started: number,
  opts: InvokeOpts,
  args?: Record<string, unknown>
): ToolInvokeResult {
  const duration = Date.now() - started
  const invocationId = tool
    ? recordToolInvocation({
        toolId: tool.id,
        toolName: tool.name,
        caller: opts.caller ?? null,
        dispatchId: opts.dispatchId ?? null,
        args,
        status: 'error',
        error: message.slice(0, 1000),
        durationMs: duration,
      }).id
    : 0
  return { ok: false, tool: name, error: message, duration_ms: duration, invocation_id: invocationId }
}

async function handleWebhook(tool: ToolRow, args: Record<string, unknown>): Promise<unknown> {
  if (!tool.endpoint) throw new Error('webhook tool has no endpoint configured')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-motion-tool': tool.name,
  }
  // Opt-in outbound signing: when MOTION_WEBHOOK_SECRET is set, every webhook
  // invocation gets the shared secret in x-motion-secret so the receiver can
  // distinguish Motion-originated calls from random POSTs. No HMAC yet — v1
  // is bearer-style, and the secret rotates via env + PM2 restart.
  const secret = process.env.MOTION_WEBHOOK_SECRET
  if (secret) headers['x-motion-secret'] = secret
  try {
    const res = await fetch(tool.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`webhook returned ${res.status}: ${text.slice(0, 300)}`)
    try { return JSON.parse(text) } catch { return text }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('webhook timed out after 15s')
    }
    throw err
  } finally {
    clearTimeout(t)
  }
}

/**
 * Bridge-forward: persist a pending invocation row, enqueue a dispatch the Mac
 * bridge will claim, and ping the bridge awake so the round-trip is fast. The
 * bridge runs `tool.endpoint` as a local shell command with args piped as JSON
 * on stdin, captures stdout, and POSTs the outcome to
 * /api/dispatch/tools/invocations/:id/complete to finalize the row.
 *
 * Returns early with a 'pending' envelope — the caller is expected to poll the
 * invocation if it needs the final result. Motion doesn't block.
 */
async function handleBridgeForward(
  tool: ToolRow,
  args: Record<string, unknown>,
  opts: InvokeOpts,
  started: number
): Promise<ToolInvokeResult> {
  if (!tool.endpoint) {
    return errorEnvelope(tool, tool.name, 'bridge-forward tool has no endpoint (command) configured', started, opts, args)
  }
  // Record the invocation in a pending state. result_json carries {pending: true}
  // so the UI can render "forwarded, waiting" rows. Status stays 'ok' because
  // the existing CHECK constraint is ('ok','error') — the pending-ness is an
  // overlay in result_json that the completion endpoint clears.
  const inv = recordToolInvocation({
    toolId: tool.id,
    toolName: tool.name,
    caller: opts.caller ?? null,
    dispatchId: opts.dispatchId ?? null,
    args,
    result: { pending: true, forwarded_at: Math.floor(Date.now() / 1000) },
    status: 'ok',
    durationMs: 0,
  })

  let dispatchId: number | null = null
  try {
    const dispatch = enqueueDispatch({
      agentId: 'tool-forward',
      triggerType: 'tool',
      sourceAgentId: 'tool-forward',
      priority: 3,
      inputContext: JSON.stringify({
        kind: 'tool-forward',
        tool_id: tool.id,
        tool_name: tool.name,
        invocation_id: inv.id,
        endpoint: tool.endpoint,
        args,
      }),
    })
    dispatchId = dispatch.id
    setToolInvocationForwardDispatch(inv.id, dispatch.id)
    notifyBridge({
      event: 'scheduled',
      reason: 'tool-forward',
      dispatch_ids: [dispatch.id],
      tool_invocation_id: inv.id,
      tool_name: tool.name,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // Roll the invocation forward into an error so it doesn't sit pending forever.
    return errorEnvelope(tool, tool.name, `enqueue failed: ${msg}`, started, opts, args)
  }

  return {
    ok: true,
    tool: tool.name,
    result: {
      pending: true,
      forwarded: true,
      invocation_id: inv.id,
      dispatch_id: dispatchId,
    },
    duration_ms: Date.now() - started,
    invocation_id: inv.id,
  }
}

/**
 * Minimal JSON-schema-required check. Verifies args is an object and that every
 * name in schema.required[] is present (non-undefined). Skips type checks —
 * the handler does those downstream. Returning null = valid.
 */
function validateAgainstSchema(schemaJson: string | null, args: Record<string, unknown>): string | null {
  if (!schemaJson) return null
  let schema: Record<string, unknown>
  try { schema = JSON.parse(schemaJson) as Record<string, unknown> } catch { return null }
  if (!schema || typeof schema !== 'object') return null
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : []
  const missing: string[] = []
  for (const key of required) {
    if (typeof key !== 'string') continue
    if (args[key] === undefined || args[key] === null || args[key] === '') missing.push(key)
  }
  if (missing.length > 0) return `missing required arg(s): ${missing.join(', ')}`
  return null
}

function handleMotionInternal(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'create_task':
      return toolCreateTask(args)
    case 'update_task_status':
      return toolUpdateTaskStatus(args)
    case 'add_task_activity':
      return toolAddTaskActivity(args)
    case 'enqueue_dispatch':
      return toolEnqueueDispatch(args)
    case 'create_schedule':
      return toolCreateSchedule(args)
    default:
      throw new Error(`unknown motion-internal tool: ${name}`)
  }
}

function toolCreateTask(args: Record<string, unknown>): unknown {
  if (typeof args.title !== 'string' || !args.title.trim()) {
    throw new Error('title is required')
  }
  const t = createTask({
    title: String(args.title),
    description: typeof args.description === 'string' ? args.description : undefined,
    assignee: typeof args.assignee === 'string' ? args.assignee : undefined,
    priority: typeof args.priority === 'string' ? args.priority : undefined,
    workspaceId: Number.isFinite(Number(args.workspace_id)) ? Number(args.workspace_id) : undefined,
    projectId: Number.isFinite(Number(args.project_id)) ? Number(args.project_id) : undefined,
    parentTaskId: Number.isFinite(Number(args.parent_task_id)) ? Number(args.parent_task_id) : undefined,
    businessId: Number.isFinite(Number(args.business_id)) ? Number(args.business_id) : undefined,
    due_date: typeof args.due_date === 'string' ? args.due_date : undefined,
  })
  return { task_id: t.id, title: t.title }
}

function toolUpdateTaskStatus(args: Record<string, unknown>): unknown {
  const taskId = Number(args.task_id)
  const status = String(args.status || '')
  if (!Number.isFinite(taskId) || !status) throw new Error('task_id and status are required')
  updateTask(taskId, { status })
  return { task_id: taskId, status }
}

function toolAddTaskActivity(args: Record<string, unknown>): unknown {
  const taskId = Number(args.task_id)
  const message = String(args.message || '')
  if (!Number.isFinite(taskId) || !message) throw new Error('task_id and message are required')
  const activityType = typeof args.activity_type === 'string' ? args.activity_type : 'note'
  const agentId = typeof args.agent_id === 'string' ? args.agent_id : undefined
  const a = createTaskActivity(taskId, activityType, message, agentId)
  return { activity_id: a.id, task_id: taskId }
}

function toolEnqueueDispatch(args: Record<string, unknown>): unknown {
  const agentId = String(args.agent_id || '')
  if (!agentId) throw new Error('agent_id is required')
  const d = enqueueDispatch({
    agentId,
    taskId: Number.isFinite(Number(args.task_id)) ? Number(args.task_id) : undefined,
    inputContext: typeof args.input_context === 'string' ? args.input_context : null,
    priority: Number.isFinite(Number(args.priority)) ? Number(args.priority) : 5,
    triggerType: 'manual',
    sourceAgentId: 'tool',
  })
  return { dispatch_id: d.id }
}

function toolCreateSchedule(args: Record<string, unknown>): unknown {
  const cron = String(args.cron_expr || '').trim()
  const agent = String(args.agent_id || '').trim()
  const nameArg = String(args.name || '').trim()
  if (!cron || !agent || !nameArg) throw new Error('name, cron_expr, agent_id required')
  const timezone = typeof args.timezone === 'string' && args.timezone.trim()
    ? args.timezone.trim()
    : 'America/Vancouver'
  if (!isValidCron(cron, timezone)) throw new Error('invalid cron expression')

  const typeRaw = typeof args.type === 'string' ? args.type.trim().toLowerCase() : 'cron'
  const type: ScheduleType = (typeRaw === 'heartbeat' || typeRaw === 'multistep') ? typeRaw : 'cron'

  const routineId = Number.isFinite(Number(args.routine_id)) && Number(args.routine_id) > 0
    ? Number(args.routine_id) : null

  if (type === 'multistep') {
    if (!routineId) throw new Error('routine_id required for multistep schedule')
    const r = getRoutineWithSteps(routineId)
    if (!r || r.steps.length === 0) throw new Error('routine not found or has no steps')
  }

  const row = insertScheduledDispatch({
    name: nameArg,
    cronExpr: cron,
    agentId: agent,
    timezone,
    taskId: type === 'multistep' ? null : (Number.isFinite(Number(args.task_id)) ? Number(args.task_id) : null),
    inputContext: type === 'multistep' ? null : (typeof args.input_context === 'string' ? args.input_context : null),
    nextRunAt: computeNextRun(cron, timezone),
    type,
    routineId: type === 'multistep' ? routineId : null,
  })
  return { schedule_id: row.id, next_run_at: row.next_run_at }
}
