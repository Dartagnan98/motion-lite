import { NextRequest, NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import { getDb, ensurePrivateWorkspaceForUser, ensureFolder, getDocs, createDoc, updateDoc, getUserWorkspaces } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { formatDuration } from '@/lib/task-constants'

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDayTitle(d: Date): string {
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

function formatFullDate(d: Date): string {
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`
}

interface TaskRow {
  id: number
  title: string
  status: string
  priority: string
  due_date: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  duration_minutes: number | null
  project_id: number | null
}

interface ProjectRow {
  id: number
  name: string
}

function getTasksForDate(db: Database.Database, dateStr: string, wsIds: number[]): TaskRow[] {
  if (wsIds.length === 0) return []
  const placeholders = wsIds.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, title, status, priority, due_date, scheduled_start, scheduled_end, duration_minutes, project_id
    FROM tasks
    WHERE date(scheduled_start) = ?
      AND status NOT IN ('done', 'cancelled', 'archived')
      AND workspace_id IN (${placeholders})
    ORDER BY scheduled_start ASC, priority DESC
  `).all(dateStr, ...wsIds) as TaskRow[]
}

function getOverdueTasks(db: Database.Database, dateStr: string, wsIds: number[]): TaskRow[] {
  if (wsIds.length === 0) return []
  const placeholders = wsIds.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, title, status, priority, due_date, scheduled_start, scheduled_end, duration_minutes, project_id
    FROM tasks
    WHERE due_date < ?
      AND status NOT IN ('done', 'cancelled', 'archived')
      AND workspace_id IN (${placeholders})
    ORDER BY due_date ASC
  `).all(dateStr, ...wsIds) as TaskRow[]
}

function getTasksInRange(db: Database.Database, startDate: string, endDate: string, wsIds: number[]): TaskRow[] {
  if (wsIds.length === 0) return []
  const placeholders = wsIds.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, title, status, priority, due_date, scheduled_start, scheduled_end, duration_minutes, project_id
    FROM tasks
    WHERE date(scheduled_start) >= ? AND date(scheduled_start) <= ?
      AND status NOT IN ('done', 'cancelled', 'archived')
      AND workspace_id IN (${placeholders})
    ORDER BY scheduled_start ASC
  `).all(startDate, endDate, ...wsIds) as TaskRow[]
}

function getProjectName(db: Database.Database, projectId: number | null): string {
  if (!projectId) return ''
  const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined
  return p?.name || ''
}

