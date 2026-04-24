/**
 * Dropdown Style Guide - Single Source of Truth
 *
 * ALL dropdowns, pickers, and popovers in the app must follow these specs.
 * This ensures consistent look and feel across every view.
 *
 * GOLDEN RULES:
 * 1. Every dropdown MUST use portal positioning (createPortal to document.body)
 * 2. Never use `position: absolute` for dropdown panels
 * 3. All dropdown containers use the same background, border, shadow, radius
 * 4. Option rows, search inputs, and triggers follow standard sizes below
 */

// ── Container (the floating dropdown panel) ─────────────────────────

export const DROPDOWN_CONTAINER = {
  /** Fixed position, rendered via createPortal to document.body */
  position: 'fixed' as const,
  zIndex: 9999,
  /** Dark mode container */
  background: 'var(--dropdown-bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-lg)', // 8px
  boxShadow: 'var(--glass-shadow-lg)',
  /** Max height for scrollable options list */
  maxHeight: 280,
  /** Animation class: animate-glass-in (0.18s ease-out fade + translateY) */
}

/** Tailwind classes for the dropdown container */
export const DROPDOWN_CONTAINER_CLASS = 'animate-glass-in overflow-hidden'

// ── Option Rows ─────────────────────────────────────────────────────

/** Standard option row: padding, text, gap, hover state */
export const OPTION = {
  /** Horizontal padding */
  px: 'px-2.5',  // 10px
  /** Vertical padding */
  py: 'py-1.5',  // 6px
  /** Text size for option labels */
  textSize: 'text-[13px]',
  /** Gap between icon and text */
  gap: 'gap-2',  // 8px
  /** Icon size (avatar, status circle, priority flag, color swatch) */
  iconSize: 16,  // px
  /** Hover background */
  hoverBg: 'hover:bg-[rgba(255,255,255,0.06)]',
  /** Selected background */
  selectedBg: 'bg-[rgba(255,255,255,0.08)]',
  /** Selected font weight */
  selectedWeight: 'font-medium',
  /** Border radius for individual options */
  borderRadius: 'rounded-sm', // var(--radius-sm) = 4px
}

/** Full Tailwind class string for a standard option row */
export const OPTION_CLASS = `flex items-center ${OPTION.gap} w-full ${OPTION.px} ${OPTION.py} ${OPTION.textSize} text-text transition-colors ${OPTION.hoverBg} cursor-pointer`

/** Class for a selected option */
export const OPTION_SELECTED_CLASS = `${OPTION.selectedBg} ${OPTION.selectedWeight}`

// ── Search / Filter Input ───────────────────────────────────────────

export const SEARCH_INPUT = {
  /** Container padding */
  containerClass: 'px-3 py-2 border-b border-border',
  /** Input text size (slightly smaller than options) */
  textSize: 'text-[12px]',
  /** Input classes */
  inputClass: 'w-full bg-transparent text-[12px] text-text outline-none placeholder:text-text-dim',
}

// ── Trigger Button ──────────────────────────────────────────────────

export const TRIGGER = {
  /** Standard trigger padding */
  px: 'px-2',    // 8px
  py: 'py-1',    // 4px
  /** Text size */
  textSize: 'text-[13px]',
  /** Gap between icon and text */
  gap: 'gap-1.5', // 6px
  /** Hover background */
  hoverBg: 'hover:bg-[rgba(255,255,255,0.06)]',
  /** Border radius */
  borderRadius: 'rounded-md',
}

/** Full trigger class for clickable field values */
export const TRIGGER_CLASS = `inline-flex items-center ${TRIGGER.gap} ${TRIGGER.px} ${TRIGGER.py} ${TRIGGER.borderRadius} ${TRIGGER.textSize} text-text ${TRIGGER.hoverBg} cursor-pointer transition-colors`

// ── Checkmark Icon (for selected items) ─────────────────────────────

/** Standard checkmark SVG for selected dropdown options */
export const CHECKMARK_SVG = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>'

// ── Chevron Icon (for trigger buttons) ──────────────────────────────

export const CHEVRON_SIZE = 10 // px

// ── Color Swatches ──────────────────────────────────────────────────

export const COLOR_SWATCH = {
  /** Size for color dots/swatches in dropdowns */
  size: 'w-4 h-4',
  /** Border radius for square swatches */
  borderRadius: 'rounded-[3px]',
  /** Border radius for circular dots */
  dotBorderRadius: 'rounded-full',
}

// ── Scrollable List ─────────────────────────────────────────────────

export const LIST = {
  /** Max height for scrollable options area */
  maxHeight: 'max-h-[280px]',
  /** Vertical padding around the list */
  py: 'py-1',
  /** Overflow behavior */
  overflow: 'overflow-y-auto',
}

export const LIST_CLASS = `${LIST.maxHeight} ${LIST.overflow} ${LIST.py}`
