'use client'

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

export const mono = { fontFamily: 'var(--font-mono)' } as const

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatCompactCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '')
}

export function ghostButtonStyle(tone: 'default' | 'danger' | 'accent' = 'default'): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: tone === 'accent' ? 'var(--bg-hover)' : 'var(--bg-elevated)',
    color: tone === 'danger' ? 'var(--status-overdue)' : tone === 'accent' ? 'var(--accent-text)' : 'var(--text-secondary)',
    fontSize: 11,
    cursor: 'pointer',
    textDecoration: 'none',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
    whiteSpace: 'nowrap',
  }
}

export function fieldStyle(multiline = false): CSSProperties {
  return {
    width: '100%',
    borderRadius: 10,
    border: '1px solid var(--border-field)',
    background: 'var(--bg-field)',
    color: 'var(--text)',
    padding: multiline ? '10px 12px' : '8px 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    resize: multiline ? 'vertical' : undefined,
    minHeight: multiline ? 110 : undefined,
    outline: 'none',
  }
}

export function Panel({
  title,
  subtitle,
  rightSlot,
  children,
}: {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
  children: ReactNode
}) {
  return (
    <section style={{
      border: '1px solid var(--border)',
      borderRadius: 14,
      background: 'var(--bg-surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minWidth: 0,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 16px 0',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</div>
          {subtitle && <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-dim)' }}>{subtitle}</div>}
        </div>
        {rightSlot && <div style={{ flexShrink: 0 }}>{rightSlot}</div>}
      </div>
      <div style={{ padding: '0 16px 16px' }}>{children}</div>
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'accent' | 'success' | 'warn'
}) {
  const color = tone === 'accent'
    ? 'var(--accent-text)'
    : tone === 'success'
    ? 'var(--status-completed)'
    : tone === 'warn'
    ? 'var(--status-active)'
    : 'var(--text)'
  const border = tone === 'accent'
    ? 'color-mix(in oklab, var(--accent) 28%, var(--border))'
    : tone === 'success'
    ? 'color-mix(in oklab, var(--status-completed) 28%, var(--border))'
    : tone === 'warn'
    ? 'color-mix(in oklab, var(--status-active) 28%, var(--border))'
    : 'var(--border)'

  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 12,
      border: `1px solid ${border}`,
      background: 'var(--bg-surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', ...mono, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color, letterSpacing: '-0.02em' }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{hint}</div>}
    </div>
  )
}

export function StatusDot({ tone }: { tone: 'active' | 'success' | 'error' | 'neutral' }) {
  const background = tone === 'active'
    ? 'var(--status-active)'
    : tone === 'success'
    ? 'var(--status-completed)'
    : tone === 'error'
    ? 'var(--status-overdue)'
    : 'var(--text-muted)'
  return <span style={{ width: 8, height: 8, borderRadius: 999, background, display: 'inline-block' }} />
}

export function PlatformBadge({ platform }: { platform: 'meta' | 'google_ads' | 'tiktok' }) {
  const label = platform === 'google_ads' ? 'Google Ads' : platform === 'tiktok' ? 'TikTok' : 'Meta'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 8px',
      borderRadius: 999,
      border: '1px solid var(--border)',
      background: 'var(--bg-elevated)',
      color: 'var(--text-secondary)',
      fontSize: 11,
    }}>
      <span style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in oklab, var(--accent) 14%, var(--bg-panel))',
        color: 'var(--accent-text)',
        ...mono,
        fontSize: 10,
      }}>
        {platform === 'google_ads' ? 'G' : platform === 'tiktok' ? 'T' : 'M'}
      </span>
      {label}
    </span>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--text-muted)', ...mono, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {children}
    </div>
  )
}

export function CopyCodeBlock({
  label,
  code,
  copied,
  onCopy,
}: {
  label: string
  code: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <SectionLabel>{label}</SectionLabel>
        <button type="button" onClick={onCopy} style={ghostButtonStyle('accent')}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre style={{
        margin: 0,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        color: 'var(--text)',
        fontSize: 12,
        lineHeight: 1.6,
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...mono,
      }}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function EmptyPanel({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div style={{
      border: '1px dashed var(--border-strong)',
      borderRadius: 12,
      background: 'var(--bg-panel)',
      padding: '22px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div style={{ maxWidth: 540, fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)' }}>{description}</div>
      {action}
    </div>
  )
}

export function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} style={ghostButtonStyle()}>{children}</Link>
}
