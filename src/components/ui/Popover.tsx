'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { isEventInsidePopupSurface, popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  className?: string
  matchWidth?: boolean
  minWidth?: number
  theme?: 'dark' | 'light'
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  className,
  matchWidth = false,
  minWidth = 120,
  theme,
}: PopoverProps) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, actualSide: side })

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const contentEl = contentRef.current
    const contentHeight = contentEl?.offsetHeight ?? 200
    const contentWidth = contentEl?.offsetWidth ?? Math.max(rect.width, minWidth)

    // Flip side if not enough space
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    let actualSide = side
    if (side === 'bottom' && spaceBelow < contentHeight + sideOffset && spaceAbove > spaceBelow) {
      actualSide = 'top'
    } else if (side === 'top' && spaceAbove < contentHeight + sideOffset && spaceBelow > spaceAbove) {
      actualSide = 'bottom'
    }

    // Vertical position
    const top = actualSide === 'bottom'
      ? rect.bottom + sideOffset
      : rect.top - contentHeight - sideOffset

    // Horizontal alignment
    let left: number
    if (align === 'start') {
      left = rect.left
    } else if (align === 'end') {
      left = rect.right - contentWidth
    } else {
      left = rect.left + (rect.width - contentWidth) / 2
    }

    // Keep in viewport horizontally
    left = Math.max(8, Math.min(left, window.innerWidth - contentWidth - 8))

    setPos({
      top: Math.max(8, top),
      left,
      width: matchWidth ? rect.width : Math.max(rect.width, minWidth),
      actualSide,
    })
  }, [side, align, sideOffset, matchWidth, minWidth])

  // Close when another Popover opens (global singleton behavior)
  const instanceId = useRef(Math.random().toString(36).slice(2))
  useEffect(() => {
    if (!open) return
    // Tell other popovers to close
    window.dispatchEvent(new CustomEvent('popover-open', { detail: instanceId.current }))
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== instanceId.current) onOpenChange(false)
    }
    window.addEventListener('popover-open', handler)
    return () => window.removeEventListener('popover-open', handler)
  }, [open, onOpenChange])

  // Position on open and track scroll/resize
  useEffect(() => {
    if (!open) return
    updatePosition()
    // Reposition after content renders
    requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // Close on outside click (but not on nested portal-rendered Dropdowns)
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (contentRef.current?.contains(e.target as Node)) return
      if (isEventInsidePopupSurface(e.target)) return
      onOpenChange(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open, onOpenChange])

  // Close on escape
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  return (
    <>
      <div ref={triggerRef} className="inline-flex">
        {trigger}
      </div>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          {...popupSurfaceDataProps}
          ref={contentRef}
          className={withPopupSurfaceClassName(`animate-glass-in ${className ?? ''}`)}
          data-theme={theme || undefined}
          onMouseDown={stopPopupMouseDown}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            minWidth: matchWidth ? pos.width : minWidth,
            width: matchWidth ? pos.width : 'auto',
            maxWidth: matchWidth ? pos.width : 320,
            zIndex: 9999,
            ...(theme === 'light' ? {
              background: '#ffffff',
              border: '1px solid rgba(0,0,0,0.12)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            } : {
              background: 'var(--dropdown-bg)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--glass-shadow-lg)',
            }),
          }}
        >
          {children}
        </div>,
        document.body
      )}
    </>
  )
}
