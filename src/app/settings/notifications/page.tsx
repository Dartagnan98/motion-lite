'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type UserNotificationKind =
  | 'new_lead'
  | 'inbound_reply'
  | 'mention'
  | 'assignment'
  | 'appointment_booked'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'ai_handoff'
  | 'task_assigned'
  | 'review_received'
  | 'opportunity_won'
  | 'opportunity_lost'
  | 'opportunity_abandoned'

interface Pref { in_app: number; email: number; push: number }
type PrefsMap = Record<UserNotificationKind, Pref>

const mono = { fontFamily: 'var(--font-mono)' } as const

const ORDERED_KINDS: Array<{ kind: UserNotificationKind; label: string; description: string }> = [
  { kind: 'new_lead',           label: 'New lead',             description: 'A new contact is assigned to you.' },
  { kind: 'inbound_reply',      label: 'Inbound reply',        description: 'A customer replies via SMS, email, or chat.' },
  { kind: 'mention',            label: '@mention',             description: 'A teammate tags you in a contact note.' },
  { kind: 'assignment',         label: 'Assignment',           description: 'An opportunity is routed to you.' },
  { kind: 'appointment_booked',      label: 'Appointment booked',     description: 'A booking page schedules you on a call.' },
  { kind: 'appointment_cancelled',   label: 'Appointment cancelled',  description: 'A contact cancels their booking via the self-service link.' },
  { kind: 'appointment_rescheduled', label: 'Appointment rescheduled',description: 'A contact reschedules their booking via the self-service link.' },
  { kind: 'ai_handoff',         label: 'AI handoff',           description: 'The AI receptionist flags a conversation for you.' },
  { kind: 'task_assigned',      label: 'Task assigned',        description: 'Someone assigns you a task.' },
  { kind: 'review_received',    label: 'Review received',      description: 'A customer leaves a review.' },
  { kind: 'opportunity_won',    label: 'Deal won',             description: 'An opportunity moves to Won.' },
  { kind: 'opportunity_lost',   label: 'Deal lost',            description: 'An opportunity moves to Lost.' },
  { kind: 'opportunity_abandoned', label: 'Deal abandoned',    description: 'An opportunity moves to Abandoned.' },
]

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-checked={checked}
      aria-disabled={disabled}
      role="switch"
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        border: 'none',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled
          ? 'var(--bg-elevated)'
          : (checked ? 'var(--accent)' : 'var(--bg-elevated)'),
        opacity: disabled ? 0.5 : 1,
        transition: 'background 120ms',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: 7,
          background: checked && !disabled ? 'var(--accent-fg)' : 'var(--text-dim)',
          transition: 'left 120ms',
        }}
      />
    </button>
  )
}

export default function NotificationsSettingsPage() {
  const [prefs, setPrefs] = useState<PrefsMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [savedAt, setSavedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/notifications/prefs')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { prefs?: PrefsMap } | null) => {
        if (!cancelled && data?.prefs) setPrefs(data.prefs)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Fade the "Saved" pill out 1.6s after the most recent save.
  useEffect(() => {
    if (!saved) return
    const handle = window.setTimeout(() => setSaved(false), 1600)
    return () => window.clearTimeout(handle)
  }, [saved, savedAt])

  const patch = useCallback((kind: UserNotificationKind, change: Partial<{ in_app: boolean; email: boolean; push: boolean }>) => {
    setPrefs((prev) => {
      if (!prev) return prev
      const prior = prev[kind]
      const next: Pref = {
        in_app: change.in_app !== undefined ? (change.in_app ? 1 : 0) : prior.in_app,
        email: change.email !== undefined ? (change.email ? 1 : 0) : prior.email,
        push: change.push !== undefined ? (change.push ? 1 : 0) : prior.push,
      }
      return { ...prev, [kind]: next }
    })
    fetch('/api/notifications/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...change }),
    }).then((r) => {
      if (r.ok) { setSaved(true); setSavedAt(Date.now()) }
    }).catch(() => {})
  }, [])

  const body = useMemo(() => {
    if (loading) {
      return (
        <div style={{ ...mono, padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Loading…
        </div>
      )
    }
    if (!prefs) {
      return (
        <div style={{ ...mono, padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Sign in to view notification preferences
        </div>
      )
    }
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-panel)', overflow: 'hidden' }}>
        <div
          style={{
            ...mono,
            display: 'grid',
            gridTemplateColumns: '1fr 72px 72px 72px',
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            fontWeight: 600,
          }}
        >
          <span>Event</span>
          <span style={{ textAlign: 'center' }}>In-app</span>
          <span style={{ textAlign: 'center' }}>Email</span>
          <span style={{ textAlign: 'center' }}>Push</span>
        </div>
        {ORDERED_KINDS.map(({ kind, label, description }, i) => {
          const pref = prefs[kind]
          return (
            <div
              key={kind}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 72px 72px 72px',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: i < ORDERED_KINDS.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                  {label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  {description}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Toggle checked={pref.in_app === 1} onChange={(v) => patch(kind, { in_app: v })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Toggle checked={pref.email === 1} onChange={(v) => patch(kind, { email: v })} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Toggle checked={pref.push === 1} disabled onChange={() => {}} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }, [loading, prefs, patch])

  return (
    <div
      style={{
        minHeight: '100%',
        padding: '32px 48px',
        background: 'var(--bg)',
        overflowY: 'auto',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em', margin: 0 }}>
              Notifications
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, marginBottom: 0 }}>
              Choose which events ping you in-app or by email. Push notifications ship later.
            </p>
          </div>
          <span
            style={{
              ...mono,
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--status-completed)',
              opacity: saved ? 1 : 0,
              transition: 'opacity 400ms',
              padding: '4px 8px',
              borderRadius: 4,
              background: 'color-mix(in oklab, var(--status-completed) 12%, transparent)',
            }}
          >
            Saved
          </span>
        </header>
        {body}
      </div>
    </div>
  )
}
