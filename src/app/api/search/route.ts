import { NextRequest, NextResponse } from 'next/server'
import { getTasks, getDocs, getProjects, getFolders, getUserWorkspaces } from '@/lib/db'
import type { Task, Doc, Project, Folder } from '@/lib/types'
import { getCurrentUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = (request.nextUrl.searchParams.get('q') || '').toLowerCase().trim()
  if (!q) return NextResponse.json({ tasks: [], docs: [], projects: [], folders: [] })

  // Only search across user's workspaces
  const workspaces = getUserWorkspaces(user.id)
  if (workspaces.length === 0) return NextResponse.json({ tasks: [], docs: [], projects: [], folders: [] })

  // Aggregate results across all user's workspaces
  let allTasks: Task[] = []
  let allDocs: Doc[] = []
  let allProjects: Project[] = []
  let allFolders: Folder[] = []

  for (const ws of workspaces) {
    allTasks = allTasks.concat(getTasks({ workspaceId: ws.id }))
    allDocs = allDocs.concat(getDocs({ workspaceId: ws.id }))
    allProjects = allProjects.concat(getProjects(ws.id))
    allFolders = allFolders.concat(getFolders(ws.id))
  }

  const tasks = allTasks.filter((t: Task) =>
    t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
  ).slice(0, 10)

  const docs = allDocs.filter((d: Doc) =>
    d.title.toLowerCase().includes(q) || d.content?.toLowerCase().includes(q)
  ).slice(0, 5)

  const projects = allProjects.filter((p: Project) =>
    p.name.toLowerCase().includes(q)
  ).slice(0, 5)

  const folders = allFolders.filter((f: Folder) =>
    f.name.toLowerCase().includes(q)
  ).slice(0, 5)

  return NextResponse.json({ tasks, docs, projects, folders })
}
