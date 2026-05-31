// /platform/connect/everhour/select-clients  (Step 2 of 3)
//
// Server component. Reads everhour_pending_connect cookie, verifies the signed
// state, calls listClients() server-side, and renders the client picker.
// No data in URL params — avoids header overflow with large client lists.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { listClients } from '@/lib/platform/integrations/everhour/adapter'
import { EverhourSelectClientsForm } from './EverhourSelectClientsForm'
import type { EverhourClient } from '@/lib/platform/integrations/everhour/adapter'

interface PendingPayload {
  provider: string
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  apiKey: string
  step: string
}

export default async function EverhourSelectClientsPage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('everhour_pending_connect')?.value

  let clients: EverhourClient[] = []
  let fatalError: string | null = null

  if (!pending) {
    fatalError = 'session_expired'
  } else {
    const payload = verifyState<PendingPayload>(pending)
    if (!payload || payload.provider !== 'everhour') {
      fatalError = 'session_invalid'
    } else {
      try {
        clients = await listClients(payload.apiKey)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        fatalError = `list_clients_failed: ${message}`
      }
    }
  }

  if (fatalError) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Session Expired'
              : 'Could Not Load Clients'}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Your Everhour connect session expired or is invalid. Please start over.'
              : `Failed to load Everhour clients. ${fatalError}`}
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
        <EverhourSelectClientsForm clients={clients} />
      </div>
    </main>
  )
}
