'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CrmConversationThread } from '@/lib/db'
import { crmFetch } from '@/lib/crm-browser'
import { ThreadListItem } from '@/components/crm/inbox/ThreadListItem'

const mono = { fontFamily: 'var(--font-mono)' } as const

export function InboxBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [threads, setThreads] = useState<CrmConversationThread[]>([])
  const [loading, setLoading] = useState(false)
  const [unread, setUnread] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const computeUnread = useCallback((list: CrmConversationThread[]) => {
    return list.reduce((acc, t) => acc + (t.unread_count > 0 ? 1 : 0), 0)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await crmFetch<CrmConversationThread[]>('/api/crm/conversations')
      setThreads(data)
      setUnread(computeUnread(data))
    } catch { /* resilient */ } finally {
      setLoading(false)
    }
  }, [computeUnread])

  useEffect(() => {
    refresh()
    const tick = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const interval = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const badgeLabel = useMemo(() => {
    if (unread <= 0) return null
    return unread > 99 ? '99+' : String(unread)
  }, [unread])

  const unreadThreads = useMemo(() => threads.filter(t => t.unread_count > 0), [threads])
  const shown = unreadThreads.length > 0 ? unreadThreads : threads.slice(0, 20)

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        aria-label={unread > 0 ? `Inbox (${unread} unread)` : 'Inbox'}
        onClick={() => setOpen(v => !v)}
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
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
        {badgeLabel && (
          <span style={{
            ...mono,
            position: 'absolute',
            top: -4,
            right: -4,
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
            lineHeight: 1,
            pointerEvents: 'none',
          }}>
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
            width: 420,
            maxHeight: 520,
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
          <header style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              {unreadThreads.length > 0 ? `Unread (${unreadThreads.length})` : 'Inbox'}
            </span>
            <Link
              href="/crm/inbox"
              onClick={() => setOpen(false)}
              style={{ ...mono, fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}
            >
              Full inbox →
            </Link>
          </header>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && threads.length === 0 ? (
              <div style={{ ...mono, padding: '40px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Loading…
              </div>
            ) : shown.length === 0 ? (
              <div style={{ ...mono, padding: '60px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                No conversations yet
              </div>
            ) : (
              <div>
                {shown.map(thread => (
                  <ThreadListItem
                    key={thread.contact_id}
                    thread={thread}
                    selected={false}
                    onClick={() => {
                      setOpen(false)
                      router.push(`/crm/inbox?contact=${thread.contact_id}`)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
