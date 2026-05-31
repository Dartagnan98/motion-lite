// WordPress REST adapter — implements AdapterContract<WordPressRawSnapshot, WordPressNormalized>.
//
// Auth model: basic_auth. Site URL + WordPress username + Application Password.
// The Application Password is base64-encoded with the username in the Authorization header.
//
// connect() validates credentials by calling GET /wp-json/wp/v2/users/me with basic auth.
// On 200, writes the integration row and returns integrationId.
//
// config_json shape: { siteUrl, username, appPassword }
// appPassword is stored plaintext — see README §App password storage for rationale.
//
// Flow:
//   1. connect()       → validate credentials → create integration row → integrationId
//   2. fetchSnapshot() → read config_json → call WP REST endpoints → return raw snapshot
//   3. normalize()     → pure WordPressRawSnapshot → WordPressNormalized
//   4. health()        → read integration row; no live ping
//   5. refresh()       → no-op (no OAuth)
//
// Rate limiting: WP does not enforce a rate limit. We throttle to 1 req/sec between
// calls as a courtesy (the host's server may rate-limit bursts). With ~5 endpoints per
// fetchSnapshot, total wall time is ~5s — acceptable for a report generation flow.

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
import type { WordPressRawSnapshot, WpSiteRoot, WpUser, WpPost } from './types'
import type { WordPressNormalized } from './normalize'

// ─── Config shape ─────────────────────────────────────────────────────────────

interface WordPressConfig {
  /** Canonical site URL, e.g. "https://glenvalleydental.com". No trailing slash. */
  siteUrl: string
  /** WordPress username (not email — the login username). */
  username: string
  /** WordPress Application Password. Spaces allowed (WP format: xxxx xxxx xxxx ...). */
  appPassword: string
}

function readConfig(integrationId: number): WordPressConfig {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`wordpress.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`wordpress.adapter: integration ${integrationId} has no config_json`)
  }
  let parsed: Partial<WordPressConfig>
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`wordpress.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.siteUrl || typeof parsed.siteUrl !== 'string') {
    throw new Error(`wordpress.adapter: integration ${integrationId} config_json missing siteUrl`)
  }
  if (!parsed.username || typeof parsed.username !== 'string') {
    throw new Error(`wordpress.adapter: integration ${integrationId} config_json missing username`)
  }
  if (!parsed.appPassword || typeof parsed.appPassword !== 'string') {
    throw new Error(`wordpress.adapter: integration ${integrationId} config_json missing appPassword`)
  }
  return parsed as WordPressConfig
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/** Build the HTTP Basic Authorization header for WP Application Password auth.
 *
 *  WP Application Passwords are formatted as "xxxx xxxx xxxx xxxx xxxx xxxx"
 *  (24 chars + spaces). The spaces are significant — WP validates the raw string.
 *  We pass it as-is into the Basic auth credential.
 *
 *  Exposed for use by the Gravity Forms adapter (same auth model, different namespace).
 */
export function buildBasicAuthHeader(username: string, appPassword: string): string {
  const credential = `${username}:${appPassword}`
  return `Basic ${Buffer.from(credential).toString('base64')}`
}

/** Generic WordPress REST API call with basic auth and exponential backoff.
 *
 *  No rate limit enforced by WP itself, but we add a 1-second inter-call delay
 *  (controlled by the caller — callWordPress does not sleep itself; the caller
 *  should await a 1s delay between sequential calls).
 *
 *  Retry: 429 and 5xx get up to 3 attempts (1s/2s/4s).
 *  401 is non-retryable — bad credentials.
 *
 *  Returns { data, headers } so callers can read X-WP-Total.
 */
