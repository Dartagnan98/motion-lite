// /platform/connect/ga4/select-property
//
// Server component: reads the ga4_pending_connect cookie set by the callback,
// verifies the signed state, extracts the access token, and calls
// listProperties() server-side. Renders the picker client component with the
// resulting list. No properties in URL (avoids HTTP 431 header overflow).

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { listProperties, getValidAccessTokenForCredential } from '@/lib/platform/integrations/ga4/oauth'
import { Ga4SelectPropertyForm } from './Ga4SelectPropertyForm'

interface PendingPayload {
  provider: 'ga4'
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  // Fresh OAuth carries the token; reuse carries a shared credential id.
  exchange_access_token?: string
  exchange_refresh_token?: string
  exchange_expires_in?: number
  exchange_email?: string | null
  exchange_scopes?: string[]
  tenant_credential_id?: number
}

export default async function Ga4SelectPropertyPage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('ga4_pending_connect')?.value

  let properties: { propertyId: string; displayName: string; accountDisplayName: string }[] = []
  let fatalError: string | null = null

  if (!pending) {
    fatalError = 'session_expired'
  } else {
    const payload = verifyState<PendingPayload>(pending)
    if (!payload || payload.provider !== 'ga4') {
      fatalError = 'session_invalid'
    } else {
      try {
        // Resolve the access token: reuse → shared credential (refresh if
        // needed); fresh OAuth → inline exchange token.
        const accessToken = payload.tenant_credential_id
          ? await getValidAccessTokenForCredential(payload.tenant_credential_id)
          : payload.exchange_access_token
        if (!accessToken) throw new Error('no access token in session')
        const raw = await listProperties(accessToken)
        properties = [...raw].sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        fatalError = `list_properties_failed: ${message}`
      }
    }
  }

  if (fatalError || properties.length === 0) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Session Expired'
              : 'No Properties Found'}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Your GA4 connect session expired. Please start over.'
              : fatalError
              ? `Could not list GA4 properties. ${fatalError}`
              : 'No GA4 properties were returned from Google.'}
          </p>
          <Link
            href="/platform/connect/ga4"
            className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
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
        <Ga4SelectPropertyForm properties={properties} />
      </div>
    </main>
  )
}
