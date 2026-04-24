import { NextRequest, NextResponse } from 'next/server'
import { getDispatchById, getTask, getProject, updateDispatch, createTaskActivity, updateTask, getChildDispatches, addDispatchMessage } from '@/lib/db'
import { getSetting, setSetting } from '@/lib/settings'
import { requireAuth } from '@/lib/auth'
import { notifyBridge } from '@/lib/dispatch/notify-bridge'

// Dep children (pipeline DAG) are only unblocked when an upstream reaches one
// of these success states. failed/cancelled leave them stuck in queued.
const UNBLOCKING_STATUSES = new Set(['done', 'approved', 'needs_review'])

function authenticateBridge(request: NextRequest): boolean {
  const secret = request.headers.get('x-bridge-secret')
  return !!secret && secret === process.env.BRIDGE_SECRET
}

async function sendToTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN || ''
  const chatId = process.env.ALLOWED_CHAT_IDS?.split(',')[0] || ''
  if (!token || !chatId) return false
  try {
    const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch {
    return false
  }
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  queued: ['working', 'cancelled'],
  working: ['queued', 'needs_review', 'failed', 'cancelled'],
  needs_review: ['approved', 'done', 'queued'],
  approved: ['done'],
  done: ['queued'], // allow re-dispatch
  failed: ['queued'],
}

function metadataForDispatch(dispatch: ReturnType<typeof getDispatchById>, dispatchId: number): string {
  return JSON.stringify({
    dispatch_id: dispatchId,
    parent_dispatch_id: dispatch?.parent_dispatch_id || null,
    run_type: dispatch?.run_type || 'single',
    agent_id: dispatch?.agent_id || null,
  })
}

function readAutoApprove(): boolean {
  const raw = getSetting<unknown>('dispatchAutoApprove')
  if (typeof raw === 'boolean') return raw
  return process.env.DISPATCH_AUTO_APPROVE !== 'false'
}

function mergeTeamSummary(children: ReturnType<typeof getChildDispatches>): string {
  const lines: string[] = ['Parallel Specialist Team Summary', '']
  for (const child of children) {
    const header = `${child.agent_id.toUpperCase()} (${child.status})`
    const body = (child.result_summary || child.error || 'No output').trim()
    lines.push(`## ${header}`)
    lines.push(body)
    lines.push('')
  }
  return lines.join('\n').trim()
}

