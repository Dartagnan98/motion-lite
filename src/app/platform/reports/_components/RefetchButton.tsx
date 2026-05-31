'use client'

// RefetchButton — triggers a re-snapshot for one or more integrations.
//
// Used in two places:
//   1. Report page header: "Refresh data" — refetches all integrations
//      referenced by the report's blocks, then reloads the page.
//   2. Dashboard health tile: small icon — refetches a single integration,
//      optimistic status flicker (yellow during fetch).
//
// Slice A: when rendered inside a <SectionShell>, the button automatically
// flips the shell's `refreshing` state via SectionShellContext so the section
// fades + shows a loading overlay during the fetch. A 400ms minimum display
// duration prevents a jarring flicker on fast responses.
//
// Pattern: POST to /api/platform/integrations/[id]/refetch, then
// router.refresh() to let RSC re-render with fresh snapshot data.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSectionShell } from './SectionShell'

interface RefetchButtonProps {
  /** One or more integration IDs to refetch. Refetched sequentially. */
  integrationIds: number[]
  /** Button variant: 'header' (text + icon) or 'tile' (icon-only). */
  variant?: 'header' | 'tile'
  /** Optional label override for header variant. */
  label?: string
  /** Report's selected window — fetched instead of the default last-30-days. */
  periodStart?: string
  periodEnd?: string
  /** Report's client account — needed for tenant-level integrations (QBO). */
  accountId?: number
}

export function RefetchButton({
  integrationIds,
  variant = 'header',
  label = 'Refresh data',
  periodStart,
  periodEnd,
  accountId,
}: RefetchButtonProps) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Optional shell context — present when this button lives inside a SectionShell.
  const shell = useSectionShell()

  async function handleRefetch() {
    if (status === 'loading') return
    setStatus('loading')
    setErrorMsg(null)

    // Flip shell overlay on (if inside a SectionShell).
    if (shell) shell.setRefreshing(true)

    try {
      // Refetch each integration sequentially so errors are isolatable.
      const payload: Record<string, unknown> = {}
      if (periodStart && periodEnd) { payload.periodStart = periodStart; payload.periodEnd = periodEnd }
      if (accountId) payload.accountId = accountId
      const periodBody = Object.keys(payload).length ? JSON.stringify(payload) : undefined

      const refetchAll = async () => {
        for (const id of integrationIds) {
          const res = await fetch(`/api/platform/integrations/${id}/refetch`, {
            method: 'POST',
            ...(periodBody
              ? { headers: { 'Content-Type': 'application/json' }, body: periodBody }
              : {}),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: string }
            throw new Error(body.error || `Refetch failed for integration ${id}`)
          }
        }
      }

      // Enforce a 400ms minimum display so the overlay never flickers on fast
      // responses. The router.refresh() call is chained AFTER both settle.
      await Promise.all([
        refetchAll(),
        new Promise<void>((r) => setTimeout(r, 400)),
      ])

      setStatus('done')
      // Refresh RSC tree so updated snapshot data renders.
      router.refresh()
      // Reset to idle after a short pause.
      setTimeout(() => setStatus('idle'), 2000)
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : 'Refetch failed')
      setTimeout(() => {
        setStatus('idle')
        setErrorMsg(null)
      }, 4000)
    } finally {
      // Shell overlay off — always, regardless of success/error.
      if (shell) shell.setRefreshing(false)
    }
  }

  if (variant === 'tile') {
    // Icon-only refresh button for dashboard health tiles
    return (
      <button
        onClick={handleRefetch}
        disabled={status === 'loading'}
        title={status === 'error' ? (errorMsg ?? 'Refetch failed') : 'Refresh data'}
        className={`
          w-7 h-7 rounded-md flex items-center justify-center transition-colors
          ${status === 'loading' ? 'text-amber-500 bg-amber-50' : ''}
          ${status === 'done' ? 'text-green-600 bg-green-50' : ''}
          ${status === 'error' ? 'text-red-500 bg-red-50' : ''}
          ${status === 'idle' ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100' : ''}
        `.trim()}
        aria-label="Refresh integration data"
      >
        <svg
          className={`w-3.5 h-3.5 ${status === 'loading' ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    )
  }

  // Header variant: text + icon
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRefetch}
        disabled={status === 'loading'}
        className={`
          text-xs font-medium border px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5
          ${status === 'loading' ? 'text-amber-600 border-amber-200 bg-amber-50' : ''}
          ${status === 'done' ? 'text-green-600 border-green-200 bg-green-50' : ''}
          ${status === 'error' ? 'text-red-600 border-red-200 bg-red-50' : ''}
          ${status === 'idle' ? 'text-gray-600 hover:text-gray-900 border-gray-200 hover:border-gray-300' : ''}
        `.trim()}
      >
        <svg
          className={`w-3.5 h-3.5 ${status === 'loading' ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {status === 'loading' ? 'Refreshing...' : status === 'done' ? 'Updated' : label}
      </button>
      {status === 'error' && errorMsg && (
        <span className="text-xs text-red-500 max-w-xs truncate">{errorMsg}</span>
      )}
    </div>
  )
}
