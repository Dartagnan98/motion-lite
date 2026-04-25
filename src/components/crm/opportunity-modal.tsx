'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CrmContactRecord,
  CrmCustomFieldDefinitionRecord,
  CrmPipeline,
  CrmPipelineStage,
} from '@/lib/db'
import { crmFetch } from '@/lib/crm-browser'

type TeamUser = { id: number; name: string; email: string; role: string }
type Status = 'open' | 'won' | 'lost' | 'abandoned'

const MONO = 'var(--font-mono)'

/**
 * OpportunityModal — "create deal" surface.
 *
 *   Flat single-panel composition. No nested cards, no section boxes, no fake
 *   preview header. Hierarchy is carried by typography and field grouping.
 *   Inputs recess into `--bg-field` so the surface reads as an instrument, not
 *   a form. Sticky header + footer keep the primary action always in view.
 *
 *   Sections are mono labels, not borders. Status is a 4-button segmented
 *   control inline with the rest of the fields. Lost / abandoned reveal a
 *   reason field via `grid-template-rows` transition — zero layout shift.
 */
export function OpportunityModal({
  contacts,
  stages,
  pipelines,
  initialPipelineId,
  onClose,
  onCreated,
  initialContactId,
  initialStage,
  contactLocked = false,
}: {
  contacts: CrmContactRecord[]
  stages: CrmPipelineStage[]
  pipelines?: CrmPipeline[]
  initialPipelineId?: number | null
  onClose: () => void
  onCreated: () => Promise<void>
  initialContactId?: number | null
  initialStage?: string | null
  contactLocked?: boolean
}) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [value, setValue] = useState('0')
  const [probability, setProbability] = useState('20')
  const [closeDate, setCloseDate] = useState('')
  const [pipelineId, setPipelineId] = useState<number | null>(initialPipelineId ?? null)
  const [pipelineStages, setPipelineStages] = useState<CrmPipelineStage[]>(stages)
  const [stage, setStage] = useState(initialStage || stages[0]?.name || 'Prospect')

  const [contactId, setContactId] = useState<number | ''>(initialContactId || '')
  const [contactSearch, setContactSearch] = useState('')
  const [selectedContactName, setSelectedContactName] = useState('')
  const [contactResults, setContactResults] = useState<CrmContactRecord[]>([])
  const [contactLoading, setContactLoading] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const contactSearchRef = useRef<HTMLDivElement | null>(null)

  const [source, setSource] = useState('')
  const [sourceSuggestions, setSourceSuggestions] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [customFields, setCustomFields] = useState<CrmCustomFieldDefinitionRecord[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [customOpen, setCustomOpen] = useState(false)

  const [ownerId, setOwnerId] = useState<number | ''>('')
  const [team, setTeam] = useState<TeamUser[]>([])
  const [status, setStatus] = useState<Status>('open')
  const [statusOverridden, setStatusOverridden] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [fields, users, recent] = await Promise.all([
          crmFetch<CrmCustomFieldDefinitionRecord[]>('/api/crm/custom-fields?entity=opportunity').catch(() => []),
          crmFetch<TeamUser[]>('/api/crm/users').catch(() => []),
          crmFetch<{ source: string | null }[]>('/api/crm/opportunities?status=all&limit=50').catch(() => []),
        ])
        if (!active) return
        setCustomFields(fields)
        setTeam(users)
        const seen = new Set<string>()
        const list: string[] = []
        for (const row of recent) {
          const s = (row.source || '').trim()
          if (!s || seen.has(s.toLowerCase())) continue
          seen.add(s.toLowerCase())
          list.push(s)
          if (list.length >= 12) break
        }
        setSourceSuggestions(list)
      } catch { /* best effort */ }
    })()
    return () => { active = false }
  }, [])

  // ── Seed contact from prop ────────────────────────────────────────────────
  useEffect(() => {
    const nextId = initialContactId || ''
    setContactId(nextId)
    if (!nextId) {
      setSelectedContactName('')
      setContactSearch('')
      return
    }
    const existing = contacts.find((c) => c.id === nextId)
    if (existing) {
      setSelectedContactName(existing.name)
      setContactSearch(existing.name)
    }
  }, [contacts, initialContactId])

  // ── Seed stage / pipeline ─────────────────────────────────────────────────
  useEffect(() => { if (initialStage) setStage(initialStage) }, [initialStage])
  useEffect(() => { setPipelineStages(stages) }, [stages])
  useEffect(() => {
    setStage((current) => {
      if (initialStage && pipelineStages.some((s) => s.name === initialStage)) return initialStage
      return pipelineStages.some((s) => s.name === current) ? current : (pipelineStages[0]?.name || 'Prospect')
    })
  }, [initialStage, pipelineStages])

  useEffect(() => {
    if (!pipelineId) return
    if (pipelineId === initialPipelineId && stages.length > 0) {
      setPipelineStages(stages)
      return
    }
    let active = true
    void (async () => {
      try {
        const fetched = await crmFetch<CrmPipelineStage[]>(`/api/crm/pipeline-stages?pipeline_id=${pipelineId}`)
        if (!active) return
        setPipelineStages(fetched)
      } catch {
        if (!active) return
        setPipelineStages([])
      }
    })()
    return () => { active = false }
  }, [pipelineId, initialPipelineId, stages])

  // ── Contact search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (contactLocked) return
    const query = contactSearch.trim()
    if (query.length < 2) {
      setContactResults([])
      setContactOpen(false)
      setContactLoading(false)
      return
    }
    if (contactId && selectedContactName && query.toLowerCase() === selectedContactName.toLowerCase()) {
      setContactResults([])
      setContactOpen(false)
      setContactLoading(false)
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      setContactLoading(true)
      try {
        const found = await crmFetch<CrmContactRecord[]>(`/api/crm/contacts?search=${encodeURIComponent(query)}&limit=20`)
        if (!active) return
        setContactResults(found.slice(0, 12))
        setContactOpen(true)
      } catch {
        if (!active) return
        setContactResults([])
        setContactOpen(true)
      } finally {
        if (active) setContactLoading(false)
      }
    }, 180)
    return () => { active = false; clearTimeout(timer) }
  }, [contactId, contactLocked, contactSearch, selectedContactName])

  useEffect(() => {
    if (contactLocked) return
    function onPointerDown(event: MouseEvent) {
      if (!contactSearchRef.current) return
      if (contactSearchRef.current.contains(event.target as Node)) return
      setContactOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [contactLocked])

  // ── Escape to close ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Infer status from stage name (override wins) ──────────────────────────
  const inferredStatus = useMemo<Status>(() => {
    const s = (stage || '').toLowerCase()
    if (s.includes('won') || s.includes('closed won')) return 'won'
    if (s.includes('lost') || s.includes('closed lost')) return 'lost'
    if (s.includes('abandon')) return 'abandoned'
    return 'open'
  }, [stage])
  useEffect(() => { if (!statusOverridden) setStatus(inferredStatus) }, [inferredStatus, statusOverridden])

  // ── Handlers ──────────────────────────────────────────────────────────────
  function selectContact(c: CrmContactRecord) {
    setContactId(c.id)
    setSelectedContactName(c.name)
    setContactSearch(c.name)
    setContactOpen(false)
    setContactResults([])
  }

  function addTag() {
    const t = tagDraft.trim()
    if (!t) return
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) { setTagDraft(''); return }
    setTags((prev) => [...prev, t])
    setTagDraft('')
  }

  function removeTag(t: string) { setTags((prev) => prev.filter((x) => x !== t)) }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!contactId || !name.trim()) return
    setSaving(true)
    try {
      const created = await crmFetch<{ id: number }>('/api/crm/opportunities', {
        method: 'POST',
        body: JSON.stringify({
          contact_id: contactId,
          name: name.trim(),
          value: Math.round(Number(value || '0') * 100),
          stage,
          close_date: closeDate || null,
          probability: Number(probability || '0'),
          status,
          source: source.trim() || null,
          owner_id: ownerId === '' ? null : ownerId,
          lost_reason: (status === 'lost' || status === 'abandoned') && lostReason.trim() ? lostReason.trim() : null,
          notes: notes.trim() || null,
          custom_fields: Object.keys(customValues).length ? customValues : undefined,
        }),
      })
      if (created?.id && tags.length > 0) {
        await Promise.allSettled(
          tags.map((t) =>
            crmFetch(`/api/crm/opportunities/${created.id}/tags`, {
              method: 'POST',
              body: JSON.stringify({ tag: t }),
            }),
          ),
        )
      }
      await onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create opportunity')
    } finally {
      setSaving(false)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const canSubmit = Boolean(contactId) && name.trim().length > 0 && !saving
  const showReason = status === 'lost' || status === 'abandoned'
  const showPipelinePicker = Boolean(pipelines && pipelines.length > 1)
  const hintText =
    !contactId ? 'Pick a contact to continue' :
    !name.trim() ? 'Name the deal' :
    saving ? 'Saving…' :
    'Ready to save'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="opp-scrim"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create opportunity"
        className="opp-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header ───────────────────────────────────────────────────────── */}
        <header className="opp-head">
          <div className="opp-head-text">
            <div className="opp-eyebrow" style={{ fontFamily: MONO }}>New opportunity</div>
            <h2 className="opp-title">Create deal</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="opp-close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Body ─────────────────────────────────────────────────────────── */}
        <form onSubmit={submit} className="opp-body-wrap">
          <div className="opp-body">

            {/* ── Deal ─────────────────────────────────────────────────── */}
            <Legend>Deal</Legend>

            <Field label="Deal name" required full>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme — Q3 retainer"
                className="opp-input opp-input-hero"
                autoFocus
              />
            </Field>

            <div className="opp-grid">
              <Field label="Value (USD)">
                <div className="opp-prefix-wrap">
                  <span className="opp-prefix" style={{ fontFamily: MONO }}>$</span>
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    className="opp-input opp-input-prefixed"
                  />
                </div>
              </Field>
              <Field label="Probability">
                <div className="opp-suffix-wrap">
                  <input
                    value={probability}
                    onChange={(e) => setProbability(e.target.value)}
                    type="number"
                    min="0"
                    max="100"
                    className="opp-input opp-input-suffixed"
                  />
                  <span className="opp-suffix" style={{ fontFamily: MONO }}>%</span>
                </div>
              </Field>
            </div>

            <div className="opp-grid">
              {showPipelinePicker ? (
                <Field label="Pipeline">
                  <select
                    value={pipelineId ?? ''}
                    onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : null)}
                    className="opp-input opp-select"
                  >
                    {pipelines!.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Stage" full={!showPipelinePicker}>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="opp-input opp-select"
                >
                  {(pipelineStages.length
                    ? pipelineStages
                    : [{ id: 0, name: 'Prospect', color: 'var(--accent)', position: 0, workspace_id: 0 } as CrmPipelineStage]
                  ).map((s) => (
                    <option key={s.id || s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Close date">
                <input
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  type="date"
                  className="opp-input"
                />
              </Field>
            </div>

            {/* ── Context ──────────────────────────────────────────────── */}
            <Legend>Context</Legend>

            <Field label="Contact" required full>
              {contactLocked ? (
                <div className="opp-locked">
                  <span className="opp-dot" aria-hidden />
                  <span>{contacts.find((c) => c.id === contactId)?.name || 'Selected contact'}</span>
                </div>
              ) : (
                <div ref={contactSearchRef} className="opp-contact">
                  <input
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value)
                      setContactId('')
                      setSelectedContactName('')
                    }}
                    onFocus={() => { if (contactResults.length > 0) setContactOpen(true) }}
                    placeholder="Search by name, email, or phone…"
                    className="opp-input"
                  />
                  {contactId && selectedContactName ? (
                    <div className="opp-contact-selected">
                      <span className="opp-dot" aria-hidden />
                      <span className="opp-contact-name">{selectedContactName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setContactId('')
                          setSelectedContactName('')
                          setContactSearch('')
                          setContactResults([])
                          setContactOpen(false)
                        }}
                        className="opp-contact-clear"
                        style={{ fontFamily: MONO }}
                      >
                        Clear
                      </button>
                    </div>
                  ) : null}
                  {contactOpen ? (
                    <div className="opp-popover">
                      {contactLoading ? (
                        <div className="opp-popover-empty">Searching…</div>
                      ) : contactResults.length === 0 ? (
                        <div className="opp-popover-empty">No matches</div>
                      ) : (
                        contactResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={(ev) => { ev.preventDefault(); selectContact(c) }}
                            className="opp-popover-row"
                          >
                            <span className="opp-popover-name">{c.name}</span>
                            <span className="opp-popover-sub">
                              {c.email || c.phone || c.company || 'No email/phone'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </Field>

            <div className="opp-grid">
              <Field label="Source">
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  list="opp-source-suggest"
                  placeholder="Referral, Meta Ads, cold outreach…"
                  className="opp-input"
                />
                <datalist id="opp-source-suggest">
                  {sourceSuggestions.map((s) => (<option key={s} value={s} />))}
                </datalist>
              </Field>
              <Field label="Owner">
                <select
                  value={ownerId === '' ? '' : String(ownerId)}
                  onChange={(e) => setOwnerId(e.target.value ? Number(e.target.value) : '')}
                  className="opp-input opp-select"
                >
                  <option value="">Unassigned</option>
                  {team.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Tags" full>
              <div className="opp-tags">
                {tags.map((t) => (
                  <span key={t} className="opp-tag" style={{ fontFamily: MONO }}>
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      aria-label={`Remove ${t}`}
                      className="opp-tag-x"
                    >×</button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
                    else if (e.key === 'Backspace' && !tagDraft && tags.length > 0) { removeTag(tags[tags.length - 1]) }
                  }}
                  placeholder={tags.length === 0 ? 'Add a tag, press enter' : ''}
                  className="opp-tag-input"
                />
              </div>
            </Field>

            {/* ── Outcome ──────────────────────────────────────────────── */}
            <Legend>Outcome</Legend>

            <Field label="Status" full>
              <div className="opp-status" style={{ fontFamily: MONO }}>
                {(['open', 'won', 'lost', 'abandoned'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setStatusOverridden(true); setStatus(key) }}
                    className="opp-status-btn"
                    data-active={status === key}
                    data-tone={key}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </Field>

            {/* Reason — grid-template-rows transition prevents layout shift */}
            <div className="opp-reason" data-open={showReason}>
              <div className="opp-reason-inner">
                <Field label={status === 'lost' ? 'Lost reason' : 'Abandon note'} full>
                  <textarea
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    rows={2}
                    placeholder={
                      status === 'lost'
                        ? 'Price, timing, competitor, fit…'
                        : 'Went cold, bad fit, postponed…'
                    }
                    className="opp-input opp-textarea"
                  />
                </Field>
              </div>
            </div>

            <Field label="Notes" full>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Background, next steps, anything worth remembering."
                className="opp-input opp-textarea"
              />
            </Field>

            {/* ── Custom fields (collapsed) ────────────────────────────── */}
            {customFields.length > 0 ? (
              <div className="opp-custom">
                <button
                  type="button"
                  onClick={() => setCustomOpen((p) => !p)}
                  className="opp-custom-toggle"
                  style={{ fontFamily: MONO }}
                  aria-expanded={customOpen}
                >
                  <span>Custom fields · {customFields.length}</span>
                  <span aria-hidden>{customOpen ? '−' : '+'}</span>
                </button>
                <div className="opp-custom-body" data-open={customOpen}>
                  <div className="opp-custom-inner opp-grid">
                    {[...customFields].sort((a, b) => a.position - b.position).map((f) => (
                      <Field key={f.field_key} label={f.label} required={Boolean(f.is_required_bool)}>
                        {f.field_type === 'select' ? (
                          <select
                            value={customValues[f.field_key] ?? ''}
                            onChange={(e) => setCustomValues((p) => ({ ...p, [f.field_key]: e.target.value }))}
                            className="opp-input opp-select"
                          >
                            <option value="">—</option>
                            {f.options_list.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                            value={customValues[f.field_key] ?? ''}
                            onChange={(e) => setCustomValues((p) => ({ ...p, [f.field_key]: e.target.value }))}
                            className="opp-input"
                          />
                        )}
                      </Field>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="opp-error" role="alert">{error}</div>
            ) : null}
          </div>

          {/* Footer ─────────────────────────────────────────────────────── */}
          <footer className="opp-foot">
            <div className="opp-foot-hint" style={{ fontFamily: MONO }} data-ready={canSubmit}>
              {hintText}
            </div>
            <div className="opp-foot-actions">
              <button
                type="button"
                onClick={onClose}
                className="opp-btn-ghost"
                style={{ fontFamily: MONO }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="opp-btn-primary"
                style={{ fontFamily: MONO }}
              >
                {saving ? (
                  <>
                    <span className="opp-spin" aria-hidden />
                    Saving
                  </>
                ) : (
                  <>Create deal</>
                )}
              </button>
            </div>
          </footer>
        </form>
      </div>

      <style jsx>{`
        .opp-scrim {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: clamp(16px, 5vh, 64px) 16px;
          background: color-mix(in oklab, black 55%, transparent);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          overflow-y: auto;
          animation: opp-fade 140ms ease-out;
        }

        .opp-panel {
          width: 100%;
          max-width: 560px;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow:
            0 1px 0 rgba(255, 245, 225, 0.04) inset,
            0 28px 64px rgba(0, 0, 0, 0.55);
          display: flex;
          flex-direction: column;
          max-height: calc(100vh - 48px);
          animation: opp-rise 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        @keyframes opp-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes opp-rise {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .opp-scrim, .opp-panel { animation: none; }
        }

        /* Header ──────────────────────────────────────────────────────── */
        .opp-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
          padding: 18px 22px 14px;
          border-bottom: 1px solid var(--border);
        }
        .opp-head-text { min-width: 0; }
        .opp-eyebrow {
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--accent-text);
        }
        .opp-title {
          margin: 6px 0 0;
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.005em;
          color: var(--text);
        }
        .opp-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-dim);
          cursor: pointer;
          transition: background 100ms, color 100ms;
        }
        .opp-close:hover { background: var(--bg-hover); color: var(--text); }

        /* Body ────────────────────────────────────────────────────────── */
        .opp-body-wrap { display: flex; flex-direction: column; min-height: 0; }
        .opp-body {
          padding: 18px 22px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow-y: auto;
        }

        /* Section legend — thin mono label, no line. Space carries the break. */
        :global(.opp-legend) {
          font-family: ${MONO};
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--text-muted);
          padding-top: 6px;
        }
        :global(.opp-legend:first-child) { padding-top: 0; }

        /* Field ───────────────────────────────────────────────────────── */
        :global(.opp-field) {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        :global(.opp-field-full) { grid-column: 1 / -1; }
        :global(.opp-label) {
          font-family: ${MONO};
          font-size: 9.5px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        :global(.opp-label-req) {
          color: var(--accent-text);
          margin-left: 4px;
        }

        /* Two-column compact grid — inputs pack tight like an instrument. */
        .opp-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        /* Inputs — recessed into --bg-field */
        :global(.opp-input) {
          width: 100%;
          background: var(--bg-field);
          border: 1px solid var(--border-field);
          border-radius: 7px;
          padding: 7px 10px;
          font-family: var(--font-sans, inherit);
          font-size: 12.5px;
          color: var(--text);
          outline: none;
          transition: border-color 120ms, box-shadow 120ms, background 120ms;
        }
        :global(.opp-input::placeholder) { color: var(--text-placeholder); }
        :global(.opp-input:hover) { border-color: var(--border-strong); }
        :global(.opp-input:focus),
        :global(.opp-input:focus-visible) {
          border-color: color-mix(in oklab, var(--accent) 55%, var(--border-field));
          box-shadow: 0 0 0 3px var(--accent-glow);
        }
        :global(.opp-input-hero) {
          font-size: 13.5px;
          padding: 9px 11px;
        }
        :global(.opp-select) {
          appearance: none;
          background-image:
            linear-gradient(45deg, transparent 50%, var(--text-dim) 50%),
            linear-gradient(135deg, var(--text-dim) 50%, transparent 50%);
          background-position:
            calc(100% - 14px) 50%,
            calc(100% - 9px) 50%;
          background-size: 5px 5px, 5px 5px;
          background-repeat: no-repeat;
          padding-right: 28px;
        }
        :global(.opp-textarea) {
          resize: vertical;
          line-height: 1.45;
          min-height: 52px;
          font-family: var(--font-sans, inherit);
        }

        /* Prefix / suffix wrappers for $ and % */
        .opp-prefix-wrap, .opp-suffix-wrap { position: relative; }
        .opp-prefix, .opp-suffix {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11.5px;
          color: var(--text-muted);
          pointer-events: none;
        }
        .opp-prefix { left: 10px; }
        .opp-suffix { right: 10px; }
        :global(.opp-input-prefixed) { padding-left: 20px; }
        :global(.opp-input-suffixed) { padding-right: 24px; }

        /* Locked contact (from contact-detail page) */
        .opp-locked {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          background: var(--bg-field);
          border: 1px solid var(--border-field);
          border-radius: 7px;
          color: var(--text);
          font-size: 12.5px;
        }
        .opp-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--accent);
        }

        /* Contact search */
        .opp-contact { position: relative; }
        .opp-contact-selected {
          margin-top: 6px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px 6px 10px;
          background: var(--accent-dim);
          border: 1px solid color-mix(in oklab, var(--accent) 35%, transparent);
          border-radius: 8px;
          color: var(--accent-text);
          font-size: 12.5px;
        }
        .opp-contact-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .opp-contact-clear {
          margin-left: auto;
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
          background: transparent;
          color: var(--accent-text);
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .opp-contact-clear:hover { background: color-mix(in oklab, var(--accent) 12%, transparent); }

        .opp-popover {
          position: absolute;
          z-index: 5;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          max-height: 240px;
          overflow-y: auto;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 4px;
          box-shadow: 0 16px 40px rgba(0,0,0,0.4);
        }
        .opp-popover-empty {
          padding: 10px 10px;
          font-size: 12.5px;
          color: var(--text-muted);
        }
        .opp-popover-row {
          display: block;
          width: 100%;
          text-align: left;
          padding: 8px 10px;
          border-radius: 6px;
          background: transparent;
          border: 0;
          color: inherit;
          cursor: pointer;
        }
        .opp-popover-row:hover { background: var(--bg-hover); }
        .opp-popover-name { display: block; color: var(--text); font-size: 13px; }
        .opp-popover-sub { display: block; color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }

        /* Tags */
        .opp-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 10px;
          min-height: 40px;
          background: var(--bg-field);
          border: 1px solid var(--border-field);
          border-radius: 8px;
          transition: border-color 120ms, box-shadow 120ms;
        }
        .opp-tags:focus-within {
          border-color: color-mix(in oklab, var(--accent) 55%, var(--border-field));
          box-shadow: 0 0 0 3px var(--accent-glow);
        }
        .opp-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 6px 3px 8px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 10.5px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .opp-tag-x {
          background: transparent;
          border: 0;
          color: var(--text-muted);
          cursor: pointer;
          padding: 0 2px;
          line-height: 1;
          font-size: 13px;
        }
        .opp-tag-x:hover { color: var(--text); }
        .opp-tag-input {
          flex: 1;
          min-width: 110px;
          background: transparent;
          border: 0;
          outline: none;
          color: var(--text);
          font-size: 12.5px;
          padding: 2px 4px;
          font-family: var(--font-sans, inherit);
        }
        .opp-tag-input::placeholder { color: var(--text-placeholder); }

        /* Status segmented control */
        .opp-status {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0;
          background: var(--bg-field);
          border: 1px solid var(--border-field);
          border-radius: 8px;
          padding: 3px;
        }
        .opp-status-btn {
          background: transparent;
          border: 0;
          padding: 8px 6px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--text-dim);
          transition: background 120ms, color 120ms, box-shadow 120ms;
        }
        .opp-status-btn:hover { color: var(--text-secondary); }
        .opp-status-btn[data-active="true"] {
          background: var(--bg-surface);
          box-shadow: 0 1px 0 rgba(255,245,225,0.05) inset, 0 1px 2px rgba(0,0,0,0.2);
        }
        .opp-status-btn[data-active="true"][data-tone="open"]      { color: var(--text); }
        .opp-status-btn[data-active="true"][data-tone="won"]       { color: var(--status-completed); }
        .opp-status-btn[data-active="true"][data-tone="lost"]      { color: var(--status-overdue); }
        .opp-status-btn[data-active="true"][data-tone="abandoned"] { color: var(--text-secondary); }

        /* Reason — grid-template-rows transition */
        .opp-reason {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 200ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .opp-reason[data-open="true"] { grid-template-rows: 1fr; }
        .opp-reason-inner {
          min-height: 0;
          overflow: hidden;
        }
        .opp-reason[data-open="true"] .opp-reason-inner { padding-top: 2px; }

        /* Custom fields collapsible */
        .opp-custom { margin-top: 2px; }
        .opp-custom-toggle {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg-field);
          border: 1px solid var(--border-field);
          border-radius: 8px;
          color: var(--text-dim);
          font-size: 9.5px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          cursor: pointer;
          transition: color 120ms, border-color 120ms;
        }
        .opp-custom-toggle:hover { color: var(--text-secondary); border-color: var(--border-strong); }
        .opp-custom-body {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .opp-custom-body[data-open="true"] { grid-template-rows: 1fr; }
        .opp-custom-inner { min-height: 0; overflow: hidden; }
        .opp-custom-body[data-open="true"] .opp-custom-inner { padding-top: 12px; }

        .opp-error {
          padding: 10px 12px;
          background: color-mix(in oklab, var(--status-overdue) 12%, transparent);
          border: 1px solid color-mix(in oklab, var(--status-overdue) 45%, transparent);
          border-radius: 8px;
          color: var(--status-overdue);
          font-size: 12.5px;
        }

        /* Footer ─────────────────────────────────────────────────────── */
        .opp-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 18px 12px 22px;
          border-top: 1px solid var(--border);
          background: color-mix(in oklab, var(--bg-panel) 88%, black);
        }
        .opp-foot-hint {
          font-size: 9.5px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-muted);
          transition: color 120ms;
        }
        .opp-foot-hint[data-ready="true"] { color: var(--accent-text); }
        .opp-foot-actions { display: flex; gap: 8px; }

        .opp-btn-ghost {
          padding: 8px 14px;
          border-radius: 8px;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 11px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 100ms, color 100ms;
        }
        .opp-btn-ghost:hover { background: var(--bg-hover); color: var(--text); }

        .opp-btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 8px;
          background: var(--accent);
          color: var(--accent-fg);
          border: 0;
          font-size: 11px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-weight: 500;
          cursor: pointer;
          transition: background 100ms, opacity 100ms;
        }
        .opp-btn-primary:hover { background: var(--accent-hover); }
        .opp-btn-primary:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
        .opp-spin {
          width: 11px;
          height: 11px;
          border-radius: 999px;
          border: 1.5px solid color-mix(in oklab, var(--accent-fg) 35%, transparent);
          border-top-color: var(--accent-fg);
          animation: opp-spin 620ms linear infinite;
        }
        @keyframes opp-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .opp-spin { animation: none; } }

        /* Small screens: stack 2-col grids */
        @media (max-width: 480px) {
          .opp-grid { grid-template-columns: 1fr; }
          .opp-panel { max-height: calc(100vh - 32px); border-radius: 12px; }
          .opp-foot { padding: 12px 14px; }
          .opp-head { padding: 16px 18px 12px; }
          .opp-body { padding: 14px 18px 16px; }
        }
      `}</style>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Legend({ children }: { children: React.ReactNode }) {
  return <div className="opp-legend">{children}</div>
}

function Field({
  label,
  children,
  required,
  full,
}: {
  label: string
  children: React.ReactNode
  required?: boolean
  full?: boolean
}) {
  return (
    <label className={`opp-field ${full ? 'opp-field-full' : ''}`}>
      <span className="opp-label">
        {label}
        {required ? <span className="opp-label-req">*</span> : null}
      </span>
      {children}
    </label>
  )
}
