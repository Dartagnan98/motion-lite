// Hiilite Platform — Schema-on-boot
//
// Mirrors motion-lite's pattern: idempotent CREATE TABLE IF NOT EXISTS,
// every ALTER TABLE wrapped in try/catch so old DBs upgrade safely without
// blocking app boot.
//
// Schema is Postgres-compatible by design (no SQLite-only types). When we
// migrate to Supabase at Phase 4, this same DDL — with INTEGER PRIMARY KEY
// AUTOINCREMENT swapped to BIGSERIAL and `strftime` swapped to NOW() — runs
// on Postgres. Avoid SQLite-only features here.
//
// Multi-tenancy: every table carries `tenant_id`. Phase 1-3 the tenant is
// derived from motion-lite's active workspace (see tenant.ts). Phase 4 the
// tenant is the agency, enforced by Supabase RLS.
//
// ─── Spec vs production-DB delta ──────────────────────────────────────
// (Source: SharePoint software-spec-document.md §4.2 + crm-db-2025-03-11.sql)
//
// 1. Spec entity "Domain" → production table is `profiles` with a `url` column.
//    DECISION: keep spec name "platform_domains". Carry `url` field. Document.
// 2. Spec entity "Insight" exists; we defer until Phase 4 (AI insights phase).
// 3. Spec "Report.data" is a JSON blob; we model Section/Block tables for the
//    block-builder UI per the wireframe PDF. Snapshot rows hold raw provider data.
// 4. Production `integrations.key1/key2` is plaintext-credential antipattern.
//    REPLACED with platform_oauth_tokens (encrypted at rest via vault.ts).
// 5. Production `integrations.table` enum + 3 nullable FKs is preserved as the
//    polymorphic shape (level + agency_id/account_id/domain_id), now with a
//    CHECK constraint to keep exactly one set.
// ─────────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3'

/** Apply all platform_* CREATE TABLE statements. Idempotent. Call from getDb()
 *  bootstrap or from a top-level startup hook in motion-lite. */
