'use client'

// "Auto-connect from domain" (CONNECTOR-REUSE-PLAN B). One click: match the
// active client's website to the agency's shared credentials and connect what
// can be matched (GSC property, PageSpeed URL), reporting a per-provider result.
// Dedupe makes re-running safe; anything skipped has a manual connect path.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Result = { provider: string; status: 'connected' | 'skipped' | 'error'; detail: string }

const DOT: Record<Result['status'], string> = {
  connected: 'bg-emerald-500',
  skipped: 'bg-gray-300',
  error: 'bg-red-500',
}

export function AutoConnectButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch('/api/platform/integrations/auto-connect', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; results?: Result[]; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Auto-connect failed')
      setResults(data.results ?? [])
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-connect failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={run}
        disabled={loading}
        className="text-xs font-medium border border-gray-200 hover:border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
        title="Match this client's domain to your connected accounts and connect what fits"
      >
        {loading ? (
          <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        {loading ? 'Matching…' : 'Auto-connect from domain'}
      </button>

      {(results || error) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button aria-label="Close" className="absolute inset-0 bg-black/30" onClick={() => { setResults(null); setError(null) }} />
          <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Auto-connect results</h2>
            <p className="text-xs text-gray-400 mb-4">Skipped items have a one-click manual path (Connect Integration).</p>
            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 mb-3">{error}</div>}
            {results && (
              <ul className="space-y-2 mb-4">
                {results.map((r) => (
                  <li key={r.provider} className="flex items-start gap-2.5">
                    <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${DOT[r.status]}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{r.provider.toUpperCase()} <span className="text-xs font-normal text-gray-400">· {r.status}</span></p>
                      <p className="text-xs text-gray-500">{r.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => { setResults(null); setError(null) }}
              className="w-full text-xs font-medium bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 rounded-lg"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}
