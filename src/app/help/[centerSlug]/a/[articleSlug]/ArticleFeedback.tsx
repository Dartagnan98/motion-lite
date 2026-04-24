'use client'

import { useEffect, useRef, useState } from 'react'

function getHelpSessionId(): string {
  if (typeof window === 'undefined') return `server-${Date.now()}`
  const existing = window.sessionStorage.getItem('ctrl-help-session-id')
  if (existing) return existing
  const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `help-${Date.now()}`
  window.sessionStorage.setItem('ctrl-help-session-id', next)
  return next
}

export function ArticleFeedback({
  centerSlug,
  articleSlug,
  articleId,
}: {
  centerSlug: string
  articleSlug: string
  articleId: number
}) {
  const [state, setState] = useState<'idle' | 'submitting' | 'sent'>('idle')
  const [selection, setSelection] = useState<'yes' | 'no' | null>(null)
  const viewPingedRef = useRef(false)

  useEffect(() => {
    if (viewPingedRef.current) return
    viewPingedRef.current = true
    const storageKey = `ctrl_help_view_${articleId}`
    try {
      if (window.sessionStorage.getItem(storageKey)) return
      fetch(`/api/public/help/${centerSlug}/articles/${articleSlug}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: getHelpSessionId() }),
      }).catch(() => {})
      window.sessionStorage.setItem(storageKey, '1')
    } catch {}
  }, [centerSlug, articleSlug, articleId])

  async function submit(helpful: boolean) {
    setState('submitting')
    setSelection(helpful ? 'yes' : 'no')
    try {
      await fetch(`/api/public/help/${centerSlug}/articles/${articleSlug}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
      })
    } finally {
      setState('sent')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
      <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
        Was this helpful?
      </span>
      <button
        onClick={() => submit(true)}
        disabled={state === 'submitting' || state === 'sent'}
        style={{
          padding: '6px 12px',
          borderRadius: 999,
          border: '1px solid var(--border-strong)',
          background: selection === 'yes' ? 'var(--bg-active)' : 'var(--bg-elevated)',
          color: 'var(--text)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Yes
      </button>
      <button
        onClick={() => submit(false)}
        disabled={state === 'submitting' || state === 'sent'}
        style={{
          padding: '6px 12px',
          borderRadius: 999,
          border: '1px solid var(--border-strong)',
          background: selection === 'no' ? 'var(--bg-active)' : 'var(--bg-elevated)',
          color: 'var(--text)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        No
      </button>
      {state === 'sent' && (
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Thanks. Your feedback is in.</span>
      )}
    </div>
  )
}
