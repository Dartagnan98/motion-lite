// ReportPeriodSelector — GA-style date picker for the report header.
//
// Popover with:
//   - Left column: preset list + compare toggle + compare presets
//   - Right column: date input display + stacked two-month calendar
//
// On Apply:
//   POST /api/platform/reports/[reportId]/set-period
//   → refetch range-aware integrations for new primary + compare windows
//   → router.refresh()

'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportPeriodSelectorProps {
  reportId: number
  currentPeriodStart: string
  currentPeriodEnd: string
  currentComparePeriodStart?: string | null
  currentComparePeriodEnd?: string | null
  integrationIds: number[]
  accountId: number
}

type PrimaryPresetKey =
  | 'today'
  | 'yesterday'
  | 'this_week_sun_today'
  | 'last_7_days'
  | 'last_week_sun_sat'
  | 'last_28_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'last_90_days'
  | 'quarter_to_date'
  | 'this_year_jan_today'
  | 'last_calendar_year'
  | 'custom'

type ComparePresetKey =
  | 'previous_period_match_day_of_week'
  | 'previous_period'
  | 'previous_year'
  | 'previous_year_match_day_of_week'
  | 'custom'

// Which date range the calendar is currently editing
type CalendarFocus = 'primary_start' | 'primary_end' | 'compare_start' | 'compare_end'

// ─── Date math ────────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function addYears(d: Date, n: number): Date {
  const r = new Date(d)
  r.setFullYear(r.getFullYear() + n)
  return r
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function inclusiveLen(startISO: string, endISO: string): number {
  const s = new Date(startISO + 'T00:00:00')
  const e = new Date(endISO + 'T00:00:00')
  return daysBetween(s, e) + 1
}

function roundTo7(n: number): number {
  return Math.round(n / 7) * 7
}

function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function lastSunday(ref: Date): Date {
  const d = new Date(ref)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function prevWeekSunday(): Date {
  const d = lastSunday(today())
  d.setDate(d.getDate() - 7)
  return d
}

function prevWeekSaturday(): Date {
  const d = prevWeekSunday()
  d.setDate(d.getDate() + 6)
  return d
}

function firstDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function lastDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function firstDayOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3, 1)
}

function resolvePrimary(key: PrimaryPresetKey): { start: string; end: string } | null {
  const t = today()
  switch (key) {
    case 'today':
      return { start: toISO(t), end: toISO(t) }
    case 'yesterday': {
      const y = addDays(t, -1)
      return { start: toISO(y), end: toISO(y) }
    }
    case 'this_week_sun_today':
      return { start: toISO(lastSunday(t)), end: toISO(t) }
    case 'last_7_days':
      return { start: toISO(addDays(t, -7)), end: toISO(addDays(t, -1)) }
    case 'last_week_sun_sat':
      return { start: toISO(prevWeekSunday()), end: toISO(prevWeekSaturday()) }
    case 'last_28_days':
      return { start: toISO(addDays(t, -28)), end: toISO(addDays(t, -1)) }
    case 'last_30_days':
      return { start: toISO(addDays(t, -30)), end: toISO(addDays(t, -1)) }
    case 'this_month':
      return { start: toISO(firstDayOfMonth(t)), end: toISO(t) }
    case 'last_month': {
      const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      return { start: toISO(firstDayOfMonth(lm)), end: toISO(lastDayOfMonth(lm)) }
    }
    case 'last_90_days':
      return { start: toISO(addDays(t, -90)), end: toISO(addDays(t, -1)) }
    case 'quarter_to_date':
      return { start: toISO(firstDayOfQuarter(t)), end: toISO(t) }
    case 'this_year_jan_today':
      return { start: `${t.getFullYear()}-01-01`, end: toISO(t) }
    case 'last_calendar_year': {
      const y = t.getFullYear() - 1
      return { start: `${y}-01-01`, end: `${y}-12-31` }
    }
    case 'custom':
      return null
  }
}

