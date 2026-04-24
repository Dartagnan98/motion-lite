import { NextResponse } from 'next/server'
import { purgeAllTaskData, getAllTasksEnriched, getAllProjects, getUserWorkspaces } from '@/lib/db'
import { requireOwner, getCurrentUser } from '@/lib/auth'

function authError(e: unknown) {
  const msg = e instanceof Error ? e.message : ''
  if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') return authError(new Error('FORBIDDEN'))

  const workspaces = getUserWorkspaces(user.id)
  const wsIds = workspaces.map(w => w.id)
  const tasks = getAllTasksEnriched(wsIds)
  const projects = getAllProjects(wsIds)

  const exportData = {
    exported_at: new Date().toISOString(),
    tasks,
    projects,
    workspaces,
  }

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="motionlite-export-${new Date().toISOString().split('T')[0]}.json"`,
    },
  })
}

export async function DELETE() {
  try { await requireOwner() } catch (e) { return authError(e) }

  purgeAllTaskData()
  return NextResponse.json({ ok: true })
}
