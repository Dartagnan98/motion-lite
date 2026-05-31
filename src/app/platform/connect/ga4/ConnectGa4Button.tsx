'use client'

import { useState } from 'react'

export function ConnectGa4Button({ label = 'Connect with Google' }: { label?: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/platform/integrations/ga4/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'account' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connect request failed')
      window.location.href = data.redirectUrl
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3 text-sm text-red-700">{error}</div>
      )}
      <button
        onClick={handleConnect}
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Redirecting to Google...
          </>
        ) : (
          label
        )}
      </button>
    </>
  )
}
