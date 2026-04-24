'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { formatDuration } from '@/lib/task-constants'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function CalendarDropdown({ value, onChange, onClose, anchorRef }: {
  value: Date
  onChange: (d: Date) => void
  onClose: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}) {
  const [viewMonth, setViewMonth] = useState(value.getMonth())
  const [viewYear, setViewYear] = useState(value.getFullYear())
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const calInstanceId = useRef(Math.random().toString(36).slice(2))

  const updatePos = useCallback(() => {
    if (!anchorRef?.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow > 340 ? r.bottom + 4 : r.top - 340
    setPos({ top: Math.max(8, top), left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) })
  }, [anchorRef])

  useEffect(() => {
    if (anchorRef) {
      updatePos()
      window.addEventListener('scroll', updatePos, true)
      window.addEventListener('resize', updatePos)
      return () => { window.removeEventListener('scroll', updatePos, true); window.removeEventListener('resize', updatePos) }
    }
  }, [anchorRef, updatePos])

  // Close when another picker/popover opens
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('popover-open', { detail: calInstanceId.current }))
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== calInstanceId.current) onClose()
    }
    window.addEventListener('popover-open', handler)
    return () => window.removeEventListener('popover-open', handler)
  }, [onClose])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return
      if (anchorRef?.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, anchorRef])

  const today = new Date()
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()

  const cells: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = []
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const m = viewMonth === 0 ? 11 : viewMonth - 1
    const y = viewMonth === 0 ? viewYear - 1 : viewYear
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true })
  }
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1
    const y = viewMonth === 11 ? viewYear + 1 : viewYear
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false })
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
    else setViewMonth(viewMonth - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
    else setViewMonth(viewMonth + 1)
  }

  const isSelected = (c: typeof cells[0]) => c.day === value.getDate() && c.month === value.getMonth() && c.year === value.getFullYear()
  const isToday = (c: typeof cells[0]) => c.day === today.getDate() && c.month === today.getMonth() && c.year === today.getFullYear()

  const calContent = (
    <div
      {...popupSurfaceDataProps}
      ref={ref}
      className={withPopupSurfaceClassName(`${anchorRef ? '' : 'absolute left-0 top-full mt-1 z-[60]'} w-[280px] rounded-lg border border-border-strong glass-elevated overflow-hidden`)}
      style={anchorRef ? { position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, background: 'var(--dropdown-bg)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } : undefined}
      onMouseDown={stopPopupMouseDown}
    >
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        <span className="text-[13px] text-text font-medium">{formatDate(value.toISOString())}</span>
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-[13px] text-text font-medium">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-text-dim">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 2.5l-4 3.5 4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-text-dim">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 px-3">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[11px] text-text-dim font-medium py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 px-3 pb-2">
        {cells.map((c, i) => {
          const sel = isSelected(c)
          const tod = isToday(c)
          return (
            <button
              key={i}
              onClick={() => {
                const nd = new Date(value)
                nd.setFullYear(c.year, c.month, c.day)
                onChange(nd)
                onClose()
              }}
              className={`h-8 w-full flex items-center justify-center text-[13px] rounded-md transition-colors relative ${
                sel ? 'bg-accent text-white font-medium' :
                c.isCurrentMonth ? 'text-text hover:bg-hover' : 'text-text-dim/40 hover:bg-hover'
              }`}
            >
              {c.day}
              {tod && !sel && (
                <span className="absolute top-0.5 right-0.5 text-[7px] text-text-dim font-bold">TODAY</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-border">
        <button onClick={() => { onChange(new Date(0)); onClose() }} className="text-[12px] text-text-dim hover:text-text hover:underline">Clear</button>
        <button onClick={() => {
          const nd = new Date(value)
          const t = new Date()
          nd.setFullYear(t.getFullYear(), t.getMonth(), t.getDate())
          onChange(nd); onClose()
        }} className="text-[12px] text-text-dim hover:text-text hover:underline">Today</button>
      </div>
    </div>
  )

  if (anchorRef && typeof document !== 'undefined') {
    return createPortal(calContent, document.body)
  }
  return calContent
}

export function TimeDropdown({ value, referenceTime, onChange, onClose, anchorRef }: {
  value: Date
  referenceTime?: Date
  onChange: (d: Date) => void
  onClose: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}) {
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const timeInstanceId = useRef(Math.random().toString(36).slice(2))

  const updatePos = useCallback(() => {
    if (!anchorRef?.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow > 320 ? r.bottom + 4 : r.top - 320
    setPos({ top: Math.max(8, top), left: Math.max(8, Math.min(r.left, window.innerWidth - 228)) })
  }, [anchorRef])

  useEffect(() => {
    if (anchorRef) {
      updatePos()
      window.addEventListener('scroll', updatePos, true)
      window.addEventListener('resize', updatePos)
      return () => { window.removeEventListener('scroll', updatePos, true); window.removeEventListener('resize', updatePos) }
    }
  }, [anchorRef, updatePos])

  // Close when another picker/popover opens
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('popover-open', { detail: timeInstanceId.current }))
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== timeInstanceId.current) onClose()
    }
    window.addEventListener('popover-open', handler)
    return () => window.removeEventListener('popover-open', handler)
  }, [onClose])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node)) return
      if (anchorRef?.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, anchorRef])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const slots: { label: string; hour: number; minute: number; duration?: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const d = new Date(2000, 0, 1, h, m)
      const label = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      let duration: string | undefined
      if (referenceTime) {
        const refMs = referenceTime.getHours() * 60 + referenceTime.getMinutes()
        const slotMs = h * 60 + m
        const diff = slotMs - refMs
        if (diff > 0) duration = formatDuration(diff)
      }
      slots.push({ label, hour: h, minute: m, duration })
    }
  }

  const filtered = filter
    ? slots.filter(s => s.label.toLowerCase().replace(/\s/g, '').includes(filter.toLowerCase().replace(/\s/g, '')))
    : slots

  const currentSlotIdx = slots.findIndex(s => s.hour === value.getHours() && s.minute === value.getMinutes())

  useEffect(() => {
    if (listRef.current && currentSlotIdx >= 0) {
      const item = listRef.current.children[currentSlotIdx] as HTMLElement
      if (item) item.scrollIntoView({ block: 'center' })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const timeContent = (
    <div
      {...popupSurfaceDataProps}
      ref={ref}
      className={withPopupSurfaceClassName(`${anchorRef ? '' : 'absolute left-0 top-full mt-1 z-[60]'} w-[220px] overflow-hidden animate-glass-in`)}
      style={anchorRef ? {
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        background: 'var(--dropdown-bg)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--glass-shadow-lg)',
      } : undefined}
      onMouseDown={stopPopupMouseDown}
    >
      <div className="px-3 py-2 border-b border-border">
        <input
          ref={inputRef}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter..."
          className="w-full bg-transparent text-[12px] text-text outline-none placeholder:text-text-dim"
        />
      </div>

      <div ref={listRef} className="max-h-[280px] overflow-y-auto py-1">
        {filtered.map((s, i) => {
          const isSelected = s.hour === value.getHours() && s.minute === value.getMinutes()
          return (
            <button
              key={i}
              onClick={() => {
                const nd = new Date(value)
                nd.setHours(s.hour, s.minute, 0, 0)
                onChange(nd)
                onClose()
              }}
              className={`w-full text-left px-2.5 py-1.5 text-[13px] flex items-center justify-between transition-colors ${
                isSelected ? 'text-text font-medium' : 'text-text hover:bg-[rgba(255,255,255,0.06)]'
              }`}
            >
              <span>{s.label} {s.duration && <span className="text-text-dim ml-2">{s.duration}</span>}</span>
              {isSelected && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 8l3 3 5-5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )

  if (anchorRef && typeof document !== 'undefined') {
    return createPortal(timeContent, document.body)
  }
  return timeContent
}

/** A styled custom select dropdown matching the app theme */
export function EventSelect({ value, options, onChange, icon, inputBg }: {
  value: string
  options: { value: string; label: string; icon?: React.ReactNode }[]
  onChange: (val: string) => void
  icon?: React.ReactNode
  inputBg?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const selectInstanceId = useRef(Math.random().toString(36).slice(2))

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow > 300 ? r.bottom + 4 : r.top - 300
    setPos({ top: Math.max(8, top), left: r.left, width: Math.max(160, r.width) })
  }, [])

  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('popover-open', { detail: selectInstanceId.current }))
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== selectInstanceId.current) setOpen(false)
    }
    window.addEventListener('popover-open', handler)
    return () => window.removeEventListener('popover-open', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => { window.removeEventListener('scroll', updatePos, true); window.removeEventListener('resize', updatePos) }
  }, [open, updatePos])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const current = options.find(o => o.value === value)

  const dropdownContent = open && typeof document !== 'undefined' ? createPortal(
    <div
      {...popupSurfaceDataProps}
      ref={dropdownRef}
      className={withPopupSurfaceClassName('max-h-[280px] overflow-y-auto rounded-lg py-1 animate-glass-in')}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        minWidth: 160,
        zIndex: 9999,
        background: 'var(--dropdown-bg)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--glass-shadow-lg)',
      }}
      onMouseDown={stopPopupMouseDown}
    >
      {options.map(o => {
        const isSelected = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => { onChange(o.value); setOpen(false) }}
            className={`w-full text-left px-2.5 py-1.5 text-[13px] flex items-center gap-2 transition-colors ${isSelected ? 'text-text font-medium' : 'text-text hover:bg-[rgba(255,255,255,0.06)]'}`}
          >
            {isSelected && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M4 8l3 3 5-5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            {o.icon}
            <span className={isSelected ? '' : 'ml-5'}>{o.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  ) : null

  return (
    <div ref={ref} className="relative flex-1">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 w-full border border-border rounded-md px-3 py-1.5 text-[13px] text-text hover:brightness-110 transition-colors ${inputBg ? '' : 'bg-hover'}`}
        style={inputBg ? { background: inputBg } : undefined}
      >
        {icon}
        {current?.icon}
        <span className="flex-1 text-left truncate">{current?.label || value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-text-dim shrink-0"><path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {dropdownContent}
    </div>
  )
}
