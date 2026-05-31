// /platform/connect/everhour/select-projects  (Step 3 of 3)
//
// Server component. Reads everhour_pending_connect cookie, verifies state,
// calls listProjectsByClients() filtered to the chosen client IDs.
// All projects are pre-checked (PM unchecks to exclude).

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { listProjectsByClients } from '@/lib/platform/integrations/everhour/adapter'
import { EverhourSelectProjectsForm } from './EverhourSelectProjectsForm'
import type { EverhourPickerProject } from '@/lib/platform/integrations/everhour/adapter'

interface PendingPayload {
  provider: string
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  apiKey: string
  step: string
  clientIds: string[]
  clientNames: string[]
}

export default async function EverhourSelectProjectsPage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('everhour_pending_connect')?.value

  let projects: EverhourPickerProject[] = []
  let clientNames: string[] = []
  let fatalError: string | null = null

  if (!pending) {
    fatalError = 'session_expired'
  } else {
    const payload = verifyState<PendingPayload>(pending)
    if (!payload || payload.provider !== 'everhour' || payload.step !== 'projects') {
      fatalError = 'session_invalid'
    } else if (!Array.isArray(payload.clientIds) || payload.clientIds.length === 0) {
      fatalError = 'no_clients_selected'
    } else {
      clientNames = payload.clientNames ?? []
      try {
        projects = await listProjectsByClients({
          apiKey: payload.apiKey,
          clientIds: payload.clientIds,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        fatalError = `list_projects_failed: ${message}`
      }
    }
  }

  if (fatalError) {
    const isSession =
      fatalError === 'session_expired' || fatalError === 'session_invalid' || fatalError === 'no_clients_selected'
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            {isSession ? 'Session Expired' : 'Could Not Load Projects'}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {isSession
              ? 'Your Everhour connect session expired or is invalid. Please start over.'
              : `Failed to load Everhour projects. ${fatalError}`}
          </p>
          <Link
            href="/platform/connect/everhour"
            className="inline-flex items-center justify-center bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
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
        <EverhourSelectProjectsForm
          projects={projects}
          clientNames={clientNames}
        />
      </div>
    </main>
  )
}
