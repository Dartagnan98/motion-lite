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

type HandlerType = 'motion-internal' | 'webhook' | 'bridge-forward'

interface ToolRow {
  id: number
  name: string
  description: string | null
  handler_type: HandlerType
  endpoint: string | null
  input_schema: string
  enabled: number
  builtin: number
  created_at: number
  updated_at: number
  invocation_count?: number
  last_invoked_at?: number | null
  last_status?: string | null
}

interface ToolInvocation {
  id: number
  tool_id: number
  tool_name: string
  caller: string | null
  dispatch_id: number | null
  args_json: string | null
  result_json: string | null
  status: 'ok' | 'error'
  error: string | null
  duration_ms: number | null
  created_at: number
}

export interface ToolsPanelHandle {
  openCreate: () => void
}

interface ToolsPanelProps {
  onCountChange?: (count: number) => void
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export const ToolsPanel = forwardRef<ToolsPanelHandle, ToolsPanelProps>(
  function ToolsPanel({ onCountChange }, ref) {
    const [tools, setTools] = useState<ToolRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [editing, setEditing] = useState<ToolRow | null>(null)
    const [expandedId, setExpandedId] = useState<number | null>(null)

    const fetchTools = useCallback(async () => {
      try {
        const res = await fetch('/api/dispatch/tools', { credentials: 'include' })
        if (!res.ok) {
          setError(`Failed to load (${res.status})`)
          return
        }
        const data = await res.json()
        setTools(data.tools ?? [])
        setError(null)
        onCountChange?.((data.tools ?? []).length)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }, [onCountChange])

    useEffect(() => { fetchTools() }, [fetchTools])

    const openCreate = useCallback(() => {
      setEditing(null)
      setShowForm(true)
    }, [])

    const openEdit = useCallback((tool: ToolRow) => {
      setEditing(tool)
      setShowForm(true)
    }, [])

    const closeForm = useCallback(() => {
      setShowForm(false)
      setEditing(null)
    }, [])

    useImperativeHandle(ref, () => ({ openCreate }), [openCreate])

    const handleToggle = async (tool: ToolRow) => {
      try {
        const res = await fetch(`/api/dispatch/tools/${tool.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ enabled: !tool.enabled }),
        })
        if (!res.ok) throw new Error(`Toggle failed (${res.status})`)
        fetchTools()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Toggle failed')
      }
    }

    const handleDelete = async (tool: ToolRow) => {
      if (!confirm(`Delete tool "${tool.name}"? Invocation history is kept.`)) return
      try {
        const res = await fetch(`/api/dispatch/tools/${tool.id}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `Delete failed (${res.status})`)
        }
        fetchTools()
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

        {loading && tools.length === 0 ? (
          <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
            Loading…
          </div>
        ) : tools.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <ToolTable
            tools={tools}
            expandedId={expandedId}
            onExpand={(id) => setExpandedId(expandedId === id ? null : id)}
            onEdit={openEdit}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        )}

        {showForm && (
          <ToolEditor
            tool={editing}
            onClose={closeForm}
            onSaved={() => { closeForm(); fetchTools() }}
          />
        )}
      </>
    )
  }
)

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{
      padding: '72px 24px',
      textAlign: 'center',
      border: '1px solid var(--border)',
      borderRadius: 14,
      background: 'var(--bg-surface)',
    }}>
      <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
        No tools registered
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 18, maxWidth: 460, margin: '0 auto 18px' }}>
        Tools are typed functions an agent can call — create_task, update_status, send_email. Built-ins are seeded automatically.
      </div>
      <button
        onClick={onCreate}
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
        New tool
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const ROW_GRID = '1fr 140px 90px 110px 170px'

