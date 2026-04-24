'use client'

// ── Motion priority icons ───────────────────────────────────────────
// Imports config from task-constants.ts (single source of truth).
// Use PriorityIcon everywhere a priority indicator is shown.
// Use PRIORITY_OPTIONS for dropdowns.

import { PRIORITY_CONFIG, PRIORITY_OPTIONS, PRIORITY_COLORS } from '@/lib/task-constants'
export { PRIORITY_CONFIG, PRIORITY_OPTIONS, PRIORITY_COLORS }

export function priorityColor(priority: string): string {
  return PRIORITY_CONFIG[priority]?.color || '#6b7280'
}

export function priorityLabel(priority: string): string {
  return PRIORITY_CONFIG[priority]?.label || priority
}

// Motion SVG icons -- solid filled flags, each with a distinct shape
export function PriorityIcon({ priority, size = 14 }: { priority: string; size?: number }) {
  const color = priorityColor(priority)

  switch (priority) {
    case 'urgent':
      // ASAP: rounded square with exclamation mark
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path fill={color} fillRule="evenodd" d="M4.4 2A2.4 2.4 0 0 0 2 4.4v7.2A2.4 2.4 0 0 0 4.4 14h7.2a2.4 2.4 0 0 0 2.4-2.4V4.4A2.4 2.4 0 0 0 11.6 2H4.4ZM8 4.35a.73.73 0 0 1 .73.73v2.916a.73.73 0 1 1-1.46 0V5.079A.73.73 0 0 1 8 4.35Zm0 7.146a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75Z" clipRule="evenodd" />
        </svg>
      )
    case 'high':
      // Solid flag on pole
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3.167 3.833v9" />
          <path fill={color} d="M12.833 10.167V3.833s-.5.334-2.166.334C9 4.167 8 3.167 6 3.167s-2.833.666-2.833.666v6.334S4.333 9.5 6 9.5c1.667 0 3 1.333 4.667 1.333 1.666 0 2.166-.666 2.166-.666Z" />
        </svg>
      )
    case 'medium':
      // Angled flag / half-mast
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path fill={color} fillRule="evenodd" d="M12.267 3.03a.75.75 0 0 1 1.003 1.082l-2.005 2.721 2.005 2.722a.75.75 0 0 1-.003.895l-.6-.45.599.45v.002l-.002.002-.003.004-.007.009a2.169 2.169 0 0 1-.063.072 1.725 1.725 0 0 1-.14.135 2.48 2.48 0 0 1-.507.33c-.45.225-1.108.413-2.044.413-.994 0-1.87-.39-2.585-.708l-.053-.024c-.776-.344-1.38-.602-2.029-.602a5.751 5.751 0 0 0-2.083.397v2.187a.75.75 0 1 1-1.5 0v-9a.746.746 0 0 1 .281-.586h.001V3.08l.002-.001.003-.003.008-.005.018-.014c.015-.011.032-.024.054-.038.043-.03.1-.066.172-.108.146-.083.35-.184.621-.283.543-.197 1.338-.378 2.423-.378 1.136 0 1.987.288 2.708.543l.061.021c.7.248 1.234.436 1.898.436.784 0 1.264-.079 1.526-.144a1.63 1.63 0 0 0 .241-.077Z" clipRule="evenodd" />
        </svg>
      )
    case 'low':
      // Drooping flag
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path fill={color} fillRule="evenodd" d="M3.917 10.552v2.281a.75.75 0 0 1-1.5 0V3.167a.75.75 0 0 1 1.021-.7l9.65 3.495a.75.75 0 0 1 .362 1.132l-.617-.427.617.427-.002.003-.003.003-.007.01a1.54 1.54 0 0 1-.09.12c-.06.073-.145.174-.257.291a6.246 6.246 0 0 1-1 .848C11.192 8.983 9.84 9.583 8 9.583c-1.564 0-2.673.313-3.376.608a5.038 5.038 0 0 0-.707.361Z" clipRule="evenodd" />
        </svg>
      )
    default:
      return null
  }
}

// Render a priority option for Dropdown renderOption
export function renderPriorityOption(opt: { value: string; label: string }, isSelected: boolean) {
  return (
    <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${isSelected ? 'bg-[rgba(255,255,255,0.08)]' : 'hover:bg-[rgba(255,255,255,0.06)]'}`} style={{ borderRadius: 'var(--radius-sm)' }}>
      <PriorityIcon priority={opt.value} size={14} />
      <span className="flex-1 text-text truncate">{opt.label}</span>
      {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 text-blue"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </div>
  )
}
