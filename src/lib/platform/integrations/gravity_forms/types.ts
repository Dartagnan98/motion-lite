// Gravity Forms adapter — provider-specific raw types.
//
// Reference: https://docs.gravityforms.com/rest-api-v2/
// API base: <siteUrl>/wp-json/gf/v2/
//
// Auth: same as WordPress REST (Application Password basic auth).
// Gravity Forms REST API must be enabled in form admin:
//   Forms → Settings → REST API → "Enable access to the API" checked.
//
// Endpoints used:
//   GET  /wp-json/gf/v2/forms                  — list all forms (connect + picker)
//   GET  /wp-json/gf/v2/entries?form_ids=...   — list entries with search/paging
//
// Rate limiting: same as WordPress — no hard limit; 1 req/sec courtesy throttle.

// ─── Forms ────────────────────────────────────────────────────────────────────

/** A Gravity Forms form record from GET /gf/v2/forms. */
export interface GfForm {
  /** Numeric form ID (stored as string in GF API responses). */
  id: string
  /** Form display title, e.g. "Contact Us". */
  title: string
  /** Whether the form is active. */
  is_active: string | boolean  // GF returns "1"/"0" string or boolean depending on version
  /** Total entry count (all time, not period-filtered). */
  total_count?: number
  /** Entry count this month (optional — may not be present). */
  entry_count?: number
}

// ─── Entries ──────────────────────────────────────────────────────────────────

/** A Gravity Forms entry record. We only extract metadata; form field values
 *  are not used in Phase 2 metric calculations. */
export interface GfEntry {
  /** Entry ID. */
  id: string
  /** Form ID this entry belongs to. */
  form_id: string
  /** Entry creation date. ISO datetime string, e.g. "2026-04-15 14:30:00" (site local time). */
  date_created: string
  /** Entry status: "active", "spam", "trash". */
  status: string
}

/** Response shape from GET /gf/v2/entries.
 *
 *  GF returns a paginated response with entries and a total_count field.
 *  We use total_count directly for counts and only request per-day breakdowns
 *  via multiple paginated calls when building the daily series.
 */
export interface GfEntriesResponse {
  /** Numeric total count of all matching entries (not just this page). */
  total_count: number
  /** Entries in this page. */
  entries?: GfEntry[]
}

// ─── Raw snapshot ─────────────────────────────────────────────────────────────

/** Per-form breakdown built by fetchSnapshot. */
export interface GfFormBreakdown {
  formId: string
  formTitle: string
  entryCount: number
}

/** Per-day aggregation built by fetchSnapshot. */
export interface GfDailyCount {
  /** ISO date string YYYY-MM-DD. */
  date: string
  count: number
}

/** A single Gravity Forms field definition as returned by GET /forms/{id}. */
export interface GfFormField {
  id: number | string
  type: string                // 'text' | 'name' | 'email' | 'phone' | 'textarea' | ...
  label?: string
  inputs?: Array<{ id: string; label?: string }>  // name field has subinputs 1.3 (first) + 1.6 (last)
}

/** Map of standardized field roles to the GF field IDs that fulfill them.
 *  Built per form by inspecting the form's schema. */
export interface GfFieldMap {
  /** Top-level name field id (e.g. "1") — entry values typically at "1.3" + "1.6". */
  nameFieldId: string | null
  phoneFieldId: string | null
  emailFieldId: string | null
  /** First textarea field id — used as the "message" column. */
  messageFieldId: string | null
}

/** A detailed entry with resolved standard fields. Built during fetchSnapshot. */
export interface GfDetailedEntry {
  entryId: string
  formId: string
  formTitle: string
  /** Site-local datetime string from GF ("YYYY-MM-DD HH:MM:SS"). */
  dateCreated: string
  name: string | null
  phone: string | null
  email: string | null
  message: string | null
  /** Direct hyperlink to the WP admin entry view (auth-gated to agency staff). */
  entryUrl: string
}

/** Composite raw snapshot assembled by fetchSnapshot. */
export interface GravityFormsRawSnapshot {
  /** Canonical site URL. */
  siteUrl: string
  /** Period start date YYYY-MM-DD. */
  periodStart: string
  /** Period end date YYYY-MM-DD. */
  periodEnd: string
  /** Form IDs that were queried. Empty = all forms. */
  formIds: string[]
  /** Total entry count across all selected forms in the period. */
  totalEntries: number
  /** Per-form breakdown. */
  byForm: GfFormBreakdown[]
  /** Daily entry counts over the period. */
  daily: GfDailyCount[]
  /** Top 100 most recent entries with name/phone/email/message resolved.
   *  Sorted by dateCreated desc. */
  recentEntries: GfDetailedEntry[]
  /** Stamped server-side at fetch time. */
  fetchedAt: string  // ISO datetime
}
