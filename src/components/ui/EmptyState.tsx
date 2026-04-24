'use client'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

const defaultIcon = (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <rect x="4" y="8" width="32" height="24" rx="3" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
    <path d="M16 20h8M20 16v8" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
  </svg>
)

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
      textAlign: 'center',
      gap: 12,
    }}>
      <div style={{ opacity: 0.7, marginBottom: 4 }}>
        {icon || defaultIcon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', maxWidth: 280, lineHeight: 1.5 }}>
          {description}
        </div>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8,
            padding: '7px 16px',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: '1px solid transparent',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
