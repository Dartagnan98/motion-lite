// /platform/connect/asana/select-scope  (Step 2 of 3)
//
// Server component. Reads asana_pending_connect cookie, verifies the signed
// state (step must be 'scope'), then calls listPortfolios() and
// listProjectsInWorkspace() in parallel server-side.
// Renders <AsanaSelectScopeForm> with both lists.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { listPortfolios, listProjectsInWorkspace } from '@/lib/platform/integrations/asana/oauth'
import { AsanaSelectScopeForm } from './AsanaSelectScopeForm'
import type { AsanaPortfolio, AsanaProject } from '@/lib/platform/integrations/asana/oauth'

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
  step: string
  workspaceId: string
  workspaceDisplayName: string
}

export default async function AsanaSelectScopePage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('asana_pending_connect')?.value

  let portfolios: AsanaPortfolio[] = []
  let projects: AsanaProject[] = []
  let workspaceName = ''
  let fatalError: string | null = null

  if (!pending) {
    fatalError = 'session_expired'
  } else {
    const payload = verifyState<PendingPayload>(pending)
    if (!payload || payload.provider !== 'asana' || payload.step !== 'scope') {
      fatalError = 'session_invalid'
    } else {
      workspaceName = payload.workspaceDisplayName || payload.workspaceId

      try {
        // Fetch portfolios and projects in parallel.
        const [p, proj] = await Promise.all([
          listPortfolios({
            accessToken: payload.exchange_access_token,
            workspaceGid: payload.workspaceId,
          }),
          listProjectsInWorkspace({
            accessToken: payload.exchange_access_token,
            workspaceGid: payload.workspaceId,
          }),
        ])
        portfolios = p
        projects = proj
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        fatalError = `list_scope_failed: ${message}`
      }
    }
  }

  if (fatalError) {
    const isSession =
      fatalError === 'session_expired' || fatalError === 'session_invalid'
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            {isSession ? 'Session Expired' : 'Could Not Load Scope Options'}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {isSession
              ? 'Your Asana connect session expired or is invalid. Please start over.'
              : `Failed to load portfolios and projects. ${fatalError}`}
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
        <AsanaSelectScopeForm
          portfolios={portfolios}
          projects={projects}
          workspaceName={workspaceName}
        />
      </div>
    </main>
  )
}
