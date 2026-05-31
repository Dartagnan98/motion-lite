'use client'

// Client picker for GSC properties. Receives the FULL verified-site list from
// its server parent (fetched server-side from the pending OAuth token — no URL
// length cap, so every property shows). Adds a search box since agencies can
// have hundreds of verified properties.

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'

export interface SiteChoice {
  siteUrl: string
  permissionLevel: string
}

function permissionLabel(level: string): string {
  switch (level) {
    case 'siteOwner': return 'Owner'
    case 'siteFullUser': return 'Full'
    case 'siteRestrictedUser': return 'Restricted'
    default: return level
  }
}

export function GscSitePicker({ sites }: { sites: SiteChoice[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sites
    return sites.filter((s) => s.siteUrl.toLowerCase().includes(q))
  }, [sites, query])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/platform/integrations/gsc/select-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: selected }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; integrationId?: number; accountId?: number }
      if (!res.ok) throw new Error(data.error || 'Site selection failed')
      const dest = data.accountId
        ? `/platform/reports?accountId=${data.accountId}`
        : '/platform/dashboard?connected=gsc'
      router.push(dest)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-lg p-8">
        <div className="mb-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
              G
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Select a GSC Property</h1>
              <p className="text-sm text-gray-500">
                {sites.length} {sites.length === 1 ? 'property' : 'properties'} available
              </p>
            </div>
          </div>

          {/* Search */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search properties…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            autoFocus
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-2 mb-6 max-h-80 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                No properties match &ldquo;{query}&rdquo;.
              </p>
            ) : (
              filtered.map((site) => (
                <label
                  key={site.siteUrl}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selected === site.siteUrl
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="siteUrl"
                    value={site.siteUrl}
                    checked={selected === site.siteUrl}
                    onChange={() => setSelected(site.siteUrl)}
                    className="accent-blue-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{site.siteUrl}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{permissionLabel(site.permissionLevel)} access</p>
                  </div>
                </label>
              ))
            )}
          </div>

          <button
            type="submit"
            disabled={!selected || loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Connecting...
              </>
            ) : (
              'Connect Property'
            )}
          </button>
        </form>
      </div>
    </main>
  )
}
