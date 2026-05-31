// Asana OAuth flow.
//
// Scopes: 'default' (Asana's single bundled scope — grants full read+write access
// to all resources the user can see; there are no granular read-only scopes in
// Asana OAuth v2 as of 2026).
//
// Endpoints:
//   Auth:   https://app.asana.com/-/oauth_authorize
//   Token:  https://app.asana.com/-/oauth_token
//
// Token lifespan: access tokens expire after 1 hour. Refresh tokens never expire
// unless the user revokes app access in Asana's settings or 90 days of inactivity
// (Asana docs: "Refresh tokens are valid indefinitely unless revoked").
//
// Env vars required (devops-registered per OAuth app):
//   ASANA_CLIENT_ID
//   ASANA_CLIENT_SECRET
//
// ─── Threat model ────────────────────────────────────────────────────────────
// Same as GA4/GSC. OAuth state is HMAC-signed with signState() before sending
// to Asana. The callback verifies with verifyState() before any DB write.
// See src/lib/platform/state.ts.

import { getDb, generatePublicId } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import { saveToken, updateAccessToken, loadToken } from '../../vault'
import { findIntegrationForAccount, updateIntegrationConfig } from '../upsert'
import type { AsanaWorkspacesResponse, AsanaWorkspace } from './types'

export const ASANA_OAUTH_SCOPES = ['default'] as const

/** Minimum buffer before expiry to consider a token "still valid" (seconds).
 *  Asana tokens last 1h; 60s buffer is enough to complete a fetchSnapshot call. */
const REFRESH_BUFFER_SECONDS = 60

// ─── Auth URL ─────────────────────────────────────────────────────────────────

/** Build the Asana OAuth consent URL. */
export function buildAuthUrl(args: {
  redirectUri: string
  state: string
}): string {
  const clientId = process.env.ASANA_CLIENT_ID
  if (!clientId) throw new Error('asana.oauth: ASANA_CLIENT_ID env var not set')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: ASANA_OAUTH_SCOPES.join(' '),
    state: args.state,
  })
  return `https://app.asana.com/-/oauth_authorize?${params.toString()}`
}

// ─── Code exchange ────────────────────────────────────────────────────────────

export interface ExchangeResult {
  access_token: string
  refresh_token: string | null
  /** Asana token expiry in seconds from now. Typically 3600. */
  expires_in: number
  /** Asana user data embedded in the token response. */
  data?: {
    id?: number
    gid?: string
    name?: string
    email?: string
  }
  scopes: string
}

/** Exchange an authorization code for Asana tokens.
 *  Asana's token response includes a `data` field with the authed user's profile. */
export async function exchangeCode(args: {
  code: string
  redirectUri: string
}): Promise<ExchangeResult> {
  const clientId = process.env.ASANA_CLIENT_ID
  const clientSecret = process.env.ASANA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('asana.oauth: ASANA_CLIENT_ID / ASANA_CLIENT_SECRET not set')
  }

  const res = await fetch('https://app.asana.com/-/oauth_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
    }),
  })
  const body = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    data?: { id?: number; gid?: string; name?: string; email?: string }
    error?: string
    error_description?: string
  }

  if (!body.access_token) {
    throw new Error(
      `asana.oauth: token exchange failed — ${body.error || 'unknown'}: ${body.error_description || JSON.stringify(body)}`
    )
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token || null,
    expires_in: body.expires_in ?? 3600,
    data: body.data,
    scopes: ASANA_OAUTH_SCOPES.join(' '),
  }
}

// ─── Per-integration refresh lock ────────────────────────────────────────────
// Prevents races when multiple concurrent requests trigger a refresh for the
// same integration. Pattern mirrors GA4/GSC exactly.

const refreshLocks = new Map<number, Promise<string>>()

/** Return a valid (unexpired) access token for the integration, refreshing if
 *  needed. Throws if no token row or refresh fails. */
