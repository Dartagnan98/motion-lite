// SE Ranking adapter — implements AdapterContract<SeRankingRawSnapshot, SeRankingNormalized>.
//
// Auth model: api_key. No OAuth. API key sent as "Authorization: Token <key>" header.
//
// connect() is a two-step flow:
//   Step 1: Validate API key by calling GET /sites.
//   Step 2: Project picker — PM selects which SE Ranking site to track.
//           After selection, create the integration row and return integrationId.
//
// config_json shape: { apiKey, projectId, projectName }
//
// Flow:
//   1. connect()       → validate key + project selection → create integration row → integrationId
//   2. fetchSnapshot() → GET /sites/{id}/positions + GET /sites/{id}/positions/history → raw snapshot
//   3. normalize()     → pure SeRankingRawSnapshot → SeRankingNormalized
//   4. health()        → read integration row; no live ping unless re-validation needed
//   5. refresh()       → no-op (no OAuth)
//
// Rate limits: 100 req/min. fetchSnapshot makes 2 calls per integration. Backoff handles
// transient 429s; persistent 429 surfaces as yellow:rate_limited.

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
import type {
  SeRankingRawSnapshot,
  SeRankingSite,
  SeRankingKeywordPosition,
  SeRankingHistoryEntry,
  SeRankingPositionsResponse,
  SeRankingHistoryResponse,
} from './types'
import type { SeRankingNormalized } from './normalize'

// SE Ranking has two separate APIs with different base URLs and different
// API keys. We use the **Project API** (rank tracking, projects). The Data
// API (keyword research, domain analysis) lives at api.seranking.com too
// but uses different paths under /v1/data/.
// Docs: https://seranking.com/api/project/getting-started/
const SE_RANKING_API_BASE = 'https://api.seranking.com'

// ─── Config shape ─────────────────────────────────────────────────────────────

interface SeRankingConfig {
  /** API key stored plaintext in config_json. See README §API key storage. */
  apiKey: string
  /** SE Ranking site/project ID to track. */
  projectId: number
  /** Display name for the project (shown in the dashboard tile). */
  projectName: string
}

function readConfig(integrationId: number): SeRankingConfig {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`se_ranking.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`se_ranking.adapter: integration ${integrationId} has no config_json`)
  }
  let parsed: Partial<SeRankingConfig>
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`se_ranking.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.apiKey || typeof parsed.apiKey !== 'string') {
    throw new Error(`se_ranking.adapter: integration ${integrationId} config_json missing apiKey`)
  }
  if (!parsed.projectId || typeof parsed.projectId !== 'number') {
    throw new Error(`se_ranking.adapter: integration ${integrationId} config_json missing projectId`)
  }
  if (!parsed.projectName || typeof parsed.projectName !== 'string') {
    throw new Error(`se_ranking.adapter: integration ${integrationId} config_json missing projectName`)
  }
  return parsed as SeRankingConfig
}

// ─── API helpers ─────────────────────────────────────────────────────────────

/** Generic SE Ranking API call with exponential backoff.
 *
 *  Rate limits: 100 req/min.
 *  Auth: "Authorization: Token <api_key>" header.
 *  Retry: 429 and 5xx get up to 3 attempts (1s/2s/4s).
 *  Auth errors (401/403) are non-retryable.
 */
async function callSeRanking<T>(args: {
  apiKey: string
  path: string
  params?: Record<string, string>
}): Promise<T> {
  const url = new URL(`${SE_RANKING_API_BASE}${args.path}`)
  if (args.params) {
    for (const [k, v] of Object.entries(args.params)) {
      url.searchParams.set(k, v)
    }
  }

  let attempt = 0
  const maxAttempts = 3

  while (attempt < maxAttempts) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Token ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (res.ok) {
      return (await res.json()) as T
    }

    // Non-retryable auth errors.
    if (res.status === 401 || res.status === 403) {
      const text = await res.text()
      throw new Error(
        `se_ranking.adapter: auth failed (${res.status}) — invalid API key or insufficient permissions: ${text}`
      )
    }

    // Other non-retryable 4xx.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      const text = await res.text()
      throw new Error(`se_ranking.adapter: API call failed (${res.status}): ${text}`)
    }

    // Retryable: 429 or 5xx.
    attempt++
    if (attempt >= maxAttempts) {
      const text = await res.text()
      throw new Error(
        `se_ranking.adapter: API call failed after ${maxAttempts} attempts (${res.status}): ${text}`
      )
    }
    const backoffMs = Math.pow(2, attempt - 1) * 1000  // 1s, 2s, 4s
    await new Promise((r) => setTimeout(r, backoffMs))
  }

  throw new Error('se_ranking.adapter: callSeRanking exhausted retry loop unexpectedly')
}