export async function callWordPress<T>(args: {
  siteUrl: string
  username: string
  appPassword: string
  path: string
  params?: Record<string, string>
}): Promise<{ data: T; headers: Headers }> {
  // Normalize siteUrl — strip trailing slash.
  const base = args.siteUrl.replace(/\/$/, '')
  const url = new URL(`${base}${args.path}`)
  if (args.params) {
    for (const [k, v] of Object.entries(args.params)) {
      url.searchParams.set(k, v)
    }
  }

  const authHeader = buildBasicAuthHeader(args.username, args.appPassword)

  let attempt = 0
  const maxAttempts = 3

  while (attempt < maxAttempts) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })

    if (res.ok) {
      const data = (await res.json()) as T
      return { data, headers: res.headers }
    }

    // Non-retryable auth error.
    if (res.status === 401) {
      const text = await res.text()
      throw new Error(
        `wordpress.adapter: auth failed (401) — check username and application password: ${text}`
      )
    }

    // 403 — permission denied (user lacks REST API access or plugin blocked).
    if (res.status === 403) {
      const text = await res.text()
      throw new Error(
        `wordpress.adapter: forbidden (403) — user may lack REST API permissions: ${text}`
      )
    }

    // 404 — namespace not found (WP REST disabled or wrong siteUrl).
    if (res.status === 404) {
      const text = await res.text()
      throw new Error(
        `wordpress.adapter: not found (404) — check siteUrl and that WP REST API is enabled: ${text}`
      )
    }

    // Other non-retryable 4xx.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      const text = await res.text()
      throw new Error(`wordpress.adapter: API call failed (${res.status}): ${text}`)
    }

    // Retryable: 429 or 5xx.
    attempt++
    if (attempt >= maxAttempts) {
      const text = await res.text()
      throw new Error(
        `wordpress.adapter: API call failed after ${maxAttempts} attempts (${res.status}): ${text}`
      )
    }
    const backoffMs = Math.pow(2, attempt - 1) * 1000
    await new Promise((r) => setTimeout(r, backoffMs))
  }

  throw new Error('wordpress.adapter: callWordPress exhausted retry loop unexpectedly')
}

/** Read the X-WP-Total header from a WP REST response.
 *  Returns 0 if the header is absent (some endpoints don't return it). */
function readWpTotal(headers: Headers): number {
  const raw = headers.get('x-wp-total') ?? headers.get('X-WP-Total')
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return isNaN(n) ? 0 : n
}

/** 1-second courtesy delay between sequential WP API calls. */
function sleep1s(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1000))
}

/** Fetch the WordPress site root to extract WP version.
 *
 *  WP returns the version in the `wp_version` field at the root. Some sites
 *  suppress this via security plugins (Wordfence, iThemes Security "remove version").
 *  We try multiple locations and return null if none are found — the normalizer
 *  surfaces a warning rather than throwing.
 */