export async function getValidAccessToken(integrationId: number): Promise<string> {
  ensurePlatformReady()
  const stored = loadToken(integrationId)
  if (!stored) throw new Error(`asana.oauth: no token for integration ${integrationId}`)

  const now = Math.floor(Date.now() / 1000)
  if (stored.token_expiry && stored.token_expiry > now + REFRESH_BUFFER_SECONDS) {
    return stored.access_token
  }

  // Need to refresh. Serialize per integration to avoid token thrash.
  const inFlight = refreshLocks.get(integrationId)
  if (inFlight) return inFlight

  const integrationRow = getDb().prepare(
    'SELECT tenant_id FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { tenant_id: number } | undefined
  if (!integrationRow) {
    throw new Error(`asana.oauth: integration ${integrationId} not found (cannot resolve tenant_id)`)
  }
  const tenantId = integrationRow.tenant_id

  const promise = (async () => {
    try {
      if (!stored.refresh_token) {
        throw new Error('asana.oauth: token expired and no refresh_token on record')
      }
      const clientId = process.env.ASANA_CLIENT_ID
      const clientSecret = process.env.ASANA_CLIENT_SECRET
      if (!clientId || !clientSecret) {
        throw new Error('asana.oauth: ASANA_CLIENT_ID / ASANA_CLIENT_SECRET not set')
      }

      const res = await fetch('https://app.asana.com/-/oauth_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: stored.refresh_token,
        }),
      })
      const data = (await res.json()) as {
        access_token?: string
        expires_in?: number
        refresh_token?: string
        error?: string
        error_description?: string
      }
      if (!data.access_token) {
        throw new Error(
          `asana.oauth: refresh failed — ${data.error || 'unknown'}: ${data.error_description || JSON.stringify(data)}`
        )
      }
      const newExpiry = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600)
      updateAccessToken({
        tenant_id: tenantId,
        integration_id: integrationId,
        access_token: data.access_token,
        token_expiry: newExpiry,
        // Asana may or may not rotate the refresh token; update if present.
        refresh_token: data.refresh_token ?? null,
      })
      return data.access_token
    } finally {
      refreshLocks.delete(integrationId)
    }
  })()
  refreshLocks.set(integrationId, promise)
  return promise
}

// ─── Workspace listing ────────────────────────────────────────────────────────

export interface AsanaWorkspaceChoice {
  workspaceId: string
  displayName: string
}

/** List all Asana workspaces the authed user is a member of.
 *  Exposed for the workspace picker after OAuth completes.
 *
 *  Pagination: Asana paginates at 100 per page. We follow next_page.offset
 *  until exhausted. In practice most users are in 1–3 workspaces. */
export async function listWorkspaces(accessToken: string): Promise<AsanaWorkspaceChoice[]> {
  const results: AsanaWorkspaceChoice[] = []
  let offset: string | undefined

  do {
    const url = new URL('https://app.asana.com/api/1.0/workspaces')
    url.searchParams.set('limit', '100')
    url.searchParams.set('opt_fields', 'gid,name')
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`asana.oauth: workspaces.list failed (${res.status}): ${text}`)
    }
    const body = (await res.json()) as AsanaWorkspacesResponse
    for (const ws of body.data || []) {
      results.push({ workspaceId: ws.gid, displayName: ws.name })
    }
    offset = body.next_page?.offset
  } while (offset)

  return results
}

// ─── Integration persistence ─────────────────────────────────────────────────

/** Persist the integration row + encrypted token after the user picks a workspace + scope.
 *  Called from connect-flow.ts:completeConnect(). */
export function persistIntegration(args: {
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  workspaceId: string
  workspaceDisplayName: string
  /** Optional scope selection (portfolio or projects). Legacy callers omit this. */
  scope?: 'portfolio' | 'projects'
  portfolioId?: string
  portfolioName?: string
  projectIds?: string[]
  projectNames?: string[]
  email: string | null
  exchange: ExchangeResult
}): { integrationId: number } {
  ensurePlatformReady()
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  const configObj: Record<string, unknown> = {
    workspaceId: args.workspaceId,
    workspaceDisplayName: args.workspaceDisplayName,
  }
  if (args.scope) configObj.scope = args.scope
  if (args.portfolioId) configObj.portfolioId = args.portfolioId
  if (args.portfolioName) configObj.portfolioName = args.portfolioName
  if (args.projectIds && args.projectIds.length > 0) configObj.projectIds = args.projectIds
  if (args.projectNames && args.projectNames.length > 0) configObj.projectNames = args.projectNames

  const config = JSON.stringify(configObj)

  // Build display_name based on scope.
  let displayName: string
  if (args.scope === 'portfolio' && args.portfolioName) {
    displayName = `Asana — ${args.portfolioName}`
  } else if (args.scope === 'projects' && args.projectNames) {
    if (args.projectNames.length === 1) {
      displayName = `Asana — ${args.projectNames[0]}`
    } else {
      displayName = `Asana — ${args.workspaceDisplayName} (${args.projectNames.length} projects)`
    }
  } else {
    // Legacy / no scope: fall back to workspace + email pattern.
    displayName = args.email
      ? `Asana — ${args.workspaceDisplayName} (${args.email})`
      : `Asana — ${args.workspaceDisplayName}`
  }

  // Dedupe: reconnect/reconfigure (e.g. adding an Asana project) updates the
  // existing tile for this account instead of creating a duplicate.
  const existingId = findIntegrationForAccount({ tenantId: args.tenantId, provider: 'asana', accountId: args.accountId })
  const result = existingId
    ? null
    : db.prepare(
        `INSERT INTO platform_integrations
           (tenant_id, public_id, level, agency_id, account_id, domain_id,
            provider, auth_model, config_json, display_name,
            status, last_health_status, last_health_checked_at, last_synced_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'asana', 'oauth', ?, ?, 'connected', 'green', ?, NULL, ?, ?)`
      ).run(
        args.tenantId,
        generatePublicId(),
        args.level,
        args.agencyId,
        args.accountId,
        args.domainId,
        config,
        displayName,
        now,
        now,
        now,
      )
  let integrationId: number
  if (existingId) {
    updateIntegrationConfig({ integrationId: existingId, configJson: config, displayName })
    integrationId = existingId
  } else {
    integrationId = Number(result!.lastInsertRowid)
  }

  saveToken({
    tenant_id: args.tenantId,
    integration_id: integrationId,
    access_token: args.exchange.access_token,
    refresh_token: args.exchange.refresh_token,
    token_expiry: Math.floor(Date.now() / 1000) + args.exchange.expires_in,
    provider_user_id: args.exchange.data?.gid ?? null,
    provider_email: args.email,
    scopes: args.exchange.scopes,
  })

  return { integrationId }
}

