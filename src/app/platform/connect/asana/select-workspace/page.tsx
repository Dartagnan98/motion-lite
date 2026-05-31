// /platform/connect/asana/select-workspace
//
// Server component: reads the asana_pending_connect cookie set by the callback,
// verifies the signed state, extracts the access token, and calls
// listWorkspaces() server-side. Renders the picker client component with the
// resulting list. No workspace IDs in URL (avoids HTTP header overflow and
// secret leakage). Mirrors /platform/connect/ga4/select-property/page.tsx exactly.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { listWorkspaces } from '@/lib/platform/integrations/asana/oauth'
import { AsanaSelectWorkspaceForm } from './AsanaSelectWorkspaceForm'

interface PendingPayload {
  provider: 'asana'
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  exchange_access_token: string
  exchange_refresh_token: string | null
  exchange_expires_in: number
  exchange_email: string | null
  exchange_scopes: string
}

export default async function AsanaSelectWorkspacePage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('asana_pending_connect')?.value

  let workspaces: { workspaceId: string; displayName: string }[] = []
  let fatalError: string | null = null

  if (!pending) {
    fatalError = 'session_expired'
  } else {
    const payload = verifyState<PendingPayload>(pending)
    if (!payload || payload.provider !== 'asana') {
      fatalError = 'session_invalid'
    } else {
      try {
        const raw = await listWorkspaces(payload.exchange_access_token)
        workspaces = [...raw].sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        fatalError = `list_workspaces_failed: ${message}`
      }
    }
  }

  if (fatalError || workspaces.length === 0) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Session Expired'
              : 'No Workspaces Found'}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Your Asana connect session expired. Please start over.'
              : fatalError
              ? `Could not list Asana workspaces. ${fatalError}`
              : 'No Asana workspaces were returned.'}
          </p>
          <Link
            href="/platform/connect/asana"
            className="inline-flex items-center justify-center bg-pink-600 hover:bg-pink-700 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
          >
            Start over
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 flex justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-lg p-8 self-start">
        <AsanaSelectWorkspaceForm workspaces={workspaces} />
      </div>
    </main>
  )
}
