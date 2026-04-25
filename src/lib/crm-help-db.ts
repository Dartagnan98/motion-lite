import type Database from 'better-sqlite3'
import { getDb } from './db'

function safeAddColumn(d: Database.Database, table: string, col: string, def: string) {
  try {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
  } catch {
    // noop
  }
}

// Help center (knowledge base)
// ═════════════════════════════════════════════════════════════════════════

export type HelpVisibility = 'public' | 'password' | 'members_only'
export type HelpStatus = 'draft' | 'published' | 'archived'

export interface CrmHelpCenter {
  id: number
  workspace_id: number
  name: string
  slug: string
  public_slug: string
  description: string | null
  tagline: string | null
  logo_url: string | null
  theme_color: string | null
  ai_search_enabled: number
  favicon_url: string | null
  hero_headline: string | null
  hero_subheadline: string | null
  theme_json: string | null
  support_email: string | null
  support_phone: string | null
  custom_domain: string | null
  public_visibility: HelpVisibility
  access_password_hash: string | null
  enable_contact_form: number
  enable_chat_widget: number
  status: HelpStatus
  created_at: number
  updated_at: number
}

export interface CrmHelpCollection {
  id: number
  workspace_id: number
  help_center_id: number
  name: string
  slug: string
  description: string | null
  icon: string | null
  position: number
  color: string | null
  sort_order: number
  parent_id: number | null
  is_public: number
  article_count?: number
  created_at: number
  updated_at: number
}

export interface CrmHelpArticle {
  id: number
  workspace_id: number
  help_center_id: number
  collection_id: number | null
  title: string
  slug: string
  excerpt: string | null
  summary: string | null
  body_markdown: string
  body_html: string
  author_user_id: number | null
  author_id: number | null
  author_name: string | null
  status: HelpStatus
  published_at: number | null
  last_updated_at: number | null
  updated_at_content: number | null
  views: number
  view_count: number
  helpful_up: number
  helpful_down: number
  helpful_count: number
  not_helpful_count: number
  search_text_fts: string | null
  meta_title: string | null
  meta_description: string | null
  related_article_ids_json: string | null
  created_at: number
  updated_at: number
}

export interface CrmHelpArticleVersion {
  id: number
  article_id: number
  version_number: number
  body_markdown: string
  edited_by_user_id: number | null
  edited_at: number
  change_note: string | null
}

export interface CrmHelpSearchQuery {
  id: number
  workspace_id: number
  help_center_id: number
  query: string
  results_count: number
  clicked_article_id: number | null
  contact_id: number | null
  session_id: string | null
  searched_at: number
}

export interface CrmHelpFeedback {
  id: number
  workspace_id: number
  article_id: number
  helpful: number
  comment: string | null
  contact_id: number | null
  ip_hash: string | null
  created_at: number
}

export interface CrmHelpArticleView {
  id: number
  workspace_id: number
  article_id: number
  session_id: string
  viewed_at: number
  created_at: number
  updated_at: number
}

export interface CrmHelpAiQuery {
  id: number
  workspace_id: number
  help_center_id: number
  query: string
  answer_json: string
  contact_id: number | null
  created_at: number
  updated_at: number
}

export interface HelpSearchHit {
  article: CrmHelpArticle
  score: number
  snippet: string
}

let helpSchemaEnsured = false

function helpNow(): number {
  return Math.floor(Date.now() / 1000)
}

function helpNowText(): string {
  return String(helpNow())
}

