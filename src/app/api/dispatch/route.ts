import { NextRequest, NextResponse } from 'next/server'
import { getTask, updateTask, createTaskActivity, enqueueDispatch, updateDispatch, getDispatchesForDashboard, getDispatchById, getChildDispatches, addDispatchMessage } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { requireAuth } from '@/lib/auth'
import { notifyBridge } from '@/lib/dispatch/notify-bridge'

const AGENT_ALIAS: Record<string, string> = {
  claude: 'claude',
  orchestrator: 'orchestrator',
  team: 'orchestrator',
  parallel_team: 'orchestrator',
  orchestrator_team: 'orchestrator',
  jimmy: 'jimmy',
  gary: 'gary',
  ricky: 'ricky',
  sofia: 'sofia',
}

const TEAM_SPECIALISTS = ['gary', 'ricky', 'sofia'] as const

function normalizeDispatchAgent(raw: unknown, taskAssignee?: string | null): string {
  const fromBody = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (fromBody && /^[a-z0-9_-]{2,32}$/.test(fromBody)) {
    return AGENT_ALIAS[fromBody] || fromBody
  }

  const fromAssignee = typeof taskAssignee === 'string' ? taskAssignee.trim().toLowerCase() : ''
  if (fromAssignee && AGENT_ALIAS[fromAssignee]) {
    return AGENT_ALIAS[fromAssignee]
  }

  return 'claude'
}

export async function GET() {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const dispatches = getDispatchesForDashboard()
  return NextResponse.json({ dispatches })
}

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { taskId, inputContext } = body

  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
  }

  const task = getTask(taskId)
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const requestedAgent = typeof body.agentId === 'string' ? body.agentId.trim().toLowerCase() : ''
  const isTeamDispatch = body.teamMode === true || requestedAgent === 'team' || requestedAgent === 'parallel_team' || requestedAgent === 'orchestrator_team'
  const agentId = normalizeDispatchAgent(body.agentId, task.assignee)
  const now = Math.floor(Date.now() / 1000)

  if (isTeamDispatch) {
    const parent = enqueueDispatch({
      taskId,
      agentId: 'orchestrator',
      triggerType: body.triggerType || 'manual',
      inputContext: inputContext || null,
      runType: 'team_parent',
    })

    updateDispatch(parent.id, {
      status: 'working',
      started_at: now,
      completed_at: null,
      result_summary: 'Parallel specialist team launched',
      worker_id: null,
      heartbeat_at: null,
    })

    const children = TEAM_SPECIALISTS.map((specialist) => {
      const specialistContext = [
        `Specialist assignment: ${specialist}`,
        inputContext || '',
      ].filter(Boolean).join('\n\n')

      return enqueueDispatch({
        taskId,
        agentId: specialist,
        triggerType: 'chain',
        sourceAgentId: 'orchestrator',
        inputContext: specialistContext || null,
        runType: 'team_child',
        parentDispatchId: parent.id,
        specialistRole: specialist,
      })
    })

    const dispatchMeta = JSON.stringify({ dispatch_id: parent.id, run_type: 'team_parent', agent_id: 'orchestrator' })
    createTaskActivity(
      taskId,
      'dispatch_queued',
      `Parallel team dispatched (dispatch #${parent.id}): ${children.map(c => c.agent_id).join(', ')}`,
      'orchestrator',
      dispatchMeta
    )
    createTaskActivity(
      taskId,
      'dispatch_progress',
      `Team run active: ${children.length} specialist threads launched`,
      'orchestrator',
      dispatchMeta
    )

    updateTask(taskId, { status: 'in_progress' })

    notifyBridge({
      event: 'dispatch_created',
      reason: 'enqueue_team',
      dispatch_id: parent.id,
      dispatch_ids: children.map(c => c.id),
      task_id: taskId,
      task_title: task.title,
      agent_id: 'orchestrator',
    })

    return NextResponse.json({
      ok: true,
      message: 'Queued for parallel team processing',
      dispatch: { ...parent, status: 'working' },
      children,
    })
  }

  const dispatch = enqueueDispatch({
    taskId,
    agentId,
    triggerType: body.triggerType || 'manual',
    inputContext: inputContext || null,
  })

  // Seed the chat thread with the initial user instruction (input_context or
  // task title), so the /dispatch/[id] UI has something to render immediately.
  try {
    const initialContent = (inputContext && String(inputContext).trim()) || task.title
    if (initialContent) {
      addDispatchMessage({ dispatchId: dispatch.id, role: 'user', content: initialContent })
    }
  } catch { /* non-fatal */ }

  // Log activity on the task
  const dispatchMeta = JSON.stringify({ dispatch_id: dispatch.id, agent_id: dispatch.agent_id })
  createTaskActivity(
    taskId,
    'dispatch_queued',
    `Dispatched to ${dispatch.agent_id} (dispatch #${dispatch.id})`,
    dispatch.agent_id,
    dispatchMeta
  )

  // Mark task in progress
  updateTask(taskId, { status: 'in_progress' })

  // Wake the Mac dispatch-bridge immediately (fire-and-forget). Falls back to
  // 30s poll if bridge is offline.
  notifyBridge({
    event: 'dispatch_created',
    reason: 'enqueue',
    dispatch_id: dispatch.id,
    task_id: taskId,
    task_title: task.title,
    agent_id: dispatch.agent_id,
  })

  // Also fire the generic external webhook (separate from bridge push).
  const genericWebhookUrl = getSetting<string>('webhookUrl')
  if (genericWebhookUrl) {
    fetch(genericWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'dispatch_created',
        dispatch_id: dispatch.id,
        task_id: taskId,
        task_title: task.title,
      }),
    }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    message: 'Queued for processing',
    dispatch,
  })
}

