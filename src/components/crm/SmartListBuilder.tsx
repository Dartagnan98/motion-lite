'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CrmListFilterFieldV2,
  CrmListFilterOp,
  CrmListFilterRuleV2,
  CrmListFilterRules,
  CrmContactRecord,
} from '@/lib/db'
import { crmFetch } from '@/lib/crm-browser'

const mono = { fontFamily: 'var(--font-mono)' } as const

/* ────────────────────────────── field metadata ────────────────────────────── */

type FieldKind = 'string' | 'bool' | 'number_id' | 'created_at' | 'string_enum'

interface FieldMeta {
  field: CrmListFilterFieldV2
  label: string
  kind: FieldKind
}

const FIELDS: readonly FieldMeta[] = [
  { field: 'lifecycle_stage',   label: 'Lifecycle stage',    kind: 'string' },
  { field: 'source',            label: 'Source',             kind: 'string' },
  { field: 'tag',               label: 'Tag',                kind: 'string' },
  { field: 'pipeline_stage_id', label: 'Pipeline stage id',  kind: 'number_id' },
  { field: 'owner_id',          label: 'Owner id',           kind: 'number_id' },
  { field: 'company_id',        label: 'Company id',         kind: 'number_id' },
  { field: 'created_at',        label: 'Created (unix sec)', kind: 'created_at' },
  { field: 'unsubscribed',      label: 'Unsubscribed',       kind: 'bool' },
  { field: 'dnd_sms',           label: 'DND — SMS',          kind: 'bool' },
  { field: 'dnd_email',         label: 'DND — Email',        kind: 'bool' },
  { field: 'dnd_calls',         label: 'DND — Calls',        kind: 'bool' },
  { field: 'city',              label: 'City',               kind: 'string' },
  { field: 'state',             label: 'State',              kind: 'string' },
  { field: 'country',           label: 'Country',            kind: 'string' },
]

/** Legal ops per field kind. Keeps the UI from offering nonsense combos. */
const OPS_BY_KIND: Record<FieldKind, readonly { op: CrmListFilterOp; label: string }[]> = {
  string: [
    { op: 'eq',           label: 'is' },
    { op: 'neq',          label: 'is not' },
    { op: 'contains',     label: 'contains' },
    { op: 'not_contains', label: 'does not contain' },
    { op: 'in',           label: 'is any of' },
    { op: 'not_in',       label: 'is none of' },
    { op: 'is_set',       label: 'is set' },
    { op: 'is_not_set',   label: 'is not set' },
  ],
  bool: [
    { op: 'eq',         label: 'is true' },
    { op: 'neq',        label: 'is false' },
    { op: 'is_set',     label: 'is set' },
    { op: 'is_not_set', label: 'is not set' },
  ],
  number_id: [
    { op: 'eq',         label: 'equals' },
    { op: 'neq',        label: 'not equal' },
    { op: 'in',         label: 'is any of' },
    { op: 'not_in',     label: 'is none of' },
    { op: 'is_set',     label: 'is set' },
    { op: 'is_not_set', label: 'is not set' },
  ],
  created_at: [
    { op: 'gte',        label: '≥ (unix sec)' },
    { op: 'lte',        label: '≤ (unix sec)' },
    { op: 'is_set',     label: 'is set' },
    { op: 'is_not_set', label: 'is not set' },
  ],
  string_enum: [
    { op: 'eq',         label: 'is' },
    { op: 'neq',        label: 'is not' },
    { op: 'in',         label: 'is any of' },
    { op: 'not_in',     label: 'is none of' },
  ],
}

function kindOf(field: CrmListFilterFieldV2): FieldKind {
  return FIELDS.find((f) => f.field === field)?.kind ?? 'string'
}

function defaultRule(): CrmListFilterRuleV2 {
  return { field: 'lifecycle_stage', op: 'eq', value: '' }
}

/** True for ops that do not need a value input (is_set / is_not_set). */
function opNeedsValue(op: CrmListFilterOp): boolean {
  return op !== 'is_set' && op !== 'is_not_set'
}

/* ───────────────────────────── shared styles ──────────────────────────────── */

const tokens = {
  panel:     { background: 'var(--bg-panel)', borderColor: 'var(--border)' },
  surface:   { background: 'var(--bg-surface)', borderColor: 'var(--border)' },
  elevated:  { background: 'var(--bg-elevated)', borderColor: 'var(--border)' },
  ring:      'color-mix(in oklab, var(--accent) 32%, transparent)',
}

const labelStyle: React.CSSProperties = {
  ...mono,
  color: 'var(--text-muted)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
  transition: 'border-color 120ms, background-color 120ms',
}