function resolveCompare(
  key: ComparePresetKey,
  primaryStart: string,
  primaryEnd: string
): { start: string; end: string } | null {
  if (!primaryStart || !primaryEnd) return null
  const len = inclusiveLen(primaryStart, primaryEnd)
  const ps = new Date(primaryStart + 'T00:00:00')
  const pe = new Date(primaryEnd + 'T00:00:00')

  switch (key) {
    case 'previous_period_match_day_of_week': {
      const shift = roundTo7(len)
      const alignedEnd = addDays(ps, -shift + len - 1)
      const alignedStart = addDays(ps, -shift)
      return { start: toISO(alignedStart), end: toISO(alignedEnd) }
    }
    case 'previous_period': {
      const end = addDays(ps, -1)
      const start = addDays(end, -(len - 1))
      return { start: toISO(start), end: toISO(end) }
    }
    case 'previous_year':
      return {
        start: toISO(addYears(ps, -1)),
        end: toISO(addYears(pe, -1)),
      }
    case 'previous_year_match_day_of_week':
      return {
        start: toISO(addDays(ps, -364)),
        end: toISO(addDays(pe, -364)),
      }
    case 'custom':
      return null
  }
}

// ─── Preset metadata ──────────────────────────────────────────────────────────

const PRIMARY_PRESETS: Array<{ key: PrimaryPresetKey; label: string; hasSubmenu?: boolean }> = [
  { key: 'custom', label: 'Custom' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week_sun_today', label: 'This week (Sun–Today)', hasSubmenu: true },
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_week_sun_sat', label: 'Last week (Sun–Sat)', hasSubmenu: true },
  { key: 'last_28_days', label: 'Last 28 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'quarter_to_date', label: 'Quarter to date' },
  { key: 'this_year_jan_today', label: 'This year (Jan–Today)' },
  { key: 'last_calendar_year', label: 'Last calendar year' },
]

const COMPARE_PRESETS: Array<{ key: ComparePresetKey; label: string }> = [
  { key: 'previous_period_match_day_of_week', label: 'Previous period (match day of week)' },
  { key: 'previous_period', label: 'Previous period' },
  { key: 'previous_year', label: 'Previous year' },
  { key: 'previous_year_match_day_of_week', label: 'Previous year (match day of week)' },
  { key: 'custom', label: 'Custom' },
]

// ─── Detect presets from date strings ────────────────────────────────────────

function detectPrimaryPreset(start: string, end: string): PrimaryPresetKey {
  for (const p of PRIMARY_PRESETS) {
    if (p.key === 'custom') continue
    const r = resolvePrimary(p.key)
    if (r && r.start === start && r.end === end) return p.key
  }
  return 'custom'
}

function detectComparePreset(
  cStart: string,
  cEnd: string,
  primaryStart: string,
  primaryEnd: string
): ComparePresetKey {
  for (const p of COMPARE_PRESETS) {
    if (p.key === 'custom') continue
    const r = resolveCompare(p.key, primaryStart, primaryEnd)
    if (r && r.start === cStart && r.end === cEnd) return p.key
  }
  return 'custom'
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmtShort(iso: string): string {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtTrigger(iso: string): string {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function presetLabel(key: PrimaryPresetKey): string {
  return PRIMARY_PRESETS.find((p) => p.key === key)?.label ?? 'Custom'
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

/** Build the 6-row grid for a given year/month (0-indexed month). */
function buildCalendarGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1)
  const startDow = first.getDay() // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: Array<Date | null> = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length < 42) cells.push(null)
  return cells
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ─── Calendar cell classifier ─────────────────────────────────────────────────

type CellRole =
  | 'none'
  | 'primary-in'
  | 'primary-start'
  | 'primary-end'
  | 'primary-single'
  | 'compare-in'
  | 'compare-start'
  | 'compare-end'
  | 'compare-single'
  | 'today'

function classifyCell(
  cell: Date,
  primaryStart: string,
  primaryEnd: string,
  compareStart: string,
  compareEnd: string,
  showCompare: boolean
): CellRole {
  const iso = toISO(cell)
  const todayISO = toISO(today())

  const inPrimary = primaryStart && primaryEnd && iso >= primaryStart && iso <= primaryEnd
  const isPrimStart = iso === primaryStart
  const isPrimEnd = iso === primaryEnd

  if (inPrimary) {
    if (primaryStart === primaryEnd) return 'primary-single'
    if (isPrimStart) return 'primary-start'
    if (isPrimEnd) return 'primary-end'
    return 'primary-in'
  }

  if (showCompare && compareStart && compareEnd) {
    const inComp = iso >= compareStart && iso <= compareEnd
    if (inComp) {
      if (compareStart === compareEnd) return 'compare-single'
      if (iso === compareStart) return 'compare-start'
      if (iso === compareEnd) return 'compare-end'
      return 'compare-in'
    }
  }

  if (iso === todayISO) return 'today'
  return 'none'
}

// ─── Popover positioning ──────────────────────────────────────────────────────

interface PopoverPos {
  top: number
  // Exactly one of these is set:
  right?: number
  left?: number
}

const POPOVER_WIDTH = 740

function computePopoverPos(trigger: HTMLElement): PopoverPos {
  const rect = trigger.getBoundingClientRect()
  const top = rect.bottom + window.scrollY + 6

  // Prefer right-aligned: right edge of popover = right edge of trigger
  const rightEdge = window.innerWidth - rect.right
  const leftIfRightAligned = rect.right - POPOVER_WIDTH

  if (leftIfRightAligned >= 8) {
    // Fits — anchor right edge to trigger right edge
    return { top, right: rightEdge }
  }

  // Would clip left viewport edge — anchor left edge to trigger left edge instead
  const leftAligned = rect.left + window.scrollX
  return { top, left: Math.max(8, leftAligned) }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReportPeriodSelector({
  reportId,
  currentPeriodStart,
  currentPeriodEnd,
  currentComparePeriodStart,
  currentComparePeriodEnd,
  integrationIds,
  accountId,
}: ReportPeriodSelectorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // ── Popover open state
  const [open, setOpen] = useState(false)
  const [popoverPos, setPopoverPos] = useState<PopoverPos | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // ── Pending selection state (not committed until Apply)
  const [primaryPreset, setPrimaryPreset] = useState<PrimaryPresetKey>(
    () => detectPrimaryPreset(currentPeriodStart, currentPeriodEnd)
  )
  const [pendingStart, setPendingStart] = useState(currentPeriodStart)
  const [pendingEnd, setPendingEnd] = useState(currentPeriodEnd)

  const hasExplicitCompare = !!(currentComparePeriodStart && currentComparePeriodEnd)
  const [compareOn, setCompareOn] = useState(hasExplicitCompare)
  const [comparePreset, setComparePreset] = useState<ComparePresetKey>(() => {
    if (!hasExplicitCompare) return 'previous_period_match_day_of_week'
    return detectComparePreset(
      currentComparePeriodStart!,
      currentComparePeriodEnd!,
      currentPeriodStart,
      currentPeriodEnd
    )
  })
  const [pendingCompareStart, setPendingCompareStart] = useState(
    currentComparePeriodStart ?? ''
  )
  const [pendingCompareEnd, setPendingCompareEnd] = useState(
    currentComparePeriodEnd ?? ''
  )

  // ── Calendar view state (which two months to show)
  const initViewMonth = (() => {
    const d = currentPeriodEnd
      ? new Date(currentPeriodEnd + 'T00:00:00')
      : today()
    return { year: d.getFullYear(), month: d.getMonth() > 0 ? d.getMonth() - 1 : 0 }
  })()
  const [calViewYear, setCalViewYear] = useState(initViewMonth.year)
  const [calViewMonth, setCalViewMonth] = useState(initViewMonth.month)

  // ── Calendar focus: which input is "active" for click-to-set
  const [calFocus, setCalFocus] = useState<CalendarFocus>('primary_start')

  // ── Loading + error states
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Derived: second calendar month
  const cal2Month = calViewMonth === 11 ? 0 : calViewMonth + 1
  const cal2Year = calViewMonth === 11 ? calViewYear + 1 : calViewYear

  // ── Compute popover position when opening
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    setPopoverPos(computePopoverPos(triggerRef.current))
  }, [open])

  // ── Close on outside click / ESC
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointerDown(e: PointerEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  // ── Sync calendar view to show the primary range months when popover opens
  useEffect(() => {
    if (!open) return
    if (pendingEnd) {
      const d = new Date(pendingEnd + 'T00:00:00')
      const m = d.getMonth() > 0 ? d.getMonth() - 1 : d.getMonth()
      setCalViewYear(d.getFullYear())
      setCalViewMonth(m)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── When compare toggle flips on, auto-resolve compare range from preset
  function handleCompareToggle(on: boolean) {
    setCompareOn(on)
    if (on && pendingStart && pendingEnd) {
      const defPreset: ComparePresetKey = 'previous_period_match_day_of_week'
      setComparePreset(defPreset)
      const r = resolveCompare(defPreset, pendingStart, pendingEnd)
      if (r) {
        setPendingCompareStart(r.start)
        setPendingCompareEnd(r.end)
      }
      setCalFocus('compare_start')
    } else if (!on) {
      setPendingCompareStart('')
      setPendingCompareEnd('')
    }
  }

  // ── Primary preset select
  function handlePrimaryPreset(key: PrimaryPresetKey) {
    setPrimaryPreset(key)
    if (key === 'custom') {
      setCalFocus('primary_start')
      return
    }
    const r = resolvePrimary(key)
    if (!r) return
    setPendingStart(r.start)
    setPendingEnd(r.end)
    setCalFocus('primary_start')
    if (compareOn && comparePreset !== 'custom') {
      const cr = resolveCompare(comparePreset, r.start, r.end)
      if (cr) {
        setPendingCompareStart(cr.start)
        setPendingCompareEnd(cr.end)
      }
    }
    if (r.end) {
      const d = new Date(r.end + 'T00:00:00')
      const m = d.getMonth() > 0 ? d.getMonth() - 1 : d.getMonth()
      setCalViewYear(d.getFullYear())
      setCalViewMonth(m)
    }
  }

  // ── Compare preset select
  function handleComparePreset(key: ComparePresetKey) {
    setComparePreset(key)
    if (key === 'custom') {
      setCalFocus('compare_start')
      return
    }
    if (!pendingStart || !pendingEnd) return
    const r = resolveCompare(key, pendingStart, pendingEnd)
    if (r) {
      setPendingCompareStart(r.start)
      setPendingCompareEnd(r.end)
    }
  }

  // ── Calendar cell click
  const handleCellClick = useCallback(
    (iso: string) => {
      if (calFocus === 'primary_start') {
        setPendingStart(iso)
        if (pendingEnd && iso > pendingEnd) setPendingEnd('')
        setCalFocus('primary_end')
        setPrimaryPreset('custom')
      } else if (calFocus === 'primary_end') {
        if (!pendingStart || iso >= pendingStart) {
          setPendingEnd(iso)
          setCalFocus('primary_start')
          setPrimaryPreset('custom')
          if (compareOn && comparePreset !== 'custom' && pendingStart) {
            const cr = resolveCompare(comparePreset, pendingStart, iso)
            if (cr) {
              setPendingCompareStart(cr.start)
              setPendingCompareEnd(cr.end)
            }
          }
        } else {
          setPendingStart(iso)
          setPendingEnd('')
          setPrimaryPreset('custom')
        }
      } else if (calFocus === 'compare_start') {
        setPendingCompareStart(iso)
        if (pendingCompareEnd && iso > pendingCompareEnd) setPendingCompareEnd('')
        setCalFocus('compare_end')
        setComparePreset('custom')
      } else if (calFocus === 'compare_end') {
        if (!pendingCompareStart || iso >= pendingCompareStart) {
          setPendingCompareEnd(iso)
          setCalFocus('compare_start')
          setComparePreset('custom')
        } else {
          setPendingCompareStart(iso)
          setPendingCompareEnd('')
          setComparePreset('custom')
        }
      }
    },
    [calFocus, pendingStart, pendingEnd, pendingCompareStart, pendingCompareEnd, compareOn, comparePreset]
  )

  // ── Validation
  const rangesOverlap =
    compareOn &&
    pendingStart &&
    pendingEnd &&
    pendingCompareStart &&
    pendingCompareEnd &&
    pendingCompareEnd >= pendingStart

  const applyDisabled =
    !pendingStart ||
    !pendingEnd ||
    pendingStart > pendingEnd ||
    (compareOn && (!pendingCompareStart || !pendingCompareEnd)) ||
    !!rangesOverlap ||
    fetching ||
    isPending

  // ── Apply
  async function handleApply() {
    if (applyDisabled) return
    setError(null)

    const body = {
      periodStart: pendingStart,
      periodEnd: pendingEnd,
      comparePeriodStart: compareOn ? pendingCompareStart : null,
      comparePeriodEnd: compareOn ? pendingCompareEnd : null,
    }

    const res = await fetch(`/api/platform/reports/${reportId}/set-period`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setError(data.error ?? 'Failed to update period')
      return
    }

    if (integrationIds.length > 0) {
      setFetching(true)
      try {
        const fetches: Promise<unknown>[] = integrationIds.map((id) =>
          fetch(`/api/platform/integrations/${id}/refetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              periodStart: pendingStart,
              periodEnd: pendingEnd,
              accountId,
            }),
          })
        )
        if (compareOn && pendingCompareStart && pendingCompareEnd) {
          for (const id of integrationIds) {
            fetches.push(
              fetch(`/api/platform/integrations/${id}/refetch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  periodStart: pendingCompareStart,
                  periodEnd: pendingCompareEnd,
                  accountId,
                }),
              })
            )
          }
        }
        await Promise.allSettled(fetches)
      } finally {
        setFetching(false)
      }
    }

    setOpen(false)
    startTransition(() => router.refresh())
  }

  // ── Cancel
  function handleCancel() {
    setPendingStart(currentPeriodStart)
    setPendingEnd(currentPeriodEnd)
    setPrimaryPreset(detectPrimaryPreset(currentPeriodStart, currentPeriodEnd))
    const hadCompare = !!(currentComparePeriodStart && currentComparePeriodEnd)
    setCompareOn(hadCompare)
    setPendingCompareStart(currentComparePeriodStart ?? '')
    setPendingCompareEnd(currentComparePeriodEnd ?? '')
    if (hadCompare && currentComparePeriodStart && currentComparePeriodEnd) {
      setComparePreset(
        detectComparePreset(
          currentComparePeriodStart,
          currentComparePeriodEnd,
          currentPeriodStart,
          currentPeriodEnd
        )
      )
    }
    setError(null)
    setOpen(false)
  }

  // ── Trigger button label
  const triggerLabel =
    primaryPreset === 'custom'
      ? 'Custom'
      : presetLabel(primaryPreset)

  const triggerRange =
    currentPeriodStart && currentPeriodEnd
      ? `${fmtTrigger(currentPeriodStart)} – ${fmtTrigger(currentPeriodEnd)}`
      : ''

  // ── Calendar navigation
  function shiftCalendar(delta: number) {
    let m = calViewMonth + delta
    let y = calViewYear
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setCalViewMonth(m)
    setCalViewYear(y)
  }

  // ── Popover inline style from computed position
  const popoverStyle: React.CSSProperties = popoverPos
    ? {
        position: 'fixed',
        top: popoverPos.top,
        ...(popoverPos.right !== undefined ? { right: popoverPos.right } : { left: popoverPos.left }),
        width: POPOVER_WIDTH,
        zIndex: 50,
      }
    : { display: 'none' }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    // Wrapper is not relative anymore — popover is fixed-positioned
    <div>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        disabled={fetching || isPending}
        className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md px-3 py-1.5 hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[var(--accent,#0891b2)] focus:border-transparent disabled:opacity-50 transition-colors whitespace-nowrap"
        aria-label="Select report period"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {fetching || isPending ? (
          <span className="text-gray-400">{fetching ? 'Fetching…' : 'Updating…'}</span>
        ) : (
          <>
            <span className="font-semibold">{triggerLabel}</span>
            {triggerRange && (
              <>
                <span className="text-gray-300 select-none">|</span>
                <span className="text-gray-500">{triggerRange}</span>
              </>
            )}
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {/* Popover — fixed positioned, measured on open */}
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Date range picker"
          style={popoverStyle}
          className="bg-[var(--bg-surface,#fff)] border border-[var(--border,#e5e7eb)] rounded-xl shadow-2xl flex overflow-hidden"
        >
          {/* ── Left column — preset list (always visible, never flex-shrinks) */}
          <div
            className="flex flex-col border-r border-[var(--border,#e5e7eb)] overflow-y-auto flex-shrink-0"
            style={{ width: 248 }}
          >
            {/* Primary presets */}
            <div className="px-2 pt-3 pb-1 space-y-px">
              {PRIMARY_PRESETS.map((p) => {
                const isActive = primaryPreset === p.key
                return (
                  <button
                    key={p.key}
                    onClick={() => handlePrimaryPreset(p.key)}
                    className={[
                      'w-full text-left text-[13px] px-3 py-[5px] rounded flex items-center justify-between transition-colors',
                      isActive
                        ? 'bg-[var(--accent,#0891b2)] text-white font-medium'
                        : 'text-gray-700 hover:bg-gray-100',
                    ].join(' ')}
                  >
                    <span>{p.label}</span>
                    {p.hasSubmenu && (
                      <svg className="w-3 h-3 opacity-60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Divider + Compare toggle */}
            <div className="h-px bg-[var(--border,#e5e7eb)] mx-3 my-2" />
            <div className="px-5 py-2">
              <label className="flex items-center justify-between cursor-pointer select-none">
                <span className="text-[13px] font-medium text-gray-700">Compare</span>
                <button
                  role="switch"
                  aria-checked={compareOn}
                  onClick={() => handleCompareToggle(!compareOn)}
                  className={[
                    'relative inline-flex items-center h-5 w-9 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent,#0891b2)] focus:ring-offset-1',
                    compareOn ? 'bg-[var(--accent,#0891b2)]' : 'bg-gray-300',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'inline-block h-3.5 w-3.5 bg-white rounded-full shadow transition-transform',
                      compareOn ? 'translate-x-4' : 'translate-x-0.5',
                    ].join(' ')}
                  />
                </button>
              </label>
            </div>

            {/* Compare presets (only when on) */}
            {compareOn && (
              <>
                <div className="h-px bg-[var(--border,#e5e7eb)] mx-3 mb-1" />
                <div className="px-2 pb-3 space-y-px">
                  {COMPARE_PRESETS.map((p) => {
                    const isActive = comparePreset === p.key
                    return (
                      <button
                        key={p.key}
                        onClick={() => handleComparePreset(p.key)}
                        className={[
                          'w-full text-left text-[13px] px-3 py-[5px] rounded transition-colors',
                          isActive
                            ? 'bg-amber-500 text-white font-medium'
                            : 'text-gray-700 hover:bg-gray-100',
                        ].join(' ')}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* ── Right column — inputs + calendar + footer */}
          <div className="flex flex-col flex-1 min-w-0">
            {/* Date input boxes */}
            <div className="px-4 pt-3 pb-3 border-b border-[var(--border,#e5e7eb)] space-y-2.5">
              {/* Primary range */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: 'color-mix(in oklab, var(--accent,#0891b2) 60%, transparent)' }}
                  />
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Date range</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCalFocus('primary_start')}
                    className={[
                      'flex-1 text-left text-[13px] px-3 py-1.5 rounded border transition-colors',
                      calFocus === 'primary_start'
                        ? 'border-[var(--accent,#0891b2)] ring-1 ring-[var(--accent,#0891b2)] bg-blue-50'
                        : 'border-[var(--border,#e5e7eb)] hover:border-gray-300',
                    ].join(' ')}
                  >
                    <span className="text-[10px] text-gray-400 block leading-tight">Start date</span>
                    <span className={pendingStart ? 'text-gray-900' : 'text-gray-400'}>
                      {pendingStart ? fmtShort(pendingStart) : 'Select…'}
                    </span>
                  </button>
                  <span className="text-gray-400 text-sm select-none flex-shrink-0">—</span>
                  <button
                    onClick={() => setCalFocus('primary_end')}
                    className={[
                      'flex-1 text-left text-[13px] px-3 py-1.5 rounded border transition-colors',
                      calFocus === 'primary_end'
                        ? 'border-[var(--accent,#0891b2)] ring-1 ring-[var(--accent,#0891b2)] bg-blue-50'
                        : 'border-[var(--border,#e5e7eb)] hover:border-gray-300',
                    ].join(' ')}
                  >
                    <span className="text-[10px] text-gray-400 block leading-tight">End date</span>
                    <span className={pendingEnd ? 'text-gray-900' : 'text-gray-400'}>
                      {pendingEnd ? fmtShort(pendingEnd) : 'Select…'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Compare range */}
              {compareOn && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-amber-400" />
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Compare</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCalFocus('compare_start')}
                      className={[
                        'flex-1 text-left text-[13px] px-3 py-1.5 rounded border transition-colors',
                        calFocus === 'compare_start'
                          ? 'border-amber-500 ring-1 ring-amber-500 bg-amber-50'
                          : 'border-[var(--border,#e5e7eb)] hover:border-gray-300',
                      ].join(' ')}
                    >
                      <span className="text-[10px] text-gray-400 block leading-tight">Start date</span>
                      <span className={pendingCompareStart ? 'text-gray-900' : 'text-gray-400'}>
                        {pendingCompareStart ? fmtShort(pendingCompareStart) : 'Select…'}
                      </span>
                    </button>
                    <span className="text-gray-400 text-sm select-none flex-shrink-0">—</span>
                    <button
                      onClick={() => setCalFocus('compare_end')}
                      className={[
                        'flex-1 text-left text-[13px] px-3 py-1.5 rounded border transition-colors',
                        calFocus === 'compare_end'
                          ? 'border-amber-500 ring-1 ring-amber-500 bg-amber-50'
                          : 'border-[var(--border,#e5e7eb)] hover:border-gray-300',
                      ].join(' ')}
                    >
                      <span className="text-[10px] text-gray-400 block leading-tight">End date</span>
                      <span className={pendingCompareEnd ? 'text-gray-900' : 'text-gray-400'}>
                        {pendingCompareEnd ? fmtShort(pendingCompareEnd) : 'Select…'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {rangesOverlap && (
                <p className="text-[11px] text-red-500">
                  Compare range must end before the primary range starts.
                </p>
              )}
            </div>

            {/* Calendar — no overflow-y-auto; both months must fit without scroll */}
            <div className="px-4 py-3 flex-1">
              {/* Navigation row */}
              <div className="flex items-center justify-end mb-2 gap-0.5">
                <button
                  onClick={() => shiftCalendar(-1)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                  aria-label="Previous month"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => shiftCalendar(1)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                  aria-label="Next month"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Two stacked months */}
              <CalendarMonth
                year={calViewYear}
                month={calViewMonth}
                primaryStart={pendingStart}
                primaryEnd={pendingEnd}
                compareStart={pendingCompareStart}
                compareEnd={pendingCompareEnd}
                showCompare={compareOn}
                onCellClick={handleCellClick}
              />
              <div className="mt-3">
                <CalendarMonth
                  year={cal2Year}
                  month={cal2Month}
                  primaryStart={pendingStart}
                  primaryEnd={pendingEnd}
                  compareStart={pendingCompareStart}
                  compareEnd={pendingCompareEnd}
                  showCompare={compareOn}
                  onCellClick={handleCellClick}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-[var(--border,#e5e7eb)] px-4 py-2.5 flex items-center justify-end gap-2">
              {error && (
                <span className="text-[11px] text-red-500 flex-1 mr-2">{error}</span>
              )}
              <button
                onClick={handleCancel}
                className="text-[13px] font-medium text-gray-600 hover:text-gray-900 px-4 py-1.5 rounded border border-[var(--border,#e5e7eb)] hover:border-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={!!applyDisabled}
                className="text-[13px] font-medium text-white bg-[var(--accent,#0891b2)] hover:opacity-90 px-4 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CalendarMonth sub-component ──────────────────────────────────────────────

interface CalendarMonthProps {
  year: number
  month: number
  primaryStart: string
  primaryEnd: string
  compareStart: string
  compareEnd: string
  showCompare: boolean
  onCellClick: (iso: string) => void
}

function CalendarMonth({
  year,
  month,
  primaryStart,
  primaryEnd,
  compareStart,
  compareEnd,
  showCompare,
  onCellClick,
}: CalendarMonthProps) {
  const cells = buildCalendarGrid(year, month)
  const todayISO = toISO(today())

  return (
    <div>
      {/* Month + year header */}
      <div className="text-[12px] font-semibold text-gray-600 mb-1.5">
        {MONTH_NAMES[month]} {year}
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-0.5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="flex items-center justify-center h-7">
            <span className="text-[11px] text-gray-400 font-medium">{d}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid — 7 equal columns, each cell is 32×32 centered */}
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          if (!cell) {
            // Empty padding cell — same height as a real cell
            return <div key={i} className="h-8" />
          }

          const iso = toISO(cell)
          const role = classifyCell(cell, primaryStart, primaryEnd, compareStart, compareEnd, showCompare)
          const isToday = iso === todayISO

          // Determine visual treatment
          let bgClass = ''
          let textClass = 'text-gray-700'
          let fontClass = ''
          // Today ring: only when cell has no other role
          const showTodayRing = isToday && (role === 'none' || role === 'today')

          // Range fill spans the full column width (for in-range cells)
          // Endpoint/single cells get a 32×32 circle centered in the column
          let isEndpoint = false
          let isMidRange = false

          if (role === 'primary-in') {
            isMidRange = true
            bgClass = 'bg-[color-mix(in_oklab,var(--accent,#0891b2)_15%,transparent)]'
            textClass = 'text-gray-800'
          } else if (role === 'primary-start' || role === 'primary-end' || role === 'primary-single') {
            isEndpoint = true
            bgClass = 'bg-[var(--accent,#0891b2)]'
            textClass = 'text-white'
            fontClass = 'font-semibold'
          } else if (role === 'compare-in') {
            isMidRange = true
            bgClass = 'bg-amber-100'
            textClass = 'text-gray-800'
          } else if (role === 'compare-start' || role === 'compare-end' || role === 'compare-single') {
            isEndpoint = true
            bgClass = 'bg-amber-500'
            textClass = 'text-white'
            fontClass = 'font-semibold'
          }

          if (isMidRange) {
            // Full-width background strip (no rounded), digit centered
            return (
              <button
                key={iso}
                onClick={() => onCellClick(iso)}
                className={`h-8 w-full flex items-center justify-center ${bgClass} ${textClass} ${fontClass} hover:brightness-95 transition-[filter]`}
                style={{ fontSize: 12 }}
                aria-label={iso}
              >
                {cell.getDate()}
              </button>
            )
          }

          if (isEndpoint) {
            // Centered 32×32 circle on a transparent column background
            return (
              <div
                key={iso}
                className="h-8 w-full flex items-center justify-center"
              >
                <button
                  onClick={() => onCellClick(iso)}
                  className={`w-8 h-8 flex items-center justify-center rounded-full ${bgClass} ${textClass} ${fontClass} hover:opacity-90 transition-opacity`}
                  style={{ fontSize: 12 }}
                  aria-label={iso}
                  aria-pressed
                >
                  {cell.getDate()}
                </button>
              </div>
            )
          }

          // Plain cell — today gets a thin ring, others just hover
          return (
            <div key={iso} className="h-8 w-full flex items-center justify-center">
              <button
                onClick={() => onCellClick(iso)}
                className={[
                  'w-8 h-8 flex items-center justify-center rounded-full transition-colors',
                  showTodayRing
                    ? 'ring-[1.5px] ring-[#10b981] text-gray-700'
                    : 'text-gray-700 hover:bg-gray-100',
                ].join(' ')}
                style={{ fontSize: 12 }}
                aria-label={iso}
              >
                {cell.getDate()}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
