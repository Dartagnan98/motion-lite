// /platform/connect/gravity_forms/select-forms  (Step 2 of 2)
//
// Server component. Reads gravity_forms_pending_connect cookie, verifies
// the signed state, parses the form list cached in the cookie payload,
// and renders the multi-select form picker.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { GravityFormsSelectForm, type GravityForm } from './GravityFormsSelectForm'

interface PendingPayload {
  provider: string
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  siteUrl: string
  username: string
  appPassword: string
  forms: string  // JSON-encoded GravityForm[]
  step: string
}

export default async function GravityFormsSelectFormsPage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('gravity_forms_pending_connect')?.value

  let forms: GravityForm[] = []
  let fatalError: string | null = null

  if (!pending) {
    fatalError = 'session_expired'
  } else {
    const payload = verifyState<PendingPayload>(pending)
    if (!payload || payload.provider !== 'gravity_forms' || payload.step !== 'forms') {
      fatalError = 'session_invalid'
    } else {
      try {
        forms = JSON.parse(payload.forms) as GravityForm[]
      } catch {
        fatalError = 'forms_parse_error'
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
              : 'Could Not Load Forms'}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Your Gravity Forms connect session expired. Please start over.'
              : 'Failed to parse the forms list. Please start over.'}
          </p>
          <Link
            href="/platform/connect/gravity_forms"
            className="inline-flex items-center justify-center bg-orange-600 hover:bg-orange-700 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
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
        <Link
          href="/platform/connect/gravity_forms"
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <GravityFormsSelectForm forms={forms} />
      </div>
    </main>
  )
}