async function fetchWpVersion(args: {
  siteUrl: string
  username: string
  appPassword: string
}): Promise<string | null> {
  try {
    const { data } = await callWordPress<WpSiteRoot>({
      ...args,
      path: '/wp-json/',
    })
    // Try common locations.
    if (typeof data.wp_version === 'string' && data.wp_version) return data.wp_version
    if (typeof data.version === 'string' && data.version) return data.version
    // Some sites put it as a key on the generator meta — not standard, skip.
    return null
  } catch {
    // If the root call fails, version is unavailable — not a fatal error.
    return null
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const wordpressAdapter: AdapterContract<WordPressRawSnapshot, WordPressNormalized> = {
  provider: 'wordpress',
  authModel: 'basic_auth',
  displayName: 'WordPress',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // basic_auth connect: validate credentials, write integration row, return integrationId.
    //
    // ctx.callbackState must carry: { siteUrl, username, appPassword }
    // (apiKey is not used for basic_auth — credentials come via callbackState)

    const siteUrl = ctx.callbackState?.siteUrl as string | undefined
    const username = ctx.callbackState?.username as string | undefined
    const appPassword = ctx.callbackState?.appPassword as string | undefined

    if (!siteUrl) {
      throw new Error('wordpress.adapter.connect: ctx.callbackState.siteUrl is required')
    }
    if (!username) {
      throw new Error('wordpress.adapter.connect: ctx.callbackState.username is required')
    }
    if (!appPassword) {
      throw new Error('wordpress.adapter.connect: ctx.callbackState.appPassword is required')
    }

    // Normalize siteUrl — ensure no trailing slash.
    const normalizedSiteUrl = siteUrl.replace(/\/$/, '')

    // Validate credentials by hitting /wp/v2/users/me.
    await callWordPress<WpUser>({
      siteUrl: normalizedSiteUrl,
      username,
      appPassword,
      path: '/wp-json/wp/v2/users/me',
    })

    ensurePlatformReady()
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    const config = JSON.stringify({ siteUrl: normalizedSiteUrl, username, appPassword })
    const displayName = `WordPress — ${normalizedSiteUrl}`

    const result = db.prepare(
      `INSERT INTO platform_integrations
         (tenant_id, public_id, level, agency_id, account_id, domain_id,
          provider, auth_model, config_json, display_name,
          status, last_health_status, last_health_checked_at, last_synced_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'wordpress', 'basic_auth', ?, ?, 'connected', NULL, ?, NULL, ?, ?)`
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
    // No-op. WordPress Application Passwords do not expire.
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<WordPressRawSnapshot> {
    ensurePlatformReady()
    const config = readConfig(args.integrationId)
    const periodStart = args.period.start.toISOString().slice(0, 10)
    const periodEnd = args.period.end.toISOString().slice(0, 10)

    // WP REST `after` / `before` params use ISO 8601 datetime (not just date).
    // Use the start of periodStart and end of periodEnd.
    const afterParam = `${periodStart}T00:00:00`
    const beforeParam = `${periodEnd}T23:59:59`

    const callArgs = {
      siteUrl: config.siteUrl,
      username: config.username,
      appPassword: config.appPassword,
    }

    // 1. Fetch WP version (from site root).
    const wpVersion = await fetchWpVersion(callArgs)
    await sleep1s()

    // 2. Count posts published in period (per_page=1, read X-WP-Total header).
    const postsResult = await callWordPress<WpPost[]>({
      ...callArgs,
      path: '/wp-json/wp/v2/posts',
      params: {
        after: afterParam,
        before: beforeParam,
        status: 'publish',
        per_page: '1',
        _fields: 'id',
      },
    })
    const postsPublishedCount = readWpTotal(postsResult.headers)
    await sleep1s()

    // 3. Count pages published in period.
    const pagesResult = await callWordPress<WpPost[]>({
      ...callArgs,
      path: '/wp-json/wp/v2/pages',
      params: {
        after: afterParam,
        before: beforeParam,
        status: 'publish',
        per_page: '1',
        _fields: 'id',
      },
    })
    const pagesPublishedCount = readWpTotal(pagesResult.headers)
    await sleep1s()

    // 4. Count media uploads in period.
    const mediaResult = await callWordPress<unknown[]>({
      ...callArgs,
      path: '/wp-json/wp/v2/media',
      params: {
        after: afterParam,
        before: beforeParam,
        per_page: '1',
        _fields: 'id',
      },
    })
    const mediaUploadsCount = readWpTotal(mediaResult.headers)
    await sleep1s()

    // 5. Fetch up to 10 most recent published posts for the recent_posts series.
    const recentResult = await callWordPress<WpPost[]>({
      ...callArgs,
      path: '/wp-json/wp/v2/posts',
      params: {
        per_page: '10',
        orderby: 'date',
        order: 'desc',
        status: 'publish',
        _fields: 'id,title,date,status,type,link',
      },
    })
    const recentPosts = recentResult.data

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
      siteUrl: config.siteUrl,
      periodStart,
      periodEnd,
      wpVersion,
      postsPublishedCount,
      pagesPublishedCount,
      mediaUploadsCount,
      recentPosts,
      fetchedAt: new Date().toISOString(),
    }
  },

  normalize(raw: WordPressRawSnapshot): WordPressNormalized {
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

    if (!row.config_json) {
      return {
        status: 'red',
        reason: 'not_configured',
        message: 'Integration has no config_json — reconnect required',
      }
    }

    try {
      const parsed = JSON.parse(row.config_json) as Partial<WordPressConfig>
      if (!parsed.siteUrl || !parsed.username || !parsed.appPassword) {
        return {
          status: 'red',
          reason: 'not_configured',
          message: 'config_json missing siteUrl, username, or appPassword — reconnect required',
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
        message: `Last sync ${Math.floor((now - row.last_synced_at) / 86400)}d ago`,
      }
    }

    return {
      status: 'green',
      lastFetchedAt: new Date(row.last_synced_at * 1000),
    }
  },
}
