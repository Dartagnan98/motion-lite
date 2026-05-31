// Dev-only: change a GSC integration's siteUrl + immediately re-fetch.
// Gated to NODE_ENV !== 'production'. Used by scripts/gsc-pick-site.mjs.

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { gscAdapter } from '@/lib/platform/integrations/gsc/adapter'
import { persistSnapshot } from '@/lib/platform/snapshots'
import { ensurePlatformReady } from '@/lib/platform/tenant'

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 })
  }
  ensurePlatformReady()

  const body = await req.json().catch(() => ({}))
  const integrationId = typeof body.integrationId === 'number' ? body.integrationId : null
  const siteUrl = typeof body.siteUrl === 'string' ? body.siteUrl : null
  if (!integrationId || !siteUrl) {
    return NextResponse.json({ error: 'integrationId + siteUrl required' }, { status: 400 })
  }

  const row = getDb().prepare(
    'SELECT id, tenant_id, account_id, domain_id FROM platform_integrations WHERE id = ?'
  ).get(integrationId) as { id: number; tenant_id: number; account_id: number | null; domain_id: number | null } | undefined

  if (!row) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  // Update config_json + bump updated_at
  getDb().prepare(`
    UPDATE platform_integrations
    SET config_json = ?, updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(JSON.stringify({ siteUrl }), integrationId)

  // Re-fetch + persist
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)

  try {
    const raw = await gscAdapter.fetchSnapshot({
      integrationId,
      accountId: row.account_id ?? 0,
      domainId: row.domain_id ?? undefined,
      period: { start, end },
    })
    const normalized = gscAdapter.normalize(raw)

    persistSnapshot({
      tenant_id: row.tenant_id,
      integration_id: integrationId,
      account_id: row.account_id ?? 0,
      domain_id: row.domain_id,
      period_start: normalized.periodStart,
      period_end: normalized.periodEnd,
      raw,
      normalized,
    })

    return NextResponse.json({
      ok: true,
      siteUrl,
      periodStart: raw.periodStart,
      periodEnd: raw.periodEnd,
      dailyRows: raw.daily?.rows?.length ?? 0,
      queryCount: raw.topQueries?.rows?.length ?? 0,
      pageCount: raw.topPages?.rows?.length ?? 0,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
