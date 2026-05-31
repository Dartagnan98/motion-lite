'use client'

// /crm/appointments — appointment list with range tabs + new-appointment modal.
// API: GET /api/crm/appointments?range=today|upcoming|past|all → { data, error }
//      POST /api/crm/appointments { contact_id, starts_at, ends_at, title?, notes? }
//      DELETE /api/crm/appointments/[id] (soft-cancel)
//
// EDGE CASE: workspace 2 has no crm_calendars rows seeded.
// POST will 400 until a calendar exists. We surface a banner when booking-links
// AND the 400 response both signal no calendars.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const mono = { fontFamily: 'var(--font-mono)' } as const

// AppointmentRow = CrmAppointment + contact_name + calendar_name (enriched by API)
interface AppointmentRow {
  id: number
  calendar_id: number
  workspace_id: number
  contact_id: number | null
  starts_at: number
  ends_at: number
  status: 'confirmed' | 'cancelled' | 'showed' | 'no_show' | 'rescheduled' | 'conflict_detected'
  notes: string | null
  assigned_user_id: number | null
  reminder_sent_at: number | null
  manage_token: string | null
  created_at: number
  updated_at: number
  contact_name: string | null
  calendar_name: string | null
}

interface ContactOption {
  id: number
  name: string
  email: string | null
}

type RangeTab = 'today' | 'upcoming' | 'past' | 'all'

const TABS: { label: string; value: RangeTab }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Past', value: 'past' },
  { label: 'All', value: 'all' },
]

const STATUS_STYLES: Record<string, { bg: string; color: string; strike?: boolean }> = {
  confirmed:         { bg: 'rgba(95,141,116,0.18)',  color: '#5f8d74' },
  showed:            { bg: 'rgba(95,141,116,0.25)',  color: '#5f8d74' },
  cancelled:         { bg: 'rgba(241,237,229,0.12)', color: 'var(--text-dim)', strike: true },
  no_show:           { bg: 'rgba(220,100,100,0.18)', color: '#dc6464' },
  rescheduled:       { bg: 'rgba(107,143,160,0.18)', color: '#6b8fa0' },
  conflict_detected: { bg: 'rgba(220,160,60,0.2)',   color: '#dca03c' },
}

