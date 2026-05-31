// GA4 adapter — implements AdapterContract<GA4RawSnapshot, GA4Normalized>.
//
// Reference: mirrors the GSC adapter pattern exactly.
//
// Flow:
//   1. connect()       → build OAuth URL with HMAC-signed state
//   2. (callback)      → finishConnectStage1 → property picker → completeConnect
//   3. fetchSnapshot() → get valid token → 4 API calls → return GA4RawSnapshot
//   4. normalize()     → pure GA4RawSnapshot → GA4Normalized
//   5. health()        → read integration row + vault; cheap probe
//   6. refresh()       → force token refresh via getValidAccessToken

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
  GA4_OAUTH_SCOPES,
} from './oauth'
import { normalize } from './normalize'
import type { GA4ReportResponse, GA4RawSnapshot } from './types'
import type { GA4Normalized } from './normalize'

const GA4_DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta/properties'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Read propertyId from config_json on the integration row. */
function readPropertyId(integrationId: number): string {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`ga4.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`ga4.adapter: integration ${integrationId} has no config_json (missing propertyId)`)
  }
  let parsed: { propertyId?: string }
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`ga4.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.propertyId || typeof parsed.propertyId !== 'string') {
    throw new Error(`ga4.adapter: integration ${integrationId} config_json missing propertyId`)
  }
  return parsed.propertyId
}

/** Issue a single GA4 Data API runReport call with exponential backoff.
 *
 *  Rate limits:
 *    - 200,000 requests / day per Google Cloud project (property-level: 50,000)
 *    - 10 requests/second per property (short-burst)
 *  We make 7 sequential calls per fetchSnapshot. At daily cadence for up to
 *  ~12,000 properties that could become a concern — but we're nowhere near
 *  that in Phase 2. If we add multi-client batch refresh, throttle in the
 *  caller, not here.
 *
 *  Retry strategy: 429 and 5xx get up to 3 attempts with 1s/2s/4s backoff.
 *  Auth failures (401, 403) are non-retryable and propagate immediately. */
async function runReport(args: {
  accessToken: string
  propertyId: string
  body: Record<string, unknown>
}): Promise<GA4ReportResponse> {
  const url = `${GA4_DATA_API_BASE}/${args.propertyId}:runReport`

  let attempt = 0
  const maxAttempts = 3

  while (attempt < maxAttempts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args.body),
    })

    if (res.ok) {
      return (await res.json()) as GA4ReportResponse
    }

    // Non-retryable auth errors.
    if (res.status === 401 || res.status === 403) {
      const text = await res.text()
      throw new Error(`ga4.adapter: runReport auth failed (${res.status}): ${text}`)
    }

    // Retryable: 429 rate limit or 5xx transient.
    if (res.status === 429 || res.status >= 500) {
      attempt++
      if (attempt >= maxAttempts) {
        const text = await res.text()
        throw new Error(
          `ga4.adapter: runReport failed after ${maxAttempts} attempts (${res.status}): ${text}`
        )
      }
      const backoffMs = Math.pow(2, attempt - 1) * 1000  // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, backoffMs))
      continue
    }

    // All other 4xx: fail immediately.
    const text = await res.text()
    throw new Error(`ga4.adapter: runReport failed (${res.status}): ${text}`)
  }

  // Should never reach here.
  throw new Error('ga4.adapter: runReport exhausted retry loop unexpectedly')
}

/** GA4 renamed `conversions` → `keyEvents` in 2025. This wrapper tries
 *  `keyEvents` first; if the API responds with an "unknown metric" error
 *  (400 with "Field" or "unknown" in the message), it retries once with
 *  `conversions`. Returns both the report and the metric name that worked.
 *
 *  We extend the existing runReport error path rather than bolting on a
 *  sibling — if the retry also fails, the error from runReport propagates
 *  unchanged, structured as `ga4.adapter: runReport failed (400): ...`. */
