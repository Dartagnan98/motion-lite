// PageSpeed Insights adapter — implements AdapterContract<PageSpeedRawSnapshot, PageSpeedNormalized>.
//
// Auth model: api_key. No OAuth. The API key is stored per-integration in
// config_json (see README for the plaintext-at-rest decision rationale).
//
// connect() is a direct connect: the route handler validates the key + URL,
// writes the integration row, and returns integrationId. No redirect.
//
// Slice B (2026-05-27): fetches BOTH mobile + desktop in parallel per refetch.
// `config_json.strategy` is now optional/vestigial (stored for backward compat
// but ignored). Each refetch creates a new snapshot dated today (period_start =
// period_end = today's UTC date). The refetch route does NOT override the period
// for pagespeed — the normalizer owns its own date.
//
// Flow:
//   1. connect()       → validate key + URL → create integration row → return integrationId
//   2. fetchSnapshot() → read config_json → call PSI API (mobile + desktop in parallel) → return raw
//   3. normalize()     → pure PageSpeedRawSnapshot → PageSpeedNormalized (suffix slugs)
//   4. health()        → read integration row; no live ping (PageSpeed has no token check)
//   5. refresh()       → no-op (no OAuth)

import { getDb, generatePublicId } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import type {
  AdapterContract,
  ConnectContext,
  ConnectResult,
  FetchSnapshotArgs,
  HealthStatus,
} from '../../adapter-contract'
import { normalize } from './normalize'
import type { PageSpeedApiResponse, PageSpeedRawSnapshot } from './types'
import type { PageSpeedNormalized } from './normalize'

const PAGESPEED_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

// ─── Config shape ────────────────────────────────────────────────────────────

interface PageSpeedConfig {
  url: string
  /** strategy is optional/vestigial as of Slice B — adapter always fetches both. */
  strategy?: 'mobile' | 'desktop'
  /** API key stored here (plaintext in config_json — see README §API key storage). */
  apiKey: string
}

function readConfig(integrationId: number): PageSpeedConfig {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`pagespeed.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`pagespeed.adapter: integration ${integrationId} has no config_json`)
  }
  let parsed: Partial<PageSpeedConfig>
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`pagespeed.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.url || typeof parsed.url !== 'string') {
    throw new Error(`pagespeed.adapter: integration ${integrationId} config_json missing url`)
  }
  if (!parsed.apiKey || typeof parsed.apiKey !== 'string') {
    throw new Error(`pagespeed.adapter: integration ${integrationId} config_json missing apiKey`)
  }
  return parsed as PageSpeedConfig
}

// ─── API call ────────────────────────────────────────────────────────────────

/** Call the PageSpeed Insights API with exponential backoff.
 *
 *  Rate limits: 25,000 calls/day per API key (per-project Google quota).
 *  Two calls per fetchSnapshot (mobile + desktop). At daily cadence for 1,000
 *  clients: 2,000 calls/day — well within limits.
 *
 *  Retry: 429 and 5xx get up to 3 attempts (1s/2s/4s). 4xx (bad URL, bad key)
 *  fail immediately. Note: PageSpeed sometimes returns 500 on flaky target sites
 *  (the Lighthouse runner itself can transiently fail) — backoff handles this.
 */
