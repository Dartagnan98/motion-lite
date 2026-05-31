// GSC adapter — implements AdapterContract<GscRawSnapshot, GscNormalized>.
//
// This is the reference implementation integrations-engineer mirrors for the
// other 9 providers. Pattern:
//
//   1. connect(): build OAuth URL with state-encoded callback context
//   2. (callback handler — outside this file — calls exchangeCode + persistIntegration)
//   3. fetchSnapshot(): get valid token (refreshing if needed) → call provider API → return RawT
//   4. normalize(): pure function over RawT (no I/O)
//   5. health(): cheap probe (read integration row, optionally token-info ping)
//   6. refresh(): force a token refresh

import { getDb } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import { loadToken, loadTenantCredentialById } from '../../vault'
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
  GSC_OAUTH_SCOPES,
} from './oauth'
import { normalize } from './normalize'
import type {
  GscApiResponse,
  GscRawSnapshot,
} from './types'
import type { GscNormalized } from './normalize'

const GSC_API_BASE = 'https://www.googleapis.com/webmasters/v3'

// ─── Helpers ─────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Read the integration row's config_json and pull out siteUrl. */
function readSiteUrl(integrationId: number): string {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`gsc.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`gsc.adapter: integration ${integrationId} has no config_json (missing siteUrl)`)
  }
  let parsed: { siteUrl?: string }
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`gsc.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.siteUrl) {
    throw new Error(`gsc.adapter: integration ${integrationId} config_json missing siteUrl`)
  }
  return parsed.siteUrl
}

/** Issue a single searchAnalytics.query() call. */
async function querySearchAnalytics(args: {
  accessToken: string
  siteUrl: string
  startDate: string
  endDate: string
  dimensions: string[]
  rowLimit?: number
}): Promise<GscApiResponse> {
  const url = `${GSC_API_BASE}/sites/${encodeURIComponent(args.siteUrl)}/searchAnalytics/query`
  const body = {
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions: args.dimensions,
    rowLimit: args.rowLimit ?? 25_000,  // GSC's hard ceiling per call
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`gsc.adapter: searchAnalytics.query failed (${res.status}): ${text}`)
  }
  return (await res.json()) as GscApiResponse
}

// ─── Adapter ─────────────────────────────────────────────────────────

export const gscAdapter: AdapterContract<GscRawSnapshot, GscNormalized> = {
  provider: 'gsc',
  authModel: 'oauth',
  displayName: 'Google Search Console',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // State carries enough context for the callback to know which level/entity
    // and tenant this connect is targeting. Caller provides the redirect URI.
    //
    // CSRF / state-forgery defense: state is HMAC-signed via signState() so
    // a forged callback cannot point this connect at a different tenant.
    // The callback handler MUST verifyState() before reading any field.
    // See src/lib/platform/state.ts for the threat model.
    const stateObj = {
      provider: 'gsc',
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
    // getValidAccessToken refreshes when expired; calling it forces the path.
    await getValidAccessToken(integrationId)
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<GscRawSnapshot> {
    ensurePlatformReady()
    const siteUrl = readSiteUrl(args.integrationId)
    const accessToken = await getValidAccessToken(args.integrationId)
    const startDate = toIsoDate(args.period.start)
    const endDate = toIsoDate(args.period.end)

    // Three calls: daily, top queries, top pages. Sequential by design — GSC
    // is per-project rate-limited (200 QPS) but we want to fail fast on first
    // error rather than parallel-half-success.
    const daily = await querySearchAnalytics({
      accessToken, siteUrl, startDate, endDate,
      dimensions: ['date'],
    })
    const topQueries = await querySearchAnalytics({
      accessToken, siteUrl, startDate, endDate,
      dimensions: ['query'],
      rowLimit: 25,
    })
    const topPages = await querySearchAnalytics({
      accessToken, siteUrl, startDate, endDate,
      dimensions: ['page'],
      rowLimit: 25,
    })

    // Stamp last_synced_at on the integration row.
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
      siteUrl,
      periodStart: startDate,
      periodEnd: endDate,
      daily,
      topQueries,
      topPages,
      fetchedAt: new Date().toISOString(),
    }
  },

  normalize(raw: GscRawSnapshot): GscNormalized {
    return normalize(raw)
  },

  async health(integrationId: number): Promise<HealthStatus> {
    ensurePlatformReady()
    const row = getDb().prepare(
      `SELECT status, last_synced_at, last_health_status, last_health_message, tenant_credential_id
         FROM platform_integrations WHERE id = ?`
    ).get(integrationId) as
      | {
          status: string
          last_synced_at: number | null
          last_health_status: string | null
          last_health_message: string | null
          tenant_credential_id: number | null
        }
      | undefined

    if (!row) {
      return {
        status: 'red',
        reason: 'not_configured',
        message: `Integration ${integrationId} not found`,
      }
    }

    // Check we still have a refreshable credential — from the shared tenant
    // credential when linked, else the per-integration token.
    const now = Math.floor(Date.now() / 1000)
    if (row.tenant_credential_id) {
      const cred = loadTenantCredentialById(row.tenant_credential_id)
      if (!cred || (!cred.access_token && !cred.refresh_token)) {
        return { status: 'red', reason: 'auth_expired', message: 'Shared Google credential missing or unreadable' }
      }
      if (cred.token_expiry && cred.token_expiry < now && !cred.refresh_token) {
        return { status: 'red', reason: 'auth_expired', message: 'Shared credential expired and no refresh token' }
      }
    } else {
      const token = loadToken(integrationId)
      if (!token) {
        return { status: 'red', reason: 'auth_expired', message: 'No stored token (vault read returned null)' }
      }
      if (token.token_expiry && token.token_expiry < now && !token.refresh_token) {
        return { status: 'red', reason: 'auth_expired', message: 'Access token expired and no refresh token on file' }
      }
    }

    // If we've never fetched, yellow:stale. Even if everything else looks fine.
    if (!row.last_synced_at) {
      return {
        status: 'yellow',
        reason: 'stale',
        message: 'No snapshot yet — call fetchSnapshot() to verify end-to-end',
      }
    }

    // 7 days since last sync = stale (configurable later via settings).
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

export { GSC_OAUTH_SCOPES }