function fmtDateRange(starts: number, ends: number): string {
  const s = new Date(starts * 1000)
  const e = new Date(ends * 1000)
  const datePart = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const startTime = s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const endTime = e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${datePart} · ${startTime}–${endTime}`
}

function toUnix(dateStr: string, timeStr: string): number {
  return Math.floor(new Date(`${dateStr}T${timeStr}`).getTime() / 1000)
}

// Default form values for "today at the next round hour"
function defaultDatetime() {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  const date = now.toISOString().split('T')[0]
  const hours = String(now.getHours()).padStart(2, '0')
  const end = new Date(now)
  end.setMinutes(30)
  const endHours = String(end.getHours()).padStart(2, '0')
  return {
    date,
    startTime: `${hours}:00`,
    endTime: `${endHours}:30`,
  }
}

export default function AppointmentsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rangeParam = (searchParams.get('range') as RangeTab) || 'upcoming'

  const [range, setRange] = useState<RangeTab>(rangeParam)
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Calendar check: try /api/crm/booking-links; if none, show the no-calendar banner
  const [noCalendars, setNoCalendars] = useState(false)

  // New appointment modal
  const [showModal, setShowModal] = useState(false)
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const dt = defaultDatetime()
  const [form, setForm] = useState({
    contact_id: '' as string | number,
    date: dt.date,
    startTime: dt.startTime,
    endTime: dt.endTime,
    title: '',
    notes: '',
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Detail drawer
  const [detail, setDetail] = useState<AppointmentRow | null>(null)
  const [cancelling, setCancelling] = useState<number | null>(null)

  const loadAppointments = useCallback(async (r: RangeTab) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/appointments?range=${r}`)
      const json = await res.json() as { data?: AppointmentRow[]; error?: string | null }
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load appointments')
      setAppointments(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  // Check for calendars via booking-links endpoint (proxy for calendar setup)
  const checkCalendars = useCallback(async () => {
    try {
      const res = await fetch('/api/crm/booking-links')
      const json = await res.json() as { booking_links?: unknown[]; error?: string }
      if (res.ok && Array.isArray(json.booking_links) && json.booking_links.length === 0) {
        setNoCalendars(true)
      }
    } catch {
      // non-fatal
    }
  }, [])

  useEffect(() => {
    loadAppointments(range)
    checkCalendars()
  }, [range, loadAppointments, checkCalendars])

  function handleTabChange(r: RangeTab) {
    setRange(r)
    router.replace(`/crm/appointments?range=${r}`, { scroll: false })
  }

  // Load contacts for the modal picker (debounced)
  useEffect(() => {
    if (!showModal) return
    const tid = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/contacts${contactSearch ? `?q=${encodeURIComponent(contactSearch)}` : '?limit=30'}`)
        const json = await res.json() as { contacts?: ContactOption[] }
        setContacts(json.contacts ?? [])
      } catch { /* non-fatal */ }
    }, 200)
    return () => clearTimeout(tid)
  }, [showModal, contactSearch])

  async function createAppointment() {
    setCreating(true)
    setCreateError(null)
    try {
      const startsAt = toUnix(form.date, form.startTime)
      const endsAt = toUnix(form.date, form.endTime)
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
        throw new Error('End time must be after start time')
      }
      const payload: Record<string, unknown> = {
        starts_at: startsAt,
        ends_at: endsAt,
      }
      if (form.contact_id) payload.contact_id = Number(form.contact_id)
      if (form.title) payload.title = form.title
      if (form.notes) payload.notes = form.notes

      const res = await fetch('/api/crm/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json() as { data?: AppointmentRow; error?: string | null }
      if (!res.ok || json.error) {
        // 400 with "No calendars configured" is the expected seed-gap error
        const msg = json.error || 'Failed to create appointment'
        if (msg.toLowerCase().includes('calendar')) setNoCalendars(true)
        throw new Error(msg)
      }
      if (json.data) setAppointments((prev) => [json.data!, ...prev])
      setShowModal(false)
      resetForm()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setCreating(false)
    }
  }

  function resetForm() {
    const d = defaultDatetime()
    setForm({ contact_id: '', date: d.date, startTime: d.startTime, endTime: d.endTime, title: '', notes: '' })
    setContactSearch('')
    setCreateError(null)
  }

  async function cancelAppointment(id: number) {
    if (!confirm('Cancel this appointment?')) return
    setCancelling(id)
    try {
      const res = await fetch(`/api/crm/appointments/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setAppointments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'cancelled' } : a))
        )
        if (detail?.id === id) setDetail((d) => d ? { ...d, status: 'cancelled' } : d)
      }
    } finally {
      setCancelling(null)
    }
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Page header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Appointments</h1>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {!loading && `${appointments.length} result${appointments.length !== 1 ? 's' : ''} · ${range}`}
            </p>
          </div>
          <button
            onClick={() => { resetForm(); setShowModal(true) }}
            className="text-[13px] font-medium text-[var(--text-inverse)] px-3.5 py-2 rounded-lg"
            style={{ background: 'var(--accent)' }}
          >
            + New appointment
          </button>
        </div>

        {/* No-calendar banner */}
        {noCalendars && (
          <div
            className="mb-4 rounded-lg border px-4 py-3 text-[12px]"
            style={{
              borderColor: 'color-mix(in oklab, var(--accent) 35%, var(--border))',
              background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
              color: 'var(--text-dim)',
            }}
          >
            No calendars configured yet. Set one up before booking. (New appointments will fail until a calendar is seeded for this workspace.)
          </div>
        )}

        {/* Range tabs */}
        <div className="flex items-center gap-1 mb-5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              className="rounded-md px-3.5 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                ...mono,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                background: range === tab.value ? 'var(--accent)' : 'transparent',
                color: range === tab.value ? 'var(--text-inverse)' : 'var(--text-dim)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div
            className="py-16 text-center text-[11px]"
            style={{ ...mono, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
          >
            Loading…
          </div>
        ) : error ? (
          <div className="py-8 text-[13px]" style={{ color: 'var(--status-overdue)' }}>
            {error}
            <button onClick={() => loadAppointments(range)} className="ml-2 underline text-[11px]">Retry</button>
          </div>
        ) : appointments.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[14px] font-medium mb-1.5" style={{ color: 'var(--text)' }}>No appointments</p>
            <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
              {range === 'today'
                ? 'Nothing scheduled for today.'
                : range === 'upcoming'
                ? 'No upcoming appointments. Use "New appointment" to book one.'
                : range === 'past'
                ? 'No past appointments found.'
                : 'No appointments yet.'}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {appointments.map((appt, i) => {
              const ss = STATUS_STYLES[appt.status] ?? STATUS_STYLES.confirmed
              const isCancelled = appt.status === 'cancelled'
              return (
                <div
                  key={appt.id}
                  className={`flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-[rgba(255,255,255,0.025)] transition-colors ${i > 0 ? 'border-t border-[var(--border)]' : ''}`}
                  onClick={() => setDetail(appt)}
                >
                  {/* Date + time */}
                  <div className="shrink-0 w-44">
                    <span
                      className="text-[12px]"
                      style={{
                        ...mono,
                        color: isCancelled ? 'var(--text-dim)' : 'var(--text)',
                        textDecoration: isCancelled ? 'line-through' : undefined,
                      }}
                    >
                      {fmtDateRange(appt.starts_at, appt.ends_at)}
                    </span>
                  </div>

                  {/* Contact */}
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-[13px] font-medium"
                      style={{ color: isCancelled ? 'var(--text-dim)' : 'var(--text)' }}
                    >
                      {appt.contact_name || '—'}
                    </span>
                    {appt.notes && (
                      <p
                        className="text-[11px] mt-0.5 truncate"
                        style={{ color: 'var(--text-dim)', maxWidth: 320 }}
                      >
                        {appt.notes}
                      </p>
                    )}
                  </div>

                  {/* Calendar */}
                  <div className="hidden sm:block shrink-0">
                    <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                      {appt.calendar_name || '—'}
                    </span>
                  </div>

                  {/* Status pill */}
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium"
                    style={{ ...mono, background: ss.bg, color: ss.color, letterSpacing: '0.05em', textTransform: 'uppercase' }}
                  >
                    {appt.status.replace('_', ' ')}
                  </span>

                  {/* Actions */}
                  <div
                    className="shrink-0 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isCancelled && (
                      <button
                        onClick={() => cancelAppointment(appt.id)}
                        disabled={cancelling === appt.id}
                        className="rounded-md px-2 py-1 text-[10px] transition-colors hover:bg-[rgba(220,100,100,0.12)]"
                        style={{ ...mono, color: '#dc6464', letterSpacing: '0.06em' }}
                        title="Cancel appointment"
                      >
                        {cancelling === appt.id ? '…' : 'Cancel'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div
            className="relative w-full max-w-sm h-full overflow-y-auto p-6"
            style={{ background: 'var(--bg-elevated, var(--bg))', borderLeft: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>Appointment</h2>
              <button onClick={() => setDetail(null)} style={{ color: 'var(--text-dim)' }}>✕</button>
            </div>
            <dl className="space-y-3 text-[13px]">
              {([
                ['Contact', detail.contact_name || '—'],
                ['Calendar', detail.calendar_name || '—'],
                ['Time', fmtDateRange(detail.starts_at, detail.ends_at)],
                ['Status', detail.status.replace('_', ' ')],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="w-20 text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{k}</dt>
                  <dd style={{ color: 'var(--text)' }}>{v}</dd>
                </div>
              ))}
              {detail.notes && (
                <div>
                  <dt className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Notes</dt>
                  <dd className="whitespace-pre-wrap" style={{ color: 'var(--text)' }}>{detail.notes}</dd>
                </div>
              )}
            </dl>
            {detail.status !== 'cancelled' && (
              <div className="mt-6">
                <button
                  onClick={() => cancelAppointment(detail.id)}
                  disabled={cancelling === detail.id}
                  className="w-full rounded-lg py-2 text-[12px] font-medium border border-[var(--border)] hover:bg-[rgba(220,100,100,0.08)] transition-colors"
                  style={{ ...mono, color: '#dc6464', letterSpacing: '0.06em', textTransform: 'uppercase' }}
                >
                  {cancelling === detail.id ? 'Cancelling…' : 'Cancel appointment'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New appointment modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div
            className="relative w-full max-w-md rounded-xl shadow-2xl p-6"
            style={{ background: 'var(--bg-elevated, var(--bg))', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>New appointment</h2>
              <button onClick={() => setShowModal(false)} style={{ color: 'var(--text-dim)' }}>✕</button>
            </div>

            {noCalendars && (
              <div
                className="mb-4 rounded-lg border px-3 py-2.5 text-[11px]"
                style={{
                  borderColor: 'color-mix(in oklab, var(--accent) 30%, var(--border))',
                  background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
                  color: 'var(--text-dim)',
                }}
              >
                No calendars configured yet. This workspace needs at least one calendar before appointments can be booked.
              </div>
            )}

            <div className="space-y-3">
              {/* Contact search */}
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>
                  Contact
                </label>
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts…"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-dim)] outline-none focus:border-[var(--accent)] mb-1"
                />
                {contacts.length > 0 && (
                  <div
                    className="rounded-lg border overflow-hidden max-h-36 overflow-y-auto"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
                  >
                    {contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setForm((f) => ({ ...f, contact_id: c.id })); setContactSearch(c.name) }}
                        className="w-full text-left px-3 py-2 text-[12px] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                        style={{
                          color: Number(form.contact_id) === c.id ? 'var(--accent)' : 'var(--text)',
                          fontWeight: Number(form.contact_id) === c.id ? 600 : undefined,
                        }}
                      >
                        {c.name}
                        {c.email && <span className="ml-2 text-[var(--text-dim)]">{c.email}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Date */}
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Time range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Start</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>End</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Title (optional)</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Discovery call"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-dim)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-dim)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {createError && (
              <div
                className="mt-3 rounded-lg px-3 py-2 text-[12px]"
                style={{ background: 'rgba(220,100,100,0.12)', color: '#dc6464' }}
              >
                {createError}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={createAppointment}
                disabled={creating}
                className="flex-1 rounded-lg py-2.5 text-[12px] font-medium text-[var(--text-inverse)] disabled:opacity-50"
                style={{ background: 'var(--accent)', ...mono, letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                {creating ? 'Booking…' : 'Book appointment'}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg px-4 py-2.5 text-[12px] border border-[var(--border)]"
                style={{ color: 'var(--text-dim)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