// ─── Portfolio + project listing ─────────────────────────────────────────────

export interface AsanaPortfolio {
  gid: string
  name: string
  ownerName?: string
}

export interface AsanaProject {
  gid: string
  name: string
  archived?: boolean
}

/** Generic Asana API GET helper. Throws on non-2xx after the caller handles
 *  pagination externally. Used by the three listing functions below. */
async function callAsana<T>(accessToken: string, url: URL): Promise<T> {
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`asana.oauth: GET ${url.pathname} failed (${res.status}): ${text}`)
  }
  return (await res.json()) as T
}

interface AsanaListResponse<T> {
  data: T[]
  next_page: { offset: string } | null
}

/** List all portfolios owned by the authed user in a workspace.
 *  Paginates via next_page.offset. Dedupes by gid. Sorts alphabetically. */
export async function listPortfolios(args: {
  accessToken: string
  workspaceGid: string
}): Promise<AsanaPortfolio[]> {
  const seen = new Map<string, AsanaPortfolio>()
  let offset: string | undefined

  do {
    const url = new URL('https://app.asana.com/api/1.0/portfolios')
    url.searchParams.set('workspace', args.workspaceGid)
    url.searchParams.set('owner', 'me')
    url.searchParams.set('opt_fields', 'gid,name,owner.name')
    url.searchParams.set('limit', '100')
    if (offset) url.searchParams.set('offset', offset)

    const body = await callAsana<AsanaListResponse<{
      gid: string
      name: string
      owner?: { name?: string }
    }>>(args.accessToken, url)

    for (const p of body.data || []) {
      if (!seen.has(p.gid)) {
        seen.set(p.gid, {
          gid: p.gid,
          name: p.name,
          ownerName: p.owner?.name,
        })
      }
    }
    offset = body.next_page?.offset
  } while (offset)

  return Array.from(seen.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

/** List all projects inside an Asana portfolio.
 *  Paginates. Filters to items where resource_type === 'project'. Dedupes + sorts. */
export async function listPortfolioProjects(args: {
  accessToken: string
  portfolioGid: string
}): Promise<AsanaProject[]> {
  const seen = new Map<string, AsanaProject>()
  let offset: string | undefined

  do {
    const url = new URL(
      `https://app.asana.com/api/1.0/portfolios/${args.portfolioGid}/items`
    )
    url.searchParams.set('opt_fields', 'gid,name,archived,resource_type')
    url.searchParams.set('limit', '100')
    if (offset) url.searchParams.set('offset', offset)

    const body = await callAsana<AsanaListResponse<{
      gid: string
      name: string
      archived?: boolean
      resource_type?: string
    }>>(args.accessToken, url)

    for (const item of body.data || []) {
      if (item.resource_type === 'project' && !seen.has(item.gid)) {
        seen.set(item.gid, {
          gid: item.gid,
          name: item.name,
          archived: item.archived ?? false,
        })
      }
    }
    offset = body.next_page?.offset
  } while (offset)

  return Array.from(seen.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

/** List all non-archived projects in a workspace.
 *  Paginates via next_page.offset. Dedupes + sorts alphabetically. */
export async function listProjectsInWorkspace(args: {
  accessToken: string
  workspaceGid: string
}): Promise<AsanaProject[]> {
  const seen = new Map<string, AsanaProject>()
  let offset: string | undefined

  do {
    const url = new URL('https://app.asana.com/api/1.0/projects')
    url.searchParams.set('workspace', args.workspaceGid)
    url.searchParams.set('archived', 'false')
    url.searchParams.set('opt_fields', 'gid,name,archived')
    url.searchParams.set('limit', '100')
    if (offset) url.searchParams.set('offset', offset)

    const body = await callAsana<AsanaListResponse<{
      gid: string
      name: string
      archived?: boolean
    }>>(args.accessToken, url)

    for (const p of body.data || []) {
      if (!seen.has(p.gid)) {
        seen.set(p.gid, {
          gid: p.gid,
          name: p.name,
          archived: p.archived ?? false,
        })
      }
    }
    offset = body.next_page?.offset
  } while (offset)

  return Array.from(seen.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

// Re-export for consumers that only import from oauth.ts
export type { AsanaWorkspace }
