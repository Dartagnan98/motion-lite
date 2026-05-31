'use client'

// /platform/connect/asana
//
// Asana OAuth onboarding page. Mirrors /platform/connect/ga4/page.tsx exactly.
// PM clicks "Connect with Asana" → POST to /api/platform/integrations/asana/connect
// → follow redirectUrl to Asana → callback → workspace picker → dashboard.

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function ConnectAsanaPage() {
  const searchParams = useSearchParams()
  const oauthError = searchParams.get('error')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(oauthError ?? null)

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/platform/integrations/asana/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'account' }),
      })
      const data = await res.json() as { redirectUrl?: string; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Connect request failed')
      }
      window.location.href = data.redirectUrl!
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  function errorMessage(code: string): string {
    if (code === 'access_denied') return 'Asana access was denied. Click below to try again.'
    if (code === 'session_expired') return 'Your session expired. Please start over.'
    if (code === 'missing_oauth_params') return 'Asana sent you back without the auth code. Ensure the redirect URI is registered in your Asana OAuth app.'
    return code
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
            <div className="w-10 h-10 rounded-lg bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-600 font-bold text-sm">
              Asn
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Asana</h1>
              <p className="text-sm text-gray-500">Connect your Asana workspace</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            Authorize access to your Asana workspace. Hiilite will import completed tasks
            and daily completion rates to populate the Tasks Completed section of your
            monthly report.
          </p>
        </div>

        {/* What we access */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm">
          <p className="font-medium text-gray-700 mb-2">Access requested</p>
          <ul className="space-y-1.5 text-gray-600">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              Completed tasks for the reporting period
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              Task names and project membership
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
              No task creation or modification
            </li>
          </ul>
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
            {errorMessage(error)}
          </div>
        )}

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={loading}
          className="w-full bg-pink-600 hover:bg-pink-700 active:bg-pink-800 disabled:bg-pink-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Redirecting to Asana...
            </>
          ) : (
            'Connect with Asana'
          )}
        </button>

        <p className="mt-4 text-xs text-gray-400 text-center">
          Your credentials are encrypted at rest and never shared.
        </p>
      </div>
    </main>
  )
}