function toHelpTimestamp(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeHelpSlug(input: string | null | undefined, fallback: string): string {
  const base = String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || fallback
}

function stripHelpSearchText(markdown: string): string {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~`-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildHelpSearchText(title: string, excerpt: string | null, markdown: string): string {
  return [title, excerpt || '', stripHelpSearchText(markdown)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
}

function ensureHelpCenterSchema(): void {
  if (helpSchemaEnsured) return
  const d = getDb()

  safeAddColumn(d, 'crm_help_centers', 'public_slug', 'TEXT')
  safeAddColumn(d, 'crm_help_centers', 'tagline', 'TEXT')
  safeAddColumn(d, 'crm_help_centers', 'theme_color', 'TEXT')
  safeAddColumn(d, 'crm_help_centers', 'ai_search_enabled', 'INTEGER NOT NULL DEFAULT 0')

  safeAddColumn(d, 'crm_help_collections', 'workspace_id', 'INTEGER REFERENCES workspaces(id) ON DELETE CASCADE')
  safeAddColumn(d, 'crm_help_collections', 'position', 'INTEGER NOT NULL DEFAULT 0')

  safeAddColumn(d, 'crm_help_articles', 'workspace_id', 'INTEGER REFERENCES workspaces(id) ON DELETE CASCADE')
  safeAddColumn(d, 'crm_help_articles', 'excerpt', 'TEXT')
  safeAddColumn(d, 'crm_help_articles', 'author_user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
  safeAddColumn(d, 'crm_help_articles', 'last_updated_at', 'INTEGER')
  safeAddColumn(d, 'crm_help_articles', 'views', 'INTEGER NOT NULL DEFAULT 0')
  safeAddColumn(d, 'crm_help_articles', 'helpful_up', 'INTEGER NOT NULL DEFAULT 0')
  safeAddColumn(d, 'crm_help_articles', 'helpful_down', 'INTEGER NOT NULL DEFAULT 0')
  safeAddColumn(d, 'crm_help_articles', 'search_text_fts', 'TEXT')

  safeAddColumn(d, 'crm_help_search_queries', 'workspace_id', 'INTEGER REFERENCES workspaces(id) ON DELETE CASCADE')
  safeAddColumn(d, 'crm_help_search_queries', 'created_at', "TEXT NOT NULL DEFAULT (strftime('%s','now'))")
  safeAddColumn(d, 'crm_help_search_queries', 'updated_at', "TEXT NOT NULL DEFAULT (strftime('%s','now'))")

  safeAddColumn(d, 'crm_help_feedback', 'workspace_id', 'INTEGER REFERENCES workspaces(id) ON DELETE CASCADE')
  safeAddColumn(d, 'crm_help_feedback', 'updated_at', "TEXT NOT NULL DEFAULT (strftime('%s','now'))")

  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_help_centers_public_slug ON crm_help_centers(public_slug)`)
  d.exec(`CREATE INDEX IF NOT EXISTS idx_crm_help_collections_workspace ON crm_help_collections(workspace_id)`)
  d.exec(`CREATE INDEX IF NOT EXISTS idx_crm_help_articles_workspace ON crm_help_articles(workspace_id)`)

  d.exec(`
    CREATE TABLE IF NOT EXISTS crm_help_article_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      article_id INTEGER NOT NULL REFERENCES crm_help_articles(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT (strftime('%s','now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%s','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%s','now'))
    )
  `)
  d.exec(`CREATE INDEX IF NOT EXISTS idx_crm_help_article_views_article ON crm_help_article_views(article_id, viewed_at DESC)`)
  d.exec(`CREATE INDEX IF NOT EXISTS idx_crm_help_article_views_session ON crm_help_article_views(article_id, session_id)`)

  d.exec(`
    CREATE TABLE IF NOT EXISTS crm_help_ai_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      help_center_id INTEGER NOT NULL REFERENCES crm_help_centers(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%s','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%s','now'))
    )
  `)
  d.exec(`CREATE INDEX IF NOT EXISTS idx_crm_help_ai_queries_center ON crm_help_ai_queries(help_center_id, created_at DESC)`)

  try { d.exec(`UPDATE crm_help_centers SET public_slug = COALESCE(NULLIF(public_slug, ''), slug) WHERE public_slug IS NULL OR TRIM(public_slug) = ''`) } catch {}
  try { d.exec(`UPDATE crm_help_centers SET tagline = COALESCE(tagline, description) WHERE tagline IS NULL AND description IS NOT NULL`) } catch {}
  try { d.exec(`UPDATE crm_help_collections SET workspace_id = (SELECT workspace_id FROM crm_help_centers hc WHERE hc.id = crm_help_collections.help_center_id) WHERE workspace_id IS NULL`) } catch {}
  try { d.exec(`UPDATE crm_help_collections SET position = COALESCE(position, sort_order, 0)`) } catch {}
  try { d.exec(`UPDATE crm_help_collections SET sort_order = COALESCE(sort_order, position, 0)`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET workspace_id = (SELECT workspace_id FROM crm_help_centers hc WHERE hc.id = crm_help_articles.help_center_id) WHERE workspace_id IS NULL`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET excerpt = COALESCE(excerpt, summary) WHERE excerpt IS NULL AND summary IS NOT NULL`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET author_user_id = COALESCE(author_user_id, author_id) WHERE author_user_id IS NULL AND author_id IS NOT NULL`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET last_updated_at = COALESCE(last_updated_at, updated_at_content, CAST(updated_at AS INTEGER)) WHERE last_updated_at IS NULL`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET views = COALESCE(views, view_count, 0)`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET view_count = COALESCE(view_count, views, 0)`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET helpful_up = COALESCE(helpful_up, helpful_count, 0)`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET helpful_count = COALESCE(helpful_count, helpful_up, 0)`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET helpful_down = COALESCE(helpful_down, not_helpful_count, 0)`) } catch {}
  try { d.exec(`UPDATE crm_help_articles SET not_helpful_count = COALESCE(not_helpful_count, helpful_down, 0)`) } catch {}
  try {
    const rows = d.prepare(`
      SELECT id, title, COALESCE(excerpt, summary, '') AS excerpt, body_markdown
      FROM crm_help_articles
      WHERE search_text_fts IS NULL OR TRIM(search_text_fts) = ''
    `).all() as Array<{ id: number; title: string; excerpt: string; body_markdown: string }>
    const stmt = d.prepare('UPDATE crm_help_articles SET search_text_fts = ? WHERE id = ?')
    for (const row of rows) stmt.run(buildHelpSearchText(row.title, row.excerpt, row.body_markdown), row.id)
  } catch {}

  helpSchemaEnsured = true
}

function hydrateCrmHelpCenter(row: Record<string, unknown> | undefined | null): CrmHelpCenter | null {
  if (!row) return null
  const canonicalSlug = String(row.public_slug || row.slug || 'help')
  return {
    id: Number(row.id || 0),
    workspace_id: Number(row.workspace_id || 0),
    name: String(row.name || 'Help center'),
    slug: canonicalSlug,
    public_slug: canonicalSlug,
    description: trimToNull(row.description) ?? trimToNull(row.tagline),
    tagline: trimToNull(row.tagline) ?? trimToNull(row.description),
    logo_url: trimToNull(row.logo_url),
    theme_color: trimToNull(row.theme_color),
    ai_search_enabled: Number(row.ai_search_enabled || 0),
    favicon_url: trimToNull(row.favicon_url),
    hero_headline: trimToNull(row.hero_headline),
    hero_subheadline: trimToNull(row.hero_subheadline),
    theme_json: trimToNull(row.theme_json),
    support_email: trimToNull(row.support_email),
    support_phone: trimToNull(row.support_phone),
    custom_domain: trimToNull(row.custom_domain),
    public_visibility: (row.public_visibility as HelpVisibility) || 'public',
    access_password_hash: trimToNull(row.access_password_hash),
    enable_contact_form: Number(row.enable_contact_form ?? 1),
    enable_chat_widget: Number(row.enable_chat_widget ?? 0),
    status: (row.status as HelpStatus) || 'draft',
    created_at: toHelpTimestamp(row.created_at),
    updated_at: toHelpTimestamp(row.updated_at),
  }
}

function hydrateCrmHelpCollection(row: Record<string, unknown> | undefined | null): CrmHelpCollection | null {
  if (!row) return null
  const position = Number(row.position ?? row.sort_order ?? 0)
  return {
    id: Number(row.id || 0),
    workspace_id: Number(row.workspace_id || 0),
    help_center_id: Number(row.help_center_id || 0),
    name: String(row.name || 'Collection'),
    slug: String(row.slug || 'collection'),
    description: trimToNull(row.description),
    icon: trimToNull(row.icon),
    position,
    color: trimToNull(row.color),
    sort_order: position,
    parent_id: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
    is_public: Number(row.is_public ?? 1),
    article_count: row.article_count === undefined ? undefined : Number(row.article_count || 0),
    created_at: toHelpTimestamp(row.created_at),
    updated_at: toHelpTimestamp(row.updated_at),
  }
}

function hydrateCrmHelpArticle(row: Record<string, unknown> | undefined | null): CrmHelpArticle | null {
  if (!row) return null
  const excerpt = trimToNull(row.excerpt) ?? trimToNull(row.summary)
  const views = Number(row.views ?? row.view_count ?? 0)
  const helpfulUp = Number(row.helpful_up ?? row.helpful_count ?? 0)
  const helpfulDown = Number(row.helpful_down ?? row.not_helpful_count ?? 0)
  const bodyMarkdown = String(row.body_markdown || '')
  return {
    id: Number(row.id || 0),
    workspace_id: Number(row.workspace_id || 0),
    help_center_id: Number(row.help_center_id || 0),
    collection_id: row.collection_id === null || row.collection_id === undefined ? null : Number(row.collection_id),
    title: String(row.title || 'Untitled'),
    slug: String(row.slug || 'untitled'),
    excerpt,
    summary: excerpt,
    body_markdown: bodyMarkdown,
    body_html: String(row.body_html || ''),
    author_user_id: row.author_user_id === null || row.author_user_id === undefined ? (row.author_id === null || row.author_id === undefined ? null : Number(row.author_id)) : Number(row.author_user_id),
    author_id: row.author_id === null || row.author_id === undefined ? (row.author_user_id === null || row.author_user_id === undefined ? null : Number(row.author_user_id)) : Number(row.author_id),
    author_name: trimToNull(row.author_name),
    status: (row.status as HelpStatus) || 'draft',
    published_at: row.published_at === null || row.published_at === undefined ? null : toHelpTimestamp(row.published_at),
    last_updated_at: row.last_updated_at === null || row.last_updated_at === undefined ? toHelpTimestamp(row.updated_at_content ?? row.updated_at) : toHelpTimestamp(row.last_updated_at),
    updated_at_content: row.updated_at_content === null || row.updated_at_content === undefined ? toHelpTimestamp(row.last_updated_at ?? row.updated_at) : toHelpTimestamp(row.updated_at_content),
    views,
    view_count: views,
    helpful_up: helpfulUp,
    helpful_down: helpfulDown,
    helpful_count: helpfulUp,
    not_helpful_count: helpfulDown,
    search_text_fts: trimToNull(row.search_text_fts) || buildHelpSearchText(String(row.title || ''), excerpt, bodyMarkdown),
    meta_title: trimToNull(row.meta_title),
    meta_description: trimToNull(row.meta_description),
    related_article_ids_json: trimToNull(row.related_article_ids_json),
    created_at: toHelpTimestamp(row.created_at),
    updated_at: toHelpTimestamp(row.updated_at),
  }
}

function hydrateCrmHelpArticleVersion(row: Record<string, unknown> | undefined | null): CrmHelpArticleVersion | null {
  if (!row) return null
  return {
    id: Number(row.id || 0),
    article_id: Number(row.article_id || 0),
    version_number: Number(row.version_number || 0),
    body_markdown: String(row.body_markdown || ''),
    edited_by_user_id: row.edited_by_user_id === null || row.edited_by_user_id === undefined ? null : Number(row.edited_by_user_id),
    edited_at: toHelpTimestamp(row.edited_at),
    change_note: trimToNull(row.change_note),
  }
}

function ensureUniqueHelpCenterSlug(base: string, excludeId?: number): string {
  ensureHelpCenterSchema()
  const db2 = getDb()
  const root = normalizeHelpSlug(base, 'help')
  let candidate = root
  let n = 1
  const stmt = db2.prepare('SELECT id FROM crm_help_centers WHERE public_slug = ? OR slug = ?')
  while (true) {
    const row = stmt.get(candidate, candidate) as { id: number } | undefined
    if (!row || row.id === excludeId) return candidate
    n += 1
    candidate = `${root}-${n}`
  }
}

function ensureUniqueArticleSlug(helpCenterId: number, base: string, excludeId?: number): string {
  ensureHelpCenterSchema()
  const db2 = getDb()
  const root = normalizeHelpSlug(base, 'untitled')
  let candidate = root
  let n = 1
  const stmt = db2.prepare('SELECT id FROM crm_help_articles WHERE help_center_id = ? AND slug = ?')
  while (true) {
    const row = stmt.get(helpCenterId, candidate) as { id: number } | undefined
    if (!row || row.id === excludeId) return candidate
    n += 1
    candidate = `${root}-${n}`
  }
}

function ensureUniqueCollectionSlug(helpCenterId: number, base: string, excludeId?: number): string {
  ensureHelpCenterSchema()
  const db2 = getDb()
  const root = normalizeHelpSlug(base, 'collection')
  let candidate = root
  let n = 1
  const stmt = db2.prepare('SELECT id FROM crm_help_collections WHERE help_center_id = ? AND slug = ?')
  while (true) {
    const row = stmt.get(helpCenterId, candidate) as { id: number } | undefined
    if (!row || row.id === excludeId) return candidate
    n += 1
    candidate = `${root}-${n}`
  }
}

export function listCrmHelpCenters(workspaceId: number): CrmHelpCenter[] {
  ensureHelpCenterSchema()
  const rows = getDb().prepare(
    'SELECT * FROM crm_help_centers WHERE workspace_id = ? ORDER BY CAST(updated_at AS INTEGER) DESC, id DESC'
  ).all(workspaceId) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpCenter(row)).filter(Boolean) as CrmHelpCenter[]
}

export function listPublishedCrmHelpCenters(limit = 20): CrmHelpCenter[] {
  ensureHelpCenterSchema()
  const rows = getDb().prepare(
    "SELECT * FROM crm_help_centers WHERE status = 'published' ORDER BY CAST(updated_at AS INTEGER) DESC, id DESC LIMIT ?"
  ).all(Math.max(1, Math.floor(limit))) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpCenter(row)).filter(Boolean) as CrmHelpCenter[]
}

export function getCrmHelpCenterById(id: number, workspaceId: number): CrmHelpCenter | null {
  ensureHelpCenterSchema()
  const row = getDb().prepare(
    'SELECT * FROM crm_help_centers WHERE id = ? AND workspace_id = ?'
  ).get(id, workspaceId) as Record<string, unknown> | undefined
  return hydrateCrmHelpCenter(row)
}

export function getCrmHelpCenterBySlug(slug: string): CrmHelpCenter | null {
  ensureHelpCenterSchema()
  const row = getDb().prepare(
    'SELECT * FROM crm_help_centers WHERE public_slug = ? OR slug = ? LIMIT 1'
  ).get(slug, slug) as Record<string, unknown> | undefined
  return hydrateCrmHelpCenter(row)
}

export function createCrmHelpCenter(workspaceId: number, data: {
  name: string
  slug?: string
  public_slug?: string
  description?: string | null
  tagline?: string | null
  theme_color?: string | null
  support_email?: string | null
  ai_search_enabled?: boolean
}): CrmHelpCenter {
  ensureHelpCenterSchema()
  const now = helpNowText()
  const name = String(data.name || '').trim() || 'Help center'
  const canonicalSlug = ensureUniqueHelpCenterSlug(data.public_slug || data.slug || data.name || 'help')
  const tagline = trimToNull(data.tagline) ?? trimToNull(data.description)
  const result = getDb().prepare(`
    INSERT INTO crm_help_centers (
      workspace_id, name, slug, public_slug, description, tagline,
      logo_url, theme_color, support_email, ai_search_enabled,
      hero_headline, hero_subheadline,
      public_visibility, enable_contact_form, enable_chat_widget,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'public', 1, 0, 'draft', ?, ?)
  `).run(
    workspaceId,
    name,
    canonicalSlug,
    canonicalSlug,
    tagline,
    tagline,
    trimToNull(data.theme_color),
    trimToNull(data.support_email),
    data.ai_search_enabled ? 1 : 0,
    'How can we help?',
    tagline || 'Search articles or browse by topic.',
    now,
    now,
  )
  const created = getCrmHelpCenterById(Number(result.lastInsertRowid), workspaceId)
  if (!created) throw new Error('Failed to load created help center')
  return created
}

export function updateCrmHelpCenter(id: number, workspaceId: number, data: Partial<{
  name: string
  slug: string
  public_slug: string
  description: string | null
  tagline: string | null
  logo_url: string | null
  theme_color: string | null
  favicon_url: string | null
  hero_headline: string | null
  hero_subheadline: string | null
  theme_json: string | null
  support_email: string | null
  support_phone: string | null
  custom_domain: string | null
  public_visibility: HelpVisibility
  access_password_hash: string | null
  enable_contact_form: boolean
  enable_chat_widget: boolean
  ai_search_enabled: boolean
  status: HelpStatus
}>): CrmHelpCenter | null {
  ensureHelpCenterSchema()
  const existing = getCrmHelpCenterById(id, workspaceId)
  if (!existing) return null
  const sets: string[] = []
  const params: Array<string | number | null> = []

  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name.trim() || 'Help center') }
  if (data.slug !== undefined || data.public_slug !== undefined) {
    const candidate = ensureUniqueHelpCenterSlug(data.public_slug || data.slug || existing.public_slug, id)
    sets.push('slug = ?', 'public_slug = ?')
    params.push(candidate, candidate)
  }
  if ('description' in data || 'tagline' in data) {
    const tagline = trimToNull(data.tagline) ?? ('description' in data ? trimToNull(data.description) : existing.tagline)
    sets.push('description = ?', 'tagline = ?')
    params.push(tagline, tagline)
  }
  if ('logo_url' in data) { sets.push('logo_url = ?'); params.push(trimToNull(data.logo_url)) }
  if ('theme_color' in data) { sets.push('theme_color = ?'); params.push(trimToNull(data.theme_color)) }
  if ('favicon_url' in data) { sets.push('favicon_url = ?'); params.push(trimToNull(data.favicon_url)) }
  if ('hero_headline' in data) { sets.push('hero_headline = ?'); params.push(trimToNull(data.hero_headline)) }
  if ('hero_subheadline' in data) { sets.push('hero_subheadline = ?'); params.push(trimToNull(data.hero_subheadline)) }
  if ('theme_json' in data) { sets.push('theme_json = ?'); params.push(trimToNull(data.theme_json)) }
  if ('support_email' in data) { sets.push('support_email = ?'); params.push(trimToNull(data.support_email)) }
  if ('support_phone' in data) { sets.push('support_phone = ?'); params.push(trimToNull(data.support_phone)) }
  if ('custom_domain' in data) { sets.push('custom_domain = ?'); params.push(trimToNull(data.custom_domain)) }
  if (data.public_visibility !== undefined) { sets.push('public_visibility = ?'); params.push(data.public_visibility) }
  if ('access_password_hash' in data) { sets.push('access_password_hash = ?'); params.push(trimToNull(data.access_password_hash)) }
  if (data.enable_contact_form !== undefined) { sets.push('enable_contact_form = ?'); params.push(data.enable_contact_form ? 1 : 0) }
  if (data.enable_chat_widget !== undefined) { sets.push('enable_chat_widget = ?'); params.push(data.enable_chat_widget ? 1 : 0) }
  if (data.ai_search_enabled !== undefined) { sets.push('ai_search_enabled = ?'); params.push(data.ai_search_enabled ? 1 : 0) }
  if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status) }

  if (!sets.length) return existing
  sets.push('updated_at = ?')
  params.push(helpNowText(), id)
  getDb().prepare(`UPDATE crm_help_centers SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getCrmHelpCenterById(id, workspaceId)
}

export function deleteCrmHelpCenter(id: number, workspaceId: number): boolean {
  ensureHelpCenterSchema()
  const existing = getCrmHelpCenterById(id, workspaceId)
  if (!existing) return false
  return getDb().prepare('DELETE FROM crm_help_centers WHERE id = ?').run(id).changes > 0
}

export function listCrmHelpCollections(helpCenterId: number, workspaceId: number): CrmHelpCollection[] {
  ensureHelpCenterSchema()
  const rows = getDb().prepare(`
    SELECT c.*, COALESCE(c.workspace_id, hc.workspace_id) AS workspace_id,
           (
             SELECT COUNT(*) FROM crm_help_articles a
             WHERE a.collection_id = c.id AND a.status = 'published'
           ) AS article_count
      FROM crm_help_collections c
      JOIN crm_help_centers hc ON hc.id = c.help_center_id
     WHERE c.help_center_id = ? AND hc.workspace_id = ?
     ORDER BY COALESCE(c.position, c.sort_order, 0) ASC, c.name ASC, c.id ASC
  `).all(helpCenterId, workspaceId) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpCollection(row)).filter(Boolean) as CrmHelpCollection[]
}

export function listPublicCrmHelpCollections(helpCenterId: number): CrmHelpCollection[] {
  ensureHelpCenterSchema()
  const rows = getDb().prepare(`
    SELECT c.*, COALESCE(c.workspace_id, hc.workspace_id) AS workspace_id,
           (
             SELECT COUNT(*) FROM crm_help_articles a
             WHERE a.collection_id = c.id AND a.status = 'published'
           ) AS article_count
      FROM crm_help_collections c
      JOIN crm_help_centers hc ON hc.id = c.help_center_id
     WHERE c.help_center_id = ? AND c.is_public = 1
     ORDER BY COALESCE(c.position, c.sort_order, 0) ASC, c.name ASC, c.id ASC
  `).all(helpCenterId) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpCollection(row)).filter(Boolean) as CrmHelpCollection[]
}

