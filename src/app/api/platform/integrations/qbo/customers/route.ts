// GET /api/platform/integrations/qbo/customers[?q=search]
//
// Lists QBO customers from the tenant's QBO integration — powers the per-client
// mapping picker (and resolves a mapped customer's display name). Tenant-scoped.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace } from '@/lib/platform/tenant'
import { getValidAccessToken, qboApiGet } from '@/lib/platform/integrations/qbo/oauth'
import { getDb } from '@/lib/db'

interface QboCustomer { Id: string; DisplayName?: string; CompanyName?: string; Active?: boolean }

export async function GET(req: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const tenant = ensureTenantForWorkspace(workspaceId)

  const integ = getDb().prepare(
    `SELECT id, config_json FROM platform_integrations WHERE tenant_id = ? AND provider = 'qbo' AND status = 'connected' LIMIT 1`
  ).get(tenant.id) as { id: number; config_json: string | null } | undefined
  if (!integ) {
    return NextResponse.json({ error: 'QBO is not connected for this agency' }, { status: 400 })
  }
  const realmId = integ.config_json ? (JSON.parse(integ.config_json) as { realmId?: string }).realmId ?? '' : ''
  if (!realmId) return NextResponse.json({ error: 'QBO integration missing realmId' }, { status: 400 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().replace(/'/g, "''")
  const idParam = (req.nextUrl.searchParams.get('id') ?? '').trim().replace(/'/g, "''")
  const where = idParam
    ? ` WHERE Id = '${idParam}'`
    : q ? ` WHERE DisplayName LIKE '%${q}%'` : ''

  try {
    const accessToken = await getValidAccessToken(integ.id)
    // QBO caps a query at 1000 rows; paginate via STARTPOSITION to get them all.
    const PAGE = 1000
    const all: QboCustomer[] = []
    let start = 1
    for (let guard = 0; guard < 20; guard++) {
      const sql = `SELECT * FROM Customer${where} ORDERBY DisplayName STARTPOSITION ${start} MAXRESULTS ${PAGE}`
      const resp = await qboApiGet(accessToken, realmId, `query?query=${encodeURIComponent(sql)}&minorversion=65`) as
        { QueryResponse?: { Customer?: QboCustomer[] } }
      const batch = resp.QueryResponse?.Customer ?? []
      all.push(...batch)
      if (batch.length < PAGE) break
      start += PAGE
    }
    const customers = all.map((c) => ({
      id: c.Id,
      name: c.DisplayName || c.CompanyName || `Customer ${c.Id}`,
    }))
    return NextResponse.json({ customers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QBO customer fetch failed'
    console.error('[platform/qbo/customers]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
