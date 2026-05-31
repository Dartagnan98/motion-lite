'use client'

// /platform/connect/gravity_forms  (Step 1 of 2)
//
// PM enters site URL + WordPress username + Application Password.
// Same auth model as WordPress (Gravity Forms is a WP plugin).
// On submit: POST /api/platform/integrations/gravity_forms/begin-connect
// On 2xx: redirect to /platform/connect/gravity_forms/select-forms
// On error: inline error banner.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ConnectGravityFormsPage() {
  const router = useRouter()

  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedUrl = siteUrl.trim().replace(/\/+$/, '')
    const trimmedUser = username.trim()
    const trimmedPass = appPassword.trim().replace(/\s+/g, '')

    if (!trimmedUrl || !trimmedUser || !trimmedPass) {
      setError('All fields are required.')
      return
    }

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError('Site URL must start with http:// or https://')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/platform/integrations/gravity_forms/begin-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteUrl: trimmedUrl,
          username: trimmedUser,
          appPassword: trimmedPass,
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Connect request failed')
      }
      router.push('/platform/connect/gravity_forms/select-forms')
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
            <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-700 font-bold text-xs">
              GF
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Gravity Forms</h1>
              <p className="text-sm text-gray-500">Step 1 of 2 — Credentials</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            Enter your WordPress site credentials. Gravity Forms uses the same
            Application Password auth as WordPress. You will then choose which forms to track.
          </p>
        </div>

        {/* Setup instructions */}
        <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 mb-5 text-xs text-orange-700 leading-relaxed">
          Ensure the Gravity Forms REST API is enabled under{' '}
          <strong>Forms &rsaquo; Settings &rsaquo; REST API</strong> in WP admin.
          Use the same Application Password you created for WordPress access.
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
              Site URL
            </label>
            <input
              type="url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://example.com"
              required
              autoComplete="off"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              WordPress Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoComplete="username"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Application Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                required
                autoComplete="off"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !siteUrl.trim() || !username.trim() || !appPassword.trim()}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm mt-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Validating credentials...
              </>
            ) : (
              'Continue'
            )}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-400 text-center">
          Your credentials are stored encrypted and only used to fetch form submission data.
        </p>
      </div>
    </main>
  )
}
