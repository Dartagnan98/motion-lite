// QuickBooks Online adapter (Phase 4 Sprint 1) — client-level financials.
//
// Tenant-level integration (one realm, account_id NULL). fetchSnapshot is called
// per client (accountId = client_profiles.id); we resolve that client's
// qbo_customer_id and query QBO filtered to it. Emits finance.* slugs.

import type { AdapterContract, HealthStatus, ConnectContext, ConnectResult, FetchSnapshotArgs } from '../../adapter-contract'
import type { QboRawSnapshot, QboNormalized, QboInvoice, QboPayment } from './types'
import { getDb } from '../../../db'
import { ensurePlatformReady } from '../../tenant'
import { loadTenantCredentialById } from '../../vault'
import { signState } from '../../state'
import { buildAuthUrl, getValidAccessToken, qboApiGet } from './oauth'

function iso(d: Date): string { return d.toISOString().slice(0, 10) }

/** Run a QBO query (SELECT …) and return the named entity array. */
async function query<T>(accessToken: string, realmId: string, sql: string, entity: string): Promise<T[]> {
  const resp = await qboApiGet(accessToken, realmId, `query?query=${encodeURIComponent(sql)}&minorversion=65`) as
    { QueryResponse?: Record<string, T[]> }
  return resp.QueryResponse?.[entity] ?? []
}

/** Resolve realmId (integration config) + the client's qbo_customer_id. */
function resolveContext(integrationId: number, accountId: number): { realmId: string; customerId: string | null } {
  const db = getDb()
  const integ = db.prepare('SELECT config_json FROM platform_integrations WHERE id = ?').get(integrationId) as { config_json: string | null } | undefined
  const realmId = integ?.config_json ? (JSON.parse(integ.config_json) as { realmId?: string }).realmId ?? '' : ''
  if (!realmId) throw new Error(`qbo.adapter: integration ${integrationId} has no realmId`)
  const client = db.prepare('SELECT qbo_customer_id FROM client_profiles WHERE id = ?').get(accountId) as { qbo_customer_id: string | null } | undefined
  return { realmId, customerId: client?.qbo_customer_id ?? null }
}

