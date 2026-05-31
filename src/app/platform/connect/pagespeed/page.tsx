'use client'

// /platform/connect/pagespeed
//
// PageSpeed Insights API-key connect form.
// PM enters their API key + target URL + strategy radio → POST to
// /api/platform/integrations/pagespeed/connect → integrationId → redirect to dashboard.
//
// No OAuth redirect needed — PageSpeed is api_key auth.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ConnectPageSpeedPage() {
  const router = useRouter()

  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill the agency's shared PageSpeed key + the client's website URL (#6 +
  // A3) so connecting a new client is just "confirm".
  useEffect(() => {
    fetch('/api/platform/integrations/tenant-key?provider=pagespeed')
      .then((r) => r.json())
      .then((d: { apiKey?: string | null; clientWebsite?: string | null }) => {
        if (d.apiKey) setApiKey(d.apiKey)
        if (d.clientWebsite) setUrl(d.clientWebsite)
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/platform/integrations/pagespeed/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          apiKey: apiKey.trim(),
          strategy,
          fireFirstSnapshot: true,
        }),
      })
      const data = await res.json() as { ok?: boolean; integrationId?: number; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Connect request failed')
      }
      router.push('/platform/dashboard?connected=pagespeed')
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
            <div className="w-10 h-10 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center text-green-700 font-bold text-xs">
              PSI
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">PageSpeed Insights</h1>
              <p className="text-sm text-gray-500">Lighthouse audit via API key</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            Enter your Google PageSpeed Insights API key and the URL to audit. Hiilite will run
            Lighthouse to get Performance, SEO, and Core Web Vitals scores.
          </p>
        </div>

        {/* API key instructions */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-5 text-xs text-blue-700 leading-relaxed">
          Get a free API key at{' '}
          <a
            href="https://developers.google.com/speed/docs/insights/v5/get-started"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            console.cloud.google.com
          </a>
          . Enable the &quot;PageSpeed Insights API&quot; in your Cloud project.
          Free tier: 25,000 calls/day.
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Target URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              URL to audit
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* API key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              PageSpeed API key
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
            />
          </div>

          {/* Strategy radio */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Audit strategy</p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="strategy"
                  value="mobile"
                  checked={strategy === 'mobile'}
                  onChange={() => setStrategy('mobile')}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-700">Mobile</span>
                <span className="text-xs text-gray-400">(recommended)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="strategy"
                  value="desktop"
                  checked={strategy === 'desktop'}
                  onChange={() => setStrategy('desktop')}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-700">Desktop</span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !url || !apiKey}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm mt-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Running first audit...
              </>
            ) : (
              'Connect and run audit'
            )}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-400 text-center">
          The first audit runs immediately (takes 10-30 seconds).
        </p>
      </div>
    </main>
  )
}
