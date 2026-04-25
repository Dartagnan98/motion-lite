/**
 * Vault sync -- mirrors SQLite content to markdown files (Obsidian-style).
 * SQLite stays as source of truth; vault is a read-only mirror.
 * All writes are async and non-blocking.
 */

import fs from 'fs'
import path from 'path'
import { blocksToMarkdown } from './vault-blocks'
import type { Doc, Task } from './types'

// Resolve vault root from env or default
const VAULT_ROOT = process.env.VAULT_ROOT || path.resolve(process.env.HOME || '~', 'agent-session', 'vault')

// In-memory meta cache (id -> filepath mapping)
let metaCache: Record<string, string> = {}
const META_PATH = path.join(VAULT_ROOT, '.vault-meta.json')

function loadMeta(): Record<string, string> {
  try {
    if (fs.existsSync(META_PATH)) {
      metaCache = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'))
    }
  } catch { metaCache = {} }
  return metaCache
}

function saveMeta() {
  try {
    fs.mkdirSync(path.dirname(META_PATH), { recursive: true })
    fs.writeFileSync(META_PATH + '.tmp', JSON.stringify(metaCache, null, 2))
    fs.renameSync(META_PATH + '.tmp', META_PATH)
  } catch { /* silent */ }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '')
    || 'untitled'
}

function epochToIso(epoch: number): string {
  return new Date(epoch * 1000).toISOString()
}

function writeVaultFile(relPath: string, content: string) {
  const fullPath = path.join(VAULT_ROOT, relPath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath + '.tmp', content)
  fs.renameSync(fullPath + '.tmp', fullPath)
}

function removeOldFile(metaKey: string) {
  loadMeta()
  const oldPath = metaCache[metaKey]
  if (oldPath) {
    const fullOld = path.join(VAULT_ROOT, oldPath)
    if (fs.existsSync(fullOld)) {
      // Move to .trash
      const trashPath = path.join(VAULT_ROOT, '.trash', oldPath)
      fs.mkdirSync(path.dirname(trashPath), { recursive: true })
      try { fs.renameSync(fullOld, trashPath) } catch { try { fs.unlinkSync(fullOld) } catch { /* */ } }
    }
    delete metaCache[metaKey]
  }
}

// ─── Hierarchy resolution (lazy-loaded to avoid circular imports) ───

function getHierarchyNames(doc: Doc): { workspace: string; folder: string | null; project: string | null } {
  try {
    // Dynamic import to avoid circular dependency with db.ts
    const db = require('./db')
    const workspace = doc.workspace_id ? db.getWorkspaceById(doc.workspace_id) : null
    const folder = doc.folder_id ? db.getFolder(doc.folder_id) : null
    const project = doc.project_id ? db.getProject(doc.project_id) : null
    return {
      workspace: workspace?.name || '_unsorted',
      folder: folder?.name || null,
      project: project?.name || null,
    }
  } catch {
    return { workspace: '_unsorted', folder: null, project: null }
  }
}

function getTaskProjectName(task: Task): string | null {
  if (!task.project_id) return null
  try {
    const db = require('./db')
    const project = db.getProject(task.project_id)
    return project?.name || null
  } catch { return null }
}

function getTaskWorkspaceName(task: Task): string | null {
  if (!task.workspace_id) return null
  try {
    const db = require('./db')
    const ws = db.getWorkspaceById(task.workspace_id)
    return ws?.name || null
  } catch { return null }
}

// ─── Doc sync ───

