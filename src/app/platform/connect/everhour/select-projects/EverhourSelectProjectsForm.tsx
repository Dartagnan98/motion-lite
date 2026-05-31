'use client'

// Client component: multi-select checkbox list of Everhour projects.
// Projects are grouped by client name (mirrors GA4 picker's byAccount pattern).
// All projects pre-checked; PM unchecks to exclude.
// On submit: POST { projectIds } to /api/platform/integrations/everhour/finalize
// On success: push to /platform/dashboard?connected=everhour

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { EverhourPickerProject } from '@/lib/platform/integrations/everhour/adapter'

interface Props {
  projects: EverhourPickerProject[]
  clientNames: string[]
}

export function EverhourSelectProjectsForm({ projects, clientNames }: Props) {
  const router = useRouter()

  // All projects pre-checked.
  const [selected, setSelected] = useState<Set<string>>(
    new Set(projects.map((p) => p.id))
  )
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.clientName ?? '').toLowerCase().includes(q)
    )
  }, [projects, query])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(projects.map((p) => p.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size === 0) return
    setLoading(true)
    setError(null)

    const projectIds = Array.from(selected)

    try {
      const res = await fetch('/api/platform/integrations/everhour/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; integrationId?: number }
      if (!res.ok) {
        throw new Error(data.error || 'Finalize failed')
      }
      router.push('/platform/dashboard?connected=everhour')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  // Group projects by clientName.
  const byClient = filtered.reduce<Record<string, EverhourPickerProject[]>>((acc, p) => {
    const key = p.clientName ?? '(No client)'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  const selectedCount = selected.size
  const totalCount = projects.length

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 font-bold text-xs">
            EH
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Select Projects</h1>
            <p className="text-sm text-gray-500">Step 3 of 3</p>
          </div>
        </div>
        {clientNames.length > 0 && (
          <p className="text-xs text-gray-400 mb-1 truncate">
            Clients: {clientNames.join(', ')}
          </p>
        )}
        <p className="text-sm text-gray-500">
          {selectedCount} of {totalCount} {totalCount === 1 ? 'project' : 'projects'} selected
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Search */}
        <div className="mb-3">
          <input
            type="search"
            placeholder="Search projects by name or client..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
          {query && filtered.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">No projects match &ldquo;{query}&rdquo;.</p>
          )}
          {query && filtered.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">{filtered.length} of {totalCount} shown</p>
          )}
        </div>

        {/* Select all / Clear */}
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors"
          >
            Select all
          </button>
          <span className="text-gray-200 text-xs">|</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
        </div>

        {/* Project list grouped by client */}
        {projects.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">
            No projects found for the selected clients.
          </div>
        ) : (
          <div className="space-y-4 mb-6 max-h-[60vh] overflow-y-auto pr-1 border-t border-gray-100 pt-4">
            {Object.entries(byClient).map(([clientName, clientProjects]) => (
              <div key={clientName}>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  {clientName}
                </p>
                <div className="space-y-2">
                  {clientProjects.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selected.has(p.id)
                          ? 'border-amber-500 bg-amber-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        className="accent-amber-600 w-4 h-4 flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">
                          {p.id}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={selected.size === 0 || loading}
          className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            'Connect Everhour'
          )}
        </button>
      </form>
    </>
  )
}
