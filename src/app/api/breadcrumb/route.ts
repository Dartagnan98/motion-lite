import { NextRequest, NextResponse } from 'next/server'
import { getProject, getDoc, getWorkspaceById, getFolders, getFolder, getDocBreadcrumb, getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

function resolveId(table: string, param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  const row = getDb().prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(param) as { id: number } | undefined
  return row?.id || null
}

function walkFolderChain(folderId: number): { label: string; icon: string }[] {
  const chain: { label: string; icon: string }[] = []
  let currentId: number | null = folderId
  while (currentId) {
    const folder = getFolder(currentId)
    if (!folder) break
    chain.unshift({ label: folder.name, icon: 'folder' })
    currentId = folder.parent_id
  }
  return chain
}

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const path = req.nextUrl.searchParams.get('path') || ''
  const crumbs: { label: string; icon: string; href?: string }[] = []

  // /project/123 or /project/wsId/123 (supports public_id)
  const projectMatch = path.match(/^\/project\/(?:([^/]+)\/)?([^/]+)/)
  if (projectMatch) {
    const projectId = resolveId('projects', projectMatch[2] || projectMatch[1])
    const project = projectId ? getProject(projectId) : null
    if (project) {
      const ws = getWorkspaceById(project.workspace_id)
      if (ws) crumbs.push({ label: ws.name, icon: 'workspace', href: `/workspace/${ws.public_id}` })
      if (project.folder_id) {
        const folderCrumbs = walkFolderChain(project.folder_id)
        crumbs.push(...folderCrumbs.map(f => ({ ...f, href: ws ? `/workspace/${ws.public_id}` : `/workspace/${project.workspace_id}` })))
      }
      crumbs.push({ label: project.name, icon: 'project' })
    }
    return NextResponse.json(crumbs)
  }

  // /doc/123 or /doc/workspaceId/123 (supports public_id)
  const docMatch = path.match(/^\/doc\/(?:([^/]+)\/)?([^/]+)/)
  if (docMatch) {
    const docId = resolveId('docs', docMatch[2] || docMatch[1])
    const doc = docId ? getDoc(docId) : null
    if (doc) {
      let docWs: any = null
      if (doc.workspace_id) {
        docWs = getWorkspaceById(doc.workspace_id)
        if (docWs) crumbs.push({ label: docWs.name, icon: 'workspace', href: `/workspace/${docWs.public_id}` })
      }
      // Walk folder hierarchy - link to workspace navigate view
      if (doc.folder_id) {
        const folderCrumbs = walkFolderChain(doc.folder_id)
        crumbs.push(...folderCrumbs.map(f => ({ ...f, href: docWs ? `/workspace/${docWs.public_id}` : '/projects-tasks' })))
      }
      if (doc.project_id) {
        const project = getProject(doc.project_id)
        if (project) {
          crumbs.push({ label: project.name, icon: 'project', href: `/project/${project.public_id}` })
        }
      }
      crumbs.push({ label: doc.title || 'Untitled', icon: 'doc' })
    }
    return NextResponse.json(crumbs)
  }

  // /workspace/123 (supports public_id)
  const wsMatch = path.match(/^\/workspace\/([^/]+)/)
  if (wsMatch) {
    const wsId = resolveId('workspaces', wsMatch[1])
    const ws = wsId ? getWorkspaceById(wsId) : null
    if (ws) crumbs.push({ label: ws.name, icon: 'workspace' })
    return NextResponse.json(crumbs)
  }

  // Top-level pages
  if (path === '/schedule') crumbs.push({ label: 'Calendar', icon: 'calendar' })
  else if (path === '/dashboard') crumbs.push({ label: 'Dashboard', icon: 'dashboard' })
  else if (path === '/projects-tasks') crumbs.push({ label: 'Projects & Tasks', icon: 'projects' })
  else if (path === '/settings') crumbs.push({ label: 'Settings', icon: 'settings' })

  return NextResponse.json(crumbs)
}
