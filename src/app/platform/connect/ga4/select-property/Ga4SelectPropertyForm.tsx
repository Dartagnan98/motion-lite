'use client'

// Client component: search + radio list + submit for the GA4 picker.
// Properties are passed in from the server parent.

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface PropertyChoice {
  propertyId: string
  displayName: string
  accountDisplayName: string
}

export function Ga4SelectPropertyForm({ properties }: { properties: PropertyChoice[] }) {
  const router = useRouter()

  const [selected, setSelected] = useState<string>(properties[0]?.propertyId ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return properties
    return properties.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.accountDisplayName.toLowerCase().includes(q) ||
        p.propertyId.includes(q)
    )
  }, [properties, query])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setLoading(true)
    setError(null)

    const chosenProperty = properties.find((p) => p.propertyId === selected)

    try {
      const res = await fetch('/api/platform/integrations/ga4/select-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: selected,
          propertyDisplayName: chosenProperty?.displayName ?? selected,
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; integrationId?: number }
      if (!res.ok) {
        throw new Error(data.error || 'Property selection failed')
      }
      router.push('/platform/dashboard?connected=ga4')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  const byAccount = filtered.reduce<Record<string, PropertyChoice[]>>((acc, p) => {
    const key = p.accountDisplayName
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm">
            GA4
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Select a GA4 Property</h1>
            <p className="text-sm text-gray-500">{properties.length} {properties.length === 1 ? 'property' : 'properties'} found</p>
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
            placeholder="Search properties by name, account, or ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {query && filtered.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">No properties match &ldquo;{query}&rdquo;.</p>
          )}
          {query && filtered.length > 0 && (
            <p className="text-xs text-gray-400 mt-2">{filtered.length} of {properties.length} shown</p>
          )}
        </div>

        <div className="space-y-4 mb-6 max-h-[60vh] overflow-y-auto pr-1 border-t border-gray-100 pt-4">
          {Object.entries(byAccount).map(([accountName, props]) => (
            <div key={accountName}>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                {accountName}
              </p>
              <div className="space-y-2">
                {props.map((p) => (
                  <label
                    key={p.propertyId}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selected === p.propertyId
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="propertyId"
                      value={p.propertyId}
                      checked={selected === p.propertyId}
                      onChange={() => setSelected(p.propertyId)}
                      className="accent-blue-600"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.displayName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">ID: {p.propertyId}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
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

      <p className="mt-4 text-xs text-gray-400 text-center">
        You can connect additional properties later from the dashboard.
      </p>
    </>
  )
}
