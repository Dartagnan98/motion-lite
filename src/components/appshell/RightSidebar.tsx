'use client'

import { useEffect, useState } from 'react'
import { UpcomingAppointmentsWidget } from './widgets/UpcomingAppointmentsWidget'
import { UnreadConversationsWidget } from './widgets/UnreadConversationsWidget'
import { NewLeadsWidget } from './widgets/NewLeadsWidget'

const STORAGE_KEY = 'ctrl-right-sidebar-visible'

export function RightSidebar() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === '0') setVisible(false)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, visible ? '1' : '0')
  }, [visible])

  if (!visible) {
    return (
      <aside
        style={{
          width: 24,
          flexShrink: 0,
          borderLeft: '1px solid var(--border)',
          background: 'var(--bg-chrome)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 10,
        }}
        className="hidden lg:flex"
      >
        <button
          onClick={() => setVisible(true)}
          title="Show sidebar"
          style={{
            width: 20, height: 20, border: 'none', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>
    )
  }

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-chrome)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
      className="hidden lg:flex"
    >
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 1,
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          Activity
        </span>
        <button
          onClick={() => setVisible(false)}
          title="Hide sidebar"
          style={{
            width: 20, height: 20, border: 'none', background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <UpcomingAppointmentsWidget />
      <UnreadConversationsWidget />
      <NewLeadsWidget />
    </aside>
  )
}
