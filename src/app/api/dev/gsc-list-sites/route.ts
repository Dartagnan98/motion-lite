// Dev-only: list GSC sites the latest integration's token can access.
// Gated to NODE_ENV !== 'production'. Used by scripts/gsc-pick-site.mjs.

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getValidAccessToken, listSites } from '@/lib/platform/integrations/gsc/oauth'
import { ensurePlatformReady } from '@/lib/platform/tenant'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 })
  }
  ensurePlatformReady()

  const integration = getDb().prepare(`
    SELECT id, tenant_id, config_json
    FROM platform_integrations
    WHERE provider = 'gsc' AND status = 'connected'
    ORDER BY id DESC LIMIT 1
  `).get() as { id: number; tenant_id: number; config_json: string | null } | undefined

  if (!integration) {
    return NextResponse.json({ error: 'No connected GSC integration found' }, { status: 404 })
  }

  let currentSiteUrl: string | null = null
  if (integration.config_json) {
    try { currentSiteUrl = JSON.parse(integration.config_json).siteUrl ?? null } catch {}
  }

  try {
    const accessToken = await getValidAccessToken(integration.id)
    const sites = await listSites(accessToken)
    return NextResponse.json({
      integrationId: integration.id,
      currentSiteUrl,
      sites: sites.siteEntry ?? [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
