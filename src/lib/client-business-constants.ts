// Shared constants for the Clients + Businesses pages.
// Moved out of per-page files so status color + avatar palette stay in sync.

// User-chosen avatar palette. Kept as literal hexes — these are surfaced
// through a color picker and saved to each row, so values must be stable
// across theme changes (light vs dark). Tokens are NOT appropriate here.
export const AVATAR_COLORS = [
  '#7a6b55', '#2563eb', '#7c3aed', '#dc2626', '#ea580c',
  '#ca8a04', '#16a34a', '#0891b2', '#6366f1', '#db2777',
]

// Status palette references the three app-wide status tokens.
// Colors resolve at render time so theme swaps stay instant.
export interface StatusOption {
  value: string
  label: string
  color: string                 // CSS var reference
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'active',     label: 'Active',     color: 'var(--status-completed)' },
  { value: 'onboarding', label: 'Onboarding', color: 'var(--status-active)' },
  { value: 'paused',     label: 'Paused',     color: 'var(--text-dim)' },
  { value: 'churned',    label: 'Churned',    color: 'var(--status-overdue)' },
]

export function statusColor(value: string | null | undefined): string {
  const found = STATUS_OPTIONS.find(o => o.value === value)
  return found ? found.color : 'var(--text-dim)'
}

export function statusLabel(value: string | null | undefined): string {
  const found = STATUS_OPTIONS.find(o => o.value === value)
  return found ? found.label : String(value ?? '')
}
