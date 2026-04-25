'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { crmFetch } from '@/lib/crm-browser'

const mono = { fontFamily: 'var(--font-mono)' } as const

interface SearchHit {
  kind: 'contact' | 'company' | 'opportunity' | 'booking_page' | 'task' | 'doc' | 'project' | 'folder'
  id: number
  title: string
  subtitle: string
  href: string
}

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  contact:       'Contacts',
  company:       'Companies',
  opportunity:   'Opportunities',
  booking_page:  'Booking pages',
  task:          'Tasks',
  doc:           'Docs',
  project:       'Projects',
  folder:        'Folders',
}

const KIND_GLYPH: Record<SearchHit['kind'], string> = {
  contact:       'CO',
  company:       'CM',
  opportunity:   'OP',
  booking_page:  'BK',
  task:          'TK',
  doc:           'DC',
  project:       'PR',
  folder:        'FD',
}

const KIND_ORDER: ReadonlyArray<SearchHit['kind']> = [
  'contact', 'company', 'opportunity', 'booking_page',
  'task', 'project', 'doc', 'folder',
]

/**
 * Cmd+K / Ctrl+K command palette for the CRM. Searches contacts, companies,
 * opportunities, and booking pages in one call. Arrow keys navigate, Enter
 * opens, Escape closes.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestSeq = useRef(0)

  // Keyboard shortcut — Cmd+K / Ctrl+K anywhere on a CRM page
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isModK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
      if (isModK) {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }
      if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) { setQuery(''); setHits([]); setSelectedIdx(0); return }
    queueMicrotask(() => inputRef.current?.focus())
  }, [open])

  // Debounced search — bump a monotonic sequence so stale responses don't
  // overwrite fresher ones when the user keeps typing.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setHits([]); setLoading(false); return }
    const seq = ++requestSeq.current
    setLoading(true)
    const timer = setTimeout(() => {
      crmFetch<{ hits: SearchHit[] }>(`/api/search/unified?q=${encodeURIComponent(q)}`)
        .then((data) => {
          if (seq !== requestSeq.current) return
          setHits(data.hits)
          setSelectedIdx(0)
          setLoading(false)
        })
        .catch(() => { if (seq === requestSeq.current) { setHits([]); setLoading(false) } })
    }, 120)
    return () => clearTimeout(timer)
  }, [query])

  const groups = useMemo(() => {
    const buckets: Record<SearchHit['kind'], SearchHit[]> = {
      contact: [], company: [], opportunity: [], booking_page: [],
      task: [], doc: [], project: [], folder: [],
    }
    for (const hit of hits) buckets[hit.kind].push(hit)
    return KIND_ORDER
      .filter((k) => buckets[k].length > 0)
      .map((k) => ({ kind: k, hits: buckets[k] }))
  }, [hits])

  const flatHits = useMemo(() => groups.flatMap((g) => g.hits), [groups])

  const go = useCallback((hit: SearchHit) => {
    router.push(hit.href)
    setOpen(false)
  }, [router])

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(flatHits.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(0, i - 1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const pick = flatHits[selectedIdx]
      if (pick) go(pick)
      return
    }
  }

  if (!open) return null

  let renderIdx = 0

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'color-mix(in oklab, black 48%, transparent)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '14vh 24px 24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 580, maxHeight: '64vh',
          borderRadius: 14,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.48)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, ...mono, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search contacts, companies, deals, tasks, docs…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text)',
              fontSize: 15,
              fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {query.trim().length < 2 ? (
            <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              Type 2+ characters to search.
            </div>
          ) : loading && hits.length === 0 ? (
            <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              Searching…
            </div>
          ) : hits.length === 0 ? (
            <div style={{ padding: '22px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              No matches.
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.kind} style={{ marginBottom: 6 }}>
                <div style={{
                  padding: '8px 10px 4px', fontSize: 10,
                  ...mono, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}>
                  {KIND_LABEL[group.kind]}
                </div>
                {group.hits.map((hit) => {
                  const idx = renderIdx++
                  const active = idx === selectedIdx
                  return (
                    <button
                      key={`${hit.kind}-${hit.id}`}
                      onClick={() => go(hit)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: active ? 'var(--bg-elevated)' : 'transparent',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                      }}
                    >
                      <span style={{
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 24, height: 20,
                        borderRadius: 4,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-muted)',
                        fontSize: 9,
                        ...mono,
                        letterSpacing: '0.04em',
                      }}>
                        {KIND_GLYPH[hit.kind]}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {hit.subtitle}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, ...mono, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {active ? '↵' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10, ...mono, color: 'var(--text-muted)', letterSpacing: '0.06em',
        }}>
          <span>↑↓ navigate · ↵ open</span>
          <span>ESC close</span>
        </div>
      </div>
    </div>
  )
}