/** Normalize the two possible response shapes SE Ranking may return (array or wrapped). */
function unwrapArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (
    raw &&
    typeof raw === 'object' &&
    'data' in raw &&
    Array.isArray((raw as { data: unknown }).data)
  ) {
    return (raw as { data: T[] }).data
  }
  return []
}

// ─── Public picker helper (used by multi-step connect UI) ────────────────────

export interface SeRankingProject {
  id: number
  name: string
  /** Tracked domain/URL, e.g. "glenvalleydental.com". */
  domain: string
  /** 1 = active, 0 = paused. */
  isActive: number
  keywordsCount: number
}

/** List all SE Ranking projects/sites accessible with the given API key.
 *
 *  GET /sites. SE Ranking returns the full list in one response (no cursor
 *  pagination). We loop defensively with the dedupe + early-break pattern
 *  in case pagination is added in a future API version.
 *
 *  Exposed for the picker route: `GET /api/platform/se-ranking/list-projects?apiKey=...`
 */
export async function listProjects(apiKey: string): Promise<SeRankingProject[]> {
  const byId = new Map<number, SeRankingProject>()
  const limit = 250

  for (let page = 1; page < 20; page++) {
    const raw = await callSeRanking<unknown>({
      apiKey,
      path: '/v1/project-management/sites',
      params: { page: String(page), per_page: String(limit) },
    })

    const items = unwrapArray<SeRankingSite>(raw)
    if (items.length === 0) break

    let newCount = 0
    for (const item of items) {
      if (item.id == null || !item.title) continue
      const id = Number(item.id)
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: item.title,
          domain: item.name || '',
          isActive: item.is_active ?? 1,
          keywordsCount: item.keywords_count ?? 0,
        })
        newCount++
      }
    }

    // If no new IDs this page, API is ignoring pagination — stop.
    if (newCount === 0) break
    // If fewer results than requested, we've seen the full set.
    if (items.length < limit) break
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

// ─── Internal fetch helpers ──────────────────────────────────────────────────

/** Fetch current keyword positions for a site.
 *
 *  GET /sites/{id}/positions
 *
 *  SE Ranking may not paginate this endpoint, but we apply the same defensive
 *  dedupe + early-break loop in case large sites span multiple pages.
 */
async function fetchPositions(args: {
  apiKey: string
  projectId: number
}): Promise<SeRankingKeywordPosition[]> {
  // SE Ranking returns an array of search-engine groups, each containing a
  // nested `keywords` array. Flatten across all engines, keyed by keyword text
  // (first occurrence wins — same keyword tracked on Google + Bing dedupes
  // to the Google entry, which is the primary engine for SEO retainers).
  // Shape (verified live 2026-05-21):
  //   [{ site_engine_id: 907261, keywords: [{ keyword, position, ... }] }, ...]
  const byKeyword = new Map<string, SeRankingKeywordPosition>()

  const raw = await callSeRanking<unknown>({
    apiKey: args.apiKey,
    path: '/v1/project-management/sites/positions',
    params: { site_id: String(args.projectId) },
  })

  const engines = Array.isArray(raw)
    ? (raw as Array<{ site_engine_id?: number; keywords?: unknown }>)
    : []

  for (const engine of engines) {
    const keywords = Array.isArray(engine.keywords)
      ? (engine.keywords as SeRankingKeywordPosition[])
      : []
    for (const item of keywords) {
      if (!item.name) continue
      if (!byKeyword.has(item.name)) {
        byKeyword.set(item.name, item)
      }
    }
  }

  return Array.from(byKeyword.values())
}

/** Fetch daily average position history for a site within the given period.
 *
 *  GET /sites/{id}/positions/history?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 *
 *  Returns an array of { date, avg_position } objects sorted ascending by date.
 *  SE Ranking computes avg_position server-side from all tracked keywords on that day.
 */
