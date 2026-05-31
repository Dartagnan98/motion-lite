'use client'

// /platform/connect/qbo — Intuit QBO onboarding (tenant/agency-level).
//
// Primary path: paste a refresh token from Intuit's OAuth 2.0 Playground.
// Intuit production redirect URIs can't be localhost, so the browser-redirect
// OAuth only works behind a public HTTPS host — kept as a secondary option.

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function ConnectQboPage() {
  const router = useRouter()
  const oauthError = useSearchParams().get('error')
  const [refreshToken, setRefreshToken] = useState('')
  const [realmId, setRealmId] = useState('123145730043042')
  const [loading, setLoading] = useState(false)
  const [redirLoading, setRedirLoading] = useState(false)
  const [error, setError] = useState<string | null>(oauthError)
  const [ok, setOk] = useState(false)

  async function bootstrap() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/platform/integrations/qbo/bootstrap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken.trim(), realmId: realmId.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Connect failed')
      setOk(true)
      setTimeout(() => router.push('/platform/dashboard?connected=qbo'), 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally { setLoading(false) }
  }

  async function redirectConnect() {
    setRedirLoading(true); setError(null)
    try {
      const res = await fetch('/api/platform/integrations/qbo/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connect request failed')
      window.location.href = data.redirectUrl
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error'); setRedirLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8">
        <Link href="/platform/connect" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          All integrations
        </Link>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center text-green-700 font-bold text-lg">QB</div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">QuickBooks Online</h1>
            <p className="text-sm text-gray-500">Connect your agency&apos;s QBO (once)</p>
          </div>
        </div>

        {ok && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">Connected — taking you to the dashboard…</div>}
        {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700 break-words">{error}</div>}

        {/* Primary: Playground refresh token */}
        <div className="rounded-lg border border-gray-200 p-4 mb-4">
          <p className="text-sm font-medium text-gray-800 mb-1">Connect with a Playground token</p>
          <ol className="text-xs text-gray-500 list-decimal ml-4 space-y-0.5 mb-3">
            <li>Open Intuit&apos;s <a className="text-blue-600 hover:underline" href="https://developer.intuit.com/app/developer/playground" target="_blank" rel="noopener noreferrer">OAuth 2.0 Playground</a>, pick your app, scope <code>Accounting</code>.</li>
            <li>Authorize your company → <strong>Get tokens</strong> → copy the <strong>Refresh Token</strong>.</li>
            <li>Paste it below (Realm ID is prefilled).</li>
          </ol>
          <label className="block text-xs font-medium text-gray-600 mb-1">Refresh token</label>
          <input value={refreshToken} onChange={e => setRefreshToken(e.target.value)} placeholder="AB11..." className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          <label className="block text-xs font-medium text-gray-600 mb-1">Realm ID (company)</label>
          <input value={realmId} onChange={e => setRealmId(e.target.value)} className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-green-500" />
          <button onClick={bootstrap} disabled={loading || !refreshToken.trim() || !realmId.trim()} className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
            {loading ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Connecting…</>) : 'Connect QuickBooks'}
          </button>
        </div>

        {/* Secondary: redirect OAuth (needs a public HTTPS host) */}
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-700">Or connect via browser OAuth (requires a public HTTPS host — not localhost)</summary>
          <button onClick={redirectConnect} disabled={redirLoading} className="mt-2 w-full border border-gray-200 hover:border-gray-300 text-gray-700 py-2 px-4 rounded-lg text-sm disabled:opacity-50">
            {redirLoading ? 'Redirecting…' : 'Connect via Intuit redirect'}
          </button>
        </details>

        <p className="mt-4 text-xs text-gray-400 text-center">Tokens encrypted at rest. The platform refreshes its own token — your QBO MCP is unaffected. Financial data is internal, never on public reports.</p>
      </div>
    </main>
  )
}
