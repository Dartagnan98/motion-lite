'use client'

// Client component: search + radio list + submit for the Asana workspace picker.
// Workspaces are passed in from the server parent (no URL params — avoids header overflow).
// Mirrors Ga4SelectPropertyForm structure exactly.

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface WorkspaceChoice {
  workspaceId: string
  displayName: string
}

export function AsanaSelectWorkspaceForm({ workspaces }: { workspaces: WorkspaceChoice[] }) {
  const router = useRouter()

  const [selected, setSelected] = useState<string>(workspaces[0]?.workspaceId ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter(
      (w) =>
        w.displayName.toLowerCase().includes(q) ||
        w.workspaceId.includes(q)
    )
  }, [workspaces, query])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setLoading(true)
    setError(null)

    const chosenWorkspace = workspaces.find((w) => w.workspaceId === selected)

    try {
      const res = await fetch('/api/platform/integrations/asana/select-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: selected,
          workspaceDisplayName: chosenWorkspace?.displayName ?? selected,
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Workspace selection failed')
      }
      router.push('/platform/connect/asana/select-scope')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-600 font-bold text-sm">
            Asn
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Select an Asana Workspace</h1>
            <p className="text-sm text-gray-500">Step 1 of 3</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <input
            type="search"
            placeholder="Search workspaces by name or ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
          />
          {query && filtered.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">No workspaces match &ldquo;{query}&rdquo;.</p>
          )}
          {query && filtered.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">{filtered.length} of {workspaces.length} shown</p>
          )}
        </div>

        <div className="space-y-2 mb-6 max-h-[60vh] overflow-y-auto pr-1 border-t border-gray-100 pt-4">
          {filtered.map((w) => (
            <label
              key={w.workspaceId}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selected === w.workspaceId
                  ? 'border-pink-500 bg-pink-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="workspaceId"
                value={w.workspaceId}
                checked={selected === w.workspaceId}
                onChange={() => setSelected(w.workspaceId)}
                className="accent-pink-600"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{w.displayName}</p>
                <p className="text-xs text-gray-400 mt-0.5">ID: {w.workspaceId}</p>
              </div>
            </label>
          ))}
        </div>

        <button
          type="submit"
          disabled={!selected || loading}
          className="w-full bg-pink-600 hover:bg-pink-700 disabled:bg-pink-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            'Continue to scope'
          )}
        </button>
      </form>

      <p className="mt-4 text-xs text-gray-400 text-center">
        You can connect additional workspaces later from the dashboard.
      </p>
    </>
  )
}
