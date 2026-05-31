'use client'

// /pipeline — Kanban deal board.
// Columns = stages from selected pipeline.
// Cards = opportunities grouped by stage name.
// Drag-and-drop via HTML5 drag API → PATCH stage.
// "+ New deal" per column, card click → detail modal (Won/Lost/edit/delete).
// Pipeline switcher persisted in localStorage.

import { useState, useEffect, useCallback, useRef } from 'react'
import { ActivityTimeline } from '@/components/crm/ActivityTimeline'

interface Pipeline {
  id: number
  name: string
  stages: Stage[]
}

interface Stage {
  id: number
  name: string
  color: string
  position: number
}

interface Opportunity {
  id: number
  public_id: string
  name: string
  value: number | null
  stage: string | null
  status: string
  close_date: string | null
  probability: number | null
  notes: string | null
  source: string | null
  contact_id: number | null
  contact_name?: string | null
  company_id: number | null
  company_name?: string | null
  pipeline_id: number | null
  created_at: number
}

interface Contact {
  id: number
  name: string
}

interface Company {
  id: number
  name: string
}

const fmtCurrency = (v: number | null | undefined) =>
  v != null ? `$${v.toLocaleString()}` : ''

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<number | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pipeline-selected-id')
      if (saved) return Number(saved)
    }
    return null
  })
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loadingPipelines, setLoadingPipelines] = useState(true)
  const [loadingOpps, setLoadingOpps] = useState(false)

  // New deal modal
  const [newDealStage, setNewDealStage] = useState<string | null>(null)
  const [dealForm, setDealForm] = useState<Partial<Opportunity & { contact_name_input: string; company_name_input: string }>>({})
  const [contacts, setContacts] = useState<Contact[]>([])
  const [companiesList, setCompaniesList] = useState<Company[]>([])
  const [savingDeal, setSavingDeal] = useState(false)
  const [dealError, setDealError] = useState<string | null>(null)

  // Detail modal
  const [detailOpp, setDetailOpp] = useState<Opportunity | null>(null)
  const [detailForm, setDetailForm] = useState<Partial<Opportunity>>({})
  const [editingDetail, setEditingDetail] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)
  const [detailTab, setDetailTab] = useState<'info' | 'activity'>('info')

  // Drag state
  const dragOppId = useRef<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  const activePipeline = pipelines.find(p => p.id === selectedPipelineId)

  // Load pipelines
  useEffect(() => {
    setLoadingPipelines(true)
    fetch('/api/crm/pipelines')
      .then(r => r.json())
      .then((d: { pipelines?: Pipeline[] }) => {
        const pl = d.pipelines ?? []
        setPipelines(pl)
        setSelectedPipelineId(prev => {
          if (prev && pl.find(p => p.id === prev)) return prev
          const first = pl[0]?.id ?? null
          if (first && typeof window !== 'undefined') localStorage.setItem('pipeline-selected-id', String(first))
          return first
        })
      })
      .finally(() => setLoadingPipelines(false))
  }, [])

  // Load opportunities for selected pipeline
  const loadOpps = useCallback(async (pipelineId: number) => {
    setLoadingOpps(true)
    try {
      const res = await fetch(`/api/crm/opportunities?pipeline_id=${pipelineId}`)
      const d = await res.json() as { opportunities?: Opportunity[] }
      setOpportunities(d.opportunities ?? [])
    } finally {
      setLoadingOpps(false)
    }
  }, [])

  useEffect(() => {
    if (selectedPipelineId) loadOpps(selectedPipelineId)
  }, [selectedPipelineId, loadOpps])

  // Load contacts + companies for pickers (fire once)
  useEffect(() => {
    fetch('/api/crm/contacts').then(r => r.json()).then((d: { contacts?: Contact[] }) => setContacts(d.contacts ?? [])).catch(() => {})
    fetch('/api/crm/companies').then(r => r.json()).then((d: { companies?: Company[] }) => setCompaniesList(d.companies ?? [])).catch(() => {})
  }, [])

  function switchPipeline(id: number) {
    setSelectedPipelineId(id)
    localStorage.setItem('pipeline-selected-id', String(id))
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function onDragStart(e: React.DragEvent, oppId: number) {
    dragOppId.current = oppId
    setDraggingId(oppId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragEnd() {
    dragOppId.current = null
    setDraggingId(null)
    setDragOverStage(null)
  }

  function onDragOver(e: React.DragEvent, stageName: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stageName)
  }

  function onDragLeave() {
    setDragOverStage(null)
  }

  async function onDrop(e: React.DragEvent, stageName: string) {
    e.preventDefault()
    setDragOverStage(null)
    const id = dragOppId.current
    if (!id) return
    const opp = opportunities.find(o => o.id === id)
    if (!opp || opp.stage === stageName) return

    // Optimistic update
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, stage: stageName } : o))

    try {
      await fetch(`/api/crm/opportunities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stageName }),
      })
    } catch {
      // Revert on failure
      setOpportunities(prev => prev.map(o => o.id === id ? { ...o, stage: opp.stage } : o))
    }
  }

  // ── Create deal ────────────────────────────────────────────────────────────
  async function createDeal() {
    if (!dealForm.name?.trim() || !newDealStage || !selectedPipelineId) return
    setSavingDeal(true)
    setDealError(null)
    try {
      const payload: Record<string, unknown> = {
        name: dealForm.name.trim(),
        stage: newDealStage,
        pipeline_id: selectedPipelineId,
      }
      if (dealForm.value) payload.value = Number(dealForm.value)
      if (dealForm.contact_id) payload.contact_id = dealForm.contact_id
      if (dealForm.company_id) payload.company_id = dealForm.company_id
      if (dealForm.close_date) payload.close_date = dealForm.close_date
      if (dealForm.notes) payload.notes = dealForm.notes

      const res = await fetch('/api/crm/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({})) as { opportunity?: Opportunity; error?: string }
      if (!res.ok || !d.opportunity) {
        // Surface the server's reason so saves stop failing silently
        setDealError(d.error || `Save failed (HTTP ${res.status})`)
        return
      }
      setOpportunities(prev => [d.opportunity!, ...prev])
      setNewDealStage(null)
      setDealForm({})
    } catch (err) {
      setDealError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSavingDeal(false)
    }
  }

  // ── Won / Lost ─────────────────────────────────────────────────────────────
  async function setStatus(id: number, status: 'won' | 'lost' | 'open') {
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, status } : o))
    await fetch(`/api/crm/opportunities/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (detailOpp?.id === id) setDetailOpp(prev => prev ? { ...prev, status } : prev)
  }

  // ── Save detail edit ───────────────────────────────────────────────────────
  async function saveDetail() {
    if (!detailOpp) return
    setSavingDetail(true)
    try {
      const res = await fetch(`/api/crm/opportunities/${detailOpp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detailForm),
      })
      const d = await res.json() as { opportunity?: Opportunity }
      if (d.opportunity) {
        setDetailOpp(d.opportunity)
        setOpportunities(prev => prev.map(o => o.id === d.opportunity!.id ? d.opportunity! : o))
        setEditingDetail(false)
      }
    } finally {
      setSavingDetail(false)
    }
  }

  async function deleteOpp(id: number) {
    if (!confirm('Delete this deal?')) return
    await fetch(`/api/crm/opportunities/${id}`, { method: 'DELETE' })
    setOpportunities(prev => prev.filter(o => o.id !== id))
    setDetailOpp(null)
  }

  // ── Group opps by stage ────────────────────────────────────────────────────
  const oppsByStage = (stageName: string) =>
    opportunities.filter(o => o.stage === stageName && o.status === 'open')

  const stageTotal = (stageName: string) => {
    const opps = oppsByStage(stageName)
    return opps.reduce((s, o) => s + (o.value ?? 0), 0)
  }

  if (loadingPipelines) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p style={{ color: 'var(--text-dim)' }}>Loading pipeline…</p>
      </main>
    )
  }

  if (pipelines.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <p style={{ color: 'var(--text-dim)' }}>No pipelines found. Try refreshing — the backend auto-seeds one.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-xl font-semibold shrink-0" style={{ color: 'var(--text)' }}>Pipeline</h1>

        {/* Pipeline switcher */}
        <div className="flex items-center gap-1">
          {pipelines.map(p => (
            <button
              key={p.id}
              onClick={() => switchPipeline(p.id)}
              className="text-sm px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: selectedPipelineId === p.id ? 'var(--accent-dim)' : 'transparent',
                color: selectedPipelineId === p.id ? 'var(--text)' : 'var(--text-dim)',
                border: selectedPipelineId === p.id ? '1px solid var(--accent)' : '1px solid transparent',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {loadingOpps && <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Refreshing…</span>}
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {opportunities.filter(o => o.status === 'open').length} open deals
          </span>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-6 h-full" style={{ minHeight: 'calc(100vh - 73px)' }}>
          {(activePipeline?.stages ?? [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .map(stage => {
              const stageOpps = oppsByStage(stage.name)
              const total = stageTotal(stage.name)
              const isOver = dragOverStage === stage.name

              return (
                <div
                  key={stage.id}
                  className="flex flex-col rounded-xl shrink-0 transition-colors"
                  style={{
                    width: 280,
                    background: isOver ? 'var(--bg-elevated, var(--bg))' : 'var(--bg-subtle, rgba(255,255,255,0.03))',
                    border: isOver ? '1px solid var(--accent)' : '1px solid var(--border)',
                  }}
                  onDragOver={(e) => onDragOver(e, stage.name)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, stage.name)}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-3 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: stage.color || 'var(--accent)' }}
                      />
                      <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{stage.name}</span>
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'var(--border)', color: 'var(--text-dim)' }}
                      >
                        {stageOpps.length}
                      </span>
                    </div>
                    {total > 0 && (
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>
                        {fmtCurrency(total)}
                      </span>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                    {stageOpps.length === 0 && !isOver && (
                      <p className="text-[12px] text-center py-4" style={{ color: 'var(--text-dim)' }}>
                        Drop a deal here
                      </p>
                    )}
                    {stageOpps.map(opp => (
                      <DealCard
                        key={opp.id}
                        opp={opp}
                        dragging={draggingId === opp.id}
                        onDragStart={(e) => onDragStart(e, opp.id)}
                        onDragEnd={onDragEnd}
                        onClick={() => {
                          setDetailOpp(opp)
                          setDetailForm({
                            name: opp.name,
                            value: opp.value,
                            stage: opp.stage,
                            close_date: opp.close_date,
                            probability: opp.probability,
                            notes: opp.notes,
                          })
                          setEditingDetail(false)
                          setDetailTab('info')
                        }}
                      />
                    ))}
                  </div>

                  {/* New deal button */}
                  <div className="p-2 border-t" style={{ borderColor: 'var(--border)' }}>
                    <button
                      onClick={() => { setNewDealStage(stage.name); setDealForm({}) }}
                      className="w-full text-xs py-1.5 rounded-md transition-colors"
                      style={{ color: 'var(--text-dim)', border: '1px dashed var(--border)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-text)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                    >
                      + New deal
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* ── New Deal Modal ─────────────────────────────────────────────────── */}
      {newDealStage && (
        <Modal title={`New deal — ${newDealStage}`} onClose={() => { setNewDealStage(null); setDealForm({}); setDealError(null) }}>
          <div className="space-y-3">
            <FormField label="Deal Name *">
              <input
                autoFocus
                value={dealForm.name || ''}
                onChange={e => setDealForm(f => ({ ...f, name: e.target.value }))}
                className="glass-input w-full text-sm px-3 py-2 rounded-md"
                placeholder="e.g. Website Redesign"
              />
            </FormField>
            <FormField label="Value ($)">
              <input
                type="number"
                value={dealForm.value ?? ''}
                onChange={e => setDealForm(f => ({ ...f, value: e.target.value ? Number(e.target.value) : null }))}
                className="glass-input w-full text-sm px-3 py-2 rounded-md"
                placeholder="0"
              />
            </FormField>
            <FormField label="Contact *">
              <select
                value={dealForm.contact_id ?? ''}
                onChange={e => setDealForm(f => ({ ...f, contact_id: e.target.value ? Number(e.target.value) : null }))}
                className="glass-input w-full text-sm px-3 py-2 rounded-md"
              >
                <option value="">— Select a contact —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {contacts.length === 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                  No contacts yet — add one in <a href="/contacts" style={{ color: 'var(--accent)' }}>Contacts</a> first.
                </p>
              )}
            </FormField>
            <FormField label="Company">
              <select
                value={dealForm.company_id ?? ''}
                onChange={e => setDealForm(f => ({ ...f, company_id: e.target.value ? Number(e.target.value) : null }))}
                className="glass-input w-full text-sm px-3 py-2 rounded-md"
              >
                <option value="">— None —</option>
                {companiesList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Close Date">
              <input
                type="date"
                value={dealForm.close_date || ''}
                onChange={e => setDealForm(f => ({ ...f, close_date: e.target.value || null }))}
                className="glass-input w-full text-sm px-3 py-2 rounded-md"
              />
            </FormField>
            <FormField label="Notes">
              <textarea
                value={dealForm.notes || ''}
                onChange={e => setDealForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="glass-input w-full text-sm px-3 py-2 rounded-md resize-none"
              />
            </FormField>
          </div>
          {dealError && (
            <div
              className="mt-4 text-xs px-3 py-2 rounded-md"
              style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red, #f87171)', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              {dealError}
            </div>
          )}
          <div className="flex gap-2 mt-5">
            <button
              onClick={createDeal}
              disabled={savingDeal || !dealForm.name?.trim() || !dealForm.contact_id}
              className="flex-1 text-sm font-medium text-white px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {savingDeal ? 'Creating…' : 'Create deal'}
            </button>
            <button
              onClick={() => { setNewDealStage(null); setDealForm({}); setDealError(null) }}
              className="text-sm px-3 py-2 rounded-lg"
              style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* ── Deal Detail Modal ──────────────────────────────────────────────── */}
      {detailOpp && (
        <Modal
          title={editingDetail ? 'Edit deal' : detailOpp.name}
          onClose={() => { setDetailOpp(null); setEditingDetail(false) }}
          wide
        >
          {/* Status badges */}
          {!editingDetail && (
            <div className="flex items-center gap-2 mb-4">
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{
                  background: detailOpp.status === 'won'
                    ? 'rgba(34,197,94,0.15)'
                    : detailOpp.status === 'lost'
                      ? 'rgba(239,68,68,0.15)'
                      : 'var(--accent-dim)',
                  color: detailOpp.status === 'won'
                    ? '#22c55e'
                    : detailOpp.status === 'lost'
                      ? '#ef4444'
                      : 'var(--accent-text)',
                }}
              >
                {detailOpp.status.toUpperCase()}
              </span>
              {detailOpp.stage && (
                <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--border)', color: 'var(--text-dim)' }}>
                  {detailOpp.stage}
                </span>
              )}
              {detailOpp.value && (
                <span className="text-xs font-semibold ml-auto" style={{ color: 'var(--text)' }}>{fmtCurrency(detailOpp.value)}</span>
              )}
            </div>
          )}

          {/* Tab strip */}
          {!editingDetail && (
            <div className="flex border-b mb-4 -mx-6 px-6" style={{ borderColor: 'var(--border)' }}>
              {(['info', 'activity'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setDetailTab(t)}
                  className="text-xs px-3 py-2 capitalize"
                  style={{
                    borderBottom: detailTab === t ? '2px solid var(--accent)' : '2px solid transparent',
                    color: detailTab === t ? 'var(--text)' : 'var(--text-dim)',
                    fontWeight: detailTab === t ? 600 : 400,
                    marginBottom: -1,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {editingDetail ? (
            <div className="space-y-3">
              <FormField label="Deal Name *">
                <input
                  autoFocus
                  value={detailForm.name || ''}
                  onChange={e => setDetailForm(f => ({ ...f, name: e.target.value }))}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md"
                />
              </FormField>
              <FormField label="Value ($)">
                <input
                  type="number"
                  value={detailForm.value ?? ''}
                  onChange={e => setDetailForm(f => ({ ...f, value: e.target.value ? Number(e.target.value) : null }))}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md"
                />
              </FormField>
              <FormField label="Close Date">
                <input
                  type="date"
                  value={detailForm.close_date || ''}
                  onChange={e => setDetailForm(f => ({ ...f, close_date: e.target.value || null }))}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md"
                />
              </FormField>
              <FormField label="Probability (%)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={detailForm.probability ?? ''}
                  onChange={e => setDetailForm(f => ({ ...f, probability: e.target.value ? Number(e.target.value) : null }))}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md"
                />
              </FormField>
              <FormField label="Notes">
                <textarea
                  value={detailForm.notes || ''}
                  onChange={e => setDetailForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md resize-y"
                />
              </FormField>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={saveDetail}
                  disabled={savingDetail || !detailForm.name?.trim()}
                  className="flex-1 text-sm font-medium text-white px-3 py-2 rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {savingDetail ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingDetail(false)}
                  className="text-sm px-3 py-2 rounded-lg"
                  style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {detailTab === 'info' && (
                <div>
                  <dl className="space-y-2.5 text-sm mb-5">
                    {(
                      [
                        ['Contact', detailOpp.contact_name],
                        ['Company', detailOpp.company_name],
                        ['Close Date', fmtDate(detailOpp.close_date)],
                        ['Probability', detailOpp.probability != null ? `${detailOpp.probability}%` : null],
                        ['Source', detailOpp.source],
                      ] as [string, string | null | undefined][]
                    ).map(([k, v]) => (
                      <div key={k} className="flex gap-3">
                        <dt className="w-24 text-[12px] uppercase tracking-wide shrink-0" style={{ color: 'var(--text-dim)' }}>{k}</dt>
                        <dd style={{ color: 'var(--text)' }}>{v || '—'}</dd>
                      </div>
                    ))}
                    {detailOpp.notes && (
                      <div>
                        <dt className="text-[12px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Notes</dt>
                        <dd className="whitespace-pre-wrap text-sm" style={{ color: 'var(--text)' }}>{detailOpp.notes}</dd>
                      </div>
                    )}
                  </dl>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    {detailOpp.status !== 'won' && (
                      <button
                        onClick={() => setStatus(detailOpp.id, 'won')}
                        className="text-sm font-semibold px-3 py-2 rounded-lg"
                        style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                      >
                        Mark Won
                      </button>
                    )}
                    {detailOpp.status !== 'lost' && (
                      <button
                        onClick={() => setStatus(detailOpp.id, 'lost')}
                        className="text-sm font-semibold px-3 py-2 rounded-lg"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                      >
                        Mark Lost
                      </button>
                    )}
                    {detailOpp.status !== 'open' && (
                      <button
                        onClick={() => setStatus(detailOpp.id, 'open')}
                        className="text-sm px-3 py-2 rounded-lg"
                        style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      onClick={() => setEditingDetail(true)}
                      className="text-sm px-3 py-2 rounded-lg"
                      style={{ background: 'var(--accent)', color: 'white' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteOpp(detailOpp.id)}
                      className="text-sm px-3 py-2 rounded-lg ml-auto"
                      style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {detailTab === 'activity' && (
                <ActivityTimeline opportunityId={detailOpp.id} />
              )}
            </>
          )}
        </Modal>
      )}
    </main>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DealCard({
  opp, dragging, onDragStart, onDragEnd, onClick,
}: {
  opp: Opportunity
  dragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onClick: () => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="rounded-lg p-3 cursor-pointer transition-all select-none"
      style={{
        background: 'var(--bg-elevated, var(--bg))',
        border: '1px solid var(--border)',
        opacity: dragging ? 0.4 : 1,
        transform: dragging ? 'scale(0.97)' : 'none',
      }}
    >
      <p className="text-[13px] font-medium leading-snug mb-1.5" style={{ color: 'var(--text)' }}>{opp.name}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {opp.value && (
          <span className="text-[12px] font-semibold" style={{ color: 'var(--accent-text)' }}>{fmtCurrency(opp.value)}</span>
        )}
        {opp.contact_name && (
          <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{opp.contact_name}</span>
        )}
        {opp.company_name && !opp.contact_name && (
          <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{opp.company_name}</span>
        )}
        {opp.close_date && (
          <span className="text-[11px] ml-auto" style={{ color: 'var(--text-dim)' }}>
            {fmtDate(opp.close_date)}
          </span>
        )}
      </div>
    </div>
  )
}

function Modal({
  title, children, onClose, wide,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-xl p-6 w-full overflow-y-auto max-h-[90vh]"
        style={{
          background: 'var(--bg-elevated, var(--bg))',
          border: '1px solid var(--border)',
          maxWidth: wide ? 540 : 420,
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
          <button onClick={onClose} style={{ color: 'var(--text-dim)' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>{label}</label>
      {children}
    </div>
  )
}
