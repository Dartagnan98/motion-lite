'use client'

import { CSSProperties, HTMLAttributes, ReactNode } from 'react'

type CardSurface = 'surface' | 'panel' | 'elevated'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  surface?: CardSurface
  padding?: number | string
  radius?: number
  interactive?: boolean
  children?: ReactNode
}

const surfaceTokens: Record<CardSurface, { bg: string; border: string; shadow: string }> = {
  surface: {
    bg: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  panel: {
    bg: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  elevated: {
    bg: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong, var(--border))',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px -12px rgba(0,0,0,0.35)',
  },
}

export function Card({
  surface = 'surface',
  padding = 20,
  radius = 12,
  interactive = false,
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: CardProps) {
  const tokens = surfaceTokens[surface]

  const base: CSSProperties = {
    background: tokens.bg,
    border: tokens.border,
    boxShadow: tokens.shadow,
    borderRadius: radius,
    padding,
    transition: interactive ? 'border-color 0.15s ease, background 0.15s ease' : undefined,
    cursor: interactive ? 'pointer' : undefined,
  }

  return (
    <div
      style={{ ...base, ...style }}
      onMouseEnter={e => {
        if (interactive) {
          e.currentTarget.style.borderColor = 'var(--accent)'
        }
        onMouseEnter?.(e)
      }}
      onMouseLeave={e => {
        if (interactive) {
          e.currentTarget.style.borderColor = 'var(--border)'
        }
        onMouseLeave?.(e)
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: string
  subtitle?: string
  right?: ReactNode
  mono?: boolean
}

export function CardHeader({ title, subtitle, right, mono = false }: CardHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: mono ? 11 : 13,
            fontWeight: mono ? 700 : 600,
            color: 'var(--text)',
            fontFamily: mono ? 'var(--font-mono)' : undefined,
            textTransform: mono ? 'uppercase' : undefined,
            letterSpacing: mono ? '0.08em' : '-0.01em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  )
}
