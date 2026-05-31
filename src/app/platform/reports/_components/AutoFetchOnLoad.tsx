'use client'

// Auto-fetch missing data when a report is first viewed for a period that has
// no snapshots yet (e.g. a freshly generated report whose "last 30 days" window
// drifted past the last fetch). Fetches ONLY the integrations the server flagged
// as missing, once, then refreshes. Guarded by sessionStorage so a persistent
// fetch failure can't loop — it falls back to a "use Refresh" hint.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export function AutoFetchOnLoad({
  integrationIds,
  periodStart,
  periodEnd,
  accountId,
  reportId,
}: {
  integrationIds: number[]
  periodStart: string
  periodEnd: string
  accountId: number
  reportId: number
}) {
  const router = useRouter()
  const [status, setStatus] = useState<'fetching' | 'failed'>('fetching')

  useEffect(() => {
    const key = `autofetch:${reportId}:${periodStart}:${periodEnd}`
    // Already attempted this report+period → don't loop; show the manual hint.
    if (sessionStorage.getItem(key)) { setStatus('failed'); return }
    sessionStorage.setItem(key, '1')

    // Compute the prior period — same-length window immediately before current.
    // Refetched alongside the current period so PoP deltas + the "Compared To"
    // caption have data without the user manually backfilling.
    const dayMs = 86_400_000
    const start = new Date(periodStart + 'T00:00:00')
    const end = new Date(periodEnd + 'T00:00:00')
    const lenDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1
    const priorEnd = new Date(start.getTime() - dayMs).toISOString().slice(0, 10)
    const priorStart = new Date(start.getTime() - dayMs - (lenDays - 1) * dayMs).toISOString().slice(0, 10)

    const post = (id: number, ps: string, pe: string) =>
      fetch(`/api/platform/integrations/${id}/refetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodStart: ps, periodEnd: pe, accountId }),
      })

    let live = true
    Promise.allSettled([
      ...integrationIds.map((id) => post(id, periodStart, periodEnd)),
      ...integrationIds.map((id) => post(id, priorStart, priorEnd)),
    ]).then(() => { if (live) router.refresh() })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-center gap-3">
      {status === 'fetching' ? (
        <>
          <span className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-blue-700">Preparing report — fetching the latest data for this period…</p>
        </>
      ) : (
        <p className="text-sm text-blue-700">
          Some data hasn&apos;t loaded for this period yet. Use <strong>Refresh data</strong> above to try again.
        </p>
      )}
    </div>
  )
}
