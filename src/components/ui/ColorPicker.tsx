'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { APP_COLORS } from '@/lib/colors'
import { IconX } from '@/components/ui/Icons'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

export function ColorPicker({
  currentColor,
  onSelect,
  onClose,
  onClear,
  anchorRef,
}: {
  currentColor?: string | null
  onSelect: (color: string) => void
  onClose: () => void
  onClear?: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}) {
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const colorInstanceId = useRef(Math.random().toString(36).slice(2))

  // Close when another picker/popover opens
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('popover-open', { detail: colorInstanceId.current }))
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== colorInstanceId.current) onClose()
    }
    window.addEventListener('popover-open', handler)
    return () => window.removeEventListener('popover-open', handler)
  }, [onClose])

  const updatePos = useCallback(() => {
    if (!anchorRef?.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const dropdownHeight = 340
    const dropdownWidth = 200
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow < dropdownHeight + 8
      ? rect.top - dropdownHeight - 4
      : rect.bottom + 4
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8))
    setPos({ top, left })
  }, [anchorRef])

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
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const filtered = filter
    ? APP_COLORS.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
    : APP_COLORS

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        {...popupSurfaceDataProps}
        ref={ref}
        className={withPopupSurfaceClassName('w-[200px] overflow-hidden animate-glass-in')}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: 'var(--dropdown-bg)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--glass-shadow-lg)',
        }}
        onMouseDown={stopPopupMouseDown}
      >
        {/* Current color header */}
        {currentColor && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <span className="w-4 h-4 rounded-[3px] shrink-0" style={{ background: currentColor }} />
            <span className="text-[13px] text-text font-medium">
              {APP_COLORS.find(c => c.value === currentColor)?.name || 'Custom'}
            </span>
          </div>
        )}

        {/* Filter input */}
        <div className="px-2 pt-2 pb-1">
          <input
            ref={inputRef}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full bg-hover border border-border rounded-md px-2.5 py-1.5 text-[12px] text-text outline-none placeholder:text-text-dim"
          />
        </div>

        {/* Color list */}
        <div className="max-h-[280px] overflow-y-auto py-1">
          {onClear && !filter && (
            <button
              onClick={() => { onClear(); onClose() }}
              className="flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              <span className="w-4 h-4 rounded-[3px] shrink-0 border border-border bg-transparent flex items-center justify-center">
                <IconX size={8} strokeWidth={1.2} />
              </span>
              <span className="flex-1 text-left text-text-dim">None</span>
            </button>
          )}
          {filtered.map(c => (
            <button
              key={c.value}
              onClick={() => { onSelect(c.value); onClose() }}
              className="flex items-center gap-2.5 w-full px-2.5 py-1.5 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              <span className="w-4 h-4 rounded-[3px] shrink-0" style={{ background: c.value }} />
              <span className="flex-1 text-left">{c.name}</span>
              {currentColor === c.value && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <path d="M3 7l3 3 5-5.5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-text-dim">No colors match</div>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
