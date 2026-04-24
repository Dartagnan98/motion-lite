import { NextRequest, NextResponse } from 'next/server'
import {
  getDispatchById,
  updateDispatch,
  addDispatchMessage,
  listDispatchMessages,
  getTask,
  getProject,
} from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { requireAuth } from '@/lib/auth'

// GET /api/dispatch/[id]/chat → full thread + current dispatch state
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid dispatch id' }, { status: 400 })

  const dispatch = getDispatchById(id)
  if (!dispatch) return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })

  const messages = listDispatchMessages(id)

  return NextResponse.json({
    dispatch: {
      id: dispatch.id,
      task_id: dispatch.task_id,
      task_title: dispatch.task_title || null,
      project_name: dispatch.project_name || null,
      agent_id: dispatch.agent_id,
      status: dispatch.status,
      session_id: dispatch.session_id || null,
      result_summary: dispatch.result_summary || null,
      error: dispatch.error || null,
      attempt_count: dispatch.attempt_count || 0,
      heartbeat_at: dispatch.heartbeat_at || null,
      started_at: dispatch.started_at || null,
      completed_at: dispatch.completed_at || null,
      run_type: dispatch.run_type || 'single',
    },
    messages,
  })
}

// POST /api/dispatch/[id]/chat → user appends a message, dispatch re-queues
// with session resume + new feedback. Wakes the bridge over Tailscale.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid dispatch id' }, { status: 400 })

  const dispatch = getDispatchById(id)
  if (!dispatch) return NextResponse.json({ error: 'Dispatch not found' }, { status: 404 })

  if (dispatch.run_type === 'team_parent') {
    return NextResponse.json({ error: 'Team parent dispatches cannot be chatted with directly. Use a child.' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const rawContent = typeof body.content === 'string' ? body.content.trim() : ''
  if (!rawContent) {
    return NextResponse.json({ error: 'content required' }, { status: 400 })
  }

  // Don't allow piling on while the bridge is actively working the row —
  // messages could be dropped since we overwrite `feedback`. Bridge owns the
  // row during working; queue a server-side note instead of enqueuing.
  if (dispatch.status === 'working') {
    return NextResponse.json({
      error: 'Dispatch is currently running. Wait for the agent to finish before sending a follow-up.',
    }, { status: 409 })
  }

  // Append the user turn to the thread.
  const userMessage = addDispatchMessage({
    dispatchId: id,
    role: 'user',
    content: rawContent,
  })

  // Re-queue: the bridge will resume `session_id` and see this content under
  // "Previous Feedback" in the rebuilt prompt.
  updateDispatch(id, {
    status: 'queued',
    feedback: rawContent,
    attempt_count: 0,
    next_retry_at: null,
    started_at: null,
    completed_at: null,
    worker_id: null,
    heartbeat_at: null,
    result_summary: null,
    error: null,
  })

  // Fire the webhook to wake the Mac bridge immediately (Tailscale push).
  const webhookUrl = getSetting<string>('dispatchWebhookUrl')
  if (webhookUrl) {
    let projectName: string | null = null
    let taskTitle: string | null = null
    if (dispatch.task_id) {
      const task = getTask(dispatch.task_id)
      if (task) {
        taskTitle = task.title
        if (task.project_id) {
          const project = getProject(task.project_id)
          if (project) projectName = project.name
        }
      }
    }
    const webhookToken = getSetting<string>('dispatchWebhookToken')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (webhookToken) headers['x-push-token'] = webhookToken
    fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: 'dispatch_followup',
        dispatch_id: id,
        task_id: dispatch.task_id,
        task_title: taskTitle,
        project_name: projectName,
        agent_id: dispatch.agent_id,
      }),
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, message: userMessage, status: 'queued' })
}
