'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DispatchDetailPanel } from '@/components/dispatch/DispatchDetailPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { SchedulesPanel, SchedulesPanelHandle } from '@/components/dispatch/SchedulesPanel'
import { RoutinesPanel, RoutinesPanelHandle } from '@/components/dispatch/RoutinesPanel'
import { ToolsPanel, ToolsPanelHandle } from '@/components/dispatch/ToolsPanel'
import dynamic from 'next/dynamic'
const TaskDetailPanel = dynamic(() => import('@/components/tasks/TaskDetailPanel').then(m => m.TaskDetailPanel), { ssr: false })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchCard {
  id: number
  task_id: number | null
  agent_id: string
  run_type?: 'single' | 'team_parent' | 'team_child'
  parent_dispatch_id?: number | null
  specialist_role?: string | null
  trigger_type: string
  status: string
  priority: number
  input_context: string | null
  result: string | null
  result_summary: string | null
  error: string | null
  feedback: string | null
  session_id: string | null
  token_count: number
  task_title: string | null
  project_name: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
  child_total?: number
  child_done?: number
  child_failed?: number
  child_working?: number
  child_queued?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(unixSeconds: number): string {
  const now = Date.now() / 1000
  const diff = now - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function workingDuration(startedAt: number | null): string {
  if (!startedAt) return ''
  const diff = Date.now() / 1000 - startedAt
  if (diff < 60) return 'Working for <1m'
  if (diff < 3600) return `Working for ${Math.floor(diff / 60)}m`
  return `Working for ${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface MeetingProcessingEvent {
  id: number
  transcript_id: number
  doc_id: number | null
  transcript_title: string | null
  phase: 'process' | 'reprocess'
  status: 'running' | 'done' | 'failed'
  client_name: string | null
  business_name: string | null
  task_count: number | null
  keyword_scan: string | null
  error: string | null
  started_at: number
  completed_at: number | null
}

export default function DispatchPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
        Loading…
      </div>
    }>
      <DispatchPageInner />
    </Suspense>
  )
}

function DispatchPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [dispatches, setDispatches] = useState<DispatchCard[]>([])
  const [meetingEvents, setMeetingEvents] = useState<MeetingProcessingEvent[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [taskDetailId, setTaskDetailId] = useState<number | null>(null)
  const [expandedMeetingId, setExpandedMeetingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [scheduleCount, setScheduleCount] = useState(0)
  const [routineCount, setRoutineCount] = useState(0)
  const [toolCount, setToolCount] = useState(0)
  const schedulesPanelRef = useRef<SchedulesPanelHandle>(null)
  const routinesPanelRef = useRef<RoutinesPanelHandle>(null)
  const toolsPanelRef = useRef<ToolsPanelHandle>(null)

  const tabParam = searchParams.get('tab')
  const activeTab: 'board' | 'schedules' | 'routines' | 'tools' =
    tabParam === 'schedules' ? 'schedules'
    : tabParam === 'routines' ? 'routines'
    : tabParam === 'tools' ? 'tools'
    : 'board'

  const fetchDispatches = useCallback(async () => {
    try {
      const [dispatchRes, meetingRes] = await Promise.all([
        fetch('/api/dispatch'),
        fetch('/api/meeting-processing/events'),
      ])
      const dispatchData = await dispatchRes.json()
      const meetingData = await meetingRes.json().catch(() => ({ events: [] }))
      setDispatches(dispatchData.dispatches || [])
      setMeetingEvents(meetingData.events || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDispatches()
    const interval = setInterval(fetchDispatches, 2500)
    return () => clearInterval(interval)
  }, [fetchDispatches])

  // Group dispatches into editorial sections (Claude/Notion feel)
  const activeItems = dispatches.filter(d => d.status === 'working' || d.status === 'queued')
  const reviewItems = dispatches.filter(d => d.status === 'needs_review')
  const doneItems = dispatches.filter(d => d.status === 'done').slice(0, 20)
  const recentMeetings = meetingEvents.slice(0, 15)
  const hasContent = activeItems.length + reviewItems.length + doneItems.length + recentMeetings.length > 0

  const sections = [
    { id: 'review',  label: 'Needs your attention', hint: 'Approve, reject, or edit',  items: reviewItems,  emphasis: true },
    { id: 'active',  label: 'In motion',            hint: 'Queued or running now',     items: activeItems,  emphasis: false },
    { id: 'done',    label: 'Recently completed',   hint: 'Last 20',                   items: doneItems,    emphasis: false },
  ]

  const selectedDispatch = selectedId ? dispatches.find(d => d.id === selectedId) || null : null

  const boardCount = activeItems.length + reviewItems.length
  const tabs = [
    { id: 'board', label: 'Board', count: boardCount > 0 ? boardCount : undefined },
    { id: 'schedules', label: 'Schedules', count: scheduleCount > 0 ? scheduleCount : undefined },
    { id: 'routines', label: 'Routines', count: routineCount > 0 ? routineCount : undefined },
    { id: 'tools', label: 'Tools', count: toolCount > 0 ? toolCount : undefined },
  ]

  const subtitleByTab = {
    schedules: 'Recurring dispatches on a cron',
    routines: 'Reusable multi-step agent sequences',
    tools: 'Typed functions agents can call',
    board: 'What Jimmy is working on',
  }

  const headerAction =
    activeTab === 'schedules'
      ? { label: 'New schedule', onClick: () => schedulesPanelRef.current?.openCreate() }
      : activeTab === 'routines'
        ? { label: 'New routine', onClick: () => routinesPanelRef.current?.openCreate() }
        : activeTab === 'tools'
          ? { label: 'New tool', onClick: () => toolsPanelRef.current?.openCreate() }
          : undefined

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      <PageHeader
        title="AI Dispatch"
        subtitle={subtitleByTab[activeTab]}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => {
          if (id === 'schedules') router.push('/dispatch?tab=schedules')
          else if (id === 'routines') router.push('/dispatch?tab=routines')
          else if (id === 'tools') router.push('/dispatch?tab=tools')
          else router.push('/dispatch')
        }}
        action={headerAction}
      />

      {activeTab === 'schedules' ? (
        <div className="flex-1 overflow-y-auto">
          <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 32px 80px' }}>
            <SchedulesPanel ref={schedulesPanelRef} onCountChange={setScheduleCount} />
          </div>
        </div>
      ) : activeTab === 'routines' ? (
        <div className="flex-1 overflow-y-auto">
          <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 32px 80px' }}>
            <RoutinesPanel ref={routinesPanelRef} onCountChange={setRoutineCount} />
          </div>
        </div>
      ) : activeTab === 'tools' ? (
        <div className="flex-1 overflow-y-auto">
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 32px 80px' }}>
            <ToolsPanel ref={toolsPanelRef} onCountChange={setToolCount} />
          </div>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto">
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 32px 80px' }}>
          {loading && dispatches.length === 0 ? (
            <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
              Loading…
            </div>
          ) : !hasContent ? (
            <div
              style={{
                padding: '72px 24px',
                textAlign: 'center',
                border: '1px solid var(--border)',
                borderRadius: 14,
                background: 'var(--bg-surface)',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Nothing dispatched yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                Tasks you hand off to Jimmy will show up here.
              </div>
            </div>
          ) : (
            <>
              {sections.map(section => section.items.length > 0 && (
                <section key={section.id} style={{ marginBottom: 36 }}>
                  <header style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <h2 style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: 'var(--text)',
                      letterSpacing: '-0.01em',
                      margin: 0,
                    }}>
                      {section.label}
                    </h2>
                    <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 400 }}>
                      {section.items.length}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {section.hint}
                    </span>
                  </header>

                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'var(--bg-surface)',
                      boxShadow: 'inset 0 1px 0 rgba(255,245,225,0.03)',
                    }}
                  >
                    {section.items.map((dispatch, idx) => (
                      <DispatchRow
                        key={dispatch.id}
                        dispatch={dispatch}
                        onClick={() => {
                          // Single-run dispatches open the chat thread. Team parents
                          // keep the side panel because they fan out into children.
                          if (dispatch.run_type === 'team_parent') {
                            setSelectedId(dispatch.id)
                          } else {
                            router.push(`/dispatch/${dispatch.id}`)
                          }
                        }}
                        isSelected={selectedId === dispatch.id}
                        isLast={idx === section.items.length - 1}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {recentMeetings.length > 0 && (
                <section style={{ marginBottom: 36 }}>
                  <header style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <h2 style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: 'var(--text)',
                      letterSpacing: '-0.01em',
                      margin: 0,
                    }}>
                      Meeting processing
                    </h2>
                    <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 400 }}>
                      {recentMeetings.length}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Transcripts routed to a client
                    </span>
                  </header>

                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'var(--bg-surface)',
                      boxShadow: 'inset 0 1px 0 rgba(255,245,225,0.03)',
                    }}
                  >
                    {recentMeetings.map((event, idx) => (
                      <MeetingEventRow
                        key={event.id}
                        event={event}
                        isExpanded={expandedMeetingId === event.id}
                        onToggle={() => setExpandedMeetingId(expandedMeetingId === event.id ? null : event.id)}
                        isLast={idx === recentMeetings.length - 1}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* Detail panel */}
      {selectedDispatch && (
        <DispatchDetailPanel
          dispatch={selectedDispatch}
          onClose={() => setSelectedId(null)}
          onAction={fetchDispatches}
          onOpenTask={(taskId) => { setSelectedId(null); setTaskDetailId(taskId) }}
        />
      )}

      {/* Task detail panel */}
      {taskDetailId && (
        <TaskDetailPanel
          taskId={taskDetailId}
          onClose={() => setTaskDetailId(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<string, string> = {
  queued:       'var(--status-active)',
  working:      'var(--accent)',
  needs_review: 'var(--status-overdue)',
  done:         'var(--status-completed)',
}

const STATUS_LABEL: Record<string, string> = {
  queued:       'Queued',
  working:      'Working',
  needs_review: 'Needs review',
  done:         'Done',
}

function DispatchRow({
  dispatch,
  onClick,
  isSelected,
  isLast,
}: {
  dispatch: DispatchCard
  onClick: () => void
  isSelected: boolean
  isLast: boolean
}) {
  const isWorking = dispatch.status === 'working'
  const isDone = dispatch.status === 'done'
  const isTeamParent = dispatch.run_type === 'team_parent'
  const statusColor = STATUS_DOT[dispatch.status] || 'var(--text-muted)'
  const timeText = isWorking
    ? workingDuration(dispatch.started_at)
    : relativeTime(dispatch.created_at)

  const doneAge = isDone && dispatch.completed_at
    ? (Date.now() / 1000 - dispatch.completed_at) / 86400
    : 0
  const doneOpacity = isDone ? Math.max(0.55, 1 - doneAge * 0.06) : 1

  const title = dispatch.task_title || dispatch.input_context?.slice(0, 120) || `Dispatch #${dispatch.id}`

  return (
    <button
      onClick={onClick}
      className="w-full text-left transition-colors"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        opacity: doneOpacity,
        background: isSelected ? 'var(--accent-dim)' : 'transparent',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Status dot (quiet) */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: statusColor,
          flexShrink: 0,
          boxShadow: isWorking ? `0 0 0 3px color-mix(in oklab, ${statusColor} 18%, transparent)` : undefined,
          animation: isWorking ? 'dispatch-working-pulse 1.8s ease-in-out infinite' : undefined,
        }}
      />

      {/* Body */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--text)',
          letterSpacing: '-0.005em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 3,
        }}>
          {isTeamParent && (
            <span style={{ color: 'var(--text-dim)', marginRight: 6 }}>Team run ·</span>
          )}
          {title}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
        }}>
          <span style={{ textTransform: 'capitalize' }}>{dispatch.agent_id}</span>
          {dispatch.project_name && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {dispatch.project_name}
              </span>
            </>
          )}
          {isTeamParent && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <span>{dispatch.child_done || 0}/{dispatch.child_total || 0} complete{(dispatch.child_failed || 0) > 0 ? `, ${dispatch.child_failed} failed` : ''}</span>
            </>
          )}
        </div>
        {dispatch.error && dispatch.status === 'queued' && (
          <div style={{
            marginTop: 4,
            fontSize: 12,
            color: 'var(--status-overdue)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            Retry pending — {dispatch.error.slice(0, 60)}
          </div>
        )}
      </div>

      {/* Right meta */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontSize: 13,
        color: 'var(--text-dim)',
        flexShrink: 0,
      }}>
        <span style={{ color: isWorking ? statusColor : 'var(--text-secondary)' }}>
          {isWorking ? timeText || 'Running' : STATUS_LABEL[dispatch.status] || dispatch.status}
        </span>
        {!isWorking && (
          <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{timeText}</span>
        )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Meeting processing row
// ---------------------------------------------------------------------------

const MEETING_STATUS_COLOR: Record<string, string> = {
  running: 'var(--accent)',
  done:    'var(--status-completed)',
  failed:  'var(--status-overdue)',
}

const MEETING_STATUS_LABEL: Record<string, string> = {
  running: 'Processing',
  done:    'Routed',
  failed:  'Failed',
}

function MeetingEventRow({
  event,
  isExpanded,
  onToggle,
  isLast,
}: {
  event: MeetingProcessingEvent
  isExpanded: boolean
  onToggle: () => void
  isLast: boolean
}) {
  const isRunning = event.status === 'running'
  const isDone = event.status === 'done'
  const statusColor = MEETING_STATUS_COLOR[event.status] || 'var(--text-muted)'

  const title = event.transcript_title || `Transcript #${event.transcript_id}`
  const timeText = isRunning
    ? workingDuration(event.started_at)
    : relativeTime(event.completed_at || event.started_at)

  const doneAge = isDone && event.completed_at
    ? (Date.now() / 1000 - event.completed_at) / 86400
    : 0
  const doneOpacity = isDone ? Math.max(0.6, 1 - doneAge * 0.05) : 1

  const client = event.client_name?.trim()
  const business = event.business_name?.trim()

  return (
    <div
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        background: isExpanded ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left transition-colors"
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          opacity: doneOpacity,
          background: 'transparent',
          cursor: 'pointer',
          width: '100%',
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-hover)' }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Status dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
            boxShadow: isRunning ? `0 0 0 3px color-mix(in oklab, ${statusColor} 18%, transparent)` : undefined,
            animation: isRunning ? 'dispatch-working-pulse 1.8s ease-in-out infinite' : undefined,
          }}
        />

        {/* Body */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
            letterSpacing: '-0.005em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 3,
          }}>
            <span style={{ color: 'var(--text-dim)', marginRight: 6, textTransform: 'capitalize' }}>
              {event.phase === 'reprocess' ? 'Reprocess' : 'Process'} ·
            </span>
            {title}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
          }}>
            {client ? (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {client}
                {business && (
                  <>
                    <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
                    {business}
                  </>
                )}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {isRunning ? 'Scanning keywords…' : 'No client matched'}
              </span>
            )}
            {typeof event.task_count === 'number' && event.task_count > 0 && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span>{event.task_count} task{event.task_count === 1 ? '' : 's'}</span>
              </>
            )}
          </div>
          {event.error && (
            <div style={{
              marginTop: 4,
              fontSize: 12,
              color: 'var(--status-overdue)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {event.error.slice(0, 80)}
            </div>
          )}
        </div>

        {/* Right meta */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          fontSize: 13,
          color: 'var(--text-dim)',
          flexShrink: 0,
        }}>
          <span style={{ color: isRunning ? statusColor : 'var(--text-secondary)' }}>
            {isRunning ? timeText || 'Running' : MEETING_STATUS_LABEL[event.status] || event.status}
          </span>
          {!isRunning && (
            <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{timeText}</span>
          )}
          <span style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            transition: 'transform 180ms ease-out',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            display: 'inline-block',
            lineHeight: 1,
          }}>
            ▾
          </span>
        </div>
      </button>

      {isExpanded && (
        <div style={{
          padding: '4px 18px 16px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {event.keyword_scan ? (
            <div>
              <div style={{
                fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                marginBottom: 6,
              }}>
                Keyword signal scan
              </div>
              <pre style={{
                margin: 0,
                padding: '10px 12px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                fontSize: 12,
                lineHeight: 1.55,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 280,
                overflow: 'auto',
              }}>
                {event.keyword_scan}
              </pre>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              No keyword scan recorded.
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>Transcript:</span>{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>#{event.transcript_id}</span>
            </span>
            {event.doc_id && (
              <a
                href={`/docs/${event.doc_id}`}
                style={{ color: 'var(--accent)', textDecoration: 'none' }}
                onClick={e => e.stopPropagation()}
              >
                Open meeting doc →
              </a>
            )}
            <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
              Started {relativeTime(event.started_at)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
