// /platform/connect/se_ranking/select-project  (Step 2 of 2)
//
// Server component. Reads se_ranking_pending_connect cookie, verifies the
// signed state, calls the SE Ranking API to list the user's projects,
// and renders the project picker. State is validated before the API call.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { verifyState } from '@/lib/platform/state'
import { SeRankingSelectProjectForm, type SeRankingProject } from './SeRankingSelectProjectForm'

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

// SE Ranking Project API. Must stay in sync with the adapter
// (`src/lib/platform/integrations/se_ranking/adapter.ts`).
const SE_RANKING_BASE = 'https://api.seranking.com'

async function fetchProjects(apiKey: string): Promise<SeRankingProject[]> {
  const res = await fetch(`${SE_RANKING_BASE}/v1/project-management/sites`, {
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`SE Ranking API error (${res.status}): ${text.slice(0, 200)}`)
  }
  // Each site is { id, title (project title), name (website URL), ... }.
  // The picker shows the project title; fall back to the URL or the bare id.
  const data = await res.json() as Array<{
    id?: number | string
    title?: string
    name?: string
  }>
  return data
    .map((item) => ({
      id: String(item.id ?? ''),
      name: item.title || item.name || String(item.id ?? ''),
    }))
    .filter((p) => p.id)
}

export default async function SeRankingSelectProjectPage() {
  const cookieStore = await cookies()
  const pending = cookieStore.get('se_ranking_pending_connect')?.value

  let projects: SeRankingProject[] = []
  let fatalError: string | null = null

  if (!pending) {
    fatalError = 'session_expired'
  } else {
    const payload = verifyState<PendingPayload>(pending)
    if (!payload || payload.provider !== 'se_ranking') {
      fatalError = 'session_invalid'
    } else {
      try {
        projects = await fetchProjects(payload.apiKey)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        fatalError = `list_projects_failed: ${message}`
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
              : 'Could Not Load Projects'}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {fatalError === 'session_expired' || fatalError === 'session_invalid'
              ? 'Your SE Ranking connect session expired or is invalid. Please start over.'
              : `Failed to load SE Ranking projects. ${fatalError}`}
          </p>
          <Link
            href="/platform/connect/se_ranking"
            className="inline-flex items-center justify-center bg-violet-600 hover:bg-violet-700 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
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
          href="/platform/connect/se_ranking"
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <SeRankingSelectProjectForm projects={projects} />
      </div>
    </main>
  )
}
