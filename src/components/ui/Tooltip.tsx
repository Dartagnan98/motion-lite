'use client'

import { useState, useRef, useCallback } from 'react'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

export function Tooltip({ content, children, side = 'top', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const gap = 6
      let x = 0, y = 0
      switch (side) {
        case 'top':    x = rect.left + rect.width / 2; y = rect.top - gap; break
        case 'bottom': x = rect.left + rect.width / 2; y = rect.bottom + gap; break
        case 'left':   x = rect.left - gap; y = rect.top + rect.height / 2; break
        case 'right':  x = rect.right + gap; y = rect.top + rect.height / 2; break
      }
      setPos({ x, y })
      setVisible(true)
    }, delay)
  }, [delay, side])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  const transformOrigin: Record<string, string> = {
    top: 'center bottom',
    bottom: 'center top',
    left: 'right center',
    right: 'left center',
  }

  const transform: Record<string, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  }

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: 'contents' }}
      >
        {children}
      </div>
      {visible && (
        <div
          className="animate-glass-in"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: transform[side],
            transformOrigin: transformOrigin[side],
            zIndex: 'var(--z-tooltip)' as unknown as number,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '4px 8px',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            boxShadow: 'var(--glass-shadow)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: 260,
          }}
        >
          {content}
        </div>
      )}
    </>
  )
}
