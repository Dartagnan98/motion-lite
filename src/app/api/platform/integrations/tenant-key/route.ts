// GET /api/platform/integrations/tenant-key?provider=everhour|se_ranking|pagespeed
//
// Returns the agency's shared API key for an api_key provider (if previously
// entered for any client), so the connect form can prefill it — no re-pasting
// the same key per client (CONNECTOR-REUSE-PLAN A3). Authenticated; returns the
// agency's own key to the agency's own user over the same origin.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { listTenantCredentials } from '@/lib/platform/vault'
import { getDb } from '@/lib/db'

const ALLOWED = new Set(['everhour', 'se_ranking', 'pagespeed'])

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider') ?? ''
  if (!ALLOWED.has(provider)) {
    return NextResponse.json({ error: 'unsupported provider' }, { status: 400 })
  }
  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ apiKey: null, clientWebsite: null })
  const tenant = ensureTenantForWorkspace(workspaceId)

  let cred = listTenantCredentials(tenant.id, provider).find(
    (c) => c.auth_model === 'api_key' && c.api_key
  )

  // Bootstrap: if no shared key yet, adopt one from an existing connected
  // integration's config_json (keys pre-date A3) so prefill works without a
  // reconnect.
  if (!cred) {
    const row = getDb().prepare(
      `SELECT config_json FROM platform_integrations
        WHERE tenant_id = ? AND provider = ? AND status = 'connected' AND config_json IS NOT NULL
        ORDER BY id DESC LIMIT 1`
    ).get(tenant.id, provider) as { config_json: string } | undefined
    if (row) {
      try {
        const apiKey = (JSON.parse(row.config_json) as { apiKey?: string }).apiKey
        if (apiKey) {
          const { saveTenantCredential, listTenantCredentials: relist } = await import('@/lib/platform/vault')
          saveTenantCredential({ tenant_id: tenant.id, provider, auth_model: 'api_key', identity: 'default', api_key: apiKey })
          cred = relist(tenant.id, provider).find((c) => c.auth_model === 'api_key' && c.api_key)
        }
      } catch { /* malformed config_json — skip */ }
    }
  }

  // Also return the active client's website (PageSpeed prefills its URL from it,
  // per #6 — domain reused when connecting tools).
  let clientWebsite: string | null = null
  const accountId = await getCurrentAccountId(tenant.id)
  if (accountId) {
    const row = getDb().prepare('SELECT website FROM client_profiles WHERE id = ?').get(accountId) as { website: string | null } | undefined
    clientWebsite = row?.website ?? null
  }

  return NextResponse.json({ apiKey: cred?.api_key ?? null, clientWebsite })
}
