'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import type { Task } from '@/lib/types'
import { Dropdown } from '@/components/ui/Dropdown'
import { IconX } from '@/components/ui/Icons'
import { CALENDAR_COLORS, getCalendarBg } from '@/lib/colors'

interface EnrichedCalTask extends Task {
  project_color?: string | null
  project_name?: string | null
  contact_name?: string | null
  contact_public_id?: string | null
}
import { EventBlock } from './EventBlock'
import { MiniCalendar } from './MiniCalendar'
import { CalendarList } from './CalendarList'
import { EventDetailPanel } from './EventDetailPanel'

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
  busy_status?: string | null
  conferencing?: string | null
  conference_url?: string | null
  color?: string | null
  response_status?: string | null
  travel_time_before?: number | null
  travel_time_after?: number | null
  recurrence_rule?: string | null
  recurring_event_id?: string | null
  guests?: string | null
}

interface GoogleCalendar {
  id: string
  account_id: number
  name: string
  color: string
  visible: number
  is_primary: number
}

interface GoogleAccount {
  id: number
  email: string
}

const HOUR_HEIGHT = 72
const START_HOUR = 0
const END_HOUR = 24

// Motion-style calendar colors (dark theme backgrounds)

function getWeekDates(date: Date, weekStartDay: string = 'sunday'): Date[] {
  const d = new Date(date)
  const day = d.getDay()
  const startOffset = weekStartDay === 'monday' ? (day === 0 ? -6 : 1 - day) : -day
  d.setDate(d.getDate() + startOffset)
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(d)
    dd.setDate(dd.getDate() + i)
    return dd
  })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date())
}

function isPastDay(d: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const check = new Date(d)
  check.setHours(0, 0, 0, 0)
  return check < today
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

function formatHourInTimezone(h: number, tz: string): string {
  try {
    const d = new Date()
    d.setHours(h, 0, 0, 0)
    const formatted = d.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: tz })
    return formatted.replace(':00', '')
  } catch {
    return formatHour(h)
  }
}

function getTimezoneAbbr(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value || tz
  } catch {
    return tz
  }
}

function getPositionFromTime(timeStr: string): number {
  const d = new Date(timeStr)
  const hours = d.getHours() + d.getMinutes() / 60
  return (hours - START_HOUR) * HOUR_HEIGHT
}

function getDurationHeight(startStr: string, endStr: string): number {
  const start = new Date(startStr)
  const end = new Date(endStr)
  const hours = (end.getTime() - start.getTime()) / 3600000
  return Math.max(hours * HOUR_HEIGHT, 20)
}

function isEventPast(endTime: string): boolean {
  return new Date(endTime) < new Date()
}

function detectConference(event: CalendarEvent): string | undefined {
  const desc = (event.description || '').toLowerCase()
  const loc = (event.location || '').toLowerCase()
  if (desc.includes('zoom.us') || loc.includes('zoom.us')) return 'zoom'
  if (desc.includes('meet.google') || loc.includes('meet.google')) return 'meet'
  return undefined
}

interface LayoutItem {
  id: string
  start: number // minutes from midnight
  end: number
}

interface LayoutResult {
  id: string
  column: number
  totalColumns: number
}

function layoutOverlapping(items: LayoutItem[]): Map<string, LayoutResult> {
  const results = new Map<string, LayoutResult>()
  if (items.length === 0) return results

  const sorted = [...items].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))

  // Group overlapping items into clusters using union-find
  const parent: number[] = sorted.map((_, i) => i)
  function find(x: number): number { return parent[x] === x ? x : (parent[x] = find(parent[x])) }
  function union(a: number, b: number) { parent[find(a)] = find(b) }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].start < sorted[j].end && sorted[i].end > sorted[j].start) {
        union(i, j)
      }
    }
  }

  // Group items by cluster
  const clusters: Map<number, number[]> = new Map()
  for (let i = 0; i < sorted.length; i++) {
    const root = find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(i)
  }

  // Layout each cluster independently
  for (const indices of clusters.values()) {
    const clusterItems = indices.map(i => sorted[i])

    // Greedy column assignment within cluster
    const columns: { end: number }[] = []
    const colMap: Map<string, number> = new Map()

    for (const item of clusterItems) {
      let placed = false
      for (let col = 0; col < columns.length; col++) {
        if (item.start >= columns[col].end) {
          columns[col].end = item.end
          colMap.set(item.id, col)
          placed = true
          break
        }
      }
      if (!placed) {
        colMap.set(item.id, columns.length)
        columns.push({ end: item.end })
      }
    }

    const totalCols = columns.length
    for (const item of clusterItems) {
      results.set(item.id, {
        id: item.id,
        column: colMap.get(item.id) ?? 0,
        totalColumns: totalCols,
      })
    }
  }

  return results
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--priority-urgent)',
  high: 'var(--priority-high)',
  medium: 'var(--priority-medium)',
  low: 'var(--priority-low)',
}

interface CrmAppointmentInput {
  id: number
  calendar_id: number
  contact_id: number | null
  starts_at: number
  ends_at: number
  status: string
  notes: string | null
  calendar_name: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
}

function appointmentColor(status: string): string {
  switch (status) {
    case 'showed':     return 'var(--status-completed)'
    case 'no_show':    return 'var(--status-overdue)'
    case 'cancelled':  return 'var(--status-overdue)'
    case 'rescheduled':return 'var(--status-active)'
    case 'confirmed':
    default:           return 'var(--accent)'
  }
}

