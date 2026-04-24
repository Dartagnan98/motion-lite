import { NextRequest, NextResponse } from 'next/server'
import { buildSidebarTree, getUserWorkspaces, isWorkspaceMember, getProjects, getFolders, getTasks, getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { TERMINAL_STATUSES } from '@/lib/task-constants'

function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  return row?.id || null
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = resolveId('workspaces', request.nextUrl.searchParams.get('workspaceId')) || 0

  // If workspaceId provided, verify membership then return tree nodes
  if (workspaceId) {
    if (!isWorkspaceMember(user.id, workspaceId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const tree = buildSidebarTree(workspaceId)
    return NextResponse.json(tree)
  }

  // No workspaceId: return only user's workspaces with folders/projects
  const workspaces = getUserWorkspaces(user.id)
  // Exclude folders belonging to client_profiles (only businesses get sidebar folders)
  const clientProfileFolderIds = new Set(
    (getDb().prepare('SELECT folder_id FROM client_profiles WHERE folder_id IS NOT NULL').all() as { folder_id: number }[]).map(r => r.folder_id)
  )
  const result = workspaces.map(ws => {
    const projects = getProjects(ws.id)
    const allFolders = getFolders(ws.id).filter(f => !clientProfileFolderIds.has(f.id))
    const allTasks = getTasks({ workspaceId: ws.id })
    const activeTasks = allTasks.filter(t => !TERMINAL_STATUSES.includes(t.status))

    // Get all docs for this workspace
    const allDocs = getDb().prepare('SELECT id, public_id, folder_id, title FROM docs WHERE workspace_id = ? ORDER BY title').all(ws.id) as { id: number; public_id: string; folder_id: number | null; title: string }[]

    // Only show top-level folders (no parent) and nest sub-folders inside them
    const topFolders = allFolders.filter(f => !(f as any).parent_id)

    const buildFolderData = (folder: typeof allFolders[0]): any => {
      const subFolders = allFolders.filter(f => (f as any).parent_id === folder.id)
      const folderDocs = allDocs.filter(d => d.folder_id === folder.id)
      return {
        id: folder.id,
        public_id: (folder as any).public_id,
        name: folder.name,
        color: folder.color,
        subFolders: subFolders.map(sf => buildFolderData(sf)),
        projects: projects
          .filter(p => p.folder_id === folder.id && !p.archived)
          .map(p => ({
            id: p.id,
            public_id: p.public_id,
            name: p.name,
            color: p.color,
            taskCount: activeTasks.filter(t => t.project_id === p.id).length,
          })),
        docs: folderDocs.map(d => ({
          id: d.id,
          public_id: d.public_id,
          title: d.title,
        })),
      }
    }

    const folderData = topFolders.map(f => buildFolderData(f))

    const rootProjects = projects
      .filter(p => !p.folder_id && !p.archived)
      .map(p => ({
        id: p.id,
        public_id: p.public_id,
        name: p.name,
        color: p.color,
        taskCount: activeTasks.filter(t => t.project_id === p.id).length,
      }))

    // Get sheets for this workspace
    const allSheets = getDb().prepare('SELECT id, public_id, name, folder_id, color FROM sheets WHERE workspace_id = ? ORDER BY name').all(ws.id) as { id: number; public_id: string; name: string; folder_id: number | null; color: string | null }[]
    const rootSheets = allSheets
      .filter(s => !s.folder_id)
      .map(s => ({
        id: s.id,
        public_id: s.public_id,
        name: s.name,
        color: s.color || '#6b7280',
      }))

    // Root docs (not in a folder or project)
    const rootDocs = allDocs
      .filter(d => !d.folder_id)
      .map(d => ({
        id: d.id,
        public_id: d.public_id,
        title: d.title,
      }))

    return {
      id: ws.id,
      public_id: ws.public_id,
      name: ws.name,
      color: ws.color,
      taskCount: activeTasks.length,
      folders: folderData,
      projects: rootProjects,
      sheets: rootSheets,
      docs: rootDocs,
    }
  })

  return NextResponse.json(result)
}
