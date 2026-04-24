'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { crmFetch } from '@/lib/crm-browser'

interface Thread {
  contact_id: number
  contact_name: string
  latest_at: number
  unread_count: number
  latest_body: string | null
  channels: string
}

const mono = { fontFamily: 'var(--font-mono)' } as const

function formatRelative(ts: number): string {
  const ms = Date.now() - ts * 1000
  if (!Number.isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

export function UnreadConversationsWidget() {
  const [rows, setRows] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await crmFetch<Thread[]>('/api/crm/conversations')
      setRows(data.filter(t => t.unread_count > 0).slice(0, 5))
    } catch { /* resilient */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  return (
    <section style={{ borderBottom: '1px solid var(--border)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 6px' }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          Unread
        </span>
        <Link
          href="/crm/inbox"
          style={{ ...mono, fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}
        >
          Inbox →
        </Link>
      </header>
      {loading ? (
        <div style={{ padding: '12px', fontSize: 11, color: 'var(--text-muted)', ...mono, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)' }}>
          All caught up
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 6px' }}>
          {rows.map(row => (
            <li key={row.contact_id}>
              <Link
                href={`/crm/inbox?contact=${row.contact_id}`}
                style={{ display: 'block', padding: '6px 12px', textDecoration: 'none', color: 'inherit' }}
                className="hover:bg-hover"
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.contact_name}
                  </span>
                  <span style={{ ...mono, fontSize: 9, padding: '1px 5px', borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 600 }}>
                    {row.unread_count}
                  </span>
                  <span style={{ ...mono, fontSize: 9, color: 'var(--text-muted)' }}>
                    {formatRelative(row.latest_at)}
                  </span>
                </div>
                {row.latest_body && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.latest_body}
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
