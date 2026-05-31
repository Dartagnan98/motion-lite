// /platform/connect/gsc/success
//
// Post-callback success page. Shown after the OAuth flow completes and the
// first snapshot has been fired. PM sees confirmation + link to the report.

import Link from 'next/link'

interface PageProps {
  searchParams: Promise<{ accountId?: string; integrationId?: string }>
}

export default async function GscSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams
  const accountId = params.accountId
  const integrationId = params.integrationId

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
        {/* Success icon */}
        <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-gray-900 mb-2">GSC Connected</h1>
        <p className="text-sm text-gray-600 mb-6">
          Google Search Console is connected. We imported the last 30 days of
          search data. Your first Search Performance report is ready to view.
        </p>

        {integrationId && (
          <p className="text-xs text-gray-400 mb-6">
            Integration ID: {integrationId}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {accountId ? (
            <Link
              href={`/platform/reports?accountId=${accountId}`}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm inline-flex items-center justify-center"
            >
              View Search Performance Report
            </Link>
          ) : null}
          <Link
            href="/platform/dashboard"
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 px-4 rounded-lg transition-colors text-sm inline-flex items-center justify-center"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
