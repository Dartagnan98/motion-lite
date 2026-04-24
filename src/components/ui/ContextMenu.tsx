'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  divider?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  x: number
  y: number
  onClose: () => void
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x, y })

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  // Keep in viewport
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const nx = rect.right > window.innerWidth ? Math.max(4, window.innerWidth - rect.width - 4) : x
    const ny = rect.bottom > window.innerHeight ? Math.max(4, window.innerHeight - rect.height - 4) : y
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny })
  }, [x, y])

  // Close on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      {...popupSurfaceDataProps}
      ref={ref}
      className={withPopupSurfaceClassName('fixed z-[9999] min-w-[180px] rounded-lg border border-border glass-elevated animate-glass-in shadow-2xl py-1 transition-opacity duration-100 select-none')}
      onMouseDown={stopPopupMouseDown}
      style={{
        left: pos.x,
        top: pos.y,
        opacity: visible ? 1 : 0,
      }}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={`div-${i}`} className="border-t border-border my-1" />
        }
        return (
          <button
            key={`${item.label}-${i}`}
            onClick={() => { item.onClick(); onClose() }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-[14px] transition-colors ${
              item.danger
                ? 'text-[var(--red)] hover:bg-[var(--red)]/10'
                : 'text-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-text'
            }`}
          >
            {item.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
