'use client'

interface AutoScheduleToggleProps {
  active: boolean
  onChange: () => void
  label?: string
  size?: 'sm' | 'md'
  /** When active, show scheduled date/time in a purple banner */
  scheduledDate?: string | null
  /** Display mode: 'inline' = just toggle+label, 'banner' = full-width purple bar when active */
  variant?: 'inline' | 'banner'
  /** Toggle only, no text at all */
  compact?: boolean
}

function formatScheduledDate(iso: string, includeTime = false): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (!includeTime) return day
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day} at ${time}`
}

export function AutoScheduleToggle({ active, onChange, label, size = 'md', scheduledDate, variant = 'inline', compact }: AutoScheduleToggleProps) {
  const w = size === 'sm' ? 'w-[17px]' : 'w-[25px]'
  const h = size === 'sm' ? 'h-[13px]' : 'h-[17px]'
  const knobSize = size === 'sm' ? 'w-[11px] h-[11px]' : 'w-[15px] h-[15px]'
  const sparkleSize = size === 'sm' ? 8 : 10

  const toggle = (
    <button
      type="button"
      onClick={onChange}
      className={`${w} ${h} rounded-full transition-colors shrink-0 border-none cursor-pointer flex items-center ${active ? 'justify-end' : 'justify-start'}`}
      style={{ background: active ? 'var(--accent)' : 'var(--border-strong)' }}
    >
      <span
        className={`${knobSize} rounded-full flex items-center justify-center mx-px`}
        style={{
          background: active
            ? 'color-mix(in oklab, var(--accent) 55%, #1a1b1a)'
            : 'var(--text-muted)',
        }}
      >
        <svg width={sparkleSize} height={sparkleSize} viewBox="0 0 16 16" fill="none">
          <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" fill="white" />
        </svg>
      </span>
    </button>
  )

  // Banner variant: sage bar when active, grey when off
  if (variant === 'banner') {
    if (active && scheduledDate) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: 'rgba(241,237,229,0.12)', border: '1px solid rgba(241,237,229,0.22)' }}>
          {toggle}
          <span className="text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
            {formatScheduledDate(scheduledDate, true)}
          </span>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: 'var(--bg-elevated)' }}>
        {toggle}
        <span className="text-[13px] text-text-dim">Not auto-scheduled</span>
      </div>
    )
  }

  // Inline variant: date when scheduled, "None" when off
  const displayLabel = compact ? null
    : active && scheduledDate ? formatScheduledDate(scheduledDate)
    : label || 'None'

  return (
    <label className="flex items-center gap-1.5 text-[13px] cursor-pointer" style={{ color: active ? 'var(--accent)' : 'var(--text-dim)' }}>
      {toggle}
      {displayLabel && <span>{displayLabel}</span>}
    </label>
  )
}
