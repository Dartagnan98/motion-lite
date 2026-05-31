'use client'

// Client component: multi-select checkbox list of Everhour clients.
// Clients are passed in from the server parent (listClients() runs server-side).
// On submit: POST { clientIds, clientNames } to /api/platform/integrations/everhour/select-clients
// On success: push to /platform/connect/everhour/select-projects

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { EverhourClient } from '@/lib/platform/integrations/everhour/adapter'

interface Props {
  clients: EverhourClient[]
}

export function EverhourSelectClientsForm({ clients }: Props) {
  const router = useRouter()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q))
  }, [clients, query])

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
    setSelected(new Set(clients.map((c) => c.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selected.size === 0) return
    setLoading(true)
    setError(null)

    const clientIds = Array.from(selected)
    const clientNames = clientIds.map(
      (id) => clients.find((c) => c.id === id)?.name ?? id
    )

    try {
      const res = await fetch('/api/platform/integrations/everhour/select-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds, clientNames }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Client selection failed')
      }
      router.push('/platform/connect/everhour/select-projects')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  const selectedCount = selected.size
  const totalCount = clients.length

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 font-bold text-xs">
            EH
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Select Clients</h1>
            <p className="text-sm text-gray-500">Step 2 of 3</p>
          </div>
        </div>
        <p className="text-sm text-gray-500">
          {selectedCount} of {totalCount} {totalCount === 1 ? 'client' : 'clients'} selected
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
            placeholder="Search clients by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
          {query && filtered.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">No clients match &ldquo;{query}&rdquo;.</p>
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

        {/* Client list */}
        {clients.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">
            No clients found in this Everhour workspace.
          </div>
        ) : (
          <div className="space-y-2 mb-6 max-h-[60vh] overflow-y-auto pr-1 border-t border-gray-100 pt-4">
            {filtered.map((client) => (
              <label
                key={client.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selected.has(client.id)
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(client.id)}
                  onChange={() => toggle(client.id)}
                  className="accent-amber-600 w-4 h-4 flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{client.name}</p>
                  {client.projectCount != null && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {client.projectCount} {client.projectCount === 1 ? 'project' : 'projects'}
                    </p>
                  )}
                </div>
              </label>
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
              Loading projects...
            </>
          ) : (
            'Continue to projects'
          )}
        </button>
      </form>
    </>
  )
}
