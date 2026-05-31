'use client'

// CloneTemplateButton — opens a small modal to pick a source account, then
// calls POST /api/platform/accounts/[id]/clone-template.
// On success: redirects to the newly created report.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  destAccountId: number
  sourceAccounts: { id: number; name: string }[]
}

export function CloneTemplateButton({ destAccountId, sourceAccounts }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(
    sourceAccounts[0]?.id ?? null
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClone() {
    if (!selectedSourceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/platform/accounts/${destAccountId}/clone-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceAccountId: selectedSourceId }),
      })
      const data = await res.json() as { reportId?: number; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Clone failed')
        return
      }
      setOpen(false)
      if (data.reportId) {
        router.push(`/platform/reports/${data.reportId}`)
      } else {
        router.refresh()
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg px-4 py-2 transition-colors"
      >
        Clone report structure
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Clone report structure</h2>
            <p className="text-sm text-gray-500 mb-4">
              Copy section and block layout from an existing client. Their integrations are
              not copied — you&apos;ll connect this client&apos;s own.
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Source client
            </label>
            <select
              value={selectedSourceId ?? ''}
              onChange={(e) => setSelectedSourceId(Number(e.target.value))}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 bg-white"
              disabled={loading}
            >
              {sourceAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null) }}
                disabled={loading}
                className="flex-1 text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg py-2.5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClone}
                disabled={loading || !selectedSourceId}
                className="flex-1 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg py-2.5 transition-colors inline-flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Cloning...
                  </>
                ) : (
                  'Clone'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
