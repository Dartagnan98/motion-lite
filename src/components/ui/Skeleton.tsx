'use client'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  radius?: string | number
  className?: string
}

export function Skeleton({ width = '100%', height = 14, radius = 'var(--radius-sm)', className }: SkeletonProps) {
  return (
    <div
      className={`animate-skeleton ${className || ''}`}
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'var(--bg-elevated)',
      }}
    />
  )
}

/** Row skeleton: icon circle + two text lines */
export function SkeletonRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
      <Skeleton width={28} height={28} radius="50%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width="60%" height={12} />
        <Skeleton width="35%" height={10} />
      </div>
    </div>
  )
}

/** Card skeleton */
export function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-xl)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <Skeleton width="45%" height={14} />
      <Skeleton width="80%" height={11} />
      <Skeleton width="60%" height={11} />
    </div>
  )
}

/** Table skeleton — n rows with consistent column widths */
export function SkeletonTable({ rows = 6, columns = [30, 20, 15, 20, 15] }: { rows?: number; columns?: number[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: columns.map(c => `${c}fr`).join(' '),
            gap: 16,
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            alignItems: 'center',
          }}
        >
          {columns.map((_, j) => (
            <Skeleton key={j} height={11} width={`${60 + ((i + j) % 4) * 8}%`} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** List skeleton — plain list, no card container */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

/** Grid of skeleton cards for card-view pages */
export function SkeletonCardGrid({ count = 6, minWidth = 248 }: { count?: number; minWidth?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
        gap: 16,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
