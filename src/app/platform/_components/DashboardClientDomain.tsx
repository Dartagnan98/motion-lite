'use client'

// Inline editable domain in the PM Dashboard header — the domain drives
// Auto-connect, so it must be addable right where you'd use it. Shows the site
// (linked) when set with an edit pencil; shows "+ Add domain" when empty.
// Persists via PATCH /api/clients.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DashboardClientDomain({
  clientId,
  website,
}: {
  clientId: number
  website: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(website ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, website: value.trim() }),
      })
      setEditing(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          placeholder="https://example.com"
          className="text-xs border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={save} disabled={saving} className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50">
          {saving ? '…' : 'Save'}
        </button>
        <button onClick={() => { setValue(website ?? ''); setEditing(false) }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
      </span>
    )
  }

  if (!website) {
    return (
      <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        Add domain
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 group/dom">
      <a
        href={website.startsWith('http') ? website : `https://${website}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:text-blue-700 truncate"
      >
        {website.replace(/^https?:\/\//, '')}
      </a>
      <button onClick={() => setEditing(true)} className="text-gray-300 hover:text-gray-600" aria-label="Edit domain" title="Edit domain">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
      </button>
    </span>
  )
}
