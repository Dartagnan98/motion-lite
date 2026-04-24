'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/PageHeader'
import { IconArrowRight } from '@/components/ui/Icons'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Message {
  id: number
  dispatch_id: number
  role: 'user' | 'agent' | 'system'
  content: string
  token_count: number
  created_at: number
}

interface DispatchState {
  id: number
  task_id: number | null
  task_title: string | null
  project_name: string | null
  agent_id: string
  status: string
  session_id: string | null
  result_summary: string | null
  error: string | null
  attempt_count: number
  heartbeat_at: number | null
  started_at: number | null
  completed_at: number | null
  run_type: string
}

interface DispatchEvent {
  id: number
  ts: number
  kind: string
  payload: unknown
}

const TERMINAL_STATUSES = new Set(['done', 'approved', 'needs_review', 'failed', 'cancelled'])

// ─── Style tokens ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  queued:       { label: 'Queued',       color: 'var(--status-active)' },
  working:      { label: 'Working',      color: 'var(--accent)' },
  needs_review: { label: 'Needs review', color: 'var(--status-overdue)' },
  done:         { label: 'Done',         color: 'var(--status-completed)' },
  approved:     { label: 'Approved',     color: 'var(--status-completed)' },
  failed:       { label: 'Failed',       color: 'var(--status-overdue)' },
  cancelled:    { label: 'Cancelled',    color: 'var(--text-muted)' },
}