export function syncDoc(doc: Doc) {
  try {
    loadMeta()
    const metaKey = `doc:${doc.id}`

    // Remove old file if path changed (rename/move)
    removeOldFile(metaKey)

    const { workspace, folder, project } = getHierarchyNames(doc)
    const parts = ['docs', slugify(workspace)]
    if (folder) parts.push(slugify(folder))
    if (project) parts.push(slugify(project))
    parts.push(slugify(doc.title || 'untitled') + '.md')

    const relPath = parts.join('/')
    const body = blocksToMarkdown(doc.content || '')

    const frontmatter = [
      '---',
      `id: ${doc.id}`,
      `title: "${(doc.title || 'Untitled').replace(/"/g, '\\"')}"`,
      `workspace: "${workspace}"`,
      folder ? `folder: "${folder}"` : null,
      project ? `project: "${project}"` : null,
      doc.doc_type ? `doc_type: "${doc.doc_type}"` : null,
      doc.published ? `published: true` : null,
      doc.publish_slug ? `publish_slug: "${doc.publish_slug}"` : null,
      `created: ${epochToIso(doc.created_at)}`,
      `updated: ${epochToIso(doc.updated_at)}`,
      '---',
    ].filter(Boolean).join('\n')

    writeVaultFile(relPath, frontmatter + '\n\n' + body + '\n')

    metaCache[metaKey] = relPath
    saveMeta()
  } catch { /* silent -- vault sync should never break the app */ }
}

// ─── Task sync ───

export function syncTask(task: Task) {
  try {
    loadMeta()
    const metaKey = `task:${task.id}`
    removeOldFile(metaKey)

    const doneStatuses = ['done']
    const cancelledStatuses = ['cancelled', 'archived']
    let bucket = '_active'
    if (doneStatuses.includes(task.status)) bucket = '_done'
    else if (cancelledStatuses.includes(task.status)) bucket = '_cancelled'

    const slug = slugify(task.title || 'untitled')
    const relPath = `tasks/${bucket}/${task.id}-${slug}.md`

    const projectName = getTaskProjectName(task)
    const workspaceName = getTaskWorkspaceName(task)

    const frontmatter = [
      '---',
      `id: ${task.id}`,
      `status: ${task.status}`,
      `priority: ${task.priority}`,
      task.assignee ? `assignee: "${task.assignee}"` : null,
      task.client ? `client: "${task.client}"` : null,
      task.due_date ? `due_date: ${task.due_date}` : null,
      workspaceName ? `workspace: "${workspaceName}"` : null,
      projectName ? `project: "${projectName}"` : null,
      task.labels ? `labels: ${task.labels}` : null,
      task.duration_minutes ? `duration_minutes: ${task.duration_minutes}` : null,
      task.effort_level ? `effort_level: "${task.effort_level}"` : null,
      task.parent_task_id ? `parent_task_id: ${task.parent_task_id}` : null,
      `created: ${epochToIso(task.created_at)}`,
      `updated: ${epochToIso(task.updated_at)}`,
      task.completed_at ? `completed: ${epochToIso(task.completed_at)}` : null,
      '---',
    ].filter(Boolean).join('\n')

    const body = task.description || ''

    writeVaultFile(relPath, frontmatter + '\n\n# ' + (task.title || 'Untitled') + '\n\n' + body + '\n')

    metaCache[metaKey] = relPath
    saveMeta()
  } catch { /* silent */ }
}

// ─── Memory sync ───

interface MemoryRow {
  id: number
  chat_id: string
  content: string
  sector: string
  topic_key: string | null
  source: string
  source_contact: string | null
  source_channel: string | null
  salience: number
  created_at: number
  accessed_at: number
}

export function syncMemory(mem: MemoryRow) {
  try {
    loadMeta()
    const metaKey = `memory:${mem.id}`
    removeOldFile(metaKey)

    const sector = mem.sector === 'semantic' ? 'semantic' : 'episodic'
    const relPath = `memories/${sector}/${mem.id}.md`

    const frontmatter = [
      '---',
      `id: ${mem.id}`,
      `sector: ${mem.sector}`,
      `source: ${mem.source}`,
      mem.source_contact ? `source_contact: "${mem.source_contact}"` : null,
      mem.source_channel ? `source_channel: "${mem.source_channel}"` : null,
      mem.topic_key ? `topic_key: "${mem.topic_key}"` : null,
      `salience: ${mem.salience}`,
      `created: ${epochToIso(mem.created_at)}`,
      `accessed: ${epochToIso(mem.accessed_at)}`,
      '---',
    ].filter(Boolean).join('\n')

    writeVaultFile(relPath, frontmatter + '\n\n' + mem.content + '\n')

    metaCache[metaKey] = relPath
    saveMeta()
  } catch { /* silent */ }
}

