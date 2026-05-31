// Asana adapter — implements AdapterContract<AsanaRawSnapshot, AsanaNormalized>.
//
// Auth model: OAuth 2.0. Scope: 'default' (Asana's single bundled scope).
// Mirrors GA4 adapter pattern exactly.
//
// Flow:
//   1. connect()       → build OAuth URL with HMAC-signed state → return redirectUrl
//   2. (callback)      → finishConnectStage1 → workspace picker → completeConnect
//   3. fetchSnapshot() → get valid token → task search (paginated) → AsanaRawSnapshot
//   4. normalize()     → pure AsanaRawSnapshot → AsanaNormalized
//   5. health()        → read integration row + vault; cheap probe
//   6. refresh()       → force token refresh via getValidAccessToken
//
// Rate limits: 150 req/min per access token (Asana Standard + Business tiers).
// fetchSnapshot paginates task search at 100/page and makes 1 request per page.
// Backoff: 429 and 5xx get up to 3 attempts at 1s/2s/4s.

import { getDb } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import { loadToken } from '../../vault'
import type {
  AdapterContract,
  ConnectContext,
  ConnectResult,
  FetchSnapshotArgs,
  HealthStatus,
} from '../../adapter-contract'
import { signState } from '../../state'
import {
  buildAuthUrl,
  getValidAccessToken,
  ASANA_OAUTH_SCOPES,
  listWorkspaces,
} from './oauth'
import { normalize } from './normalize'
import type { AsanaRawSnapshot, AsanaTask, AsanaTasksResponse } from './types'
import type { AsanaNormalized } from './normalize'

const ASANA_API_BASE = 'https://app.asana.com/api/1.0'

// ─── Config shape ─────────────────────────────────────────────────────────────

interface AsanaConfig {
  workspaceId: string
  workspaceDisplayName?: string
  scope?: 'portfolio' | 'projects'
  portfolioId?: string
  portfolioName?: string
  projectIds?: string[]
  projectNames?: string[]
}

function readConfig(integrationId: number): AsanaConfig {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`asana.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`asana.adapter: integration ${integrationId} has no config_json (missing workspaceId)`)
  }
  let parsed: Partial<AsanaConfig>
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`asana.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.workspaceId || typeof parsed.workspaceId !== 'string') {
    throw new Error(`asana.adapter: integration ${integrationId} config_json missing workspaceId`)
  }
  return {
    workspaceId: parsed.workspaceId,
    workspaceDisplayName: typeof parsed.workspaceDisplayName === 'string'
      ? parsed.workspaceDisplayName
      : undefined,
    scope: parsed.scope === 'portfolio' || parsed.scope === 'projects'
      ? parsed.scope
      : undefined,
    portfolioId: typeof parsed.portfolioId === 'string' ? parsed.portfolioId : undefined,
    portfolioName: typeof parsed.portfolioName === 'string' ? parsed.portfolioName : undefined,
    projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds : undefined,
    projectNames: Array.isArray(parsed.projectNames) ? parsed.projectNames : undefined,
  }
}

// ─── Task search (paginated) ──────────────────────────────────────────────────

/** Fetch one page of completed tasks from the workspace search endpoint.
 *  Returns the parsed response. Applies exponential backoff on 429 and 5xx.
 *
 *  Asana task search endpoint:
 *    GET /workspaces/{workspace_gid}/tasks/search
 *  Required params:
 *    completed: true
 *    completed_on.after: period.start (YYYY-MM-DD)
 *    completed_on.before: period.end  (YYYY-MM-DD, inclusive)
 *    limit: 100 (Asana hard cap)
 *    opt_fields: gid,name,completed,completed_at,memberships.project.name,memberships.project.gid
 *
 *  Note: Asana's task search uses GET with query params (not POST body). */
async function fetchTaskPage(args: {
  accessToken: string
  workspaceId: string
  completedAfter: string   // YYYY-MM-DD
  completedBefore: string  // YYYY-MM-DD
  offset?: string
}): Promise<AsanaTasksResponse> {
  const url = new URL(`${ASANA_API_BASE}/workspaces/${args.workspaceId}/tasks/search`)
  url.searchParams.set('completed', 'true')
  url.searchParams.set('completed_on.after', args.completedAfter)
  url.searchParams.set('completed_on.before', args.completedBefore)
  url.searchParams.set('limit', '100')
  url.searchParams.set(
    'opt_fields',
    'gid,name,completed,completed_at,memberships.project.gid,memberships.project.name,memberships.section.gid,memberships.section.name'
  )
  if (args.offset) url.searchParams.set('offset', args.offset)

  let attempt = 0
  const maxAttempts = 3

  while (attempt < maxAttempts) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        Accept: 'application/json',
      },
    })

    if (res.ok) {
      return (await res.json()) as AsanaTasksResponse
    }

    // Non-retryable auth errors.
    if (res.status === 401 || res.status === 403) {
      const text = await res.text()
      throw new Error(`asana.adapter: task search auth failed (${res.status}): ${text}`)
    }

    // Retryable: 429 rate limit or 5xx transient.
    if (res.status === 429 || res.status >= 500) {
      attempt++
      if (attempt >= maxAttempts) {
        const text = await res.text()
        throw new Error(
          `asana.adapter: task search failed after ${maxAttempts} attempts (${res.status}): ${text}`
        )
      }
      const backoffMs = Math.pow(2, attempt - 1) * 1000  // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, backoffMs))
      continue
    }

    // All other 4xx: fail immediately.
    const text = await res.text()
    throw new Error(`asana.adapter: task search failed (${res.status}): ${text}`)
  }

  throw new Error('asana.adapter: fetchTaskPage exhausted retry loop unexpectedly')
}