function ToolTable({
  tools,
  expandedId,
  onExpand,
  onEdit,
  onToggle,
  onDelete,
}: {
  tools: ToolRow[]
  expandedId: number | null
  onExpand: (id: number) => void
  onEdit: (t: ToolRow) => void
  onToggle: (t: ToolRow) => void
  onDelete: (t: ToolRow) => void
}) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--bg-surface)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: ROW_GRID,
        gap: 16,
        padding: '10px 18px',
        borderBottom: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        <div>Name</div>
        <div>Handler</div>
        <div>Calls</div>
        <div>Last</div>
        <div style={{ textAlign: 'right' }}>Actions</div>
      </div>
      {tools.map((t, idx) => (
        <div key={t.id}>
          <div
            onClick={() => onExpand(t.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: ROW_GRID,
              gap: 16,
              padding: '14px 18px',
              alignItems: 'center',
              borderBottom: expandedId === t.id || idx === tools.length - 1 ? 'none' : '1px solid var(--border)',
              opacity: t.enabled ? 1 : 0.55,
              cursor: 'pointer',
            }}
          >
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusDot status={t.last_status} enabled={!!t.enabled} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--text)',
                  marginBottom: 2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  {t.name}
                  {t.builtin ? <BuiltinBadge /> : null}
                </div>
                {t.description && (
                  <div style={{
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {t.description}
                  </div>
                )}
              </div>
            </div>
            <div><HandlerBadge type={t.handler_type} /></div>
            <div style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}>
              {t.invocation_count ?? 0}
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              {relativeFromNow(t.last_invoked_at ?? null)}
            </div>
            <div
              style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}
              onClick={(e) => e.stopPropagation()}
            >
              <RowButton label={t.enabled ? 'Disable' : 'Enable'} onClick={() => onToggle(t)} />
              <RowButton label="Edit" onClick={() => onEdit(t)} />
              {t.builtin ? null : <RowButton label="Delete" onClick={() => onDelete(t)} danger />}
            </div>
          </div>
          {expandedId === t.id && (
            <ExpandedToolPane
              tool={t}
              lastBorder={idx === tools.length - 1}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function StatusDot({ status, enabled }: { status: string | null | undefined; enabled: boolean }) {
  let color = 'var(--text-dim)'
  if (!enabled) color = 'var(--text-muted)'
  else if (status === 'ok') color = 'var(--status-completed)'
  else if (status === 'error') color = 'var(--status-overdue)'
  else color = 'var(--text-muted)'
  return (
    <span style={{
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
      display: 'inline-block',
      flexShrink: 0,
    }} />
  )
}

function BuiltinBadge() {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: '0.06em',
      padding: '2px 6px',
      borderRadius: 4,
      border: '1px solid var(--border)',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
    }}>
      BUILT-IN
    </span>
  )
}

function HandlerBadge({ type }: { type: HandlerType }) {
  const labelMap: Record<HandlerType, string> = {
    'motion-internal': 'MOTION',
    'webhook': 'WEBHOOK',
    'bridge-forward': 'BRIDGE',
  }
  const colorMap: Record<HandlerType, string> = {
    'motion-internal': 'var(--accent)',
    'webhook': 'var(--status-active)',
    'bridge-forward': 'var(--status-completed)',
  }
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.05em',
      padding: '3px 7px',
      borderRadius: 4,
      border: `1px solid ${colorMap[type]}`,
      color: colorMap[type],
    }}>
      {labelMap[type]}
    </span>
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

// ---------------------------------------------------------------------------
// Expanded pane — schema + test invoke + recent invocations
// ---------------------------------------------------------------------------

