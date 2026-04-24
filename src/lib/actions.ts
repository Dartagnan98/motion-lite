'use server'

import { revalidatePath } from 'next/cache'
import * as db from './db'
import { requireAuth } from './auth'
import { getTaskMutationRescheduleScope } from './task-reschedule'

// ─── Workspaces ───

export async function createWorkspaceAction(formData: FormData) {
  await requireAuth()
  const name = formData.get('name') as string
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const color = (formData.get('color') as string) || '#7a6b55'
  db.createWorkspace(name, slug, color)
  revalidatePath('/')
}

// ─── Folders ───

export async function createFolderAction(formData: FormData) {
  await requireAuth()
  const workspaceId = Number(formData.get('workspaceId'))
  const name = formData.get('name') as string
  const color = (formData.get('color') as string) || '#7a6b55'
  const parentId = formData.get('parentId') ? Number(formData.get('parentId')) : undefined
  db.createFolder(workspaceId, name, color, parentId)
  revalidatePath('/')
}

export async function updateFolderAction(formData: FormData) {
  await requireAuth()
  const id = Number(formData.get('id'))
  const name = formData.get('name') as string
  const color = formData.get('color') as string
  db.updateFolder(id, { name, color })
  revalidatePath('/')
}

export async function deleteFolderAction(formData: FormData) {
  await requireAuth()
  const id = Number(formData.get('id'))
  db.deleteFolder(id)
  revalidatePath('/')
}

// ─── Projects ───

export async function createProjectAction(formData: FormData) {
  await requireAuth()
  const workspaceId = Number(formData.get('workspaceId'))
  const folderId = formData.get('folderId') ? Number(formData.get('folderId')) : undefined
  const name = formData.get('name') as string
  const color = (formData.get('color') as string) || '#ef5350'
  db.createProject(workspaceId, name, folderId, color)
  revalidatePath('/')
}

export async function updateProjectAction(formData: FormData) {
  await requireAuth()
  const id = Number(formData.get('id'))
  const data: Record<string, string | number | null> = {}
  const name = formData.get('name') as string
  const color = formData.get('color') as string
  const status = formData.get('status') as string
  if (name) data.name = name
  if (color) data.color = color
  if (status) data.status = status
  db.updateProject(id, data)
  revalidatePath('/')
}

// ─── Stages ───

export async function createStageAction(formData: FormData) {
  await requireAuth()
  const projectId = Number(formData.get('projectId'))
  const name = formData.get('name') as string
  const color = (formData.get('color') as string) || '#ffd740'
  db.createStage(projectId, name, color)
  revalidatePath('/')
}

// ─── Tasks ───

export async function createTaskAction(formData: FormData) {
  await requireAuth()
  const title = formData.get('title') as string
  if (!title?.trim()) return
  const projectId = formData.get('projectId') ? Number(formData.get('projectId')) : undefined
  const stageId = formData.get('stageId') ? Number(formData.get('stageId')) : undefined
  const workspaceId = formData.get('workspaceId') ? Number(formData.get('workspaceId')) : undefined
  const folderId = formData.get('folderId') ? Number(formData.get('folderId')) : undefined
  const assignee = (formData.get('assignee') as string) || undefined
  const priority = (formData.get('priority') as string) || undefined
  const status = (formData.get('status') as string) || undefined
  const due_date = (formData.get('due_date') as string) || undefined
  const description = (formData.get('description') as string) || undefined
  const duration_minutes = formData.get('duration_minutes') ? Number(formData.get('duration_minutes')) : undefined
  const autoSchedule = formData.get('auto_schedule')

  const task = db.createTask({ title, projectId, stageId, workspaceId, folderId, assignee, priority, status, due_date, description, duration_minutes })
  if (autoSchedule === '1') {
    db.updateTask(task.id, { auto_schedule: 1 })
    const { triggerRescheduleServer } = await import('./schedule-trigger')
    await triggerRescheduleServer().catch(() => {})
  }
  revalidatePath('/')
}

export async function updateTaskAction(formData: FormData) {
  await requireAuth()
  const id = Number(formData.get('id'))
  const data: Record<string, unknown> = {}

  for (const [key, value] of formData.entries()) {
    if (key === 'id') continue
    if (value === '') {
      data[key] = null
    } else if (['sort_order', 'duration_minutes', 'hard_deadline', 'auto_schedule', 'completed_time_minutes', 'project_id', 'stage_id', 'workspace_id', 'folder_id', 'schedule_id'].includes(key)) {
      data[key] = Number(value)
    } else {
      data[key] = value
    }
  }

  if (data.status === 'done' && !data.completed_at) {
    data.completed_at = Math.floor(Date.now() / 1000)
  }

  const existingTask = db.getTask(id)
  db.updateTask(id, data)

  const explicitScheduleChanged = Object.prototype.hasOwnProperty.call(data, 'scheduled_start')
    || Object.prototype.hasOwnProperty.call(data, 'scheduled_end')

  if (explicitScheduleChanged) {
    db.clearTaskChunks(id)
  }

  const changedFields = Object.keys(data)
  const { shouldReschedule } = getTaskMutationRescheduleScope(existingTask, data, changedFields)

  if (shouldReschedule) {
    const { triggerRescheduleServer } = await import('./schedule-trigger')
    await triggerRescheduleServer().catch(() => {})
  }

  revalidatePath('/')
}

export async function deleteTaskAction(formData: FormData) {
  await requireAuth()
  const id = Number(formData.get('id'))
  const task = db.getTask(id)
  db.deleteTask(id)
  // Reshuffle remaining tasks after delete (await so client refreshes after)
  if (task?.auto_schedule || task?.scheduled_start || task?.scheduled_end || task?.locked_at) {
    const { triggerRescheduleServer } = await import('./schedule-trigger')
    await triggerRescheduleServer().catch(() => {})
  }
  revalidatePath('/')
}

// ─── Docs ───

export async function createDocAction(formData: FormData) {
  await requireAuth()
  const title = (formData.get('title') as string) || undefined
  const workspaceId = formData.get('workspaceId') ? Number(formData.get('workspaceId')) : undefined
  const folderId = formData.get('folderId') ? Number(formData.get('folderId')) : undefined
  const projectId = formData.get('projectId') ? Number(formData.get('projectId')) : undefined
  const color = formData.get('color') as string | null
  const doc = db.createDoc({ title, workspaceId, folderId, projectId })
  if (color && doc) db.updateDoc(doc.id, { color })
  revalidatePath('/')
}

export async function updateDocAction(formData: FormData) {
  await requireAuth()
  const id = Number(formData.get('id'))
  const title = formData.get('title') as string | undefined
  const content = formData.get('content') as string | undefined
  db.updateDoc(id, { title, content })
  revalidatePath('/')
}
