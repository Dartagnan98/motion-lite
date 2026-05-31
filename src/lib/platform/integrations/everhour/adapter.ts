// Everhour adapter — implements AdapterContract<EverhourRawSnapshot, EverhourNormalized>.
//
// Auth model: api_key. No OAuth. Mirrors PageSpeed adapter pattern exactly.
//
// connect() validates the API key by calling GET /users/me, then creates the
// integration row and returns integrationId. No redirect.
//
// API key is stored in config_json (plaintext at rest — same decision as PageSpeed).
// See README §API key storage for the rationale.
//
// Flow:
//   1. connect()       → validate key → create integration row → return integrationId
//   2. fetchSnapshot() → read config_json → call /team/time → return EverhourRawSnapshot
//   3. normalize()     → pure EverhourRawSnapshot → EverhourNormalized
//   4. health()        → read integration row; cheap probe (no live ping on health())
//   5. refresh()       → no-op (no OAuth)
//
// Rate limits: 60 req/min. fetchSnapshot makes 1 paginated call (the /team/time
// endpoint returns all entries for the date range in one response — no cursor).
// Backoff: 429 and 5xx get up to 3 attempts at 1s/2s/4s.

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
import type { EverhourRawSnapshot, EverhourTimeEntry, EverhourUser } from './types'
import type { EverhourNormalized } from './normalize'

const EVERHOUR_API_BASE = 'https://api.everhour.com'

// ─── Config shape ─────────────────────────────────────────────────────────────

interface EverhourConfig {
  /** API key stored plaintext in config_json. See README §API key storage. */
  apiKey: string
  /** Optional list of Everhour project IDs to filter. Empty = all projects. */
  projectIds?: string[]
  /** Client IDs selected during the multi-step connect flow. */
  clientIds?: string[]
  /** Client display names parallel to clientIds (for dashboard tile labels). */
  clientNames?: string[]
}

function readConfig(integrationId: number): EverhourConfig {
  ensurePlatformReady()
  const row = getDb().prepare(
    'SELECT config_json FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { config_json: string | null } | undefined
  if (!row) throw new Error(`everhour.adapter: integration ${integrationId} not found`)
  if (!row.config_json) {
    throw new Error(`everhour.adapter: integration ${integrationId} has no config_json`)
  }
  let parsed: Partial<EverhourConfig>
  try {
    parsed = JSON.parse(row.config_json)
  } catch {
    throw new Error(`everhour.adapter: integration ${integrationId} config_json invalid JSON`)
  }
  if (!parsed.apiKey || typeof parsed.apiKey !== 'string') {
    throw new Error(`everhour.adapter: integration ${integrationId} config_json missing apiKey`)
  }
  return {
    apiKey: parsed.apiKey,
    projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds : undefined,
    clientIds: Array.isArray(parsed.clientIds) ? parsed.clientIds : undefined,
    clientNames: Array.isArray(parsed.clientNames) ? parsed.clientNames : undefined,
  }
}

// ─── API helpers ─────────────────────────────────────────────────────────────

/** Generic Everhour API call with exponential backoff.
 *
 *  Rate limits: 60 req/min.
 *  Retry: 429 and 5xx get up to 3 attempts (1s/2s/4s).
 *  Auth errors (401) are non-retryable. */
async function callEverhour<T>(args: {
  apiKey: string
  path: string
  params?: Record<string, string>
}): Promise<T> {
  const url = new URL(`${EVERHOUR_API_BASE}${args.path}`)
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
        'X-Api-Key': args.apiKey,
        'Content-Type': 'application/json',
      },
    })

    if (res.ok) {
      return (await res.json()) as T
    }

    // Non-retryable auth error.
    if (res.status === 401) {
      const text = await res.text()
      throw new Error(`everhour.adapter: auth failed (401) — invalid API key: ${text}`)
    }

    // Other non-retryable 4xx.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      const text = await res.text()
      throw new Error(`everhour.adapter: API call failed (${res.status}): ${text}`)
    }

    // Retryable: 429 or 5xx.
    attempt++
    if (attempt >= maxAttempts) {
      const text = await res.text()
      throw new Error(
        `everhour.adapter: API call failed after ${maxAttempts} attempts (${res.status}): ${text}`
      )
    }
    const backoffMs = Math.pow(2, attempt - 1) * 1000  // 1s, 2s, 4s
    await new Promise((r) => setTimeout(r, backoffMs))
  }

  throw new Error('everhour.adapter: callEverhour exhausted retry loop unexpectedly')
}