export function initPlatformSchema(db: Database.Database): void {
  // ─── Tenants (a thin record of "who owns these rows"). In Phase 1-3 there
  //     is one tenant row per motion-lite workspace; Phase 4 it's the agency. ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      /* When we cut over to Supabase, this column maps to the auth tenant id. */
      external_tenant_ref TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `)

  // ─── Agency (top of 3-tier hierarchy) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_agencies (
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
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_agencies_tenant ON platform_agencies(tenant_id)`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_agencies_tenant_slug ON platform_agencies(tenant_id, slug)`)

  // ─── Account (legacy table — DROPPED by Phase C consolidation) ──
  // Phase C: client_profiles is the canonical account record. We keep this
  // CREATE TABLE for DBs that haven't yet run scripts/consolidate-platform-accounts.mjs
  // (so the Phase B FK link + backfill script keeps working). Once the
  // consolidation script drops the table, the gate below skips re-creation.
  //
  // Gate: if client_profiles.tenant_id column exists AND platform_accounts table
  // does not, the DB has been Phase-C-migrated — skip the legacy CREATE TABLE.
  const cpHasTenantId = (() => {
    try {
      const cols = db.prepare(`PRAGMA table_info(client_profiles)`).all() as { name: string }[]
      return cols.some(c => c.name === 'tenant_id')
    } catch { return false }
  })()
  const paTableExists = (() => {
    try {
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='platform_accounts'`
      ).get() as { name: string } | undefined
      return !!row
    } catch { return false }
  })()
  const phaseCMigrated = cpHasTenantId && !paTableExists
  if (!phaseCMigrated) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_accounts (
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
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_accounts_tenant ON platform_accounts(tenant_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_accounts_agency ON platform_accounts(agency_id)`)
  }

  // ─── Domain (a website/property under an account) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_domains (
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
      FOREIGN KEY (account_id) REFERENCES client_profiles(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_domains_tenant ON platform_domains(tenant_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_domains_account ON platform_domains(account_id)`)

  // ─── Integrations (configured provider connections) ──
  // Polymorphic to one of agency/account/domain. CHECK enforces "exactly one".
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_integrations (
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
      FOREIGN KEY (account_id) REFERENCES client_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (domain_id) REFERENCES platform_domains(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_integrations_tenant ON platform_integrations(tenant_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_integrations_provider ON platform_integrations(provider)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_integrations_lookup ON platform_integrations(tenant_id, provider, status)`)

  // ─── OAuth tokens — encrypted at rest. One row per integration. ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_oauth_tokens (
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
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_oauth_tokens_tenant ON platform_oauth_tokens(tenant_id)`)

  // Tenant-level shared credentials (CONNECTOR-REUSE-PLAN A1). One row per
  // (tenant, provider, identity) so a single agency Google login / API key is
  // reused across every client — no re-auth / re-paste per client. Integrations
  // reference one via platform_integrations.tenant_credential_id; when that's
  // null the integration falls back to its own platform_oauth_tokens row
  // (backward compatible — existing connections are untouched).
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_tenant_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      provider TEXT NOT NULL,                 -- 'google' | 'everhour' | 'se_ranking' | 'pagespeed' | 'asana' | ...
      auth_model TEXT NOT NULL,               -- 'oauth' | 'api_key'
      identity TEXT NOT NULL,                 -- provider_email (oauth) or a label (api_key)
      access_token_encrypted TEXT,            -- oauth
      refresh_token_encrypted TEXT,           -- oauth
      token_expiry INTEGER,                   -- oauth
      scopes TEXT,                            -- oauth
      api_key_encrypted TEXT,                 -- api_key
      provider_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(tenant_id, provider, identity),
      FOREIGN KEY (tenant_id) REFERENCES platform_tenants(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_tenant_credentials_tenant ON platform_tenant_credentials(tenant_id, provider)`)

  // Integrations may point at a shared tenant credential (null = use own token).
  try {
    db.exec(`ALTER TABLE platform_integrations ADD COLUMN tenant_credential_id INTEGER`)
  } catch { /* column already exists */ }

  // ─── Snapshots (raw + normalized provider data) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_snapshots (
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
      FOREIGN KEY (account_id) REFERENCES client_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (domain_id) REFERENCES platform_domains(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_snapshots_tenant ON platform_snapshots(tenant_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_snapshots_lookup ON platform_snapshots(integration_id, period_start, period_end)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_snapshots_account_period ON platform_snapshots(account_id, period_end DESC)`)

  // ─── Report templates (clonable layouts) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_report_templates (
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
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_report_templates_tenant ON platform_report_templates(tenant_id)`)

  // ─── Reports (concrete generated reports) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_reports (
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
      FOREIGN KEY (account_id) REFERENCES client_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES platform_report_templates(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_reports_tenant ON platform_reports(tenant_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_reports_account ON platform_reports(account_id, period_end DESC)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_reports_share_token ON platform_reports(share_token)`)

  // ─── Report sections (ordered groups inside a report) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_report_sections (
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
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_report_sections_report ON platform_report_sections(report_id, position)`)

  // ─── Report blocks (individual content cells inside a section) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_report_blocks (
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
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_report_blocks_section ON platform_report_blocks(section_id, position)`)

  // ─── Membership tables (lightweight; full RBAC at Phase 4 with WorkOS/Clerk) ──
  // public_id present on join tables too — handoff schema rule says every
  // platform_* table has one, no exceptions. URL-safe random per row.
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_agency_users (
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
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_account_users (
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
      FOREIGN KEY (account_id) REFERENCES client_profiles(id) ON DELETE CASCADE,
      UNIQUE (account_id, user_id)
    )
  `)

  // ─── Additive ALTERs go below this line ──────────────────────────
  // Wrap each in try/catch. Pattern: every new column shipped post-launch
  // gets both a fresh-DB CREATE TABLE addition above AND a try/catch ALTER
  // here so existing DBs upgrade in place.
  // ─────────────────────────────────────────────────────────────────

  // Sprint 3 convergence (Phase B): link platform_accounts to client_profiles via FK.
  // Existing rows have client_profile_id = NULL until backfill script runs.
  // Phase C drops platform_accounts once all callers migrate to client_profiles.id.
  // The ALTER below remains for DBs that pre-date Phase C consolidation; it's a
  // no-op on Phase-C-migrated DBs (platform_accounts no longer exists, ALTER fails silently).
  try {
    db.exec(`ALTER TABLE platform_accounts ADD COLUMN client_profile_id INTEGER REFERENCES client_profiles(id) ON DELETE SET NULL`)
  } catch { /* column already exists or table dropped */ }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_accounts_client_profile ON platform_accounts(client_profile_id)`)
  } catch { /* index already exists or table dropped */ }

  // Sprint 3 Phase C: promote client_profiles to canonical platform account record.
  // platform_accounts gets dropped by scripts/consolidate-platform-accounts.mjs after
  // these columns are populated. CRM-only client_profiles (no platform footprint)
  // keep tenant_id = NULL and are excluded from platform queries via WHERE tenant_id IS NOT NULL.
  try {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN tenant_id INTEGER REFERENCES platform_tenants(id)`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN platform_public_id TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_client_profiles_platform_public_id ON client_profiles(platform_public_id) WHERE platform_public_id IS NOT NULL`)
  } catch { /* index already exists or legacy SQLite */ }
  try {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN agency_id INTEGER REFERENCES platform_agencies(id) ON DELETE SET NULL`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN platform_status TEXT DEFAULT 'active'`)
  } catch { /* column already exists */ }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_client_profiles_tenant ON client_profiles(tenant_id)`)
  } catch { /* index already exists */ }

  // Sprint 3: add section_type column to platform_report_sections.
  // Discriminator for the section dispatcher — lets the renderer prefer
  // explicit type over slug-prefix fallback for backward compat.
  try {
    db.exec(`ALTER TABLE platform_report_sections ADD COLUMN section_type TEXT`)
  } catch { /* column already exists */ }

  // Section visibility: PM can hide a section from the PDF + public share view
  // while keeping it in the report (reversible — NOT a delete, so the section
  // reconcile doesn't resurrect a removed one). 0 = visible, 1 = hidden.
  try {
    db.exec(`ALTER TABLE platform_report_sections ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`)
  } catch { /* column already exists */ }

  // Per-client report layout preference. JSON array of
  // { section_type, position, is_hidden } applied when seeding a new report or
  // when reconcile adds a section, so each client keeps its own section order +
  // visibility across future reports. Null until the PM first organizes.
  try {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN report_layout_json TEXT`)
  } catch { /* column already exists */ }

  // Phase 4 Sprint 1 — QBO mapping. qbo_customer_id links a client to its QBO
  // Customer (every financial query filters by it). qbo_class_id is RESERVED for
  // the per-project revenue fast-follow (Class-based attribution) — unused this
  // sprint. See HANDOFF-PHASE-4-SPRINT-1.md.
  try {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN qbo_customer_id TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN qbo_class_id TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_client_profiles_qbo_customer ON client_profiles(qbo_customer_id)`)
  } catch { /* index already exists */ }

  // Sprint 3: ensure public_share_token unique index exists for the
  // share_token column on platform_reports (column already in CREATE TABLE).
  // The CREATE TABLE already has: share_token TEXT and an index is already created.
  // No ALTER needed — column pre-dates Sprint 3. Index already exists.

  // Sprint 2: comment threads on report sections.
  // Comments are tenant-scoped; section_id null = report-level comment.
  // Soft-delete: body set to '_deleted_' sentinel, row kept for asana_task_gid trail.
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_report_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      report_id INTEGER NOT NULL,
      section_id INTEGER,
      author_user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      is_resolved INTEGER NOT NULL DEFAULT 0,
      asana_task_gid TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (report_id) REFERENCES platform_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (section_id) REFERENCES platform_report_sections(id) ON DELETE SET NULL
    )
  `)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_report_comments_report ON platform_report_comments(report_id)`)
  } catch { /* index already exists */ }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_report_comments_section ON platform_report_comments(report_id, section_id)`)
  } catch { /* index already exists */ }

  // Sprint 2: NPS responses — one per user per calendar month.
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_nps_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      score INTEGER NOT NULL CHECK(score >= 0 AND score <= 10),
      comment TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_platform_nps_responses_user ON platform_nps_responses(user_id, created_at DESC)`)
  } catch { /* index already exists */ }

  // Sprint 2: additive ALTERs for the tables already in CREATE TABLE above.
  // These run on DBs that existed before Sprint 2 was shipped.
  try {
    db.exec(`ALTER TABLE platform_report_comments ADD COLUMN asana_task_gid TEXT`)
  } catch { /* column already exists */ }

  // GA-style report period picker — explicit compare-window persistence.
  // NULL = inherit the auto-computed comparison (same-length window immediately
  // before period_start). Both set = use this explicit window for PoP deltas
  // and the header "Compared to" caption. App-layer enforces:
  //   - both columns set or both null (no half-set state)
  //   - compare_period_end < period_start (entirely before primary)
  // Back-compat: pre-existing reports keep NULL → auto-compute path.
  try {
    db.exec(`ALTER TABLE platform_reports ADD COLUMN compare_period_start TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE platform_reports ADD COLUMN compare_period_end TEXT`)
  } catch { /* column already exists */ }

  // Sprint 1 close-out: backfill public_id on membership tables for DBs
  // created before this column existed. Fresh DBs already have it from the
  // CREATE TABLE above. UNIQUE constraint can't be added via ALTER in SQLite,
  // so we add the column NOT NULL-less and rely on app-layer to populate +
  // a unique index added below; null rows will get backfilled lazily on next
  // membership write (acceptable for a Phase 1 single-tenant DB).
  try {
    db.exec(`ALTER TABLE platform_agency_users ADD COLUMN public_id TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`ALTER TABLE platform_account_users ADD COLUMN public_id TEXT`)
  } catch { /* column already exists */ }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_agency_users_public_id ON platform_agency_users(public_id) WHERE public_id IS NOT NULL`)
  } catch { /* legacy SQLite without partial index support */ }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_account_users_public_id ON platform_account_users(public_id) WHERE public_id IS NOT NULL`)
  } catch { /* legacy SQLite without partial index support */ }
}