export function getCrmHelpCollectionById(id: number, workspaceId: number): CrmHelpCollection | null {
  ensureHelpCenterSchema()
  const row = getDb().prepare(`
    SELECT c.*, COALESCE(c.workspace_id, hc.workspace_id) AS workspace_id,
           (
             SELECT COUNT(*) FROM crm_help_articles a
             WHERE a.collection_id = c.id AND a.status = 'published'
           ) AS article_count
      FROM crm_help_collections c
      JOIN crm_help_centers hc ON hc.id = c.help_center_id
     WHERE c.id = ? AND hc.workspace_id = ?
  `).get(id, workspaceId) as Record<string, unknown> | undefined
  return hydrateCrmHelpCollection(row)
}

export function getCrmHelpCollectionBySlug(helpCenterId: number, slug: string): CrmHelpCollection | null {
  ensureHelpCenterSchema()
  const row = getDb().prepare(`
    SELECT c.*, COALESCE(c.workspace_id, hc.workspace_id) AS workspace_id,
           (
             SELECT COUNT(*) FROM crm_help_articles a
             WHERE a.collection_id = c.id AND a.status = 'published'
           ) AS article_count
      FROM crm_help_collections c
      JOIN crm_help_centers hc ON hc.id = c.help_center_id
     WHERE c.help_center_id = ? AND c.slug = ?
  `).get(helpCenterId, slug) as Record<string, unknown> | undefined
  return hydrateCrmHelpCollection(row)
}

