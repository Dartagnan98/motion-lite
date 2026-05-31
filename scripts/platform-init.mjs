#!/usr/bin/env node
// One-shot: bootstrap the Hiilite Platform schema in the local SQLite DB.
// Useful for backend-architect's smoke test and for any developer who wants
// to verify the schema-on-boot pattern without running the Next.js server.
//
// Usage: node scripts/platform-init.mjs

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.resolve(__dirname, '..', '..', 'store', 'motion.db')

console.log(`[platform-init] DB: ${DB_PATH}`)

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Inline DDL because we cannot import TS from a .mjs script. MUST be byte-
// equivalent to src/lib/platform/schema.ts initPlatformSchema() — including
// every CHECK constraint. If you change one file, change the other in the
// same commit. (Phase 4 cutover replaces this with Postgres migrations.)

const ddl = [
  `CREATE TABLE IF NOT EXISTS platform_tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    external_tenant_ref TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS platform_agencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    logo_url TEXT,
    contact_info_json TEXT,
    subscription_tier TEXT NOT NULL DEFAULT 'free'
      CHECK (subscription_tier IN ('free','starter','pro','agency','enterprise')),
    max_accounts INTEGER NOT NULL DEFAULT 3,
    max_users INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','suspended','archived')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_agencies_tenant ON platform_agencies(tenant_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_agencies_tenant_slug ON platform_agencies(tenant_id, slug)`,
  `CREATE TABLE IF NOT EXISTS platform_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    agency_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    time_budget_hours REAL,
    settings_json TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','paused','archived')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id) REFERENCES platform_agencies(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_accounts_tenant ON platform_accounts(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_accounts_agency ON platform_accounts(agency_id)`,
  `CREATE TABLE IF NOT EXISTS platform_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    account_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    settings_json TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','paused','archived')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_domains_tenant ON platform_domains(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_domains_account ON platform_domains(account_id)`,
  `CREATE TABLE IF NOT EXISTS platform_integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    level TEXT NOT NULL CHECK (level IN ('agency','account','domain')),
    agency_id INTEGER,
    account_id INTEGER,
    domain_id INTEGER,
    provider TEXT NOT NULL,
    auth_model TEXT NOT NULL CHECK (auth_model IN ('oauth','api_key','basic_auth','token')),
    config_json TEXT,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected'
      CHECK (status IN ('connected','disconnected','error')),
    last_health_status TEXT CHECK (last_health_status IN ('green','yellow','red')),
    last_health_message TEXT,
    last_health_checked_at INTEGER,
    last_synced_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    /* exactly one of the three FKs is non-null and matches the level value */
    CHECK (
      (level = 'agency' AND agency_id IS NOT NULL AND account_id IS NULL AND domain_id IS NULL) OR
      (level = 'account' AND account_id IS NOT NULL AND agency_id IS NULL AND domain_id IS NULL) OR
      (level = 'domain' AND domain_id IS NOT NULL AND agency_id IS NULL AND account_id IS NULL)
    ),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id) REFERENCES platform_agencies(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (domain_id) REFERENCES platform_domains(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_integrations_tenant ON platform_integrations(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_integrations_provider ON platform_integrations(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_integrations_lookup ON platform_integrations(tenant_id, provider, status)`,
  `CREATE TABLE IF NOT EXISTS platform_oauth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    integration_id INTEGER NOT NULL UNIQUE,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    token_expiry INTEGER,
    provider_user_id TEXT,
    provider_email TEXT,
    scopes TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (integration_id) REFERENCES platform_integrations(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_oauth_tokens_tenant ON platform_oauth_tokens(tenant_id)`,
  `CREATE TABLE IF NOT EXISTS platform_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    integration_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    domain_id INTEGER,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    normalized_json TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    fetched_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (integration_id) REFERENCES platform_integrations(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (domain_id) REFERENCES platform_domains(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_snapshots_tenant ON platform_snapshots(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_snapshots_lookup ON platform_snapshots(integration_id, period_start, period_end)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_snapshots_account_period ON platform_snapshots(account_id, period_end DESC)`,
  `CREATE TABLE IF NOT EXISTS platform_report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    agency_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'custom',
    layout_json TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_by_user_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id) REFERENCES platform_agencies(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_report_templates_tenant ON platform_report_templates(tenant_id)`,
  `CREATE TABLE IF NOT EXISTS platform_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    account_id INTEGER NOT NULL,
    template_id INTEGER,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft','published','archived')),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    share_token TEXT,
    rendered_at INTEGER,
    created_by_user_id INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES platform_report_templates(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_reports_tenant ON platform_reports(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_reports_account ON platform_reports(account_id, period_end DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_reports_share_token ON platform_reports(share_token)`,
  `CREATE TABLE IF NOT EXISTS platform_report_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    report_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description_html TEXT,
    settings_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (report_id) REFERENCES platform_reports(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_report_sections_report ON platform_report_sections(report_id, position)`,
  `CREATE TABLE IF NOT EXISTS platform_report_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    section_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    block_type TEXT NOT NULL
      CHECK (block_type IN ('kpi','line_chart','bar_chart','table','text','ai_summary','image')),
    title TEXT,
    integration_id INTEGER,
    metric_slug TEXT,
    config_json TEXT,
    rendered_cache_json TEXT,
    rendered_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (section_id) REFERENCES platform_report_sections(id) ON DELETE CASCADE,
    FOREIGN KEY (integration_id) REFERENCES platform_integrations(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_report_blocks_section ON platform_report_blocks(section_id, position)`,
  `CREATE TABLE IF NOT EXISTS platform_agency_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    agency_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer'
      CHECK (role IN ('owner','admin','manager','viewer')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (agency_id) REFERENCES platform_agencies(id) ON DELETE CASCADE,
    UNIQUE (agency_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS platform_account_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    public_id TEXT NOT NULL UNIQUE,
    account_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer'
      CHECK (role IN ('manager','viewer')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
    UNIQUE (account_id, user_id)
  )`,
]

let created = 0
for (const sql of ddl) {
  try {
    db.exec(sql)
    if (sql.startsWith('CREATE TABLE')) created++
  } catch (e) {
    console.error('[platform-init] DDL failed:', e.message, '\n', sql.slice(0, 80))
  }
}

const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'platform_%' ORDER BY name"
).all()

console.log(`[platform-init] platform_* tables present: ${tables.length}`)
for (const t of tables) console.log(`  - ${t.name}`)
db.close()
