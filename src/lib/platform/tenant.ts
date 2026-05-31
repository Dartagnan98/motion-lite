// Hiilite Platform — Tenant resolution
//
// Phase 1-3: tenant == motion-lite workspace. Single-tenant in practice but the
// column is on every row. We auto-create one platform_tenants row per workspace
// on first read.
//
// Phase 4 (Supabase + agency-tenant isolation): the tenant becomes the agency
// and Supabase RLS enforces "tenant_id = current_agency()". Only this file
// needs to change at cutover.

import { cookies } from 'next/headers'
import { getDb, generatePublicId } from '../db'
import { initPlatformSchema } from './schema'
import { signState, verifyState } from './state'

let _platformBooted = false

/** Ensure platform tables exist. Cheap to call repeatedly — idempotent.
 *  Call before any platform_* query. */
export function ensurePlatformReady(): void {
  if (_platformBooted) return
  initPlatformSchema(getDb())
  _platformBooted = true
}

export interface Tenant {
  id: number
  public_id: string
  name: string
  external_tenant_ref: string | null
  created_at: number
  updated_at: number
}

/** Get-or-create a platform tenant for the given motion-lite workspace.
 *  external_tenant_ref is set to "workspace:<id>" so we can trace back. */
export function ensureTenantForWorkspace(workspaceId: number, workspaceName?: string): Tenant {
  ensurePlatformReady()
  const db = getDb()
  const ref = `workspace:${workspaceId}`
  const existing = db.prepare(
    'SELECT * FROM platform_tenants WHERE external_tenant_ref = ?'
  ).get(ref) as Tenant | undefined
  if (existing) return existing

  const name = workspaceName || `Workspace ${workspaceId}`
  const result = db.prepare(
    `INSERT INTO platform_tenants (public_id, name, external_tenant_ref)
     VALUES (?, ?, ?)`
  ).run(generatePublicId(), name, ref)
  return db.prepare('SELECT * FROM platform_tenants WHERE id = ?')
    .get(result.lastInsertRowid) as Tenant
}

/** Resolve the active tenant from a request context. Phase 1-3 implementation:
 *  derive from the active workspace cookie. Callers that already have the
 *  workspace id should pass it directly to ensureTenantForWorkspace. */
export function resolveActiveTenant(workspaceId: number, workspaceName?: string): Tenant {
  return ensureTenantForWorkspace(workspaceId, workspaceName)
}

/** Server helper for platform pages: resolve current user's primary workspace
 *  id from session. Returns null if no session. Caller is responsible for
 *  redirecting to /login on null. */
export async function getCurrentWorkspaceId(): Promise<number | null> {
  const { getCurrentUser } = await import('../auth')
  const { getUserWorkspaces } = await import('../db')
  const user = await getCurrentUser()
  if (!user) return null
  const workspaces = getUserWorkspaces(user.id)
  if (workspaces.length === 0) return null
  const primary = workspaces.find((w: { is_primary?: number }) => w.is_primary === 1)
  return primary ? primary.id : workspaces[0].id
}

/** Helper: scope a SELECT to a tenant. Use in every read query that
 *  hits a platform_* table. Returns the bind parameter so the caller
 *  composes the SQL.
 *
 *  Example:
 *    const t = resolveActiveTenant(workspaceId)
 *    db.prepare('SELECT * FROM client_profiles WHERE tenant_id = ?').all(t.id)
 *
 *  Phase 4: this collapses to a no-op once Supabase RLS enforces the same. */
export function tenantId(tenant: Tenant): number {
  return tenant.id
}

// ─── Active Account helpers ───────────────────────────────────────────────────

const ACTIVE_ACCOUNT_COOKIE = 'hiilite_active_account_id'

interface ActiveAccountPayload {
  accountId: number
  tenantId: number
}

/** Reads the signed `hiilite_active_account_id` cookie, validates the account
 *  (a client_profiles row with tenant_id set) belongs to the given tenant, and
 *  returns its id. Falls back to the first active platform-enrolled client_profile
 *  in the tenant if no cookie or invalid cookie. Returns null if the tenant has
 *  no platform-enrolled clients at all (caller should redirect to the new-client wizard).
 *
 *  Phase C: client_profiles.id IS now the canonical account id. Cookie payload
 *  semantics are unchanged — accountId means client_profiles.id. */
