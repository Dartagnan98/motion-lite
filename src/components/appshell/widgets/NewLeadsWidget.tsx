'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { crmFetch } from '@/lib/crm-browser'

interface NewLead {
  submission_id: number
  contact_id: number | null
  name: string | null
  email: string | null
  source: 'facebook' | 'google'
  form_name: string | null
  created_at: string
}

const mono = { fontFamily: 'var(--font-mono)' } as const

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

export function NewLeadsWidget() {
  const [rows, setRows] = useState<NewLead[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await crmFetch<NewLead[]>('/api/crm/leads/new?limit=5')
      setRows(data)
    } catch { /* resilient */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 60_000)
    return () => window.clearInterval(id)
  }, [refresh])

  return (
    <section style={{ borderBottom: '1px solid var(--border)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 6px' }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          New leads
        </span>
        <Link
          href="/crm/reports/lead-ads"
          style={{ ...mono, fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}
        >
          All →
        </Link>
      </header>
      {loading ? (
        <div style={{ padding: '12px', fontSize: 11, color: 'var(--text-muted)', ...mono, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)' }}>
          No recent leads
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 6px' }}>
          {rows.map(row => (
            <li key={row.submission_id}>
              <Link
                href={row.contact_id ? `/crm/contacts/${row.contact_id}` : '/crm'}
                style={{ display: 'block', padding: '6px 12px', textDecoration: 'none', color: 'inherit' }}
                className="hover:bg-hover"
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.name || row.email || 'Unknown'}
                  </span>
                  <span style={{ ...mono, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {row.source === 'facebook' ? 'FB' : 'GGL'}
                  </span>
                  <span style={{ ...mono, fontSize: 9, color: 'var(--text-muted)' }}>
                    {formatAge(row.created_at)}
                  </span>
                </div>
                {row.form_name && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.form_name}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
