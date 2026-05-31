// GET /api/platform/clients/[id]/accounting
//
// Full all-time QBO ledger for a client (Accounting tab — Phase 4 Sprint 1).
// Internal / PM-only. Reuses the QBO adapter over an all-time window, returns
// lifetime KPIs + AR aging + the COMPLETE invoice list (not the report's
// period-capped recent-10).

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, assertTenantOwnsRow } from '@/lib/platform/tenant'
import { qboAdapter } from '@/lib/platform/integrations/qbo/adapter'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params
  const accountId = parseInt(idStr, 10)
  if (isNaN(accountId) || accountId <= 0) return NextResponse.json({ error: 'Invalid client id' }, { status: 400 })

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const tenant = ensureTenantForWorkspace(workspaceId)
  try { assertTenantOwnsRow(tenant, 'client_profiles', accountId) }
  catch { return NextResponse.json({ error: 'Client not found' }, { status: 404 }) }

  const db = getDb()
  const client = db.prepare('SELECT qbo_customer_id FROM client_profiles WHERE id = ?').get(accountId) as { qbo_customer_id: string | null } | undefined
  if (!client?.qbo_customer_id) return NextResponse.json({ mapped: false })

  const integ = db.prepare(
    `SELECT id FROM platform_integrations WHERE tenant_id = ? AND provider = 'qbo' AND status = 'connected' LIMIT 1`
  ).get(tenant.id) as { id: number } | undefined
  if (!integ) return NextResponse.json({ error: 'QBO not connected' }, { status: 400 })

  try {
    const raw = await qboAdapter.fetchSnapshot({
      integrationId: integ.id,
      accountId,
      domainId: null,
      period: { start: new Date('2000-01-01'), end: new Date() },
    })
    const norm = qboAdapter.normalize(raw)
    const metric = (slug: string) => {
      const m = norm.metrics[slug]
      return m && 'value' in m ? m.value : null
    }
    // Full invoice list (newest first) — joined with open balance for status.
    const openById = new Map(raw.openInvoices.map((i) => [i.Id, i.Balance]))
    const invoices = [...raw.periodInvoices]
      .sort((a, b) => b.TxnDate.localeCompare(a.TxnDate))
      .map((i) => ({
        date: i.TxnDate,
        number: i.DocNumber || i.Id,
        amount: i.TotalAmt || 0,
        balance: openById.get(i.Id) ?? 0,
        status: (openById.get(i.Id) ?? 0) > 0 ? 'Open' : 'Paid',
        dueDate: i.DueDate || null,
      }))

    return NextResponse.json({
      mapped: true,
      kpis: {
        invoiced: metric('finance.invoiced_total'),
        paid: metric('finance.paid_total'),
        outstanding: metric('finance.outstanding'),
        dso: metric('finance.dso_days'),
      },
      aging: norm.metrics['finance.ar_aging'] && 'rows' in norm.metrics['finance.ar_aging'] ? norm.metrics['finance.ar_aging'].rows : [],
      invoices,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QBO fetch failed'
    console.error('[platform/clients/accounting]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