export function createCrmHelpCollection(helpCenterId: number, workspaceId: number, data: {
  name: string
  slug?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  parent_id?: number | null
  is_public?: boolean
  position?: number
  sort_order?: number
}): CrmHelpCollection | null {
  ensureHelpCenterSchema()
  const center = getCrmHelpCenterById(helpCenterId, workspaceId)
  if (!center) return null
  const now = helpNowText()
  const slug = ensureUniqueCollectionSlug(helpCenterId, data.slug || data.name, undefined)
  const position = Number.isFinite(data.position) ? Number(data.position) : Number.isFinite(data.sort_order) ? Number(data.sort_order) : 0
  const result = getDb().prepare(`
    INSERT INTO crm_help_collections (
      workspace_id, help_center_id, name, slug, description, icon,
      position, color, sort_order, parent_id, is_public, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    helpCenterId,
    data.name.trim() || 'Untitled collection',
    slug,
    trimToNull(data.description),
    trimToNull(data.icon),
    position,
    trimToNull(data.color),
    position,
    data.parent_id || null,
    data.is_public === false ? 0 : 1,
    now,
    now,
  )
  return getCrmHelpCollectionById(Number(result.lastInsertRowid), workspaceId)
}

export function updateCrmHelpCollection(id: number, workspaceId: number, data: Partial<{
  name: string
  slug: string
  description: string | null
  icon: string | null
  color: string | null
  position: number
  sort_order: number
  parent_id: number | null
  is_public: boolean
}>): CrmHelpCollection | null {
  ensureHelpCenterSchema()
  const existing = getCrmHelpCollectionById(id, workspaceId)
  if (!existing) return null
  const sets: string[] = []
  const params: Array<string | number | null> = []
  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name.trim() || 'Untitled collection') }
  if (data.slug !== undefined) {
    const slug = ensureUniqueCollectionSlug(existing.help_center_id, data.slug, id)
    sets.push('slug = ?')
    params.push(slug)
  }
  if ('description' in data) { sets.push('description = ?'); params.push(trimToNull(data.description)) }
  if ('icon' in data) { sets.push('icon = ?'); params.push(trimToNull(data.icon)) }
  if ('color' in data) { sets.push('color = ?'); params.push(trimToNull(data.color)) }
  if (data.position !== undefined || data.sort_order !== undefined) {
    const position = data.position !== undefined ? Number(data.position) : Number(data.sort_order)
    sets.push('position = ?', 'sort_order = ?')
    params.push(position, position)
  }
  if ('parent_id' in data) { sets.push('parent_id = ?'); params.push(data.parent_id || null) }
  if (data.is_public !== undefined) { sets.push('is_public = ?'); params.push(data.is_public ? 1 : 0) }
  if (!sets.length) return existing
  sets.push('updated_at = ?')
  params.push(helpNowText(), id)
  getDb().prepare(`UPDATE crm_help_collections SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getCrmHelpCollectionById(id, workspaceId)
}

export function deleteCrmHelpCollection(id: number, workspaceId: number): boolean {
  ensureHelpCenterSchema()
  const existing = getCrmHelpCollectionById(id, workspaceId)
  if (!existing) return false
  getDb().prepare('UPDATE crm_help_articles SET collection_id = NULL WHERE collection_id = ?').run(id)
  return getDb().prepare('DELETE FROM crm_help_collections WHERE id = ?').run(id).changes > 0
}

export function listCrmHelpArticles(helpCenterId: number, workspaceId: number, opts?: {
  status?: HelpStatus
  collectionId?: number | null
  limit?: number
}): CrmHelpArticle[] {
  ensureHelpCenterSchema()
  const clauses = ['a.help_center_id = ?', 'hc.workspace_id = ?']
  const args: Array<string | number> = [helpCenterId, workspaceId]
  if (opts?.status) {
    clauses.push('a.status = ?')
    args.push(opts.status)
  }
  if (opts?.collectionId !== undefined && opts.collectionId !== null) {
    clauses.push('a.collection_id = ?')
    args.push(opts.collectionId)
  }
  args.push(Math.min(500, Math.max(1, Math.floor(opts?.limit ?? 200))))
  const rows = getDb().prepare(`
    SELECT a.*, COALESCE(a.workspace_id, hc.workspace_id) AS workspace_id
      FROM crm_help_articles a
      JOIN crm_help_centers hc ON hc.id = a.help_center_id
      LEFT JOIN crm_help_collections c ON c.id = a.collection_id
     WHERE ${clauses.join(' AND ')}
       AND (a.collection_id IS NULL OR c.is_public = 1)
     ORDER BY COALESCE(a.last_updated_at, a.updated_at_content, CAST(a.updated_at AS INTEGER)) DESC, a.id DESC
     LIMIT ?
  `).all(...args) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpArticle(row)).filter(Boolean) as CrmHelpArticle[]
}

