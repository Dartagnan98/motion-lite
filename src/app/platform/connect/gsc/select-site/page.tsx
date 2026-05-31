// /platform/connect/gsc/select-site (server component)
//
// After the GSC OAuth callback, fetch the FULL verified-site list server-side
// using the access token stashed in the signed pending cookie, then hand it to
// the client picker. Fetching here (not passing sites through the URL) removes
// the old ~50-property cap + truncation that hid properties like
// kelownadentistry.com, and lets the picker offer search.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { listSites, getValidAccessTokenForCredential } from '@/lib/platform/integrations/gsc/oauth'
import type { CallbackState } from '@/lib/platform/integrations/gsc/connect-flow'
import { GscSitePicker, type SiteChoice } from './GscSitePicker'

interface PendingPayload extends CallbackState {
  // Fresh OAuth carries the access token; reuse carries a shared credential id.
  exchange_access_token?: string
  tenant_credential_id?: number
}

function ExpiredCard({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">No Sites Found</h1>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <Link
          href="/platform/connect/gsc"
          className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
        >
          Start over
        </Link>
      </div>
    </main>
  )
}

export default async function GscSelectSitePage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('gsc_pending_connect')?.value
  if (!pending) {
    return <ExpiredCard message="Your session expired. Please reconnect from the beginning." />
  }

  const payload = verifyState<PendingPayload>(pending)
  if (!payload || payload.provider !== 'gsc') {
    return <ExpiredCard message="Invalid session. Please reconnect from the beginning." />
  }

  // Resolve the access token: fresh OAuth carries it inline; reuse resolves it
  // from the shared tenant credential (refreshing if expired).
  let accessToken: string | null = null
  try {
    accessToken = payload.tenant_credential_id
      ? await getValidAccessTokenForCredential(payload.tenant_credential_id)
      : (payload.exchange_access_token ?? null)
  } catch {
    accessToken = null
  }
  if (!accessToken) {
    return <ExpiredCard message="Couldn't resolve the Google credential. Please reconnect from the beginning." />
  }

  let sites: SiteChoice[] = []
  try {
    const resp = await listSites(accessToken)
    sites = (resp.siteEntry || [])
      .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
      .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
      .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl))
  } catch {
    return <ExpiredCard message="Couldn't load your verified properties from Google. Please reconnect." />
  }

  if (sites.length === 0) {
    return <ExpiredCard message="No verified GSC properties were returned for this Google account." />
  }

  return <GscSitePicker sites={sites} />
}