async function runReportWithKeyEventsFallback(args: {
  accessToken: string
  propertyId: string
  body: Record<string, unknown>
  /** If the caller already knows which metric name worked, skip the probe. */
  knownMetricName?: 'keyEvents' | 'conversions'
}): Promise<{ report: GA4ReportResponse; metricName: 'keyEvents' | 'conversions' }> {
  // Replace the metric placeholder — body.metrics is an array of { name: string }.
  function swapMetric(
    body: Record<string, unknown>,
    from: string,
    to: string,
  ): Record<string, unknown> {
    const metrics = body.metrics as Array<{ name: string }>
    return {
      ...body,
      metrics: metrics.map((m) => ({ ...m, name: m.name === from ? to : m.name })),
    }
  }

  const firstName: 'keyEvents' | 'conversions' = args.knownMetricName ?? 'keyEvents'
  const secondName: 'keyEvents' | 'conversions' = firstName === 'keyEvents' ? 'conversions' : 'keyEvents'

  // Ensure the body uses the intended first-attempt metric name.
  const firstBody = swapMetric(
    swapMetric(args.body, 'conversions', firstName),
    'keyEvents',
    firstName,
  )

  try {
    const report = await runReport({
      accessToken: args.accessToken,
      propertyId: args.propertyId,
      body: firstBody,
    })
    return { report, metricName: firstName }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Only attempt the fallback on a 400 that looks like an unknown-metric
    // rejection. Auth errors (401/403) and rate limits (429/5xx) are handled
    // inside runReport and should not trigger a metric-name retry.
    const isUnknownMetric =
      msg.includes('(400)') &&
      (msg.toLowerCase().includes('unknown') ||
        msg.toLowerCase().includes('field') ||
        msg.toLowerCase().includes('metric'))
    if (!isUnknownMetric || args.knownMetricName !== undefined) {
      throw err
    }

    console.warn(
      `ga4.adapter: metric "${firstName}" rejected by API (${msg.slice(0, 120)}); retrying with "${secondName}"`
    )

    const secondBody = swapMetric(firstBody, firstName, secondName)
    const report = await runReport({
      accessToken: args.accessToken,
      propertyId: args.propertyId,
      body: secondBody,
    })
    return { report, metricName: secondName }
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const ga4Adapter: AdapterContract<GA4RawSnapshot, GA4Normalized> = {
  provider: 'ga4',
  authModel: 'oauth',
  displayName: 'Google Analytics 4',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // State carries connect context so the callback can write to the right
    // tenant + level. HMAC-signed — forged callbacks cannot inject into another
    // tenant. See adapter-contract.ts for the signed-state requirement.
    const stateObj = {
      provider: 'ga4',
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

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<GA4RawSnapshot> {
    ensurePlatformReady()
    const propertyId = readPropertyId(args.integrationId)
    const accessToken = await getValidAccessToken(args.integrationId)
    const startDate = toIsoDate(args.period.start)
    const endDate = toIsoDate(args.period.end)

    const dateRange = { startDate, endDate }

    // Calls 1–4: independent; run in parallel.
    //   1. Period summary — totals only, no dimension.
    //   2. Daily time series — date dimension, users + sessions.
    //   3. Top 25 pages by screenPageViews.
    //   4. Top 25 source/medium by sessions.
    const [summary, daily, topPages, topSources] = await Promise.all([
      runReport({
        accessToken,
        propertyId,
        body: {
          dateRanges: [dateRange],
          metrics: [
            { name: 'totalUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' },
            { name: 'engagementRate' },
            { name: 'bounceRate' },
          ],
        },
      }),
      runReport({
        accessToken,
        propertyId,
        body: {
          dateRanges: [dateRange],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'totalUsers' },
            { name: 'sessions' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
        },
      }),
      runReport({
        accessToken,
        propertyId,
        body: {
          dateRanges: [dateRange],
          dimensions: [{ name: 'pagePath' }],
          metrics: [
            { name: 'screenPageViews' },
            { name: 'sessions' },
          ],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 25,
        },
      }),
      runReport({
        accessToken,
        propertyId,
        body: {
          dateRanges: [dateRange],
          dimensions: [{ name: 'sessionSourceMedium' }],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
          ],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 25,
        },
      }),
    ])

    // Calls 5–11 run in two concurrent branches:
    //   Branch A (sequential): 5 → 6 → 7 (conversions — metric-name probe chains them)
    //   Branch B (parallel):   8, 9, 10, 11 (breakdown dimensions — fully independent)
    const [conversionsResult, breakdownResults] = await Promise.all([
      // Branch A: conversions chain.
      (async () => {
        // 5. Conversions total — probes for keyEvents vs conversions metric name.
        const { report: conversionsTotal, metricName: keyEventsMetricName } =
          await runReportWithKeyEventsFallback({
            accessToken,
            propertyId,
            body: {
              dateRanges: [dateRange],
              metrics: [{ name: 'keyEvents' }],
            },
          })

        console.log(
          `ga4.adapter: conversions metric name resolved to "${keyEventsMetricName}" for property ${propertyId}`
        )

        // 6. Conversions by event name.
        const { report: conversionsByEvent } = await runReportWithKeyEventsFallback({
          accessToken,
          propertyId,
          knownMetricName: keyEventsMetricName,
          body: {
            dateRanges: [dateRange],
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: keyEventsMetricName }],
            orderBys: [{ metric: { metricName: keyEventsMetricName }, desc: true }],
            limit: 50,
          },
        })

        // 7. Conversions by channel group.
        const { report: conversionsByChannel } = await runReportWithKeyEventsFallback({
          accessToken,
          propertyId,
          knownMetricName: keyEventsMetricName,
          body: {
            dateRanges: [dateRange],
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: keyEventsMetricName }],
            orderBys: [{ metric: { metricName: keyEventsMetricName }, desc: true }],
          },
        })

        return { conversionsTotal, conversionsByEvent, conversionsByChannel, keyEventsMetricName }
      })(),

      // Branch B: breakdown dimensions — all independent.
      Promise.all([
        // 8. Device breakdown — deviceCategory dimension, sessions metric.
        runReport({
          accessToken,
          propertyId,
          body: {
            dateRanges: [dateRange],
            dimensions: [{ name: 'deviceCategory' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          },
        }),
        // 9. New vs returning — newVsReturning dimension, sessions metric.
        runReport({
          accessToken,
          propertyId,
          body: {
            dateRanges: [dateRange],
            dimensions: [{ name: 'newVsReturning' }],
            metrics: [{ name: 'sessions' }],
          },
        }),
        // 10. Channels by sessions — sessionDefaultChannelGroup dimension, sessions metric.
        runReport({
          accessToken,
          propertyId,
          body: {
            dateRanges: [dateRange],
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          },
        }),
        // 11. Average session duration — no dimensions, single-value metric (seconds, float).
        runReport({
          accessToken,
          propertyId,
          body: {
            dateRanges: [dateRange],
            metrics: [{ name: 'averageSessionDuration' }],
          },
        }),
      ]),
    ])

    const { conversionsTotal, conversionsByEvent, conversionsByChannel, keyEventsMetricName } =
      conversionsResult
    const [deviceBreakdown, newVsReturning, channelsSessions, avgSessionDuration] = breakdownResults

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
      propertyId,
      periodStart: startDate,
      periodEnd: endDate,
      summary,
      daily,
      topPages,
      topSources,
      conversionsTotal,
      conversionsByEvent,
      conversionsByChannel,
      keyEventsMetricName,
      deviceBreakdown,
      newVsReturning,
      channelsSessions,
      avgSessionDuration,
      fetchedAt: new Date().toISOString(),
    }
  },

  normalize(raw: GA4RawSnapshot): GA4Normalized {
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

    // Refreshable-credential check — shared tenant credential when linked, else
    // the per-integration token.
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

export { GA4_OAUTH_SCOPES }