export function listPublishedCrmHelpArticles(helpCenterId: number, opts?: { collectionId?: number | null; limit?: number }): CrmHelpArticle[] {
  ensureHelpCenterSchema()
  const clauses = ['a.help_center_id = ?', "a.status = 'published'"]
  const args: Array<string | number> = [helpCenterId]
  if (opts?.collectionId !== undefined && opts.collectionId !== null) {
    clauses.push('a.collection_id = ?')
    args.push(opts.collectionId)
  }
  args.push(Math.min(500, Math.max(1, Math.floor(opts?.limit ?? 500))))
  const rows = getDb().prepare(`
    SELECT a.*, COALESCE(a.workspace_id, hc.workspace_id) AS workspace_id
      FROM crm_help_articles a
      JOIN crm_help_centers hc ON hc.id = a.help_center_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY COALESCE(a.views, a.view_count, 0) DESC,
              COALESCE(a.last_updated_at, a.updated_at_content, CAST(a.updated_at AS INTEGER)) DESC,
              a.id DESC
     LIMIT ?
  `).all(...args) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpArticle(row)).filter(Boolean) as CrmHelpArticle[]
}

export function getCrmHelpArticleById(id: number, workspaceId: number): CrmHelpArticle | null {
  ensureHelpCenterSchema()
  const row = getDb().prepare(`
    SELECT a.*, COALESCE(a.workspace_id, hc.workspace_id) AS workspace_id
      FROM crm_help_articles a
      JOIN crm_help_centers hc ON hc.id = a.help_center_id
     WHERE a.id = ? AND hc.workspace_id = ?
  `).get(id, workspaceId) as Record<string, unknown> | undefined
  return hydrateCrmHelpArticle(row)
}

export function getCrmHelpArticleBySlug(helpCenterId: number, slug: string): CrmHelpArticle | null {
  ensureHelpCenterSchema()
  const row = getDb().prepare(`
    SELECT a.*, COALESCE(a.workspace_id, hc.workspace_id) AS workspace_id
      FROM crm_help_articles a
      JOIN crm_help_centers hc ON hc.id = a.help_center_id
     WHERE a.help_center_id = ? AND a.slug = ?
  `).get(helpCenterId, slug) as Record<string, unknown> | undefined
  return hydrateCrmHelpArticle(row)
}

