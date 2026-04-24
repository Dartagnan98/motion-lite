import { NextRequest, NextResponse } from 'next/server'
import { getProject, createProject, getStages, createStage, getTasks, createTask, updateStage, getDocs, createDoc, updateDoc } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    const { projectId, name } = await req.json()
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const original = getProject(projectId)
    if (!original) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Clone project
    const newProject = createProject(
      original.workspace_id,
      name || `${original.name} (Copy)`,
      original.folder_id ?? undefined,
      original.color
    )

    // Clone stages and build id map
    const oldStages = getStages(projectId)
    const stageIdMap: Record<number, number> = {}

    for (const stage of oldStages) {
      const newStage = createStage(newProject.id, stage.name, stage.color)
      updateStage(newStage.id, { sort_order: stage.sort_order, is_active: stage.is_active })
      stageIdMap[stage.id] = newStage.id
    }

    // Clone tasks (no activities/attachments)
    const oldTasks = getTasks({ projectId })
    for (const task of oldTasks) {
      createTask({
        title: task.title,
        description: task.description ?? undefined,
        projectId: newProject.id,
        stageId: task.stage_id ? stageIdMap[task.stage_id] : undefined,
        workspaceId: task.workspace_id ?? undefined,
        folderId: task.folder_id ?? undefined,
        assignee: task.assignee ?? undefined,
        priority: task.priority,
        status: task.status,
        due_date: task.due_date ?? undefined,
        duration_minutes: task.duration_minutes,
      })
    }

    // Clone docs
    const oldDocs = getDocs({ projectId })
    for (const doc of oldDocs) {
      const newDoc = createDoc({
        title: doc.title,
        workspaceId: doc.workspace_id ?? undefined,
        folderId: doc.folder_id ?? undefined,
        projectId: newProject.id,
      })
      if (doc.content) {
        updateDoc(newDoc.id, { content: doc.content })
      }
    }

    const newStages = getStages(newProject.id)
    return NextResponse.json({ project: newProject, stages: newStages })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
