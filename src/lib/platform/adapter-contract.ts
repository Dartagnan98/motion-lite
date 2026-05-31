// Hiilite Platform — Integration Adapter Contract
//
// Every provider integration (GSC, GA4, PageSpeed, SE Ranking, WordPress,
// Gravity Forms, Asana, Everhour, Google Ads, Meta Ads, QuickBooks) ships
// an adapter that implements this contract. integrations-engineer fans this
// pattern out across the other 9 in Phase 2.
//
// Contract version: v1 (2026-05-08, locked at end of Sprint 1).
// Breaking changes require a migration plan + version bump documented in
// REFERENCES.md.
//
// Why this shape:
// - `connect` returns either a redirectUrl (OAuth) or an integrationId (key-based).
//   Caller (the OAuth callback or settings UI) decides what to do next.
// - `refresh` is idempotent. No-op for non-OAuth providers.
// - `fetchSnapshot` returns *raw* provider payload (RawT). The adapter does
//   NOT persist. Callers are responsible for the full sequence:
//       const raw  = await adapter.fetchSnapshot(args)
//       const norm = adapter.normalize(raw)
//       await snapshots.persistSnapshot({ raw, normalized: norm, ... })
//   See "Adapter caller contract" in REFERENCES.md.
// - `normalize` is a pure function from RawT → NormT. NormT is the canonical
//   metric envelope used by report blocks. Throws on schema drift. Callers
//   that want the normalized payload stored must call this before persisting.
// - `health` is the only sync probe; callers cache its output on the integration
//   row (last_health_status). Should be cheap (≤ 1s) — runs on dashboard load.
//
// Versioning rule: changing this file's exported types is a breaking change.
// Add new optional fields freely; remove or retype existing fields → bump version.

import type { IntegrationAuthModel, IntegrationProvider } from './types'

// ─── Health envelope ─────────────────────────────────────────────────

export type HealthStatus =
  | { status: 'green'; lastFetchedAt: Date }
  | {
      status: 'yellow'
      reason: 'stale' | 'rate_limited'
      lastFetchedAt?: Date
      message?: string
    }
  | {
      status: 'red'
      reason: 'auth_expired' | 'schema_drift' | 'transient_error' | 'not_configured'
      message: string
    }

// ─── Connect context ─────────────────────────────────────────────────

export interface ConnectContext {
  /** Active tenant — every adapter must scope its writes. */
  tenantId: number
  /** Which level the user is connecting at. */
  level: 'agency' | 'account' | 'domain'
  /** Exactly one of these is non-null and matches `level`. */
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  /** State the adapter wants returned in the OAuth callback. The vault
   *  bridges this into the `state` URL param. Adapter should sign or
   *  encode anything sensitive. */
  callbackState?: Record<string, string | number>
  /** Where the OAuth provider should redirect back to. */
  redirectUri: string
  /** Optional API-key payload for non-OAuth providers (basic_auth, token). */
  apiKey?: string
}

export interface ConnectResult {
  /** OAuth: where to send the browser. */
  redirectUrl?: string
  /** Direct connect (api_key, token, basic_auth): the new integration row id. */
  integrationId?: number
}

// ─── Fetch snapshot ──────────────────────────────────────────────────

export interface FetchSnapshotArgs {
  integrationId: number
  /** Always present — every snapshot belongs to an account. */
  accountId: number
  /** Domain-level fetches set this; account-level adapters ignore it. */
  domainId?: number | null
  period: { start: Date; end: Date }
}

// ─── Canonical metric envelope ───────────────────────────────────────
//
// Each adapter's NormT extends MetricEnvelope. The renderer reads `metrics`
// keyed by metric_slug (the `metric_slug` column on platform_report_blocks).
//
// Adapters define their own slug namespace, dot-separated:
//   "search_performance.clicks"
//   "search_performance.impressions"
//   "search_performance.ctr"
//   "search_performance.position"
//   "search_performance.top_queries"  → MetricSeries
//
// MetricValue covers single scalars; MetricSeries covers time-series or table data.

export interface MetricValue {
  /** Numeric or string scalar. Strings allow "rating: A" style values. */
  value: number | string
  /** Optional human label for the renderer ("Clicks (last 30d)"). */
  label?: string
  /** Unit hint for formatting. Current vocabulary:
   *    `'ms'`    — milliseconds (PageSpeed LCP, TBT, TTFB)
   *    `'%'`     — percentage (GA4 engagement/bounce rate, GSC CTR)
   *    `'USD'`   — dollar amounts (Ads spend)
   *    `'count'` — dimensionless number (users, sessions, tasks)
   *    `'hours'` — decimal hours (Everhour time-tracking) — added Phase 2 Sprint 2
   *    `'rank'`  — position / rank (GSC avg position)
   *  Keep the set small + stable. New providers: propose the unit before adding it. */
  unit?: 'ms' | '%' | 'USD' | 'count' | 'hours' | 'rank'
  /** Comparison value (period-over-period). Renderer computes delta + arrow. */
  comparison?: { value: number | string; period: 'previous_period' | 'previous_year' }
}

