'use client'

// AccountSwitcher — client component.
//
// Renders a dropdown showing the active account name. Click any account in the
// list to POST to the activate route, then router.refresh() so server components
// re-render with the new active account cookie.
//
// Hidden entirely when accounts.length <= 1 (single-client tenants).

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AccountForSwitcher } from '@/lib/platform/tenant'

interface AccountSwitcherProps {
  accounts: AccountForSwitcher[]
}

export function AccountSwitcher({ accounts }: AccountSwitcherProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Hidden for single-account tenants.
  if (accounts.length <= 1) return null

  const active = accounts.find((a) => a.isActive) ?? accounts[0]

  async function activate(accountId: number) {
    if (loading !== null) return
    setLoading(accountId)
    setError(null)
    try {
      const res = await fetch(`/api/platform/accounts/${accountId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? 'Failed to switch account')
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate max-w-[160px]">{active?.name ?? 'Select client'}</span>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
          <div className="py-1" role="listbox">
            {accounts.map((account) => (
              <button
                key={account.id}
                role="option"
                aria-selected={account.isActive}
                disabled={loading !== null}
                onClick={() => { if (!account.isActive) activate(account.id) }}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-3 transition-colors ${
                  account.isActive
                    ? 'bg-blue-50 text-blue-700 font-medium cursor-default'
                    : 'text-gray-700 hover:bg-gray-50 cursor-pointer'
                } ${loading === account.id ? 'opacity-50' : ''}`}
              >
                <span className="truncate">{account.name}</span>
                {account.isActive && (
                  <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {loading === account.id && (
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {error && (
            <div className="px-4 py-2 border-t border-gray-100">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <div className="border-t border-gray-100 py-1">
            <a
              href="/clients/new"
              className="block px-4 py-2.5 text-sm text-blue-600 hover:bg-blue-50 transition-colors font-medium"
            >
              + Add new client
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