async function callPageSpeedApi(args: {
  url: string
  strategy: 'mobile' | 'desktop'
  apiKey: string
}): Promise<PageSpeedApiResponse> {
  const params = new URLSearchParams({
    url: args.url,
    strategy: args.strategy.toUpperCase(),
    key: args.apiKey,
  })
  // Request all four Lighthouse categories.
  const categories = ['performance', 'accessibility', 'seo', 'best-practices']
  for (const cat of categories) {
    params.append('category', cat)
  }

  const endpoint = `${PAGESPEED_API_BASE}?${params.toString()}`

  let attempt = 0
  const maxAttempts = 3

  while (attempt < maxAttempts) {
    const res = await fetch(endpoint)

    if (res.ok) {
      return (await res.json()) as PageSpeedApiResponse
    }

    // 4xx errors are non-retryable (bad key, bad URL, quota exceeded at plan level).
    if (res.status >= 400 && res.status < 500) {
      const text = await res.text()
      throw new Error(`pagespeed.adapter: API call failed (${res.status}): ${text}`)
    }

    // 5xx / 429: retryable.
    attempt++
    if (attempt >= maxAttempts) {
      const text = await res.text()
      throw new Error(
        `pagespeed.adapter: API call failed after ${maxAttempts} attempts (${res.status}): ${text}`
      )
    }
    const backoffMs = Math.pow(2, attempt - 1) * 1000
    await new Promise((r) => setTimeout(r, backoffMs))
  }

  throw new Error('pagespeed.adapter: callPageSpeedApi exhausted retry loop unexpectedly')
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const pagespeedAdapter: AdapterContract<PageSpeedRawSnapshot, PageSpeedNormalized> = {
  provider: 'pagespeed',
  authModel: 'api_key',
  displayName: 'PageSpeed Insights',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // api_key connect: synchronously creates the integration row and returns
    // integrationId. No OAuth redirect.
    //
    // The route handler must have already:
    //   1. Validated the API key (optional: test-call the PageSpeed API).
    //   2. Confirmed the URL is present and looks like a valid URL.
    //   3. Resolved tenantId from the session.
    //
    // ctx.apiKey = the PageSpeed API key (plain text from the form).
    // ctx.callbackState = { url, strategy? } from the form.
    // strategy is optional (vestigial, stored for backward compat, not used for fetch).
    if (!ctx.apiKey) {
      throw new Error('pagespeed.adapter.connect: ctx.apiKey is required for api_key auth')
    }
    const url = ctx.callbackState?.url as string | undefined
    const strategy = (ctx.callbackState?.strategy as string | undefined) || 'mobile'
    if (!url) {
      throw new Error('pagespeed.adapter.connect: ctx.callbackState.url is required')
    }

    ensurePlatformReady()
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    // Store apiKey in config_json alongside url. strategy retained for backward compat.
    // See README §API key storage for the plaintext-at-rest decision.
    const config = JSON.stringify({ url, strategy, apiKey: ctx.apiKey })
    const displayName = `PageSpeed — ${url}`

    // Dedupe: reconnect/reconfigure (e.g. updating the audited URL) updates the
    // existing tile for this account instead of creating a duplicate.
    const { findIntegrationForAccount, updateIntegrationConfig } = await import('../upsert')
    const existingId = findIntegrationForAccount({ tenantId: ctx.tenantId, provider: 'pagespeed', accountId: ctx.accountId })
    if (existingId) {
      updateIntegrationConfig({ integrationId: existingId, configJson: config, displayName })
      return { integrationId: existingId }
    }

    const result = db.prepare(
      `INSERT INTO platform_integrations
         (tenant_id, public_id, level, agency_id, account_id, domain_id,
          provider, auth_model, config_json, display_name,
          status, last_health_status, last_health_checked_at, last_synced_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pagespeed', 'api_key', ?, ?, 'connected', NULL, ?, NULL, ?, ?)`
    ).run(
      ctx.tenantId,
      generatePublicId(),
      ctx.level,
      ctx.agencyId,
      ctx.accountId,
      ctx.domainId,
      config,
      displayName,
      now,
      now,
      now,
    )
    const integrationId = Number(result.lastInsertRowid)

    return { integrationId }
  },

  async refresh(_integrationId: number): Promise<void> {
    // No-op. PageSpeed uses a plain API key with no expiry concept.
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<PageSpeedRawSnapshot> {
    ensurePlatformReady()
    const config = readConfig(args.integrationId)

    const fetchedAt = new Date().toISOString()

    // Call mobile + desktop in parallel. If one fails, log the error and emit
    // a partial snapshot (one strategy is still useful). If BOTH fail, throw
    // so the caller surface a proper error.
    const [mobileResult, desktopResult] = await Promise.allSettled([
      callPageSpeedApi({ url: config.url, strategy: 'mobile', apiKey: config.apiKey }),
      callPageSpeedApi({ url: config.url, strategy: 'desktop', apiKey: config.apiKey }),
    ])

    const mobile = mobileResult.status === 'fulfilled' ? mobileResult.value : null
    const desktop = desktopResult.status === 'fulfilled' ? desktopResult.value : null

    const fetchWarnings: string[] = []
    if (mobileResult.status === 'rejected') {
      const msg = mobileResult.reason instanceof Error ? mobileResult.reason.message : String(mobileResult.reason)
      console.error(`[pagespeed.adapter] mobile strategy failed for integration ${args.integrationId}:`, msg)
      fetchWarnings.push(`mobile strategy failed: ${msg}`)
    }
    if (desktopResult.status === 'rejected') {
      const msg = desktopResult.reason instanceof Error ? desktopResult.reason.message : String(desktopResult.reason)
      console.error(`[pagespeed.adapter] desktop strategy failed for integration ${args.integrationId}:`, msg)
      fetchWarnings.push(`desktop strategy failed: ${msg}`)
    }

    if (!mobile && !desktop) {
      const mobileError = mobileResult.status === 'rejected'
        ? (mobileResult.reason instanceof Error ? mobileResult.reason.message : String(mobileResult.reason))
        : 'unknown'
      throw new Error(`pagespeed.adapter: both strategies failed. mobile: ${mobileError}`)
    }

    // Stamp integration row.
    getDb().prepare(
      `UPDATE platform_integrations
          SET last_synced_at = ?, status = 'connected',
              last_health_status = 'green', last_health_message = NULL,
              last_health_checked_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000),
      args.integrationId,
    )

    return {
      url: config.url,
      fetchedAt,
      mobile,
      desktop,
      ...(fetchWarnings.length > 0 ? { fetchWarnings } : {}),
    }
  },

  normalize(raw: PageSpeedRawSnapshot): PageSpeedNormalized {
    return normalize(raw)
  },

  async health(integrationId: number): Promise<HealthStatus> {
    ensurePlatformReady()
    const row = getDb().prepare(
      `SELECT status, last_synced_at, last_health_status, last_health_message, config_json
         FROM platform_integrations WHERE id = ?`
    ).get(integrationId) as
      | {
          status: string
          last_synced_at: number | null
          last_health_status: string | null
          last_health_message: string | null
          config_json: string | null
        }
      | undefined

    if (!row) {
      return {
        status: 'red',
        reason: 'not_configured',
        message: `Integration ${integrationId} not found`,
      }
    }

    // Verify config_json has required fields.
    if (!row.config_json) {
      return {
        status: 'red',
        reason: 'not_configured',
        message: 'Integration has no config_json — reconnect required',
      }
    }
    try {
      const parsed = JSON.parse(row.config_json) as Partial<{ url: string; apiKey: string }>
      if (!parsed.url || !parsed.apiKey) {
        return {
          status: 'red',
          reason: 'not_configured',
          message: 'config_json missing url or apiKey — reconnect required',
        }
      }
    } catch {
      return {
        status: 'red',
        reason: 'not_configured',
        message: 'config_json invalid JSON — reconnect required',
      }
    }

    if (!row.last_synced_at) {
      return {
        status: 'yellow',
        reason: 'stale',
        message: 'No snapshot yet — call fetchSnapshot() to verify end-to-end',
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const STALE_AFTER_SECONDS = 7 * 24 * 60 * 60
    if (now - row.last_synced_at > STALE_AFTER_SECONDS) {
      return {
        status: 'yellow',
        reason: 'stale',
        lastFetchedAt: new Date(row.last_synced_at * 1000),
        message: `Last audit ${Math.floor((now - row.last_synced_at) / 86400)}d ago`,
      }
    }

    return {
      status: 'green',
      lastFetchedAt: new Date(row.last_synced_at * 1000),
    }
  },
}
