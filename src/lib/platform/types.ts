// Hiilite Platform — Canonical TypeScript types
//
// Source of truth: SharePoint `SPECS/code - specs/software-spec-document.md` §4.2
// Validated against `DEV/Database Copies/crm-db-2025-03-11.sql` (March 2025 prod dump).
//
// Naming notes (see schema.ts header for full delta log):
// - Spec calls the third tier "Domain"; production DB calls it "profile" (with `url` field).
//   We keep the spec name `Domain` for clarity and put the URL on the row.
// - Spec calls Phase-2 report container "Report" with sections in JSON; the wireframe
//   PDF uses a block-builder model (Section → Block). We model both: a Report row
//   owns Sections, each Section owns Blocks. Phase-1 GSC populates a Snapshot, which
//   any Section/Block can read.
//
// Multi-tenancy: every row carries `tenant_id` from day one. Phase 1-3 we run
// single-tenant in practice (one workspace = one tenant) but the column is present
// so Phase 4 Supabase + RLS slots in without a backfill.

// ─── Hierarchy ───────────────────────────────────────────────────────

/** Top of the 3-tier hierarchy. One row per Hiilite agency (or external customer). */
export interface Agency {
  id: number
  tenant_id: number
  public_id: string
  name: string
  /** URL-safe slug used in white-label paths and PDF filenames. */
  slug: string
  /** Optional cover/logo image URL, displayed on PDF reports + dashboard. */
  logo_url: string | null
  /** Free-form contact info (email, phone, address). JSON for forward-compat. */
  contact_info_json: string | null
  /** Subscription tier at the agency level. Phase 4+ controlled by Stripe. */
  subscription_tier: 'free' | 'starter' | 'pro' | 'agency' | 'enterprise'
  /** Hard caps from the tier (denormalized for fast reads). */
  max_accounts: number
  max_users: number
  /** soft delete + audit */
  status: 'active' | 'suspended' | 'archived'
  created_at: number
  updated_at: number
}

/** A client business managed by an agency. */
export interface Account {
  id: number
  tenant_id: number
  public_id: string
  agency_id: number
  name: string
  description: string | null
  /** Monthly retainer hours budgeted (used by Everhour/Hours-Invested section). */
  time_budget_hours: number | null
  /** Free-form arbitrary settings; reserve for non-load-bearing UI prefs. */
  settings_json: string | null
  status: 'active' | 'paused' | 'archived'
  created_at: number
  updated_at: number
}

/** A website/digital property owned by an account. Spec calls this "Domain";
 *  production DB calls it "profile". We use Domain. URL is the load-bearing field. */
export interface Domain {
  id: number
  tenant_id: number
  public_id: string
  account_id: number
  name: string
  /** The actual URL — e.g. "https://glenvalleydental.com". Required for
   *  GSC site-verification, GA4 property mapping, PageSpeed targets. */
  url: string
  description: string | null
  settings_json: string | null
  status: 'active' | 'paused' | 'archived'
  created_at: number
  updated_at: number
}

// ─── Integrations ────────────────────────────────────────────────────

/** Provider catalog. Add to this enum when integrations-engineer ships a new adapter. */
export type IntegrationProvider =
  | 'gsc'             // Google Search Console
  | 'ga4'             // Google Analytics 4
  | 'pagespeed'       // Google PageSpeed Insights
  | 'se_ranking'      // SE Ranking
  | 'wordpress'       // WordPress REST
  | 'gravity_forms'   // Gravity Forms
  | 'asana'           // Asana
  | 'everhour'        // Everhour (time tracking)
  | 'google_ads'      // Google Ads
  | 'meta_ads'        // Meta (Facebook/Instagram) Ads
  | 'qbo'             // QuickBooks Online (Phase 4, tenant/agency-level)

/** What level the integration attaches to. Some providers are agency-wide
 *  (QuickBooks, Everhour); most are account- or domain-level. */