export function createCrmHelpArticle(helpCenterId: number, workspaceId: number, data: {
  title: string
  slug?: string
  excerpt?: string | null
  summary?: string | null
  body_markdown?: string
  body_html?: string
  collection_id?: number | null
  author_user_id?: number | null
  author_id?: number | null
  author_name?: string | null
  status?: HelpStatus
  meta_title?: string | null
  meta_description?: string | null
  related_article_ids?: number[] | null
}): CrmHelpArticle | null {
  ensureHelpCenterSchema()
  const center = getCrmHelpCenterById(helpCenterId, workspaceId)
  if (!center) return null
  const title = String(data.title || '').trim() || 'Untitled article'
  const excerpt = trimToNull(data.excerpt) ?? trimToNull(data.summary)
  const markdown = typeof data.body_markdown === 'string' ? data.body_markdown : ''
  const html = typeof data.body_html === 'string' ? data.body_html : ''
  const slug = ensureUniqueArticleSlug(helpCenterId, data.slug || title)
  const now = helpNow()
  const nowText = String(now)
  const status: HelpStatus = data.status || 'draft'
  const publishedAt = status === 'published' ? now : null
  const collection = data.collection_id ? getCrmHelpCollectionById(data.collection_id, workspaceId) : null
  const collectionId = collection && collection.help_center_id === helpCenterId ? collection.id : null
  const searchText = buildHelpSearchText(title, excerpt, markdown)
  const authorUserId = data.author_user_id ?? data.author_id ?? null
  const result = getDb().prepare(`
    INSERT INTO crm_help_articles (
      workspace_id, help_center_id, collection_id, title, slug, excerpt, summary,
      body_markdown, body_html,
      author_user_id, author_id, author_name,
      status, published_at, last_updated_at, updated_at_content,
      views, view_count, helpful_up, helpful_down, helpful_count, not_helpful_count,
      search_text_fts, meta_title, meta_description, related_article_ids_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    helpCenterId,
    collectionId,
    title,
    slug,
    excerpt,
    excerpt,
    markdown,
    html,
    authorUserId,
    authorUserId,
    trimToNull(data.author_name),
    status,
    publishedAt,
    now,
    now,
    searchText,
    trimToNull(data.meta_title),
    trimToNull(data.meta_description),
    data.related_article_ids && data.related_article_ids.length > 0 ? JSON.stringify(data.related_article_ids) : null,
    nowText,
    nowText,
  )
  return getCrmHelpArticleById(Number(result.lastInsertRowid), workspaceId)
}

export function updateCrmHelpArticle(id: number, workspaceId: number, data: Partial<{
  title: string
  slug: string
  excerpt: string | null
  summary: string | null
  body_markdown: string
  body_html: string
  collection_id: number | null
  status: HelpStatus
  meta_title: string | null
  meta_description: string | null
  related_article_ids: number[] | null
  author_user_id: number | null
  author_id: number | null
  author_name: string | null
  edited_by_user_id: number | null
  change_note: string | null
}>): CrmHelpArticle | null {
  ensureHelpCenterSchema()
  const existing = getCrmHelpArticleById(id, workspaceId)
  if (!existing) return null
  const sets: string[] = []
  const params: Array<string | number | null> = []
  const now = helpNow()
  const nowText = String(now)
  let contentChanged = false
  let title = existing.title
  let excerpt = existing.excerpt
  let markdown = existing.body_markdown

  if (data.title !== undefined) {
    title = data.title.trim() || 'Untitled article'
    sets.push('title = ?')
    params.push(title)
    contentChanged = contentChanged || title !== existing.title
  }
  if (data.slug !== undefined) {
    const slug = ensureUniqueArticleSlug(existing.help_center_id, data.slug, id)
    sets.push('slug = ?')
    params.push(slug)
  }
  if ('excerpt' in data || 'summary' in data) {
    excerpt = trimToNull(data.excerpt) ?? ('summary' in data ? trimToNull(data.summary) : existing.excerpt)
    sets.push('excerpt = ?', 'summary = ?')
    params.push(excerpt, excerpt)
    contentChanged = contentChanged || excerpt !== existing.excerpt
  }
  if (data.body_markdown !== undefined) {
    markdown = data.body_markdown
    sets.push('body_markdown = ?')
    params.push(data.body_markdown)
    contentChanged = contentChanged || data.body_markdown !== existing.body_markdown
  }
  if (data.body_html !== undefined) {
    sets.push('body_html = ?')
    params.push(data.body_html)
  }
  if ('collection_id' in data) {
    const collection = data.collection_id ? getCrmHelpCollectionById(data.collection_id, workspaceId) : null
    const collectionId = collection && collection.help_center_id === existing.help_center_id ? collection.id : null
    sets.push('collection_id = ?')
    params.push(collectionId)
  }
  if (data.status !== undefined) {
    sets.push('status = ?')
    params.push(data.status)
    if (data.status === 'published' && existing.status !== 'published') {
      sets.push('published_at = ?')
      params.push(now)
    }
  }
  if ('meta_title' in data) { sets.push('meta_title = ?'); params.push(trimToNull(data.meta_title)) }
  if ('meta_description' in data) { sets.push('meta_description = ?'); params.push(trimToNull(data.meta_description)) }
  if ('related_article_ids' in data) {
    sets.push('related_article_ids_json = ?')
    params.push(data.related_article_ids && data.related_article_ids.length > 0 ? JSON.stringify(data.related_article_ids) : null)
  }
  if ('author_user_id' in data || 'author_id' in data) {
    const authorUserId = data.author_user_id ?? data.author_id ?? null
    sets.push('author_user_id = ?', 'author_id = ?')
    params.push(authorUserId, authorUserId)
  }
  if ('author_name' in data) { sets.push('author_name = ?'); params.push(trimToNull(data.author_name)) }
  if (contentChanged) {
    sets.push('last_updated_at = ?', 'updated_at_content = ?', 'search_text_fts = ?')
    params.push(now, now, buildHelpSearchText(title, excerpt, markdown))
  }
  if (!sets.length) return existing
  sets.push('updated_at = ?')
  params.push(nowText, id)
  getDb().prepare(`UPDATE crm_help_articles SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  if (contentChanged) {
    try {
      const prev = getDb().prepare(
        'SELECT COALESCE(MAX(version_number), 0) AS max FROM crm_help_article_versions WHERE article_id = ?'
      ).get(id) as { max: number }
      getDb().prepare(`
        INSERT INTO crm_help_article_versions (article_id, version_number, body_markdown, edited_by_user_id, edited_at, change_note)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        (prev?.max || 0) + 1,
        existing.body_markdown,
        data.edited_by_user_id || null,
        now,
        trimToNull(data.change_note),
      )
    } catch {}
  }

  return getCrmHelpArticleById(id, workspaceId)
}

export function deleteCrmHelpArticle(id: number, workspaceId: number): boolean {
  ensureHelpCenterSchema()
  const existing = getCrmHelpArticleById(id, workspaceId)
  if (!existing) return false
  return getDb().prepare('DELETE FROM crm_help_articles WHERE id = ?').run(id).changes > 0
}

export function incrementCrmHelpArticleViews(articleId: number): void {
  ensureHelpCenterSchema()
  try {
    getDb().prepare('UPDATE crm_help_articles SET views = views + 1, view_count = view_count + 1 WHERE id = ?').run(articleId)
  } catch {}
}

export function recordCrmHelpArticleView(data: { articleId: number; sessionId: string }): CrmHelpArticleView | null {
  ensureHelpCenterSchema()
  const article = getDb().prepare(`
    SELECT a.*, COALESCE(a.workspace_id, hc.workspace_id) AS workspace_id
      FROM crm_help_articles a
      JOIN crm_help_centers hc ON hc.id = a.help_center_id
     WHERE a.id = ?
  `).get(data.articleId) as Record<string, unknown> | undefined
  if (!article) return null
  const nowText = helpNowText()
  const result = getDb().prepare(`
    INSERT INTO crm_help_article_views (workspace_id, article_id, session_id, viewed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    Number(article.workspace_id || 0),
    data.articleId,
    data.sessionId.trim().slice(0, 128),
    nowText,
    nowText,
    nowText,
  )
  incrementCrmHelpArticleViews(data.articleId)
  const row = getDb().prepare('SELECT * FROM crm_help_article_views WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: Number(row.id || 0),
    workspace_id: Number(row.workspace_id || 0),
    article_id: Number(row.article_id || 0),
    session_id: String(row.session_id || ''),
    viewed_at: toHelpTimestamp(row.viewed_at),
    created_at: toHelpTimestamp(row.created_at),
    updated_at: toHelpTimestamp(row.updated_at),
  }
}

export function registerCrmHelpFeedback(data: {
  articleId: number
  helpful: boolean
  comment?: string | null
  contactId?: number | null
  ipHash?: string | null
}): CrmHelpFeedback | null {
  ensureHelpCenterSchema()
  const article = getDb().prepare(`
    SELECT a.*, COALESCE(a.workspace_id, hc.workspace_id) AS workspace_id
      FROM crm_help_articles a
      JOIN crm_help_centers hc ON hc.id = a.help_center_id
     WHERE a.id = ?
  `).get(data.articleId) as Record<string, unknown> | undefined
  if (!article) return null
  const nowText = helpNowText()
  const result = getDb().prepare(`
    INSERT INTO crm_help_feedback (workspace_id, article_id, helpful, comment, contact_id, ip_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(article.workspace_id || 0),
    data.articleId,
    data.helpful ? 1 : 0,
    trimToNull(data.comment),
    data.contactId || null,
    trimToNull(data.ipHash),
    nowText,
    nowText,
  )
  if (data.helpful) {
    getDb().prepare('UPDATE crm_help_articles SET helpful_up = helpful_up + 1, helpful_count = helpful_count + 1 WHERE id = ?').run(data.articleId)
  } else {
    getDb().prepare('UPDATE crm_help_articles SET helpful_down = helpful_down + 1, not_helpful_count = not_helpful_count + 1 WHERE id = ?').run(data.articleId)
  }
  const row = getDb().prepare('SELECT * FROM crm_help_feedback WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: Number(row.id || 0),
    workspace_id: Number(row.workspace_id || 0),
    article_id: Number(row.article_id || 0),
    helpful: Number(row.helpful || 0),
    comment: trimToNull(row.comment),
    contact_id: row.contact_id === null || row.contact_id === undefined ? null : Number(row.contact_id),
    ip_hash: trimToNull(row.ip_hash),
    created_at: toHelpTimestamp(row.created_at),
  }
}

export function listCrmHelpArticleVersions(articleId: number, workspaceId: number): CrmHelpArticleVersion[] {
  ensureHelpCenterSchema()
  if (!getCrmHelpArticleById(articleId, workspaceId)) return []
  const rows = getDb().prepare(
    'SELECT * FROM crm_help_article_versions WHERE article_id = ? ORDER BY version_number DESC'
  ).all(articleId) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpArticleVersion(row)).filter(Boolean) as CrmHelpArticleVersion[]
}

export function searchCrmHelpArticles(helpCenterId: number, query: string, opts?: { limit?: number }): HelpSearchHit[] {
  ensureHelpCenterSchema()
  const raw = String(query ?? '').trim().toLowerCase()
  if (!raw) return []
  const tokens = raw.split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const articles = listPublishedCrmHelpArticles(helpCenterId, { limit: Math.max(50, opts?.limit ?? 50) })
  const hits: HelpSearchHit[] = []
  for (const article of articles) {
    const haystack = `${article.title}\n${article.excerpt || ''}\n${article.search_text_fts || ''}`.toLowerCase()
    let score = 0
    if (article.title.toLowerCase() === raw) score += 12
    for (const token of tokens) {
      if (article.title.toLowerCase().includes(token)) score += 6
      if ((article.excerpt || '').toLowerCase().includes(token)) score += 3
      if (haystack.includes(token)) score += 1
    }
    if (score === 0) continue
    const viewBoost = Math.sqrt(Math.max(1, article.views + 1))
    const sourceText = stripHelpSearchText(article.body_markdown)
    const snippetSource = article.excerpt || sourceText
    const firstIndex = sourceText.toLowerCase().indexOf(tokens[0])
    const snippet = firstIndex >= 0
      ? sourceText.slice(Math.max(0, firstIndex - 70), Math.min(sourceText.length, firstIndex + 170)).trim()
      : snippetSource.slice(0, 180).trim()
    hits.push({ article, score: score * viewBoost, snippet })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, Math.max(1, Math.floor(opts?.limit ?? 20)))
}

export function recordCrmHelpSearchQuery(data: {
  helpCenterId: number
  query: string
  resultsCount: number
  clickedArticleId?: number | null
  contactId?: number | null
  sessionId?: string | null
}): void {
  ensureHelpCenterSchema()
  try {
    const center = getDb().prepare('SELECT workspace_id FROM crm_help_centers WHERE id = ?').get(data.helpCenterId) as { workspace_id: number } | undefined
    if (!center) return
    const nowText = helpNowText()
    getDb().prepare(`
      INSERT INTO crm_help_search_queries (workspace_id, help_center_id, query, results_count, clicked_article_id, contact_id, session_id, searched_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      center.workspace_id,
      data.helpCenterId,
      String(data.query).trim().slice(0, 500),
      Math.max(0, Math.floor(data.resultsCount)),
      data.clickedArticleId || null,
      data.contactId || null,
      trimToNull(data.sessionId),
      helpNow(),
      nowText,
      nowText,
    )
  } catch {}
}

export function recordCrmHelpAiQuery(data: {
  helpCenterId: number
  query: string
  answerJson: string
  contactId?: number | null
}): CrmHelpAiQuery | null {
  ensureHelpCenterSchema()
  const center = getDb().prepare('SELECT workspace_id FROM crm_help_centers WHERE id = ?').get(data.helpCenterId) as { workspace_id: number } | undefined
  if (!center) return null
  const nowText = helpNowText()
  const result = getDb().prepare(`
    INSERT INTO crm_help_ai_queries (workspace_id, help_center_id, query, answer_json, contact_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    center.workspace_id,
    data.helpCenterId,
    String(data.query).trim().slice(0, 1000),
    data.answerJson,
    data.contactId || null,
    nowText,
    nowText,
  )
  const row = getDb().prepare('SELECT * FROM crm_help_ai_queries WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: Number(row.id || 0),
    workspace_id: Number(row.workspace_id || 0),
    help_center_id: Number(row.help_center_id || 0),
    query: String(row.query || ''),
    answer_json: String(row.answer_json || ''),
    contact_id: row.contact_id === null || row.contact_id === undefined ? null : Number(row.contact_id),
    created_at: toHelpTimestamp(row.created_at),
    updated_at: toHelpTimestamp(row.updated_at),
  }
}

export function getCrmHelpTopSearches(helpCenterId: number, workspaceId: number, limit = 20): Array<{ query: string; count: number; zero_result_count: number }> {
  ensureHelpCenterSchema()
  if (!getCrmHelpCenterById(helpCenterId, workspaceId)) return []
  return getDb().prepare(`
    SELECT query,
           COUNT(*) AS count,
           SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) AS zero_result_count
      FROM crm_help_search_queries
     WHERE help_center_id = ?
     GROUP BY LOWER(query)
     ORDER BY count DESC, query ASC
     LIMIT ?
  `).all(helpCenterId, Math.max(1, Math.floor(limit))) as Array<{ query: string; count: number; zero_result_count: number }>
}

export function getCrmHelpFailedSearches(helpCenterId: number, workspaceId: number, limit = 20): Array<{ query: string; count: number; last_searched_at: number }> {
  ensureHelpCenterSchema()
  if (!getCrmHelpCenterById(helpCenterId, workspaceId)) return []
  const rows = getDb().prepare(`
    SELECT query,
           COUNT(*) AS count,
           MAX(searched_at) AS last_searched_at
      FROM crm_help_search_queries
     WHERE help_center_id = ? AND results_count = 0
     GROUP BY LOWER(query)
     ORDER BY count DESC, last_searched_at DESC
     LIMIT ?
  `).all(helpCenterId, Math.max(1, Math.floor(limit))) as Array<{ query: string; count: number; last_searched_at: number }>
  return rows.map((row) => ({ ...row, last_searched_at: Number(row.last_searched_at || 0) }))
}

export function getCrmHelpCenterStats(helpCenterId: number, workspaceId: number): {
  articles_total: number
  articles_published: number
  articles_draft: number
  total_views: number
  views_last_30d: number
  total_searches: number
  zero_result_searches: number
  helpful_ratio: number | null
  avg_helpful_ratio: number | null
} | null {
  ensureHelpCenterSchema()
  if (!getCrmHelpCenterById(helpCenterId, workspaceId)) return null
  const articleStats = getDb().prepare(`
    SELECT
      COUNT(*) AS articles_total,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS articles_published,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS articles_draft,
      COALESCE(SUM(COALESCE(views, view_count, 0)), 0) AS total_views,
      COALESCE(SUM(COALESCE(helpful_up, helpful_count, 0)), 0) AS helpful_sum,
      COALESCE(SUM(COALESCE(helpful_down, not_helpful_count, 0)), 0) AS not_helpful_sum
    FROM crm_help_articles
    WHERE help_center_id = ?
  `).get(helpCenterId) as {
    articles_total: number
    articles_published: number
    articles_draft: number
    total_views: number
    helpful_sum: number
    not_helpful_sum: number
  }
  const searchStats = getDb().prepare(`
    SELECT
      COUNT(*) AS total_searches,
      SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) AS zero_result_searches
    FROM crm_help_search_queries
    WHERE help_center_id = ?
  `).get(helpCenterId) as { total_searches: number; zero_result_searches: number }
  const recentViews = getDb().prepare(`
    SELECT COUNT(*) AS views_last_30d
      FROM crm_help_article_views v
      JOIN crm_help_articles a ON a.id = v.article_id
     WHERE a.help_center_id = ?
       AND CAST(v.viewed_at AS INTEGER) >= ?
  `).get(helpCenterId, helpNow() - (30 * 24 * 60 * 60)) as { views_last_30d: number }
  const feedbackTotal = Number(articleStats.helpful_sum || 0) + Number(articleStats.not_helpful_sum || 0)
  const ratio = feedbackTotal > 0 ? Number(articleStats.helpful_sum || 0) / feedbackTotal : null
  return {
    articles_total: Number(articleStats.articles_total || 0),
    articles_published: Number(articleStats.articles_published || 0),
    articles_draft: Number(articleStats.articles_draft || 0),
    total_views: Number(articleStats.total_views || 0),
    views_last_30d: Number(recentViews.views_last_30d || 0),
    total_searches: Number(searchStats.total_searches || 0),
    zero_result_searches: Number(searchStats.zero_result_searches || 0),
    helpful_ratio: ratio,
    avg_helpful_ratio: ratio,
  }
}

export function getCrmHelpMostViewedArticles(helpCenterId: number, workspaceId: number, limit = 10): CrmHelpArticle[] {
  ensureHelpCenterSchema()
  if (!getCrmHelpCenterById(helpCenterId, workspaceId)) return []
  const rows = getDb().prepare(`
    SELECT a.*, COALESCE(a.workspace_id, hc.workspace_id) AS workspace_id
      FROM crm_help_articles a
      JOIN crm_help_centers hc ON hc.id = a.help_center_id
     WHERE a.help_center_id = ?
     ORDER BY COALESCE(a.views, a.view_count, 0) DESC,
              COALESCE(a.helpful_up, a.helpful_count, 0) DESC,
              COALESCE(a.last_updated_at, a.updated_at_content, CAST(a.updated_at AS INTEGER)) DESC
     LIMIT ?
  `).all(helpCenterId, Math.max(1, Math.floor(limit))) as Record<string, unknown>[]
  return rows.map((row) => hydrateCrmHelpArticle(row)).filter(Boolean) as CrmHelpArticle[]
}

export function hasCrmTicketsTable(): boolean {
  ensureHelpCenterSchema()
  try {
    const row = getDb().prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'crm_tickets' LIMIT 1").get() as { ok?: number } | undefined
    return Boolean(row?.ok)
  } catch {
    return false
  }
}
