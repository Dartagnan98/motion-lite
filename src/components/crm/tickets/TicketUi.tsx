import type { CrmTicketPriority, CrmTicketRecord, CrmTicketStatus } from '@/lib/db'

const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' } as const

type Tone = 'neutral' | 'good' | 'warn' | 'accent'

function badgeColors(tone: Tone) {
  if (tone === 'good') {
    return {
      background: 'color-mix(in oklab, var(--status-completed) 14%, var(--bg-elevated))',
      border: 'color-mix(in oklab, var(--status-completed) 24%, var(--border))',
      color: 'var(--status-completed)',
    }
  }
  if (tone === 'warn') {
    return {
      background: 'color-mix(in oklab, var(--status-overdue) 13%, var(--bg-elevated))',
      border: 'color-mix(in oklab, var(--status-overdue) 26%, var(--border))',
      color: 'var(--status-overdue)',
    }
  }
  if (tone === 'accent') {
    return {
      background: 'color-mix(in oklab, var(--accent) 10%, var(--bg-elevated))',
      border: 'color-mix(in oklab, var(--accent) 22%, var(--border))',
      color: 'var(--accent-text)',
    }
  }
  return {
    background: 'var(--bg-elevated)',
    border: 'var(--border)',
    color: 'var(--text-dim)',
  }
}

export function formatTicketTimestamp(value: string | null, includeTime = true): string {
  if (!value) return 'None'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', includeTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' })
}

function formatDuration(ms: number): string {
  const abs = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(abs / 86400)
  const hours = Math.floor((abs % 86400) / 3600)
  const minutes = Math.floor((abs % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${Math.max(1, minutes)}m`
}

function humanizeStatus(status: CrmTicketStatus): string {
  return status === 'on_hold' ? 'On hold' : status.charAt(0).toUpperCase() + status.slice(1)
}

function humanizePriority(priority: CrmTicketPriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1)
}

export function parseTicketTags(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function TicketBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const colors = badgeColors(tone)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 8px',
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        fontSize: 10,
        lineHeight: 1,
        ...mono,
      }}
    >
      {label}
    </span>
  )
}

export function TicketStatusBadge({ status }: { status: CrmTicketStatus }) {
  const tone: Tone = status === 'solved' || status === 'closed'
    ? 'good'
    : status === 'on_hold'
      ? 'warn'
      : status === 'pending'
        ? 'accent'
        : 'neutral'
  return <TicketBadge label={humanizeStatus(status)} tone={tone} />
}

export function TicketPriorityBadge({ priority }: { priority: CrmTicketPriority }) {
  const tone: Tone = priority === 'urgent' ? 'warn' : priority === 'high' ? 'accent' : 'neutral'
  return <TicketBadge label={humanizePriority(priority)} tone={tone} />
}

export function describeTicketSla(ticket: Pick<CrmTicketRecord, 'sla_due_at' | 'sla_state' | 'sla_phase' | 'status'>): { label: string; tone: Tone } {
  if (ticket.status === 'solved' || ticket.status === 'closed' || ticket.sla_state === 'completed') {
    return { label: 'Resolved', tone: 'good' }
  }
  if (!ticket.sla_due_at || ticket.sla_phase === 'none' || ticket.sla_state === 'none') {
    return { label: 'No SLA', tone: 'neutral' }
  }
  const dueMs = new Date(ticket.sla_due_at).getTime() - Date.now()
  if (dueMs <= 0 || ticket.sla_state === 'overdue') {
    return { label: `Overdue ${formatDuration(Math.abs(dueMs))}`, tone: 'warn' }
  }
  return {
    label: `${ticket.sla_phase === 'first_response' ? 'Reply' : 'Resolve'} in ${formatDuration(dueMs)}`,
    tone: ticket.sla_phase === 'first_response' ? 'accent' : 'neutral',
  }
}

export function TicketSlaBadge({ ticket }: { ticket: Pick<CrmTicketRecord, 'sla_due_at' | 'sla_state' | 'sla_phase' | 'status'> }) {
  const status = describeTicketSla(ticket)
  return <TicketBadge label={status.label} tone={status.tone} />
}

export function TicketStatTile({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: Tone }) {
  const accent = tone === 'warn' ? 'var(--status-overdue)' : tone === 'good' ? 'var(--status-completed)' : tone === 'accent' ? 'var(--accent-text)' : 'var(--text)'
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--text-dim)', ...mono }}>{label}</span>
      <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em', color: accent }}>{value}</span>
    </div>
  )
}

export function TicketEmptyIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
      <rect x="7" y="10" width="30" height="24" rx="5" stroke="var(--text-dim)" strokeWidth="1.4" opacity="0.45" />
      <path d="M14 18h16M14 23h10M14 28h7" stroke="var(--text-dim)" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      <circle cx="32" cy="15" r="4" fill="color-mix(in oklab, var(--accent) 20%, transparent)" stroke="var(--accent)" strokeWidth="1.2" />
    </svg>
  )
}
