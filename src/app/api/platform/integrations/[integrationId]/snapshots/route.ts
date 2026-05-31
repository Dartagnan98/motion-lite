// GET /api/platform/integrations/[integrationId]/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns the snapshot history for a single integration within a date window.
// Used by SiteHealthSection to build the PSI trend chart (Slice B).
//
// Response: { snapshots: [{ id, period_end, period_start, data_json }] }
//   - ordered by period_end ASC
//   - data_json is the normalized MetricEnvelope (parsed from normalized_json)
//   - filtered to from <= period_end <= to when both params are provided
//   - tenant-scoped: returns 403/404 if integration doesn't belong to caller
//
// Design choice (option a from spec): client-side fetch on mount, thin endpoint,
// no changes to the RSC pipeline or getReportWithSections.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithWorkspace } from '@/lib/auth'
import { ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'
import type { MetricEnvelope } from '@/lib/platform/adapter-contract'

interface RouteParams {
  params: Promise<{ integrationId: string }>
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { integrationId: integrationIdStr } = await params
  const integrationId = parseInt(integrationIdStr, 10)

  if (isNaN(integrationId) || integrationId <= 0) {
    return NextResponse.json({ error: 'Invalid integrationId' }, { status: 400 })
  }

  try {
    const { workspaceId } = await requireAuthWithWorkspace(req)
    const tenant = ensureTenantForWorkspace(workspaceId)
    assertTenantOwnsRow(tenant, 'platform_integrations', integrationId)

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
    const validFrom = from && ISO_DATE.test(from) ? from : null
    const validTo = to && ISO_DATE.test(to) ? to : null

    // Build query with optional date bounds. Both bounds must be provided to
    // apply date filtering — if either is missing, return all snapshots for the
    // integration (ordered by period_end, one-per-day deduped via latest fetch).
    let query: string
    let queryParams: (string | number)[]

    if (validFrom && validTo) {
      query = `
        SELECT id, period_start, period_end, normalized_json
          FROM platform_snapshots
         WHERE tenant_id = ? AND integration_id = ?
           AND period_end >= ? AND period_end <= ?
         ORDER BY period_end ASC, fetched_at DESC
      `
      queryParams = [tenant.id, integrationId, validFrom, validTo]
    } else {
      query = `
        SELECT id, period_start, period_end, normalized_json
          FROM platform_snapshots
         WHERE tenant_id = ? AND integration_id = ?
         ORDER BY period_end ASC, fetched_at DESC
      `
      queryParams = [tenant.id, integrationId]
    }

    const rows = getDb().prepare(query).all(...queryParams) as {
      id: number
      period_start: string
      period_end: string
      normalized_json: string
    }[]

    // Deduplicate: if multiple snapshots share the same period_end (i.e. multiple
    // refetches on the same day), keep only the latest one — ORDER BY fetched_at DESC
    // means the first occurrence per period_end wins after dedup.
    const seen = new Set<string>()
    const dedupedRows = rows.filter((r) => {
      if (seen.has(r.period_end)) return false
      seen.add(r.period_end)
      return true
    })

    const snapshots = dedupedRows.map((r) => {
      let data_json: MetricEnvelope | null = null
      try {
        data_json = JSON.parse(r.normalized_json) as MetricEnvelope
      } catch {
        data_json = null
      }
      return {
        id: r.id,
        period_start: r.period_start,
        period_end: r.period_end,
        data_json,
      }
    })

    return NextResponse.json({ snapshots })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    if (message === 'FORBIDDEN' || message.includes('does not own')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    console.error('[platform/integrations/snapshots GET]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
