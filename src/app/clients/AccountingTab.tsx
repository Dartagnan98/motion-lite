'use client'

// Accounting tab (Phase 4 Sprint 1) — full all-time QBO ledger for a client.
// Internal / PM-only (never on the public report). Shown only for QBO-mapped
// clients. Lifetime KPIs + AR aging + the complete invoice list.

import { useEffect, useState } from 'react'

interface Aging { bucket: string; invoice_count: number; amount: number }
interface Invoice { date: string; number: string; amount: number; balance: number; status: string; dueDate: string | null }
interface Data {
  mapped: boolean
  kpis?: { invoiced: number | null; paid: number | null; outstanding: number | null; dso: number | null }
  aging?: Aging[]
  invoices?: Invoice[]
  error?: string
}

const usd = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function AccountingTab({ clientId }: { clientId: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetch(`/api/platform/clients/${clientId}/accounting`)
      .then((r) => r.json())
      .then((d: Data) => { if (!live) return; if (d.error) setError(d.error); else setData(d) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Failed to load') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [clientId])

  if (loading) return <p className="text-[13px] text-text-dim px-4 py-6">Loading accounting…</p>
  if (error) return <p className="text-[13px] text-red-500 px-4 py-6">{error}</p>
  if (data && !data.mapped) return <p className="text-[13px] text-text-dim px-4 py-6">Map this client to a QuickBooks customer (Profile tab) to see its ledger.</p>
  if (!data) return null

  const k = data.kpis
  return (
    <div className="space-y-6">
      {/* Lifetime KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Invoiced (lifetime)', v: usd(k?.invoiced) },
          { label: 'Paid', v: usd(k?.paid) },
          { label: 'Outstanding', v: usd(k?.outstanding) },
          { label: 'DSO (days)', v: k?.dso ?? '—' },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-border p-4">
            <div className="text-[11px] uppercase tracking-wider text-text-dim mb-1">{t.label}</div>
            <div className="text-[22px] font-semibold text-text">{t.v}</div>
          </div>
        ))}
      </div>

      {/* AR aging */}
      <div>
        <h3 className="text-[13px] font-semibold text-text mb-2">AR Aging</h3>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-[13px]">
            <thead><tr className="text-text-dim text-[11px] uppercase tracking-wider border-b border-border">
              <th className="text-left px-3 py-2">Bucket</th><th className="text-right px-3 py-2">Invoices</th><th className="text-right px-3 py-2">Amount</th>
            </tr></thead>
            <tbody>
              {(data.aging ?? []).map((a) => (
                <tr key={a.bucket} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 text-text">{a.bucket}</td>
                  <td className="px-3 py-2 text-right text-text-dim">{a.invoice_count}</td>
                  <td className="px-3 py-2 text-right text-text">{usd(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* All invoices */}
      <div>
        <h3 className="text-[13px] font-semibold text-text mb-2">All Invoices <span className="text-text-dim font-normal">({data.invoices?.length ?? 0})</span></h3>
        <div className="rounded-lg border border-border overflow-hidden max-h-[480px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card"><tr className="text-text-dim text-[11px] uppercase tracking-wider border-b border-border">
              <th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Invoice</th>
              <th className="text-right px-3 py-2">Amount</th><th className="text-right px-3 py-2">Balance</th><th className="text-left px-3 py-2">Status</th>
            </tr></thead>
            <tbody>
              {(data.invoices ?? []).length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-text-dim">No invoices for this customer.</td></tr>
              ) : (data.invoices ?? []).map((inv, i) => (
                <tr key={`${inv.number}-${i}`} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 text-text-dim">{inv.date}</td>
                  <td className="px-3 py-2 text-text">{inv.number}</td>
                  <td className="px-3 py-2 text-right text-text">{usd(inv.amount)}</td>
                  <td className="px-3 py-2 text-right text-text-dim">{inv.balance > 0 ? usd(inv.balance) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${inv.status === 'Open' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{inv.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