function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function workingFor(startedAt: number | null): string {
  if (!startedAt) return ''
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - startedAt))
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`
}

function formatClockTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function truncate(s: string, max = 180): string {
  if (s.length <= max) return s
  return s.slice(0, max).trimEnd() + '…'
}

function formatEventLine(ev: DispatchEvent): { label: string; text: string; color: string } {
  const p = ev.payload as Record<string, unknown> | string | null | undefined
  const asObj = (typeof p === 'object' && p !== null) ? (p as Record<string, unknown>) : null
  switch (ev.kind) {
    case 'tool_use': {
      const tool = String(asObj?.tool ?? '?')
      const summary = String(asObj?.input_summary ?? '')
      return { label: 'tool', text: summary ? `${tool}(${truncate(summary, 140)})` : tool, color: 'var(--accent)' }
    }
    case 'tool_result': {
      const isErr = !!asObj?.is_error
      const summary = String(asObj?.result_summary ?? '')
      return {
        label: isErr ? 'tool-err' : 'tool-ok',
        text: truncate(summary),
        color: isErr ? 'var(--status-overdue)' : 'var(--status-completed)',
      }
    }
    case 'text':
      return {
        label: 'text',
        text: truncate(typeof p === 'string' ? p : String(asObj?.text ?? JSON.stringify(p ?? ''))),
        color: 'var(--text-dim)',
      }
    case 'result':
      return {
        label: 'done',
        text: truncate(String(asObj?.text_summary ?? JSON.stringify(p ?? ''))),
        color: 'var(--accent)',
      }
    case 'error':
      return {
        label: 'error',
        text: truncate(typeof p === 'string' ? p : String(asObj?.message ?? JSON.stringify(p ?? ''))),
        color: 'var(--status-overdue)',
      }
    case 'phase': {
      const phase = String(asObj?.phase ?? '')
      const agent = String(asObj?.agent ?? '')
      return { label: 'phase', text: [phase, agent].filter(Boolean).join(' · '), color: 'var(--status-active)' }
    }
    case 'system':
      return {
        label: 'system',
        text: truncate(typeof p === 'string' ? p : String(asObj?.note ?? JSON.stringify(p ?? ''))),
        color: 'var(--text-muted)',
      }
    default:
      return {
        label: ev.kind,
        text: truncate(typeof p === 'string' ? p : JSON.stringify(p ?? '')),
        color: 'var(--text-muted)',
      }
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DispatchChatPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = parseInt(params?.id ?? '0', 10)

  const [dispatch, setDispatch] = useState<DispatchState | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const lastMessageIdRef = useRef<number>(0)

  const [events, setEvents] = useState<DispatchEvent[]>([])
  const [showActivity, setShowActivity] = useState(true)
  const lastEventIdRef = useRef<number>(0)
  const finalBackfillRef = useRef<boolean>(false)
  const activityScrollerRef = useRef<HTMLDivElement | null>(null)

  // ── Load + poll ──
  const refresh = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) return
    try {
      const res = await fetch(`/api/dispatch/${id}/chat`, { cache: 'no-store' })
      if (!res.ok) {
        if (res.status === 404) setError('Dispatch not found.')
        else if (res.status === 401) setError('Sign in required.')
        else setError(`Failed to load (${res.status})`)
        return
      }
      const data = await res.json()
      setDispatch(data.dispatch)
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setError(null)
    } catch {
      // keep prior state, silent retry
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [id, refresh])

  // ── Autoscroll on new messages ──
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const lastId = messages.length ? messages[messages.length - 1].id : 0
    if (lastId > lastMessageIdRef.current) {
      lastMessageIdRef.current = lastId
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  // ── Live dispatch events ──
  // Poll every 1s while the dispatch is queued/working so the user sees tool
  // calls and text as they happen. Once the status flips to terminal, do one
  // final fetch (to catch the very last events the bridge shipped in the
  // moments before completion) and stop. Use lastEventIdRef so each call is
  // incremental rather than re-downloading the whole stream.
  useEffect(() => {
    if (!Number.isFinite(id) || id <= 0) return
    if (!dispatch) return
    const isTerminal = TERMINAL_STATUSES.has(dispatch.status)
    let cancelled = false

    async function fetchEvents() {
      try {
        const res = await fetch(`/api/dispatch/${id}/events?after=${lastEventIdRef.current}`, { cache: 'no-store' })
        if (cancelled || !res.ok) return
        const data = await res.json()
        const incoming = Array.isArray(data?.events) ? (data.events as DispatchEvent[]) : []
        if (incoming.length > 0) {
          setEvents(prev => [...prev, ...incoming])
          const newLast = typeof data.lastId === 'number'
            ? data.lastId
            : incoming[incoming.length - 1].id
          lastEventIdRef.current = newLast
        }
      } catch {
        // silent retry
      }
    }

    fetchEvents()

    if (isTerminal) {
      // Single backfill after the dispatch finishes; no interval.
      if (!finalBackfillRef.current) {
        finalBackfillRef.current = true
        // second fetch a moment later to catch events that raced in with completion
        const lateTimer = setTimeout(fetchEvents, 800)
        return () => { cancelled = true; clearTimeout(lateTimer) }
      }
      return () => { cancelled = true }
    }

    const t = setInterval(fetchEvents, 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [id, dispatch])

  // Autoscroll the activity pane to the bottom on new events.
  useEffect(() => {
    const el = activityScrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [events.length])

  // ── Compose ──
  const isWorking = dispatch?.status === 'working'
  const isQueued = dispatch?.status === 'queued'
  const composerDisabled = sending || isWorking || isQueued

  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`
  }, [])

  const send = useCallback(async () => {
    const content = draft.trim()
    if (!content || composerDisabled) return
    setSending(true)
    setSendError(null)
    // Optimistic turn
    const optimistic: Message = {
      id: -Date.now(),
      dispatch_id: id,
      role: 'user',
      content,
      token_count: 0,
      created_at: Math.floor(Date.now() / 1000),
    }
    setMessages(prev => [...prev, optimistic])
    setDraft('')
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }

    try {
      const res = await fetch(`/api/dispatch/${id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== optimistic.id))
        setDraft(content)
        setSendError(data.error || `Send failed (${res.status})`)
      } else {
        // Replace optimistic with real id once poll catches up
        refresh()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Send failed'
      setMessages(prev => prev.filter(m => m.id !== optimistic.id))
      setDraft(content)
      setSendError(message)
    } finally {
      setSending(false)
    }
  }, [draft, composerDisabled, id, refresh])

  // ── Render ──
  const statusConfig = dispatch ? (STATUS_CONFIG[dispatch.status] ?? { label: dispatch.status, color: 'var(--text-muted)' }) : null

  const agentLabel = useMemo(() => {
    if (!dispatch) return 'Agent'
    const raw = dispatch.agent_id || 'claude'
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }, [dispatch])

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      <PageHeader
        title={dispatch?.task_title || `Dispatch #${id}`}
        subtitle={
          dispatch
            ? [
                agentLabel,
                dispatch.project_name || null,
                dispatch.session_id ? 'resumed session' : null,
              ].filter(Boolean).join(' · ')
            : 'Loading thread…'
        }
        secondaryAction={{ label: 'Back to board', onClick: () => router.push('/dispatch') }}
      />

      {/* Status strip */}
      {statusConfig && dispatch ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 32px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            fontFamily: 'var(--font-mono, ui-monospace)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-dim)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: statusConfig.color,
              boxShadow: dispatch.status === 'working' ? `0 0 0 0 ${statusConfig.color}` : 'none',
              animation: dispatch.status === 'working' ? 'dispatch-pulse 1.4s ease-out infinite' : 'none',
            }} />
            <span style={{ color: statusConfig.color, fontWeight: 600 }}>{statusConfig.label}</span>
          </span>
          {dispatch.status === 'working' && dispatch.started_at ? (
            <span>Working {workingFor(dispatch.started_at)}</span>
          ) : null}
          {dispatch.status !== 'working' && dispatch.completed_at ? (
            <span>Finished {relativeTime(dispatch.completed_at)}</span>
          ) : null}
          {dispatch.attempt_count > 1 ? <span>Attempt {dispatch.attempt_count}</span> : null}
        </div>
      ) : null}

      {/* Activity panel — live SDK event stream from the bridge */}
      {dispatch ? (
        <ActivityPanel
          events={events}
          expanded={showActivity}
          onToggle={() => setShowActivity(v => !v)}
          scrollerRef={activityScrollerRef}
          isLive={dispatch.status === 'working' || dispatch.status === 'queued'}
        />
      ) : null}

      {/* Thread */}
      <div ref={scrollerRef} style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 32px 24px' }}>
          {loading && messages.length === 0 ? (
            <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
              Loading thread…
            </div>
          ) : error ? (
            <div style={{ padding: '40px 20px', color: 'var(--status-overdue)', fontSize: 14 }}>{error}</div>
          ) : messages.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
              No messages yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} agentLabel={agentLabel} />
              ))}
              {isWorking ? <WorkingIndicator agentLabel={agentLabel} /> : null}
              {isQueued && !isWorking ? <QueuedIndicator /> : null}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '14px 32px 18px' }}>
          {sendError ? (
            <div style={{ fontSize: 12, color: 'var(--status-overdue)', marginBottom: 8 }}>{sendError}</div>
          ) : null}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 12,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              transition: 'border-color 120ms ease',
            }}
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); autoResize() }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send() }
              }}
              placeholder={
                composerDisabled
                  ? (isWorking ? `${agentLabel} is working…` : 'Waiting in queue…')
                  : `Reply to ${agentLabel}…   ⌘+Enter`
              }
              disabled={composerDisabled}
              rows={1}
              style={{
                flex: 1,
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: 14,
                lineHeight: 1.5,
                maxHeight: 260,
                minHeight: 20,
                padding: 0,
                opacity: composerDisabled ? 0.55 : 1,
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={composerDisabled || !draft.trim()}
              aria-label="Send"
              style={{
                flexShrink: 0,
                width: 34,
                height: 34,
                borderRadius: 8,
                border: 'none',
                background: composerDisabled || !draft.trim() ? 'var(--bg-hover)' : 'var(--accent)',
                color: composerDisabled || !draft.trim() ? 'var(--text-muted)' : 'white',
                cursor: composerDisabled || !draft.trim() ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 120ms ease',
              }}
            >
              <IconArrowRight size={16} />
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            {isWorking
              ? 'Session is live. Your next message will queue as soon as the agent finishes.'
              : dispatch?.session_id
                ? 'Continues the same session — the agent keeps full memory of prior turns.'
                : 'First reply starts the thread.'}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes dispatch-pulse {
          0%   { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 50%, transparent); }
          70%  { box-shadow: 0 0 0 8px color-mix(in oklab, var(--accent) 0%, transparent); }
          100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 0%, transparent); }
        }
      `}</style>
    </div>
  )
}

// ─── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ message, agentLabel }: { message: Message; agentLabel: string }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '4px 0' }}>
        {message.content}
      </div>
    )
  }

  const label = isUser ? 'You' : agentLabel
  const labelColor = isUser ? 'var(--text-dim)' : 'var(--accent)'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-mono, ui-monospace)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}
      >
        <span style={{ color: labelColor, fontWeight: 600 }}>{label}</span>
        <span>·</span>
        <span>{relativeTime(message.created_at)}</span>
      </div>
      <div
        style={{
          maxWidth: '88%',
          padding: '12px 16px',
          borderRadius: 14,
          background: isUser ? 'var(--bg-surface)' : 'var(--bg-panel)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
        }}
      >
        {message.content}
      </div>
    </div>
  )
}

function WorkingIndicator({ agentLabel }: { agentLabel: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono, ui-monospace)',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--accent)',
          fontWeight: 600,
        }}
      >
        {agentLabel}
      </div>
      <div
        style={{
          padding: '14px 18px',
          borderRadius: 14,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Dot delay={0} />
        <Dot delay={180} />
        <Dot delay={360} />
        <style jsx>{`
          @keyframes dispatch-dot {
            0%, 60%, 100% { opacity: 0.2; transform: translateY(0); }
            30%           { opacity: 1;   transform: translateY(-2px); }
          }
        `}</style>
      </div>
    </div>
  )
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: 'var(--accent)',
        animation: `dispatch-dot 1.2s ease-in-out ${delay}ms infinite`,
      }}
    />
  )
}

function QueuedIndicator() {
  return (
    <div
      style={{
        alignSelf: 'flex-start',
        fontFamily: 'var(--font-mono, ui-monospace)',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
        padding: '8px 14px',
        borderRadius: 10,
        background: 'var(--bg-surface)',
        border: '1px dashed var(--border)',
      }}
    >
      Queued for pickup…
    </div>
  )
}

// ─── Activity panel ────────────────────────────────────────────────────────
// Streams Claude Code SDK events from the bridge as they happen. Collapsible
// so it doesn't dominate the chat surface, but defaults open so the user sees
// tool calls the moment a dispatch goes live.

function ActivityPanel({
  events,
  expanded,
  onToggle,
  scrollerRef,
  isLive,
}: {
  events: DispatchEvent[]
  expanded: boolean
  onToggle: () => void
  scrollerRef: React.RefObject<HTMLDivElement | null>
  isLive: boolean
}) {
  const count = events.length

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 32px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono, ui-monospace)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-dim)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>Activity</span>
          <span style={{ color: 'var(--text-muted)' }}>
            {count === 0 ? (isLive ? 'waiting for first event…' : 'no events') : `${count} event${count === 1 ? '' : 's'}`}
          </span>
          {isLive ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)' }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'dispatch-pulse 1.4s ease-out infinite',
              }} />
              live
            </span>
          ) : null}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
          {expanded ? 'hide ▾' : 'show ▸'}
        </span>
      </button>

      {expanded ? (
        <div
          ref={scrollerRef}
          style={{
            maxHeight: 220,
            overflowY: 'auto',
            padding: '6px 32px 12px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono, ui-monospace)',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {count === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '12px 0', fontStyle: 'italic' }}>
              {isLive
                ? 'Bridge has not shipped any events yet. If a dispatch has been running for more than a few seconds, event streaming may be offline.'
                : 'No activity was recorded for this dispatch.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {events.map((ev) => {
                const line = formatEventLine(ev)
                return (
                  <div
                    key={ev.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '70px 72px 1fr',
                      gap: 10,
                      padding: '2px 0',
                      color: 'var(--text-dim)',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>{formatClockTime(ev.ts)}</span>
                    <span style={{
                      color: line.color,
                      textTransform: 'lowercase',
                      letterSpacing: '0.04em',
                    }}>
                      {line.label}
                    </span>
                    <span style={{ color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {line.text}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
