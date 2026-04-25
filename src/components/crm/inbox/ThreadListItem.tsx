'use client'

import type { CrmConversationThread } from '@/lib/db'
import { Avatar, formatTime, mono } from './shared'

/**
 * One row in the inbox thread list.
 * Avatar, contact name, latest timestamp, preview body, assignee badge, unread count.
 */
export function ThreadListItem({
  thread,
  selected,
  onClick,
}: {
  thread: CrmConversationThread
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[rgba(255,255,255,0.03)]"
      style={{ background: selected ? 'rgba(241,237,229,0.1)' : undefined }}
    >
      <Avatar name={thread.contact_name} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-[var(--text)]">{thread.contact_name}</span>
          <span className="shrink-0 text-[10px] text-[var(--text-dim)]">{formatTime(thread.latest_at)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-[var(--text-dim)]">{thread.latest_body || 'No messages yet'}</span>
          <span className="flex items-center gap-1 shrink-0">
            {thread.assigned_user_name && (
              <span
                className="rounded-md px-1.5 py-[1px] text-[9px]"
                style={{
                  ...mono,
                  letterSpacing: '0.04em',
                  background: 'color-mix(in oklab, var(--accent) 16%, transparent)',
                  color: 'var(--accent-text)',
                }}
                title={`Assigned to ${thread.assigned_user_name}`}
              >
                {thread.assigned_user_name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            )}
            {thread.unread_count > 0 && (
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-semibold text-[var(--text-inverse)]">
                {thread.unread_count}
              </span>
            )}
          </span>
        </div>
      </div>
    </button>
  )
}
