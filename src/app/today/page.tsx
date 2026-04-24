'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { crmFetch } from '@/lib/crm-browser'
import { PageHeader } from '@/components/ui/PageHeader'
import type { Task } from '@/lib/types'

const mono = { fontFamily: 'var(--font-mono)' } as const

type TaskWithContact = Task & { contact_name: string | null }

interface TodayPayload {
  tasks: {
    overdue: TaskWithContact[]
    today: TaskWithContact[]
    upcoming: TaskWithContact[]
    unscheduled: TaskWithContact[]
  }
  appointments: {
    today: Appointment[]
    rest_of_week: Appointment[]
  }
  conversations: {
    unread: Array<{ contact_id: number; contact_name: string; sms: number; email: number; chat: number }>
  }
}

interface Appointment {
  id: number
  starts_at: number
  ends_at: number
  status: string
  notes: string | null
  calendar_name: string | null
  contact_name: string | null
  contact_id: number | null
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function TodayPage() {
  const [data, setData] = useState<TodayPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setData(await crmFetch<TodayPayload>('/api/crm/today'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    }
  }

  useEffect(() => { load().catch(() => {}) }, [])

  async function complete(task: TaskWithContact) {
    try {
      await crmFetch(`/api/crm/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete task')
    }
  }

  const taskTotal = data
    ? data.tasks.overdue.length + data.tasks.today.length + data.tasks.upcoming.length + data.tasks.unscheduled.length
    : 0
  const apptTotal = data ? data.appointments.today.length + data.appointments.rest_of_week.length : 0
  const unreadTotal = data ? data.conversations.unread.reduce((s, t) => s + t.sms + t.email + t.chat, 0) : 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        title="Today"
        subtitle="What needs attention right now — tasks with a due date, appointments on your calendar, unread threads."
      />

      {error && (
        <div style={{
          margin: '0 24px 12px', padding: '8px 12px', fontSize: 13,
          background: 'color-mix(in oklab, var(--status-overdue) 12%, transparent)',
          color: 'var(--status-overdue)', borderRadius: 8,
        }}>{error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: '12px 24px 40px' }}>
        {!data ? (
          <div style={{ padding: 40, color: 'var(--text-dim)', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18 }}>

            {/* Left column: tasks */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionHeader title="Tasks" count={taskTotal} />

              {data.tasks.overdue.length > 0 && (
                <TaskGroup title="Overdue" tone="warn" tasks={data.tasks.overdue} onComplete={complete} />
              )}
              {data.tasks.today.length > 0 && (
                <TaskGroup title="Due today" tone="accent" tasks={data.tasks.today} onComplete={complete} />
              )}
              {data.tasks.upcoming.length > 0 && (
                <TaskGroup title="Upcoming" tasks={data.tasks.upcoming} onComplete={complete} />
              )}
              {data.tasks.unscheduled.length > 0 && (
                <TaskGroup title="No due date" tone="dim" tasks={data.tasks.unscheduled} onComplete={complete} />
              )}
              {taskTotal === 0 && (
                <EmptyPanel>Inbox zero. Nothing open.</EmptyPanel>
              )}
            </div>

            {/* Right column: appointments + conversations */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionHeader title="Appointments" count={apptTotal} />
              {data.appointments.today.length > 0 && (
                <Panel title="Today">
                  {data.appointments.today.map((a) => <AppointmentRow key={a.id} appointment={a} showDate={false} />)}
                </Panel>
              )}
              {data.appointments.rest_of_week.length > 0 && (
                <Panel title="Rest of the week">
                  {data.appointments.rest_of_week.map((a) => <AppointmentRow key={a.id} appointment={a} showDate={true} />)}
                </Panel>
              )}
              {apptTotal === 0 && <EmptyPanel>No appointments this week.</EmptyPanel>}

              <SectionHeader title="Unread" count={unreadTotal} />
              {data.conversations.unread.length === 0 ? (
                <EmptyPanel>All caught up.</EmptyPanel>
              ) : (
                <Panel title="Needs a reply">
                  {data.conversations.unread.map((row) => (
                    <Link
                      key={row.contact_id}
                      href={`/crm/inbox?contact=${row.contact_id}`}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', borderRadius: 8,
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        color: 'var(--text)', textDecoration: 'none', marginBottom: 6,
                        transition: 'background 120ms ease',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    >
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{row.contact_name}</span>
                      <span style={{ display: 'flex', gap: 6 }}>
                        {row.sms > 0 && <Badge label="SMS" count={row.sms} />}
                        {row.email > 0 && <Badge label="Email" count={row.email} />}
                        {row.chat > 0 && <Badge label="Chat" count={row.chat} />}
                      </span>
                    </Link>
                  ))}
                </Panel>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</span>
      <span style={{ fontSize: 11, ...mono, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{count}</span>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 10, ...mono, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '22px 14px', borderRadius: 12, textAlign: 'center',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      fontSize: 13, color: 'var(--text-dim)',
    }}>
      {children}
    </div>
  )
}

function TaskGroup({ title, tasks, onComplete, tone = 'neutral' }: { title: string; tasks: TaskWithContact[]; onComplete: (t: TaskWithContact) => void; tone?: 'neutral' | 'warn' | 'accent' | 'dim' }) {
  const labelColor = tone === 'warn' ? 'var(--status-overdue)' : tone === 'accent' ? 'var(--accent-text)' : tone === 'dim' ? 'var(--text-muted)' : 'var(--text-dim)'
  return (
    <Panel title={title}>
      {tasks.map((task) => {
        const priorityColor = task.priority === 'urgent' ? 'var(--status-overdue)'
          : task.priority === 'high' ? 'var(--status-active)'
          : 'var(--text-muted)'
        return (
          <div
            key={task.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '9px 10px', borderRadius: 8, marginBottom: 4,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            }}
          >
            <button
              onClick={() => onComplete(task)}
              aria-label="Mark done"
              style={{
                marginTop: 2,
                width: 14, height: 14, borderRadius: 4,
                border: '1.5px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer', flexShrink: 0,
              }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 450, lineHeight: 1.4 }}>
                {task.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {task.contact_name && task.crm_contact_id && (
                  <Link href={`/crm/contacts/${task.crm_contact_id}`} style={{ color: 'var(--accent-text)', textDecoration: 'none' }}>
                    {task.contact_name}
                  </Link>
                )}
                {task.due_date && <span style={{ color: labelColor }}>Due {task.due_date}</span>}
                {task.priority !== 'medium' && (
                  <span style={{ color: priorityColor, ...mono, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10 }}>
                    {task.priority}
                  </span>
                )}
                {task.assignee && <span>· {task.assignee}</span>}
              </div>
            </div>
          </div>
        )
      })}
    </Panel>
  )
}

function AppointmentRow({ appointment, showDate }: { appointment: Appointment; showDate: boolean }) {
  const when = showDate ? `${formatDay(appointment.starts_at)} · ${formatTime(appointment.starts_at)}` : formatTime(appointment.starts_at)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 10px', borderRadius: 8, marginBottom: 4,
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          {appointment.contact_id ? (
            <Link href={`/crm/contacts/${appointment.contact_id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
              {appointment.contact_name || 'Unknown contact'}
            </Link>
          ) : (appointment.contact_name || 'Unknown contact')}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
          {when}{appointment.calendar_name ? ` · ${appointment.calendar_name}` : ''}
        </div>
      </div>
    </div>
  )
}

function Badge({ label, count }: { label: string; count: number }) {
  return (
    <span style={{
      fontSize: 10, ...mono, letterSpacing: '0.04em',
      padding: '2px 7px', borderRadius: 4,
      background: 'color-mix(in oklab, var(--status-active) 18%, transparent)',
      color: 'var(--status-active)',
    }}>
      {label} {count}
    </span>
  )
}