export function WeekView({
  tasks,
  appointments = [],
  onTaskClick,
  onTaskUpdate,
  onScheduleChange,
  onTaskCreated,
  weekStartDay = 'sunday',
  viewToggle,
  onViewChange,
}: {
  tasks: (Task | EnrichedCalTask)[]
  appointments?: CrmAppointmentInput[]
  onTaskClick?: (task: Task) => void
  onTaskUpdate?: (taskId: number, data: Record<string, unknown>) => void
  onScheduleChange?: () => void
  onTaskCreated?: (taskId: number) => void
  weekStartDay?: string
  viewToggle?: React.ReactNode
  onViewChange?: (view: string) => void
}) {
  const router = useRouter()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'week' | 'day'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week'
  )
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [accounts, setAccounts] = useState<GoogleAccount[]>([])
  const [allProjects, setAllProjects] = useState<{ id: number; name: string; color: string }[]>([])
  const [showTasks, setShowTasks] = useState(true)
  const [hideWeekends, setHideWeekends] = useState(false)
  const [settingsWeekStart, setSettingsWeekStart] = useState<string>('sunday')
  const [secondaryTimezone, setSecondaryTimezone] = useState<string>('')
  const [calendarColor, setCalendarColor] = useState('#262659')
  const [optimisticTasks, setOptimisticTasks] = useState<Task[]>([])
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      if (s.showTasksOnCalendar === 'hide') setShowTasks(false)
      if (s.hideWeekends === 'true') setHideWeekends(true)
      if (s.weekStartDay) setSettingsWeekStart(s.weekStartDay)
      if (s.secondaryTimezone) setSecondaryTimezone(s.secondaryTimezone)
      if (s.calendarColor) setCalendarColor(s.calendarColor)
    }).catch(() => {})
  }, [])

  const [scheduling, setScheduling] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showBookingLinks, setShowBookingLinks] = useState(false)
  const [bookingLinks, setBookingLinks] = useState<{ id: number; name: string; slug: string; one_time: number }[]>([])
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [scheduleToast, setScheduleToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null)
  const [schedulePopup, setSchedulePopup] = useState<{ placements: { taskId: number; title: string; scheduledStart: string; scheduledEnd: string }[]; unplaceable: { taskId: number; title: string; reason: string }[] } | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [dragTask, setDragTask] = useState<{ id: number; startY: number; originalStart: string; currentY: number; dayIndex: number; grabOffset: number; chunkDurationMin: number } | null>(null)
  const [dragEvent, setDragEvent] = useState<{ event: CalendarEvent; startY: number; currentY: number; dayIndex: number; grabOffset: number; durationMin: number } | null>(null)
  const [guestConfirm, setGuestConfirm] = useState<{ eventId: string; calendarId: string; newStart: string; newEnd: string } | null>(null)
  // Resize state
  const [resizeEvent, setResizeEvent] = useState<{ event: CalendarEvent; startY: number; currentY: number; originalEndTime: string } | null>(null)
  // Drag-to-create state
  const [dragCreate, setDragCreate] = useState<{ dayIndex: number; startY: number; currentY: number } | null>(null)
  const [createMenu, setCreateMenu] = useState<{ dayIndex: number; startTime: Date; endTime: Date; x: number; y: number } | null>(null)
  const [createMode, setCreateMode] = useState<'event' | 'task' | null>(null)
  const [createTimeRange, setCreateTimeRange] = useState<{ start: Date; end: Date } | null>(null)
  const [createAllDay, setCreateAllDay] = useState(false)
  const [selectionDayIndex, setSelectionDayIndex] = useState<number | null>(null)
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })

  const timeColWidth = secondaryTimezone ? 100 : 60
  const effectiveWeekStart = weekStartDay || settingsWeekStart
  const weekDates = useMemo(() => getWeekDates(currentDate, effectiveWeekStart), [currentDate, effectiveWeekStart])
  const filteredWeekDates = useMemo(() => {
    if (!hideWeekends) return weekDates
    return weekDates.filter(d => d.getDay() !== 0 && d.getDay() !== 6)
  }, [weekDates, hideWeekends])
  const displayDates = viewMode === 'day' ? [currentDate] : filteredWeekDates

  const weekStart = weekDates[0]
  const weekEnd = new Date(weekDates[6])
  weekEnd.setHours(23, 59, 59, 999)

  // Update "now" every minute
  useEffect(() => {
    const interval = setInterval(() => {
      const n = new Date()
      setNowMinutes(n.getHours() * 60 + n.getMinutes())
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // Sync calendars in the background at most once per session window.
  const [calendarSyncVersion, setCalendarSyncVersion] = useState(0)
  useEffect(() => {
    const syncKey = 'ctrl-calendar-sync-at'
    const syncTtlMs = 15 * 60 * 1000
    const lastSyncAt = Number(sessionStorage.getItem(syncKey) || 0)
    if (lastSyncAt && Date.now() - lastSyncAt < syncTtlMs) return

    sessionStorage.setItem(syncKey, String(Date.now()))
    fetch('/api/calendar-events/sync', { method: 'POST' })
      .then(() => setCalendarSyncVersion(v => v + 1))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const start = weekStart.toISOString()
    const end = weekEnd.toISOString()
    fetch(`/api/calendar-events?start=${start}&end=${end}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEvents(d) })
      .catch(() => {})
  }, [weekStart.toISOString(), calendarSyncVersion])

  useEffect(() => {
    fetch('/api/google/calendars')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCalendars(d) })
      .catch(() => {})
    fetch('/api/google/accounts')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAccounts(d) })
      .catch(() => {})
    fetch('/api/projects?all=1')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAllProjects(d.map((p: { id: number; name: string; color: string }) => ({ id: p.id, name: p.name, color: p.color }))) })
      .catch(() => {})
  }, [calendarSyncVersion])

  // Refetch events from API
  const refetchEvents = () => {
    const start = weekStart.toISOString()
    const end = weekEnd.toISOString()
    fetch(`/api/calendar-events?start=${start}&end=${end}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setEvents(d) })
      .catch(() => {})
  }

  // Refetch tasks after schedule change (notify parent to re-fetch)
  const [refreshKey, setRefreshKey] = useState(0)
  const triggerRefresh = () => {
    setRefreshKey(k => k + 1)
    onScheduleChange?.()
  }

  // Do not auto-repack on a timer.
  // The schedule should stay stable unless the user changes something
  // (complete/delete/cancel/unschedule/drag-lock/event edits) or a dedicated rollover job runs.

  // When createMode is 'task', create the task via API and open TaskDetailPanel
  useEffect(() => {
    if (createMode !== 'task' || !createTimeRange) return
    const start = createTimeRange.start
    const end = createTimeRange.end
    const durationMins = Math.round((end.getTime() - start.getTime()) / 60000)
    setCreateMode(null)
    setCreateTimeRange(null)
    setSelectionDayIndex(null)
    const lockedAt = new Date().toISOString()
    // Add optimistic task immediately so it appears before parent refetch
    const tempId = -Date.now()
    const optimisticTask = {
      id: tempId, title: 'New task', scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(), duration_minutes: durationMins,
      start_date: start.toISOString().split('T')[0], due_date: start.toISOString().split('T')[0],
      auto_schedule: 0, locked_at: lockedAt, status: 'todo', priority: 'medium',
      chunks: [],
    } as unknown as Task
    setOptimisticTasks(prev => [...prev, optimisticTask])
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New task',
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        duration_minutes: durationMins,
        start_date: start.toISOString().split('T')[0],
        due_date: start.toISOString().split('T')[0],
        auto_schedule: 0,
        locked_at: lockedAt,
        status: 'todo',
        priority: 'medium',
      }),
    }).then(r => r.json()).then(data => {
      const newId = data.id || data.task?.id
      setOptimisticTasks(prev => prev.filter(t => t.id !== tempId))
      if (newId && onTaskCreated) onTaskCreated(newId)
      triggerRefresh()
    }).catch(() => { setOptimisticTasks(prev => prev.filter(t => t.id !== tempId)) })
  }, [createMode, createTimeRange])

  // Scroll to 6 AM on mount (headers are sticky inside scroll container)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 6 * HOUR_HEIGHT
    }
  }, [])

  // NOTE: Auto-reschedule intentionally NOT triggered on mount.
  // It only fires on: task complete, drag-lock, drag-create-event, drag-create-task.

  const prevPeriod = () => setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() - (viewMode === 'day' ? 1 : 7)); return n })
  const nextPeriod = () => setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() + (viewMode === 'day' ? 1 : 7)); return n })
  const goToday = () => setCurrentDate(new Date())

  // Swipe navigation for mobile
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null)
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY, t: Date.now() }
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - touchStart.current.x
    const dy = touch.clientY - touchStart.current.y
    const dt = Date.now() - touchStart.current.t
    touchStart.current = null
    // Only trigger if horizontal swipe > 60px, faster than 500ms, and more horizontal than vertical
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 500) {
      if (dx > 0) prevPeriod()
      else nextPeriod()
    }
  }

  // Merge optimistic tasks (newly drag-created, not yet in parent state) with server tasks
  const allTasks = [...tasks, ...optimisticTasks.filter(ot => !tasks.some(t => t.id === ot.id))]
  const scheduledTasks = allTasks.filter(t => t.scheduled_start && t.scheduled_end && t.duration_minutes > 4)
  const reminderTasks = allTasks.filter(t => t.scheduled_start && t.scheduled_end && t.duration_minutes > 0 && t.duration_minutes <= 4)
  const allDayEvents = events.filter(e => e.all_day === 1)
  const timedEvents = events.filter(e => e.all_day !== 1)
  const hasReminders = reminderTasks.some(t => displayDates.some(d => isSameDay(new Date(t.scheduled_start!), d)))
  const hasAllDay = hasReminders || allDayEvents.some(e => displayDates.some(d => isSameDay(new Date(e.start_time), d)))

  // Compute set of dates that have events for the mini calendar dots
  const eventDates = useMemo(() => {
    const set = new Set<string>()
    for (const e of events) {
      const start = new Date(e.start_time)
      const end = new Date(e.end_time)
      // Add all dates the event spans
      const d = new Date(start)
      d.setHours(0, 0, 0, 0)
      const endDay = new Date(end)
      endDay.setHours(0, 0, 0, 0)
      while (d <= endDay) {
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
        d.setDate(d.getDate() + 1)
      }
    }
    return set
  }, [events])

  async function runAutoSchedule() {
    setScheduling(true)
    try {
      const res = await fetch('/api/schedule/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = await res.json()
      const placed = result.placements?.length || 0
      const unplaced = result.unplaceable?.length || 0

      if (placed > 0) triggerRefresh()

      // Build popup data with task titles
      const taskMap = new Map(tasks.map(t => [t.id, t.title]))
      const placementDetails = (result.placements || []).map((p: { taskId: number; scheduledStart: string; scheduledEnd: string }) => ({
        taskId: p.taskId,
        title: taskMap.get(p.taskId) || `Task #${p.taskId}`,
        scheduledStart: p.scheduledStart,
        scheduledEnd: p.scheduledEnd,
      }))
      const unplaceableDetails = (result.unplaceable || []).map((u: { taskId: number; reason: string }) => ({
        taskId: u.taskId,
        title: taskMap.get(u.taskId) || `Task #${u.taskId}`,
        reason: u.reason,
      }))

      if (placed > 0 || unplaced > 0) {
        setSchedulePopup({ placements: placementDetails, unplaceable: unplaceableDetails })
      } else {
        setScheduleToast({ message: 'No auto-schedule tasks found. Mark tasks as "Auto-scheduled" first.', type: 'warning' })
        setTimeout(() => setScheduleToast(null), 4000)
      }
    } catch { /* ignore */ }
    setScheduling(false)
  }

  async function startTask(taskId: number) {
    setScheduling(true)
    try {
      const res = await fetch('/api/schedule/start-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      const result = await res.json()
      if (result.ok) {
        triggerRefresh()
        setScheduleToast({ message: result.message, type: 'success' })
        setTimeout(() => setScheduleToast(null), 4000)
      }
    } catch { /* ignore */ }
    setScheduling(false)
  }

  function getClampedStartHours(clientY: number, durationMin: number, offsetPx = 0): number {
    const gridY = getGridY(clientY) - offsetPx
    const hours = Math.round(((gridY / HOUR_HEIGHT) + START_HOUR) * 4) / 4
    const durationHours = Math.max(durationMin / 60, 0.25)
    return Math.max(START_HOUR, Math.min(END_HOUR - durationHours, hours))
  }

  function getDropTime(clientY: number, dayIdx: number, offsetPx = 0, durationMin = 30): { start: Date; h: number; m: number } | null {
    const clampedHours = getClampedStartHours(clientY, durationMin, offsetPx)
    const h = Math.floor(clampedHours)
    const m = (clampedHours % 1) * 60
    const date = displayDates[dayIdx]
    const start = new Date(date)
    start.setHours(h, m, 0, 0)
    return { start, h, m }
  }

  // Ref to track which day column the mouse is over during drag
  const dragDayRef = useRef(0)

  function handleDragStart(taskId: number, e: React.MouseEvent, scheduledStart: string, scheduledEnd: string, dayIndex: number, totalChunks?: number) {
    // Use chunk duration (end - start), NOT full task duration
    const durationMin = Math.round((new Date(scheduledEnd).getTime() - new Date(scheduledStart).getTime()) / 60000) || 30
    const isMultiChunk = (totalChunks || 1) > 1
    dragDayRef.current = dayIndex

    // Compute grab offset: distance from task's top edge to where cursor is in grid coords
    const cursorGridY = getGridY(e.clientY)
    const startDate = new Date(scheduledStart)
    const startHours = startDate.getHours() + startDate.getMinutes() / 60
    const blockTopGridY = (startHours - START_HOUR) * HOUR_HEIGHT
    let grabOffset = cursorGridY - blockTopGridY
    // Clamp to reasonable range (0 to block height)
    const blockHeight = (durationMin / 60) * HOUR_HEIGHT
    grabOffset = Math.max(0, Math.min(grabOffset, blockHeight))

    setDragTask({ id: taskId, startY: e.clientY, originalStart: scheduledStart, currentY: e.clientY, dayIndex, grabOffset, chunkDurationMin: durationMin })

    // Global mousemove so drag tracks even outside the grid
    function onMouseMove(ev: MouseEvent) {
      setDragTask(prev => prev ? { ...prev, currentY: ev.clientY } : null)
    }
    document.addEventListener('mousemove', onMouseMove)

    // One-shot global mouseup
    function onMouseUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      // Pass raw clientY, offset is subtracted in grid coords inside getDropTime
      const drop = getDropTime(ev.clientY, dragDayRef.current, grabOffset, durationMin)
      if (drop) {
        const end = new Date(drop.start.getTime() + durationMin * 60000)
        const newStart = drop.start.toISOString()
        const newEnd = end.toISOString()
        const newLocked = new Date().toISOString()
        // Persist the move (lock task in place), then reshuffle auto_schedule tasks around it
        if (isMultiChunk) {
          // Multi-chunk: lock only this chunk, keep task auto-scheduled
          fetch('/api/tasks/lock-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              task_id: taskId,
              old_chunk_start: scheduledStart,
              new_chunk_start: newStart,
              new_chunk_end: newEnd,
            }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}))
            if (res.ok) { triggerRefresh() }
            else console.error('[DRAG] lock-chunk failed', res.status, data)
          }).catch(err => { console.error('[DRAG] lock-chunk error:', err) })
        } else {
          // Single block: lock entire task
          fetch('/api/tasks', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: taskId,
              scheduled_start: newStart,
              scheduled_end: newEnd,
              auto_schedule: 0,
              locked_at: newLocked,
            }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}))
            if (res.ok) { triggerRefresh() }
            else console.error('[DRAG] PATCH failed', res.status, data)
          }).catch(err => { console.error('[DRAG] PATCH network error:', err) })
        }
      }
      setDragTask(null)
    }
    document.addEventListener('mouseup', onMouseUp, { once: true })
  }

  function handleEventDragStart(event: CalendarEvent, e: React.MouseEvent, dayIndex: number) {
    e.stopPropagation()
    const durationMin = Math.max(Math.round((new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000), 15)
    dragDayRef.current = dayIndex
    const cursorGridY = getGridY(e.clientY)
    const startDate = new Date(event.start_time)
    const startHours = startDate.getHours() + startDate.getMinutes() / 60
    const blockTopGridY = (startHours - START_HOUR) * HOUR_HEIGHT
    const blockHeight = (durationMin / 60) * HOUR_HEIGHT
    const grabOffset = Math.max(0, Math.min(cursorGridY - blockTopGridY, blockHeight))

    setDragEvent({ event, startY: e.clientY, currentY: e.clientY, dayIndex, grabOffset, durationMin })

    function onMouseMove(ev: MouseEvent) {
      setDragEvent(prev => prev ? { ...prev, currentY: ev.clientY } : null)
    }
    document.addEventListener('mousemove', onMouseMove)

    function onMouseUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      const drop = getDropTime(ev.clientY, dragDayRef.current, grabOffset, durationMin)
      if (drop) {
        const duration = new Date(event.end_time).getTime() - new Date(event.start_time).getTime()
        const newEnd = new Date(drop.start.getTime() + duration)
        const newStart = drop.start.toISOString()
        const newEndStr = newEnd.toISOString()

        const prevStartTime = event.start_time
        const prevEndTime = event.end_time
        setEvents(prev => prev.map(existing =>
          existing.id === event.id ? { ...existing, start_time: newStart, end_time: newEndStr } : existing
        ))

        // Check actual guests field (JSON array of emails) or fall back to description heuristics
        let hasGuests = false
        if (event.guests) {
          try { const g = JSON.parse(event.guests); hasGuests = Array.isArray(g) && g.length > 1 } catch { hasGuests = false }
        }
        if (!hasGuests) {
          const desc = (event.description || '').toLowerCase()
          hasGuests = desc.includes('zoom.us') || desc.includes('meet.google')
        }

        if (hasGuests) {
          setGuestConfirm({ eventId: event.id, calendarId: event.calendar_id, newStart, newEnd: newEndStr })
        } else {
          fetch('/api/calendar-events/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: event.id, calendarId: event.calendar_id, newStart, newEnd: newEndStr, notifyGuests: false }),
          }).then(res => {
            if (!res.ok) throw new Error('Move failed')
            refetchEvents()
            triggerRefresh()
          }).catch(() => {
            // Rollback optimistic update on failure
            setEvents(prev => prev.map(existing =>
              existing.id === event.id ? { ...existing, start_time: prevStartTime, end_time: prevEndTime } : existing
            ))
          })
        }
      }
      setDragEvent(null)
    }
    document.addEventListener('mouseup', onMouseUp, { once: true })
  }

  function handleEventResizeStart(event: CalendarEvent, e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    const startY = e.clientY
    setResizeEvent({ event, startY, currentY: startY, originalEndTime: event.end_time })

    function onMouseMove(ev: MouseEvent) {
      setResizeEvent(prev => prev ? { ...prev, currentY: ev.clientY } : null)
    }
    function onMouseUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove)
      setResizeEvent(prev => {
        if (!prev) return null
        const deltaY = ev.clientY - prev.startY
        const deltaMinutes = Math.round((deltaY / HOUR_HEIGHT) * 60 / 15) * 15 // 15-min snap
        if (deltaMinutes === 0) return null

        const originalEnd = new Date(prev.originalEndTime)
        const newEnd = new Date(originalEnd.getTime() + deltaMinutes * 60000)
        const eventStart = new Date(prev.event.start_time)
        const prevEndTime = prev.event.end_time
        // Min 15 min event
        const effectiveEndStr = newEnd <= eventStart
          ? new Date(eventStart.getTime() + 15 * 60000).toISOString()
          : newEnd.toISOString()
        setEvents(evs => evs.map(existing =>
          existing.id === prev.event.id ? { ...existing, end_time: effectiveEndStr } : existing
        ))
        fetch('/api/calendar-events/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: prev.event.id, calendarId: prev.event.calendar_id, newStart: prev.event.start_time, newEnd: effectiveEndStr, notifyGuests: false }),
        }).then(res => {
          if (!res.ok) throw new Error('Resize failed')
          refetchEvents()
          triggerRefresh()
        }).catch(() => {
          // Rollback optimistic update on failure
          setEvents(evs => evs.map(existing =>
            existing.id === prev.event.id ? { ...existing, end_time: prevEndTime } : existing
          ))
        })
        return null
      })
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp, { once: true })
  }

  async function handleDrop() {
    // Drops handled by document-level mouseup listeners above
  }

  async function confirmMoveEvent(notifyGuests: boolean) {
    if (!guestConfirm) return
    await fetch('/api/calendar-events/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...guestConfirm, notifyGuests }),
    })
    setGuestConfirm(null)
    refetchEvents()
    triggerRefresh()
  }

  // Drag-to-create helpers
  function getTimeFromY(y: number, date: Date): Date {
    const rawHours = y / HOUR_HEIGHT + START_HOUR
    const hours = Math.round(rawHours * 4) / 4 // 15-min snapping
    const clampedHours = Math.max(START_HOUR, Math.min(END_HOUR, hours))
    const h = Math.floor(clampedHours)
    const m = (clampedHours % 1) * 60
    const d = new Date(date)
    d.setHours(h, m, 0, 0)
    return d
  }

  function getGridY(clientY: number): number {
    const gridEl = gridRef.current
    if (!gridEl) return 0
    const gridRect = gridEl.getBoundingClientRect()
    return clientY - gridRect.top
  }

  function handleGridMouseDown(e: React.MouseEvent, dayIndex: number) {
    if (dragTask || dragEvent) return
    if ((e.target as HTMLElement).closest('[data-event-block]')) return
    const y = getGridY(e.clientY)
    setDragCreate({ dayIndex, startY: y, currentY: y })
    setCreateMenu(null)
  }

  function handleGridMouseMove(e: React.MouseEvent) {
    if (dragCreate) {
      const y = getGridY(e.clientY)
      setDragCreate(prev => prev ? { ...prev, currentY: y } : null)
    }
    if (dragEvent) {
      setDragEvent(prev => prev ? { ...prev, currentY: e.clientY } : null)
    }
    if (dragTask) {
      setDragTask(prev => prev ? { ...prev, currentY: e.clientY } : null)
    }
  }

  function handleGridMouseUp(e: React.MouseEvent) {
    if (!dragCreate) return
    const { dayIndex, startY, currentY } = dragCreate
    const dragDistance = Math.abs(currentY - startY)
    setDragCreate(null)
    const date = displayDates[dayIndex]
    let startTime: Date
    let endTime: Date
    if (dragDistance < 10) {
      // Click (not drag): create 15-min block at clicked position
      startTime = getTimeFromY(startY, date)
      endTime = new Date(startTime.getTime() + 15 * 60000)
    } else {
      // Drag: use dragged range
      const minY = Math.min(startY, currentY)
      const maxY = Math.max(startY, currentY)
      startTime = getTimeFromY(minY, date)
      endTime = getTimeFromY(maxY, date)
    }
    // Minimum 15 min
    if (endTime.getTime() - startTime.getTime() < 15 * 60000) {
      endTime = new Date(startTime.getTime() + 15 * 60000)
    }
    setSelectionDayIndex(dayIndex)
    setCreateTimeRange({ start: startTime, end: endTime })
    setCreateMenu({ dayIndex, startTime, endTime, x: e.clientX, y: e.clientY })
  }

  function handleCreateChoice(mode: 'event' | 'task') {
    if (!createMenu) return
    setCreateTimeRange({ start: createMenu.startTime, end: createMenu.endTime })
    setCreateMode(mode)
    setCreateMenu(null)
  }

  function formatTimeShort(d: Date): string {
    const h = d.getHours()
    const m = d.getMinutes()
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
    return m === 0 ? `${hour}:00 ${ampm}` : `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
  }

  const nowTop = ((nowMinutes / 60) - START_HOUR) * HOUR_HEIGHT

  const monthLabel = viewMode === 'day'
    ? currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : weekDates[0].getMonth() === weekDates[6].getMonth()
      ? weekDates[0].toLocaleDateString('en-US', { month: 'short' }) + ' ' + weekDates[0].getFullYear()
      : weekDates[0].toLocaleDateString('en-US', { month: 'short' }) + ' - ' + weekDates[6].toLocaleDateString('en-US', { month: 'short' }) + ' ' + weekDates[6].getFullYear()

  function getCalendarEmailForEvent(event: CalendarEvent): string | undefined {
    const cal = calendars.find(c => c.id === event.calendar_id)
    if (!cal) return undefined
    const account = accounts.find(a => a.id === cal.account_id)
    return account?.email
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Main calendar area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between px-4 shrink-0 gap-x-3 gap-y-1 py-4" style={{ minHeight: '52px', background: 'var(--bg)' }}>
          <div className="flex items-center gap-1.5 min-w-0">
            <button onClick={goToday} className="px-2.5 py-1 text-[13px] font-semibold rounded-md shrink-0 transition-all active:scale-[0.98]" style={{ background: 'rgba(241,237,229,0.18)', color: 'var(--accent)', border: '1px solid rgba(241,237,229,0.3)' }}>Today</button>
            <button onClick={prevPeriod} className="p-1 rounded-md hover:bg-hover text-text-dim shrink-0">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button onClick={nextPeriod} className="p-1 rounded-md hover:bg-hover text-text-dim shrink-0">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span className="text-[16px] sm:text-[20px] font-bold text-text whitespace-nowrap truncate">{monthLabel}</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {/* Booking links */}
            <div className="relative hidden sm:block">
              <button
                className="flex items-center gap-1.5 px-3 text-[13px] font-medium rounded-md transition-colors active:scale-[0.98]"
                style={{ paddingTop: '4px', paddingBottom: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                title="Booking links"
                onClick={() => {
                  setShowBookingLinks(!showBookingLinks)
                  if (!showBookingLinks) fetch('/api/booking/links').then(r => r.json()).then(setBookingLinks).catch(() => {})
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5a3 3 0 004.2.1l2-2a3 3 0 00-4.2-4.3l-1.1 1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M9.5 6.5a3 3 0 00-4.2-.1l-2 2a3 3 0 004.2 4.3l1.1-1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                <span className="hidden lg:inline">Booking links</span>
              </button>
              {showBookingLinks && (
                <div className="absolute top-full left-0 mt-2 z-50 w-[420px] rounded-lg border border-border glass-elevated shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                  {/* One-time link section */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div>
                      <div className="text-[14px] font-medium text-text">One-time link</div>
                      <div className="text-[12px] text-text-dim">Create a one-time link that expires after being used</div>
                    </div>
                    <button
                      onClick={async () => {
                        const slug = `one-time-${Date.now().toString(36)}`
                        const res = await fetch('/api/booking/links', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: 'One-time Meeting', slug, one_time: true, durations: [30] }),
                        })
                        if (res.ok) {
                          const link = await res.json()
                          setBookingLinks(prev => [link, ...prev])
                        }
                      }}
                      className="px-3 py-1.5 rounded-md text-[12px] font-medium text-text border border-border hover:bg-hover transition-colors whitespace-nowrap"
                    >
                      Create one-time link
                    </button>
                  </div>
                  {/* Booking links list */}
                  <div className="max-h-[300px] overflow-y-auto">
                    {bookingLinks.map(link => (
                      <div key={link.id} className="flex items-center justify-between px-4 py-3 border-b border-border hover:bg-hover/30">
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-medium text-text">{link.name}</div>
                          <div className="text-[12px] text-text-dim truncate">{typeof window !== 'undefined' ? window.location.origin : ''}/book/{link.slug}</div>
                        </div>
                        <div className="flex items-center gap-2 ml-3 shrink-0">
                          <button
                            onClick={() => {
                              const url = `${window.location.origin}/book/${link.slug}`
                              navigator.clipboard.writeText(url)
                              setCopiedSlug(link.slug)
                              setTimeout(() => setCopiedSlug(null), 2000)
                            }}
                            className="px-2.5 py-1 rounded-md text-[12px] font-medium text-text border border-border hover:bg-hover transition-colors"
                          >
                            {copiedSlug === link.slug ? 'Copied!' : 'Copy link'}
                          </button>
                        </div>
                      </div>
                    ))}
                    {bookingLinks.length === 0 && (
                      <div className="px-4 py-6 text-center text-[13px] text-text-dim">No booking links yet</div>
                    )}
                  </div>
                  {/* Footer actions */}
                  <div className="border-t border-border">
                    <button
                      onClick={() => { setShowBookingLinks(false); window.open('/settings', '_self') }}
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-[13px] text-text-dim hover:bg-hover/30 hover:text-text transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.3"/><path d="M13.5 8a5.5 5.5 0 01-11 0 5.5 5.5 0 0111 0z" stroke="currentColor" strokeWidth="1.3"/></svg>
                      Booking settings
                    </button>
                  </div>
                </div>
              )}
              {showBookingLinks && <div className="fixed inset-0 z-40" onClick={() => setShowBookingLinks(false)} />}
            </div>
            {/* Display options */}
            <button
              className="hidden sm:flex items-center gap-1.5 px-3 text-[13px] font-medium rounded-md transition-colors active:scale-[0.98]"
              style={{ paddingTop: '4px', paddingBottom: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Display options"
              onClick={() => window.open('/settings', '_self')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 3v10M8 5v8M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              <span className="hidden lg:inline">Display options</span>
            </button>
            {/* Refresh all tasks */}
            <button
              onClick={() => {
                setScheduling(true)
                fetch('/api/schedule/auto', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mode: 'full' }),
                }).then(r => r.json()).then(result => {
                  triggerRefresh()
                  if (result.placements?.length > 0) {
                    setScheduleToast({ message: `Rescheduled ${result.placements.length} task${result.placements.length > 1 ? 's' : ''}`, type: 'success' })
                    setTimeout(() => setScheduleToast(null), 4000)
                  }
                  setScheduling(false)
                }).catch(() => setScheduling(false))
              }}
              disabled={scheduling}
              className="hidden sm:flex items-center gap-1.5 px-3 text-[13px] font-medium rounded-md transition-colors disabled:opacity-50 active:scale-[0.98]"
              style={{ paddingTop: '4px', paddingBottom: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Reschedule all tasks"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 2.5v4h-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2.5 13.5v-4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M4.5 6A5 5 0 0113 5l.5 1.5M11.5 10a5 5 0 01-8.5 1l-.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="hidden lg:inline">{scheduling ? 'Rescheduling...' : 'Reschedule all'}</span>
            </button>
            {/* New event + button */}
            <button
              onClick={() => {
                const now = new Date()
                now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0)
                const end = new Date(now.getTime() + 30 * 60000)
                setCreateMode('event')
                setCreateTimeRange({ start: now, end })
              }}
              className="hidden sm:flex items-center justify-center w-7 h-7 rounded-md transition-colors active:scale-[0.98]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="New event"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            {/* View mode selector dropdown */}
            <Dropdown
              value={viewMode}
              onChange={(v) => {
                if (v === 'week' || v === 'day') setViewMode(v)
                else if (onViewChange) onViewChange(v)
              }}
              options={[{ value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }, { value: 'schedule', label: 'Schedule' }, { value: 'month', label: 'Month' }]}
              renderTrigger={({ selected }) => (
                <span className="flex items-center gap-1.5 px-3 text-[13px] font-medium rounded-md cursor-pointer transition-colors active:scale-[0.98]" style={{ paddingTop: '4px', paddingBottom: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  {selected?.label || 'Week'}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="opacity-50"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              )}
              minWidth={120}
            />
            {/* Calendar color picker */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-hover"
                title="Calendar color"
              >
                <span className="w-4 h-4 rounded-full border border-white/20" style={{ background: calendarColor }} />
              </button>
              {showColorPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColorPicker(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-elevated border border-border rounded-lg p-2 shadow-xl grid grid-cols-6 gap-1.5" style={{ width: '168px' }}>
                    {CALENDAR_COLORS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => {
                          setCalendarColor(c.value)
                          setShowColorPicker(false)
                          fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarColor: c.value }) })
                        }}
                        className="w-6 h-6 rounded-full border transition-transform hover:scale-110"
                        style={{ background: c.value, borderColor: calendarColor === c.value ? 'white' : 'transparent' }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden sm:flex items-center gap-1.5 px-3 text-[13px] font-medium rounded-md transition-colors active:scale-[0.98]"
              style={{ paddingTop: '4px', paddingBottom: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              {sidebarCollapsed ? 'Open' : 'Close'} <span>{sidebarCollapsed ? '«' : '»'}</span>
            </button>
            {/* Mobile today */}
            <button
              onClick={() => setCurrentDate(new Date())}
              className="sm:hidden px-3 py-1 text-[13px] font-semibold rounded-md"
              style={{ background: 'rgba(241,237,229,0.18)', color: 'var(--accent)', border: '1px solid rgba(241,237,229,0.3)' }}
            >
              Today
            </button>
          </div>
        </div>

        {/* Scrollable container: headers + time grid share the same scroll context so columns align */}
        <div ref={scrollRef} className="flex-1 overflow-y-scroll relative" onMouseMove={handleGridMouseMove} onMouseUp={handleGridMouseUp} onMouseLeave={() => setDragCreate(null)} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {/* Day headers -- sticky so they stay visible while scrolling */}
          <div className="grid sticky top-0 z-30 border-b border-border" style={{ gridTemplateColumns: `${timeColWidth}px repeat(${displayDates.length}, 1fr)`, background: 'var(--bg)' }}>
            <div className="h-[52px] flex items-center justify-center">
              <span className="text-[11px] text-text-dim uppercase tracking-wide">PDT</span>
            </div>
            {displayDates.map((d, i) => {
              const past = isPastDay(d) && !isToday(d)
              const today = isToday(d)
              return (
                <div
                  key={i}
                  className="h-[52px] flex flex-col items-center justify-center gap-0.5"
                >
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: today ? 'var(--accent)' : past ? '#4a5155' : '#6b7280',
                  }}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  <span style={{
                    fontSize: today ? 28 : 22,
                    fontWeight: today ? 700 : 500,
                    lineHeight: 1,
                    color: today ? 'var(--accent)' : past ? '#4a5155' : 'var(--text-secondary)',
                  }}>
                    {d.getDate()}
                  </span>
                </div>
              )
            })}
          </div>

          {/* All-day events row -- sticky below headers */}
          {(
            <div className="grid sticky top-[52px] z-30 bg-bg" style={{ gridTemplateColumns: `${timeColWidth}px repeat(${displayDates.length}, 1fr)` }}>
              <div className="text-[10px] text-text-dim p-1 flex items-center justify-end pr-2">all-day</div>
              {displayDates.map((d, i) => {
                const dayEvents = allDayEvents.filter(e => {
                  const cal = calendars.find(c => c.id === e.calendar_id)
                  if (cal && !cal.visible) return false
                  // All-day events: compare by date string to avoid timezone shift
                  const eStartStr = e.start_time.slice(0, 10)
                  const eEndStr = e.end_time.slice(0, 10)
                  const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                  return dStr >= eStartStr && dStr < eEndStr
                })
                const past = isPastDay(d) && !isToday(d)
                return (
                  <div
                    key={i}
                    className={`min-h-[24px] p-0.5 space-y-0.5 overflow-hidden cursor-pointer ${past ? 'opacity-40' : ''}`}
                    onClick={(e) => {
                      // Only trigger if click was directly on the cell (not on an event chip)
                      if ((e.target as HTMLElement).closest('[data-allday-event]')) return
                      const dayStart = new Date(d)
                      dayStart.setHours(0, 0, 0, 0)
                      const dayEnd = new Date(d)
                      dayEnd.setDate(dayEnd.getDate() + 1)
                      dayEnd.setHours(0, 0, 0, 0)
                      setCreateTimeRange({ start: dayStart, end: dayEnd })
                      setCreateAllDay(true)
                      setCreateMode('event')
                      setSelectionDayIndex(i)
                    }}
                  >
                    {dayEvents.map(e => {
                      const cal = calendars.find(c => c.id === e.calendar_id)
                      const pColor = e.project_id ? allProjects.find(p => p.id === e.project_id)?.color : undefined
                      const color = pColor || e.color || cal?.color || '#4285f4'
                      const mappedBg = getCalendarBg(color)
                      const isHoliday = !mappedBg // Google holiday/external colors not in APP_COLORS
                      const bg = mappedBg || calendarColor
                      const invited = e.response_status === 'needsAction' || e.response_status === 'tentative' || e.response_status === 'declined'
                      return (
                        <div
                          key={e.id}
                          data-allday-event="1"
                          className="text-[10px] font-medium rounded px-1.5 py-0.5 truncate cursor-pointer hover:brightness-110 overflow-hidden whitespace-nowrap"
                          style={{
                            background: isHoliday ? `${color}25` : invited ? `${bg}cc` : bg,
                            color: 'white',
                            border: `1px solid ${color}60`,
                            borderLeft: invited ? `2px dashed ${color}` : `2px solid ${color}`,
                          }}
                          onClick={(ev) => { ev.stopPropagation(); setSelectedEvent(e) }}
                        >
                          {e.title}
                        </div>
                      )
                    })}
                    {reminderTasks.filter(t => isSameDay(new Date(t.scheduled_start!), d)).map(t => (
                      <div
                        key={`reminder-${t.id}`}
                        className="text-[10px] text-white font-medium rounded px-1.5 py-0.5 truncate cursor-pointer hover:brightness-110 flex items-center gap-1 overflow-hidden whitespace-nowrap"
                        data-allday-event="1"
                        style={{ background: '#594d27', border: '1px solid #f59e0b60', borderLeft: '2px solid #f59e0b' }}
                        onClick={(ev) => { ev.stopPropagation(); onTaskClick?.(t) }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                        {t.title}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          <div ref={gridRef} className="grid relative select-none" style={{ gridTemplateColumns: `${timeColWidth}px repeat(${displayDates.length}, 1fr)`, height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px` }}>
            {/* Hour labels */}
            <div className="relative">
              {secondaryTimezone && (
                <div className="absolute top-[-18px] left-0 right-0 flex justify-between px-1 text-[8px] text-text-dim/60 uppercase tracking-wide">
                  <span>{getTimezoneAbbr(Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>
                  <span>{getTimezoneAbbr(secondaryTimezone)}</span>
                </div>
              )}
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR).map(h => (
                <div
                  key={h}
                  className="absolute right-0 pr-2 flex items-center gap-1"
                  style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT - 7}px`, fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', color: 'var(--border)' }}
                >
                  {secondaryTimezone && (
                    <span style={{ fontSize: 9, color: '#2e3235' }}>{formatHourInTimezone(h, secondaryTimezone)}</span>
                  )}
                  <span>{formatHour(h)}</span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {displayDates.map((d, dayIndex) => {
              const today = isToday(d)
              const pastDay = isPastDay(d) && !today

              return (
                <div
                  key={dayIndex}
                  className={`relative border-r border-border ${today ? 'bg-accent/[0.02]' : ''}`}
                  onMouseDown={e => handleGridMouseDown(e, dayIndex)}
                  onMouseEnter={() => {
                    if (dragEvent) { dragDayRef.current = dayIndex; setDragEvent(prev => prev ? { ...prev, dayIndex } : null) }
                    if (dragTask) { dragDayRef.current = dayIndex; setDragTask(prev => prev ? { ...prev, dayIndex } : null) }
                  }}
                >
                  {/* Past time overlay for today */}
                  {today && (
                    <div
                      className="absolute w-full bg-[#ffffff05] z-[1] pointer-events-none"
                      style={{ top: 0, height: `${nowTop}px` }}
                    />
                  )}

                  {/* Full day grey overlay for past days */}
                  {pastDay && (
                    <div className="absolute inset-0 bg-[#ffffff05] z-[1] pointer-events-none" />
                  )}

                  {/* Hour lines */}
                  {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR).map(h => (
                    <div
                      key={h}
                      className="absolute w-full"
                      style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px`, borderTop: `1px solid var(--border)` }}
                    />
                  ))}

                  {/* Events + Tasks + Appointments with overlap layout */}
                  {(() => {
                    const dayStart = new Date(d); dayStart.setHours(0,0,0,0)
                    const dayEnd = new Date(d); dayEnd.setHours(23,59,59,999)
                    const dayEvents = timedEvents.filter(e => {
                      const cal = calendars.find(c => c.id === e.calendar_id)
                      if (cal && !cal.visible) return false
                      const eStart = new Date(e.start_time)
                      const eEnd = new Date(e.end_time)
                      // Show event on any day it spans (not just start day)
                      return eStart <= dayEnd && eEnd > dayStart
                    })
                    // CRM appointments for this day
                    const dayAppointments = appointments.filter(a => {
                      const aStart = new Date(a.starts_at * 1000)
                      const aEnd = new Date(a.ends_at * 1000)
                      return aStart <= dayEnd && aEnd > dayStart
                    })
                    // Build task chunk display items for this day
                    // Each chunk renders as a separate block; single-chunk tasks use scheduled_start/end
                    type TaskChunkDisplay = { task: typeof scheduledTasks[0]; chunkStart: string; chunkEnd: string; chunkIndex: number; totalChunks: number; layoutId: string }
                    const dayTaskChunks: TaskChunkDisplay[] = []
                    if (showTasks) {
                      for (const t of scheduledTasks) {
                        if (!t.scheduled_start || !t.scheduled_end) continue
                        const chunks = (t as unknown as { chunks?: { chunk_start: string; chunk_end: string }[] }).chunks
                        if (chunks && chunks.length > 1) {
                          // Multi-chunk: render each chunk separately
                          chunks.forEach((c, ci) => {
                            const cStart = new Date(c.chunk_start)
                            const cEnd = new Date(c.chunk_end)
                            if (cStart <= dayEnd && cEnd > dayStart) {
                              dayTaskChunks.push({ task: t, chunkStart: c.chunk_start, chunkEnd: c.chunk_end, chunkIndex: ci, totalChunks: chunks.length, layoutId: `task-${t.id}-c${ci}` })
                            }
                          })
                        } else {
                          // Single chunk or no chunks: use scheduled_start/end
                          const tStart = new Date(t.scheduled_start)
                          const tEnd = new Date(t.scheduled_end)
                          if (tStart <= dayEnd && tEnd > dayStart) {
                            dayTaskChunks.push({ task: t, chunkStart: t.scheduled_start, chunkEnd: t.scheduled_end, chunkIndex: 0, totalChunks: 1, layoutId: `task-${t.id}` })
                          }
                        }
                      }
                    }

                    // Build layout items
                    const layoutItems: LayoutItem[] = [
                      ...dayEvents.map(e => {
                        const eStart = new Date(e.start_time)
                        const eEnd = new Date(e.end_time)
                        // For multi-day: clamp start/end to this day's boundaries
                        const effectiveStart = eStart < dayStart ? 0 : eStart.getHours() * 60 + eStart.getMinutes()
                        const effectiveEnd = eEnd > dayEnd ? 24 * 60 : eEnd.getHours() * 60 + eEnd.getMinutes()
                        return { id: e.id, start: effectiveStart, end: Math.max(effectiveEnd, effectiveStart + 15) }
                      }),
                      ...dayTaskChunks.map(tc => {
                        const tStart = new Date(tc.chunkStart)
                        const tEnd = new Date(tc.chunkEnd)
                        const effectiveStart = tStart < dayStart ? 0 : tStart.getHours() * 60 + tStart.getMinutes()
                        const effectiveEnd = tEnd > dayEnd ? 17 * 60 : tEnd.getHours() * 60 + tEnd.getMinutes()
                        return { id: tc.layoutId, start: effectiveStart, end: Math.max(effectiveEnd, effectiveStart + 15) }
                      }),
                      ...dayAppointments.map(a => {
                        const aStart = new Date(a.starts_at * 1000)
                        const aEnd = new Date(a.ends_at * 1000)
                        const effectiveStart = aStart < dayStart ? 0 : aStart.getHours() * 60 + aStart.getMinutes()
                        const effectiveEnd = aEnd > dayEnd ? 24 * 60 : aEnd.getHours() * 60 + aEnd.getMinutes()
                        return { id: `appt-${a.id}`, start: effectiveStart, end: Math.max(effectiveEnd, effectiveStart + 15) }
                      }),
                    ]
                    const layout = layoutOverlapping(layoutItems)

                    return (
                      <>
                        {dayEvents.map(e => {
                          const cal = calendars.find(c => c.id === e.calendar_id)
                          const l = layout.get(e.id)
                          const projectColor = e.project_id ? allProjects.find(p => p.id === e.project_id)?.color : undefined
                          const invited = e.response_status === 'needsAction' || e.response_status === 'tentative' || e.response_status === 'declined'
                          const evColor = projectColor || e.color || cal?.color || '#4285f4'
                          // Background: project color overrides event color, mapped to calendar bg
                          const eventCalBg = getCalendarBg(evColor) || calendarColor
                          // Clamp multi-day events to this day's boundaries
                          const eStart = new Date(e.start_time)
                          const eEnd = new Date(e.end_time)
                          const isMultiDay = !isSameDay(eStart, eEnd)
                          const startsBeforeToday = eStart < dayStart
                          const endsAfterToday = eEnd > dayEnd
                          const clampedStartTime = startsBeforeToday ? dayStart.toISOString() : e.start_time
                          const clampedEndTime = endsAfterToday ? new Date(dayEnd.getTime() + 1).toISOString() : e.end_time
                          const eventTop = getPositionFromTime(clampedStartTime)
                          let eventHeight = getDurationHeight(clampedStartTime, clampedEndTime)
                          // Live resize preview
                          if (resizeEvent && resizeEvent.event.id === e.id) {
                            const deltaY = resizeEvent.currentY - resizeEvent.startY
                            eventHeight = Math.max(eventHeight + deltaY, HOUR_HEIGHT / 4) // min 15min
                          }
                          const travelBefore = e.travel_time_before || 0
                          const travelAfter = e.travel_time_after || 0
                          const eventWidthPercent = (l?.totalColumns ?? 1) > 1 ? `calc(${100 / (l?.totalColumns ?? 1)}% - 22px)` : 'calc(100% - 24px)'
                          const eventLeftPercent = (l?.totalColumns ?? 1) > 1 ? `calc(${((l?.column ?? 0) / (l?.totalColumns ?? 1)) * 100}% + 1px)` : '4px'
                          const travelBg = `${eventCalBg}d9`
                          const travelEdge = `${evColor}66`
                          return (
                            <div key={e.id} className="contents">
                              {/* Travel time BEFORE event */}
                              {travelBefore > 0 && (
                                <div
                                  className="absolute rounded-t-md z-[5] pointer-events-none overflow-hidden"
                                  style={{
                                    top: `${eventTop - (travelBefore / 60) * HOUR_HEIGHT}px`,
                                    height: `${(travelBefore / 60) * HOUR_HEIGHT}px`,
                                    left: eventLeftPercent,
                                    width: eventWidthPercent,
                                    background: travelBg,
                                    borderLeft: `3px solid ${evColor}aa`,
                                    borderTop: `1px dashed ${travelEdge}`,
                                    borderRight: `1px dashed ${travelEdge}`,
                                  }}
                                >
                                  <div className="flex items-center gap-1 px-1.5 py-0.5">
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: 'rgba(255,255,255,0.62)' }}>
                                      <path d="M8 2a5.5 5.5 0 00-5.5 5.5c0 4.5 5.5 8 5.5 8s5.5-3.5 5.5-8A5.5 5.5 0 008 2zm0 7.5a2 2 0 110-4 2 2 0 010 4z" fill="currentColor"/>
                                    </svg>
                                    <span className="text-[10px] font-medium text-white/60">Travel {travelBefore}m</span>
                                  </div>
                                </div>
                              )}
                              <EventBlock
                                title={e.title}
                                top={eventTop}
                                height={eventHeight}
                                color={evColor}
                                type="event"
                                startTime={e.start_time}
                                endTime={e.end_time}
                                isPast={isEventPast(e.end_time)}
                                conferenceType={detectConference(e)}
                                subtitle={e.location || undefined}
                                onClick={() => { setSelectedEvent(e); setCreateMenu(null) }}
                                onDragStart={ev => handleEventDragStart(e, ev, dayIndex)}
                                onDragEnd={() => {}}
                                colIndex={l?.column ?? 0}
                                totalCols={l?.totalColumns ?? 1}
                                eventId={e.id}
                                calendarId={e.calendar_id}
                                projectName={e.project_id ? allProjects.find(p => p.id === e.project_id)?.name : undefined}
                                busyStatus={e.busy_status || undefined}
                                isInvited={invited}
                                responseStatus={e.response_status}
                                isRecurring={!!(e.recurrence_rule || e.recurring_event_id)}
                                recurringEventId={e.recurring_event_id || undefined}
                                onResizeStart={ev => handleEventResizeStart(e, ev)}
                                calendarBg={eventCalBg}
                              />
                              {/* Travel time AFTER event */}
                              {travelAfter > 0 && (
                                <div
                                  className="absolute rounded-b-md z-[5] pointer-events-none overflow-hidden"
                                  style={{
                                    top: `${eventTop + eventHeight}px`,
                                    height: `${(travelAfter / 60) * HOUR_HEIGHT}px`,
                                    left: eventLeftPercent,
                                    width: eventWidthPercent,
                                    background: travelBg,
                                    borderLeft: `3px solid ${evColor}aa`,
                                    borderBottom: `1px dashed ${travelEdge}`,
                                    borderRight: `1px dashed ${travelEdge}`,
                                  }}
                                >
                                  <div className="flex items-center gap-1 px-1.5 py-0.5">
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: 'rgba(255,255,255,0.62)' }}>
                                      <path d="M8 2a5.5 5.5 0 00-5.5 5.5c0 4.5 5.5 8 5.5 8s5.5-3.5 5.5-8A5.5 5.5 0 008 2zm0 7.5a2 2 0 110-4 2 2 0 010 4z" fill="currentColor"/>
                                    </svg>
                                    <span className="text-[10px] font-medium text-white/60">Travel {travelAfter}m</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {dayTaskChunks.map(tc => {
                          const t = tc.task
                          const l = layout.get(tc.layoutId)
                          const enriched = t as EnrichedCalTask
                          const taskColor = enriched.project_color || (t.project_id ? PRIORITY_COLORS[t.priority] : '#6b7280')
                          const isOverdue = !!(t as EnrichedCalTask).overdue_from
                          const isAsap = !!(t as unknown as { is_asap?: number }).is_asap
                          // Use chunk times (already correct), clamp to day boundaries
                          const tStart = new Date(tc.chunkStart)
                          const tEnd = new Date(tc.chunkEnd)
                          const clampedStart = tStart < dayStart ? dayStart.toISOString() : tc.chunkStart
                          const clampedEnd = tEnd > dayEnd ? new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 17, 0).toISOString() : tc.chunkEnd
                          return (
                            <div key={tc.layoutId} className="contents group/task">
                              <EventBlock
                                title={tc.totalChunks > 1 ? `${t.title}` : t.title}
                                top={getPositionFromTime(clampedStart)}
                                height={getDurationHeight(clampedStart, clampedEnd)}
                                color={taskColor}
                                type="task"
                                startTime={clampedStart}
                                endTime={clampedEnd}
                                isPast={isEventPast(tc.chunkEnd)}
                                subtitle={(() => {
                                  const chunkMins = Math.round((new Date(tc.chunkEnd).getTime() - new Date(tc.chunkStart).getTime()) / 60000)
                                  const duration = chunkMins > 0
                                    ? (chunkMins >= 60 ? `${Math.floor(chunkMins / 60)}h${chunkMins % 60 ? ` ${chunkMins % 60}m` : ''}` : `${chunkMins}m`)
                                    : ''
                                  const contact = enriched.contact_name
                                  if (contact && duration) return `${duration} · ${contact}`
                                  if (contact) return contact
                                  return duration || undefined
                                })()}
                                onClick={() => onTaskClick?.(t)}
                                onDragStart={e => handleDragStart(t.id, e, tc.chunkStart, tc.chunkEnd, dayIndex, tc.totalChunks)}
                                onDragEnd={() => {}}
                                colIndex={l?.column ?? 0}
                                totalCols={l?.totalColumns ?? 1}
                                overdue={isOverdue}
                                overdueFrom={isOverdue ? (t as EnrichedCalTask).overdue_from ?? undefined : undefined}
                                badge={isAsap ? 'ASAP' : isOverdue ? 'OVERDUE' : undefined}
                                badgeColor={isAsap ? '#f59e0b' : isOverdue ? '#ef5350' : undefined}
                                onStartTask={() => startTask(t.id)}
                                isTimerRunning={t.status === 'in_progress'}
                                isRecurring={!!t.recurrence_rule}
                                chunkLabel={tc.totalChunks > 1 ? `${tc.chunkIndex + 1}/${tc.totalChunks}` : undefined}
                                onEdit={() => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: t.id } }))}
                                onSetPriority={async (priority) => {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, priority }) })
                                  onTaskUpdate?.(t.id, { priority })
                                  onScheduleChange?.()
                                }}
                                onMarkComplete={async () => {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, status: 'done', completed_at: Math.floor(Date.now() / 1000) }) })
                                  onTaskUpdate?.(t.id, { status: 'done' })
                                  onScheduleChange?.()
                                }}
                                onDelete={async () => {
                                  await fetch('/api/tasks', {
                                    method: 'DELETE',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ id: t.id }),
                                  })
                                  onScheduleChange?.()
                                }}
                                taskId={t.id}
                                onCancel={async () => {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, status: 'cancelled' }) })
                                  onTaskUpdate?.(t.id, { status: 'cancelled' })
                                  onScheduleChange?.()
                                }}
                                onDuplicate={async () => {
                                  await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t.title, priority: t.priority, duration_minutes: t.duration_minutes, project_id: t.project_id, workspace_id: t.workspace_id, auto_schedule: 1 }) })
                                  onScheduleChange?.()
                                }}
                                onDoLater={async () => {
                                  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0)
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, start_date: tomorrow.toISOString().split('T')[0] }) })
                                  triggerRefresh()
                                }}
                                onDoAsap={async () => {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, is_asap: 1 }) })
                                  triggerRefresh()
                                }}
                                onUnschedule={async () => {
                                  await fetch('/api/tasks', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      id: t.id,
                                      auto_schedule: 0,
                                      scheduled_start: null,
                                      scheduled_end: null,
                                      locked_at: null,
                                    }),
                                  })
                                  onScheduleChange?.()
                                }}
                                onArchive={async () => {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, status: 'archived' }) })
                                  onTaskUpdate?.(t.id, { status: 'archived' })
                                  onScheduleChange?.()
                                }}
                                onChangeStartDate={() => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: t.id, focus: 'start_date' } }))}
                                onChangeDeadline={() => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: t.id, focus: 'deadline' } }))}
                                onAddTime={() => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: t.id, focus: 'duration' } }))}
                                onSetBlockers={() => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: t.id, focus: 'blockers' } }))}
                                onViewProject={t.project_id ? () => window.location.href = `/project/${(t as any).project_public_id || t.project_id}` : undefined}
                                projectName={enriched.project_name || undefined}
                                locked={!!t.locked_at}
                                onToggleLock={async () => {
                                  const locked = t.locked_at ? null : new Date().toISOString()
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, locked_at: locked }) })
                                  onScheduleChange?.()
                                }}
                              />
                            </div>
                          )
                        })}
                        {dayAppointments.map(a => {
                          const layoutId = `appt-${a.id}`
                          const l = layout.get(layoutId)
                          const aStart = new Date(a.starts_at * 1000)
                          const aEnd = new Date(a.ends_at * 1000)
                          const clampedStart = aStart < dayStart ? dayStart.toISOString() : aStart.toISOString()
                          const clampedEnd = aEnd > dayEnd ? new Date(dayEnd.getTime() + 1).toISOString() : aEnd.toISOString()
                          const apptColor = appointmentColor(a.status)
                          const title = a.contact_name || 'Appointment'
                          const subtitle = a.calendar_name || undefined
                          return (
                            <EventBlock
                              key={layoutId}
                              title={title}
                              top={getPositionFromTime(clampedStart)}
                              height={getDurationHeight(clampedStart, clampedEnd)}
                              color={apptColor}
                              type="appointment"
                              startTime={aStart.toISOString()}
                              endTime={aEnd.toISOString()}
                              isPast={isEventPast(aEnd.toISOString())}
                              subtitle={subtitle}
                              colIndex={l?.column ?? 0}
                              totalCols={l?.totalColumns ?? 1}
                              onClick={() => {
                                if (a.contact_id) router.push(`/crm/contacts/${a.contact_id}`)
                              }}
                            />
                          )
                        })}
                      </>
                    )
                  })()}

                  {/* Drag-to-create selection preview (while dragging) */}
                  {dragCreate && dragCreate.dayIndex === dayIndex && (() => {
                    const minY = Math.min(dragCreate.startY, dragCreate.currentY)
                    const maxY = Math.max(dragCreate.startY, dragCreate.currentY)
                    const height = maxY - minY
                    if (height < 5) return null
                    const startT = getTimeFromY(minY, displayDates[dayIndex])
                    const endT = getTimeFromY(maxY, displayDates[dayIndex])
                    if (endT.getTime() - startT.getTime() < 15 * 60000) {
                      endT.setTime(startT.getTime() + 15 * 60000)
                    }
                    return (
                      <div
                        className="absolute left-1 right-1 rounded-md border z-30 pointer-events-none"
                        style={{ top: `${minY}px`, height: `${Math.max(height, 22)}px`, borderColor: `${calendarColor}cc`, background: calendarColor }}
                      >
                        <div className="px-2 py-1 text-[10px] font-medium text-white/80">
                          {formatTimeShort(startT)} - {formatTimeShort(endT)}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Persistent selection highlight (while menu/panel is open) */}
                  {!dragCreate && selectionDayIndex === dayIndex && (createMenu || createMode) && createTimeRange && (() => {
                    const startTop = getPositionFromTime(createTimeRange.start.toISOString())
                    const height = getDurationHeight(createTimeRange.start.toISOString(), createTimeRange.end.toISOString())
                    return (
                      <div
                        className="absolute left-1 right-1 rounded-md border z-30 pointer-events-none"
                        style={{ top: `${startTop}px`, height: `${height}px`, borderColor: `${calendarColor}cc`, background: calendarColor }}
                      >
                        <div className="px-2 py-1 text-[10px] font-medium text-white/80">
                          {formatTimeShort(createTimeRange.start)} - {formatTimeShort(createTimeRange.end)}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Drag ghost preview for events */}
                  {dragEvent && dragEvent.dayIndex === dayIndex && (() => {
                    const ev = dragEvent.event
                    const durationH = dragEvent.durationMin / 60
                    const ghostHeight = durationH * HOUR_HEIGHT
                    const clampedHours = getClampedStartHours(dragEvent.currentY, dragEvent.durationMin, dragEvent.grabOffset)
                    const ghostTop = (clampedHours - START_HOUR) * HOUR_HEIGHT
                    const ghostStartH = Math.floor(clampedHours)
                    const ghostStartM = Math.round((clampedHours % 1) * 60)
                    const endHours = clampedHours + durationH
                    const ghostEndH = Math.floor(endHours)
                    const ghostEndM = Math.round((endHours % 1) * 60)
                    const fmt = (h: number, m: number) => {
                      const ampm = h >= 12 ? 'PM' : 'AM'
                      const hr = h === 0 ? 12 : h > 12 ? h - 12 : h
                      return m === 0 ? `${hr} ${ampm}` : `${hr}:${m.toString().padStart(2, '0')} ${ampm}`
                    }
                    const cal = calendars.find(c => c.id === ev.calendar_id)
                    const color = cal?.color || '#4285f4'
                    return (
                      <div
                        className="absolute left-1 right-1 rounded-md overflow-hidden z-30 pointer-events-none opacity-70 border-2 border-dashed"
                        style={{
                          top: `${ghostTop}px`,
                          height: `${ghostHeight}px`,
                          background: `${color}40`,
                          borderColor: color,
                          borderLeft: `3px solid ${color}`,
                        }}
                      >
                        <div className="px-1.5 py-1">
                          <div className="text-[10px] font-medium text-text truncate">{ev.title}</div>
                          <div className="text-[10px] text-text-dim">{fmt(ghostStartH, ghostStartM)} - {fmt(ghostEndH, ghostEndM)}</div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Drag ghost preview for tasks */}
                  {dragTask && dragTask.dayIndex === dayIndex && (() => {
                    const task = tasks.find(t => t.id === dragTask.id)
                    if (!task) return null
                    // Use chunk duration (stored at drag start), not full task duration
                    const durationMin = dragTask.chunkDurationMin || task.duration_minutes || 30
                    const durationH = durationMin / 60
                    const ghostHeight = durationH * HOUR_HEIGHT
                    const clampedHours = getClampedStartHours(dragTask.currentY, durationMin, dragTask.grabOffset)
                    const ghostTop = (clampedHours - START_HOUR) * HOUR_HEIGHT
                    const ghostStartH = Math.floor(clampedHours)
                    const ghostStartM = Math.round((clampedHours % 1) * 60)
                    const endHours = clampedHours + durationH
                    const ghostEndH = Math.floor(endHours)
                    const ghostEndM = Math.round((endHours % 1) * 60)
                    const fmt = (h: number, m: number) => {
                      const ampm = h >= 12 ? 'PM' : 'AM'
                      const hr = h === 0 ? 12 : h > 12 ? h - 12 : h
                      return m === 0 ? `${hr} ${ampm}` : `${hr}:${m.toString().padStart(2, '0')} ${ampm}`
                    }
                    const enrichedDrag = task as EnrichedCalTask
                    const color = enrichedDrag.project_color || (task.project_id ? PRIORITY_COLORS[task.priority] : '#6b7280')
                    return (
                      <div
                        className="absolute left-1 right-1 rounded-md overflow-hidden z-30 pointer-events-none opacity-70 border-2 border-dashed"
                        style={{
                          top: `${ghostTop}px`,
                          height: `${ghostHeight}px`,
                          background: `${color}40`,
                          borderColor: color,
                          borderLeft: `3px solid ${color}`,
                        }}
                      >
                        <div className="px-1.5 py-1">
                          <div className="text-[10px] font-medium text-text truncate">{task.title}</div>
                          <div className="text-[10px] text-text-dim">{fmt(ghostStartH, ghostStartM)} - {fmt(ghostEndH, ghostEndM)}</div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Now line - sage line across today's column */}
                  {today && nowTop >= 0 && nowTop <= (END_HOUR - START_HOUR) * HOUR_HEIGHT && (
                    <div className="absolute w-full z-20 pointer-events-none" style={{ top: `${nowTop}px` }}>
                      <div className="flex items-center">
                        <div className="w-[6px] h-[6px] rounded-full shrink-0 -ml-[3px]" style={{ background: 'var(--accent)' }} />
                        <div className="flex-1 h-[2px]" style={{ background: 'var(--accent)' }} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      {!sidebarCollapsed && <div className="hidden sm:flex flex-col w-[280px] shrink-0 border-l border-border overflow-y-auto" style={{ background: 'var(--bg)' }}>
        {/* Mini calendar section */}
        <div className="p-4 pb-3">
          <MiniCalendar currentDate={currentDate} onSelectDate={setCurrentDate} weekStartDay={weekStartDay} eventDates={eventDates} />
        </div>
        {/* Calendar list section - darker with rounded top */}
        <div className="flex-1 rounded-t-xl p-4 pt-4" style={{ background: 'rgba(0,0,0,0.15)' }}>
        <CalendarList
          calendars={calendars}
          onCalendarToggle={(calId, visible) => {
            setCalendars(prev => prev.map(c => c.id === calId ? { ...c, visible: visible ? 1 : 0 } : c))
          }}
          onCalendarColorChange={(calId, color) => {
            setCalendars(prev => prev.map(c => c.id === calId ? { ...c, color } : c))
          }}
        />
        </div>
      </div>}

      {/* Event detail panel */}
      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          calendarEmail={getCalendarEmailForEvent(selectedEvent)}
          color={calendars.find(c => c.id === selectedEvent.calendar_id)?.color}
          onClose={() => setSelectedEvent(null)}
          projects={allProjects}
          onSaved={() => { setTimeout(refetchEvents, 300); triggerRefresh() }}
          onCalendarColorChange={(calId, newColor) => {
            setCalendars(prev => prev.map(c => c.id === calId ? { ...c, color: newColor } : c))
          }}
          onProjectChange={(projectId) => {
            fetch('/api/calendar-events', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventId: selectedEvent.id, calendarId: selectedEvent.calendar_id, project_id: projectId }),
            }).then(() => {
              setEvents(prev => prev.map(ev => (ev.id === selectedEvent.id && ev.calendar_id === selectedEvent.calendar_id) ? { ...ev, project_id: projectId } : ev))
              setSelectedEvent(prev => prev ? { ...prev, project_id: projectId } : prev)
            })
          }}
        />
      )}

      {/* Create menu popup */}
      {createMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setCreateMenu(null); setCreateTimeRange(null); setSelectionDayIndex(null) }} />
          <div
            className="fixed z-50 w-56 rounded-xl border border-border glass-elevated animate-glass-in shadow-xl py-1.5"
            style={{
              left: `${Math.max(8, Math.min(createMenu.x - 120, typeof window !== 'undefined' ? window.innerWidth - 240 : createMenu.x))}px`,
              top: `${Math.max(8, Math.min(createMenu.y - 20, typeof window !== 'undefined' ? window.innerHeight - 140 : createMenu.y))}px`,
            }}
          >
            <div className="px-3 py-1.5 text-[10px] text-text-dim font-medium border-b border-border mb-1">
              {createMenu.startTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} -- {formatTimeShort(createMenu.startTime)} - {formatTimeShort(createMenu.endTime)}
            </div>
            <button
              onClick={() => handleCreateChoice('event')}
              className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-hover rounded-md mx-0"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M5 9h6M5 11h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/></svg>
              New Event
            </button>
            <button
              onClick={() => handleCreateChoice('task')}
              className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-hover rounded-md mx-0"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              New Task
            </button>
          </div>
        </>
      )}

      {/* Create event panel */}
      {createMode === 'event' && createTimeRange && (
        <EventDetailPanel
          event={{
            id: '',
            calendar_id: '',
            title: '',
            description: null,
            start_time: createTimeRange.start.toISOString(),
            end_time: createTimeRange.end.toISOString(),
            all_day: createAllDay ? 1 : 0,
            location: null,
            status: 'confirmed',
            project_id: null,
          }}
          calendarEmail={accounts[0]?.email}
          color="#7986cb"
          onClose={() => { setCreateMode(null); setCreateTimeRange(null); setSelectionDayIndex(null); setCreateAllDay(false) }}
          isCreate
          projects={allProjects}
          onSaved={() => { setTimeout(refetchEvents, 300); triggerRefresh(); setCreateAllDay(false) }}
        />
      )}

      {/* Task creation handled by useEffect below */}

      {/* Guest notification confirmation */}
      {guestConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-[360px] glass-elevated animate-glass-in rounded-xl border border-border shadow-2xl p-6 space-y-4">
            <h3 className="text-[14px] font-semibold text-text">Update guests?</h3>
            <p className="text-[13px] text-text-secondary">This event may have guests. Would you like to notify them about the time change?</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => confirmMoveEvent(false)}
                className="px-4 py-1.5 rounded-md text-[13px] text-text-dim hover:bg-hover"
              >
                Don&apos;t notify
              </button>
              <button
                onClick={() => confirmMoveEvent(true)}
                className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent/80"
              >
                Yes, notify guests
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule toast notification */}
      {scheduleToast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-xl text-[13px] font-medium flex items-center gap-2 ${
          scheduleToast.type === 'warning' ? 'bg-amber-500/90 text-black' : 'bg-accent/90 text-white'
        }`}>
          {scheduleToast.type === 'warning' ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 6v4M8 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
          {scheduleToast.message}
        </div>
      )}

      {/* Schedule results popup */}
      {schedulePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSchedulePopup(null)}>
          <div className="w-full max-w-md glass-elevated animate-glass-in rounded-xl border border-border shadow-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-text">Schedule Results</h3>
              <button onClick={() => setSchedulePopup(null)} className="text-text-dim hover:text-text p-1">
                <IconX size={14} />
              </button>
            </div>

            {schedulePopup.placements.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-accent-text uppercase tracking-wide">Scheduled ({schedulePopup.placements.length})</div>
                {schedulePopup.placements.map(p => {
                  const start = new Date(p.scheduledStart)
                  const end = new Date(p.scheduledEnd)
                  const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' - ' + end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  const isThisWeek = weekDates.some(d => isSameDay(d, start))
                  return (
                    <div key={p.taskId} className="flex items-start gap-2 p-2 rounded-lg bg-accent/5 border border-accent/10">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-accent-text mt-0.5 shrink-0"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text truncate">{p.title}</div>
                        <div className="text-[10px] text-text-dim">{dateStr} -- {timeStr}</div>
                      </div>
                      {!isThisWeek && (
                        <button
                          onClick={() => { setCurrentDate(start); setSchedulePopup(null) }}
                          className="text-[10px] text-accent-text border border-accent/20 rounded px-1.5 py-0.5 hover:bg-accent/10 shrink-0"
                        >
                          Go to week
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {schedulePopup.unplaceable.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-red-400 uppercase tracking-wide">Could not schedule ({schedulePopup.unplaceable.length})</div>
                {schedulePopup.unplaceable.map(u => (
                  <div key={u.taskId} className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-red-400 mt-0.5 shrink-0"><path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text truncate">{u.title}</div>
                      <div className="text-[10px] text-red-400">{u.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {schedulePopup.placements.length === 0 && schedulePopup.unplaceable.length === 0 && (
              <div className="text-[13px] text-text-dim text-center py-4">No auto-schedule tasks found. Mark tasks as &quot;Auto-scheduled&quot; first.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
