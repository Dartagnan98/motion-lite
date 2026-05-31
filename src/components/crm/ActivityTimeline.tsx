'use client'

// Shared activity timeline component.
// Handles both contact activities (crm_activities) and opportunity activities
// (crm_opportunity_activity). Fetches from /api/crm/activities, renders a
// unified list, and exposes an add-note form at the top.

import React, { useState, useEffect, useCallback } from 'react'

interface ContactActivity {
  id: number
  type: string
  body: string
  created_by_name: string | null
  created_at: number
}

interface OppActivity {
  id: number
  kind: string
  body: string | null
  meta: Record<string, unknown> | null
  created_by_name: string | null
  created_at: number
}

type UnifiedActivity = {
  id: number
  label: string
  body: string
  meta?: Record<string, unknown> | null
  author: string | null
  created_at: number
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function renderMeta(meta: Record<string, unknown> | null | undefined): React.ReactNode {
  if (!meta || typeof meta !== 'object') return null
  const from = meta.from != null ? String(meta.from) : ''
  const to = meta.to != null ? String(meta.to) : ''
  if (!from && !to) return null
  return (
    <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-dim)' }}>
      {from}{from && to ? ' → ' : ''}{to}
    </p>
  )
}

const KIND_ICONS: Record<string, string> = {
  note: '📝',
  stage_change: '→',
  status_change: '✓',
  created: '✦',
  call: '📞',
  email: '✉',
  meeting: '📅',
  task: '☐',
}

function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function ActivityTimeline({
  contactId,
  opportunityId,
}: {
  contactId?: number
  opportunityId?: number
}) {
  const [activities, setActivities] = useState<UnifiedActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [noteBody, setNoteBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = '/api/crm/activities'
      if (contactId) url += `?contact_id=${contactId}`
      else if (opportunityId) url += `?opportunity_id=${opportunityId}`
      else { setActivities([]); setLoading(false); return }

      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load activities')
      const d = await res.json() as { activities?: (ContactActivity | OppActivity)[] }
      const raw = d.activities ?? []

      // Normalize both shapes into UnifiedActivity
      const unified: UnifiedActivity[] = raw.map((a) => {
        if (opportunityId) {
          const oa = a as OppActivity
          return {
            id: oa.id,
            label: kindLabel(oa.kind),
            body: oa.body ?? '',
            meta: oa.meta,
            author: oa.created_by_name,
            created_at: oa.created_at,
          }
        } else {
          const ca = a as ContactActivity
          return {
            id: ca.id,
            label: kindLabel(ca.type),
            body: ca.body,
            meta: null,
            author: ca.created_by_name,
            created_at: ca.created_at,
          }
        }
      })
      setActivities(unified)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [contactId, opportunityId])

  useEffect(() => { load() }, [load])

  async function addNote() {
    if (!noteBody.trim()) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { type: 'note', body: noteBody.trim() }
      if (contactId) body.contact_id = contactId
      if (opportunityId) body.opportunity_id = opportunityId

      const res = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to save note')
      setNoteBody('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Add note form */}
      <div className="mb-4">
        <label className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>
          Add note
        </label>
        <textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          rows={2}
          placeholder="Log a call, note, or update..."
          className="glass-input w-full text-sm px-3 py-2 rounded-md resize-y"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
        />
        <button
          onClick={addNote}
          disabled={saving || !noteBody.trim()}
          className="mt-1.5 text-xs font-medium text-white px-3 py-1.5 rounded-md disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          {saving ? 'Saving…' : 'Add note'}
        </button>
      </div>

      {/* Timeline list */}
      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--status-overdue)' }}>{error}</p>
      )}
      {loading ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-dim)' }}>Loading…</p>
      ) : activities.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-dim)' }}>No activity yet.</p>
      ) : (
        <ul className="space-y-3">
          {activities.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              {/* Icon dot */}
              <div className="flex flex-col items-center pt-0.5">
                <span
                  className="flex items-center justify-center w-6 h-6 rounded-full text-xs shrink-0"
                  style={{ background: 'var(--bg-elevated, var(--bg))', border: '1px solid var(--border)' }}
                >
                  {KIND_ICONS[a.label.toLowerCase().replace(/ /g, '_')] ?? '·'}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium" style={{ color: 'var(--text)' }}>{a.label}</span>
                  {a.author && (
                    <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>by {a.author}</span>
                  )}
                  <span className="text-[11px] ml-auto" style={{ color: 'var(--text-dim)' }}>{timeAgo(a.created_at)}</span>
                </div>

                {a.body && (
                  <p className="mt-0.5 text-[13px] whitespace-pre-wrap" style={{ color: 'var(--text-dim)' }}>{a.body}</p>
                )}

                {/* Stage/status change meta */}
                {renderMeta(a.meta)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
