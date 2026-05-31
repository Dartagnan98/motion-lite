'use client'

// /platform/connect/everhour  (Step 1 of 3)
//
// PM enters their Everhour API key.
// On submit: POST /api/platform/integrations/everhour/begin-connect
// On 2xx: redirect to /platform/connect/everhour/select-clients
// On error: inline error banner.
//
// The key is validated server-side (calls /users/me on Everhour).
// A signed HttpOnly cookie is set on success carrying the pending state.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ConnectEverhourPage() {
  const router = useRouter()

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill the agency's shared Everhour key so it isn't re-pasted per client.
  useEffect(() => {
    fetch('/api/platform/integrations/tenant-key?provider=everhour')
      .then((r) => r.json())
      .then((d: { apiKey?: string | null }) => { if (d.apiKey) setApiKey(d.apiKey) })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      setError('API key is required.')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/platform/integrations/everhour/begin-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmedKey }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Connect request failed')
      }
      router.push('/platform/connect/everhour/select-clients')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8">
        {/* Back link */}
        <Link
          href="/platform/connect"
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All integrations
        </Link>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 font-bold text-xs">
              EH
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Everhour</h1>
              <p className="text-sm text-gray-500">Step 1 of 3 — API key</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            Enter your Everhour API key. You will then choose which clients and
            projects to pull hours from.
          </p>
        </div>

        {/* API key instructions */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-5 text-xs text-blue-700 leading-relaxed">
          Get your API key in Everhour at{' '}
          <a
            href="https://app.everhour.com/#account/profile"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            Account settings
          </a>{' '}
          under the &quot;API&quot; section.
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Everhour API key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ev1-..."
                required
                autoComplete="off"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm mt-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Validating key...
              </>
            ) : (
              'Continue'
            )}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-400 text-center">
          Your API key is stored encrypted and only used to fetch time-tracking data.
        </p>
      </div>
    </main>
  )
}
