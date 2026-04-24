'use client'

import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  iconRight?: ReactNode
  loading?: boolean
  children?: ReactNode
}

const sizeMap: Record<Size, { padding: string; fontSize: number; iconGap: number; radius: number }> = {
  sm: { padding: '5px 10px', fontSize: 12, iconGap: 5, radius: 6 },
  md: { padding: '7px 14px', fontSize: 13, iconGap: 6, radius: 8 },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    disabled,
    children,
    style,
    onMouseEnter,
    onMouseLeave,
    ...rest
  },
  ref,
) {
  const sizing = sizeMap[size]
  const isDisabled = disabled || loading

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sizing.iconGap,
    padding: sizing.padding,
    fontSize: sizing.fontSize,
    fontWeight: 500,
    lineHeight: 1.2,
    borderRadius: sizing.radius,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.55 : 1,
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
    whiteSpace: 'nowrap' as const,
  }

  const variantStyles = (() => {
    switch (variant) {
      case 'primary':
        return {
          background: 'var(--accent)',
          color: 'var(--accent-fg)',
          border: '1px solid transparent',
        }
      case 'secondary':
        return {
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }
      case 'ghost':
        return {
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '1px solid transparent',
        }
      case 'danger':
        return {
          background: 'transparent',
          color: 'var(--status-overdue, #d66055)',
          border: '1px solid var(--border)',
        }
    }
  })()

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      style={{ ...base, ...variantStyles, ...style }}
      onMouseEnter={e => {
        if (!isDisabled) {
          const el = e.currentTarget
          if (variant === 'primary') {
            el.style.background = 'var(--accent-hover)'
          } else if (variant === 'secondary') {
            el.style.borderColor = 'var(--accent)'
            el.style.color = 'var(--accent-text)'
          } else if (variant === 'ghost') {
            el.style.background = 'var(--bg-hover)'
            el.style.color = 'var(--text)'
          } else if (variant === 'danger') {
            el.style.borderColor = 'var(--status-overdue, #d66055)'
            el.style.color = 'var(--status-overdue, #d66055)'
          }
        }
        onMouseEnter?.(e)
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        Object.assign(el.style, variantStyles)
        onMouseLeave?.(e)
      }}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  )
})

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 12,
        height: 12,
        border: '1.5px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        display: 'inline-block',
      }}
    />
  )
}