export type IntegrationLevel = 'agency' | 'account' | 'domain'

/** What auth model the provider uses — drives the connect/refresh flow. */
export type IntegrationAuthModel = 'oauth' | 'api_key' | 'basic_auth' | 'token'

/** A configured integration row. Credentials live in `platform_oauth_tokens`,
 *  not on this row, so a single integration can rotate tokens without
 *  losing health-history. */
export interface Integration {
  id: number
  tenant_id: number
  public_id: string
  /** Which scope this attaches to. Exactly one of agency_id/account_id/domain_id is set. */
  level: IntegrationLevel
  agency_id: number | null
  account_id: number | null
  domain_id: number | null
  provider: IntegrationProvider
  auth_model: IntegrationAuthModel
  /** Provider-specific identifiers (GSC site URL, GA4 property ID, etc.).
   *  Stored as JSON so each adapter shapes it. NEVER put secrets here. */
  config_json: string | null
  /** Display name override — defaults to provider label. */
  display_name: string | null
  status: 'connected' | 'disconnected' | 'error'
  last_health_status: 'green' | 'yellow' | 'red' | null
  last_health_message: string | null
  last_health_checked_at: number | null
  last_synced_at: number | null
  created_at: number
  updated_at: number
}

/** OAuth/API credentials for a configured integration. Tokens are encrypted
 *  at rest using `vault.ts` (AES-256-GCM via crm-crypto). One row per
 *  (tenant, integration). Refresh updates this row in place. */
export interface OAuthToken {
  id: number
  tenant_id: number
  integration_id: number
  /** Encrypted access token. Use vault.decryptToken to read. */
  access_token_encrypted: string
  /** Encrypted refresh token (null for non-OAuth providers like API-key). */
  refresh_token_encrypted: string | null
  /** Unix-seconds expiry of the access token. NULL for non-expiring API keys. */
  token_expiry: number | null
  /** Provider-issued user/account identifier (e.g. Google email, GA4 account ID). */
  provider_user_id: string | null
  provider_email: string | null
  /** Granted OAuth scopes; comma-separated. */
  scopes: string | null
  created_at: number
  updated_at: number
}

// ─── Snapshots (raw + normalized integration data) ───────────────────

/** A timestamped pull from a provider for a (account, domain?, period).
 *  Holds both the raw payload (for replay/debug) and the normalized shape
 *  the report renderer reads. Snapshots are immutable; new pulls insert
 *  new rows. The dashboard typically reads the latest per (integration, period). */
export interface Snapshot {
  id: number
  tenant_id: number
  public_id: string
  integration_id: number
  account_id: number
  domain_id: number | null
  /** Period covered by this snapshot. Inclusive on both ends. */
  period_start: string  // ISO date 'YYYY-MM-DD'
  period_end: string    // ISO date 'YYYY-MM-DD'
  /** Provider-shaped payload as returned by fetchSnapshot(). JSON-encoded. */
  raw_json: string
  /** Adapter.normalize(raw) output. JSON-encoded. Shape is provider-specific
   *  but adheres to the canonical metric envelope (see normalize functions). */
  normalized_json: string
  /** Bytes of raw_json + normalized_json — used to alert on payload bloat. */
  size_bytes: number
  /** When the fetch ran. Distinct from period_end because we may pull yesterday's
   *  data for a period that ends today. */
  fetched_at: number
  created_at: number
  updated_at: number
}

// ─── Reports + builder (Section/Block) ───────────────────────────────

/** Reusable template — "SEO Retainer Report", "Quarterly Business Review", etc.
 *  When a PM clicks "New Report from Template", we clone the template's sections
 *  and blocks into the new report. */
export interface ReportTemplate {
  id: number
  tenant_id: number
  public_id: string
  /** NULL means a Hiilite-system template visible to all tenants. */
  agency_id: number | null
  name: string
  description: string | null
  /** "seo_retainer" | "quarterly_review" | "monthly_marketing" | custom slug */
  category: string
  /** Default section/block layout, stored as JSON for fast clone. Authoritative
   *  copy of sections/blocks lives in their own tables once a report is created. */
  layout_json: string
  is_system: number  // 0 | 1
  created_by_user_id: number | null
  created_at: number
  updated_at: number
}

