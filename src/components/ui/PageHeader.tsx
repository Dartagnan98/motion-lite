'use client'

import { ReactNode } from 'react'

interface PageHeaderAction {
  label: string
  onClick: () => void
  icon?: ReactNode
  variant?: 'primary' | 'secondary'
}

interface PageHeaderTab {
  id: string
  label: string
  count?: number
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  count?: number | string
  action?: PageHeaderAction
  secondaryAction?: PageHeaderAction
  tabs?: PageHeaderTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  rightSlot?: ReactNode
  leftSlot?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  subtitle,
  count,
  action,
  secondaryAction,
  tabs,
  activeTab,
  onTabChange,
  rightSlot,
  leftSlot,
  className = '',
}: PageHeaderProps) {
  return (
    <header
      className={`page-header ${className}`.trim()}
      style={{
        padding: tabs ? '20px 24px 0' : '20px 24px 18px',
        borderBottom: tabs ? undefined : '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap', flex: '1 1 280px' }}>
          {leftSlot}
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
              margin: 0,
              whiteSpace: 'normal',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </h1>
          {count !== undefined && count !== null && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                padding: '2px 8px',
                borderRadius: 20,
                background: 'var(--bg-elevated)',
                color: 'var(--text-dim)',
                letterSpacing: '0.02em',
              }}
            >
              {count}
            </span>
          )}
          {subtitle && (
            <span style={{ fontSize: 13, color: 'var(--text-dim)', marginLeft: 4 }}>
              {subtitle}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {rightSlot}
          {secondaryAction && <ActionButton {...secondaryAction} variant={secondaryAction.variant || 'secondary'} />}
          {action && <ActionButton {...action} variant={action.variant || 'primary'} />}
        </div>
      </div>

      {tabs && tabs.length > 0 && (
        <div style={{ display: 'flex', gap: 2, marginTop: 16, borderBottom: '1px solid var(--border)' }}>
          {tabs.map(tab => {
            const isActive = tab.id === activeTab
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                style={{
                  position: 'relative',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 500,
                  color: isActive ? 'var(--text)' : 'var(--text-dim)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-dim)' }}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-dim)',
                      opacity: isActive ? 1 : 0.6,
                    }}
                  >
                    {tab.count}
                  </span>
                )}
                {isActive && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 8,
                      right: 8,
                      bottom: -1,
                      height: 2,
                      background: 'var(--accent)',
                      borderRadius: 2,
                    }}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </header>
  )
}

function ActionButton({ label, onClick, icon, variant = 'primary' }: PageHeaderAction) {
  const primary = variant === 'primary'
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        borderRadius: 8,
        border: primary ? '1px solid transparent' : '1px solid var(--border)',
        background: primary ? 'var(--accent)' : 'var(--bg-elevated)',
        color: primary ? 'var(--accent-fg)' : 'var(--text-secondary)',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        if (primary) {
          e.currentTarget.style.background = 'var(--accent-hover)'
        } else {
          e.currentTarget.style.borderColor = 'var(--accent)'
          e.currentTarget.style.color = 'var(--accent-text)'
        }
      }}
      onMouseLeave={e => {
        if (primary) {
          e.currentTarget.style.background = 'var(--accent)'
        } else {
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }
      }}
    >
      {icon}
      {label}
    </button>
  )
}
