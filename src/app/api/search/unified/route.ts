import { type NextRequest } from 'next/server'
import { getDb, getTasks, getDocs, getProjects, getFolders } from '@/lib/db'
import type { Task, Doc, Project, Folder } from '@/lib/types'
import { jsonData, requireCrmWorkspace } from '@/lib/crm-api'

/**
 * Unified cross-entity search for the ⌘K / global palette. Fans out to
 * contacts, companies, opportunities, booking pages, tasks, docs, projects,
 * and folders scoped to the caller's active workspace. Returns a flat list of
 * UnifiedHit so palettes can group by kind without a second request.
 */

export type UnifiedKind =
  | 'contact'
  | 'company'
  | 'opportunity'
  | 'booking_page'
  | 'task'
  | 'doc'
  | 'project'
  | 'folder'

export interface UnifiedHit {
  kind: UnifiedKind
  id: number
  title: string
  subtitle: string
  href: string
}

export async function GET(request: NextRequest) {
  const auth = await requireCrmWorkspace(request)
  if ('errorResponse' in auth) return auth.errorResponse

  const q = (new URL(request.url).searchParams.get('q') || '').trim()
  if (q.length < 2) return jsonData({ hits: [] })
  const like = `%${q.toLowerCase()}%`
  const ql = q.toLowerCase()
  const d = getDb()
  const hits: UnifiedHit[] = []

  // --- Contacts (6) ---
  const contacts = d.prepare(`
    SELECT id, name, email, phone, company
    FROM crm_contacts
    WHERE workspace_id = ?
      AND (LOWER(name) LIKE ? OR LOWER(COALESCE(email, '')) LIKE ? OR LOWER(COALESCE(phone, '')) LIKE ? OR LOWER(COALESCE(company, '')) LIKE ?)
    ORDER BY
      CASE WHEN LOWER(name) LIKE ? THEN 0 ELSE 1 END,
      updated_at DESC
    LIMIT 6
  `).all(auth.workspaceId, like, like, like, like, like) as Array<{ id: number; name: string; email: string | null; phone: string | null; company: string | null }>
  for (const row of contacts) {
    hits.push({
      kind: 'contact',
      id: row.id,
      title: row.name,
      subtitle: [row.email, row.phone, row.company].filter(Boolean).join(' · ') || '—',
      href: `/crm/contacts/${row.id}`,
    })
  }

  // --- Companies (4) ---
  const companies = d.prepare(`
    SELECT id, name, website, industry
    FROM crm_companies
    WHERE workspace_id = ? AND LOWER(name) LIKE ?
    ORDER BY updated_at DESC
    LIMIT 4
  `).all(auth.workspaceId, like) as Array<{ id: number; name: string; website: string | null; industry: string | null }>
  for (const row of companies) {
    hits.push({
      kind: 'company',
      id: row.id,
      title: row.name,
      subtitle: [row.industry, row.website].filter(Boolean).join(' · ') || '—',
      href: `/crm/companies/${row.id}`,
    })
  }

  // --- Opportunities (4) ---
  const opportunities = d.prepare(`
    SELECT o.id, o.name, o.value, o.stage, o.status, c.name AS contact_name
    FROM crm_opportunities o
    LEFT JOIN crm_contacts c ON c.id = o.contact_id
    WHERE o.workspace_id = ? AND LOWER(o.name) LIKE ?
    ORDER BY o.id DESC
    LIMIT 4
  `).all(auth.workspaceId, like) as Array<{ id: number; name: string; value: number; stage: string; status: string; contact_name: string | null }>
  for (const row of opportunities) {
    hits.push({
      kind: 'opportunity',
      id: row.id,
      title: row.name,
      subtitle: `${row.stage} · ${row.status} · ${row.contact_name || '—'}`,
      href: `/crm/opportunities?selected=${row.id}`,
    })
  }

  // --- Booking pages (3) ---
  const bookingPages = d.prepare(`
    SELECT id, name, public_id
    FROM crm_calendars
    WHERE workspace_id = ? AND LOWER(name) LIKE ?
    LIMIT 3
  `).all(auth.workspaceId, like) as Array<{ id: number; name: string; public_id: string }>
  for (const row of bookingPages) {
    hits.push({
      kind: 'booking_page',
      id: row.id,
      title: row.name,
      subtitle: `/b/${row.public_id}`,
      href: `/crm/booking-pages?selected=${row.id}`,
    })
  }

  // --- Tasks (8) / Docs (5) / Projects (5) / Folders (5) ---
  // Scoped to the active workspace, matching the rest of this endpoint.
  const allTasks = getTasks({ workspaceId: auth.workspaceId }) as Task[]
  const allDocs = getDocs({ workspaceId: auth.workspaceId }) as Doc[]
  const allProjects = getProjects(auth.workspaceId) as Project[]
  const allFolders = getFolders(auth.workspaceId) as Folder[]

  const tasks = allTasks
    .filter((t) => t.title.toLowerCase().includes(ql) || (t.description?.toLowerCase().includes(ql) ?? false))
    .slice(0, 8)
  for (const t of tasks) {
    hits.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      subtitle: `${t.status} · ${t.priority}`,
      href: `/projects-tasks?taskId=${t.public_id || t.id}`,
    })
  }

  const docs = allDocs
    .filter((doc) => doc.title.toLowerCase().includes(ql) || (doc.content?.toLowerCase().includes(ql) ?? false))
    .slice(0, 5)
  for (const doc of docs) {
    hits.push({
      kind: 'doc',
      id: doc.id,
      title: doc.title,
      subtitle: (doc.content || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Empty doc',
      href: `/doc/${doc.public_id || doc.id}`,
    })
  }

  const projects = allProjects
    .filter((p) => p.name.toLowerCase().includes(ql))
    .slice(0, 5)
  for (const p of projects) {
    hits.push({
      kind: 'project',
      id: p.id,
      title: p.name,
      subtitle: p.status,
      href: `/project/${p.public_id || p.id}`,
    })
  }

  const folders = allFolders
    .filter((f) => f.name.toLowerCase().includes(ql))
    .slice(0, 5)
  for (const f of folders) {
    hits.push({
      kind: 'folder',
      id: f.id,
      title: f.name,
      subtitle: 'Folder',
      href: `/projects-tasks?folder=${f.public_id || f.id}`,
    })
  }

  return jsonData({ hits })
}
