'use client'

import { useState } from 'react'
import type { CrmHelpCenter } from '@/lib/db'

export function PasswordGate({ center }: { center: CrmHelpCenter }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!password.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/help/${center.public_slug}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const payload = await res.json() as { data: { ok?: boolean } | null; error: string | null }
      if (!res.ok || payload.error) {
        setError(payload.error || 'Incorrect password')
      } else {
        window.location.reload()
      }
    } catch {
      setError('Could not verify password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-theme="light"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          width: 'min(440px, 100%)',
          borderRadius: 20,
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          boxShadow: 'var(--glass-shadow-lg)',
          padding: 28,
        }}
      >
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 10 }}>
          Restricted access
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.03em', margin: '0 0 10px', color: 'var(--text)' }}>{center.name}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', margin: '0 0 20px' }}>
          {center.public_visibility === 'members_only'
            ? 'This help center is reserved for signed-in members.'
            : 'This help center is password protected. Enter the shared password to continue.'}
        </p>
        {center.public_visibility === 'password' && (
          <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              style={{
                width: '100%',
                padding: '13px 14px',
                borderRadius: 12,
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-field)',
                color: 'var(--text)',
                outline: 'none',
              }}
            />
            {error && <div style={{ color: 'var(--status-overdue)', fontSize: 13 }}>{error}</div>}
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px solid var(--accent)',
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? 'default' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Checking...' : 'Unlock'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
