'use client'

// Per-client QBO Customer mapping (Phase 4 Sprint 1). Shown in the client card.
// Maps client_profiles.qbo_customer_id → a QBO Customer; every financial query
// for the client filters by it.
//
// Search is SERVER-SIDE (QBO can have thousands of customers — client-side
// filtering of a truncated page would miss matches). Opening auto-searches the
// client's name to surface the likely match; the mapped name is resolved by id.

import { useState, useEffect, useCallback, useRef } from 'react'

interface Customer { id: string; name: string }

export function QboMappingRow({
  clientId,
  clientName,
  initialCustomerId,
}: {
  clientId: number
  clientName: string
  initialCustomerId: string | null
}) {
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId)
  const [mappedName, setMappedName] = useState<string | null>(null)
  const [results, setResults] = useState<Customer[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCustomers = useCallback(async (params: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/platform/integrations/qbo/customers?${params}`)
      const data = await res.json() as { customers?: Customer[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Failed to load QBO customers')
      return data.customers ?? []
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load'); return []
    } finally { setLoading(false) }
  }, [])

  // Resolve the mapped customer's name by id (one cheap lookup).
  useEffect(() => {
    if (!customerId) { setMappedName(null); return }
    let live = true
    fetchCustomers(`id=${encodeURIComponent(customerId)}`).then((cs) => { if (live) setMappedName(cs[0]?.name ?? null) })
    return () => { live = false }
  }, [customerId, fetchCustomers])

  // Debounced server-side search while open.
  useEffect(() => {
    if (!open) return
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      const term = search.trim()
      const cs = await fetchCustomers(term ? `q=${encodeURIComponent(term)}` : '')
      setResults(cs)
    }, 300)
    return () => { if (debRef.current) clearTimeout(debRef.current) }
  }, [search, open, fetchCustomers])

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) setSearch(clientName)  // auto-suggest the matching customer
  }

  async function pick(c: Customer) {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, qbo_customer_id: c.id }),
      })
      if (!res.ok) throw new Error('Failed to save mapping')
      setCustomerId(c.id); setMappedName(c.name); setOpen(false); setSearch('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  async function unmap() {
    setSaving(true)
    try {
      await fetch('/api/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: clientId, qbo_customer_id: null }) })
      setCustomerId(null); setMappedName(null)
    } finally { setSaving(false) }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-text-dim uppercase tracking-wider">QuickBooks Customer</span>
        {customerId ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-[13px] text-text">{mappedName ?? 'Mapped'}</span>
            <button onClick={toggleOpen} className="text-[12px] text-accent-text">change</button>
            <button onClick={unmap} disabled={saving} className="text-[12px] text-text-dim hover:text-red-400">unmap</button>
          </span>
        ) : (
          <button onClick={toggleOpen} className="text-[13px] text-accent-text font-medium">Set up mapping →</button>
        )}
      </div>

      {error && <p className="text-[12px] text-red-500 mt-1">{error}</p>}

      {open && (
        <div className="mt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search QBO customers…"
            className="w-full glass-input text-[13px] px-3 py-2 rounded-md mb-2"
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {loading ? (
              <p className="text-[13px] text-text-dim px-1 py-2">Searching…</p>
            ) : results.length === 0 ? (
              <p className="text-[13px] text-text-dim px-1 py-2">No matching customers — try a different term.</p>
            ) : (
              results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pick(c)}
                  disabled={saving}
                  className={`w-full text-left text-[13px] px-3 py-2 rounded-md hover:bg-hover transition-colors ${c.id === customerId ? 'bg-accent/10 text-accent-text' : 'text-text'}`}
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
