/**
 * Shared SVG icon components for commonly reused icons.
 * All icons default to size=16, stroke="currentColor", and inherit color from parent.
 */

interface IconProps {
  size?: number
  className?: string
  strokeWidth?: number
  style?: React.CSSProperties
}

export function IconX({ size = 16, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

export function IconChevronDown({ size = 16, className, strokeWidth = 2.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconChevronRight({ size = 16, className, strokeWidth = 1.5, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconPlus({ size = 16, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

export function IconCheck({ size = 14, className, strokeWidth = 2, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconMoreVertical({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="3" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="13" r="1.25" fill="currentColor" />
    </svg>
  )
}

export function IconTrash({ size = 16, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M2.5 4h11M5.5 4V2.5h5V4M6 7v4.5M10 7v4.5M3.5 4l.75 9.5h7.5L12.5 4" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconEdit({ size = 16, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M9.5 3.5l3 3L5 14H2v-3L9.5 3.5z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  )
}

export function IconClock({ size = 16, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth={strokeWidth} />
      <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconCalendar({ size = 16, className, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth={strokeWidth} />
      <path d="M2 6.5h12M5 2v2M11 2v2" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

export function IconPerson({ size = 16, className, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth={strokeWidth} />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

export function IconTag({ size = 16, className, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M2 8.5V3a1 1 0 011-1h5.5L14 7.5 8.5 13 2 8.5z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
    </svg>
  )
}

export function IconLink({ size = 16, className, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

export function IconNoEntry({ size = 16, className, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth={strokeWidth} />
      <path d="M4 8h8" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

export function IconCopy({ size = 16, className, strokeWidth = 1.3 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth={strokeWidth} />
      <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" strokeWidth={strokeWidth} />
    </svg>
  )
}

export function IconMoreHorizontal({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="4" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
    </svg>
  )
}

export function IconArrowRight({ size = 16, className, strokeWidth = 1.5, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconStage({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M5 8h6M8 5.5l3 2.5-3 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconWorkspace({ size = 16, className, strokeWidth = 1.5, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
      <path d="M12 2L2 8.5l10 6.5 10-6.5L12 2z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M2 12l10 6.5L22 12" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M2 15.5l10 6.5 10-6.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  )
}

export function IconSparkle({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function IconClaude({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="currentColor" className={className} style={style}>
      <g>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(0 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(30 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(60 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(90 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(120 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(150 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(180 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(210 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(240 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(270 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(300 50 50)"/>
        <polygon points="47.5,55 45.5,8 50,3 54.5,8 52.5,55" transform="rotate(330 50 50)"/>
      </g>
    </svg>
  )
}

export function IconTemplate({ size = 16, className, strokeWidth = 1.3, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} style={style}>
      <path d="M3 3h10v2H3zM3 7h7v2H3zM3 11h5v2H3zM12 8l2 2-2 2M11 12h3" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
