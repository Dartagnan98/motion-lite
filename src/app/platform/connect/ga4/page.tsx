// /platform/connect/ga4 (server component)
//
// GA4 onboarding with one-click reuse of the agency's existing Google identities
// (CONNECTOR-REUSE-PLAN A2). Only identities whose stored scopes include
// Analytics read access are offered for reuse; otherwise the PM connects once
// (combined GSC+GA4 scopes) which upgrades the shared credential for both.

import Link from 'next/link'
import { getCurrentWorkspaceId, ensureTenantForWorkspace } from '@/lib/platform/tenant'
import { adoptLegacyGoogleCredentials } from '@/lib/platform/integrations/gsc/oauth'
import { listTenantCredentials } from '@/lib/platform/vault'
import { ConnectGa4Button } from './ConnectGa4Button'

const ERROR_COPY: Record<string, string> = {
  access_denied: 'Google access was denied. Try again.',
  credential_not_found: 'That saved Google connection could not be found. Connect again.',
  no_active_client: 'No active client selected. Open a client first, then connect.',
}

export default async function ConnectGa4Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  let identities: { id: number; identity: string }[] = []
  const workspaceId = await getCurrentWorkspaceId()
  if (workspaceId) {
    const tenant = ensureTenantForWorkspace(workspaceId)
    adoptLegacyGoogleCredentials(tenant.id)
    identities = listTenantCredentials(tenant.id, 'google')
      // GA4 needs Analytics scope; only offer reuse for credentials that have it.
      .filter((c) => (c.scopes ?? '').includes('analytics'))
      .map((c) => ({ id: c.id, identity: c.identity }))
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8">
        <Link
          href="/platform/connect"
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All integrations
        </Link>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 font-bold text-lg">A</div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Google Analytics 4</h1>
              <p className="text-sm text-gray-500">Connect a property for this client</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
            {ERROR_COPY[error] ?? error}
          </div>
        )}

        {identities.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Use a connected Google account
            </p>
            <div className="space-y-2">
              {identities.map((id) => (
                <a
                  key={id.id}
                  href={`/api/platform/integrations/ga4/reuse?credId=${id.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">G</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{id.identity}</p>
                    <p className="text-xs text-gray-400">Pick a property — no sign-in needed</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              ))}
            </div>
            <div className="flex items-center gap-3 my-4">
              <span className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <span className="flex-1 h-px bg-gray-200" />
            </div>
          </div>
        )}

        <ConnectGa4Button label={identities.length > 0 ? 'Connect a different Google account' : 'Connect with Google'} />

        <p className="mt-4 text-xs text-gray-400 text-center">
          Read-only access. Credentials are encrypted at rest and reused across this agency&apos;s clients.
        </p>
      </div>
    </main>
  )
}
