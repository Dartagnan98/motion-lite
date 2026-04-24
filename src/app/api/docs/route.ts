import { NextRequest, NextResponse } from 'next/server'
import { getDoc, getDocByPublicId, getDocs, createDoc, updateDoc, deleteDoc, getDocVersions, getDocVersion, getDocBreadcrumb, getProject, getFolder, getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { isWorkspaceMember } from '@/lib/db'

function resolveDocId(param: string | null): number | null {
  if (!param) return null
  const num = Number(param)
  if (!isNaN(num) && num > 0) return num
  // Try public_id lookup
  const doc = getDocByPublicId(param)
  return doc?.id || null
}

type DocBlock = {
  id?: string
  type?: string
  content?: string
  taskId?: number
  [key: string]: unknown
}

type LinkedTaskRow = {
  id: number
  title: string
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeText(value: string): string {
  return stripHtml(value).toLowerCase()
}

function getMeetingRawTitle(title: string): string {
  return title.replace(/\s*\([A-Z][a-z]{2}\s+\d{1,2}\)\s*$/, '').trim()
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function injectMeetingTaskIds<T extends { doc_type: string | null; title: string; content: string; workspace_id: number | null }>(doc: T): T {
  if (doc.doc_type !== 'meeting-note' || !doc.content || !doc.workspace_id) return doc

  let blocks: DocBlock[]
  try {
    const parsed = JSON.parse(doc.content)
    if (!Array.isArray(parsed)) return doc
    blocks = parsed as DocBlock[]
  } catch {
    return doc
  }

  const rawTitle = getMeetingRawTitle(doc.title)
  if (!rawTitle) return doc

  const escapedRawTitle = escapeLike(rawTitle)
  const tasks = getDb().prepare(`
    SELECT id, title
    FROM tasks
    WHERE description IS NOT NULL
      AND description LIKE ? ESCAPE '\\'
  `).all(`%\\_From meeting: ${escapedRawTitle}\\_%`) as LinkedTaskRow[]

  if (tasks.length === 0) return doc

  // When duplicate titles exist, prefer the most recently created task (highest id)
  const taskIdByTitle = new Map<string, number>()
  for (const task of tasks) {
    const key = task.title.toLowerCase().trim()
    const existing = taskIdByTitle.get(key)
    if (!existing || task.id > existing) {
      taskIdByTitle.set(key, task.id)
    }
  }
  let changed = false

  const nextBlocks = blocks.map((block) => {
    const blockType = block.type === 'checklist' ? 'check_list' : block.type
    if (blockType !== 'check_list' || typeof block.content !== 'string') return block
    const normalized = normalizeText(block.content)
    // Try exact match first
    let taskId = taskIdByTitle.get(normalized)
    // Try stripping suffixes like " -- Assignee (Deadline)" or " (30m)"
    if (!taskId) {
      const stripped = normalized.replace(/\s*--\s*.+$/, '').replace(/\s*\(\d+m?\)$/, '').trim()
      taskId = taskIdByTitle.get(stripped)
    }
    // Try startsWith match (block content may have extra info appended)
    if (!taskId) {
      for (const [title, id] of taskIdByTitle) {
        if (normalized.startsWith(title) || title.startsWith(normalized)) {
          taskId = id
          break
        }
      }
    }
    if (!taskId || block.taskId === taskId) return block
    changed = true
    return { ...block, taskId }
  })

  if (!changed) return doc
  return { ...doc, content: JSON.stringify(nextBlocks) }
}

export async function GET(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = resolveDocId(request.nextUrl.searchParams.get('id'))
  if (id) {
    // Verify workspace membership for single doc access
    const docCheck = getDoc(id)
    if (docCheck?.workspace_id && !isWorkspaceMember(user.id, docCheck.workspace_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Check for version history request
    const versions = request.nextUrl.searchParams.get('versions')
    if (versions === 'true') return NextResponse.json(getDocVersions(id))
    const versionId = Number(request.nextUrl.searchParams.get('versionId'))
    if (versionId) return NextResponse.json(getDocVersion(versionId))
    const breadcrumbParam = request.nextUrl.searchParams.get('breadcrumb')
    if (breadcrumbParam === 'true') {
      const rawDoc = getDoc(id)
      const doc = rawDoc ? injectMeetingTaskIds(rawDoc) : null
      if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // Persist injected taskIds so they don't need re-injection on next load
      if (rawDoc && doc.content !== rawDoc.content) {
        updateDoc(id, { content: doc.content })
      }
      const breadcrumb = getDocBreadcrumb(id)
      // Resolve inherited color from parent project or folder
      let parentColor: string | null = null
      if (doc.project_id) {
        const project = getProject(doc.project_id)
        if (project?.color) parentColor = project.color
      }
      if (!parentColor && doc.folder_id) {
        const folder = getFolder(doc.folder_id)
        if (folder?.color) parentColor = folder.color
      }
      return NextResponse.json({ ...doc, breadcrumb, parentColor })
    }
    const rawDoc = getDoc(id)
    const doc = rawDoc ? injectMeetingTaskIds(rawDoc) : null
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Persist injected taskIds so they don't need re-injection on next load
    if (rawDoc && doc.content !== rawDoc.content) {
      updateDoc(id, { content: doc.content })
    }
    return NextResponse.json(doc)
  }
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ? Number(request.nextUrl.searchParams.get('workspaceId')) : undefined
  const folderId = request.nextUrl.searchParams.get('folderId') ? Number(request.nextUrl.searchParams.get('folderId')) : undefined
  const projectId = request.nextUrl.searchParams.get('projectId') ? Number(request.nextUrl.searchParams.get('projectId')) : undefined
  const search = request.nextUrl.searchParams.get('search') || undefined
  const limit = request.nextUrl.searchParams.get('limit') ? Number(request.nextUrl.searchParams.get('limit')) : undefined
  const businessId = request.nextUrl.searchParams.get('business_id') ? Number(request.nextUrl.searchParams.get('business_id')) : undefined
  const docType = request.nextUrl.searchParams.get('doc_type') || undefined
  if (workspaceId && !isWorkspaceMember(user.id, workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Business-scoped or doc_type-scoped query
  if (businessId || docType) {
    const conditions: string[] = []
    const vals: unknown[] = []
    if (businessId) { conditions.push('business_id = ?'); vals.push(businessId) }
    if (docType) { conditions.push('doc_type = ?'); vals.push(docType) }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const docs = getDb().prepare(`SELECT * FROM docs ${where} ORDER BY created_at DESC LIMIT ?`).all(...vals, limit || 50)
    return NextResponse.json(docs)
  }
  return NextResponse.json(getDocs({ workspaceId, folderId, projectId, search, limit }))
}

export async function POST(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  if (body.workspace_id && !isWorkspaceMember(user.id, body.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const doc = createDoc(body)
  return NextResponse.json(doc)
}

export async function PATCH(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { id, ...data } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const existingDoc = getDoc(id)
  if (existingDoc?.workspace_id && !isWorkspaceMember(user.id, existingDoc.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const doc = updateDoc(id, data)
  return NextResponse.json(doc)
}

export async function DELETE(request: NextRequest) {
  let user
  try { user = await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const existingDoc = getDoc(id)
  if (existingDoc?.workspace_id && !isWorkspaceMember(user.id, existingDoc.workspace_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    deleteDoc(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
