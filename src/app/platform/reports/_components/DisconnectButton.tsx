'use client'

// DisconnectButton — icon-only button on each dashboard health tile.
//
// Click → opens a confirm dialog. Confirm → DELETE /api/platform/integrations/[id]
// → router.refresh() so the dashboard re-renders without the deleted tile.
//
// Snapshots + oauth tokens cascade via FK; report blocks set integration_id=NULL
// so the section gracefully shows "no data" until re-linked.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DisconnectButtonProps {
  integrationId: number
  /** Shown in the confirm dialog: "Disconnect Google Search Console?" */
  providerLabel: string
}

export function DisconnectButton({ integrationId, providerLabel }: DisconnectButtonProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/platform/integrations/${integrationId}`, {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(body.error || 'Disconnect failed')
      }
      setConfirming(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        title={`Disconnect ${providerLabel}`}
        aria-label={`Disconnect ${providerLabel}`}
        className="w-6 h-6 inline-flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => { if (!busy) setConfirming(false) }}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-900 mb-2">Disconnect {providerLabel}?</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-5">
              This removes the integration, its stored credentials, and all snapshots.
              Report sections that reference it will show no data until you reconnect.
            </p>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 text-xs text-red-700">
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-medium px-4 py-2 rounded-md inline-flex items-center gap-2"
              >
                {busy && (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {busy ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