/** De-paginate all completed tasks in the period.
 *  Follows next_page.offset until exhausted. */
async function fetchAllTasks(args: {
  accessToken: string
  workspaceId: string
  periodStart: string  // YYYY-MM-DD
  periodEnd: string    // YYYY-MM-DD
}): Promise<AsanaTask[]> {
  const all: AsanaTask[] = []
  let offset: string | undefined

  do {
    const page = await fetchTaskPage({
      accessToken: args.accessToken,
      workspaceId: args.workspaceId,
      completedAfter: args.periodStart,
      completedBefore: args.periodEnd,
      offset,
    })
    all.push(...(page.data || []))
    offset = page.next_page?.offset
  } while (offset)

  return all
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const asanaAdapter: AdapterContract<AsanaRawSnapshot, AsanaNormalized> = {
  provider: 'asana',
  authModel: 'oauth',
  displayName: 'Asana',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // State carries connect context so the callback can write to the correct
    // tenant + level. HMAC-signed — forged callbacks cannot inject into another
    // tenant. See adapter-contract.ts for the signed-state requirement.
    const stateObj = {
      provider: 'asana',
      tenantId: ctx.tenantId,
      level: ctx.level,
      agencyId: ctx.agencyId,
      accountId: ctx.accountId,
      domainId: ctx.domainId,
      ...(ctx.callbackState || {}),
    }
    const state = signState(stateObj)
    const redirectUrl = buildAuthUrl({ redirectUri: ctx.redirectUri, state })
    return { redirectUrl }
  },

  async refresh(integrationId: number): Promise<void> {
    // getValidAccessToken refreshes when expired; calling it forces that path.
    await getValidAccessToken(integrationId)
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<AsanaRawSnapshot> {
    ensurePlatformReady()
    const config = readConfig(args.integrationId)
    const accessToken = await getValidAccessToken(args.integrationId)
    const periodStart = args.period.start.toISOString().slice(0, 10)
    const periodEnd = args.period.end.toISOString().slice(0, 10)

    let tasks = await fetchAllTasks({
      accessToken,
      workspaceId: config.workspaceId,
      periodStart,
      periodEnd,
    })

    // If projectIds are configured, filter to those projects only.
    if (config.projectIds && config.projectIds.length > 0) {
      const projectSet = new Set(config.projectIds)
      tasks = tasks.filter((t) =>
        t.memberships && t.memberships.some((m) => projectSet.has(m.project.gid))
      )
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
      workspaceId: config.workspaceId,
      periodStart,
      periodEnd,
      tasks,
      fetchedAt: new Date().toISOString(),
    }
  },

  normalize(raw: AsanaRawSnapshot): AsanaNormalized {
    return normalize(raw)
  },

  async health(integrationId: number): Promise<HealthStatus> {
    ensurePlatformReady()
    const row = getDb().prepare(
      `SELECT status, last_synced_at, last_health_status, last_health_message
         FROM platform_integrations WHERE id = ?`
    ).get(integrationId) as
      | {
          status: string
          last_synced_at: number | null
          last_health_status: string | null
          last_health_message: string | null
        }
      | undefined

    if (!row) {
      return {
        status: 'red',
        reason: 'not_configured',
        message: `Integration ${integrationId} not found`,
      }
    }

    const token = loadToken(integrationId)
    if (!token) {
      return {
        status: 'red',
        reason: 'auth_expired',
        message: 'No stored token (vault read returned null)',
      }
    }
    const now = Math.floor(Date.now() / 1000)
    if (token.token_expiry && token.token_expiry < now && !token.refresh_token) {
      return {
        status: 'red',
        reason: 'auth_expired',
        message: 'Access token expired and no refresh token on file',
      }
    }

    if (!row.last_synced_at) {
      return {
        status: 'yellow',
        reason: 'stale',
        message: 'No snapshot yet — call fetchSnapshot() to verify end-to-end',
      }
    }

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

export { ASANA_OAUTH_SCOPES, listWorkspaces }
