'use client'

// /leads — Lead inbox.
// Top KPI strip from report (last N days: total leads, by source, top campaigns).
// Table of recentLeads newest first (created_at, name/email, source, campaign).
// Period selector (7/30/90 days).
// "Open contact" link to /contacts?id= for the auto-created contact.

import { useState, useEffect, useCallback } from 'react'

interface LeadReport {
  total: number
  bySource: Record<string, number>
  topCampaigns: { campaign_name: string; count: number }[]
}

interface Lead {
  id: number
  contact_id: number | null
  contact_public_id: string | null
  name: string | null
  email: string | null
  source: string | null
  campaign_name: string | null
  created_at: number
}

const fmtDate = (s: number | undefined) =>
  s ? new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export default function LeadsPage() {
  const [days, setDays] = useState(30)
  const [leads, setLeads] = useState<Lead[]>([])
  const [report, setReport] = useState<LeadReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/leads?days=${d}&limit=50`)
      if (!res.ok) throw new Error('Failed to load leads')
      const json = await res.json() as { recentLeads?: Lead[]; report?: LeadReport }
      setLeads(json.recentLeads ?? [])
      setReport(json.report ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(days) }, [days, load])

  const topSources = report?.bySource
    ? Object.entries(report.bySource).sort(([, a], [, b]) => b - a).slice(0, 4)
    : []

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Lead Inbox</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
              Inbound leads from Facebook / Google lead-ads (auto-created contacts)
            </p>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--border)' }}>
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="text-xs px-3 py-1.5 rounded-md transition-colors"
                style={{
                  background: days === d ? 'var(--bg-elevated, var(--bg))' : 'transparent',
                  color: days === d ? 'var(--text)' : 'var(--text-dim)',
                  fontWeight: days === d ? 600 : 400,
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* KPI strip */}
        {report && (
          <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
            {/* Total */}
            <KpiTile label={`Total (${days}d)`} value={String(report.total)} accent />

            {/* Top sources */}
            {topSources.map(([source, count]) => (
              <KpiTile key={source} label={source || 'Unknown'} value={String(count)} />
            ))}

            {/* Pad empty slots */}
            {topSources.length === 0 && (
              <KpiTile label="Sources" value="—" />
            )}
          </div>
        )}

        {/* Top campaigns strip */}
        {report?.topCampaigns && report.topCampaigns.length > 0 && (
          <div className="mb-6 rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[11px] uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Top Campaigns</p>
            <div className="flex flex-wrap gap-2">
              {report.topCampaigns.slice(0, 6).map(c => (
                <span
                  key={c.campaign_name}
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)' }}
                >
                  {c.campaign_name} <span className="opacity-60">({c.count})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 text-sm px-4 py-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {/* Leads table */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider border-b" style={{ color: 'var(--text-dim)', borderColor: 'var(--border)' }}>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Source</th>
                <th className="text-left px-4 py-2.5">Campaign</th>
                <th className="text-left px-4 py-2.5">Contact</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-dim)' }}>Loading…</td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-dim)' }}>
                    No leads in the last {days} days. Connect Facebook or Google lead-ads to start capturing leads.
                  </td>
                </tr>
              ) : leads.map(lead => (
                <tr key={lead.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-2.5 text-[12px]" style={{ color: 'var(--text-dim)' }}>{fmtDate(lead.created_at)}</td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text)' }}>{lead.name || '—'}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-dim)' }}>{lead.email || '—'}</td>
                  <td className="px-4 py-2.5">
                    {lead.source ? (
                      <span
                        className="text-[11px] px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)' }}
                      >
                        {lead.source}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-dim)' }}>{lead.campaign_name || '—'}</td>
                  <td className="px-4 py-2.5">
                    {lead.contact_public_id ? (
                      <a
                        href={`/contacts?id=${lead.contact_public_id}`}
                        className="text-xs font-medium"
                        style={{ color: 'var(--accent-text)' }}
                        onClick={e => e.stopPropagation()}
                      >
                        Open
                      </a>
                    ) : lead.contact_id ? (
                      <a
                        href={`/contacts?id=${lead.contact_id}`}
                        className="text-xs font-medium"
                        style={{ color: 'var(--accent-text)' }}
                        onClick={e => e.stopPropagation()}
                      >
                        Open
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {leads.length > 0 && (
          <p className="text-xs mt-2 text-right" style={{ color: 'var(--text-dim)' }}>
            Showing {leads.length} most recent leads
          </p>
        )}
      </div>
    </main>
  )
}

function KpiTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="rounded-lg px-4 py-3 border"
      style={{
        background: accent ? 'var(--accent-dim)' : 'var(--bg-subtle, rgba(255,255,255,0.02))',
        borderColor: accent ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <p className="text-[11px] uppercase tracking-wide mb-1 truncate" style={{ color: accent ? 'var(--accent-text)' : 'var(--text-dim)' }}>
        {label}
      </p>
      <p className="text-2xl font-semibold tabular-nums" style={{ color: accent ? 'var(--accent-text)' : 'var(--text)' }}>
        {value}
      </p>
    </div>
  )
}
