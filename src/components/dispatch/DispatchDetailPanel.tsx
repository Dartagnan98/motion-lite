'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconX, IconCheck, IconArrowRight } from '@/components/ui/Icons'
import type { DispatchCard } from '@/app/dispatch/page'
import type { TaskActivity } from '@/lib/types'

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  queued:       { label: 'Queued',       color: 'var(--status-active)',    bg: 'color-mix(in oklab, var(--status-active) 14%, transparent)' },
  working:      { label: 'Working',      color: 'var(--accent)',           bg: 'color-mix(in oklab, var(--accent) 14%, transparent)' },
  needs_review: { label: 'Needs Review', color: 'var(--status-overdue)',   bg: 'color-mix(in oklab, var(--status-overdue) 14%, transparent)' },
  done:         { label: 'Done',         color: 'var(--status-completed)', bg: 'color-mix(in oklab, var(--status-completed) 14%, transparent)' },
  approved:     { label: 'Approved',     color: 'var(--status-completed)', bg: 'color-mix(in oklab, var(--status-completed) 14%, transparent)' },
  failed:       { label: 'Failed',       color: 'var(--status-overdue)',   bg: 'color-mix(in oklab, var(--status-overdue) 14%, transparent)' },
  cancelled:    { label: 'Cancelled',    color: 'var(--text-muted)',       bg: 'var(--bg-hover)' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_COLORS: Record<string, string> = {
  claude:       'var(--status-completed)',
  orchestrator: 'var(--accent)',
  jimmy:        'var(--accent)',
  gary:         'var(--status-active)',
  ricky:        'var(--status-overdue)',
  sofia:        '#b89bd4',
  hank:         '#9c8ad0',
}

function agentColor(agentId: string) {
  return AGENT_COLORS[agentId.toLowerCase()] || 'var(--text-muted)'
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function relativeTime(unixSeconds: number): string {
  const now = Date.now() / 1000
  const diff = now - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(startedAt: number | null, completedAt: number | null): string | null {
  if (!startedAt || !completedAt) return null
  const secs = completedAt - startedAt
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

const ACTIVITY_ICONS: Record<string, { color: string; icon: string }> = {
  dispatch_queued:    { color: 'var(--status-active)',    icon: 'queue' },
  dispatch_started:   { color: 'var(--accent)',           icon: 'play' },
  dispatch_progress:  { color: 'var(--text-dim)',         icon: 'dots' },
  dispatch_completed: { color: 'var(--status-completed)', icon: 'check' },
  dispatch_approved:  { color: 'var(--status-completed)', icon: 'check' },
  dispatch_rejected:  { color: 'var(--status-overdue)',   icon: 'x' },
  dispatch_failed:    { color: 'var(--status-overdue)',   icon: 'x' },
}

interface DispatchThread {
  id: number
  agent_id: string
  status: string
  run_type?: 'single' | 'team_parent' | 'team_child'
  parent_dispatch_id?: number | null
  specialist_role?: string | null
  result_summary: string | null
  error: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
  token_count: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DispatchDetailPanel({
  dispatch,
  onClose,
  onAction,
  onOpenTask,
}: {
  dispatch: DispatchCard
  onClose: () => void
  onAction: () => void
  onOpenTask?: (taskId: number) => void
}) {
  const [activities, setActivities] = useState<TaskActivity[]>([])
  const [childDispatches, setChildDispatches] = useState<DispatchThread[]>([])
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)

  const status = STATUS_CONFIG[dispatch.status] || STATUS_CONFIG.queued
  const isTeamParent = dispatch.run_type === 'team_parent'

  const loadTeamThreads = useCallback(() => {
    if (!isTeamParent) {
      setChildDispatches([])
      return
    }
    fetch(`/api/dispatch/${dispatch.id}`)
      .then(r => r.json())
      .then(data => {
        const children: DispatchThread[] = Array.isArray(data.children) ? data.children : []
        setChildDispatches(prev => {
          if (
            prev.length === children.length &&
            prev.every((item, idx) => (
              item.id === children[idx]?.id &&
              item.status === children[idx]?.status &&
              item.result_summary === children[idx]?.result_summary &&
              item.error === children[idx]?.error &&
              item.started_at === children[idx]?.started_at &&
              item.completed_at === children[idx]?.completed_at &&
              item.token_count === children[idx]?.token_count
            ))
          ) {
            return prev
          }
          return children
        })
      })
      .catch(() => {})
  }, [dispatch.id, isTeamParent])

  // Fetch activities for this task
  const loadActivities = useCallback(() => {
    if (!dispatch.task_id) return
    fetch(`/api/activities?taskId=${dispatch.task_id}`)
      .then(r => r.json())
      .then(data => {
        const all: TaskActivity[] = data.activities || []
        const relatedDispatchIds = new Set([dispatch.id, ...childDispatches.map(child => child.id)])
        // Filter to current dispatch activities only
        const dispatchActivities = all.filter(a =>
          a.activity_type.startsWith('dispatch_') && (() => {
            if (a.metadata) {
              try {
                const parsed = JSON.parse(a.metadata) as { dispatch_id?: number; parent_dispatch_id?: number }
                if (parsed.dispatch_id && relatedDispatchIds.has(parsed.dispatch_id)) return true
                if (isTeamParent && parsed.parent_dispatch_id === dispatch.id) return true
              } catch { /* ignore invalid metadata */ }
            }
            if (a.message.includes(`Dispatch #${dispatch.id}`) || a.message.includes(`dispatch #${dispatch.id}`)) {
              return true
            }
            if (isTeamParent) {
              for (const child of childDispatches) {
                if (a.message.includes(`Dispatch #${child.id}`) || a.message.includes(`dispatch #${child.id}`)) {
                  return true
                }
              }
            }
            return false
          })()
        )
        setActivities(dispatchActivities)
      })
      .catch(() => {})
  }, [childDispatches, dispatch.id, dispatch.task_id, isTeamParent])

  useEffect(() => {
    loadTeamThreads()
  }, [loadTeamThreads])

  useEffect(() => {
    loadActivities()
  }, [loadActivities])

  // Live refresh while the dispatch is active so progress appears in real-time
  useEffect(() => {
    const isLive = dispatch.status === 'queued' || dispatch.status === 'working'
    if (!isLive) return
    const interval = setInterval(() => {
      loadActivities()
      loadTeamThreads()
      onAction()
    }, 2000)
    return () => clearInterval(interval)
  }, [dispatch.status, loadActivities, loadTeamThreads, onAction])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Focus feedback input when shown
  useEffect(() => {
    if (showRejectInput && feedbackRef.current) {
      feedbackRef.current.focus()
    }
  }, [showRejectInput])

  async function handleAction(action: string, extraBody?: Record<string, string>) {
    setActionLoading(true)
    try {
      await fetch('/api/dispatch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dispatch.id, action, ...extraBody }),
      })
      setShowRejectInput(false)
      setFeedback('')
      onAction()
    } finally {
      setActionLoading(false)
    }
  }

  const isWorking = dispatch.status === 'working'
  const duration = formatDuration(dispatch.started_at, dispatch.completed_at)
  const aColor = agentColor(dispatch.agent_id)

  const metaLabel: React.CSSProperties = {
    fontSize: 13, color: 'var(--text-dim)', flexShrink: 0, width: 84, fontWeight: 400,
  }
  const metaValue: React.CSSProperties = {
    fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 0,
  }
  const metaRow: React.CSSProperties = {
    display: 'flex', alignItems: 'baseline', gap: 12, padding: '5px 0',
  }
  const sectionLabel: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10,
    letterSpacing: '-0.005em',
  }

  const panel = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-5"
      style={{ background: 'var(--scrim, rgba(0,0,0,0.55))' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        className="animate-glass-in flex flex-col"
        style={{
          width: 680,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 40px)',
          background: 'var(--bg-modal)',
          border: '1px solid var(--border-strong)',
          borderRadius: 14,
          boxShadow: 'var(--glass-shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {/* Agent + status row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: `color-mix(in oklab, ${aColor} 18%, transparent)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                color: aColor,
              }}>
                {dispatch.agent_id[0].toUpperCase()}
              </div>
              <span style={{
                fontSize: 13, color: 'var(--text)', fontWeight: 500,
                textTransform: 'capitalize',
              }}>
                {dispatch.agent_id}
              </span>
              {isWorking && (
                <span
                  aria-hidden
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--accent)',
                    animation: 'dispatch-working-pulse 1.6s ease-in-out infinite',
                  }}
                />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 12, fontWeight: 500,
                padding: '3px 10px', borderRadius: 20,
                background: status.bg, color: status.color,
                border: `1px solid color-mix(in oklab, ${status.color} 28%, transparent)`,
              }}>
                {status.label}
              </span>
              <button
                onClick={onClose}
                style={{ padding: 4, borderRadius: 6, background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', lineHeight: 0 }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
                aria-label="Close"
              >
                <IconX size={16} />
              </button>
            </div>
          </div>
          {/* Title */}
          <h2 style={{
            fontSize: 17, fontWeight: 600, color: 'var(--text)',
            lineHeight: 1.35, letterSpacing: '-0.01em', margin: 0,
          }}>
            {dispatch.task_title || dispatch.input_context?.split('\n')[0].slice(0, 80) || `Dispatch #${dispatch.id}`}
          </h2>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 5 }}>
            #{dispatch.id} · {relativeTime(dispatch.created_at)}
          </div>
        </div>

        {/* Meta rows */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {dispatch.project_name && (
            <div style={metaRow}>
              <span style={metaLabel}>Project</span>
              <span style={metaValue}>{dispatch.project_name}</span>
            </div>
          )}
          <div style={metaRow}>
            <span style={metaLabel}>Trigger</span>
            <span style={{ ...metaValue, textTransform: 'capitalize' }}>{dispatch.trigger_type.replace(/_/g, ' ')}</span>
          </div>
          {isTeamParent && (
            <div style={metaRow}>
              <span style={metaLabel}>Threads</span>
              <span style={metaValue}>
                {dispatch.child_done || 0}/{dispatch.child_total || childDispatches.length} done
                {(dispatch.child_failed || 0) > 0 ? `, ${dispatch.child_failed} failed` : ''}
                {(dispatch.child_working || 0) > 0 ? `, ${dispatch.child_working} running` : ''}
              </span>
            </div>
          )}
          {dispatch.started_at && (
            <div style={metaRow}>
              <span style={metaLabel}>Started</span>
              <span style={metaValue}>{formatTimestamp(dispatch.started_at)}</span>
            </div>
          )}
          {duration && (
            <div style={metaRow}>
              <span style={metaLabel}>Duration</span>
              <span style={{ ...metaValue, fontVariantNumeric: 'tabular-nums' }}>{duration}</span>
            </div>
          )}
          {dispatch.token_count > 0 && (
            <div style={metaRow}>
              <span style={metaLabel}>Tokens</span>
              <span style={{ ...metaValue, fontVariantNumeric: 'tabular-nums' }}>
                {dispatch.token_count.toLocaleString()}
                <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
                  ~${(dispatch.token_count * 0.000015).toFixed(3)}
                </span>
              </span>
            </div>
          )}
          {dispatch.task_id && (
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => onOpenTask ? onOpenTask(dispatch.task_id!) : (window.location.href = `/projects-tasks?task=${dispatch.task_id}`)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent-text)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                Open task
                <IconArrowRight size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Result section */}
        {(dispatch.status === 'needs_review' || dispatch.status === 'done') && dispatch.result_summary && (
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={sectionLabel}>Result</div>
            <div style={{
              fontSize: 13, color: 'var(--text)', lineHeight: 1.6,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '12px 14px', maxHeight: 180, overflowY: 'auto',
              whiteSpace: 'pre-wrap',
            }}>
              {dispatch.result_summary}
            </div>
          </div>
        )}

        {/* Error section */}
        {dispatch.error && (
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ ...sectionLabel, color: 'var(--status-overdue)' }}>Error</div>
            <div style={{
              fontSize: 13, color: 'var(--status-overdue)', lineHeight: 1.6,
              background: 'color-mix(in oklab, var(--status-overdue) 8%, transparent)',
              border: '1px solid color-mix(in oklab, var(--status-overdue) 22%, transparent)',
              borderRadius: 10,
              padding: '12px 14px', maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap',
            }}>
              {dispatch.error}
            </div>
          </div>
        )}

        {/* Team specialist threads */}
        {isTeamParent && (
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={sectionLabel}>Threads</div>
            {childDispatches.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>No specialist threads yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {childDispatches.map((child) => {
                  const childStatus = STATUS_CONFIG[child.status] || STATUS_CONFIG.queued
                  const childColor = agentColor(child.agent_id)
                  const childDuration = formatDuration(child.started_at, child.completed_at)
                  const childSummary = (child.result_summary || child.error || (child.status === 'working' ? 'Running specialist thread…' : 'No output yet')).trim()
                  return (
                    <div
                      key={child.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: '10px 12px',
                        background: 'var(--bg-surface)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: childColor, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, textTransform: 'capitalize' }}>
                            {child.specialist_role || child.agent_id}
                          </span>
                          {childDuration && (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>· {childDuration}</span>
                          )}
                        </div>
                        <span style={{
                          fontSize: 12, fontWeight: 500,
                          padding: '2px 8px', borderRadius: 20,
                          background: childStatus.bg, color: childStatus.color,
                          flexShrink: 0,
                        }}>
                          {childStatus.label}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 12.5,
                        color: child.error ? 'var(--status-overdue)' : 'var(--text-dim)',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 72,
                        overflowY: 'auto',
                      }}>
                        {childSummary}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Activity log */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }} className="no-scrollbar">
          <div style={sectionLabel}>Activity</div>
          {isWorking && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 10,
              background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
              border: '1px solid color-mix(in oklab, var(--accent) 22%, transparent)',
              marginBottom: 12,
            }}>
              <span
                aria-hidden
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'dispatch-working-pulse 1.6s ease-in-out infinite',
                }}
              />
              <span style={{ fontSize: 13, color: 'var(--accent-text)' }}>Running…</span>
            </div>
          )}
          {activities.length === 0 && !dispatch.input_context ? (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '12px 0' }}>No activity yet.</div>
          ) : (
            <div>
              {dispatch.input_context && (
                <ActivityEntry
                  type="dispatch_queued"
                  message={dispatch.input_context}
                  timestamp={dispatch.created_at}
                  truncate
                />
              )}
              {activities.map(activity => (
                <ActivityEntry
                  key={activity.id}
                  type={activity.activity_type}
                  message={activity.message}
                  timestamp={activity.created_at}
                />
              ))}
            </div>
          )}
        </div>

        {/* Action bar */}
        {(dispatch.status === 'needs_review' || dispatch.status === 'queued' || dispatch.status === 'working' || dispatch.status === 'done') && (
          <div style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
            background: 'var(--bg-chrome)',
          }}>
            {dispatch.status === 'needs_review' && !showRejectInput && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowRejectInput(true)}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--status-overdue)'; e.currentTarget.style.borderColor = 'color-mix(in oklab, var(--status-overdue) 40%, transparent)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  Reject
                </button>
                <button
                  onClick={() => handleAction('approve')}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 18px', borderRadius: 8, border: 'none',
                    background: 'var(--accent)', color: 'var(--accent-fg)',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
                >
                  Approve
                </button>
              </div>
            )}

            {dispatch.status === 'needs_review' && showRejectInput && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  ref={feedbackRef}
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  placeholder="What needs to change?"
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    background: 'var(--bg-field)', border: '1px solid var(--border)',
                    color: 'var(--text)', fontSize: 13, resize: 'none', outline: 'none',
                    lineHeight: 1.5,
                  }}
                  rows={3}
                  onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setShowRejectInput(false); setFeedback('') }
                    if (e.key === 'Enter' && e.metaKey && feedback.trim()) {
                      handleAction('reject', { feedback: feedback.trim() })
                    }
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setShowRejectInput(false); setFeedback('') }}
                    style={{
                      padding: '8px 16px', borderRadius: 8,
                      background: 'transparent', border: '1px solid var(--border)',
                      color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleAction('reject', { feedback: feedback.trim() })}
                    disabled={actionLoading || !feedback.trim()}
                    style={{
                      padding: '8px 18px', borderRadius: 8, border: 'none',
                      background: 'var(--status-overdue)', color: '#fff',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      opacity: feedback.trim() ? 1 : 0.5,
                    }}
                  >
                    Send feedback
                  </button>
                </div>
              </div>
            )}

            {(dispatch.status === 'queued' || dispatch.status === 'working') && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleAction('cancel')}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--status-overdue)'; e.currentTarget.style.borderColor = 'color-mix(in oklab, var(--status-overdue) 40%, transparent)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  Cancel dispatch
                </button>
              </div>
            )}

            {dispatch.status === 'done' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleAction('redispatch')}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent-text)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
                >
                  Re-dispatch
                  <IconArrowRight size={12} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}

// ---------------------------------------------------------------------------
// Activity entry
// ---------------------------------------------------------------------------

function ActivityEntry({
  type,
  message,
  timestamp,
  truncate,
}: {
  type: string
  message: string
  timestamp: number
  truncate?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const config = ACTIVITY_ICONS[type] || { color: 'var(--text-muted)', icon: 'dots' }
  const TRUNCATE_AT = 180
  const shouldTruncate = truncate && message.length > TRUNCATE_AT && !expanded

  return (
    <div style={{ display: 'flex', gap: 12, paddingBottom: 14 }}>
      {/* Timeline dot + line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: config.color, flexShrink: 0 }} />
        <div style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 4 }} />
      </div>

      {/* Content */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {shouldTruncate ? message.slice(0, TRUNCATE_AT) + '…' : message}
        </div>
        {truncate && message.length > TRUNCATE_AT && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ fontSize: 12, color: 'var(--accent-text)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 2 }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{relativeTime(timestamp)}</div>
      </div>
    </div>
  )
}
