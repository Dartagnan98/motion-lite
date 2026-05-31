import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

// Stub for the lite fork: the original /today page was wired to a CRM-backed
// endpoint that bundled tasks + appointments + unread conversations. CRM and
// messaging surface area was stripped, so this returns:
//   - tasks bucketed from local SQLite (overdue / today / upcoming / unscheduled)
//   - empty appointments and conversations.unread (the matching UI sections
//     gracefully render "All caught up" / "No appointments this week")
// Response is wrapped in `{ data, error }` because the page calls it via
// `crmFetch`, which unwraps `data` and throws on `error`.

interface TaskRow {
  id: number
  public_id: string | null
  title: string
  status: string
  priority: string
  due_date: string | null
  assignee: string | null
  crm_contact_id: number | null
  workspace_id: number | null
  project_id: number | null
}

function todayInLocalTz(): string {
  // YYYY-MM-DD in the server's local timezone (en-CA happens to format that way).
  return new Date().toLocaleDateString('en-CA')
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDb()
  const today = todayInLocalTz()

  const open = db.prepare(
    `SELECT id, public_id, title, status, priority, due_date, assignee,
            crm_contact_id, workspace_id, project_id
     FROM tasks
     WHERE status NOT IN ('done','cancelled','archived')
       AND (deleted_at IS NULL OR deleted_at = '')
     ORDER BY
       CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
       due_date ASC,
       priority = 'urgent' DESC,
       priority = 'high' DESC,
       id DESC`
  ).all() as TaskRow[]

  const overdue: (TaskRow & { contact_name: string | null })[] = []
  const todays: (TaskRow & { contact_name: string | null })[] = []
  const upcoming: (TaskRow & { contact_name: string | null })[] = []
  const unscheduled: (TaskRow & { contact_name: string | null })[] = []

  for (const t of open) {
    const row = { ...t, contact_name: null }
    if (!t.due_date) {
      unscheduled.push(row)
    } else if (t.due_date < today) {
      overdue.push(row)
    } else if (t.due_date === today) {
      todays.push(row)
    } else {
      upcoming.push(row)
    }
  }

  return NextResponse.json({
    data: {
      tasks: { overdue, today: todays, upcoming, unscheduled },
      appointments: { today: [], rest_of_week: [] },
      conversations: { unread: [] },
    },
    error: null,
  })
}