function ExpandedToolPane({ tool, lastBorder }: { tool: ToolRow; lastBorder: boolean }) {
  const [invocations, setInvocations] = useState<ToolInvocation[]>([])
  const [argsInput, setArgsInput] = useState('{}')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/dispatch/tools/invocations?tool_id=${tool.id}&limit=15`, {
      credentials: 'include',
    })
    if (res.ok) {
      const data = await res.json()
      setInvocations(data.invocations ?? [])
    }
  }, [tool.id])

  useEffect(() => { refresh() }, [refresh])

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(argsInput || '{}') } catch { throw new Error('args must be valid JSON') }
      const res = await fetch('/api/dispatch/tools/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: tool.name, args }),
      })
      const data = await res.json()
      setTestResult(JSON.stringify(data, null, 2))
      refresh()
    } catch (err) {
      setTestResult(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div style={{
      padding: '16px 18px 20px',
      background: 'rgba(0,0,0,0.15)',
      borderBottom: lastBorder ? 'none' : '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 20,
    }}>
      {/* Left: schema */}
      <div>
        <SectionLabel>Input schema</SectionLabel>
        <pre style={preStyle}>
          {prettyJson(tool.input_schema)}
        </pre>

        <SectionLabel style={{ marginTop: 16 }}>Test invoke</SectionLabel>
        <textarea
          value={argsInput}
          onChange={e => setArgsInput(e.target.value)}
          placeholder='{"title":"test task"}'
          rows={4}
          spellCheck={false}
          style={{
            width: '100%',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            padding: 10,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-base)',
            color: 'var(--text)',
            resize: 'vertical',
          }}
        />
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={runTest}
            disabled={testing}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid transparent',
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              fontSize: 12,
              fontWeight: 500,
              cursor: testing ? 'wait' : 'pointer',
            }}
          >
            {testing ? 'Running…' : 'Run'}
          </button>
        </div>
        {testResult && (
          <pre style={{ ...preStyle, marginTop: 10 }}>{testResult}</pre>
        )}
      </div>

      {/* Right: invocations */}
      <div>
        <SectionLabel>Recent invocations</SectionLabel>
        {invocations.length === 0 ? (
          <div style={{
            padding: '20px 0',
            fontSize: 12,
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
          }}>
            No invocations yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {invocations.map(inv => <InvocationRow key={inv.id} inv={inv} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function InvocationRow({ inv }: { inv: ToolInvocation }) {
  const [open, setOpen] = useState(false)
  // Bridge-forward invocations record status='ok' with {pending: true} in
  // result_json until the bridge POSTs a completion back. Surface that as
  // an amber "pending" dot instead of the usual green.
  const isPending = inv.status === 'ok' && !!inv.result_json && inv.result_json.includes('"pending":true')
  const color = inv.status === 'error'
    ? 'var(--status-overdue)'
    : isPending
      ? 'var(--status-active)'
      : 'var(--status-completed)'
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: 8,
      fontSize: 12,
      background: 'var(--bg-surface)',
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      >
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
        }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          fontSize: 10,
          letterSpacing: '0.05em',
        }}>
          {relativeFromNow(inv.created_at)}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          fontSize: 11,
        }}>
          {inv.duration_ms}ms
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {inv.caller ?? '—'}
        </span>
        {inv.error && (
          <span style={{
            color: 'var(--status-overdue)',
            fontSize: 11,
            marginLeft: 'auto',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 180,
          }}>
            {inv.error}
          </span>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {inv.args_json && (
            <>
              <TinyLabel>args</TinyLabel>
              <pre style={preStyleSm}>{prettyJson(inv.args_json)}</pre>
            </>
          )}
          {inv.result_json && (
            <>
              <TinyLabel>result</TinyLabel>
              <pre style={preStyleSm}>{prettyJson(inv.result_json)}</pre>
            </>
          )}
          {inv.error && (
            <>
              <TinyLabel>error</TinyLabel>
              <pre style={{ ...preStyleSm, color: 'var(--status-overdue)' }}>{inv.error}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor modal (create / edit)
// ---------------------------------------------------------------------------

const HANDLER_OPTIONS: { value: HandlerType; label: string; hint: string }[] = [
  { value: 'motion-internal', label: 'Motion-internal', hint: 'Wired to a Motion db function in src/lib/tools/invoke.ts.' },
  { value: 'webhook', label: 'Webhook', hint: 'POSTs args to an HTTP endpoint you provide.' },
  { value: 'bridge-forward', label: 'Bridge-forward', hint: 'The Mac bridge runs the endpoint as a shell command. Args are piped in as JSON on stdin + MOTION_TOOL_ARGS_JSON env. Returns immediately with a pending invocation; finalizes when the bridge POSTs back.' },
]

function ToolEditor({
  tool,
  onClose,
  onSaved,
}: {
  tool: ToolRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!tool
  const isBuiltin = !!tool?.builtin

  const [name, setName] = useState(tool?.name ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [handlerType, setHandlerType] = useState<HandlerType>(tool?.handler_type ?? 'motion-internal')
  const [endpoint, setEndpoint] = useState(tool?.endpoint ?? '')
  const [schemaText, setSchemaText] = useState(prettyJson(tool?.input_schema ?? '{"type":"object","properties":{}}'))
  const [enabled, setEnabled] = useState(tool?.enabled !== 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      let schemaCompact = '{}'
      try { schemaCompact = JSON.stringify(JSON.parse(schemaText)) } catch { throw new Error('input_schema must be valid JSON') }

      if (!isEdit) {
        const nameClean = name.trim().toLowerCase()
        if (!/^[a-z0-9_]{2,64}$/.test(nameClean)) throw new Error('Name must be snake_case, 2-64 chars.')
        const res = await fetch('/api/dispatch/tools', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: nameClean,
            description: description.trim() || null,
            handler_type: handlerType,
            endpoint: endpoint.trim() || null,
            input_schema: schemaCompact,
            enabled,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `Save failed (${res.status})`)
        }
      } else {
        const patch: Record<string, unknown> = {
          description: description.trim() || null,
          input_schema: schemaCompact,
          enabled,
        }
        if (!isBuiltin) {
          patch.handler_type = handlerType
          patch.endpoint = endpoint.trim() || null
        }
        const res = await fetch(`/api/dispatch/tools/${tool!.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `Save failed (${res.status})`)
        }
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <div style={{
        padding: '22px 26px 18px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text)' }}>
          {isEdit ? (isBuiltin ? `Edit tool: ${tool!.name} (built-in)` : `Edit tool: ${tool!.name}`) : 'New tool'}
        </div>
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
          }}
          aria-label="Close"
        >×</button>
      </div>

      <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '70vh', overflow: 'auto' }}>
        {error && (
          <div style={{
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

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={isEdit}
            placeholder="snake_case_name"
            style={inputStyle}
          />
          {isEdit && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Tool names can't be renamed (callers reference them by name).
            </div>
          )}
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="One line of what this tool does. Shown to agents and in the UI."
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>

        <Field label="Handler">
          {isBuiltin ? (
            <div style={{
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              motion-internal (built-in — handler lives in src/lib/tools/invoke.ts)
            </div>
          ) : (
            <>
              <select
                value={handlerType}
                onChange={e => setHandlerType(e.target.value as HandlerType)}
                style={inputStyle}
              >
                {HANDLER_OPTIONS.map(h => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {HANDLER_OPTIONS.find(h => h.value === handlerType)?.hint}
              </div>
            </>
          )}
        </Field>

        {handlerType === 'webhook' && !isBuiltin && (
          <Field label="Endpoint URL">
            <input
              type="text"
              value={endpoint}
              onChange={e => setEndpoint(e.target.value)}
              placeholder="https://example.com/hooks/my-tool"
              style={inputStyle}
            />
          </Field>
        )}

        <Field label="Input schema (JSON Schema)">
          <textarea
            value={schemaText}
            onChange={e => setSchemaText(e.target.value)}
            rows={10}
            spellCheck={false}
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              resize: 'vertical',
              minHeight: 180,
            }}
          />
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text)' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      <div style={{
        padding: '16px 26px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 10,
      }}>
        <button
          onClick={onClose}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid transparent',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            fontSize: 13,
            fontWeight: 500,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 40,
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: '100%',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,0.45)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      marginBottom: 6,
      ...style,
    }}>
      {children}
    </div>
  )
}

function TinyLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
    }}>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-base)',
  color: 'var(--text)',
  fontSize: 13,
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-base)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text-secondary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflow: 'auto',
  maxHeight: 260,
}

const preStyleSm: React.CSSProperties = {
  ...preStyle,
  fontSize: 10,
  padding: 6,
  maxHeight: 180,
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

function prettyJson(raw: string): string {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