function buildAgendaBlocks(db: Database.Database, date: Date, dateStr: string, wsIds: number[]) {
  const blocks: { id: string; type: string; content: string; checked?: boolean; taskId?: number }[] = []

  // Today's Tasks
  const todayTasks = getTasksForDate(db, dateStr, wsIds)
  blocks.push({ id: generateId(), type: 'heading2', content: "Today's Tasks" })
  if (todayTasks.length === 0) {
    blocks.push({ id: generateId(), type: 'paragraph', content: 'No tasks scheduled for today.' })
  } else {
    for (const t of todayTasks) {
      const dur = t.duration_minutes ? formatDuration(t.duration_minutes) : ''
      const proj = getProjectName(db, t.project_id)
      let label = t.title
      if (dur) label += ` (${dur})`
      if (proj) label += ` -- ${proj}`
      blocks.push({ id: generateId(), type: 'check_list', content: label, checked: false, taskId: t.id })
    }
  }

  // Tasks Past Deadline
  const overdue = getOverdueTasks(db, dateStr, wsIds)
  if (overdue.length > 0) {
    blocks.push({ id: generateId(), type: 'divider', content: '' })
    blocks.push({ id: generateId(), type: 'heading2', content: 'Tasks Past Deadline' })
    for (const t of overdue) {
      const dueLabel = t.due_date ? new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
      const proj = getProjectName(db, t.project_id)
      let label = t.title
      if (dueLabel) label += ` (was due ${dueLabel})`
      if (proj) label += ` -- ${proj}`
      blocks.push({ id: generateId(), type: 'check_list', content: label, checked: false, taskId: t.id })
    }
  }

  // This Week (remaining days)
  const dayOfWeek = date.getDay() // 0=Sun
  const daysUntilEndOfWeek = 6 - dayOfWeek // days until Saturday
  if (daysUntilEndOfWeek > 0) {
    const nextDay = new Date(date)
    nextDay.setDate(nextDay.getDate() + 1)
    const endOfWeek = new Date(date)
    endOfWeek.setDate(endOfWeek.getDate() + daysUntilEndOfWeek)

    const nextDayStr = nextDay.toISOString().split('T')[0]
    const endOfWeekStr = endOfWeek.toISOString().split('T')[0]

    const weekTasks = getTasksInRange(db, nextDayStr, endOfWeekStr, wsIds)
    if (weekTasks.length > 0) {
      blocks.push({ id: generateId(), type: 'divider', content: '' })
      blocks.push({ id: generateId(), type: 'heading2', content: 'This Week' })

      // Group by date
      const byDate: Record<string, TaskRow[]> = {}
      for (const t of weekTasks) {
        const d = t.scheduled_start ? t.scheduled_start.split('T')[0] : ''
        if (!d) continue
        if (!byDate[d]) byDate[d] = []
        byDate[d].push(t)
      }

      const sortedDates = Object.keys(byDate).sort()
      for (const d of sortedDates) {
        const dayDate = new Date(d + 'T00:00:00')
        blocks.push({ id: generateId(), type: 'heading3', content: formatDayTitle(dayDate) })
        for (const t of byDate[d]) {
          const dur = t.duration_minutes ? formatDuration(t.duration_minutes) : ''
          const proj = getProjectName(db, t.project_id)
          let label = t.title
          if (dur) label += ` (${dur})`
          if (proj) label += ` -- ${proj}`
          blocks.push({ id: generateId(), type: 'check_list', content: label, checked: false, taskId: t.id })
        }
      }
    }
  }

  return blocks
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dateParam = request.nextUrl.searchParams.get('date')
  if (!dateParam) {
    return NextResponse.json({ error: 'date parameter required (YYYY-MM-DD)' }, { status: 400 })
  }

  const date = new Date(dateParam + 'T00:00:00')
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
  }

  const year = date.getFullYear().toString()
  const month = MONTHS[date.getMonth()]
  const dayTitle = formatDayTitle(date)

  // 1. Ensure private workspace
  const ws = ensurePrivateWorkspaceForUser(user.id)

  // 2. Ensure folder hierarchy: Agenda > Year > Month
  const agendaFolder = ensureFolder(ws.id, 'Agenda')
  const yearFolder = ensureFolder(ws.id, year, agendaFolder.id)
  const monthFolder = ensureFolder(ws.id, month, yearFolder.id)

  // 3. Find or create daily doc
  const existingDocs = getDocs({ folderId: monthFolder.id })
  let dailyDoc = existingDocs.find(d => d.title === dayTitle)

  // Get DB connection for task queries, scoped to user's workspaces
  const db = getDb()
  const userWorkspaces = getUserWorkspaces(user.id)
  const wsIds = userWorkspaces.map(w => w.id)

  const blocks = buildAgendaBlocks(db, date, dateParam, wsIds)
  const content = JSON.stringify(blocks)

  // sort_order = day of month so agenda docs sort chronologically
  const sortOrder = date.getDate()

  if (!dailyDoc) {
    dailyDoc = createDoc({
      title: dayTitle,
      workspaceId: ws.id,
      folderId: monthFolder.id,
    })
    updateDoc(dailyDoc.id, { content, sort_order: sortOrder }, 'agenda')
  } else {
    // Update existing doc with fresh task data + fix sort order
    updateDoc(dailyDoc.id, { content, sort_order: sortOrder }, 'agenda')
  }

  return NextResponse.json({
    docId: dailyDoc.public_id || dailyDoc.id,
    breadcrumb: [
      { label: ws.name, type: 'workspace' },
      { label: 'Agenda', type: 'folder', id: agendaFolder.id },
      { label: year, type: 'folder', id: yearFolder.id },
      { label: month, type: 'folder', id: monthFolder.id },
      { label: dayTitle, type: 'doc', id: dailyDoc.id },
    ],
  })
}
