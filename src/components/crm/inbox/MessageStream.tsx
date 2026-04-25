'use client'

import type { CrmSmsMessage, EmailInboxMessage } from '@/lib/db'
import { formatTime, mono, stripHtml } from './shared'

export interface CrmChatMessage {
  id: number
  widget_id: number
  contact_id: number
  direction: 'inbound' | 'outbound'
  body: string
  sent_at: number
}

type AnyMessage = {
  id: string | number
  ts: number
  direction: string
  body: string
  type: 'sms' | 'email' | 'chat'
  subject?: string
}

/**
 * Merged message list — SMS + Email + Chat sorted by timestamp, with AI-sent badges.
 */
export function MessageStream({
  smsMessages,
  emailMessages,
  chatMessages,
  aiSentBodies,
}: {
  smsMessages: CrmSmsMessage[]
  emailMessages: EmailInboxMessage[]
  chatMessages: CrmChatMessage[]
  aiSentBodies: Set<string>
}) {
  const messages: AnyMessage[] = [
    ...smsMessages.map((m) => ({
      id: `sms-${m.id}`,
      ts: m.sent_at,
      direction: m.direction,
      body: m.body,
      type: 'sms' as const,
    })),
    ...emailMessages.map((m) => ({
      id: `email-${m.id}`,
      ts: m.received_at,
      direction: m.direction,
      body: stripHtml(m.body_html || ''),
      type: 'email' as const,
      subject: m.subject || undefined,
    })),
    ...chatMessages.map((m) => ({
      id: `chat-${m.id}`,
      ts: m.sent_at,
      direction: m.direction,
      body: m.body,
      type: 'chat' as const,
    })),
  ].sort((a, b) => a.ts - b.ts)

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-[12px] text-[var(--text-dim)]">No messages yet. Send the first one below.</div>
      </div>
    )
  }

  return (
    <>
      {messages.map((msg) => {
        const isOut = msg.direction === 'outbound'
        const isAi = isOut && aiSentBodies.has(msg.body.trim())
        return (
          <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[65%] space-y-1 ${isOut ? 'items-end' : 'items-start'} flex flex-col`}>
              <div
                className="rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
                style={{
                  background: isOut ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: isOut ? 'var(--text-inverse)' : 'var(--text)',
                  borderBottomRightRadius: isOut ? 4 : undefined,
                  borderBottomLeftRadius: !isOut ? 4 : undefined,
                }}
              >
                {msg.subject && <div className="mb-1 text-[11px] font-semibold opacity-75">{msg.subject}</div>}
                {msg.body}
              </div>
              <div className="flex items-center gap-1.5 px-1">
                {isAi && (
                  <span
                    title="Sent by Conversation AI auto-reply"
                    style={{
                      ...mono,
                      fontSize: 10,
                      padding: '1px 3px',
                      borderRadius: 2,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      background: 'color-mix(in oklab, var(--accent) 20%, transparent)',
                      color: 'var(--accent)',
                    }}
                  >
                    AI
                  </span>
                )}
                <span
                  className="rounded px-1 py-0.5 text-[8px] uppercase tracking-wider"
                  style={{
                    ...mono,
                    background: msg.type === 'email' ? 'rgba(107,143,160,0.15)' : 'rgba(241,237,229,0.15)',
                    color: msg.type === 'email' ? '#6b8fa0' : 'var(--accent)',
                  }}
                >
                  {msg.type}
                </span>
                <span className="text-[9px] text-[var(--text-dim)]">{formatTime(msg.ts)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
