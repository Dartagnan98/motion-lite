'use client'

import { useState, useEffect, useCallback } from 'react'

interface MemoryRow {
  id: number
  content: string
  sector: string
  source: string
  source_contact: string | null
  source_channel: string | null
  salience: number
  created_at: number
  accessed_at: number
  client_slug: string | null
}

interface SourceStat { source: string; channel: string | null; count: number }
interface SectorStats { semantic: number; episodic: number; total: number }

const SOURCE_ICONS: Record<string, string> = {
  imessage: 'iMsg',
  whatsapp: 'WA',
  conversation: 'Chat',
  telegram: 'TG',
}

export default function MemoryPage() {
  const [rows, setRows] = useState<MemoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [sourceStats, setSourceStats] = useState<SourceStat[]>([])
  const [sectorStats, setSectorStats] = useState<SectorStats>({ semantic: 0, episodic: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sector, setSector] = useState('')
  const [source, setSource] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (sector) params.set('sector', sector)
    if (source) params.set('source', source)
    params.set('page', page.toString())
    try {
      const res = await fetch(`/api/memories?${params}`)
      const data = await res.json()
      setRows(data.rows || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
      setSourceStats(data.sourceStats || [])
      setSectorStats(data.sectorStats || { semantic: 0, episodic: 0, total: 0 })
    } catch {
      setRows([])
    }
    setLoading(false)
  }, [query, sector, source, page])

  useEffect(() => { load() }, [load])

  const doSearch = () => {
    setPage(1)
    setQuery(searchInput)
  }

  const handleDelete = async (id: number) => {
    await fetch('/api/memories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    load()
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  // Aggregate source stats by source name
  const aggregatedSources = sourceStats.reduce<Record<string, number>>((acc, s) => {
    acc[s.source] = (acc[s.source] || 0) + s.count
    return acc
  }, {})

  return (
    <div className="h-full overflow-y-auto pb-4 sm:pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 glass px-5 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-[22px] font-bold text-text">Memory</h1>
            <p className="text-[13px] text-text-dim">{sectorStats.total.toLocaleString()} memories indexed</p>
          </div>
          <div className="flex gap-2 text-[11px]">
            <span className="glass-card !rounded-lg px-2.5 py-1.5 text-center">
              <span className="font-bold text-purple-400">{sectorStats.semantic.toLocaleString()}</span>
              <span className="text-text-dim ml-1">semantic</span>
            </span>
            <span className="glass-card !rounded-lg px-2.5 py-1.5 text-center">
              <span className="font-bold text-accent-text">{sectorStats.episodic.toLocaleString()}</span>
              <span className="text-text-dim ml-1">episodic</span>
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Search memories..."
            className="flex-1 glass-input px-3 py-2 rounded-md text-[13px] text-text"
          />
          <button onClick={doSearch} className="glass-btn px-4 py-2 rounded-md text-[12px] font-medium text-text">
            Search
          </button>
          {query && (
            <button onClick={() => { setSearchInput(''); setQuery(''); setPage(1) }} className="glass-btn px-3 py-2 rounded-md text-[12px] text-text-dim">
              Clear
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-1.5">
          {/* Sector filter */}
          <button
            onClick={() => { setSector(''); setPage(1) }}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${!sector ? 'bg-accent text-white' : 'glass-btn text-text-dim'}`}
          >
            All Types
          </button>
          <button
            onClick={() => { setSector('semantic'); setPage(1) }}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${sector === 'semantic' ? 'bg-purple-500/30 text-purple-300' : 'glass-btn text-text-dim'}`}
          >
            Semantic
          </button>
          <button
            onClick={() => { setSector('episodic'); setPage(1) }}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${sector === 'episodic' ? 'bg-accent/30 text-accent-text' : 'glass-btn text-text-dim'}`}
          >
            Episodic
          </button>

          <span className="w-px h-5 bg-border mx-1 self-center" />

          {/* Source filters */}
          <button
            onClick={() => { setSource(''); setPage(1) }}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${!source ? 'bg-accent/10 text-accent-text' : 'glass-btn text-text-dim'}`}
          >
            All Sources
          </button>
          {Object.entries(aggregatedSources).map(([src, count]) => (
            <button
              key={src}
              onClick={() => { setSource(source === src ? '' : src); setPage(1) }}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${source === src ? 'bg-accent/10 text-accent-text' : 'glass-btn text-text-dim'}`}
            >
              {SOURCE_ICONS[src] || src} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Results info */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between">
        <span className="text-[11px] text-text-dim">
          {query && <>Results for &quot;{query}&quot; &mdash; </>}
          {total.toLocaleString()} {total === 1 ? 'memory' : 'memories'}
        </span>
        {pages > 1 && (
          <span className="text-[11px] text-text-dim">
            Page {page} of {pages}
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Memory rows */}
      {!loading && rows.length === 0 && (
        <div className="text-center py-12">
          <p className="text-[14px] text-text-dim">No memories found</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="px-4 pt-1 space-y-1.5">
          {rows.map(row => {
            const isExpanded = expandedId === row.id
            const preview = row.content.length > 200 && !isExpanded
              ? row.content.slice(0, 200) + '...'
              : row.content
            return (
              <div
                key={row.id}
                className="glass-card !rounded-md p-3.5 hover:border-border-strong transition-all cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : row.id)}
              >
                <div className="flex items-start gap-2 mb-1.5">
                  {/* Sector badge */}
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    row.sector === 'semantic' ? 'bg-purple-500/20 text-purple-400' : 'bg-accent/20 text-accent-text'
                  }`}>
                    {row.sector}
                  </span>
                  {/* Source badge */}
                  <span className="text-[9px] font-medium text-text-dim glass-pill px-1.5 py-0.5">
                    {SOURCE_ICONS[row.source] || row.source}
                  </span>
                  {/* Contact */}
                  {row.source_contact && (
                    <span className="text-[10px] text-text-dim">{row.source_contact}</span>
                  )}
                  {/* Client */}
                  {row.client_slug && (
                    <span className="text-[9px] text-accent-text glass-pill px-1.5 py-0.5">{row.client_slug}</span>
                  )}
                  <span className="flex-1" />
                  {/* Salience */}
                  <span className="text-[10px] font-mono font-bold text-yellow-500/80">{row.salience.toFixed(1)}</span>
                </div>

                {/* Content */}
                <p className="text-[12px] text-text leading-relaxed whitespace-pre-wrap break-words">{preview}</p>

                {/* Footer */}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-text-dim">{formatDate(row.created_at)}</span>
                  {isExpanded && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(row.id) }}
                      className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 py-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="glass-btn px-4 py-2 rounded-md text-[12px] font-medium text-text disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-[12px] text-text-dim font-mono">{page} / {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="glass-btn px-4 py-2 rounded-md text-[12px] font-medium text-text disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