// ─── Client sync ───

interface ClientProfileData {
  id: number
  name: string
  slug: string
  status: string
  industry?: string | null
  brand_voice?: string
  goals?: string
  target_audience?: string
  services?: string
  offer?: string
  offer_details?: string
  context?: string
  ad_account_id?: string | null
  monthly_budget?: number | null
  instagram_handle?: string | null
  tiktok_handle?: string | null
  facebook_page?: string | null
  website?: string | null
  location?: string | null
}

export function syncClient(client: ClientProfileData) {
  try {
    loadMeta()
    const metaKey = `client:${client.id}`
    removeOldFile(metaKey)

    const relPath = `clients/${slugify(client.slug || client.name)}.md`

    const frontmatter = [
      '---',
      `id: ${client.id}`,
      `slug: "${client.slug}"`,
      `status: ${client.status}`,
      client.industry ? `industry: "${client.industry}"` : null,
      client.ad_account_id ? `ad_account_id: "${client.ad_account_id}"` : null,
      client.monthly_budget ? `monthly_budget: ${client.monthly_budget}` : null,
      client.instagram_handle ? `instagram: "${client.instagram_handle}"` : null,
      client.tiktok_handle ? `tiktok: "${client.tiktok_handle}"` : null,
      client.facebook_page ? `facebook: "${client.facebook_page}"` : null,
      client.website ? `website: "${client.website}"` : null,
      client.location ? `location: "${client.location}"` : null,
      '---',
    ].filter(Boolean).join('\n')

    const sections: string[] = [`# ${client.name}`]
    if (client.context) sections.push(`\n## Context\n\n${client.context}`)
    if (client.brand_voice) sections.push(`\n## Brand Voice\n\n${client.brand_voice}`)
    if (client.goals) sections.push(`\n## Goals\n\n${client.goals}`)
    if (client.target_audience) sections.push(`\n## Target Audience\n\n${client.target_audience}`)
    if (client.services) sections.push(`\n## Services\n\n${client.services}`)
    if (client.offer) sections.push(`\n## Offer\n\n${client.offer}`)
    if (client.offer_details) sections.push(`\n## Offer Details\n\n${client.offer_details}`)

    writeVaultFile(relPath, frontmatter + '\n\n' + sections.join('\n') + '\n')

    metaCache[metaKey] = relPath
    saveMeta()
  } catch { /* silent */ }
}

// ─── Remove ───

export function removeVaultFile(type: string, id: number) {
  try {
    loadMeta()
    const metaKey = `${type}:${id}`
    removeOldFile(metaKey)
    saveMeta()
  } catch { /* silent */ }
}

// ─── Full sync (migration) ───

export function fullSync() {
  try {
    const db = require('./db')

    // Docs
    const docs: Doc[] = db.getDocs({ limit: 10000 })
    for (const doc of docs) {
      syncDoc(doc)
    }

    // Tasks
    const tasks: Task[] = db.getTasks()
    for (const task of tasks) {
      syncTask(task)
    }

    // Client profiles
    const clients = db.getClientProfiles()
    for (const client of clients) {
      syncClient(client)
    }

    // Memories -- read from the shared DB (may not exist on all environments)
    let memories: MemoryRow[] = []
    try {
      memories = db.getDb().prepare('SELECT id, chat_id, content, sector, topic_key, source, source_contact, source_channel, salience, created_at, accessed_at FROM memories ORDER BY id').all() as MemoryRow[]
    } catch { /* memories table may not exist in this DB */ }
    let count = 0
    for (const mem of memories) {
      syncMemory(mem)
      count++
      if (count % 200 === 0) {
        // Let event loop breathe during bulk operations
        // (synchronous in migration context, but keeps meta saves batched)
        saveMeta()
      }
    }
    saveMeta()

    return { docs: docs.length, tasks: tasks.length, clients: clients.length, memories: memories.length }
  } catch (err) {
    console.error('Vault fullSync error:', err)
    throw err
  }
}