/** Validate the API key by calling /users/me. Returns the authed user on success.
 *  Throws on invalid key (401) or other errors. */
async function validateApiKey(apiKey: string): Promise<EverhourUser> {
  return callEverhour<EverhourUser>({ apiKey, path: '/users/me' })
}

/** Fetch all time entries for the team in the given date range.
 *
 *  Endpoint: GET /team/time?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 *  Everhour returns time entries in a flat array (not paginated by cursor).
 *  Large date ranges (e.g. 90 days) may return large payloads; the adapter
 *  handles this by accepting whatever the API returns in one call. For
 *  Phase 2, 30-day windows are the norm — no pagination concern.
 *
 *  The response shape varies slightly between API versions:
 *    - Some return `{ data: [...] }`
 *    - Others return the array directly
 *  We handle both. */
/** Fetch all projects and build an ID → { name, clientName } map. Used by
 *  normalize() to label rows in hours.by_project — the /team/time endpoint
 *  returns only project IDs, not names. Everhour ignores page/limit on
 *  /projects, so we short-circuit when a page introduces no new IDs. */
async function fetchAllProjects(args: {
  apiKey: string
}): Promise<Record<string, { name: string; clientName?: string | null }>> {
  const map: Record<string, { name: string; clientName?: string | null }> = {}
  const limit = 250
  for (let page = 1; page < 20; page++) {
    const raw = await callEverhour<unknown>({
      apiKey: args.apiKey,
      path: '/projects',
      params: { page: String(page), limit: String(limit), query: '' },
    })
    const items: Array<{ id?: string; name?: string; client?: { name?: string | null } | null }> =
      Array.isArray(raw)
        ? (raw as Array<{ id?: string; name?: string; client?: { name?: string | null } | null }>)
        : raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)
        ? ((raw as { data: Array<{ id?: string; name?: string; client?: { name?: string | null } | null }> }).data)
        : []
    if (items.length === 0) break
    let newCount = 0
    for (const p of items) {
      if (p.id && p.name && !map[p.id]) {
        map[p.id] = { name: p.name, clientName: p.client?.name ?? null }
        newCount++
      }
    }
    if (newCount === 0) break
    if (items.length < limit) break
  }
  return map
}

// ─── Public picker helpers (used by the multi-step connect UI) ───────────────

export interface EverhourClient {
  id: string
  name: string
  projectCount?: number
}

/** List all clients accessible with the given API key.
 *  GET /clients. Dedupes by id — Everhour ignores `page`/`limit` on this
 *  endpoint and returns the full list every call. We loop defensively but
 *  short-circuit as soon as a page introduces no new IDs. */
