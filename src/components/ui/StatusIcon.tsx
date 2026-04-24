import type { ReactNode } from 'react'

export const statusConfig: Record<string, { color: string; label: string; icon: 'empty' | 'half' | 'check' | 'x' | 'blocked' | 'dim' }> = {
  backlog: { color: '#6b7280', label: 'Backlog', icon: 'dim' },
  blocked: { color: '#ef5350', label: 'Blocked', icon: 'blocked' },
  cancelled: { color: '#ef5350', label: 'Cancelled', icon: 'x' },
  done: { color: '#00e676', label: 'Completed', icon: 'check' },
  in_progress: { color: '#ff9100', label: 'In Progress', icon: 'half' },
  review: { color: '#b388ff', label: 'Review', icon: 'half' },
  todo: { color: '#9ca3af', label: 'Todo', icon: 'empty' },
  archived: { color: '#6b7280', label: 'Archived', icon: 'x' },
  // Project statuses (same visual as task equivalents)
  open: { color: '#9ca3af', label: 'Open', icon: 'empty' },
  closed: { color: '#00e676', label: 'Closed', icon: 'check' },
  completed: { color: '#00e676', label: 'Completed', icon: 'check' },
}

export function StatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  const cfg = statusConfig[status] || statusConfig.todo
  const r = size / 2 - 1
  const cx = size / 2
  const cy = size / 2

  if (cfg.icon === 'check') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={cx} cy={cy} r={r} fill={cfg.color} />
        <path d={`M${size * 0.3} ${cy}l${size * 0.13} ${size * 0.13}L${size * 0.7} ${size * 0.35}`} stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (cfg.icon === 'x') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={cx} cy={cy} r={r} fill={cfg.color} />
        <path d={`M${size * 0.35} ${size * 0.35}l${size * 0.3} ${size * 0.3}M${size * 0.65} ${size * 0.35}l-${size * 0.3} ${size * 0.3}`} stroke="white" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (cfg.icon === 'blocked') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={cx} cy={cy} r={r} stroke={cfg.color} strokeWidth="1.5" />
      </svg>
    )
  }
  if (cfg.icon === 'half') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={cx} cy={cy} r={r} stroke={cfg.color} strokeWidth="1.5" />
        <path d={`M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}`} fill={cfg.color} />
      </svg>
    )
  }
  if (cfg.icon === 'dim') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={cx} cy={cy} r={r} stroke={cfg.color} strokeWidth="1.3" strokeDasharray="2 2" />
      </svg>
    )
  }
  // empty (todo)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={cx} cy={cy} r={r} stroke={cfg.color} strokeWidth="1.5" />
    </svg>
  )
}

/** Render a status option row for Dropdown renderOption */
export function renderStatusOption(option: { value: string; label: string }, isSelected: boolean): ReactNode {
  return (
    <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${isSelected ? 'bg-[rgba(255,255,255,0.08)]' : 'hover:bg-[rgba(255,255,255,0.06)]'}`} style={{ borderRadius: 'var(--radius-sm)' }}>
      <StatusIcon status={option.value} size={14} />
      <span className="flex-1 text-text truncate">{option.label}</span>
      {isSelected && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 text-blue">
          <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}

/** Render a status trigger showing the icon + label */
export function StatusTrigger({ status, className }: { status: string; className?: string }) {
  const cfg = statusConfig[status] || statusConfig.todo
  return (
    <button type="button" className={className || 'flex items-center gap-1.5 px-1 py-0.5 rounded-sm text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] cursor-pointer transition-colors'}>
      <StatusIcon status={status} size={14} />
      {cfg.label}
    </button>
  )
}
