'use client'

// Client component: tab toggle (By Portfolio / By Projects) for Asana scope selection.
// Portfolios are passed in as a single-select radio list.
// Projects are passed in as a multi-select checkbox list.
// On submit: POST to /api/platform/integrations/asana/finalize
// On success: push to /platform/dashboard?connected=asana

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { AsanaPortfolio, AsanaProject } from '@/lib/platform/integrations/asana/oauth'

interface Props {
  portfolios: AsanaPortfolio[]
  projects: AsanaProject[]
  workspaceName: string
}

type TabMode = 'portfolio' | 'projects'

export function AsanaSelectScopeForm({ portfolios, projects, workspaceName }: Props) {
  const router = useRouter()

  // Default to portfolio tab if any exist, else force projects.
  const [mode, setMode] = useState<TabMode>(portfolios.length > 0 ? 'portfolio' : 'projects')

  // Portfolio mode state.
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('')
  const [portfolioQuery, setPortfolioQuery] = useState('')

  // Projects mode state — all pre-unchecked (PM explicitly selects).
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set())
  const [projectQuery, setProjectQuery] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filtered lists.
  const filteredPortfolios = useMemo(() => {
    const q = portfolioQuery.trim().toLowerCase()
    if (!q) return portfolios
    return portfolios.filter((p) => p.name.toLowerCase().includes(q))
  }, [portfolios, portfolioQuery])

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, projectQuery])

  function toggleProject(gid: string) {
    setSelectedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(gid)) {
        next.delete(gid)
      } else {
        next.add(gid)
      }
      return next
    })
  }

  function selectAllProjects() {
    setSelectedProjects(new Set(projects.map((p) => p.gid)))
  }

  function clearProjects() {
    setSelectedProjects(new Set())
  }

  const submitDisabled =
    loading ||
    (mode === 'portfolio' && !selectedPortfolio) ||
    (mode === 'projects' && selectedProjects.size === 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitDisabled) return
    setLoading(true)
    setError(null)

    try {
      let body: Record<string, unknown>

      if (mode === 'portfolio') {
        const portfolio = portfolios.find((p) => p.gid === selectedPortfolio)
        body = {
          scope: 'portfolio',
          portfolioGid: selectedPortfolio,
          portfolioName: portfolio?.name ?? selectedPortfolio,
        }
      } else {
        const ids = Array.from(selectedProjects)
        const names = ids.map(
          (id) => projects.find((p) => p.gid === id)?.name ?? id
        )
        body = {
          scope: 'projects',
          projectIds: ids,
          projectNames: names,
        }
      }

      const res = await fetch('/api/platform/integrations/asana/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { ok?: boolean; error?: string; integrationId?: number }
      if (!res.ok) {
        throw new Error(data.error || 'Finalize failed')
      }
      router.push('/platform/dashboard?connected=asana')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  const showPortfolioTab = portfolios.length > 0

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-600 font-bold text-sm">
            Asn
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Choose Scope</h1>
            <p className="text-sm text-gray-500">Step 2 of 3 — {workspaceName}</p>
          </div>
        </div>
        <p className="text-sm text-gray-500">
          Limit this integration to a specific portfolio or set of projects.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tab toggle — only show Portfolio tab if the workspace has portfolios */}
      {showPortfolioTab && (
        <div className="flex border border-gray-200 rounded-lg overflow-hidden mb-5">
          <button
            type="button"
            onClick={() => setMode('portfolio')}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === 'portfolio'
                ? 'bg-pink-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            By Portfolio
          </button>
          <button
            type="button"
            onClick={() => setMode('projects')}
            className={`flex-1 py-2 text-sm font-medium border-l border-gray-200 transition-colors ${
              mode === 'projects'
                ? 'bg-pink-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            By Projects
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* ── Portfolio mode ── */}
        {mode === 'portfolio' && (
          <>
            <div className="mb-3">
              <input
                type="search"
                placeholder="Search portfolios..."
                value={portfolioQuery}
                onChange={(e) => setPortfolioQuery(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              />
              {portfolioQuery && filteredPortfolios.length === 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  No portfolios match &ldquo;{portfolioQuery}&rdquo;.
                </p>
              )}
              {portfolioQuery && filteredPortfolios.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  {filteredPortfolios.length} of {portfolios.length} shown
                </p>
              )}
            </div>

            {portfolios.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                No portfolios found in this workspace.
              </div>
            ) : (
              <div className="space-y-2 mb-6 max-h-[60vh] overflow-y-auto pr-1 border-t border-gray-100 pt-4">
                {filteredPortfolios.map((p) => (
                  <label
                    key={p.gid}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedPortfolio === p.gid
                        ? 'border-pink-500 bg-pink-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="portfolioGid"
                      value={p.gid}
                      checked={selectedPortfolio === p.gid}
                      onChange={() => setSelectedPortfolio(p.gid)}
                      className="accent-pink-600"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                      {p.ownerName && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          Owner: {p.ownerName}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Projects mode ── */}
        {mode === 'projects' && (
          <>
            <div className="mb-3">
              <input
                type="search"
                placeholder="Search projects by name..."
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
                autoFocus={!showPortfolioTab}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              />
              {projectQuery && filteredProjects.length === 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  No projects match &ldquo;{projectQuery}&rdquo;.
                </p>
              )}
              {projectQuery && filteredProjects.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  {filteredProjects.length} of {projects.length} shown
                </p>
              )}
            </div>

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={selectAllProjects}
                  className="text-xs text-pink-600 hover:text-pink-700 font-medium transition-colors"
                >
                  Select all
                </button>
                <span className="text-gray-200 text-xs">|</span>
                <button
                  type="button"
                  onClick={clearProjects}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Clear
                </button>
              </div>
              <p className="text-sm text-gray-500">
                {selectedProjects.size} of {projects.length}{' '}
                {projects.length === 1 ? 'project' : 'projects'} selected
              </p>
            </div>

            {projects.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                No active projects found in this workspace.
              </div>
            ) : (
              <div className="space-y-2 mb-6 max-h-[60vh] overflow-y-auto pr-1 border-t border-gray-100 pt-4">
                {filteredProjects.map((p) => (
                  <label
                    key={p.gid}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedProjects.has(p.gid)
                        ? 'border-pink-500 bg-pink-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjects.has(p.gid)}
                      onChange={() => toggleProject(p.gid)}
                      className="accent-pink-600 w-4 h-4 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        <button
          type="submit"
          disabled={submitDisabled}
          className="w-full bg-pink-600 hover:bg-pink-700 disabled:bg-pink-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            'Connect Asana'
          )}
        </button>
      </form>

      {/* Phase 3 note: add portfolio project-count preview on selection
          via GET /api/platform/integrations/asana/portfolio-preview?portfolioGid=xxx
          returning { count: number }. Fires on radio change; displays "X projects"
          below the portfolio name before the user submits. */}
    </>
  )
}
