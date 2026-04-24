'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function formatDisplay(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

interface DatePickerProps {
  value: string // yyyy-mm-dd
  onChange: (value: string) => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  autoFocus?: boolean
  className?: string
  placeholder?: string
  size?: 'sm' | 'md'
}

export default function DatePicker({ value, onChange, onBlur, onKeyDown, autoFocus, className = '', placeholder = 'Pick a date', size = 'md' }: DatePickerProps) {
  const [open, setOpen] = useState(autoFocus || false)
  const today = new Date()
  const parsed = value ? new Date(value + 'T00:00:00') : null
  const [viewYear, setViewYear] = useState(parsed ? parsed.getFullYear() : today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed ? parsed.getMonth() : today.getMonth())
  const triggerRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, direction: 'down' as 'down' | 'up' })

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const calendarHeight = 340
    const spaceBelow = window.innerHeight - rect.bottom
    const direction = spaceBelow < calendarHeight + 8 ? 'up' : 'down'
    setPos({
      top: direction === 'down' ? rect.bottom + 4 : rect.top - calendarHeight - 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)),
      direction,
    })
  }, [])

  // Close when another picker/popover opens
  const instanceId = useRef(Math.random().toString(36).slice(2))
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('popover-open', { detail: instanceId.current }))
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== instanceId.current) { setOpen(false); onBlur?.() }
    }
    window.addEventListener('popover-open', handler)
    return () => window.removeEventListener('popover-open', handler)
  }, [open, onBlur])

  useEffect(() => {
    if (!open) return
    updatePosition()
    requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (calendarRef.current?.contains(e.target as Node)) return
      setOpen(false)
      onBlur?.()
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); onBlur?.() }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onBlur])

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth)
  const prevMonthDays = getDaysInMonth(viewYear, viewMonth - 1 < 0 ? 11 : viewMonth - 1)

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  function selectDate(day: number) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(dateStr)
    setOpen(false)
    onBlur?.()
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function goToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
  }

  function clearDate() {
    onChange('')
    setOpen(false)
    onBlur?.()
  }

  const textSize = size === 'sm' ? 'text-[12px]' : 'text-[14px]'

  return (
    <div ref={triggerRef} className={`${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        className={`flex items-center gap-1.5 w-full ${textSize} text-text px-2 py-1.5 rounded-md hover:bg-hover transition-colors text-left`}
        onClick={() => setOpen(!open)}
        onKeyDown={onKeyDown}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-dim/60 shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className={value ? 'text-text' : 'text-text-dim/40'}>{value ? formatDisplay(value) : placeholder}</span>
      </button>

      {/* Dropdown calendar (portal) */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          {...popupSurfaceDataProps}
          ref={calendarRef}
          className={withPopupSurfaceClassName('animate-glass-in rounded-xl py-3 px-3 min-w-[260px]')}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 9999,
            background: 'var(--dropdown-bg)',
            border: '1px solid var(--border-strong)',
            boxShadow: 'var(--glass-shadow-lg)',
          }}
          onMouseDown={stopPopupMouseDown}
        >
          {/* Month/Year header */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text">{MONTHS[viewMonth]} {viewYear}</span>
            <div className="flex items-center gap-0.5">
              <button onClick={prevMonth} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <button onClick={goToday} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text transition-colors" title="Today">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="3" /></svg>
              </button>
              <button onClick={nextMonth} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-0 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[11px] text-text-dim/50 font-medium py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0">
            {/* Previous month trailing days */}
            {Array.from({ length: firstDay }, (_, i) => {
              const day = prevMonthDays - firstDay + 1 + i
              return (
                <button key={`prev-${i}`} className="text-center text-[12px] text-text-dim/25 py-1.5 rounded hover:bg-hover transition-colors" onClick={() => { prevMonth(); setTimeout(() => selectDate(day), 0) }}>
                  {day}
                </button>
              )
            })}
            {/* Current month days */}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isSelected = dateStr === value
              const isToday = dateStr === todayStr
              return (
                <button
                  key={day}
                  onClick={() => selectDate(day)}
                  className={`text-center text-[12px] py-1.5 rounded transition-colors ${
                    isSelected
                      ? 'bg-accent text-white font-semibold'
                      : isToday
                        ? 'bg-accent/20 text-accent-text font-medium hover:bg-accent/30'
                        : 'text-text hover:bg-white/8'
                  }`}
                >
                  {day}
                </button>
              )
            })}
            {/* Next month leading days */}
            {(() => {
              const totalCells = firstDay + daysInMonth
              const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)
              return Array.from({ length: remaining }, (_, i) => (
                <button key={`next-${i}`} className="text-center text-[12px] text-text-dim/25 py-1.5 rounded hover:bg-hover transition-colors" onClick={() => { nextMonth(); setTimeout(() => selectDate(i + 1), 0) }}>
                  {i + 1}
                </button>
              ))
            })()}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button onClick={goToday} className="text-[11px] text-accent-text hover:text-accent-text/80 transition-colors">Today</button>
            {value && <button onClick={clearDate} className="text-[11px] text-red-400 hover:text-red-300 transition-colors">Clear</button>}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// Inline version for use inside table cells (no trigger button, just the calendar dropdown)
export function InlineDatePicker({ value, onChange, onClose, anchorRef }: { value: string; onChange: (v: string) => void; onClose: () => void; anchorRef?: React.RefObject<HTMLElement | null> }) {
  const today = new Date()
  const parsed = value ? new Date(value + 'T00:00:00') : null
  const [viewYear, setViewYear] = useState(parsed ? parsed.getFullYear() : today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed ? parsed.getMonth() : today.getMonth())
  const ref = useRef<HTMLDivElement>(null)
  const inlineAnchorRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const effectiveAnchor = anchorRef || inlineAnchorRef

  const updatePos = useCallback(() => {
    if (!effectiveAnchor?.current) return
    const rect = effectiveAnchor.current.getBoundingClientRect()
    const calendarHeight = 340
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow < calendarHeight + 8
      ? rect.top - calendarHeight - 4
      : rect.bottom + 4
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280))
    setPos({ top, left })
  }, [effectiveAnchor])

  useEffect(() => {
    updatePos()
    requestAnimationFrame(updatePos)
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [updatePos])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth)
  const prevMonthDays = getDaysInMonth(viewYear, viewMonth - 1 < 0 ? 11 : viewMonth - 1)
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  function selectDate(day: number) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(dateStr)
    onClose()
  }

  function prevM() { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1) }
  function nextM() { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1) }

  if (typeof document === 'undefined') return null

  const portal = createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        {...popupSurfaceDataProps}
        ref={ref}
        className={withPopupSurfaceClassName('rounded-xl py-3 px-3 min-w-[260px] animate-glass-in')}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: 'var(--dropdown-bg)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--glass-shadow-lg)',
        }}
        onMouseDown={stopPopupMouseDown}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold text-text">{MONTHS[viewMonth]} {viewYear}</span>
          <div className="flex items-center gap-0.5">
            <button onClick={prevM} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button onClick={nextM} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0 mb-1">
          {DAYS.map(d => <div key={d} className="text-center text-[11px] text-text-dim/50 font-medium py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0">
          {Array.from({ length: firstDay }, (_, i) => (
            <div key={`p-${i}`} className="text-center text-[12px] text-text-dim/25 py-1.5">{prevMonthDays - firstDay + 1 + i}</div>
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isSelected = dateStr === value
            const isToday = dateStr === todayStr
            return (
              <button key={day} onClick={() => selectDate(day)} className={`text-center text-[12px] py-1.5 rounded transition-colors ${isSelected ? 'bg-accent text-white font-semibold' : isToday ? 'bg-accent/20 text-accent-text font-medium hover:bg-accent/30' : 'text-text hover:bg-white/8'}`}>
                {day}
              </button>
            )
          })}
          {(() => {
            const totalCells = firstDay + daysInMonth
            const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)
            return Array.from({ length: remaining }, (_, i) => (
              <div key={`n-${i}`} className="text-center text-[12px] text-text-dim/25 py-1.5">{i + 1}</div>
            ))
          })()}
        </div>
        <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()) }} className="text-[11px] text-accent-text hover:text-accent-text/80">Today</button>
          {value && <button onClick={() => { onChange(''); onClose() }} className="text-[11px] text-red-400 hover:text-red-300">Clear</button>}
        </div>
      </div>
    </>,
    document.body
  )

  if (anchorRef) return portal

  return (
    <>
      <span ref={inlineAnchorRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      {portal}
    </>
  )
}
