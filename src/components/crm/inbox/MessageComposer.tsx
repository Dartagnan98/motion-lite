'use client'

import { useEffect, useRef } from 'react'
import { useSnippetPicker } from '@/components/crm/SnippetPicker'
import { mono, type Channel } from './shared'

export interface ComposerContact {
  id: number
  name: string
  email: string | null
  phone: string | null
  company: string | null
}

/**
 * Textarea + channel toggle + snippet picker + AI draft button + Cmd+Enter send.
 *
 * `contactId` ensures we remount the picker when switching contacts so the
 * snippet index resets cleanly. The snippet picker needs name/email/phone/company
 * to interpolate `{{contact.*}}` tokens, so we accept an optional `contact` prop
 * alongside the id — pass it through from the inbox parent.
 */
export function MessageComposer({
  channel,
  onChannelChange,
  value,
  onChange,
  onSend,
  onAiDraft,
  contactId,
  contact,
  sending = false,
  drafting = false,
  draftError = null,
  showChannelToggle = false,
}: {
  channel: Channel
  onChannelChange: (next: Channel) => void
  value: string
  onChange: (next: string) => void
  onSend: () => void
  onAiDraft: () => void
  contactId: number | null
  contact?: ComposerContact | null
  sending?: boolean
  drafting?: boolean
  draftError?: string | null
  showChannelToggle?: boolean
}) {
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const wasDrafting = useRef(drafting)

  // Focus the textarea when an AI draft finishes — matches original behavior
  // where the parent called composerRef.current?.focus() in generateAiDraft.
  useEffect(() => {
    if (wasDrafting.current && !drafting) {
      queueMicrotask(() => composerRef.current?.focus())
    }
    wasDrafting.current = drafting
  }, [drafting])

  const snippetPicker = useSnippetPicker({
    // Chat shares the SMS template pool — both are short, informal bodies.
    channel: channel === 'chat' ? 'sms' : channel,
    text: value,
    setText: onChange,
    textareaRef: composerRef,
    contact: contact ? { name: contact.name, email: contact.email, phone: contact.phone, company: contact.company } : null,
  })

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3">
      {showChannelToggle && (
        <div className="mb-2 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5 w-fit">
          {(['sms', 'email', 'chat'] as Channel[]).map((ch) => (
            <button
              key={ch}
              onClick={() => onChannelChange(ch)}
              className="rounded-md px-3 py-1 text-[10px] font-medium transition-colors"
              style={{
                ...mono,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                background: channel === ch ? 'var(--accent)' : 'transparent',
                color: channel === ch ? 'var(--text-inverse)' : 'var(--text-dim)',
              }}
            >
              {ch}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        {snippetPicker.menu}
        <textarea
          ref={composerRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Snippet picker handles Arrow/Enter/Tab/Escape when open
            if (snippetPicker.onKeyDown(e)) return
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onSend()
            }
          }}
          rows={2}
          placeholder={channel === 'sms' ? 'Type a message…  (/ for templates)' : 'Write your reply…  (/ for templates)'}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
        />
      </div>
      {draftError && (
        <div className="mt-2 rounded-md px-2 py-1 text-[11px]" style={{
          background: 'color-mix(in oklab, var(--status-overdue) 12%, transparent)',
          color: 'var(--status-overdue)',
        }}>
          {draftError}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[var(--text-dim)]" style={mono}>/ templates · cmd+enter send</span>
          <button
            onClick={onAiDraft}
            disabled={drafting || !contactId}
            className="h-6 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[10px] font-medium transition-colors disabled:opacity-45"
            style={{ ...mono, color: 'var(--accent-text)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
            title="Draft a reply using the conversation history"
          >
            {drafting ? '✦ drafting…' : '✦ AI draft'}
          </button>
        </div>
        <button
          onClick={onSend}
          disabled={sending || !value.trim()}
          className="h-8 rounded-lg px-4 text-[11px] font-medium text-[var(--text-inverse)] transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-35"
          style={{ ...mono, background: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