export const qboAdapter: AdapterContract<QboRawSnapshot, QboNormalized> = {
  provider: 'qbo',
  authModel: 'oauth',
  displayName: 'QuickBooks Online',

  async connect(ctx: ConnectContext): Promise<ConnectResult> {
    const state = signState({
      provider: 'qbo',
      tenantId: ctx.tenantId,
      level: 'agency',
      agencyId: ctx.agencyId,
      accountId: null,
      domainId: null,
      ...(ctx.callbackState || {}),
    })
    return { redirectUrl: buildAuthUrl({ redirectUri: ctx.redirectUri, state }) }
  },

  async refresh(integrationId: number): Promise<void> {
    await getValidAccessToken(integrationId)
  },

  async fetchSnapshot(args: FetchSnapshotArgs): Promise<QboRawSnapshot> {
    ensurePlatformReady()
    const { realmId, customerId } = resolveContext(args.integrationId, args.accountId)
    const periodStart = iso(args.period.start)
    const periodEnd = iso(args.period.end)

    // Unmapped client → empty snapshot (Financial Summary shows empty state).
    if (!customerId) {
      return { realmId, customerId: null, periodStart, periodEnd, periodInvoices: [], periodPayments: [], openInvoices: [] }
    }

    const accessToken = await getValidAccessToken(args.integrationId)
    const cust = `'${customerId.replace(/'/g, "''")}'`

    const periodInvoices = await query<QboInvoice>(accessToken, realmId,
      `SELECT * FROM Invoice WHERE CustomerRef = ${cust} AND TxnDate >= '${periodStart}' AND TxnDate <= '${periodEnd}' ORDERBY TxnDate`, 'Invoice')
    const periodPayments = await query<QboPayment>(accessToken, realmId,
      `SELECT * FROM Payment WHERE CustomerRef = ${cust} AND TxnDate >= '${periodStart}' AND TxnDate <= '${periodEnd}'`, 'Payment')
    const openInvoices = await query<QboInvoice>(accessToken, realmId,
      `SELECT * FROM Invoice WHERE CustomerRef = ${cust} AND Balance > '0' ORDERBY TxnDate`, 'Invoice')

    return { realmId, customerId, periodStart, periodEnd, periodInvoices, periodPayments, openInvoices }
  },

  normalize(raw: QboRawSnapshot): QboNormalized {
    const invoicedTotal = raw.periodInvoices.reduce((s, i) => s + (i.TotalAmt || 0), 0)
    const paidTotal = raw.periodPayments.reduce((s, p) => s + (p.TotalAmt || 0), 0)
    const outstanding = raw.openInvoices.reduce((s, i) => s + (i.Balance || 0), 0)

    const periodDays = Math.max(1,
      (new Date(raw.periodEnd + 'T00:00:00').getTime() - new Date(raw.periodStart + 'T00:00:00').getTime()) / 86400000 + 1)
    const dso = invoicedTotal > 0 ? Math.round(outstanding / (invoicedTotal / periodDays)) : 0

    // AR aging buckets by days past due (DueDate, fallback TxnDate).
    const now = Date.now()
    const buckets = { 'Current': { c: 0, a: 0 }, '1-30': { c: 0, a: 0 }, '31-60': { c: 0, a: 0 }, '61-90': { c: 0, a: 0 }, '90+': { c: 0, a: 0 } }
    for (const inv of raw.openInvoices) {
      const due = new Date((inv.DueDate || inv.TxnDate) + 'T00:00:00').getTime()
      const daysPast = Math.floor((now - due) / 86400000)
      const k = daysPast <= 0 ? 'Current' : daysPast <= 30 ? '1-30' : daysPast <= 60 ? '31-60' : daysPast <= 90 ? '61-90' : '90+'
      buckets[k].c += 1; buckets[k].a += inv.Balance || 0
    }

    // Daily invoiced series.
    const daily = new Map<string, number>()
    for (const inv of raw.periodInvoices) daily.set(inv.TxnDate, (daily.get(inv.TxnDate) || 0) + (inv.TotalAmt || 0))

    const recent = [...raw.periodInvoices]
      .sort((a, b) => b.TxnDate.localeCompare(a.TxnDate))
      .slice(0, 10)
      .map((i) => ({ date: i.TxnDate, number: i.DocNumber || i.Id, amount: i.TotalAmt || 0, status: (i.Balance || 0) > 0 ? 'Open' : 'Paid' }))

    return {
      provider: 'qbo',
      periodStart: raw.periodStart,
      periodEnd: raw.periodEnd,
      normalizedAt: new Date().toISOString(),
      metrics: {
        'finance.invoiced_total': { value: Math.round(invoicedTotal * 100) / 100, unit: 'USD', label: 'Invoiced' },
        'finance.paid_total': { value: Math.round(paidTotal * 100) / 100, unit: 'USD', label: 'Paid' },
        'finance.outstanding': { value: Math.round(outstanding * 100) / 100, unit: 'USD', label: 'Outstanding' },
        'finance.dso_days': { value: dso, unit: 'count', label: 'Days Sales Outstanding' },
        'finance.ar_aging': {
          columns: [
            { key: 'bucket', label: 'Aging', type: 'string' },
            { key: 'invoice_count', label: 'Invoices', type: 'number' },
            { key: 'amount', label: 'Amount', type: 'currency' },
          ],
          rows: Object.entries(buckets).map(([bucket, v]) => ({ bucket, invoice_count: v.c, amount: Math.round(v.a * 100) / 100 })),
        },
        'finance.recent_invoices': {
          columns: [
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'number', label: 'Invoice', type: 'string' },
            { key: 'amount', label: 'Amount', type: 'currency' },
            { key: 'status', label: 'Status', type: 'string' },
          ],
          rows: recent,
        },
        'finance.invoiced_daily': {
          columns: [
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'amount', label: 'Invoiced', type: 'currency' },
          ],
          rows: [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 })),
        },
      },
    }
  },

  async health(integrationId: number): Promise<HealthStatus> {
    ensurePlatformReady()
    const row = getDb().prepare(
      'SELECT status, last_synced_at, tenant_credential_id FROM platform_integrations WHERE id = ?'
    ).get(integrationId) as { status: string; last_synced_at: number | null; tenant_credential_id: number | null } | undefined
    if (!row) return { status: 'red', reason: 'not_configured', message: `Integration ${integrationId} not found` }
    if (!row.tenant_credential_id) return { status: 'red', reason: 'auth_expired', message: 'No QBO credential linked' }
    const cred = loadTenantCredentialById(row.tenant_credential_id)
    if (!cred || (!cred.access_token && !cred.refresh_token)) {
      return { status: 'red', reason: 'auth_expired', message: 'QBO credential missing or unreadable' }
    }
    const now = Math.floor(Date.now() / 1000)
    if (cred.token_expiry && cred.token_expiry < now && !cred.refresh_token) {
      return { status: 'red', reason: 'auth_expired', message: 'QBO token expired and no refresh token' }
    }
    if (!row.last_synced_at) return { status: 'yellow', reason: 'stale', message: 'No snapshot yet' }
    return { status: 'green', lastFetchedAt: new Date(row.last_synced_at * 1000) }
  },
}