export async function getCurrentAccountId(tenantId: number): Promise<number | null> {
  ensurePlatformReady()
  const db = getDb()

  // 1. Try to read + verify the cookie.
  try {
    const cookieStore = await cookies()
    const raw = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value
    if (raw) {
      const payload = verifyState<ActiveAccountPayload>(raw)
      if (payload && payload.tenantId !== tenantId) {
        console.warn('[getCurrentAccountId] HMAC-valid cookie has tenantId mismatch — falling back to first account', {
          cookieTenantId: payload.tenantId,
          sessionTenantId: tenantId,
        })
      }
      if (payload && payload.tenantId === tenantId && payload.accountId) {
        const row = db.prepare(
          `SELECT id FROM client_profiles
            WHERE id = ? AND tenant_id = ? AND platform_status = 'active'`
        ).get(payload.accountId, tenantId) as { id: number } | undefined
        if (row) return row.id
      }
    }
  } catch {
    // cookies() can throw in some Edge contexts; fall through to fallback.
  }

  // 2. Fallback: first active platform-enrolled client_profile in this tenant.
  //    tenant_id IS NOT NULL is implicit via the equality match.
  const fallback = db.prepare(
    `SELECT id
       FROM client_profiles
      WHERE tenant_id = ? AND platform_status = 'active'
      ORDER BY created_at ASC, id ASC
      LIMIT 1`
  ).get(tenantId) as { id: number } | undefined

  return fallback?.id ?? null
}

/** Build a signed cookie value for the active account. Used by the activate
 *  route and the new-client wizard. */
export function buildActiveAccountCookie(tenantId: number, accountId: number): string {
  return signState({ accountId, tenantId } as unknown as Record<string, unknown>)
}

export interface AccountForSwitcher {
  id: number
  name: string
  isActive: boolean
}

/** Lists all active platform-enrolled clients in the tenant for the AccountSwitcher.
 *  Phase C: reads from client_profiles (canonical post-consolidation). Rows with
 *  tenant_id = NULL (CRM-only client_profiles) are excluded by the WHERE clause. */
export function listAccountsForSwitcher(args: {
  tenantId: number
  activeAccountId: number | null
}): AccountForSwitcher[] {
  ensurePlatformReady()
  const rows = getDb().prepare(
    `SELECT id, name FROM client_profiles
      WHERE tenant_id = ? AND platform_status = 'active'
      ORDER BY name ASC`
  ).all(args.tenantId) as { id: number; name: string }[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.id === args.activeAccountId,
  }))
}

// ─── Tenant ownership guard ───────────────────────────────────────────────────

/** Hard guard for write paths. Throws if a write would cross tenants. Use
 *  before any UPDATE/DELETE that targets a row by id without tenant_id. */
export function assertTenantOwnsRow(
  tenant: Tenant,
  table: string,
  rowId: number
): void {
  ensurePlatformReady()
  // Whitelist tables to prevent SQL injection via dynamic table name.
  // Phase C: platform_accounts is gone — client_profiles is the canonical
  // account record. Callers that previously passed 'platform_accounts' must
  // pass 'client_profiles' instead.
  const ALLOWED = new Set([
    'platform_agencies', 'client_profiles', 'platform_domains',
    'platform_integrations', 'platform_oauth_tokens', 'platform_snapshots',
    'platform_report_templates', 'platform_reports',
    'platform_report_sections', 'platform_report_blocks',
    'platform_agency_users', 'platform_account_users',
    'platform_report_comments', 'platform_nps_responses',
  ])
  if (!ALLOWED.has(table)) {
    throw new Error(`assertTenantOwnsRow: unknown table ${table}`)
  }
  const row = getDb().prepare(
    `SELECT tenant_id FROM ${table} WHERE id = ?`
  ).get(rowId) as { tenant_id: number } | undefined
  if (!row) {
    throw new Error(`assertTenantOwnsRow: ${table}#${rowId} not found`)
  }
  if (row.tenant_id !== tenant.id) {
    throw new Error(
      `assertTenantOwnsRow: tenant ${tenant.id} does not own ${table}#${rowId} (owned by ${row.tenant_id})`
    )
  }
}