export async function PATCH(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, action, feedback } = body

  if (!id || !action) {
    return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
  }

  const dispatch = getDispatchById(id)
  if (!dispatch) {
    return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })
  }

  const now = Math.floor(Date.now() / 1000)

  if (action === 'approve') {
    updateDispatch(id, { status: 'done', completed_at: now })
    if (dispatch.task_id) {
      const meta = JSON.stringify({ dispatch_id: id, agent_id: dispatch.agent_id })
      createTaskActivity(dispatch.task_id, 'dispatch_approved', 'Dispatch result approved', dispatch.agent_id, meta)
      updateTask(dispatch.task_id, { status: 'done' })
    }
    return NextResponse.json({ ok: true, message: 'Dispatch approved', status: 'done' })
  }

  if (action === 'reject') {
    if (dispatch.run_type === 'team_parent') {
      const children = getChildDispatches(id)
      updateDispatch(id, {
        status: 'working',
        feedback: feedback || 'Re-run requested',
        result_summary: null,
        error: null,
        started_at: now,
        completed_at: null,
        worker_id: null,
        heartbeat_at: null,
      })
      for (const child of children) {
        updateDispatch(child.id, {
          status: 'queued',
          feedback: feedback || 'Re-run requested',
          error: null,
          result_summary: null,
          next_retry_at: null,
          started_at: null,
          completed_at: null,
          attempt_count: 0,
          worker_id: null,
          heartbeat_at: null,
        })
      }
      if (dispatch.task_id) {
        const meta = JSON.stringify({ dispatch_id: id, run_type: 'team_parent', agent_id: dispatch.agent_id })
        createTaskActivity(dispatch.task_id, 'dispatch_rejected', feedback || 'Team run rejected and restarted', dispatch.agent_id, meta)
      }
      notifyBridge({
        event: 'dispatch_requeued',
        reason: 'requeue',
        dispatch_id: id,
        task_id: dispatch.task_id,
        agent_id: dispatch.agent_id,
      })
      return NextResponse.json({ ok: true, message: 'Team run restarted', status: 'working' })
    }

    updateDispatch(id, {
      status: 'queued',
      feedback: feedback || 'Rejected without feedback',
      attempt_count: 0,
      next_retry_at: null,
      started_at: null,
      completed_at: null,
      worker_id: null,
      heartbeat_at: null,
    })
    if (dispatch.task_id) {
      const meta = JSON.stringify({ dispatch_id: id, agent_id: dispatch.agent_id })
      createTaskActivity(dispatch.task_id, 'dispatch_rejected', feedback || 'Dispatch result rejected, re-queued', dispatch.agent_id, meta)
    }
    notifyBridge({
      event: 'dispatch_requeued',
      reason: 'requeue',
      dispatch_id: id,
      task_id: dispatch.task_id,
      agent_id: dispatch.agent_id,
    })
    return NextResponse.json({ ok: true, message: 'Dispatch rejected and re-queued', status: 'queued' })
  }

  if (action === 'cancel') {
    if (dispatch.run_type === 'team_parent') {
      const children = getChildDispatches(id)
      for (const child of children) {
        if (!['done', 'failed', 'cancelled'].includes(child.status)) {
          updateDispatch(child.id, {
            status: 'cancelled',
            completed_at: now,
            worker_id: null,
            heartbeat_at: null,
          })
        }
      }
    }

    updateDispatch(id, { status: 'cancelled', completed_at: now, worker_id: null, heartbeat_at: null })
    if (dispatch.task_id) {
      const meta = JSON.stringify({ dispatch_id: id, agent_id: dispatch.agent_id })
      createTaskActivity(dispatch.task_id, 'dispatch_failed', 'Dispatch cancelled', dispatch.agent_id, meta)
    }
    return NextResponse.json({ ok: true, message: 'Dispatch cancelled', status: 'cancelled' })
  }

  if (action === 'redispatch') {
    if (dispatch.run_type === 'team_parent') {
      const children = getChildDispatches(id)
      updateDispatch(id, {
        status: 'working',
        result: null,
        error: null,
        feedback: null,
        result_summary: null,
        next_retry_at: null,
        started_at: now,
        completed_at: null,
        worker_id: null,
        heartbeat_at: null,
      })
      for (const child of children) {
        updateDispatch(child.id, {
          status: 'queued',
          result: null,
          error: null,
          feedback: null,
          result_summary: null,
          attempt_count: 0,
          next_retry_at: null,
          started_at: null,
          completed_at: null,
          worker_id: null,
          heartbeat_at: null,
        })
      }
      if (dispatch.task_id) {
        const meta = JSON.stringify({ dispatch_id: id, run_type: 'team_parent', agent_id: dispatch.agent_id })
        createTaskActivity(dispatch.task_id, 'dispatch_queued', `Team re-dispatched (dispatch #${id})`, dispatch.agent_id, meta)
      }
      notifyBridge({
        event: 'dispatch_redispatched',
        reason: 'redispatch',
        dispatch_id: id,
        task_id: dispatch.task_id,
        agent_id: dispatch.agent_id,
      })
      return NextResponse.json({ ok: true, message: 'Team re-dispatched', status: 'working' })
    }

    updateDispatch(id, {
      status: 'queued',
      result: null,
      error: null,
      feedback: null,
      result_summary: null,
      attempt_count: 0,
      next_retry_at: null,
      started_at: null,
      completed_at: null,
      worker_id: null,
      heartbeat_at: null,
    })
    if (dispatch.task_id) {
      const meta = JSON.stringify({ dispatch_id: id, agent_id: dispatch.agent_id })
      createTaskActivity(dispatch.task_id, 'dispatch_queued', `Re-dispatched (dispatch #${id})`, dispatch.agent_id, meta)
    }
    notifyBridge({
      event: 'dispatch_redispatched',
      reason: 'redispatch',
      dispatch_id: id,
      task_id: dispatch.task_id,
      agent_id: dispatch.agent_id,
    })
    return NextResponse.json({ ok: true, message: 'Re-dispatched', status: 'queued' })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
