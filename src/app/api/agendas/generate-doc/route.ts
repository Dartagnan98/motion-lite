import { NextRequest, NextResponse } from 'next/server'
import { createDoc, updateDoc, getDocs, getUserWorkspaces, getAllTasksEnriched } from '@/lib/db'
import { requireOwner, getCurrentUser, getWorkspaceIdFromRequest } from '@/lib/auth'
import { formatDuration, TERMINAL_STATUSES } from '@/lib/task-constants'

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isBeforeDay(a: Date, b: Date): boolean {
  const aDay = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const bDay = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  return aDay < bDay
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const agendaTitle = `Agenda - ${dateStr}`

  const workspaces = getUserWorkspaces(user.id)
  const wsId = workspaces[0]?.id || null

  // Find existing agenda doc for today (by title and doc_type)
  const existingDocs = getDocs({ workspaceId: wsId || undefined })
  let agendaDoc = existingDocs.find(d => d.title === agendaTitle && d.doc_type === 'agenda')
  if (!agendaDoc) {
    agendaDoc = existingDocs.find(d => d.title === agendaTitle)
  }

  const headerWsId = getWorkspaceIdFromRequest(request)
  const wsFilter = headerWsId || workspaces.map(w => w.id)
  const allTasks = getAllTasksEnriched(wsFilter)
  const activeTasks = allTasks.filter((t: { status: string }) => !TERMINAL_STATUSES.includes(t.status))

  const todayTasks = activeTasks
    .filter((t: { scheduled_start: string | null; due_date: string | null }) => {
      const d = t.scheduled_start || t.due_date
      if (!d) return false
      return isSameDay(new Date(d), today)
    })
    .sort((a: { scheduled_start: string | null }, b: { scheduled_start: string | null }) => {
      const aT = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Infinity
      const bT = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Infinity
      return aT - bT
    })

  const overdueTasks = activeTasks
    .filter((t: { due_date: string | null }) => t.due_date && isBeforeDay(new Date(t.due_date), today))

  const blocks: any[] = []

  blocks.push({ id: generateId(), type: 'heading2', content: `Today's Tasks (${todayTasks.length})` })

  if (todayTasks.length === 0) {
    blocks.push({ id: generateId(), type: 'paragraph', content: 'No tasks scheduled for today.' })
  } else {
    for (const task of todayTasks) {
      const project = (task as unknown as Record<string, unknown>).project_name as string | undefined
      const duration = task.duration_minutes ? formatDuration(task.duration_minutes) : ''
      const parts = [task.title]
      if (project) parts.push(`| ${project}`)
      if (duration) parts.push(`(${duration})`)
      blocks.push({
        id: generateId(),
        type: 'checklist',
        content: parts.join(' '),
        taskId: task.id,
      })
    }
  }

  if (overdueTasks.length > 0) {
    blocks.push({ id: generateId(), type: 'heading2', content: `Past Deadline (${overdueTasks.length})` })
    for (const task of overdueTasks.slice(0, 15)) {
      const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
      blocks.push({
        id: generateId(),
        type: 'checklist',
        content: `${task.title} (due ${dueDate})`,
        taskId: task.id,
      })
    }
  }

  blocks.push({ id: generateId(), type: 'heading2', content: 'Summary' })
  blocks.push({ id: generateId(), type: 'paragraph', content: `Active tasks: ${activeTasks.length}\nToday: ${todayTasks.length}\nOverdue: ${overdueTasks.length}` })

  const content = JSON.stringify(blocks)

  if (agendaDoc) {
    updateDoc(agendaDoc.id, { content })
    return NextResponse.json({ docId: agendaDoc.id, updated: true })
  } else {
    const doc = createDoc({ title: agendaTitle, workspaceId: wsId || undefined, docType: 'agenda' })
    updateDoc(doc.id, { content })
    return NextResponse.json({ docId: doc.id, created: true })
  }
}