function reconcileParentTeamDispatch(parentDispatchId: number): void {
  const parent = getDispatchById(parentDispatchId)
  if (!parent || parent.run_type !== 'team_parent') return

  const children = getChildDispatches(parentDispatchId)
  if (children.length === 0) return

  const total = children.length
  const done = children.filter(c => c.status === 'done').length
  const failed = children.filter(c => c.status === 'failed' || c.status === 'cancelled').length
  const working = children.filter(c => c.status === 'working').length
  const queued = children.filter(c => c.status === 'queued').length

  const now = Math.floor(Date.now() / 1000)

  if (working > 0 || queued > 0) {
    updateDispatch(parentDispatchId, {
      status: 'working',
      result_summary: `Team progress: ${done}/${total} done${failed > 0 ? `, ${failed} failed` : ''}`,
      completed_at: null,
      error: failed > 0 ? `${failed} specialist run(s) failed` : null,
    })
    return
  }

  const anyFailed = failed > 0
  const shouldAutoApprove = !anyFailed && readAutoApprove()
  const finalStatus = shouldAutoApprove ? 'done' : 'needs_review'
  const summary = mergeTeamSummary(children)
  const totalTokens = children.reduce((sum, c) => sum + (c.token_count || 0), 0)

  // Skip duplicate terminal updates
  if (parent.status === finalStatus && parent.completed_at && parent.result_summary === summary) return

  updateDispatch(parentDispatchId, {
    status: finalStatus,
    result_summary: summary,
    token_count: totalTokens,
    error: anyFailed ? `${failed} specialist run(s) failed` : null,
    completed_at: now,
    next_retry_at: null,
    worker_id: null,
    heartbeat_at: null,
  })

  if (parent.task_id) {
    const metadata = metadataForDispatch(parent, parentDispatchId)
    if (shouldAutoApprove) {
      createTaskActivity(parent.task_id, 'dispatch_approved', summary, parent.agent_id, metadata)
      updateTask(parent.task_id, { status: 'done' })
    } else {
      const msg = anyFailed
        ? `Team run completed with failures (${failed}/${total} failed). Review required.`
        : 'Team run completed and is awaiting review.'
      createTaskActivity(parent.task_id, 'dispatch_completed', msg, parent.agent_id, metadata)
    }
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid dispatch ID' }, { status: 400 })
  }

  const dispatch = getDispatchById(id)
  if (!dispatch) {
    return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })
  }

  const children = getChildDispatches(id)
  return NextResponse.json({ dispatch, children })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authenticateBridge(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  setSetting('dispatchBridgeLastPoll', Math.floor(Date.now() / 1000))

  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid dispatch ID' }, { status: 400 })
  }

  const dispatch = getDispatchById(id)
  if (!dispatch) {
    return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })
  }

  const body = await request.json()
  const { status, error, next_retry_at, attempt_count, session_id, worker_id, heartbeat_at } = body

  if (!status) {
    return NextResponse.json({ error: 'Missing status' }, { status: 400 })
  }

  // Validate transition
  const allowed = VALID_TRANSITIONS[dispatch.status]
  if (!allowed || !allowed.includes(status)) {
    return NextResponse.json({ error: `Invalid transition: ${dispatch.status} -> ${status}` }, { status: 400 })
  }

  const updates: Record<string, unknown> = { status }
  if (status === 'working') {
    updates.started_at = Math.floor(Date.now() / 1000)
    updates.completed_at = null
    updates.error = null
    updates.worker_id = worker_id || request.headers.get('x-bridge-worker') || dispatch.worker_id || null
    updates.heartbeat_at = heartbeat_at || Math.floor(Date.now() / 1000)
  }
  if (status === 'queued') {
    updates.started_at = null
    updates.completed_at = null
    updates.worker_id = null
    updates.heartbeat_at = null
  }
  if (['done', 'failed', 'cancelled'].includes(status)) {
    updates.completed_at = Math.floor(Date.now() / 1000)
    updates.worker_id = null
    updates.heartbeat_at = null
  }
  if (error !== undefined) updates.error = error || null
  if (next_retry_at !== undefined) updates.next_retry_at = next_retry_at || null
  if (attempt_count !== undefined) updates.attempt_count = attempt_count || 0
  if (session_id !== undefined) updates.session_id = session_id || null
  if (worker_id !== undefined) updates.worker_id = worker_id || null
  if (heartbeat_at !== undefined) updates.heartbeat_at = heartbeat_at || null

  updateDispatch(id, updates)

  // Log activity
  if (dispatch.task_id) {
    const typeMap: Record<string, string> = {
      working: 'dispatch_started',
      needs_review: 'dispatch_completed',
      done: 'dispatch_approved',
      failed: 'dispatch_failed',
      queued: 'dispatch_progress',
    }
    const actType = typeMap[status]
    if (actType) {
      const message = status === 'queued'
        ? (error ? `Dispatch #${id} re-queued: ${String(error).slice(0, 180)}` : `Dispatch #${id} re-queued`)
        : `Dispatch #${id} status: ${status}`
      const metadata = metadataForDispatch(dispatch, id)
      createTaskActivity(dispatch.task_id, actType, message, dispatch.agent_id, metadata)
    }
  }

  if (dispatch.parent_dispatch_id && ['done', 'failed', 'cancelled'].includes(status)) {
    reconcileParentTeamDispatch(dispatch.parent_dispatch_id)
  }

  // Wake the bridge immediately if this transition could unblock dep children.
  // Without this, a Gary→Ricky pipeline waits up to 30s (the bridge's poll) to
  // notice Gary finished.
  if (UNBLOCKING_STATUSES.has(status)) {
    notifyBridge({
      event: 'dispatch_completed',
      reason: 'complete',
      dispatch_id: id,
      task_id: dispatch.task_id,
      agent_id: dispatch.agent_id,
    })
  }

  return NextResponse.json({ ok: true, status })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authenticateBridge(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  setSetting('dispatchBridgeLastPoll', Math.floor(Date.now() / 1000))

  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid dispatch ID' }, { status: 400 })
  }

  const dispatch = getDispatchById(id)
  if (!dispatch) {
    return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })
  }

  const body = await request.json()
  const { action } = body

  if (action === 'log') {
    const { content } = body
    if (!content) {
      return NextResponse.json({ error: 'Missing content' }, { status: 400 })
    }
    if (dispatch.task_id) {
      const metadata = metadataForDispatch(dispatch, id)
      createTaskActivity(dispatch.task_id, 'dispatch_progress', content, dispatch.agent_id, metadata)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'heartbeat') {
    if (dispatch.status !== 'working') {
      return NextResponse.json({ ok: false, error: 'Dispatch is not working' }, { status: 409 })
    }
    const now = Math.floor(Date.now() / 1000)
    setSetting('dispatchBridgeLastPoll', now)
    updateDispatch(id, {
      heartbeat_at: now,
      worker_id: request.headers.get('x-bridge-worker') || dispatch.worker_id || null,
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'complete') {
    const { result_summary, token_count, session_id, auto_approve } = body
    const isTeamChild = dispatch.run_type === 'team_child'
    const finalStatus = isTeamChild ? 'done' : (auto_approve ? 'done' : 'needs_review')

    updateDispatch(id, {
      status: finalStatus,
      result_summary: result_summary || null,
      token_count: token_count || 0,
      session_id: session_id || null,
      next_retry_at: null,
      worker_id: null,
      heartbeat_at: null,
      completed_at: Math.floor(Date.now() / 1000),
    })

    // Append agent turn to the chat thread so the UI sees the reply.
    if (result_summary && String(result_summary).trim()) {
      try {
        addDispatchMessage({
          dispatchId: id,
          role: 'agent',
          content: String(result_summary),
          tokenCount: token_count || 0,
        })
      } catch { /* non-fatal */ }
    }

    if (dispatch.task_id) {
      const metadata = metadataForDispatch(dispatch, id)
      if (isTeamChild) {
        createTaskActivity(dispatch.task_id, 'dispatch_progress', `${dispatch.agent_id} finished specialist run`, dispatch.agent_id, metadata)
      } else if (auto_approve) {
        createTaskActivity(dispatch.task_id, 'dispatch_approved', result_summary || 'Dispatch completed and auto-approved', dispatch.agent_id, metadata)
        updateTask(dispatch.task_id, { status: 'done' })
      } else {
        createTaskActivity(dispatch.task_id, 'dispatch_completed', result_summary || 'Dispatch completed, awaiting review', dispatch.agent_id, metadata)
      }
    }

    if (dispatch.parent_dispatch_id) {
      reconcileParentTeamDispatch(dispatch.parent_dispatch_id)
    }

    if (UNBLOCKING_STATUSES.has(finalStatus)) {
      notifyBridge({
        event: 'dispatch_completed',
        reason: 'complete',
        dispatch_id: id,
        task_id: dispatch.task_id,
        agent_id: dispatch.agent_id,
      })
    }

    if (isTeamChild) {
      return NextResponse.json({ ok: true, status: finalStatus })
    }

    // Send Telegram notification
    let taskTitle = `Dispatch #${id}`
    let projectName = ''
    if (dispatch.task_id) {
      const task = getTask(dispatch.task_id)
      if (task) {
        taskTitle = task.title || taskTitle
        if (task.project_id) {
          const project = getProject(task.project_id)
          if (project) projectName = project.name
        }
      }
    }
    const summary = (result_summary || 'No summary provided').slice(0, 500)
    const lines = [`📋 <b>Task Completed:</b> ${taskTitle}`]
    if (projectName) lines.push(`Project: ${projectName}`)
    if (auto_approve) {
      lines.push('', 'Status: <b>Auto-approved</b>')
    } else {
      lines.push('', 'Status: <b>Needs review</b>', 'Review in Dispatch Board → app.example.com/dispatch')
    }
    lines.push('', `<b>Result:</b>`, summary)
    await sendToTelegram(lines.join('\n'))

    return NextResponse.json({ ok: true, status: finalStatus })
  }

  if (action === 'notify') {
    const { message } = body
    if (!message) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 })
    }
    const sent = await sendToTelegram(message)
    return NextResponse.json({ ok: sent, delivered: sent })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
