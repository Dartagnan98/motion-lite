// /platform/reports
//
// Reports index for the current tenant. When ?accountId is in the query,
// shows that account's reports; otherwise redirects to dashboard.
// Auto-seeds a Search Performance report if none exist for the account.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import {
  ensureTenantForWorkspace,
  getCurrentWorkspaceId,
  getCurrentAccountId,
  assertTenantOwnsRow,
} from '@/lib/platform/tenant'
import {
  listReportsForAccount,
  seedSearchPerformanceReport,
  findGscIntegration,
} from '@/lib/platform/reports'

interface PageProps {
  searchParams: Promise<{ accountId?: string }>
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const { accountId: accountIdStr } = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) redirect('/login')
  const tenant = ensureTenantForWorkspace(workspaceId)

  // Prefer explicit ?accountId param (from dashboard "View Report" link), then
  // fall back to the signed cookie / first-account fallback.
  let accountId: number | null = null
  if (accountIdStr) {
    const parsed = parseInt(accountIdStr, 10)
    if (!isNaN(parsed) && parsed > 0) {
      // Validate tenant ownership before trusting the URL param.
      try {
        assertTenantOwnsRow(tenant, 'client_profiles', parsed)
        accountId = parsed
      } catch {
        // Invalid / cross-tenant param — fall through to cookie fallback.
      }
    }
  }
  if (!accountId) {
    accountId = await getCurrentAccountId(tenant.id)
  }
  if (!accountId) {
    redirect('/platform/clients/new')
  }

  let reports = listReportsForAccount({ tenantId: tenant.id, accountId })

  // Auto-seed if no reports exist and there is a GSC integration.
  if (reports.length === 0) {
    const gscIntegration = findGscIntegration({ tenantId: tenant.id, accountId })
    if (gscIntegration) {
      const { reportId } = seedSearchPerformanceReport({
        tenantId: tenant.id,
        accountId,
        integrationId: gscIntegration.id,
        accountName: 'Client',
      })
      redirect(`/platform/reports/${reportId}`)
    }
  }

  // If exactly one report, go straight to it.
  if (reports.length === 1) {
    redirect(`/platform/reports/${reports[0].id}`)
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
          <Link
            href="/platform/dashboard"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Dashboard
          </Link>
        </div>

        {reports.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500 mb-4">
              No reports yet. Connect Google Search Console to generate your first report.
            </p>
            <Link
              href="/platform/connect"
              className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              Connect an Integration
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <Link
                key={report.id}
                href={`/platform/reports/${report.id}`}
                className="block bg-white rounded-lg border border-gray-200 hover:border-gray-300 p-5 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{report.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {report.period_start} to {report.period_end}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${
                    report.status === 'published'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {report.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
