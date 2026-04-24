'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface UserNotification {
  id: number
  user_id: number
  workspace_id: number
  kind: UserNotificationKind
  title: string
  body: string | null
  href: string | null
  entity: string | null
  entity_id: number | null
  is_read: number
  read_at: string | null
  created_at: string
}

type UserNotificationKind =
  | 'new_lead'
  | 'inbound_reply'
  | 'mention'
  | 'assignment'
  | 'appointment_booked'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'ai_handoff'
  | 'task_assigned'
  | 'opportunity_won'
  | 'opportunity_lost'
  | 'opportunity_abandoned'

// Compact mono chip labels — all-caps, short, scannable at a glance.
const KIND_CHIP: Record<UserNotificationKind, string> = {
  new_lead:                'LEAD',
  inbound_reply:           'REPLY',
  mention:                 '@MENTION',
  assignment:              'ASSIGN',
  appointment_booked:      'APPT',
  appointment_cancelled:   'APPT·X',
  appointment_rescheduled: 'APPT·R',
  ai_handoff:              'AI',
  task_assigned:           'TASK',
  opportunity_won:         'WON',
  opportunity_lost:        'LOST',
  opportunity_abandoned:   'ABANDON',
}

const mono = { fontFamily: 'var(--font-mono)' } as const

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  return `${w}w ago`
}

export function NotificationsBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<UserNotification[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const bellRef = useRef<HTMLButtonElement | null>(null)

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { count?: number }
      if (typeof data.count === 'number') setUnread(data.count)
    } catch { /* resilient */ }
  }, [])

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?scope=user&limit=50', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { notifications?: UserNotification[]; unreadCount?: number }
      if (Array.isArray(data.notifications)) setItems(data.notifications)
      if (typeof data.unreadCount === 'number') setUnread(data.unreadCount)
    } catch { /* resilient */ } finally {
      setLoading(false)
    }
  }, [])

  // Poll unread count every 30s when the tab is visible.
  useEffect(() => {
    fetchUnreadCount()
    const tick = () => {
      if (document.visibilityState === 'visible') fetchUnreadCount()
    }
    const interval = window.setInterval(tick, 30_000)
    const visHandler = () => {
      if (document.visibilityState === 'visible') fetchUnreadCount()
    }
    document.addEventListener('visibilitychange', visHandler)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visHandler)
    }
  }, [fetchUnreadCount])

  // Fetch items when the dropdown opens.
  useEffect(() => {
    if (open) fetchItems()
  }, [open, fetchItems])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || bellRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const markOne = useCallback(async (id: number) => {
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, is_read: 1 } : n))
    setUnread((prev) => Math.max(0, prev - 1))
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })
    } catch { /* resilient */ }
  }, [])

  const markAll = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })))
    setUnread(0)
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    } catch { /* resilient */ }
  }, [])

  const handleItemClick = useCallback((n: UserNotification) => {
    if (!n.is_read) markOne(n.id)
    setOpen(false)
    if (n.href) router.push(n.href)
  }, [markOne, router])

  const badgeLabel = useMemo(() => {
    if (unread <= 0) return null
    return unread > 99 ? '99+' : String(unread)
  }, [unread])

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={bellRef}
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 6,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          transition: 'color 120ms, background 120ms',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {badgeLabel && (
          <span
            style={{
              ...mono,
              position: 'absolute',
              top: -4,
              right: -4,
              transform: 'translate(0, 0)',
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              fontSize: 10,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              letterSpacing: 0,
              lineHeight: 1,
              pointerEvents: 'none',
            }}
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 380,
            maxHeight: 480,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.32)',
            zIndex: 80,
            overflow: 'hidden',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              Notifications
            </span>
            <button
              type="button"
              onClick={markAll}
              disabled={unread === 0}
              style={{
                ...mono,
                background: 'transparent',
                border: 'none',
                color: unread > 0 ? 'var(--text-dim)' : 'var(--text-muted)',
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                cursor: unread > 0 ? 'pointer' : 'default',
                padding: '4px 6px',
                borderRadius: 4,
                transition: 'color 120ms, background 120ms',
              }}
              onMouseEnter={(e) => { if (unread > 0) { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--bg-hover)' } }}
              onMouseLeave={(e) => { e.currentTarget.style.color = unread > 0 ? 'var(--text-dim)' : 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
            >
              Mark all read
            </button>
          </header>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && items.length === 0 ? (
              <div style={{ ...mono, padding: '40px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div style={{ ...mono, padding: '60px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                No notifications yet
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '10px 14px',
                        background: n.is_read
                          ? 'transparent'
                          : 'color-mix(in oklab, var(--accent) 5%, var(--bg-panel))',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 120ms',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = n.is_read ? 'transparent' : 'color-mix(in oklab, var(--accent) 5%, var(--bg-panel))' }}
                    >
                      <span
                        style={{
                          ...mono,
                          flexShrink: 0,
                          marginTop: 2,
                          padding: '2px 6px',
                          borderRadius: 3,
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-dim)',
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          lineHeight: 1.4,
                        }}
                      >
                        {KIND_CHIP[n.kind] || n.kind.toUpperCase()}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1.35 }}>
                          {n.title}
                        </span>
                        {n.body && (
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {n.body}
                          </span>
                        )}
                      </span>
                      <span style={{ ...mono, flexShrink: 0, fontSize: 10, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'nowrap' }}>
                        {formatRelative(n.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer
            style={{
              padding: '8px 14px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              textAlign: 'right',
            }}
          >
            <Link
              href="/settings/notifications"
              onClick={() => setOpen(false)}
              style={{
                ...mono,
                fontSize: 11,
                color: 'var(--text-dim)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                textDecoration: 'none',
                transition: 'color 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              Preferences →
            </Link>
          </footer>
        </div>
      )}
    </div>
  )
}
