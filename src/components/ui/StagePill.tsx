'use client'

interface StagePillProps {
  name: string
  color: string
  size?: 'sm' | 'md'
}

export function StagePill({ name, color, size = 'md' }: StagePillProps) {
  const iconSize = size === 'sm' ? 18 : 20
  const py = size === 'sm' ? 'py-0.5' : 'py-1'
  const px = size === 'sm' ? 'pl-1 pr-2' : 'pl-1.5 pr-2.5'

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${py} ${px} text-[13px] font-semibold min-w-0 whitespace-nowrap`}
      style={{ background: `${color}20`, color: 'white', borderRadius: 4 }}
      title={name}
    >
      <span
        className="shrink-0 rounded-full flex items-center justify-center"
        style={{
          width: iconSize,
          height: iconSize,
          background: color,
        }}
      >
        <svg width={iconSize - 4} height={iconSize - 4} viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6h7M6.5 3L9.5 6L6.5 9" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="truncate">{name}</span>
    </span>
  )
}
