'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { APP_COLORS, getColorName, getHeaderDarkBg } from '@/lib/colors'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { CalendarDropdown, TimeDropdown, EventSelect } from '@/components/ui/DateTimePickers'
import { IconX, IconCalendar, IconEdit, IconMoreHorizontal, IconTrash, IconCheck, IconChevronDown } from '@/components/ui/Icons'

interface CalendarEvent {
  id: string
  calendar_id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  all_day: number
  location: string | null
  status: string
  project_id: number | null
  color?: string | null
  conferencing?: string | null
  conference_url?: string | null
  busy_status?: string | null
  visibility?: string | null
  guests?: string | null
  recurrence?: string | null
  travel_time_before?: number | null
  travel_time_after?: number | null
  response_status?: string | null
  recurring_event_id?: string | null
}

interface ProjectOption {
  id: number
  name: string
  color: string
}

const RECURRENCE_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'RRULE:FREQ=DAILY', label: 'Daily' },
  { value: 'RRULE:FREQ=WEEKLY', label: 'Weekly' },
  { value: 'RRULE:FREQ=MONTHLY', label: 'Monthly' },
  { value: 'RRULE:FREQ=YEARLY', label: 'Yearly' },
]

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function getDurationMinutes(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

function getRecurrenceLabel(rule: string | null | undefined): string {
  if (!rule) return 'Does not repeat'
  const r = rule.toUpperCase()
  if (r.includes('DAILY')) return 'Daily'
  if (r.includes('WEEKLY')) {
    const dayMatch = r.match(/BYDAY=([A-Z,]+)/)
    if (dayMatch) {
      const dayMap: Record<string, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' }
      const days = dayMatch[1].split(',').map(d => dayMap[d] || d)
      return `Weekly on ${days.join(', ')}`
    }
    return 'Weekly'
  }
  if (r.includes('MONTHLY')) return 'Monthly'
  if (r.includes('YEARLY')) return 'Yearly'
  return 'Custom'
}

function getRecurringSeriesId(event: CalendarEvent): string | null {
  if (event.recurring_event_id) return event.recurring_event_id

  if (!event.recurrence) return null

  const instanceIdMatch = event.id.match(/^(.*)_\d{8}T\d{6}Z$/)
  return instanceIdMatch ? instanceIdMatch[1] : event.id
}

function RecurringUpdateDialog({ onSelect, onCancel }: { onSelect: (scope: 'this' | 'all') => void; onCancel: () => void }) {
  const [selected, setSelected] = useState<'this' | 'following' | 'all'>('this')
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 rounded-md">
      <div className="rounded-lg shadow-2xl max-w-[360px] w-full mx-4 overflow-hidden" style={{ background: '#2a2d2f' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-[16px] font-semibold text-text">Update recurring event</h3>
          <button onClick={onCancel} className="text-text-dim hover:text-text p-1">
            <IconX size={14} />
          </button>
        </div>
        {/* Divider */}
        <div className="border-t border-border mx-0" />
        {/* Radio options */}
        <div className="px-5 py-4 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer" onClick={() => setSelected('this')}>
            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selected === 'this' ? 'border-accent' : 'border-text-dim'}`}>
              {selected === 'this' && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
            </span>
            <span className="text-[14px] text-text">This event</span>
          </label>
          <label className="flex items-center gap-3 opacity-40 cursor-not-allowed">
            <span className="w-5 h-5 rounded-full border-2 border-text-dim flex items-center justify-center shrink-0" />
            <span className="text-[14px] text-text-dim">This and following events</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M8 5v3M8 10v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </label>
          <label className="flex items-center gap-3 cursor-pointer" onClick={() => setSelected('all')}>
            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selected === 'all' ? 'border-accent' : 'border-text-dim'}`}>
              {selected === 'all' && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
            </span>
            <span className="text-[14px] text-text">All events</span>
          </label>
        </div>
        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-1">
          <button onClick={onCancel} className="px-4 py-2 rounded-md text-[13px] font-medium text-text border border-border hover:bg-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onSelect(selected === 'all' ? 'all' : 'this')}
            className="px-4 py-2 rounded-md text-[13px] font-medium text-white bg-accent hover:bg-accent/80 transition-colors"
          >
            Update event
          </button>
        </div>
      </div>
    </div>
  )
}

export function EventDetailPanel({
  event,
  calendarEmail,
  color,
  onClose,
  isCreate,
  projects,
  onProjectChange,
  onSaved,
  onCalendarColorChange,
}: {
  event: CalendarEvent
  calendarEmail?: string
  color?: string
  onClose: () => void
  isCreate?: boolean
  projects?: ProjectOption[]
  onProjectChange?: (projectId: number | null) => void
  onSaved?: () => void
  onCalendarColorChange?: (calendarId: string, color: string) => void
}) {
  // Form state
  const [title, setTitle] = useState(event.title)
  const [notes, setNotes] = useState(() => {
    const desc = event.description || ''
    return desc.includes('<') ? stripHtml(desc) : desc
  })
  const [location, setLocation] = useState(event.location || '')
  const [startTime, setStartTime] = useState(event.start_time)
  const [endTime, setEndTime] = useState(event.end_time)
  const [allDay, setAllDay] = useState(event.all_day === 1)
  const savedTimesRef = useRef({ start: event.start_time, end: event.end_time })
  const [conferencing, setConferencing] = useState('none')
  const [zoomLink, setZoomLink] = useState('')
  const [generatingLink, setGeneratingLink] = useState(false)
  const [busyStatus, setBusyStatus] = useState(event.busy_status || 'busy')
  const [visibility, setVisibility] = useState(event.visibility || 'default')
  const [eventColor, setEventColor] = useState(event.color || color || '#4285f4')
  const [recurrence, setRecurrence] = useState(event.recurrence || '')
  const [travelBefore, setTravelBefore] = useState(event.travel_time_before || 0)
  const [travelAfter, setTravelAfter] = useState(event.travel_time_after || 0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [guests, setGuests] = useState<string[]>(() => {
    if (event.guests) {
      try { return JSON.parse(event.guests) } catch { /* ignore */ }
      return event.guests.split(',').map(g => g.trim()).filter(Boolean)
    }
    // Auto-populate current user as guest on new events
    if (isCreate && calendarEmail) return [calendarEmail]
    return []
  })
  const [guestInput, setGuestInput] = useState('')
  const [guestsOpen, setGuestsOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(event.project_id)
  const [rsvpStatus, setRsvpStatus] = useState<string | null>(event.response_status || (isCreate ? 'accepted' : null))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorTriggerRef = useRef<HTMLButtonElement>(null)
  const [showRecurrence, setShowRecurrence] = useState(false)
  const [showTravelTime, setShowTravelTime] = useState(false)
  const [guestConfirmMode, setGuestConfirmMode] = useState<'ask' | null>(null)
  const [recurringEditChoice, setRecurringEditChoice] = useState<'ask' | 'this' | 'all' | null>(null)
  const [pendingEditScope, setPendingEditScope] = useState<'this' | 'all' | null>(null)
  const [pendingProjectChange, setPendingProjectChange] = useState<{ projectId: number | null } | null>(null)
  const [editingStartDate, setEditingStartDate] = useState(false)
  const [editingStartTime, setEditingStartTime] = useState(false)
  const [editingEndDate, setEditingEndDate] = useState(false)
  const [editingEndTime, setEditingEndTime] = useState(false)
  const startDateRef = useRef<HTMLButtonElement>(null)
  const startTimeRef = useRef<HTMLButtonElement>(null)
  const endDateRef = useRef<HTMLButtonElement>(null)
  const endTimeRef = useRef<HTMLButtonElement>(null)

  const menuRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const guestInputRef = useRef<HTMLInputElement>(null)
  const recurrenceRef = useRef<HTMLDivElement>(null)
  const travelRef = useRef<HTMLDivElement>(null)

  // Track dirty state
  const isDirty = useCallback(() => {
    return title !== event.title ||
      notes !== (event.description || '') ||
      location !== (event.location || '') ||
      startTime !== event.start_time ||
      endTime !== event.end_time ||
      allDay !== (event.all_day === 1) ||
      busyStatus !== (event.busy_status || 'busy') ||
      visibility !== (event.visibility || 'default') ||
      eventColor !== (event.color || color || '#4285f4') ||
      recurrence !== (event.recurrence || '') ||
      travelBefore !== (event.travel_time_before || 0) ||
      travelAfter !== (event.travel_time_after || 0) ||
      guests.length > 0 ||
      selectedProjectId !== event.project_id ||
      rsvpStatus !== (event.response_status || null) ||
      conferencing !== 'none' ||
      zoomLink !== ''
  }, [title, notes, location, startTime, endTime, allDay, busyStatus, visibility, eventColor, recurrence, travelBefore, travelAfter, guests, selectedProjectId, rsvpStatus, conferencing, zoomLink, event, color])

  // Detect existing conferencing
  useEffect(() => {
    if (event.conferencing && event.conferencing !== 'none') {
      setConferencing(event.conferencing)
      if (event.conference_url) {
        setZoomLink(event.conference_url)
        if (!event.location) setLocation(event.conference_url)
      }
      return
    }
    const rawDesc = event.description || ''
    const rawLoc = event.location || ''
    const desc = rawDesc.toLowerCase()
    const loc = rawLoc.toLowerCase()
    if (desc.includes('zoom.us') || loc.includes('zoom.us')) {
      setConferencing('zoom')
      // Extract zoom URL from href attributes or raw text
      const hrefMatch = rawDesc.match(/href="(https:\/\/[^"]*zoom\.us[^"]*)"/i)
      const plainMatch = (rawDesc + ' ' + rawLoc).match(/(https:\/\/[^\s<>"]*zoom\.us[^\s<>"]*)/i)
      const url = hrefMatch?.[1] || plainMatch?.[1]
      if (url) {
        setZoomLink(url)
        if (!rawLoc) setLocation(url)
      }
    } else if (desc.includes('meet.google') || loc.includes('meet.google')) {
      setConferencing('meet')
      const meetMatch = (rawDesc + ' ' + rawLoc).match(/(https:\/\/[^\s<>"]*meet\.google[^\s<>"]*)/i)
      if (meetMatch?.[1]) {
        setZoomLink(meetMatch[1])
        if (!rawLoc) setLocation(meetMatch[1])
      }
    } else if (isCreate) {
      fetch('/api/settings').then(r => r.json()).then((s: Record<string, string>) => {
        const def = s.defaultConferencing
        if (!def || def === 'none') return
        if (def === 'google_meet') setConferencing('meet')
        else if (def === 'zoom') handleConferencingChange('zoom')
        else if (def === 'custom' && s.defaultConferencingUrl) {
          setConferencing('custom')
          setZoomLink(s.defaultConferencingUrl)
        }
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape and outside click
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
      if (recurrenceRef.current && !recurrenceRef.current.contains(e.target as Node)) setShowRecurrence(false)
      if (travelRef.current && !travelRef.current.contains(e.target as Node)) setShowTravelTime(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const [confError, setConfError] = useState('')

  async function handleConferencingChange(value: string) {
    setConferencing(value)
    setConfError('')
    if (value === 'zoom' && !zoomLink) {
      setGeneratingLink(true)
      try {
        const res = await fetch('/api/meetings/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'zoom',
            topic: title || event.title,
            start_time: startTime,
            duration: getDurationMinutes(startTime, endTime),
          }),
        })
        const data = await res.json()
        if (data.meeting_url) {
          setZoomLink(data.meeting_url)
          setLocation(data.meeting_url)
        } else {
          setConfError(data.error || 'Failed to create Zoom link')
          setConferencing('none')
        }
      } catch (err) {
        console.error('Failed to create Zoom meeting:', err)
        setConfError('Failed to connect to Zoom')
        setConferencing('none')
      }
      setGeneratingLink(false)
    } else if (value === 'meet' && !zoomLink) {
      setGeneratingLink(true)
      try {
        const res = await fetch('/api/meetings/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'google_meet',
            topic: title || event.title,
            start_time: startTime,
            duration: getDurationMinutes(startTime, endTime),
          }),
        })
        const data = await res.json()
        if (data.meeting_url) {
          setZoomLink(data.meeting_url)
          setLocation(data.meeting_url)
        } else {
          setConfError(data.error || 'Failed to create Meet link')
          setConferencing('none')
        }
      } catch (err) {
        console.error('Failed to create Google Meet:', err)
        setConfError('Failed to create Meet link')
        setConferencing('none')
      }
      setGeneratingLink(false)
    } else if (value === 'custom') {
      if (!zoomLink) setZoomLink('')
    } else if (value === 'none') {
      setZoomLink('')
    }
  }

  function addGuest() {
    const email = guestInput.trim()
    if (email && email.includes('@') && !guests.includes(email)) {
      setGuests(prev => [...prev, email])
      setGuestInput('')
    }
  }

  function removeGuest(email: string) {
    setGuests(prev => prev.filter(g => g !== email))
  }

  async function applyProjectToSeries(projectId: number | null, scope: 'this' | 'all') {
    const targetEventId = (scope === 'all' && recurringSeriesId) ? recurringSeriesId : event.id
    console.log('[EventDetailPanel] applyProjectToSeries', {
      eventId: event.id,
      targetEventId,
      calendarId: event.calendar_id,
      scope,
      recurringSeriesId,
      projectId,
    })
    await fetch('/api/calendar-events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: targetEventId,
        calendarId: event.calendar_id,
        editScope: scope,
        recurringEventId: recurringSeriesId,
        seriesTitle: event.title,
        project_id: projectId,
      }),
    })
    onSaved?.()
  }

  function openInGoogle() {
    const googleUrl = `https://calendar.google.com/calendar/event?eid=${btoa(event.id)}`
    window.open(googleUrl, '_blank')
    setMenuOpen(false)
  }

  const recurringSeriesId = getRecurringSeriesId(event)
  const isRecurring = !!recurringSeriesId

  async function handleSave(sendUpdates?: string, editScope?: 'this' | 'all') {
    if (saving) return

    // Use stored scope if available (persists across guest dialog)
    const resolvedScope = editScope || pendingEditScope
    console.log('[EventDetailPanel] handleSave start', {
      eventId: event.id,
      editScope,
      pendingEditScope,
      resolvedScope,
      sendUpdates,
      recurringEditChoice,
      guestConfirmMode,
    })

    // If editing any recurring event and haven't chosen scope yet, ask
    if (!isCreate && isRecurring && !resolvedScope && recurringEditChoice === null) {
      setRecurringEditChoice('ask')
      return
    }

    // Store the scope for after guest dialog
    if (resolvedScope && !pendingEditScope) setPendingEditScope(resolvedScope)

    // If editing an event with guests and haven't chosen yet, ask first
    // But only if there are Google-visible changes (not just project/color/response_status)
    const hasGoogleVisibleChanges = title !== event.title ||
      startTime !== event.start_time || endTime !== event.end_time ||
      (event.location || '') !== location || (event.description || '') !== notes ||
      recurrence !== (event.recurrence || '') ||
      rsvpStatus !== (event.response_status || null)
    if (!isCreate && guests.length > 0 && sendUpdates === undefined && guestConfirmMode === null && hasGoogleVisibleChanges) {
      setGuestConfirmMode('ask')
      return
    }

    setSaving(true)
    setGuestConfirmMode(null)
    setRecurringEditChoice(null)
    setPendingEditScope(null)
    try {
      if (isCreate) {
        const res = await fetch('/api/calendar-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title || 'New Event',
            start_time: startTime,
            end_time: endTime,
            all_day: allDay,
            location,
            description: notes,
            conferencing: conferencing !== 'none' ? conferencing : undefined,
            conference_url: zoomLink || undefined,
            busy_status: busyStatus,
            visibility,
            guests: guests.length > 0 ? guests : undefined,
            recurrence: recurrence ? [recurrence] : undefined,
            travel_time_before: travelBefore || undefined,
            travel_time_after: travelAfter || undefined,
            response_status: rsvpStatus || 'accepted',
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          console.error('Create failed:', err)
          setSaving(false)
          return
        }
      } else {
        // For "all events" scope on a recurring instance, target the parent event
        const targetEventId = (resolvedScope === 'all' && recurringSeriesId) ? recurringSeriesId : event.id

        // PATCH existing event (include calendarId for composite PK)
        const payload: Record<string, unknown> = {
          eventId: targetEventId,
          calendarId: event.calendar_id,
          editScope: resolvedScope,
          recurringEventId: recurringSeriesId,
          seriesTitle: event.title,
        }
        if (title !== event.title) payload.title = title
        if (startTime !== event.start_time) payload.start_time = startTime
        if (endTime !== event.end_time) payload.end_time = endTime
        if (allDay !== (event.all_day === 1)) {
          payload.all_day = allDay
          // Always send times when toggling all_day so Google switches date/dateTime format
          payload.start_time = startTime
          payload.end_time = endTime
        }
        if (location !== (event.location || '')) payload.location = location
        if (notes !== (event.description || '')) payload.description = notes
        if (busyStatus !== (event.busy_status || 'busy')) payload.busy_status = busyStatus
        if (visibility !== (event.visibility || 'default')) payload.visibility = visibility
        if (guests.length > 0) payload.guests = guests
        if (recurrence !== (event.recurrence || '')) payload.recurrence = recurrence ? [recurrence] : []
        if (travelBefore !== (event.travel_time_before || 0)) payload.travel_time_before = travelBefore
        if (travelAfter !== (event.travel_time_after || 0)) payload.travel_time_after = travelAfter
        if (selectedProjectId !== event.project_id || resolvedScope === 'all') payload.project_id = selectedProjectId
        if (rsvpStatus !== (event.response_status || null) || resolvedScope === 'all') payload.response_status = rsvpStatus
        if (conferencing !== 'none') payload.conferencing = conferencing
        if (zoomLink) payload.conference_url = zoomLink
        // Pass sendUpdates for Google guest notifications
        if (sendUpdates) payload.sendUpdates = sendUpdates
        console.log('[EventDetailPanel] handleSave PATCH payload', payload)

        const res = await fetch('/api/calendar-events', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json()
          console.error('Update failed:', err)
          setSaving(false)
          return
        }
      }
      onSaved?.()
      onClose()
    } catch (err) {
      console.error('Save error:', err)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await fetch(`/api/calendar-events?id=${encodeURIComponent(event.id)}&calendarId=${encodeURIComponent(event.calendar_id)}`, { method: 'DELETE' })
      onSaved?.()
      onClose()
    } catch (err) {
      console.error('Delete error:', err)
    }
    setDeleting(false)
  }

  // Accent color: project color takes priority, then event color
  const projectColorVal = selectedProjectId && projects ? projects.find(p => p.id === selectedProjectId)?.color : undefined
  const accentColor = projectColorVal || eventColor

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div ref={panelRef} className="relative w-full max-w-[720px] max-h-[85vh] rounded-md overflow-hidden flex flex-col" style={{ background: 'var(--bg-modal)', boxShadow: 'var(--glass-shadow-lg)' }}>

        <div className="flex-1 overflow-y-auto">
          {/* Header wrapper — dark tinted bg with accent bar at top */}
          <div style={{ background: getHeaderDarkBg(accentColor), borderTop: `4px solid ${accentColor}` }}>
          <div className="px-6 pt-4 pb-2 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[13px] font-medium text-white" style={{ background: 'var(--bg-elevated)' }}>
                <IconCalendar size={12} />
                Event
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-nowrap">
              <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] text-white hover:brightness-125 whitespace-nowrap shrink-0" style={{ background: 'var(--bg-elevated)' }}>
                <IconEdit size={12} />
                Meeting Note
              </button>
              {zoomLink && conferencing === 'zoom' && (
                <a
                  href={zoomLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-medium text-white hover:opacity-90 whitespace-nowrap shrink-0"
                  style={{ background: '#2D8CFF' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#2D8CFF"/><path d="M5 8h9v6H5zM15 9.5l4-2.5v8l-4-2.5z" fill="white"/></svg>
                  Join Zoom
                </a>
              )}
              {zoomLink && conferencing === 'meet' && (
                <a
                  href={zoomLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-medium text-white hover:opacity-90 whitespace-nowrap shrink-0"
                  style={{ background: '#00897B' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#00897B"/><path d="M4 8h10v7H4zM15 10l5-3v9l-5-3z" fill="white"/></svg>
                  Join Google Meet
                </a>
              )}
              {selectedProjectId && projects ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-medium text-white whitespace-nowrap shrink-0" style={{ background: 'var(--bg-elevated)' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accentColor }} />
                  {(() => { const name = projects.find(p => p.id === selectedProjectId)?.name || 'Project'; return name.length > 20 ? name.slice(0, 20) + '...' : name })()}
                </span>
              ) : (
                <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] text-white hover:brightness-125" style={{ background: 'var(--bg-elevated)' }} onClick={() => document.getElementById('event-project-picker')?.focus()}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  Add to project
                </button>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center justify-center w-8 h-8 rounded-md hover:brightness-125 text-white/70"
                >
                  <IconMoreHorizontal size={14} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-9 w-52 rounded-lg border border-border glass-elevated animate-glass-in shadow-xl py-1 z-50">
                    <button onClick={() => { setMenuOpen(false); document.getElementById('event-project-picker')?.focus() }} className="flex items-center gap-2.5 w-full px-3 py-2 text-[14px] text-text hover:bg-[rgba(255,255,255,0.06)]">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      Add to project
                    </button>
                    <button onClick={openInGoogle} className="flex items-center gap-2.5 w-full px-3 py-2 text-[14px] text-text hover:bg-[rgba(255,255,255,0.06)]">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2L13 2M13 2V9M13 2L6 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 9v4a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      See event in Google
                    </button>
                    <div className="h-px bg-border my-1" />
                    <button onClick={handleDelete} disabled={deleting} className="flex items-center gap-2.5 w-full px-3 py-2 text-[14px] text-red hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50">
                      <IconTrash size={14} />
                      {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="px-6 pt-3 pb-7">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Event title"
              className="event-title-input text-[64px] font-bold text-white bg-transparent outline-none w-full placeholder:text-text-dim leading-[1.05]"
              autoFocus={isCreate}
            />
          </div>

          {/* Date/time pills */}
          <div className="px-6 pb-2 flex items-center gap-2 flex-wrap">
            {/* Start date */}
            <div className="relative">
              <button
                ref={startDateRef}
                onClick={() => { setEditingStartDate(!editingStartDate); setEditingStartTime(false); setEditingEndDate(false); setEditingEndTime(false) }}
                className={`px-3 py-1.5 rounded-md text-[14px] text-white font-medium transition-colors ${editingStartDate ? 'bg-accent/20 ring-1 ring-accent' : 'hover:brightness-125'}`}
                style={editingStartDate ? undefined : { background: 'var(--bg-elevated)' }}
              >
                {formatDate(startTime)}
              </button>
              {editingStartDate && (
                <CalendarDropdown
                  value={new Date(startTime)}
                  onChange={d => {
                    const current = new Date(startTime)
                    current.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
                    setStartTime(current.toISOString())
                  }}
                  onClose={() => setEditingStartDate(false)}
                  anchorRef={startDateRef}
                />
              )}
            </div>

            {!allDay && (
              <>
                {/* Start time */}
                <div className="relative">
                  <button
                    ref={startTimeRef}
                    onClick={() => { setEditingStartTime(!editingStartTime); setEditingStartDate(false); setEditingEndDate(false); setEditingEndTime(false) }}
                    className={`px-3 py-1.5 rounded-md text-[14px] text-white font-medium transition-colors ${editingStartTime ? 'bg-accent/20 ring-1 ring-accent' : 'hover:brightness-125'}`}
                    style={editingStartTime ? undefined : { background: 'var(--bg-elevated)' }}
                  >
                    {formatTime(startTime)}
                  </button>
                  {editingStartTime && (
                    <TimeDropdown
                      value={new Date(startTime)}
                      onChange={d => {
                        const current = new Date(startTime)
                        current.setHours(d.getHours(), d.getMinutes(), 0, 0)
                        setStartTime(current.toISOString())
                      }}
                      onClose={() => setEditingStartTime(false)}
                      anchorRef={startTimeRef}
                    />
                  )}
                </div>

                <span className="text-white/60 text-[14px]">-</span>

                {/* End date */}
                <div className="relative">
                  <button
                    ref={endDateRef}
                    onClick={() => { setEditingEndDate(!editingEndDate); setEditingStartDate(false); setEditingStartTime(false); setEditingEndTime(false) }}
                    className={`px-3 py-1.5 rounded-md text-[14px] text-white font-medium transition-colors ${editingEndDate ? 'bg-accent/20 ring-1 ring-accent' : 'hover:brightness-125'}`}
                    style={editingEndDate ? undefined : { background: 'var(--bg-elevated)' }}
                  >
                    {formatDate(endTime)}
                  </button>
                  {editingEndDate && (
                    <CalendarDropdown
                      value={new Date(endTime)}
                      onChange={d => {
                        const current = new Date(endTime)
                        current.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
                        setEndTime(current.toISOString())
                      }}
                      onClose={() => setEditingEndDate(false)}
                      anchorRef={endDateRef}
                    />
                  )}
                </div>

                {/* End time */}
                <div className="relative">
                  <button
                    ref={endTimeRef}
                    onClick={() => { setEditingEndTime(!editingEndTime); setEditingStartDate(false); setEditingStartTime(false); setEditingEndDate(false) }}
                    className={`px-3 py-1.5 rounded-md text-[14px] text-white font-medium transition-colors ${editingEndTime ? 'bg-accent/20 ring-1 ring-accent' : 'hover:brightness-125'}`}
                    style={editingEndTime ? undefined : { background: 'var(--bg-elevated)' }}
                  >
                    {formatTime(endTime)}
                  </button>
                  {editingEndTime && (
                    <TimeDropdown
                      value={new Date(endTime)}
                      referenceTime={new Date(startTime)}
                      onChange={d => {
                        const current = new Date(endTime)
                        current.setHours(d.getHours(), d.getMinutes(), 0, 0)
                        setEndTime(current.toISOString())
                      }}
                      onClose={() => setEditingEndTime(false)}
                      anchorRef={endTimeRef}
                    />
                  )}
                </div>
              </>
            )}

            <button
              onClick={() => {
                // Open scheduling assistant - find best free slot
                const duration = getDurationMinutes(startTime, endTime)
                fetch('/api/scheduler/find-slot', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ duration, after: new Date().toISOString() }),
                }).then(r => r.json()).then(data => {
                  if (data.start && data.end) {
                    setStartTime(data.start)
                    setEndTime(data.end)
                  }
                }).catch(() => {})
              }}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[14px] text-white hover:brightness-125"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="4" cy="4" r="1" fill="currentColor" opacity="0.4"/><circle cx="12" cy="12" r="1" fill="currentColor" opacity="0.4"/><circle cx="12" cy="4" r="1" fill="currentColor" opacity="0.4"/></svg>
              Open scheduling assistant
            </button>
          </div>

          {/* Meta row: all day, recurrence, travel time */}
          <div className="px-6 pb-4 flex items-center gap-4 text-[14px] text-text-dim">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-text transition-colors">
              <input
                type="checkbox"
                checked={allDay}
                onChange={e => {
                  setAllDay(e.target.checked)
                  if (e.target.checked) {
                    // Save current times before switching to all-day
                    savedTimesRef.current = { start: startTime, end: endTime }
                    const s = new Date(startTime)
                    s.setHours(0, 0, 0, 0)
                    const en = new Date(s)
                    en.setDate(en.getDate() + 1)
                    setStartTime(s.toISOString())
                    setEndTime(en.toISOString())
                  } else {
                    // Restore previously saved times
                    const saved = savedTimesRef.current
                    const savedStart = new Date(saved.start)
                    const savedEnd = new Date(saved.end)
                    // Only restore if they had real times (not midnight-midnight)
                    if (savedStart.getHours() !== 0 || savedStart.getMinutes() !== 0 ||
                        savedEnd.getHours() !== 0 || savedEnd.getMinutes() !== 0) {
                      setStartTime(saved.start)
                      setEndTime(saved.end)
                    } else {
                      // Default to 9 AM - 10 AM on the current day
                      const s = new Date(startTime)
                      s.setHours(9, 0, 0, 0)
                      const en = new Date(s)
                      en.setHours(10, 0, 0, 0)
                      setStartTime(s.toISOString())
                      setEndTime(en.toISOString())
                    }
                  }
                }}
                className="w-3 h-3"
                style={{ accentColor: 'var(--text-dim)' }}
              />
              All day
            </label>

            {/* Recurrence */}
            <div className="relative" ref={recurrenceRef}>
              <button
                onClick={() => setShowRecurrence(!showRecurrence)}
                className="flex items-center gap-1 hover:text-text transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2v12M12 2v12M2 8h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                {getRecurrenceLabel(recurrence)}
              </button>
              {showRecurrence && (
                <div className="absolute left-0 top-6 w-48 rounded-lg border border-border glass-elevated animate-glass-in shadow-xl py-1 z-50">
                  {RECURRENCE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setRecurrence(opt.value); setShowRecurrence(false) }}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-[14px] ${recurrence === opt.value ? 'text-text font-medium' : 'text-text hover:bg-[rgba(255,255,255,0.06)]'}`}
                    >
                      {recurrence === opt.value && (
                        <IconCheck size={10} style={{ color: '#ffffff' }} />
                      )}
                      <span className={recurrence === opt.value ? '' : 'ml-[18px]'}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Travel time */}
            <div className="relative" ref={travelRef}>
              <button
                onClick={() => setShowTravelTime(!showTravelTime)}
                className="flex items-center gap-1 hover:text-text transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="5" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M6 5V3M10 5V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                {travelBefore || travelAfter ? `Travel: ${travelBefore}m before, ${travelAfter}m after` : 'Travel time'}
              </button>
              {showTravelTime && (
                <div className="absolute left-0 top-6 w-56 rounded-lg border border-border glass-elevated animate-glass-in shadow-xl p-3 z-50 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[12px] text-text-dim w-16">Before</label>
                    <input
                      type="number"
                      min="0"
                      max="180"
                      step="5"
                      value={travelBefore}
                      onChange={e => setTravelBefore(Number(e.target.value))}
                      className="flex-1 border border-border rounded px-2 py-1 text-[13px] text-text outline-none w-16"
                      style={{ background: 'var(--bg-chrome)' }}
                    />
                    <span className="text-[12px] text-text-dim">min</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[12px] text-text-dim w-16">After</label>
                    <input
                      type="number"
                      min="0"
                      max="180"
                      step="5"
                      value={travelAfter}
                      onChange={e => setTravelAfter(Number(e.target.value))}
                      className="flex-1 border border-border rounded px-2 py-1 text-[13px] text-text outline-none w-16"
                      style={{ background: 'var(--bg-chrome)' }}
                    />
                    <span className="text-[12px] text-text-dim">min</span>
                  </div>
                  <button
                    onClick={() => setShowTravelTime(false)}
                    className="w-full text-center text-[12px] text-accent-text hover:underline pt-1"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>{/* end header wrapper */}

          <div className="border-t border-border" />

          {/* Event Details section */}
          <div className="px-6 py-4 grid grid-cols-[1fr_auto] gap-x-8 gap-y-3 overflow-hidden">
            <div className="space-y-3 min-w-0 overflow-hidden">
              <h3 className="text-[14px] font-bold text-text">Event Details</h3>

              {/* Conferencing */}
              <div className="space-y-2">
                <div className="flex items-center">
                  <EventSelect
                    value={conferencing}
                    onChange={handleConferencingChange}
                    inputBg="var(--text-inverse)"
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0"><rect x="2" y="4" width="8" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/><path d="M10 7l4-2v5l-4-2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>}
                    options={[
                      { value: 'none', label: 'No conferencing' },
                      { value: 'zoom', label: 'Zoom', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0"><rect width="24" height="24" rx="4" fill="#2D8CFF"/><path d="M5 8h9v6H5zM15 9.5l4-2.5v8l-4-2.5z" fill="white"/></svg> },
                      { value: 'meet', label: 'Google Meet', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0"><rect width="24" height="24" rx="4" fill="#00897B"/><path d="M4 8h10v7H4zM15 10l5-3v9l-5-3z" fill="white"/></svg> },
                      { value: 'custom', label: 'Custom URL' },
                    ]}
                  />
                </div>
                {generatingLink && (
                  <div className="flex items-center gap-2 text-[13px] text-accent-text border border-border rounded-md px-3 py-1.5" style={{ background: 'var(--bg-chrome)' }}>
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Generating link...
                  </div>
                )}
                {confError && (
                  <div className="flex items-center gap-2 rounded-md bg-red/10 border border-red/20 px-3 py-1.5 text-[13px] text-red">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    {confError}
                  </div>
                )}
                {conferencing === 'custom' && !zoomLink && (
                  <input
                    value={location}
                    onChange={e => { setLocation(e.target.value); setZoomLink(e.target.value) }}
                    placeholder="https://your-meeting-link.com/room"
                    className="w-full border border-border rounded-md px-3 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim"
                    style={{ background: 'var(--bg-chrome)' }}
                  />
                )}
              </div>

              {/* Location */}
              <div className="flex items-center border border-border rounded-md px-3 py-1.5" style={{ background: 'var(--bg-chrome)' }}>
                {location && (location.includes('zoom.us') || location.includes('meet.google')) ? (
                  <>
                    {location.includes('zoom.us') ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 mr-2"><rect width="24" height="24" rx="4" fill="#2D8CFF"/><path d="M5 8h9v6H5zM15 9.5l4-2.5v8l-4-2.5z" fill="white"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 mr-2"><rect width="24" height="24" rx="4" fill="#00897B"/><path d="M4 8h10v7H4zM15 10l5-3v9l-5-3z" fill="white"/></svg>
                    )}
                    <a href={location} target="_blank" rel="noopener noreferrer" className="flex-1 bg-transparent text-[13px] text-[#2D8CFF] truncate hover:underline min-w-0">
                      {location}
                    </a>
                    <button onClick={() => navigator.clipboard.writeText(location)} className="text-[13px] text-text-dim hover:text-text px-2 py-0.5 rounded shrink-0" style={{ background: 'var(--bg-modal)' }}>
                      Copy
                    </button>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0 mr-2"><path d="M8 14s5-4.5 5-8A5 5 0 003 6c0 3.5 5 8 5 8z" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                    <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location" className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim" />
                  </>
                )}
              </div>

              {/* Busy / Visibility row */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <EventSelect
                    value={busyStatus}
                    onChange={setBusyStatus}
                    inputBg="var(--text-inverse)"
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>}
                    options={[
                      { value: 'busy', label: 'Busy' },
                      { value: 'free', label: 'Free' },
                      { value: 'tentative', label: 'Tentative' },
                    ]}
                  />
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <EventSelect
                    value={visibility}
                    onChange={setVisibility}
                    inputBg="var(--text-inverse)"
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>}
                    options={[
                      { value: 'default', label: 'Default visibility' },
                      { value: 'public', label: 'Public' },
                      { value: 'private', label: 'Private' },
                    ]}
                  />
                </div>
              </div>

              {/* Calendar / Color row */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 flex-1 border border-border rounded-md px-3 py-1.5" style={{ background: 'var(--bg-chrome)' }}>
                  <IconCalendar size={14} className="text-text-dim shrink-0" />
                  <span className="text-[13px] text-text-dim truncate">
                    {calendarEmail || 'Calendar'}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <button
                    ref={colorTriggerRef}
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className="flex items-center gap-2 flex-1 border border-border rounded-md px-3 py-1.5 text-[13px] text-text hover:brightness-110 transition-colors"
                    style={{ background: 'var(--bg-chrome)' }}
                  >
                    <span className="w-3.5 h-3.5 rounded-[3px] shrink-0" style={{ background: eventColor }} />
                    <span>{getColorName(eventColor)}</span>
                    <IconChevronDown size={10} className="ml-auto text-text-dim" />
                  </button>
                  {showColorPicker && (
                    <ColorPicker
                      currentColor={eventColor}
                      onSelect={(newColor) => {
                        setEventColor(newColor)
                        // Auto-save calendar color
                        fetch('/api/google/calendars/color', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ calendarId: event.calendar_id, color: newColor }),
                        }).catch(() => {})
                        onCalendarColorChange?.(event.calendar_id, newColor)
                      }}
                      onClose={() => setShowColorPicker(false)}
                      anchorRef={colorTriggerRef}
                    />
                  )}
                </div>
              </div>

              {/* Project picker */}
              {projects && projects.length > 0 && (
                <div className="flex items-center gap-2">
                  <EventSelect
                    value={String(selectedProjectId ?? '')}
                    onChange={val => {
                      const id = val ? Number(val) : null
                      setSelectedProjectId(id)
                      onProjectChange?.(id)
                      // For recurring events, immediately ask about scope
                      if (isRecurring && !isCreate) {
                        setPendingProjectChange({ projectId: id })
                      }
                    }}
                    inputBg="var(--text-inverse)"
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0"><path d="M2 4a1 1 0 011-1h3.586a1 1 0 01.707.293L8.414 4.414A1 1 0 009.12 4.707H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2"/></svg>}
                    options={[
                      { value: '', label: 'No project' },
                      ...projects.map(p => ({ value: String(p.id), label: p.name, icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0"><polygon points="8,1 14.93,4.5 14.93,11.5 8,15 1.07,11.5 1.07,4.5" fill={p.color + '25'} stroke={p.color} strokeWidth="1.2"/></svg> })),
                    ]}
                  />
                </div>
              )}

              {/* Notes editor */}
              <div className="mt-2">
                <div className="flex items-center gap-1 border-b border-border pb-1.5 mb-2">
                  {['B', 'I', 'U', 'S', 'H1', 'H2'].map(btn => (
                    <button key={btn} className="w-7 h-7 flex items-center justify-center rounded text-[12px] font-bold text-text-dim hover:bg-hover hover:text-text">
                      {btn}
                    </button>
                  ))}
                  <span className="w-px h-4 bg-border mx-0.5" />
                  {['list-ul', 'list-ol', 'indent'].map((btn, i) => (
                    <button key={btn} className="w-7 h-7 flex items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text">
                      {['≡', '•', '1.'][i]}
                    </button>
                  ))}
                  <span className="w-px h-4 bg-border mx-0.5" />
                  <button className="w-7 h-7 flex items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text">{'</>'}</button>
                  <button className="w-7 h-7 flex items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M7 3H4a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9M10 2l4 4M7 9l7-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Enter message"
                  rows={5}
                  className="w-full border border-border rounded-md px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim resize-none"
                  style={{ background: 'var(--bg-chrome)' }}
                />
              </div>
            </div>

            {/* Right side - Going? + guests */}
            <div className="w-[200px] space-y-3">
              {/* Going? RSVP (only for existing events) */}
              {!isCreate && (
                <div className="space-y-1.5">
                  <span className="text-[13px] text-text-dim">Going?</span>
                  <div className="flex items-center gap-1">
                    {([['accepted', 'Yes'], ['declined', 'No'], ['tentative', 'Maybe']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => {
                          setRsvpStatus(val)
                          // Always fire immediately for the clicked instance
                          if (event.id) {
                            fetch('/api/calendar-events', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ eventId: event.id, calendarId: event.calendar_id, response_status: val }),
                            })
                          }
                        }}
                        className={`px-3 py-1 rounded-md text-[12px] transition-colors ${
                          rsvpStatus === val
                            ? val === 'accepted' ? 'bg-green/20 text-green ring-1 ring-green/40'
                              : val === 'declined' ? 'bg-red/20 text-red ring-1 ring-red/40'
                              : 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/40'
                            : 'bg-hover text-text hover:bg-border'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Guests */}
              <button
                onClick={() => { setGuestsOpen(!guestsOpen); setTimeout(() => guestInputRef.current?.focus(), 100) }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-border text-[13px] text-text hover:brightness-110"
                style={{ background: 'var(--bg-chrome)' }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.2"/><path d="M1 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M11 5a2.5 2.5 0 010 5M13 14c0-2 -1-3.5-2.5-4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                {guests.length > 0 ? `${guests.length} guest${guests.length > 1 ? 's' : ''}` : 'Add guests...'}
                <IconChevronDown size={10} className={`ml-auto transition-transform ${guestsOpen ? 'rotate-180' : ''}`} />
              </button>

              {guestsOpen && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <input
                      ref={guestInputRef}
                      type="email"
                      value={guestInput}
                      onChange={e => setGuestInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGuest() } }}
                      placeholder="Email address"
                      className="flex-1 border border-border rounded-md px-2 py-1.5 text-[12px] text-text outline-none placeholder:text-text-dim min-w-0"
                      style={{ background: 'var(--bg-chrome)' }}
                    />
                    <button
                      onClick={addGuest}
                      className="px-2 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent/80 shrink-0"
                    >
                      Add
                    </button>
                  </div>

                  {guests.map(email => (
                    <div key={email} className="flex items-center gap-2 px-2 py-1.5 rounded-md group" style={{ background: 'var(--bg-chrome)' }}>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: `${accentColor}30` }}>
                        <span className="text-[12px] font-medium uppercase" style={{ color: accentColor }}>{email[0]}</span>
                      </div>
                      <span className="text-[12px] text-text truncate flex-1">{email}</span>
                      <button
                        onClick={() => removeGuest(email)}
                        className="text-text-dim hover:text-red opacity-0 group-hover:opacity-100 shrink-0"
                      >
                        <IconX size={10} />
                      </button>
                    </div>
                  ))}

                  {/* Show organizer */}
                  {calendarEmail && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'var(--bg-chrome)' }}>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: `${accentColor}30` }}>
                        <span className="text-[12px] font-medium uppercase" style={{ color: accentColor }}>{calendarEmail[0]}</span>
                      </div>
                      <span className="text-[12px] text-text truncate flex-1">{calendarEmail}</span>
                      <span className="text-[12px] text-text-dim">Host</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 flex items-center justify-between shrink-0">
          <div className="text-[13px] text-text-dim">
            {calendarEmail && `Organized by: ${calendarEmail}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (isDirty() && !isCreate) {
                  if (confirm('Discard unsaved changes?')) onClose()
                } else {
                  onClose()
                }
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] text-text-dim hover:bg-hover"
            >
              Cancel
              <span className="text-[12px] px-1 py-0.5 rounded bg-hover text-text-dim">Esc</span>
            </button>
            <button
              onClick={() => handleSave()}
              disabled={saving}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                isCreate || isDirty()
                  ? 'bg-accent text-white hover:bg-accent/80'
                  : 'bg-hover text-text-dim'
              } disabled:opacity-50`}
            >
              {saving ? 'Saving...' : isCreate ? 'Create event' : 'Save'}
              <span className={`text-[12px] px-1 py-0.5 rounded ${isCreate || isDirty() ? 'bg-black/10' : 'bg-border text-text-dim'}`}>⌘S</span>
            </button>
          </div>
        </div>

        {/* Guest notification confirmation dialog */}
        {guestConfirmMode === 'ask' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 rounded-md">
            <div className="border border-border rounded-md p-5 shadow-xl max-w-[440px] w-full mx-4" style={{ background: 'var(--bg-chrome)' }}>
              <div className="flex items-center gap-2 mb-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-text-dim shrink-0">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/>
                </svg>
                <h3 className="text-[14px] font-medium text-text">Send updates to guests?</h3>
              </div>
              <p className="text-[13px] text-text-dim mb-4 leading-relaxed">
                This event has {guests.length} guest{guests.length !== 1 ? 's' : ''}. Would you like to notify them about the changes?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setGuestConfirmMode(null) }}
                  className="flex-1 px-3 py-2 rounded-md text-[13px] text-text-dim bg-hover hover:bg-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSave('none')}
                  className="flex-1 px-3 py-2 rounded-md text-[13px] font-medium text-text bg-elevated hover:bg-border border border-border transition-colors"
                >
                  Don&apos;t notify
                </button>
                <button
                  onClick={() => handleSave('all')}
                  className="flex-1 px-3 py-2 rounded-md text-[13px] font-medium text-white bg-accent hover:bg-accent/80 transition-colors"
                >
                  Send updates
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recurring event edit scope choice */}
        {(recurringEditChoice === 'ask' || pendingProjectChange) && (
          <RecurringUpdateDialog
            onSelect={(scope) => {
              if (recurringEditChoice === 'ask') {
                setRecurringEditChoice(null)
                handleSave(undefined, scope)
              } else if (pendingProjectChange) {
                applyProjectToSeries(pendingProjectChange.projectId, scope)
                setPendingProjectChange(null)
              }
            }}
            onCancel={() => {
              setRecurringEditChoice(null)
              if (pendingProjectChange) {
                setPendingProjectChange(null)
                setSelectedProjectId(event.project_id)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
