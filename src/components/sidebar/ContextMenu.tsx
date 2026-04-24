'use client'

import { useEffect, useRef } from 'react'
import { APP_COLORS } from '@/lib/colors'

interface MenuItem {
  icon: string
  label: string
  action: string
  danger?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onAction,
  onClose,
  currentColor,
  onColorChange,
  showColors,
}: {
  x: number
  y: number
  items: MenuItem[]
  onAction: (action: string) => void
  onClose: () => void
  currentColor?: string
  onColorChange?: (color: string) => void
  showColors?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Keep menu in viewport
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    if (rect.bottom > window.innerHeight) {
      ref.current.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`
    }
    if (rect.right > window.innerWidth) {
      ref.current.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`
    }
  }, [])

  const icons: Record<string, React.ReactNode> = {
    folder: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
    project: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
    doc: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
    rename: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M11 2l3 3-9 9H2v-3l9-9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
    delete: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5M4 4l1 9a1 1 0 001 1h4a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    moveUp: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    moveDown: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M8 13V3M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    copy: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
    color: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="3" fill="currentColor" />
      </svg>
    ),
    duplicate: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
    archive: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12v2H2zM3 6v7a1 1 0 001 1h8a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M6.5 9h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
    database: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    ),
  }

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[200px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl py-1"
      style={{ left: x, top: y }}
    >
      {/* Color picker list */}
      {showColors && onColorChange && (
        <div className="border-b border-border">
          <div className="max-h-[240px] overflow-y-auto py-1">
            {APP_COLORS.map(c => (
              <button
                key={c.value}
                onClick={() => onColorChange(c.value)}
                className="flex items-center gap-2.5 w-full px-3 py-1.5 text-[14px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
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
          </div>
        </div>
      )}

      {/* Action items */}
      {items.map((item) => (
        <button
          key={item.action}
          onClick={() => onAction(item.action)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-[14px] transition-colors ${
            item.danger
              ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
              : 'text-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-text'
          }`}
        >
          <span className={item.danger ? '' : 'text-text-dim'}>{icons[item.icon] || null}</span>
          {item.label}
        </button>
      ))}
    </div>
  )
}
