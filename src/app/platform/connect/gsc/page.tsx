// /platform/connect/gsc (server component)
//
// GSC onboarding. Offers ONE-CLICK REUSE of the agency's existing Google
// identities (no re-auth) — the keystone of CONNECTOR-REUSE-PLAN #3 — plus a
// "connect a different Google account" fallback for a new identity (e.g. one
// that owns a property the current account can't see, like kelownadentistry.com).

import Link from 'next/link'
import { getCurrentWorkspaceId, ensureTenantForWorkspace } from '@/lib/platform/tenant'
import { adoptLegacyGoogleCredentials } from '@/lib/platform/integrations/gsc/oauth'
import { listTenantCredentials } from '@/lib/platform/vault'
import { ConnectGscButton } from './ConnectGscButton'

const ERROR_COPY: Record<string, string> = {
  access_denied: 'Google access was denied. Try again.',
  no_verified_sites: 'No verified GSC properties found for that Google account.',
  missing_oauth_params: 'Google sent you back without an auth code — check the redirect URI registration.',
  credential_not_found: 'That saved Google connection could not be found. Connect again.',
  no_active_client: 'No active client selected. Open a client first, then connect.',
}

export default async function ConnectGscPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  let identities: { id: number; identity: string }[] = []
  const workspaceId = await getCurrentWorkspaceId()
  if (workspaceId) {
    const tenant = ensureTenantForWorkspace(workspaceId)
    // Bootstrap: mirror existing per-integration Google tokens into the shared
    // store so they show up as reuse options without a re-auth.
    adoptLegacyGoogleCredentials(tenant.id)
    identities = listTenantCredentials(tenant.id, 'google')
      // Only offer reuse for identities that actually hold the Search Console
      // scope — a GA4-only consent can leave a shared token without it, and
      // reusing that would 403. Those identities must reconnect (fresh consent
      // now grants the combined scope).
      .filter((c) => (c.scopes ?? '').includes('webmasters'))
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
            <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">G</div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Google Search Console</h1>
              <p className="text-sm text-gray-500">Connect a property for this client</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
            {ERROR_COPY[error] ?? error}
          </div>
        )}

        {/* Reuse existing agency Google identities — no re-auth */}
        {identities.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Use a connected Google account
            </p>
            <div className="space-y-2">
              {identities.map((id) => (
                <a
                  key={id.id}
                  href={`/api/platform/integrations/gsc/reuse?credId=${id.id}`}
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

        <ConnectGscButton label={identities.length > 0 ? 'Connect a different Google account' : 'Connect with Google'} />

        <p className="mt-4 text-xs text-gray-400 text-center">
          Read-only access. Credentials are encrypted at rest and reused across this agency&apos;s clients.
        </p>
      </div>
    </main>
  )
}
