'use client'

import {
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoutineStep {
  id?: number
  sort_order?: number
  title: string
  agent_id: string
  input_context: string | null
  blocked_by_order: number | null
}

interface RoutineRow {
  id: number
  name: string
  description: string | null
  step_count?: number
  created_at: number
  updated_at: number
}

interface RoutineWithSteps extends RoutineRow {
  steps: RoutineStep[]
}

export interface RoutinesPanelHandle {
  openCreate: () => void
}

interface RoutinesPanelProps {
  onCountChange?: (count: number) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_OPTIONS = [
  { value: 'orchestrator', label: 'Orchestrator' },
  { value: 'claude',       label: 'Claude Generalist' },
  { value: 'jimmy',        label: 'Jimmy (Ops)' },
  { value: 'gary',         label: 'Gary (Ads)' },
  { value: 'ricky',        label: 'Ricky (Copy)' },
  { value: 'sofia',        label: 'Sofia (Social)' },
  { value: 'marcus',       label: 'Marcus (CRM)' },
  { value: 'nina',         label: 'Nina (Analyst)' },
  { value: 'theo',         label: 'Theo (Research)' },
  { value: 'qc',           label: 'QC (Review)' },
]

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export const RoutinesPanel = forwardRef<RoutinesPanelHandle, RoutinesPanelProps>(
  function RoutinesPanel({ onCountChange }, ref) {
    const [routines, setRoutines] = useState<RoutineRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)

    const fetchRoutines = useCallback(async () => {
      try {
        const res = await fetch('/api/dispatch/routines', { credentials: 'include' })
        if (!res.ok) {
          setError(`Failed to load (${res.status})`)
          return
        }
        const data = await res.json()
        setRoutines(data.routines || [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }, [])

    useEffect(() => { fetchRoutines() }, [fetchRoutines])
    useEffect(() => { onCountChange?.(routines.length) }, [routines.length, onCountChange])

    const openCreate = useCallback(() => { setEditingId(null); setShowForm(true) }, [])
    const openEdit = (id: number) => { setEditingId(id); setShowForm(true) }
    const closeForm = () => { setEditingId(null); setShowForm(false) }

    useImperativeHandle(ref, () => ({ openCreate }), [openCreate])

    const handleDelete = async (r: RoutineRow) => {
      if (!confirm(`Delete routine "${r.name}"? Any schedules using it will need to be repointed.`)) return
      try {
        const res = await fetch(`/api/dispatch/routines/${r.id}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`Delete failed (${res.status})`)
        fetchRoutines()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed')
      }
    }

    return (
      <>
        {error && (
          <div style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--status-overdue)',
            background: 'rgba(214, 77, 77, 0.08)',
            color: 'var(--status-overdue)',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {loading && routines.length === 0 ? (
          <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
            Loading…
          </div>
        ) : routines.length === 0 ? (
          <div style={{
            padding: '72px 24px',
            textAlign: 'center',
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--bg-surface)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
              No routines yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 18, maxWidth: 420, margin: '0 auto 18px' }}>
              A routine is a reusable sequence of agent steps. Schedule one on a cron and each fire clones it into a new parent task + subtasks with dependencies wired.
            </div>
            <button
              onClick={openCreate}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid transparent',
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              New routine
            </button>
          </div>
        ) : (
          <RoutineTable
            routines={routines}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        )}

        {showForm && (
          <RoutineEditor
            routineId={editingId}
            onClose={closeForm}
            onSaved={() => { closeForm(); fetchRoutines() }}
          />
        )}
      </>
    )
  }
)

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function RoutineTable({
  routines,
  onEdit,
  onDelete,
}: {
  routines: RoutineRow[]
  onEdit: (id: number) => void
  onDelete: (r: RoutineRow) => void
}) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--bg-surface)',
    }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 100px 140px 110px',
          gap: 16,
          padding: '10px 18px',
          borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <div>Name</div>
        <div>Steps</div>
        <div>Updated</div>
        <div style={{ textAlign: 'right' }}>Actions</div>
      </div>
      {routines.map((r, idx) => (
        <div
          key={r.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 140px 110px',
            gap: 16,
            padding: '14px 18px',
            alignItems: 'center',
            borderBottom: idx === routines.length - 1 ? 'none' : '1px solid var(--border)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              marginBottom: 3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {r.name}
            </div>
            {r.description && (
              <div style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {r.description}
              </div>
            )}
          </div>
          <div style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
          }}>
            {r.step_count ?? 0}
          </div>
          <div style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            {relativeFromNow(r.updated_at)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <RowButton label="Edit" onClick={() => onEdit(r.id)} />
            <RowButton label="Delete" onClick={() => onDelete(r)} danger />
          </div>
        </div>
      ))}
    </div>
  )
}

function RowButton({
  label,
  onClick,
  danger,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'transparent',
        color: danger ? 'var(--status-overdue)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = danger ? 'var(--status-overdue)' : 'var(--accent)'
        if (!danger) e.currentTarget.style.color = 'var(--accent-text)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        if (!danger) e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      {label}
    </button>
  )
}

function relativeFromNow(unixSeconds: number | null): string {
  if (!unixSeconds) return '—'
  const diff = unixSeconds - Date.now() / 1000
  const absDiff = Math.abs(diff)
  if (absDiff < 60) return diff < 0 ? 'just now' : 'in <1m'
  if (absDiff < 3600) {
    const m = Math.floor(absDiff / 60)
    return diff < 0 ? `${m}m ago` : `in ${m}m`
  }
  if (absDiff < 86400) {
    const h = Math.floor(absDiff / 3600)
    return diff < 0 ? `${h}h ago` : `in ${h}h`
  }
  const d = Math.floor(absDiff / 86400)
  return diff < 0 ? `${d}d ago` : `in ${d}d`
}

// ---------------------------------------------------------------------------
// Editor modal (create / edit)
// ---------------------------------------------------------------------------

function RoutineEditor({
  routineId,
  onClose,
  onSaved,
}: {
  routineId: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<RoutineStep[]>([
    { title: '', agent_id: 'orchestrator', input_context: '', blocked_by_order: null },
  ])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (routineId === null) return
    setLoading(true)
    fetch(`/api/dispatch/routines/${routineId}`, { credentials: 'include' })
      .then(res => res.json())
      .then((data: { routine?: RoutineWithSteps }) => {
        const r = data.routine
        if (!r) return
        setName(r.name)
        setDescription(r.description || '')
        setSteps(r.steps.length > 0
          ? r.steps.map(s => ({
              title: s.title,
              agent_id: s.agent_id,
              input_context: s.input_context || '',
              blocked_by_order: s.blocked_by_order,
            }))
          : [{ title: '', agent_id: 'orchestrator', input_context: '', blocked_by_order: null }]
        )
      })
      .catch(() => setFormError('Failed to load routine'))
      .finally(() => setLoading(false))
  }, [routineId])

  const updateStep = (idx: number, patch: Partial<RoutineStep>) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  const addStep = () => {
    setSteps(prev => [
      ...prev,
      { title: '', agent_id: 'orchestrator', input_context: '', blocked_by_order: prev.length > 0 ? prev.length - 1 : null },
    ])
  }

  const removeStep = (idx: number) => {
    setSteps(prev => {
      const next = prev.filter((_, i) => i !== idx)
      // Rewire blocked_by_order references that pointed at or past the removed index
      return next.map(s => {
        if (s.blocked_by_order === null || s.blocked_by_order === undefined) return s
        if (s.blocked_by_order === idx) return { ...s, blocked_by_order: null }
        if (s.blocked_by_order > idx) return { ...s, blocked_by_order: s.blocked_by_order - 1 }
        return s
      })
    })
  }

  const moveStep = (idx: number, direction: -1 | 1) => {
    const target = idx + direction
    if (target < 0 || target >= steps.length) return
    setSteps(prev => {
      const next = [...prev]
      const [m] = next.splice(idx, 1)
      next.splice(target, 0, m)
      // Invalidate blocked_by_order that now points at a later position than the step itself
      return next.map((s, i) => {
        if (s.blocked_by_order === null || s.blocked_by_order === undefined) return s
        if (s.blocked_by_order >= i) return { ...s, blocked_by_order: null }
        return s
      })
    })
  }

  const save = async () => {
    setFormError(null)
    if (!name.trim()) { setFormError('Name is required'); return }
    if (steps.length === 0) { setFormError('At least one step is required'); return }
    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].title.trim()) {
        setFormError(`Step ${i + 1}: title is required`)
        return
      }
    }

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      steps: steps.map((s, i) => ({
        title: s.title.trim(),
        agent_id: s.agent_id,
        input_context: (s.input_context || '').trim() || null,
        blocked_by_order: s.blocked_by_order !== null && s.blocked_by_order !== undefined && s.blocked_by_order < i
          ? s.blocked_by_order
          : null,
      })),
    }

    setSaving(true)
    try {
      const url = routineId
        ? `/api/dispatch/routines/${routineId}`
        : '/api/dispatch/routines'
      const method = routineId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Save failed (${res.status})`)
      }
      onSaved()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}>
          <h2 style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text)',
            margin: 0,
            letterSpacing: '-0.01em',
          }}>
            {routineId ? 'Edit routine' : 'New routine'}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: 20,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
            Loading…
          </div>
        ) : (
          <>
            <FieldLabel label="Name">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Monday briefing"
                style={fieldInputStyle}
                autoFocus
              />
            </FieldLabel>

            <FieldLabel label="Description (optional)">
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What does this routine do?"
                style={fieldInputStyle}
              />
            </FieldLabel>

            <FieldLabel label="Steps">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {steps.map((step, i) => (
                  <StepCard
                    key={i}
                    index={i}
                    step={step}
                    allSteps={steps}
                    canMoveUp={i > 0}
                    canMoveDown={i < steps.length - 1}
                    onChange={patch => updateStep(i, patch)}
                    onRemove={() => removeStep(i)}
                    onMoveUp={() => moveStep(i, -1)}
                    onMoveDown={() => moveStep(i, 1)}
                  />
                ))}
                <button
                  onClick={addStep}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px dashed var(--border)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  + Add step
                </button>
              </div>
            </FieldLabel>

            {formError && (
              <div style={{
                marginTop: 8,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(214, 77, 77, 0.1)',
                color: 'var(--status-overdue)',
                fontSize: 12,
                marginBottom: 12,
              }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button
                onClick={onClose}
                disabled={saving}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid transparent',
                  background: 'var(--accent)',
                  color: 'var(--accent-fg)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : (routineId ? 'Save changes' : 'Create routine')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StepCard({
  index,
  step,
  allSteps,
  canMoveUp,
  canMoveDown,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  index: number
  step: RoutineStep
  allSteps: RoutineStep[]
  canMoveUp: boolean
  canMoveDown: boolean
  onChange: (patch: Partial<RoutineStep>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const priorSteps = allSteps.slice(0, index)

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: 12,
      background: 'var(--bg)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Step {index + 1}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <IconButton disabled={!canMoveUp} onClick={onMoveUp} title="Move up">↑</IconButton>
          <IconButton disabled={!canMoveDown} onClick={onMoveDown} title="Move down">↓</IconButton>
          <IconButton onClick={onRemove} title="Remove" danger>×</IconButton>
        </div>
      </div>

      <input
        type="text"
        value={step.title}
        onChange={e => onChange({ title: e.target.value })}
        placeholder="Step title"
        style={{ ...fieldInputStyle, marginBottom: 8 }}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
        marginBottom: 8,
      }}>
        <div>
          <div style={subLabelStyle}>Agent</div>
          <select
            value={step.agent_id}
            onChange={e => onChange({ agent_id: e.target.value })}
            style={fieldInputStyle}
          >
            {AGENT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={subLabelStyle}>Depends on</div>
          <select
            value={step.blocked_by_order ?? ''}
            onChange={e => onChange({ blocked_by_order: e.target.value === '' ? null : Number(e.target.value) })}
            style={fieldInputStyle}
            disabled={priorSteps.length === 0}
          >
            <option value="">{priorSteps.length === 0 ? '— (first step)' : '— (no blocker)'}</option>
            {priorSteps.map((p, i) => (
              <option key={i} value={i}>Step {i + 1}: {p.title || '(untitled)'}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div style={subLabelStyle}>Prompt / context</div>
        <textarea
          value={step.input_context || ''}
          onChange={e => onChange({ input_context: e.target.value })}
          placeholder="Instructions for this step. Upstream step results are injected automatically at runtime."
          rows={3}
          style={{
            ...fieldInputStyle,
            resize: 'vertical',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.5,
          }}
        />
      </div>
    </div>
  )
}

function IconButton({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24,
        height: 24,
        borderRadius: 5,
        border: '1px solid var(--border)',
        background: 'transparent',
        color: disabled ? 'var(--text-muted)' : danger ? 'var(--status-overdue)' : 'var(--text-secondary)',
        fontSize: 14,
        lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--text-muted)',
        marginBottom: 6,
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

const subLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 4,
}