/* ───────────────────────────── builder props ──────────────────────────────── */

export interface SmartListBuilderProps {
  /** Initial rules — pass `null` to start with a fresh {match:'all', rules:[]}. */
  value: CrmListFilterRules | null
  /** Called on every change so the parent can commit on Save. */
  onChange: (next: CrmListFilterRules) => void
  /**
   * Optional: when provided, the builder fetches live /preview data for this
   * list id as rules change (debounced). For the create flow pass undefined —
   * the preview panel will show "Save to preview" until the list exists.
   */
  listId?: number | null
  /** Optional click-to-open hook when a sample contact is clicked. */
  onSampleClick?: (contact: CrmContactRecord) => void
}

/* ─────────────────────────────── component ────────────────────────────────── */

export function SmartListBuilder({ value, onChange, listId, onSampleClick }: SmartListBuilderProps) {
  const initial: CrmListFilterRules = useMemo(
    () => value && Array.isArray(value.rules) ? value : { match: 'all', rules: [] },
    [value],
  )
  const [match, setMatch] = useState<'all' | 'any'>(initial.match)
  const [rules, setRules] = useState<CrmListFilterRuleV2[]>(initial.rules)

  // Sync outward on every change — parent owns the commit.
  useEffect(() => { onChange({ match, rules }) }, [match, rules]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateRule(i: number, patch: Partial<CrmListFilterRuleV2>) {
    setRules((prev) => prev.map((r, idx) => {
      if (idx !== i) return r
      const next: CrmListFilterRuleV2 = { ...r, ...patch }
      // When field changes, pick the first legal op + reset value.
      if (patch.field && patch.field !== r.field) {
        const ops = OPS_BY_KIND[kindOf(patch.field)]
        next.op = ops[0].op
        next.value = ''
      }
      // When op flips between array/scalar, coerce value shape.
      if (patch.op && patch.op !== r.op) {
        const arrayNow = patch.op === 'in' || patch.op === 'not_in'
        const arrayPrev = r.op === 'in' || r.op === 'not_in'
        if (arrayNow && !arrayPrev) {
          const s = typeof r.value === 'string' ? r.value : ''
          next.value = s ? s.split(',').map((v) => v.trim()).filter(Boolean) : []
        } else if (!arrayNow && arrayPrev) {
          next.value = Array.isArray(r.value) ? r.value.join(', ') : ''
        }
      }
      return next
    }))
  }

  function addRule() {
    setRules((prev) => [...prev, defaultRule()])
  }
  function removeRule(i: number) {
    setRules((prev) => prev.filter((_, idx) => idx !== i))
  }

  /* ───────────────────── live preview (debounced) ───────────────────── */

  const [preview, setPreview] = useState<{ count: number; sample: CrmContactRecord[] } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!listId) { setPreview(null); return }
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    setPreviewLoading(true)
    debounceTimer.current = setTimeout(() => {
      crmFetch<{ count: number; sample: CrmContactRecord[] }>(`/api/crm/lists/${listId}/preview`)
        .then((data) => setPreview(data))
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false))
    }, 350)
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [listId, match, rules])

  /* ───────────────────────────── render ───────────────────────────── */

  return (
    <div
      className="grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-[1.35fr_1fr]"
      style={tokens.panel}
    >
      {/* ─── Left column: rules editor ─── */}
      <div className="space-y-3">
        {/* Match toggle */}
        <div className="flex items-center gap-2">
          <span style={labelStyle}>Match</span>
          <div
            className="inline-flex overflow-hidden rounded-lg border"
            style={{ borderColor: 'var(--border)' }}
          >
            {(['all', 'any'] as const).map((m) => {
              const active = match === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMatch(m)}
                  className="px-3 py-1.5 text-[11px] transition-colors"
                  style={{
                    ...mono,
                    transition: 'background 120ms, color 120ms',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--accent-fg)' : 'var(--text-dim)',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}
                >
                  {m}
                </button>
              )
            })}
          </div>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {match === 'all' ? 'contact must match every rule' : 'contact must match any rule'}
          </span>
        </div>

        {/* Rule rows */}
        <div className="space-y-2">
          {rules.length === 0 && (
            <div
              className="rounded-xl border border-dashed p-4 text-center text-[12px]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              No rules yet. Add one below to start matching contacts.
            </div>
          )}
          {rules.map((rule, i) => {
            const kind = kindOf(rule.field)
            const ops = OPS_BY_KIND[kind]
            const needValue = opNeedsValue(rule.op)
            const isArrayValue = rule.op === 'in' || rule.op === 'not_in'
            const numericInput = kind === 'number_id' || kind === 'created_at'

            return (
              <div
                key={i}
                className="grid grid-cols-[1.1fr_1.1fr_1.4fr_auto] items-center gap-2 rounded-xl border p-2"
                style={tokens.surface}
              >
                {/* Field */}
                <select
                  value={rule.field}
                  onChange={(e) => updateRule(i, { field: e.target.value as CrmListFilterFieldV2 })}
                  className="rounded-lg border px-2 py-1.5 text-[12px] outline-none focus:border-[color:var(--accent)]"
                  style={inputStyle}
                >
                  {FIELDS.map((f) => (
                    <option key={f.field} value={f.field}>{f.label}</option>
                  ))}
                </select>

                {/* Op */}
                <select
                  value={rule.op}
                  onChange={(e) => updateRule(i, { op: e.target.value as CrmListFilterOp })}
                  className="rounded-lg border px-2 py-1.5 text-[12px] outline-none focus:border-[color:var(--accent)]"
                  style={inputStyle}
                >
                  {ops.map((o) => (
                    <option key={o.op} value={o.op}>{o.label}</option>
                  ))}
                </select>

                {/* Value */}
                {needValue ? (
                  kind === 'bool' ? (
                    <span className="self-center text-[11px]" style={{ ...mono, color: 'var(--text-muted)' }}>
                      —
                    </span>
                  ) : isArrayValue ? (
                    <input
                      type="text"
                      value={Array.isArray(rule.value) ? rule.value.join(', ') : ''}
                      onChange={(e) => updateRule(i, {
                        value: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                      })}
                      placeholder="comma-separated values"
                      className="rounded-lg border px-2 py-1.5 text-[12px] outline-none focus:border-[color:var(--accent)]"
                      style={inputStyle}
                    />
                  ) : (
                    <input
                      type={numericInput ? 'number' : 'text'}
                      value={rule.value === undefined || rule.value === null ? '' : String(rule.value)}
                      onChange={(e) => updateRule(i, {
                        value: numericInput
                          ? (e.target.value === '' ? '' : Number(e.target.value))
                          : e.target.value,
                      })}
                      placeholder={
                        rule.field === 'tag' ? 'vip' :
                        rule.field === 'created_at' ? '1700000000' :
                        'value'
                      }
                      className="rounded-lg border px-2 py-1.5 text-[12px] outline-none focus:border-[color:var(--accent)]"
                      style={inputStyle}
                    />
                  )
                ) : (
                  <span className="self-center text-[11px]" style={{ ...mono, color: 'var(--text-muted)' }}>
                    —
                  </span>
                )}

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  aria-label="Remove rule"
                  className="rounded-lg border px-2 py-1.5 text-[11px] transition-colors"
                  style={{
                    ...mono,
                    borderColor: 'var(--border)',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-elevated)',
                    transition: 'background 120ms, color 120ms',
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        {/* Add rule */}
        <button
          type="button"
          onClick={addRule}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] transition-colors"
          style={{
            ...mono,
            borderColor: 'var(--border)',
            color: 'var(--text-dim)',
            background: 'transparent',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            transition: 'background 120ms, color 120ms',
          }}
        >
          + Add rule
        </button>
      </div>

      {/* ─── Right column: live preview ─── */}
      <aside className="space-y-3 rounded-xl border p-3" style={tokens.surface}>
        <div className="flex items-center justify-between">
          <span style={labelStyle}>Preview</span>
          {previewLoading && (
            <span className="text-[10px]" style={{ ...mono, color: 'var(--text-muted)' }}>
              updating…
            </span>
          )}
        </div>

        {!listId ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Save the list to see a live audience preview.
          </div>
        ) : preview ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px]" style={{ ...mono, color: 'var(--text-dim)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                Count
              </span>
              <span className="text-[22px] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
                {preview.count}
              </span>
            </div>
            <div>
              <div className="mb-1.5" style={labelStyle}>Sample</div>
              {preview.sample.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  No contacts match these rules yet.
                </div>
              ) : (
                <ul className="space-y-1">
                  {preview.sample.slice(0, 10).map((contact) => (
                    <li key={contact.id}>
                      <button
                        type="button"
                        onClick={() => onSampleClick?.(contact)}
                        className="w-full truncate rounded-md px-2 py-1 text-left text-[12px] transition-colors"
                        style={{
                          background: 'transparent',
                          color: 'var(--text-dim)',
                          transition: 'background 120ms, color 120ms',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)' }}
                      >
                        {contact.name}
                        {contact.email ? (
                          <span className="ml-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {contact.email}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Preview unavailable.
          </div>
        )}
      </aside>
    </div>
  )
}

export default SmartListBuilder
