'use client'

// GravityFormsSelectForm — Step 2 of 2 for Gravity Forms connect.
//
// Multi-select forms picker. Selecting no forms is valid (sums all forms).
// On submit: POST /api/platform/integrations/gravity_forms/finalize
// On success: redirect to /platform/dashboard?connected=gravity_forms

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface GravityForm {
  id: string
  title: string
}

interface GravityFormsSelectFormProps {
  forms: GravityForm[]
}

export function GravityFormsSelectForm({ forms }: GravityFormsSelectFormProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = forms.filter((f) =>
    f.title.toLowerCase().includes(search.toLowerCase())
  )

  function toggleForm(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === forms.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(forms.map((f) => f.id)))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formIds = Array.from(selectedIds)
    const selectedForms = forms.filter((f) => selectedIds.has(f.id))

    try {
      const res = await fetch('/api/platform/integrations/gravity_forms/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formIds,
          formNames: selectedForms.map((f) => f.title),
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        throw new Error(data.error || 'Finalize failed')
      }
      router.push('/platform/dashboard?connected=gravity_forms')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setLoading(false)
    }
  }

  const allSelected = forms.length > 0 && selectedIds.size === forms.length

  return (
    <form onSubmit={handleSubmit}>
      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-700 font-bold text-xs flex-shrink-0">
          GF
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Gravity Forms</h1>
          <p className="text-sm text-gray-500">Step 2 of 2 — Select forms</p>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-5 leading-relaxed">
        Choose which forms to track. Selecting none will sum entries across all forms.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Selection summary + toggle all */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">
          {selectedIds.size === 0
            ? 'No forms selected (all forms)'
            : `${selectedIds.size} of ${forms.length} selected`}
        </span>
        {forms.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-orange-600 hover:text-orange-700 font-medium transition-colors"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search forms..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        />
      </div>

      {/* Forms list */}
      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto mb-5">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400 text-center">
            {forms.length === 0
              ? 'No forms found. Create a form in Gravity Forms first.'
              : 'No forms match your search.'}
          </div>
        ) : (
          filtered.map((form) => {
            const isSelected = selectedIds.has(form.id)
            return (
              <label
                key={form.id}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-50 last:border-0 transition-colors ${
                  isSelected ? 'bg-orange-50' : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleForm(form.id)}
                  className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                />
                <span className="text-sm text-gray-900">{form.title}</span>
              </label>
            )
          })
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Connecting...
          </>
        ) : selectedIds.size === 0 ? (
          'Connect (all forms)'
        ) : (
          `Connect ${selectedIds.size} form${selectedIds.size !== 1 ? 's' : ''}`
        )}
      </button>
    </form>
  )
}