/** A concrete generated report. Bound to one account and a date range. */
export interface Report {
  id: number
  tenant_id: number
  public_id: string
  account_id: number
  /** Optional template this report was created from. */
  template_id: number | null
  name: string
  /** "draft" → PM editing; "published" → shareable; "archived" → hidden but kept. */
  status: 'draft' | 'published' | 'archived'
  /** Period this report covers. Used by section blocks to scope their snapshots. */
  period_start: string  // ISO date
  period_end: string    // ISO date
  /** Explicit comparison window (GA-style picker "Compare" toggle). Both set =
   *  use this for PoP deltas + header "Compared to" caption. Both null = the
   *  renderer auto-computes the same-length window immediately before period_start. */
  compare_period_start: string | null  // ISO date | null
  compare_period_end: string | null    // ISO date | null
  /** Public share URL token (sliding-secret style). Reset by clicking "regenerate link". */
  share_token: string | null
  /** Last time the renderer regenerated PDF/HTML. */
  rendered_at: number | null
  created_by_user_id: number | null
  created_at: number
  updated_at: number
}

/** A grouped set of blocks inside a report. Maps to a wireframe page section
 *  ("Search Performance", "Form Conversions", etc.). */
export interface ReportSection {
  id: number
  tenant_id: number
  public_id: string
  report_id: number
  /** Sort key for ordering within the report. */
  position: number
  title: string
  /** Optional intro copy shown above the blocks. Tiptap HTML. */
  description_html: string | null
  /** Section-level config (e.g. "compare to previous period: true"). JSON. */
  settings_json: string | null
  /** Discriminator for the section renderer (e.g. 'search_performance'). */
  section_type?: string | null
  /** 1 = hidden from PDF + public share view (reversible, not a delete). */
  is_hidden?: number
  created_at: number
  updated_at: number
}

/** A single rendered block (chart, table, KPI tile, AI-summary, etc.) inside a section.
 *  Each block names which integration + which metric envelope it consumes. */
export type ReportBlockType =
  | 'kpi'
  | 'line_chart'
  | 'bar_chart'
  | 'table'
  | 'text'           // Tiptap HTML
  | 'ai_summary'     // Anthropic-generated narrative
  | 'image'

export interface ReportBlock {
  id: number
  tenant_id: number
  public_id: string
  section_id: number
  position: number
  block_type: ReportBlockType
  title: string | null
  /** Which integration row provides this block's data (NULL for text/image). */
  integration_id: number | null
  /** Which metric this block reads — adapter-defined slug, e.g. "search_performance.clicks". */
  metric_slug: string | null
  /** Block-type-specific config (chart axes, KPI comparison toggle, AI prompt template).
   *  JSON. Renderer is responsible for shape validation per block_type. */
  config_json: string | null
  /** Cached rendered output for fast re-render (HTML or JSON). Refresh on snapshot update. */
  rendered_cache_json: string | null
  rendered_at: number | null
  created_at: number
  updated_at: number
}

// ─── User <-> hierarchy joins (lightweight membership; full RBAC at Phase 4) ─

/** Maps a motion-lite user to an agency they can access, with a role. */
export interface AgencyUser {
  id: number
  tenant_id: number
  agency_id: number
  user_id: number
  role: 'owner' | 'admin' | 'manager' | 'viewer'
  created_at: number
  updated_at: number
}

/** Maps a motion-lite user to a single account inside an agency. Used for
 *  PMs who only see their own clients. */
export interface AccountUser {
  id: number
  tenant_id: number
  account_id: number
  user_id: number
  role: 'manager' | 'viewer'
  created_at: number
  updated_at: number
}
