// GET /api/platform/client-enrichment
//
// Returns platform enrichment data (integrations, last report, health) for every
// platform-enrolled client_profile, keyed by client_profile_id.
//
// Phase C: client_profiles.id is now the canonical account id. Joins go directly
// from client_profiles to platform_integrations / platform_reports. CRM-only
// clients (tenant_id IS NULL) still appear in the result (with zero integrations).
//
// Shape returned per entry:
//   {
//     clientProfileId: number,
//     connectedCount: number,
//     totalAvailable: 10,
//     lastReportPeriodEnd: string | null,
//     health: 'green' | 'amber' | 'red' | 'gray'
//   }

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getCurrentWorkspaceId,
  ensureTenantForWorkspace,
} from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'

const TOTAL_AVAILABLE = 10

type Health = 'green' | 'amber' | 'red' | 'gray'

interface IntegrationRow {
  client_profile_id: number
  integration_status: string | null
  last_health_status: string | null
  last_synced_at: number | null
}

interface EnrichmentEntry {
  clientProfileId: number
  connectedCount: number
  totalAvailable: number
  lastReportPeriodEnd: string | null
  health: Health
}

function computeHealth(rows: IntegrationRow[]): Health {
  const connected = rows.filter(r => r.integration_status === 'connected')
  if (connected.length === 0) return 'gray'
  const now = Math.floor(Date.now() / 1000)
  let hasRed = false
  let hasAmber = false
  for (const r of connected) {
    const h = r.last_health_status
    if (h === 'red') { hasRed = true; continue }
    if (h === 'yellow') { hasAmber = true; continue }
    if (r.last_synced_at) {
      const age = now - r.last_synced_at
      if (age > 72 * 3600) { hasRed = true }
      else if (age > 24 * 3600) { hasAmber = true }
    }
  }
  if (hasRed) return 'red'
  if (hasAmber) return 'amber'
  return 'green'
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const tenant = ensureTenantForWorkspace(workspaceId)
  const db = getDb()

  // Phase C: direct join from client_profiles → platform_integrations.
  // Only platform-enrolled clients (tenant_id matches) have integration rows;
  // others fall through to the all-clients backfill loop below.
  const integrationRows = db.prepare(`
    SELECT
      cp.id AS client_profile_id,
      pi.status AS integration_status,
      pi.last_health_status,
      pi.last_synced_at
    FROM client_profiles cp
    LEFT JOIN platform_integrations pi
      ON pi.account_id = cp.id
      AND pi.tenant_id = ?
      AND pi.status = 'connected'
      AND pi.level = 'account'
    WHERE cp.tenant_id = ? OR cp.tenant_id IS NULL
  `).all(tenant.id, tenant.id) as IntegrationRow[]

  const reportRows = db.prepare(`
    SELECT cp.id AS client_profile_id, MAX(pr.period_end) AS last_report_period_end
    FROM client_profiles cp
    LEFT JOIN platform_reports pr
      ON pr.account_id = cp.id
      AND pr.tenant_id = ?
    WHERE cp.tenant_id = ? OR cp.tenant_id IS NULL
    GROUP BY cp.id
  `).all(tenant.id, tenant.id) as { client_profile_id: number; last_report_period_end: string | null }[]

  const reportMap = new Map<number, string | null>()
  for (const r of reportRows) {
    reportMap.set(r.client_profile_id, r.last_report_period_end ?? null)
  }

  const grouped = new Map<number, IntegrationRow[]>()
  for (const row of integrationRows) {
    const id = row.client_profile_id
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id)!.push(row)
  }

  const result: EnrichmentEntry[] = []
  for (const [clientProfileId, rows] of grouped) {
    result.push({
      clientProfileId,
      connectedCount: rows.filter(r => r.integration_status === 'connected').length,
      totalAvailable: TOTAL_AVAILABLE,
      lastReportPeriodEnd: reportMap.get(clientProfileId) ?? null,
      health: computeHealth(rows),
    })
  }

  // Include client_profiles that had no integration rows.
  const allCpIds = db.prepare('SELECT id FROM client_profiles').all() as { id: number }[]
  for (const { id } of allCpIds) {
    if (!grouped.has(id)) {
      result.push({
        clientProfileId: id,
        connectedCount: 0,
        totalAvailable: TOTAL_AVAILABLE,
        lastReportPeriodEnd: reportMap.get(id) ?? null,
        health: 'gray',
      })
    }
  }

  return NextResponse.json({ enrichment: result })
}
