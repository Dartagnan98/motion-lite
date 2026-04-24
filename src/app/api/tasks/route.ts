import { NextRequest, NextResponse } from 'next/server'
import { getTask, getTaskByPublicId, createTask, updateTask, deleteTask, getWorkspaceById, getProject, getFolders, getStages, getAllTasksEnriched, getSubtasks, getFavoriteTasks, getUserWorkspaces, syncDependencies, checkStageCompletion, getTaskChunksForTaskIds, getDb, clearTaskChunks, getProjectTasksEnriched, getRecentTasks, ensureOutreachProject } from '@/lib/db'
import { DEFAULT_TASK_VALUES } from '@/lib/task-constants'
import { fireWebhook } from '@/lib/webhook'
import { triggerRescheduleServer } from '@/lib/schedule-trigger'
import { getTaskMutationRescheduleScope, shouldTriggerTaskReschedule } from '@/lib/task-reschedule'
import { notifyTask } from '@/lib/notifications'
import { notifyUser } from '@/lib/user-notify'
import { requireAuth, getCurrentUser, getWorkspaceIdFromRequest } from '@/lib/auth'
import { isWorkspaceMember } from '@/lib/db'

function getTaskWithMeta(id: number) {
  const task = getTask(id)
  if (!task) return null

  const meta: Record<string, unknown> = {}

  if (task.workspace_id) {
    const ws = getWorkspaceById(task.workspace_id)
    if (ws) { meta.workspaceName = ws.name; meta.workspaceColor = ws.color }
  }
  if (task.project_id) {
    const project = getProject(task.project_id)
    if (project) {
      meta.projectName = project.name
      meta.projectColor = project.color
      meta.stages = getStages(project.id)
      if (project.folder_id && project.workspace_id) {
        const folders = getFolders(project.workspace_id)
        const folder = folders.find(f => f.id === project.folder_id)
        if (folder) { meta.folderName = folder.name; meta.folderColor = folder.color }
      }
      if (!meta.workspaceName && project.workspace_id) {
        const ws = getWorkspaceById(project.workspace_id)
        if (ws) { meta.workspaceName = ws.name; meta.workspaceColor = ws.color }
      }
    }
  }

  if (task.crm_contact_id) {
    const contact = getDb().prepare(
      'SELECT id, name, public_id FROM crm_contacts WHERE id = ?'
    ).get(task.crm_contact_id) as { id: number; name: string; public_id: string } | undefined
    if (contact) {
      meta.contactId = contact.id
      meta.contactName = contact.name
      meta.contactPublicId = contact.public_id
    }
  }

  const subtasks = getSubtasks(id)
  return { task, meta, subtasks }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const headerWsId = getWorkspaceIdFromRequest(request)
  if (headerWsId && !isWorkspaceMember(user.id, headerWsId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const wsFilter = headerWsId || getUserWorkspaces(user.id).map(w => w.id)

  // Return all enriched tasks for schedule view refresh
  if (request.nextUrl.searchParams.get('all') === '1') {
    const tasks = getAllTasksEnriched(wsFilter)
    const allChunks = getTaskChunksForTaskIds(tasks.map(t => t.id))
    const tasksWithChunks = tasks.map(t => ({ ...t, chunks: allChunks[t.id] || [] }))
    return NextResponse.json({ tasks: tasksWithChunks })
  }

  if (request.nextUrl.searchParams.get('recent') === '1') {
    const limit = Math.max(1, Math.min(50, Number(request.nextUrl.searchParams.get('limit')) || 8))
    return NextResponse.json({ tasks: getRecentTasks(wsFilter, limit) })
  }

  // Return favorite tasks for sidebar
  if (request.nextUrl.searchParams.get('favorites') === '1') {
    return NextResponse.json({ tasks: getFavoriteTasks(wsFilter) })
  }

  const projectId = Number(request.nextUrl.searchParams.get('projectId') || request.nextUrl.searchParams.get('project_id'))
  if (projectId) {
    const project = getProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (project.workspace_id && !isWorkspaceMember(user.id, project.workspace_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ tasks: getProjectTasksEnriched(projectId) })
  }

  const idParam = request.nextUrl.searchParams.get('id')
  let id = Number(idParam)
  if (!id || isNaN(id)) {
    // Try public_id lookup
    const task = idParam ? getTaskByPublicId(idParam) : null
    id = task?.id || 0
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const result = getTaskWithMeta(id)
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Verify workspace membership
  const taskWsId = result.task.workspace_id || (result.task.project_id ? getProject(result.task.project_id)?.workspace_id : null)
  if (taskWsId && !isWorkspaceMember(user.id, taskWsId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const fallbackWorkspaceId = getUserWorkspaces(user.id)[0]?.id
  let normalizedProjectId = body.project_id ?? body.projectId
  const normalizedStageId = body.stage_id ?? body.stageId
  const normalizedFolderId = body.folder_id ?? body.folderId
  const normalizedWorkspaceId = body.workspace_id ?? body.workspaceId ?? getWorkspaceIdFromRequest(request) ?? fallbackWorkspaceId
  const normalizedCrmContactId = body.crm_contact_id ?? body.crmContactId ?? null

  // Verify workspace membership for target workspace
  const targetWsId = normalizedWorkspaceId || (normalizedProjectId ? getProject(normalizedProjectId)?.workspace_id : null)
  if (targetWsId && !isWorkspaceMember(user.id, targetWsId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // CRM-originated tasks with no explicit project land in the "Outreach" bucket
  // so reps have a single default home for contact follow-ups.
  if (!normalizedProjectId && normalizedCrmContactId && targetWsId) {
    normalizedProjectId = ensureOutreachProject(targetWsId).id
  }

  // Apply project defaults if creating within a project
  // Use assignee from body if provided, derive from user name if not explicitly set
  let assigneeDefault = body.assignee !== undefined ? body.assignee : (() => {
    const member = getDb().prepare("SELECT public_id FROM team_members WHERE name = ? LIMIT 1").get(user.name) as { public_id: string } | undefined
    return member?.public_id || null
  })()
  let priorityDefault = body.priority || DEFAULT_TASK_VALUES.priority
  let autoScheduleDefault = body.auto_schedule
  if (normalizedProjectId) {
    const proj = getProject(normalizedProjectId)
    if (proj) {
      if (body.assignee === undefined && proj.default_assignee) assigneeDefault = proj.default_assignee
      if (!body.priority && proj.default_priority) priorityDefault = proj.default_priority
      if (body.auto_schedule === undefined && proj.auto_schedule_tasks !== undefined) autoScheduleDefault = proj.auto_schedule_tasks
    }
  }

  const task = createTask({
    title: body.title || 'Untitled Task',
    workspaceId: targetWsId || undefined,
    projectId: normalizedProjectId,
    stageId: normalizedStageId,
    folderId: normalizedFolderId,
    assignee: assigneeDefault,
    priority: priorityDefault,
    status: body.status || DEFAULT_TASK_VALUES.status,
    due_date: body.due_date,
    description: body.description,
    duration_minutes: body.duration_minutes,
    parentTaskId: body.parent_task_id,
    crmContactId: normalizedCrmContactId || undefined,
  })

  // Set extra fields if provided (including scheduling/calendar fields from drag-create)
  const extra: Record<string, unknown> = {}
  if (body.effort_level) extra.effort_level = body.effort_level
  if (autoScheduleDefault !== undefined) extra.auto_schedule = autoScheduleDefault
  if (body.is_asap !== undefined) extra.is_asap = body.is_asap
  if (body.hard_deadline !== undefined) extra.hard_deadline = body.hard_deadline
  if (body.scheduled_start !== undefined) extra.scheduled_start = body.scheduled_start || null
  if (body.scheduled_end !== undefined) extra.scheduled_end = body.scheduled_end || null
  if (body.locked_at !== undefined) extra.locked_at = body.locked_at || null
  if (body.start_date !== undefined) extra.start_date = body.start_date || null
  if (Object.keys(extra).length > 0) updateTask(task.id, extra)

  fireWebhook('task.created', { taskId: task.id, title: task.title }).catch(() => {})
  notifyTask(task.id, 'assigned', task.title)

  // Per-user task_assigned notification when the task is assigned to somebody
  // other than the creator. The assignee field stores team_members.public_id;
  // resolve to the linked user_id (team_members.user_id was backfilled during
  // the multi-tenant migration).
  try {
    if (task.assignee && targetWsId) {
      const assigneeUser = getDb().prepare(
        `SELECT u.id FROM users u
           JOIN team_members tm ON tm.user_id = u.id
          WHERE tm.public_id = ?`
      ).get(task.assignee) as { id: number } | undefined
      if (assigneeUser?.id && assigneeUser.id !== user.id) {
        notifyUser({
          user_id: assigneeUser.id,
          workspace_id: targetWsId,
          kind: 'task_assigned',
          title: `New task: ${task.title}`,
          body: task.due_date ? `Due ${task.due_date}` : null,
          href: `/projects-tasks?task=${task.id}`,
          entity: 'task',
          entity_id: task.id,
        })
      }
    }
  } catch { /* resilient */ }

  // Trigger reschedule for newly auto-scheduled tasks after creation
  const createdFields = Object.keys({ ...body, ...extra })
  const createdTask = getTask(task.id)
  if (createdTask?.auto_schedule === 1 && shouldTriggerTaskReschedule(createdFields)) {
    await triggerRescheduleServer().catch(() => {})
  }

  const result = getTaskWithMeta(task.id)
  return NextResponse.json(result)
}

export async function PATCH(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, skip_reschedule, ...data } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Verify workspace membership
  const existingTask = getTask(id)
  if (existingTask) {
    const wsId = existingTask.workspace_id || (existingTask.project_id ? getProject(existingTask.project_id)?.workspace_id : null)
    if (wsId && !isWorkspaceMember(user.id, wsId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const changedFields = Object.keys(data)
  const { shouldReschedule: shouldRescheduleUpdate } = getTaskMutationRescheduleScope(existingTask, data, changedFields)

  // Capture old blocked_by before update for dependency sync
  let oldBlockedBy: number[] = []
  if ('blocked_by' in data) {
    const oldTask = getTask(id)
    oldBlockedBy = oldTask?.blocked_by ? String(oldTask.blocked_by).split(',').map(Number).filter(Boolean) : []
  }

  // Sync workspace_id when project_id changes
  if ('project_id' in data && data.project_id) {
    const project = getProject(data.project_id)
    if (project?.workspace_id) {
      data.workspace_id = project.workspace_id
    }
  }

  updateTask(id, data)

  const explicitScheduleChanged = Object.prototype.hasOwnProperty.call(data, 'scheduled_start')
    || Object.prototype.hasOwnProperty.call(data, 'scheduled_end')

  // Any direct scheduled_start/scheduled_end edit makes the task row the source of truth.
  // Drop persisted chunks so stale auto-scheduler fragments do not override the new block.
  if (explicitScheduleChanged) {
    clearTaskChunks(id)
  }

  // Sync bidirectional dependencies if blocked_by changed
  if ('blocked_by' in data) {
    const newBlockedBy = data.blocked_by ? String(data.blocked_by).split(',').map(Number).filter(Boolean) : []
    syncDependencies(id, oldBlockedBy, newBlockedBy)
  }

  // Scheduling cleanup (terminal status, auto_schedule toggle) is handled centrally in db.updateTask()

  // Fire notification when task is completed
  if (data.status === 'done') {
    const completedTask = getTask(id)
    if (completedTask) {
      notifyTask(id, 'completed', completedTask.title)
    }
  }

  // Fire webhook for non-terminal updates (done/cancelled already handled in db.ts updateTask)
  if (data.status !== 'done' && data.status !== 'cancelled' && data.status !== 'archived') {
    fireWebhook('task.updated', { taskId: id, ...data }).catch(() => {})
  }

  // Trigger reschedule if scheduling-relevant fields changed
  // skip_reschedule: true means a manual drag-drop placement -- don't override it
  const skipReschedule = !!skip_reschedule
  const rescheduled = !skipReschedule && shouldRescheduleUpdate
  if (rescheduled) {
    await triggerRescheduleServer().catch(() => {})
  }

  const result = getTaskWithMeta(id)

  // Check for stage auto-progression when a task is marked done
  if (data.status === 'done' && result?.task?.stage_id && result?.task?.project_id) {
    const progression = checkStageCompletion(result.task.project_id, result.task.stage_id)
    if (progression.advanced) {
      // Re-fetch meta since stages changed
      const refreshed = getTaskWithMeta(id)
      return NextResponse.json({ ...refreshed, rescheduled, stageAdvanced: true, newStageName: progression.newStageName, newStageId: progression.newStageId })
    }
  }

  return NextResponse.json({ ...result, rescheduled })
}

export async function DELETE(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const task = getTask(id)
  if (task) {
    const wsId = task.workspace_id || (task.project_id ? getProject(task.project_id)?.workspace_id : null)
    if (wsId && !isWorkspaceMember(user.id, wsId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  deleteTask(id)

  fireWebhook('task.deleted', { taskId: id, title: task?.title }).catch(() => {})

  // Auto-reshuffle remaining tasks after delete
  if (task?.auto_schedule || task?.scheduled_start || task?.scheduled_end || task?.locked_at) {
    await triggerRescheduleServer().catch(() => {})
  }

  return NextResponse.json({ success: true })
}
