import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  getUserWorkspaces,
  getProjects,
  getAllTasksEnriched,
  getMsgChannels,
  getTeamMembers,
  getDocs,
  getDb,
} from '@/lib/db'

/**
 * GET /api/agent/context
 *
 * Returns a comprehensive context snapshot for AI agents acting on behalf of a user.
 * Includes: user profile, workspaces, active workspace data (tasks, projects, channels, members),
 * recent DMs, and upcoming calendar data.
 *
 * Headers:
 * - x-internal-token: Required for agent auth
 * - x-user-id: User to act as (defaults to 1)
 * - x-workspace-id: Optional workspace to scope to (defaults to primary)
 */
export async function GET(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  try {
    // Get all user workspaces
    const workspaces = getUserWorkspaces(user.id)

    // Determine active workspace
    const wsIdHeader = request.headers.get('x-workspace-id')
    let activeWorkspaceId: number
    if (wsIdHeader) {
      activeWorkspaceId = parseInt(wsIdHeader, 10)
    } else {
      const primary = workspaces.find((w: any) => w.is_primary === 1)
      activeWorkspaceId = primary ? primary.id : workspaces[0]?.id || 0
    }

    // Get workspace-scoped data
    const projects = activeWorkspaceId ? getProjects(activeWorkspaceId) : []
    const tasks = activeWorkspaceId ? getAllTasksEnriched(activeWorkspaceId) : []
    const channels = activeWorkspaceId ? getMsgChannels(activeWorkspaceId) : []
    const members = getTeamMembers()
    const docs = activeWorkspaceId ? getDocs({ workspaceId: activeWorkspaceId }) : []

    // Calendar events for next 7 days
    let meetings: any[] = []
    try {
      const db = getDb()
      const nowIso = new Date().toISOString()
      const weekAheadIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString()
      meetings = db.prepare(
        'SELECT id, title, start_time, end_time, location FROM calendar_events WHERE start_time >= ? AND start_time <= ? ORDER BY start_time LIMIT 20'
      ).all(nowIso, weekAheadIso) as any[]
    } catch { /* calendar_events may not exist or be empty */ }

    // Task summary
    const tasksByStatus = {
      todo: tasks.filter((t: any) => t.status === 'todo').length,
      in_progress: tasks.filter((t: any) => t.status === 'in_progress').length,
      done: tasks.filter((t: any) => t.status === 'done').length,
      blocked: tasks.filter((t: any) => t.status === 'blocked').length,
    }

    // Overdue tasks
    const now = Math.floor(Date.now() / 1000)
    const overdueTasks = tasks.filter((t: any) => {
      if (t.status === 'done') return false
      if (!t.due_date) return false
      const dueEpoch = typeof t.due_date === 'number' ? t.due_date : new Date(t.due_date).getTime() / 1000
      return dueEpoch < now
    }).map((t: any) => ({ id: t.id, title: t.title, due_date: t.due_date, priority: t.priority, project: t.project_name }))

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      workspaces: workspaces.map((w: any) => ({
        id: w.id,
        name: w.name,
        is_primary: w.is_primary,
        is_private: w.is_private,
      })),
      active_workspace_id: activeWorkspaceId,
      projects: projects.map((p: any) => ({ id: p.id, name: p.name, status: p.status })),
      task_summary: tasksByStatus,
      overdue_tasks: overdueTasks,
      channels: channels.map((c: any) => ({ id: c.id, name: c.name, type: c.type })),
      team_members: members.map((m: any) => ({ id: m.id, name: m.name, user_id: m.user_id })),
      docs_count: docs.length,
      upcoming_meetings: meetings.slice(0, 10).map((m: any) => ({
        id: m.id,
        title: m.title,
        start_time: m.start_time,
        end_time: m.end_time,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
