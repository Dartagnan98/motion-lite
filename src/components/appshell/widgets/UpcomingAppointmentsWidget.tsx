'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { crmFetch } from '@/lib/crm-browser'

interface AppointmentRow {
  id: number
  contact_id: number | null
  starts_at: number
  status: string
  calendar_name: string | null
  contact_name: string | null
}

const mono = { fontFamily: 'var(--font-mono)' } as const

function formatStart(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isToday) return `Today ${t}`
  if (isTomorrow) return `Tomorrow ${t}`
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${t}`
}

export function UpcomingAppointmentsWidget() {
  const [rows, setRows] = useState<AppointmentRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await crmFetch<AppointmentRow[]>('/api/crm/appointments?range=upcoming')
      setRows(data.slice(0, 5))
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
          Upcoming
        </span>
        <Link
          href="/crm/appointments"
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
          No upcoming appointments
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 6px' }}>
          {rows.map(row => (
            <li key={row.id}>
              <Link
                href={row.contact_id ? `/crm/contacts/${row.contact_id}` : '/crm/appointments'}
                style={{ display: 'block', padding: '6px 12px', textDecoration: 'none', color: 'inherit' }}
                className="hover:bg-hover"
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.contact_name || 'Unknown contact'}
                </div>
                <div style={{ ...mono, fontSize: 10, color: 'var(--text-dim)', marginTop: 1, letterSpacing: '0.02em' }}>
                  {formatStart(row.starts_at)}
                  {row.calendar_name && <span style={{ color: 'var(--text-muted)' }}> · {row.calendar_name}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
