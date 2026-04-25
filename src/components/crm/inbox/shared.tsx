/**
 * Shared helpers for the inbox components.
 * Extracted from src/app/crm/inbox/page.tsx so the inbox popover + dashboard
 * widget can reuse the same primitives without duplicating code.
 */

export const mono = { fontFamily: 'var(--font-mono)' } as const

export type Channel = 'sms' | 'email' | 'chat'

export function initials(name: string) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export function formatTime(ts: number) {
  const date = new Date(ts * 1000)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const colors = ['#5f8d74', '#6b8fa0', '#9e7a5f', '#7a7a9e', '#9e5f7a', '#7a9e5f']
  const idx = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % colors.length
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colors[idx], fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  )
}

export function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
