'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function PublicSearchBar({
  centerSlug,
  initialValue,
  hero = false,
}: {
  centerSlug: string
  initialValue?: string
  hero?: boolean
}) {
  const router = useRouter()
  const [q, setQ] = useState(initialValue || '')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = q.trim()
    if (!trimmed) return
    router.push(`/help/${centerSlug}/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'stretch' }}>
      <input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search the help center"
        autoFocus={!initialValue}
        style={{
          flex: 1,
          minWidth: 0,
          padding: hero ? '18px 20px' : '14px 16px',
          fontSize: hero ? 17 : 14,
          borderRadius: hero ? 20 : 14,
          border: '1px solid var(--border-strong)',
          background: 'var(--bg-elevated)',
          color: 'var(--text)',
          outline: 'none',
          boxShadow: hero ? 'var(--glass-shadow-lg)' : 'var(--glass-shadow)',
          transition: 'border-color 120ms ease, background 120ms ease',
        }}
      />
      <button
        type="submit"
        style={{
          padding: hero ? '0 22px' : '0 18px',
          borderRadius: hero ? 18 : 12,
          border: '1px solid var(--accent)',
          background: 'var(--accent)',
          color: 'var(--accent-fg)',
          fontSize: hero ? 14 : 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 120ms ease, border-color 120ms ease',
          whiteSpace: 'nowrap',
        }}
      >
        Search
      </button>
    </form>
  )
}