export async function listClients(apiKey: string): Promise<EverhourClient[]> {
  const byId = new Map<string, EverhourClient>()
  const limit = 250

  for (let page = 1; page < 20; page++) {
    const raw = await callEverhour<unknown>({
      apiKey,
      path: '/clients',
      params: { page: String(page), limit: String(limit) },
    })
    const items: Array<{ id?: string; name?: string; projectCount?: number }> =
      Array.isArray(raw)
        ? (raw as Array<{ id?: string; name?: string; projectCount?: number }>)
        : raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)
        ? ((raw as { data: Array<{ id?: string; name?: string; projectCount?: number }> }).data)
        : []

    if (items.length === 0) break

    let newCount = 0
    for (const item of items) {
      if (!item.id || !item.name) continue
      const id = String(item.id)
      if (!byId.has(id)) {
        byId.set(id, { id, name: item.name, projectCount: item.projectCount })
        newCount++
      }
    }

    // If this page added no new IDs, the API is ignoring pagination — stop.
    if (newCount === 0) break
    // If we got fewer than `limit`, we've seen the full set.
    if (items.length < limit) break
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

export interface EverhourPickerProject {
  id: string
  name: string
  clientId: string | null
  clientName: string | null
}

/** Extract the client ID from a project record. Everhour's actual shape is
 *  `project.client = <number>` (a bare numeric ID, NOT a nested object).
 *  We also handle the documented alternative shapes defensively. */
function extractClientId(item: Record<string, unknown>): string | null {
  const client = item.client
  // Shape A (actual Everhour): bare number/string
  if (typeof client === 'number' || typeof client === 'string') return String(client)
  // Shape B: nested object (documented in some API references)
  if (client && typeof client === 'object' && 'id' in client) {
    const id = (client as { id?: string | number }).id
    if (id != null) return String(id)
  }
  // Shape C: bare clientId on the project
  if (item.clientId != null) return String(item.clientId)
  // Shape D: snake_case
  if (item.client_id != null) return String(item.client_id)
  return null
}

function extractClientName(item: Record<string, unknown>): string | null {
  const client = item.client
  if (client && typeof client === 'object' && 'name' in client) {
    return (client as { name?: string | null }).name ?? null
  }
  // Project's `client` is just an ID — name is not embedded. Resolved later
  // from the clientNames map carried in the cookie payload.
  return null
}

/** List projects filtered to the given clientIds (or all projects if empty).
 *
 *  Strategy: each /clients record carries a `projects` array (list of project
 *  IDs that belong to that client). We pivot off that — much more reliable
 *  than trying to read a client reference off each project, because:
 *    1. Everhour's /projects.client is a bare integer (no nested name)
 *    2. /projects is capped at 250 per call and the GlenValley projects may
 *       not be in the first batch in a workspace with thousands of projects
 *  Then we look up names from /projects (paginated map already exists). */
export async function listProjectsByClients(args: {
  apiKey: string
  clientIds: string[]
}): Promise<EverhourPickerProject[]> {
  // Fetch /clients to get each client's `projects` array. Same dedupe logic
  // as listClients — handles the pagination-ignored quirk.
  const filterSet = new Set(args.clientIds)
  const clientsById = new Map<string, { name: string; projectIds: string[] }>()
  const limit = 250
  for (let page = 1; page < 20; page++) {
    const raw = await callEverhour<unknown>({
      apiKey: args.apiKey,
      path: '/clients',
      params: { page: String(page), limit: String(limit) },
    })
    const items: Array<{ id?: string | number; name?: string; projects?: string[] }> =
      Array.isArray(raw)
        ? (raw as Array<{ id?: string | number; name?: string; projects?: string[] }>)
        : raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)
        ? ((raw as { data: Array<{ id?: string | number; name?: string; projects?: string[] }> }).data)
        : []
    if (items.length === 0) break
    let newCount = 0
    for (const item of items) {
      if (item.id == null || !item.name) continue
      const id = String(item.id)
      if (!clientsById.has(id)) {
        clientsById.set(id, {
          name: item.name,
          projectIds: Array.isArray(item.projects) ? item.projects.map(String) : [],
        })
        newCount++
      }
    }
    if (newCount === 0) break
    if (items.length < limit) break
  }

  // Build the union of project IDs across selected clients (or all if no filter).
  const targetProjectIds = new Set<string>()
  const projectIdToClientId = new Map<string, string>()
  const projectIdToClientName = new Map<string, string>()
  for (const [clientId, client] of clientsById.entries()) {
    if (filterSet.size > 0 && !filterSet.has(clientId)) continue
    for (const pid of client.projectIds) {
      targetProjectIds.add(pid)
      projectIdToClientId.set(pid, clientId)
      projectIdToClientName.set(pid, client.name)
    }
  }

  if (targetProjectIds.size === 0) return []

  // Look up project names. We already have fetchAllProjects which builds the
  // project ID → name map. Reuse it.
  const projectNameMap = await fetchAllProjects({ apiKey: args.apiKey })

  const result: EverhourPickerProject[] = []
  for (const pid of targetProjectIds) {
    const meta = projectNameMap[pid]
    result.push({
      id: pid,
      name: meta?.name ?? pid,  // fallback to ID if not in the name map
      clientId: projectIdToClientId.get(pid) ?? null,
      clientName: projectIdToClientName.get(pid) ?? null,
    })
  }

  return result.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

// ─── Internal time helpers ────────────────────────────────────────────────────

async function fetchTeamTime(args: {
  apiKey: string
  from: string  // YYYY-MM-DD
  to: string    // YYYY-MM-DD
}): Promise<EverhourTimeEntry[]> {
  // Everhour /team/time returns an array directly (not wrapped).
  // We type the response loosely and normalize below.
  const raw = await callEverhour<unknown>({
    apiKey: args.apiKey,
    path: '/team/time',
    params: {
      from: args.from,
      to: args.to,
      // Request task.projects so we can group by project.
      // Everhour field selection via query params is not documented but
      // the default response includes task and user objects.
    },
  })

  // Normalize the two possible response shapes.
  if (Array.isArray(raw)) {
    return raw as EverhourTimeEntry[]
  }
  if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data)) {
    return (raw as { data: EverhourTimeEntry[] }).data
  }

  throw new Error(
    `everhour.adapter: /team/time returned unexpected shape: ${JSON.stringify(raw).slice(0, 200)}`
  )
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const everhourAdapter: AdapterContract<EverhourRawSnapshot, EverhourNormalized> = {
  provider: 'everhour',
  authModel: 'api_key',
  displayName: 'Everhour',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    // api_key connect: validate the key, create the integration row, return integrationId.
    //
    // ctx.apiKey = the Everhour API key.
    // ctx.callbackState may carry:
    //   projectIds:  JSON array string of selected project IDs
    //   clientIds:   JSON array string of selected client IDs
    //   clientNames: JSON array string of selected client display names
    if (!ctx.apiKey) {
      throw new Error('everhour.adapter.connect: ctx.apiKey is required')
    }

    // Validate the key. This call throws on 401 or other errors.
    await validateApiKey(ctx.apiKey)

    // Parse arrays from callbackState (passed as JSON strings).
    function parseJsonArray(raw: string | number | undefined): string[] {
      if (!raw) return []
      if (typeof raw === 'number') return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as string[]) : []
      } catch {
        // Legacy: comma-separated fallback
        return (raw as string).split(',').map((s) => s.trim()).filter(Boolean)
      }
    }

    const projectIds = parseJsonArray(ctx.callbackState?.projectIds as string | undefined)
    const clientIds = parseJsonArray(ctx.callbackState?.clientIds as string | undefined)
    const clientNames = parseJsonArray(ctx.callbackState?.clientNames as string | undefined)

    ensurePlatformReady()
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    const configObj: Record<string, unknown> = { apiKey: ctx.apiKey }
    if (projectIds.length > 0) configObj.projectIds = projectIds
    if (clientIds.length > 0) configObj.clientIds = clientIds
    if (clientNames.length > 0) configObj.clientNames = clientNames

    const config = JSON.stringify(configObj)

    // Build display_name: "Everhour — ClientName" for 1, "Everhour — N clients" for many.
    let displayName: string
    if (clientNames.length === 1) {
      displayName = `Everhour — ${clientNames[0]}`
    } else if (clientNames.length > 1) {
      displayName = `Everhour — ${clientNames.length} clients`
    } else {
      displayName = 'Everhour'
    }

    // Dedupe: reconnect/reconfigure (e.g. adding a new Everhour project) updates
    // the existing tile for this account instead of creating a duplicate.
    const { findIntegrationForAccount, updateIntegrationConfig } = await import('../upsert')
    const existingId = findIntegrationForAccount({ tenantId: ctx.tenantId, provider: 'everhour', accountId: ctx.accountId })
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
       VALUES (?, ?, ?, ?, ?, ?, 'everhour', 'api_key', ?, ?, 'connected', NULL, ?, NULL, ?, ?)`
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
    // No-op. Everhour uses a plain API key with no expiry concept.
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<EverhourRawSnapshot> {
    ensurePlatformReady()
    const config = readConfig(args.integrationId)
    const periodStart = args.period.start.toISOString().slice(0, 10)
    const periodEnd = args.period.end.toISOString().slice(0, 10)

    let entries = await fetchTeamTime({
      apiKey: config.apiKey,
      from: periodStart,
      to: periodEnd,
    })

    // /team/time returns project IDs as bare strings (no name). Resolve via
    // a separate /projects call — the normalizer uses this to label the
    // hours.by_project series. Non-fatal: if /projects fails we still ship
    // hours.total + hours.daily, and by_project falls back to ID-as-name.
    let projectsById: Record<string, { name: string; clientName?: string | null }> = {}
    try {
      projectsById = await fetchAllProjects({ apiKey: config.apiKey })
    } catch (err) {
      console.error('[everhour] /projects fetch failed; project names will fall back to IDs', err)
    }

    // If projectIds are configured, filter entries to those projects.
    if (config.projectIds && config.projectIds.length > 0) {
      const projectSet = new Set(config.projectIds)
      entries = entries.filter((e) => {
        if (!e.task || !e.task.projects || e.task.projects.length === 0) return false
        return e.task.projects.some((pid) => projectSet.has(pid))
      })
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
      periodStart,
      periodEnd,
      entries,
      projectsById,
      fetchedAt: new Date().toISOString(),
    }
  },

  normalize(raw: EverhourRawSnapshot): EverhourNormalized {
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
      const parsed = JSON.parse(row.config_json) as Partial<{ apiKey: string }>
      if (!parsed.apiKey) {
        return {
          status: 'red',
          reason: 'not_configured',
          message: 'config_json missing apiKey — reconnect required',
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
