'use client'

import { useMemo } from 'react'
import type { CrmContactRecord } from '@/lib/db'
import { Avatar } from '@/components/ui/Avatar'

const mono = { fontFamily: 'var(--font-mono)' } as const

/**
 * Top-of-composer banner shown when the user arrived at a composer via bulk
 * select on the Contacts page. Mono, one line, dismissible. Dismiss does NOT
 * clear the recipients — only hides the banner.
 */
export function BulkSelectBanner({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '8px 14px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 8,
        ...mono,
        fontSize: 11, letterSpacing: '0.04em',
        color: 'var(--text-dim)',
      }}
    >
      <span>{`BLASTING TO ${count} SELECTED CONTACT${count === 1 ? '' : 'S'} FROM CONTACTS.`}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss banner"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 12, padding: '2px 6px',
          transition: 'color 120ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        ×
      </button>
    </div>
  )
}

/**
 * Compact recipients row that sits at the TOP of the composer. Shows a mono
 * count label, inline overlapping avatars for the first 5 contacts, and a
 * "+ N more" chip. A ghost "Change" button swaps to the normal list/tag
 * picker via {@link onChange}.
 */
export function RecipientsChipRow({
  contacts,
  loading,
  onChange,
}: {
  contacts: CrmContactRecord[]
  loading?: boolean
  onChange?: () => void
}) {
  const count = contacts.length
  const visible = useMemo(() => contacts.slice(0, 5), [contacts])
  const extra = Math.max(0, count - visible.length)

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          RECIPIENTS
        </span>
        <span style={{ ...mono, fontSize: 12, letterSpacing: '0.04em', color: 'var(--text)' }}>
          {loading ? 'LOADING…' : `${count} CONTACT${count === 1 ? '' : 'S'} SELECTED`}
        </span>
      </div>

      {!loading && count > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {visible.map((c, i) => (
              <div
                key={c.id}
                title={c.name || c.email || `Contact #${c.id}`}
                style={{
                  marginLeft: i === 0 ? 0 : -8,
                  borderRadius: '50%',
                  boxShadow: '0 0 0 1px var(--border)',
                  background: 'var(--bg-surface)',
                  display: 'flex',
                  transition: 'transform 120ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
              >
                <Avatar name={c.name || c.email || '?'} size={28} />
              </div>
            ))}
          </div>
          {extra > 0 && (
            <span
              style={{
                marginLeft: 10,
                ...mono,
                fontSize: 11, letterSpacing: '0.04em',
                padding: '4px 8px', borderRadius: 999,
                background: 'var(--bg-elevated)',
                color: 'var(--text-dim)',
                border: '1px solid var(--border)',
              }}
            >
              {`+${extra} MORE`}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {onChange && (
            <button
              type="button"
              onClick={onChange}
              style={{
                padding: '6px 12px', borderRadius: 8,
                background: 'transparent', color: 'var(--text-dim)',
                border: '1px solid var(--border)',
                fontSize: 12, cursor: 'pointer',
                transition: 'color 120ms ease, border-color 120ms ease, background 120ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text)'
                e.currentTarget.style.background = 'var(--bg-hover)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-dim)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              Change
            </button>
          )}
        </div>
      )}
    </div>
  )
}
