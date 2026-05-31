'use client'

// SeRankingSelectProjectForm — Step 2 of 2 for SE Ranking connect.
//
// Single-select project picker with search filter.
// On submit: POST /api/platform/integrations/se_ranking/finalize
// On success: redirect to /platform/dashboard with a connected state.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface SeRankingProject {
  id: string | number
  name: string
}

interface SeRankingSelectProjectFormProps {
  projects: SeRankingProject[]
}

export function SeRankingSelectProjectForm({ projects }: SeRankingSelectProjectFormProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) {
      setError('Please select a project.')
      return
    }
    setLoading(true)
    setError(null)

    const selected = projects.find((p) => String(p.id) === selectedId)

    try {
      const res = await fetch('/api/platform/integrations/se_ranking/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedId,
          projectName: selected?.name ?? selectedId,
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Finalize failed')
      }
      router.push('/platform/dashboard?connected=se_ranking')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-700 font-bold text-xs flex-shrink-0">
          SER
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">SE Ranking</h1>
          <p className="text-sm text-gray-500">Step 2 of 2 — Select project</p>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-5 leading-relaxed">
        Choose the SE Ranking project to pull keyword rankings from. Only one project
        per integration — connect multiple times for multiple projects.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
      </div>

      {/* Project list */}
      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto mb-5">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400 text-center">
            {projects.length === 0
              ? 'No projects found. Create a project in SE Ranking first.'
              : 'No projects match your search.'}
          </div>
        ) : (
          filtered.map((project) => {
            const id = String(project.id)
            const isSelected = selectedId === id
            return (
              <label
                key={id}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-50 last:border-0 transition-colors ${
                  isSelected ? 'bg-violet-50' : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="projectId"
                  value={id}
                  checked={isSelected}
                  onChange={() => setSelectedId(id)}
                  className="w-4 h-4 text-violet-600 border-gray-300 focus:ring-violet-500"
                />
                <span className="text-sm text-gray-900">{project.name}</span>
              </label>
            )
          })
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !selectedId}
        className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Connecting...
          </>
        ) : (
          'Connect Project'
        )}
      </button>
    </form>
  )
}
