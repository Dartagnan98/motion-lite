'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { crmFetch } from '@/lib/crm-browser'

interface SearchHit {
  kind: 'contact' | 'company' | 'opportunity' | 'booking_page' | 'task' | 'doc' | 'project' | 'folder'
  id: number
  title: string
  subtitle: string
  href: string
}

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  project:      'Projects',
  task:         'Tasks',
  doc:          'Docs',
  folder:       'Folders',
  contact:      'Contacts',
  company:      'Companies',
  opportunity:  'Opportunities',
  booking_page: 'Booking pages',
}

const KIND_ORDER: ReadonlyArray<SearchHit['kind']> = [
  'project', 'task', 'doc', 'folder',
  'contact', 'company', 'opportunity', 'booking_page',
]

export function SearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestSeq = useRef(0)
  const router = useRouter()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
          setLoading(false)
        })
        .catch(() => { if (seq === requestSeq.current) { setHits([]); setLoading(false) } })
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  function navigate(path: string) {
    router.push(path)
    onClose()
  }

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

  const hasResults = hits.length > 0

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[520px] max-h-[70vh] rounded-md border border-border-strong animate-glass-in flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-modal)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0 text-text-dim">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts, tasks, docs, projects..."
            className="flex-1 bg-transparent text-[14px] text-text outline-none"
            onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          />
          {loading && <span className="text-[11px] text-text-dim">Searching...</span>}
        </div>

        {/* Results */}
        <div className="overflow-y-auto">
          {query.trim().length < 2 && (
            <div className="px-4 py-6 text-center text-[12px] text-text-dim">
              Type 2+ characters to search across your workspace
            </div>
          )}

          {query.trim().length >= 2 && !hasResults && !loading && (
            <div className="px-4 py-8 text-center text-[13px] text-text-dim">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {groups.map((group) => (
            <ResultSection key={group.kind} title={KIND_LABEL[group.kind]}>
              {group.hits.map((hit) => (
                <ResultItem
                  key={`${hit.kind}-${hit.id}`}
                  kind={hit.kind}
                  title={hit.title}
                  subtitle={hit.subtitle}
                  onClick={() => navigate(hit.href)}
                />
              ))}
            </ResultSection>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border">
          <span className="text-[11px] flex items-center gap-1.5 text-text-dim">
            <kbd className="px-1.5 py-0.5 rounded-md text-[10px] border border-border text-text-dim" style={{ background: 'var(--bg-elevated)' }}>esc</kbd>
            close
          </span>
          <span className="text-[11px] flex items-center gap-1.5 text-text-dim">
            <kbd className="px-1.5 py-0.5 rounded-md text-[10px] border border-border text-text-dim" style={{ background: 'var(--bg-elevated)' }}>↵</kbd>
            select
          </span>
        </div>
      </div>
    </div>
  )
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <div
        className="px-4 py-1 text-[10px] font-medium uppercase tracking-wider text-text-dim"
        style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function KindGlyph({ kind }: { kind: SearchHit['kind'] }) {
  switch (kind) {
    case 'project':
      return <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
    case 'task':
      return <span className="h-2.5 w-2.5 rounded-sm border border-text-dim" />
    case 'doc':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim">
          <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )
    case 'folder':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim">
          <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )
    case 'contact':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim">
          <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M3 13c.5-2.2 2.6-3.5 5-3.5s4.5 1.3 5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
    case 'company':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim">
          <path d="M3 13V5l5-2v10M13 13V7l-5-2M5 7h1M5 9h1M5 11h1M10 9h1M10 11h1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )
    case 'opportunity':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim">
          <path d="M3 12l4-4 3 3 3-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 6h3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'booking_page':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim">
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
  }
}

function ResultItem({
  kind,
  title,
  subtitle,
  onClick,
}: {
  kind: SearchHit['kind']
  title: string
  subtitle?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors"
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <span className="shrink-0 w-4 flex items-center justify-center">
        <KindGlyph kind={kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] truncate text-text">{title}</div>
        {subtitle && <div className="text-[11px] truncate mt-px text-text-dim">{subtitle}</div>}
      </div>
    </button>
  )
}
