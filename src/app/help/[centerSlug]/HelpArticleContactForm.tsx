'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'

export function HelpArticleContactForm({
  centerSlug,
  articleSlug,
  articleTitle,
  supportEmail,
}: {
  centerSlug: string
  articleSlug: string
  articleTitle: string
  supportEmail?: string | null
}) {
  const [form, setForm] = useState({ name: '', email: '', message: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError('Name, email, and message are required.')
      return
    }
    setState('sending')
    setError(null)
    try {
      const res = await fetch(`/api/public/help/${centerSlug}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          subject: `Help request about ${articleTitle}`,
          message: form.message,
          article_slug: articleSlug,
        }),
      })
      const payload = await res.json() as { error: string | null }
      if (!res.ok || payload.error) throw new Error(payload.error || 'Could not send your request')
      setState('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request')
      setState('error')
    }
  }

  if (state === 'sent') {
    return (
      <div style={{ borderRadius: 18, border: '1px solid var(--border)', background: 'var(--bg-elevated)', padding: 18 }}>
        <div style={{ fontSize: 14, color: 'var(--text)' }}>Your request has been sent.</div>
        {supportEmail && <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-dim)' }}>If you need a follow-up, email {supportEmail}.</div>}
      </div>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <input
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="Your name"
          style={fieldStyle}
        />
        <input
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          placeholder="you@company.com"
          type="email"
          style={fieldStyle}
        />
      </div>
      <textarea
        value={form.message}
        onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
        placeholder="Tell us what you still need help with"
        rows={5}
        style={{ ...fieldStyle, resize: 'vertical' }}
      />
      {error && <div style={{ fontSize: 13, color: 'var(--status-overdue)' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          We route this request into the CRM so the team can follow up.
        </span>
        <button
          type="submit"
          disabled={state === 'sending'}
          style={{
            padding: '10px 16px',
            borderRadius: 12,
            border: '1px solid var(--accent)',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            fontSize: 13,
            fontWeight: 600,
            cursor: state === 'sending' ? 'default' : 'pointer',
            opacity: state === 'sending' ? 0.7 : 1,
          }}
        >
          {state === 'sending' ? 'Sending...' : 'Send request'}
        </button>
      </div>
    </form>
  )
}

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  borderRadius: 12,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg-field)',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}
