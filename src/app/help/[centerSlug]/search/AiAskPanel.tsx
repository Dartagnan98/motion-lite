'use client'

import { useState } from 'react'

export function AiAskPanel({ centerSlug, query }: { centerSlug: string; query: string }) {
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask() {
    setLoading(true)
    setError(null)
    setAnswer(null)
    try {
      const res = await fetch(`/api/public/help/${centerSlug}/ai-ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const payload = await res.json() as { data: { answer?: string } | null; error: string | null }
      if (!res.ok || payload.error) {
        setError(payload.error || 'AI could not answer right now')
      } else if (payload.data?.answer) {
        setAnswer(payload.data.answer)
      }
    } catch {
      setError('AI request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, background: 'var(--bg-elevated)', padding: 18, boxShadow: 'var(--glass-shadow)' }}>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 10 }}>
        AI answer
      </div>
      {!answer && (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-dim)', margin: '0 0 14px' }}>
            Not finding what you need? Ask AI to summarize the best answer from this help center for “{query}”.
          </p>
          <button
            onClick={ask}
            disabled={loading}
            style={{
              padding: '9px 14px',
              borderRadius: 12,
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Thinking...' : 'Ask AI'}
          </button>
        </>
      )}
      {error && <div style={{ marginTop: 12, color: 'var(--status-overdue)', fontSize: 13 }}>{error}</div>}
      {answer && (
        <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
          {answer}
        </div>
      )}
    </div>
  )
}
