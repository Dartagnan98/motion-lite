// POST /api/platform/integrations/pagespeed/connect
//
// Direct (non-OAuth) connect for PageSpeed Insights.
// Body: { url: string, strategy: 'mobile'|'desktop', apiKey: string,
//         level?: 'account', accountId?: number, workspaceId?: number }
//
// Flow:
//   1. Validate body fields.
//   2. Resolve tenant from session.
//   3. Resolve accountId (from active account cookie, or body-supplied).
//   4. Call pagespeedAdapter.connect() — synchronously creates the integration row.
//   5. Optionally fire the first snapshot immediately (if fireFirstSnapshot=true in body).
//   6. Return { integrationId } — caller redirects to dashboard.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { pagespeedAdapter } from '@/lib/platform/integrations/pagespeed/adapter'
import { persistSnapshot } from '@/lib/platform/snapshots'

export async function POST(req: NextRequest) {
  let body: {
    url?: unknown
    strategy?: unknown
    apiKey?: unknown
    level?: unknown
    accountId?: unknown
    workspaceId?: unknown
    fireFirstSnapshot?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : null
  const strategy = body.strategy === 'desktop' ? 'desktop' : 'mobile'
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : null
  const fireFirstSnapshot = body.fireFirstSnapshot === true

  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }
  // Basic URL validation.
  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: 'url must be a valid URL (include https://)' }, { status: 400 })
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
  }

  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)

    // Adopt as the agency's shared PageSpeed key (CONNECTOR-REUSE-PLAN A3).
    const { saveTenantCredential } = await import('@/lib/platform/vault')
    saveTenantCredential({ tenant_id: tenant.id, provider: 'pagespeed', auth_model: 'api_key', identity: 'default', api_key: apiKey })

    let accountId = typeof body.accountId === 'number' ? body.accountId : null
    if (!accountId) {
      accountId = await getCurrentAccountId(tenant.id)
      if (!accountId) {
        return NextResponse.json(
          { error: 'No active client selected. Create a client first.' },
          { status: 400 }
        )
      }
    }

    // pagespeedAdapter.connect() writes the integration row + returns integrationId.
    const result = await pagespeedAdapter.connect({
      tenantId: tenant.id,
      level: 'account',
      agencyId: null,
      accountId,
      domainId: null,
      redirectUri: '',  // api_key adapters don't use redirectUri
      apiKey,
      callbackState: { url, strategy },
    })

    if (!result.integrationId) {
      return NextResponse.json({ error: 'Adapter did not return an integrationId' }, { status: 500 })
    }

    const integrationId = result.integrationId

    // Optionally fire the first PageSpeed audit immediately.
    if (fireFirstSnapshot) {
      try {
        const now = new Date()
        const raw = await pagespeedAdapter.fetchSnapshot({
          integrationId,
          accountId,
          period: { start: now, end: now },
        })
        const normalized = pagespeedAdapter.normalize(raw)
        await persistSnapshot({
          tenant_id: tenant.id,
          integration_id: integrationId,
          account_id: accountId,
          period_start: normalized.periodStart,
          period_end: normalized.periodEnd,
          raw,
          normalized,
        })
      } catch (snapErr) {
        // Non-fatal: integration row is stored. PM can re-fetch from dashboard.
        console.error('[platform/pagespeed/connect] initial snapshot failed:', snapErr)
      }
    }

    return NextResponse.json({ ok: true, integrationId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('[platform/pagespeed/connect]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
