'use client'

import { useState, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react'
import cronstrue from 'cronstrue'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScheduleType = 'cron' | 'heartbeat' | 'multistep'

interface ScheduleRow {
  id: number
  name: string
  cron_expr: string
  timezone: string
  agent_id: string
  task_id: number | null
  input_context: string | null
  enabled: number
  next_run_at: number | null
  last_run_at: number | null
  last_dispatch_id: number | null
  last_status: string | null
  last_error: string | null
  created_at: number
  updated_at: number
  type: ScheduleType
  routine_id: number | null
  skip_if_running?: number
  retry_on_failure?: number
  max_retries?: number
  failure_count?: number
  task_title?: string | null
  task_public_id?: string | null
  last_dispatch_status?: string | null
  routine_name?: string | null
}

interface HistoryEntry {
  dispatch_id: number
  task_id: number | null
  task_title: string | null
  status: string
  created_at: number
  started_at: number | null
  completed_at: number | null
  agent_id: string
  error: string | null
}

interface TaskPickerItem {
  id: number
  public_id: string
  title: string
}

interface RoutinePickerItem {
  id: number
  name: string
  description: string | null
  step_count: number
}

interface ExternalSchedule {
  source: 'hetzner-crontab' | 'mac-launchd'
  label: string
  schedule_hint: string
  program: string | null
  raw: string
  location: string
}

export interface SchedulesPanelHandle {
  openCreate: () => void
}

interface SchedulesPanelProps {
  onCountChange?: (count: number) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPATCH_AGENT_OPTIONS = [
  { value: 'team', label: 'Orchestrator Team (Parallel)' },
  { value: 'orchestrator', label: 'Orchestrator (Single)' },
  { value: 'claude', label: 'Claude Generalist' },
  { value: 'jimmy', label: 'Jimmy (Ops)' },
  { value: 'gary', label: 'Gary (Ads)' },
  { value: 'ricky', label: 'Ricky (Copy)' },
  { value: 'sofia', label: 'Sofia (Social)' },
]

type Frequency = 'daily' | 'weekly' | 'monthly' | 'custom'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(n: number): string { return n.toString().padStart(2, '0') }

/** Build a cron expression from the preset form fields. */
function buildCron(freq: Frequency, hour: number, minute: number, dow: number, dom: number): string {
  const mm = minute
  const hh = hour
  switch (freq) {
    case 'daily':   return `${mm} ${hh} * * *`
    case 'weekly':  return `${mm} ${hh} * * ${dow}`
    case 'monthly': return `${mm} ${hh} ${dom} * *`
    default:        return `${mm} ${hh} * * *`
  }
}

/** Best-effort parse of a cron expression back into preset form fields.
 * Only matches the shapes buildCron() produces; anything weirder drops to
 * "custom". */
function parseCron(expr: string): {
  freq: Frequency
  hour: number
  minute: number
  dow: number
  dom: number
} {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { freq: 'custom', hour: 9, minute: 0, dow: 1, dom: 1 }
  const [mm, hh, dom, mon, dow] = parts
  const minute = Number(mm)
  const hour = Number(hh)
  const isSimpleMin = /^\d+$/.test(mm) && minute >= 0 && minute < 60
  const isSimpleHour = /^\d+$/.test(hh) && hour >= 0 && hour < 24
  if (!isSimpleMin || !isSimpleHour) return { freq: 'custom', hour: 9, minute: 0, dow: 1, dom: 1 }

  if (dom === '*' && mon === '*' && dow === '*') {
    return { freq: 'daily', hour, minute, dow: 1, dom: 1 }
  }
  if (dom === '*' && mon === '*' && /^\d+$/.test(dow)) {
    const d = Number(dow)
    if (d >= 0 && d <= 6) return { freq: 'weekly', hour, minute, dow: d, dom: 1 }
  }
  if (/^\d+$/.test(dom) && mon === '*' && dow === '*') {
    const d = Number(dom)
    if (d >= 1 && d <= 28) return { freq: 'monthly', hour, minute, dow: 1, dom: d }
  }
  return { freq: 'custom', hour: 9, minute: 0, dow: 1, dom: 1 }
}

/** Humanize a cron expression. Falls back to the raw string if cronstrue
 * can't parse it (e.g. mid-edit in the custom field). */
function humanizeCron(expr: string): string {
  try {
    return cronstrue.toString(expr, { use24HourTimeFormat: false, verbose: false })
  } catch {
    return expr
  }
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

function formatClock(unixSeconds: number | null, tz: string): string {
  if (!unixSeconds) return ''
  try {
    return new Date(unixSeconds * 1000).toLocaleString('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return new Date(unixSeconds * 1000).toLocaleString()
  }
}

const STATUS_DOT: Record<string, string> = {
  ok:     'var(--status-completed)',
  error:  'var(--status-overdue)',
}

// ---------------------------------------------------------------------------
// Panel (ref-forwarding so parent can trigger openCreate from the tab header)
// ---------------------------------------------------------------------------

export const SchedulesPanel = forwardRef<SchedulesPanelHandle, SchedulesPanelProps>(
  function SchedulesPanel({ onCountChange }, ref) {
    const [schedules, setSchedules] = useState<ScheduleRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    const [editing, setEditing] = useState<ScheduleRow | null>(null)
    const [tasks, setTasks] = useState<TaskPickerItem[]>([])
    const [routines, setRoutines] = useState<RoutinePickerItem[]>([])
    const [external, setExternal] = useState<ExternalSchedule[]>([])
    const [pause, setPause] = useState<{ paused: boolean; since: number | null; reason: string | null; by: string | null }>({
      paused: false, since: null, reason: null, by: null,
    })
    const [pauseBusy, setPauseBusy] = useState(false)

    const fetchSchedules = useCallback(async () => {
      try {
        const res = await fetch('/api/dispatch/schedules', { credentials: 'include' })
        if (!res.ok) {
          setError(`Failed to load (${res.status})`)
          return
        }
        const data = await res.json()
        setSchedules(data.schedules || [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }, [])

    const fetchTasks = useCallback(async () => {
      try {
        const res = await fetch('/api/tasks?recent=1&limit=50', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        setTasks((data.tasks || []).map((t: { id: number; public_id: string; title: string }) => ({
          id: t.id, public_id: t.public_id, title: t.title,
        })))
      } catch {
        // silent -- task picker is optional
      }
    }, [])

    const fetchRoutines = useCallback(async () => {
      try {
        const res = await fetch('/api/dispatch/routines', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        setRoutines(data.routines || [])
      } catch {
        // silent -- routine picker is optional
      }
    }, [])

    const fetchExternal = useCallback(async () => {
      try {
        const res = await fetch('/api/dispatch/schedules/external', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        setExternal(data.external || [])
      } catch {
        // silent -- external mirror is optional
      }
    }, [])

    const fetchPause = useCallback(async () => {
      try {
        const res = await fetch('/api/dispatch/schedules/pause', { credentials: 'include' })
        if (!res.ok) return
        const data = await res.json()
        if (data.state) setPause(data.state)
      } catch {
        // silent -- pause state is optional
      }
    }, [])

    const togglePause = useCallback(async (next: boolean) => {
      setPauseBusy(true)
      const reason = next ? (window.prompt('Pause reason (optional)', '') ?? '') : ''
      try {
        const res = await fetch('/api/dispatch/schedules/pause', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paused: next, reason: reason || undefined }),
        })
        if (!res.ok) throw new Error(`Pause toggle failed (${res.status})`)
        const data = await res.json()
        if (data.state) setPause(data.state)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Pause toggle failed')
      } finally {
        setPauseBusy(false)
      }
    }, [])

    useEffect(() => { fetchSchedules() }, [fetchSchedules])
    useEffect(() => { fetchTasks() }, [fetchTasks])
    useEffect(() => { fetchRoutines() }, [fetchRoutines])
    useEffect(() => { fetchExternal() }, [fetchExternal])
    useEffect(() => { fetchPause() }, [fetchPause])
    useEffect(() => {
      // Re-poll pause state every 15s so UI reflects changes made from other tabs.
      const t = setInterval(fetchPause, 15000)
      return () => clearInterval(t)
    }, [fetchPause])
    useEffect(() => { onCountChange?.(schedules.length) }, [schedules.length, onCountChange])

    const openCreate = useCallback(() => { setEditing(null); setShowForm(true) }, [])
    const openEdit = (s: ScheduleRow) => { setEditing(s); setShowForm(true) }
    const closeForm = () => { setEditing(null); setShowForm(false) }

    useImperativeHandle(ref, () => ({ openCreate }), [openCreate])

    const handleToggle = async (s: ScheduleRow) => {
      const next = !s.enabled
      setSchedules(prev => prev.map(x => x.id === s.id
        ? { ...x, enabled: next ? 1 : 0, next_run_at: next ? x.next_run_at : null }
        : x))
      try {
        const res = await fetch(`/api/dispatch/schedules/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ enabled: next }),
        })
        if (!res.ok) throw new Error(`Toggle failed (${res.status})`)
        fetchSchedules()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Toggle failed')
        fetchSchedules()
      }
    }

    const handleDelete = async (s: ScheduleRow) => {
      if (!confirm(`Delete schedule "${s.name}"?`)) return
      try {
        const res = await fetch(`/api/dispatch/schedules/${s.id}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`Delete failed (${res.status})`)
        fetchSchedules()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed')
      }
    }

    const handleRunNow = async (s: ScheduleRow) => {
      try {
        const res = await fetch(`/api/dispatch/schedules/${s.id}/run-now`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Run failed (${res.status})`)
        }
        fetchSchedules()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Run failed')
      }
    }

    return (
      <>
        <PauseBanner pause={pause} busy={pauseBusy} onToggle={togglePause} />

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

        {loading && schedules.length === 0 ? (
          <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
            Loading…
          </div>
        ) : schedules.length === 0 ? (
          <div style={{
            padding: '72px 24px',
            textAlign: 'center',
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--bg-surface)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
              No schedules yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 18 }}>
              Create a recurring dispatch to run on its own cadence.
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
              New schedule
            </button>
          </div>
        ) : (
          <ScheduleTable
            schedules={schedules}
            onToggle={handleToggle}
            onEdit={openEdit}
            onDelete={handleDelete}
            onRunNow={handleRunNow}
          />
        )}

        {external.length > 0 && (
          <ExternalMirrorsSection external={external} />
        )}

        {showForm && (
          <ScheduleForm
            initial={editing}
            tasks={tasks}
            routines={routines}
            onClose={closeForm}
            onSaved={() => { closeForm(); fetchSchedules() }}
          />
        )}
      </>
    )
  }
)

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function ScheduleTable({
  schedules,
  onToggle,
  onEdit,
  onDelete,
  onRunNow,
}: {
  schedules: ScheduleRow[]
  onToggle: (s: ScheduleRow) => void
  onEdit: (s: ScheduleRow) => void
  onDelete: (s: ScheduleRow) => void
  onRunNow: (s: ScheduleRow) => void
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
          gridTemplateColumns: '1fr 200px 140px 140px 72px 220px',
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
        <div>Cron</div>
        <div>Next run</div>
        <div>Last run</div>
        <div>Enabled</div>
        <div style={{ textAlign: 'right' }}>Actions</div>
      </div>
      {schedules.map((s, idx) => (
        <ScheduleRowView
          key={s.id}
          schedule={s}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onRunNow={onRunNow}
          isLast={idx === schedules.length - 1}
        />
      ))}
    </div>
  )
}

function ScheduleRowView({
  schedule,
  onToggle,
  onEdit,
  onDelete,
  onRunNow,
  isLast,
}: {
  schedule: ScheduleRow
  onToggle: (s: ScheduleRow) => void
  onEdit: (s: ScheduleRow) => void
  onDelete: (s: ScheduleRow) => void
  onRunNow: (s: ScheduleRow) => void
  isLast: boolean
}) {
  const isEnabled = schedule.enabled === 1
  const lastStatusColor = schedule.last_status
    ? STATUS_DOT[schedule.last_status] || 'var(--text-muted)'
    : 'var(--text-muted)'
  const opacity = isEnabled ? 1 : 0.55
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await fetch(`/api/dispatch/schedules/${schedule.id}/history?limit=25`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = await res.json()
      setHistory(data.history || [])
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setHistoryLoading(false)
    }
  }, [schedule.id])

  const toggleExpanded = () => {
    const next = !expanded
    setExpanded(next)
    if (next && history === null) loadHistory()
  }

  const target = schedule.type === 'multistep'
    ? schedule.routine_name
      ? `→ routine: ${schedule.routine_name}`
      : schedule.routine_id
        ? `→ routine #${schedule.routine_id}`
        : '— (routine missing)'
    : schedule.task_id
      ? schedule.task_title
        ? `→ ${schedule.task_title}`
        : `→ task #${schedule.task_id}`
      : schedule.input_context
        ? `→ ${schedule.input_context.slice(0, 40)}${schedule.input_context.length > 40 ? '…' : ''}`
        : '—'

  const typeBadge: { label: string; color: string } = schedule.type === 'multistep'
    ? { label: 'ROUTINE', color: 'var(--accent)' }
    : schedule.type === 'heartbeat'
      ? { label: 'HEARTBEAT', color: 'var(--status-active)' }
      : { label: 'CRON', color: 'var(--text-muted)' }

  return (
    <>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px 140px 140px 72px 220px',
        gap: 16,
        padding: '14px 18px',
        alignItems: 'center',
        borderBottom: (isLast && !expanded) ? 'none' : '1px solid var(--border)',
        opacity,
        transition: 'opacity 0.15s',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 3,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.08em',
            padding: '2px 6px',
            borderRadius: 4,
            border: `1px solid ${typeBadge.color}`,
            color: typeBadge.color,
            background: 'transparent',
            flexShrink: 0,
          }}>
            {typeBadge.label}
          </span>
          <div style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}>
            {schedule.name}
          </div>
        </div>
        <div style={{
          fontSize: 12,
          color: 'var(--text-dim)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{schedule.agent_id}</span>
          {' · '}
          {target}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {schedule.cron_expr}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginTop: 2,
          }}
          title={humanizeCron(schedule.cron_expr)}
        >
          {humanizeCron(schedule.cron_expr)}
        </div>
      </div>

      <div>
        {isEnabled && schedule.next_run_at ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              {relativeFromNow(schedule.next_run_at)}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-muted)',
            }}>
              {formatClock(schedule.next_run_at, schedule.timezone)}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {isEnabled ? '—' : 'paused'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        {schedule.last_run_at ? (
          <>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: lastStatusColor,
              flexShrink: 0,
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                {relativeFromNow(schedule.last_run_at)}
              </div>
              {schedule.last_status === 'error' && schedule.last_error && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--status-overdue)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 130,
                  }}
                  title={schedule.last_error}
                >
                  {schedule.last_error}
                </div>
              )}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>never</span>
        )}
      </div>

      <div>
        <ToggleSwitch checked={isEnabled} onChange={() => onToggle(schedule)} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <RowButton label="Run" onClick={() => onRunNow(schedule)} accent />
        <RowButton label={expanded ? 'Hide' : 'History'} onClick={toggleExpanded} />
        <RowButton label="Edit" onClick={() => onEdit(schedule)} />
        <RowButton label="Delete" onClick={() => onDelete(schedule)} danger />
      </div>
    </div>
    {expanded && (
      <ScheduleHistoryPane
        schedule={schedule}
        history={history}
        loading={historyLoading}
        error={historyError}
        onReload={loadHistory}
        isLast={isLast}
      />
    )}
    </>
  )
}

function ScheduleHistoryPane({
  schedule,
  history,
  loading,
  error,
  onReload,
  isLast,
}: {
  schedule: ScheduleRow
  history: HistoryEntry[] | null
  loading: boolean
  error: string | null
  onReload: () => void
  isLast: boolean
}) {
  const metaLine: string[] = []
  if (schedule.skip_if_running) metaLine.push('skip if running')
  if (schedule.retry_on_failure) {
    const max = schedule.max_retries ?? 0
    metaLine.push(`retry ×${max} on failure`)
  }
  if ((schedule.failure_count ?? 0) > 0) {
    metaLine.push(`current failures: ${schedule.failure_count}`)
  }
  return (
    <div
      style={{
        padding: '12px 18px 18px 18px',
        background: 'var(--bg)',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
        }}>
          Recent fires{metaLine.length > 0 ? ` · ${metaLine.join(' · ')}` : ''}
        </div>
        <button
          onClick={onReload}
          style={{
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-dim)',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>
      {loading && history === null ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}>
          Loading…
        </div>
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--status-overdue)' }}>
          {error}
        </div>
      ) : !history || history.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
          No fires recorded yet.
        </div>
      ) : (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--bg-surface)',
        }}>
          {history.map((entry, i) => (
            <HistoryRow
              key={entry.dispatch_id}
              entry={entry}
              isLast={i === history.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryRow({ entry, isLast }: { entry: HistoryEntry; isLast: boolean }) {
  const statusColor =
    entry.status === 'done' || entry.status === 'approved'
      ? 'var(--status-completed)'
      : entry.status === 'failed'
        ? 'var(--status-overdue)'
        : entry.status === 'working' || entry.status === 'queued'
          ? 'var(--status-active)'
          : 'var(--text-muted)'

  const durationSec = entry.started_at && entry.completed_at
    ? entry.completed_at - entry.started_at
    : null
  const durationLabel = durationSec !== null
    ? durationSec < 60
      ? `${durationSec}s`
      : `${Math.floor(durationSec / 60)}m`
    : null

  return (
    <a
      href={`/dispatch/${entry.dispatch_id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr 140px 90px 72px',
        gap: 12,
        padding: '9px 14px',
        alignItems: 'center',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: statusColor,
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {entry.task_title || `Dispatch #${entry.dispatch_id}`}
        </div>
        {entry.error && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--status-overdue)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={entry.error}
          >
            {entry.error}
          </div>
        )}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}>
        {relativeFromNow(entry.created_at)}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}>
        {durationLabel ?? '—'}
      </div>
      <div style={{
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: statusColor,
        textAlign: 'right',
      }}>
        {entry.status}
      </div>
    </a>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      aria-pressed={checked}
      style={{
        width: 34,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: checked ? 'var(--accent)' : 'var(--bg-elevated)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  )
}

function RowButton({
  label,
  onClick,
  danger,
  accent,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  accent?: boolean
}) {
  const baseColor = accent
    ? 'var(--accent-text)'
    : danger
      ? 'var(--status-overdue)'
      : 'var(--text-secondary)'
  const baseBorder = accent ? 'var(--accent)' : 'var(--border)'
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '5px 10px',
        borderRadius: 6,
        border: `1px solid ${baseBorder}`,
        background: accent ? 'rgba(217, 119, 87, 0.08)' : 'transparent',
        color: baseColor,
        cursor: 'pointer',
        transition: 'border-color 0.15s, color 0.15s, background 0.15s',
        fontWeight: accent ? 500 : 400,
      }}
      onMouseEnter={e => {
        if (accent) {
          e.currentTarget.style.background = 'var(--accent)'
          e.currentTarget.style.color = 'var(--accent-fg)'
          return
        }
        e.currentTarget.style.borderColor = danger ? 'var(--status-overdue)' : 'var(--accent)'
        if (!danger) e.currentTarget.style.color = 'var(--accent-text)'
      }}
      onMouseLeave={e => {
        if (accent) {
          e.currentTarget.style.background = 'rgba(217, 119, 87, 0.08)'
          e.currentTarget.style.color = baseColor
          return
        }
        e.currentTarget.style.borderColor = 'var(--border)'
        if (!danger) e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Create / Edit modal
// ---------------------------------------------------------------------------

function ScheduleForm({
  initial,
  tasks,
  routines,
  onClose,
  onSaved,
}: {
  initial: ScheduleRow | null
  tasks: TaskPickerItem[]
  routines: RoutinePickerItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const parsed = useMemo(() => {
    if (initial) return parseCron(initial.cron_expr)
    return { freq: 'daily' as Frequency, hour: 9, minute: 0, dow: 1, dom: 1 }
  }, [initial])

  const [type, setType] = useState<ScheduleType>(initial?.type || 'cron')
  const [routineId, setRoutineId] = useState<number | null>(initial?.routine_id ?? null)
  const [name, setName] = useState(initial?.name || '')
  const [freq, setFreq] = useState<Frequency>(parsed.freq)
  const [hour, setHour] = useState(parsed.hour)
  const [minute, setMinute] = useState(parsed.minute)
  const [dow, setDow] = useState(parsed.dow)
  const [dom, setDom] = useState(parsed.dom)
  const [customCron, setCustomCron] = useState(
    initial && parsed.freq === 'custom' ? initial.cron_expr : '0 9 * * *'
  )
  const [agentId, setAgentId] = useState(initial?.agent_id || 'team')
  const [targetMode, setTargetMode] = useState<'task' | 'prompt'>(
    initial?.task_id ? 'task' : 'prompt'
  )
  const [taskId, setTaskId] = useState<number | null>(initial?.task_id ?? null)
  const [taskSearch, setTaskSearch] = useState('')
  const [inputContext, setInputContext] = useState(initial?.input_context || '')
  const [skipIfRunning, setSkipIfRunning] = useState(initial?.skip_if_running === 1)
  const [retryOnFailure, setRetryOnFailure] = useState(initial?.retry_on_failure === 1)
  const [maxRetries, setMaxRetries] = useState(initial?.max_retries ?? 3)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const effectiveCron = freq === 'custom'
    ? customCron.trim()
    : buildCron(freq, hour, minute, dow, dom)

  const filteredTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase()
    if (!q) return tasks.slice(0, 20)
    return tasks.filter(t =>
      t.title.toLowerCase().includes(q) || t.public_id.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [tasks, taskSearch])

  const save = async () => {
    setFormError(null)
    if (!name.trim()) { setFormError('Name is required'); return }
    if (!effectiveCron) { setFormError('Cron expression is required'); return }

    if (type === 'multistep') {
      if (!routineId) { setFormError('Pick a routine'); return }
    } else {
      if (targetMode === 'task' && !taskId) { setFormError('Pick a task or switch to custom prompt'); return }
      if (targetMode === 'prompt' && !inputContext.trim()) { setFormError('Prompt is required'); return }
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      cron_expr: effectiveCron,
      timezone: 'America/Vancouver',
      type,
      skip_if_running: skipIfRunning,
      retry_on_failure: retryOnFailure,
      max_retries: Math.max(0, Math.min(20, Math.floor(maxRetries))),
    }

    if (type === 'multistep') {
      body.routine_id = routineId
      body.agent_id = 'orchestrator'
      body.task_id = null
      body.input_context = null
    } else {
      body.agent_id = agentId
      body.routine_id = null
      if (targetMode === 'task') {
        body.task_id = taskId
        body.input_context = null
      } else {
        body.input_context = inputContext.trim()
        body.task_id = null
      }
    }

    setSaving(true)
    try {
      const url = initial
        ? `/api/dispatch/schedules/${initial.id}`
        : '/api/dispatch/schedules'
      const method = initial ? 'PATCH' : 'POST'
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

  const pickedTask = tasks.find(t => t.id === taskId)

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
          maxWidth: 560,
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
            {initial ? 'Edit schedule' : 'New schedule'}
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

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Weekly Square revenue"
            style={fieldInputStyle}
            autoFocus
          />
        </Field>

        <Field label="Type">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <TypeCard
              label="Cron"
              sublabel="Single agent on a cron"
              active={type === 'cron'}
              onClick={() => setType('cron')}
            />
            <TypeCard
              label="Heartbeat"
              sublabel="Mac bridge gathers local context"
              active={type === 'heartbeat'}
              onClick={() => setType('heartbeat')}
            />
            <TypeCard
              label="Multistep"
              sublabel="Run a saved routine"
              active={type === 'multistep'}
              onClick={() => setType('multistep')}
            />
          </div>
        </Field>

        <Field label="Frequency">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['daily', 'weekly', 'monthly', 'custom'] as Frequency[]).map(f => (
              <FreqChip
                key={f}
                label={f.charAt(0).toUpperCase() + f.slice(1)}
                active={freq === f}
                onClick={() => setFreq(f)}
              />
            ))}
          </div>
        </Field>

        {freq !== 'custom' && (
          <Field label="When">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {freq === 'weekly' && (
                <select
                  value={dow}
                  onChange={e => setDow(Number(e.target.value))}
                  style={fieldInputStyle}
                >
                  {DAY_LABELS.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              )}
              {freq === 'monthly' && (
                <select
                  value={dom}
                  onChange={e => setDom(Number(e.target.value))}
                  style={fieldInputStyle}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>Day {n}</option>
                  ))}
                </select>
              )}
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>at</span>
              <select
                value={hour}
                onChange={e => setHour(Number(e.target.value))}
                style={{ ...fieldInputStyle, minWidth: 80 }}
              >
                {Array.from({ length: 24 }, (_, i) => i).map(h => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </select>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>:</span>
              <select
                value={minute}
                onChange={e => setMinute(Number(e.target.value))}
                style={{ ...fieldInputStyle, minWidth: 80 }}
              >
                {[0, 15, 30, 45].map(m => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
              <span style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                Pacific
              </span>
            </div>
            <div style={{
              marginTop: 8,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
            }}>
              cron: {effectiveCron}
            </div>
          </Field>
        )}

        {freq === 'custom' && (
          <Field label="Cron expression">
            <input
              type="text"
              value={customCron}
              onChange={e => setCustomCron(e.target.value)}
              placeholder="0 9 * * *"
              style={{ ...fieldInputStyle, fontFamily: 'var(--font-mono)' }}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              Standard 5-field cron. Evaluated in America/Vancouver.
            </div>
          </Field>
        )}

        {type === 'multistep' ? (
          <Field label="Routine">
            {routines.length === 0 ? (
              <div style={{
                padding: '14px 16px',
                border: '1px dashed var(--border)',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--text-dim)',
                lineHeight: 1.5,
              }}>
                No routines yet. Open the <strong>Routines</strong> tab to create one first.
              </div>
            ) : (
              <select
                value={routineId ?? ''}
                onChange={e => setRoutineId(e.target.value ? Number(e.target.value) : null)}
                style={fieldInputStyle}
              >
                <option value="">Pick a routine…</option>
                {routines.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.step_count} step{r.step_count === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            )}
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              Each fire clones the routine into a new parent task with subtasks. Dependencies wire up from each step&apos;s blocked-by.
            </div>
          </Field>
        ) : (
          <>
            <Field label="Agent">
              <select
                value={agentId}
                onChange={e => setAgentId(e.target.value)}
                style={fieldInputStyle}
              >
                {DISPATCH_AGENT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Target">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <FreqChip
              label="Link to task"
              active={targetMode === 'task'}
              onClick={() => setTargetMode('task')}
            />
            <FreqChip
              label="Custom prompt"
              active={targetMode === 'prompt'}
              onClick={() => setTargetMode('prompt')}
            />
          </div>

          {targetMode === 'task' ? (
            <div>
              {pickedTask ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  border: '1px solid var(--accent)',
                  borderRadius: 8,
                  marginBottom: 8,
                  background: 'rgba(217, 119, 87, 0.06)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {pickedTask.title}
                    </div>
                    <div style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}>
                      {pickedTask.public_id}
                    </div>
                  </div>
                  <button
                    onClick={() => setTaskId(null)}
                    style={{
                      fontSize: 12,
                      color: 'var(--text-dim)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 4,
                    }}
                  >
                    clear
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={taskSearch}
                    onChange={e => setTaskSearch(e.target.value)}
                    placeholder="Search recent tasks…"
                    style={fieldInputStyle}
                  />
                  {filteredTasks.length > 0 && (
                    <div style={{
                      marginTop: 6,
                      maxHeight: 180,
                      overflowY: 'auto',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg)',
                    }}>
                      {filteredTasks.map(t => (
                        <button
                          key={t.id}
                          onClick={() => setTaskId(t.id)}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '1px solid var(--border)',
                            cursor: 'pointer',
                            fontSize: 13,
                            color: 'var(--text)',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {t.title}
                          </div>
                          <div style={{
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-muted)',
                          }}>
                            {t.public_id}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <textarea
              value={inputContext}
              onChange={e => setInputContext(e.target.value)}
              placeholder="e.g. Pull this week's Square revenue for Client A brand and post a summary"
              rows={4}
              style={{
                ...fieldInputStyle,
                resize: 'vertical',
                fontFamily: 'var(--font-sans)',
                lineHeight: 1.5,
              }}
            />
          )}
        </Field>
          </>
        )}

        <Field label="Reliability">
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg)',
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--text)',
            }}>
              <input
                type="checkbox"
                checked={skipIfRunning}
                onChange={e => setSkipIfRunning(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--accent)' }}
              />
              <span>
                Skip if a prior run is still active
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  Prevents overlap when a slow job is still queued or working.
                </div>
              </span>
            </label>
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--text)',
            }}>
              <input
                type="checkbox"
                checked={retryOnFailure}
                onChange={e => setRetryOnFailure(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--accent)' }}
              />
              <span>
                Retry on failure
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  On error, re-fire on the next minute instead of waiting for the next scheduled slot.
                </div>
              </span>
            </label>
            {retryOnFailure && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                paddingLeft: 26,
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Max retries:</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={maxRetries}
                  onChange={e => setMaxRetries(Number(e.target.value))}
                  style={{ ...fieldInputStyle, width: 72, padding: '6px 8px' }}
                />
              </div>
            )}
          </div>
        </Field>

        {formError && (
          <div style={{
            marginTop: 4,
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
            {saving ? 'Saving…' : (initial ? 'Save changes' : 'Create schedule')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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

function ExternalMirrorsSection({ external }: { external: ExternalSchedule[] }) {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <h3 style={{
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          margin: 0,
        }}>
          External mirrors
        </h3>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Read-only · edit on the host
        </div>
      </div>
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--bg-surface)',
      }}>
        {external.map((row, idx) => {
          const badgeColor = row.source === 'hetzner-crontab'
            ? 'var(--status-active)'
            : 'var(--accent)'
          const badgeLabel = row.source === 'hetzner-crontab' ? 'HETZNER' : 'MAC'
          return (
            <div
              key={`${row.source}-${idx}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 200px 140px',
                gap: 16,
                padding: '14px 18px',
                alignItems: 'center',
                borderBottom: idx === external.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 3,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${badgeColor}`,
                    color: badgeColor,
                    flexShrink: 0,
                  }}>
                    {badgeLabel}
                  </span>
                  <div style={{
                    fontSize: 13,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}>
                    {row.label}
                  </div>
                </div>
                <div style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {row.location}
                </div>
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {row.schedule_hint}
              </div>
              <div style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {row.program || '—'}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        These run outside Motion. Hetzner cron is live-parsed from <code style={{ fontFamily: 'var(--font-mono)' }}>crontab -l</code>; Mac launchd entries are hand-seeded until the dispatch-bridge syncs its own plist inventory.
      </div>
    </div>
  )
}

function TypeCard({
  label,
  sublabel,
  active,
  onClick,
}: {
  label: string
  sublabel: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 140,
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'rgba(217, 119, 87, 0.1)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{
        fontSize: 13,
        fontWeight: 500,
        color: active ? 'var(--accent-text)' : 'var(--text)',
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        {sublabel}
      </div>
    </button>
  )
}

function FreqChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'rgba(217, 119, 87, 0.1)' : 'transparent',
        color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
        fontSize: 12,
        fontWeight: active ? 500 : 400,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s, color 0.15s',
      }}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Pause banner — global schedules kill switch
// ---------------------------------------------------------------------------

function PauseBanner({
  pause,
  busy,
  onToggle,
}: {
  pause: { paused: boolean; since: number | null; reason: string | null; by: string | null }
  busy: boolean
  onToggle: (next: boolean) => void
}) {
  if (pause.paused) {
    const sinceText = pause.since ? new Date(pause.since * 1000).toLocaleString() : ''
    return (
      <div style={{
        marginBottom: 16,
        padding: '12px 16px',
        borderRadius: 10,
        border: '1px solid var(--status-overdue)',
        background: 'rgba(214, 77, 77, 0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        <span style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--status-overdue)',
          boxShadow: '0 0 0 3px color-mix(in oklab, var(--status-overdue) 18%, transparent)',
        }} />
        <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Schedules paused</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {sinceText && <>Since {sinceText}</>}
            {pause.by && <> · by {pause.by}</>}
            {pause.reason && <> · {pause.reason}</>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Nothing new will be enqueued. Already-queued dispatches keep draining.
          </div>
        </div>
        <button
          onClick={() => onToggle(false)}
          disabled={busy}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: '1px solid var(--accent)',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            fontSize: 12,
            fontWeight: 500,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Resume
        </button>
      </div>
    )
  }

  return (
    <div style={{
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
    }}>
      <button
        onClick={() => onToggle(true)}
        disabled={busy}
        title="Stop all scheduled dispatches from firing until you resume"
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          fontSize: 12,
          fontWeight: 400,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
        onMouseEnter={e => { if (!busy) e.currentTarget.style.borderColor = 'var(--status-overdue)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        Pause all
      </button>
    </div>
  )
}