async function fetchHistory(args: {
  apiKey: string
  projectId: number
  dateFrom: string  // YYYY-MM-DD
  dateTo: string    // YYYY-MM-DD
}): Promise<SeRankingHistoryEntry[]> {
  // Same endpoint as fetchPositions, but with date range. Each keyword in the
  // grouped response carries an array of per-date positions when a date range
  // is requested. We compute the daily average across all keywords/engines
  // for each date — that's our "rank.movement_daily" series.
  const raw = await callSeRanking<unknown>({
    apiKey: args.apiKey,
    path: '/v1/project-management/sites/positions',
    params: {
      site_id: String(args.projectId),
      date_from: args.dateFrom,
      date_to: args.dateTo,
    },
  })

  const engines = Array.isArray(raw)
    ? (raw as Array<{ keywords?: unknown }>)
    : []

  // date → [position values]
  const dailyAcc = new Map<string, number[]>()

  for (const engine of engines) {
    const keywords = Array.isArray(engine.keywords)
      ? (engine.keywords as Array<{ positions?: unknown; position?: unknown; date?: unknown }>)
      : []

    for (const kw of keywords) {
      // Shape A: keyword has a `positions: [{ date, position }]` array (multi-day query)
      if (Array.isArray(kw.positions)) {
        for (const p of kw.positions as Array<{ date?: string; position?: number }>) {
          if (typeof p.date === 'string' && typeof p.position === 'number' && p.position > 0) {
            const arr = dailyAcc.get(p.date) ?? []
            arr.push(p.position)
            dailyAcc.set(p.date, arr)
          }
        }
        continue
      }
      // Shape B: keyword has bare `date` + `position` (single-day query)
      if (typeof kw.date === 'string' && typeof kw.position === 'number' && kw.position > 0) {
        const arr = dailyAcc.get(kw.date) ?? []
        arr.push(kw.position)
        dailyAcc.set(kw.date, arr)
      }
    }
  }

  const out: SeRankingHistoryEntry[] = []
  for (const [date, positions] of dailyAcc.entries()) {
    const avg = positions.reduce((s, n) => s + n, 0) / positions.length
    out.push({ date, avg_position: Math.round(avg * 100) / 100 })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const seRankingAdapter: AdapterContract<SeRankingRawSnapshot, SeRankingNormalized> = {
  provider: 'se_ranking',
  authModel: 'api_key',
  displayName: 'SE Ranking',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // api_key connect: validate key + write integration row.
    //
    // ctx.apiKey = the SE Ranking API key.
    // ctx.callbackState carries:
    //   projectId:   numeric SE Ranking site ID (selected in picker)
    //   projectName: display name for the project
    //
    // If projectId is absent, this is Step 1 (key validation only).
    // The picker route calls listProjects() separately and then calls connect()
    // again with projectId/projectName set.

    if (!ctx.apiKey) {
      throw new Error('se_ranking.adapter.connect: ctx.apiKey is required')
    }

    // Validate the key by listing sites — throws on 401/403.
    await callSeRanking<unknown>({ apiKey: ctx.apiKey, path: '/v1/project-management/sites' })

    const projectIdRaw = ctx.callbackState?.projectId
    const projectNameRaw = ctx.callbackState?.projectName

    if (!projectIdRaw || !projectNameRaw) {
      // Key is valid but project not yet selected. Return without creating a row.
      // The connect route should redirect to the project picker at this point.
      // We throw here because callers should never reach persistSnapshot without
      // a project selected — the route handler manages the redirect.
      throw new Error(
        'se_ranking.adapter.connect: projectId and projectName are required — complete project picker first'
      )
    }

    const projectId = Number(projectIdRaw)
    const projectName = String(projectNameRaw)

    if (isNaN(projectId)) {
      throw new Error(
        `se_ranking.adapter.connect: projectId "${projectIdRaw}" is not a valid number`
      )
    }

    ensurePlatformReady()
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    const config = JSON.stringify({ apiKey: ctx.apiKey, projectId, projectName })
    const displayName = `SE Ranking — ${projectName}`

    const result = db.prepare(
      `INSERT INTO platform_integrations
         (tenant_id, public_id, level, agency_id, account_id, domain_id,
          provider, auth_model, config_json, display_name,
          status, last_health_status, last_health_checked_at, last_synced_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'se_ranking', 'api_key', ?, ?, 'connected', NULL, ?, NULL, ?, ?)`
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
    // No-op. SE Ranking uses a plain API key with no expiry concept.
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<SeRankingRawSnapshot> {
    ensurePlatformReady()
    const config = readConfig(args.integrationId)
    const periodStart = args.period.start.toISOString().slice(0, 10)
    const periodEnd = args.period.end.toISOString().slice(0, 10)

    // Fetch positions and history in parallel. Both calls are independent.
    const [positions, history] = await Promise.all([
      fetchPositions({ apiKey: config.apiKey, projectId: config.projectId }),
      fetchHistory({
        apiKey: config.apiKey,
        projectId: config.projectId,
        dateFrom: periodStart,
        dateTo: periodEnd,
      }),
    ])

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
      projectId: config.projectId,
      projectName: config.projectName,
      periodStart,
      periodEnd,
      positions,
      history,
      fetchedAt: new Date().toISOString(),
    }
  },

  normalize(raw: SeRankingRawSnapshot): SeRankingNormalized {
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
      const parsed = JSON.parse(row.config_json) as Partial<SeRankingConfig>
      if (!parsed.apiKey) {
        return {
          status: 'red',
          reason: 'not_configured',
          message: 'config_json missing apiKey — reconnect required',
        }
      }
      if (!parsed.projectId) {
        return {
          status: 'red',
          reason: 'not_configured',
          message: 'config_json missing projectId — complete project picker',
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