export interface MetricSeries {
  /** Series shape — drives chart axes and table columns. */
  columns: { key: string; label: string; type: 'string' | 'number' | 'date' | 'percent' | 'currency' }[]
  rows: Record<string, string | number | null>[]
  /** Optional metadata — e.g. timezone the date column is in. */
  meta?: Record<string, string | number>
}

export interface MetricEnvelope {
  /** Provider that produced this envelope. Useful for renderer hints + debug. */
  provider: IntegrationProvider
  /** Period covered. ISO date strings. */
  periodStart: string
  periodEnd: string
  /** Slug → metric. Slugs are stable across provider versions; raw_json is not. */
  metrics: Record<string, MetricValue | MetricSeries>
  /** Provider warnings the renderer surfaces ("data sampled at 99% confidence"). */
  warnings?: string[]
  /** When the adapter normalized this. Distinct from snapshot.fetched_at. */
  normalizedAt: string  // ISO datetime
}

// ─── The contract itself ─────────────────────────────────────────────

/**
 * Implement this for every provider. Keep the implementation in
 * `src/lib/platform/integrations/<provider>/adapter.ts`.
 *
 * Generic params:
 *   RawT — provider-specific payload shape (what fetchSnapshot returns)
 *   NormT — extends MetricEnvelope (what normalize returns)
 *
 * Locking note: the v1 shape is what GSC's adapter exercises end-to-end.
 * Any divergence found while implementing additional integrations should be
 * proposed via a contract-version bump, not a quiet shape change.
 */
export interface AdapterContract<RawT, NormT extends MetricEnvelope> {
  /** Must match the `provider` value on platform_integrations rows. */
  readonly provider: IntegrationProvider

  /** Auth flow this provider uses. Drives connect() behavior. */
  readonly authModel: IntegrationAuthModel

  /** Display name used in UI. */
  readonly displayName: string

  /** Begin the connect flow.
   *  - OAuth: returns redirectUrl, no integration row created yet.
   *           **Adapters with authModel === 'oauth' MUST sign the state param
   *           with `signState()` from ./state.ts (re-exported below) and the
   *           OAuth callback handler MUST verify with `verifyState()` before
   *           writing any rows. Unsigned state is a CSRF / cross-tenant
   *           write vector and is forbidden in this contract.**
   *  - api_key/token/basic_auth: synchronously creates the integration row + token
   */
  connect(ctx: ConnectContext): Promise<ConnectResult>

  /** Refresh the access token for an OAuth integration. No-op for others.
   *  Implementations should be idempotent and serialize concurrent calls per
   *  integrationId (motion-lite's google.ts pattern is a good reference). */
  refresh(integrationId: number): Promise<void>

  /** Pull last-N-days raw data for a specific account/domain.
   *  Caller decides the period; adapter respects provider rate limits.
   *
   *  **Persistence ownership**: this method does NOT write to
   *  `platform_snapshots`. The caller is responsible for the sequence
   *  `fetchSnapshot → normalize → persistSnapshot`. Adapter side effects
   *  are limited to (a) provider API calls and (b) updating the integration
   *  row's health/sync timestamps. See REFERENCES.md
   *  ("Adapter caller contract"). */
  fetchSnapshot(args: FetchSnapshotArgs): Promise<RawT>

  /** Pure: provider payload → canonical metric shape. Throws on schema drift
   *  (provider added/removed required fields). The thrown Error is surfaced
   *  via health() as `red:schema_drift`. */
  normalize(raw: RawT): NormT

  /** Cheap probe: is this connector live? Cache the result on the integration row. */
  health(integrationId: number): Promise<HealthStatus>
}

// ─── Helper: registry entry shape so we can look up adapters by provider ─

export interface AdapterRegistration<RawT, NormT extends MetricEnvelope> {
  provider: IntegrationProvider
  adapter: AdapterContract<RawT, NormT>
}

// integrations-engineer: register adapters in src/lib/platform/integrations/index.ts
// using a factory map. GSC reference impl in src/lib/platform/integrations/gsc/adapter.ts.

// ─── OAuth state signing (REQUIRED for authModel === 'oauth') ────────
//
// Re-exported here so adapters import everything they need from one place.
// See ./state.ts for the threat model + format. signState() produces an
// HMAC-bound `<b64u_payload>.<hex_hmac>` string; verifyState() returns the
// payload or null. Use them in connect() and the OAuth callback handler.

export { signState, verifyState } from './state'
