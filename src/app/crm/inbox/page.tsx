'use client'

// /crm/inbox — three-pane conversation inbox.
// Thread list (left) → message stream (right) → composer (bottom-right).
// Threads are keyed on contact_id. URL: /crm/inbox?contact={contactId}
// API: GET /api/crm/inbox → { threads: CrmConversationThread[] } (bare, not crmFetch)
//      GET /api/crm/inbox/[contactId] → { thread, messages: NormalizedMessage[] }
//      POST /api/crm/inbox/[contactId] { channel, body } → { message }

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CrmConversationThread } from '@/lib/db'
import { ThreadListItem } from '@/components/crm/inbox/ThreadListItem'
import { MessageComposer } from '@/components/crm/inbox/MessageComposer'
import { Avatar, formatTime, mono, type Channel as SharedChannel } from '@/components/crm/inbox/shared'

// NormalizedMessage shape returned by /api/crm/inbox/[contactId]
interface NormalizedMessage {
  id: number
  channel: 'email' | 'sms' | 'chat' | 'whatsapp' | 'instagram'
  direction: 'inbound' | 'outbound'
  body: string
  sent_at: number
  meta: Record<string, unknown>
}

type Channel = 'sms' | 'email' | 'chat' | 'whatsapp' | 'instagram'

const CHANNEL_BADGE: Record<string, { bg: string; color: string }> = {
  sms: { bg: 'rgba(95,141,116,0.18)', color: '#5f8d74' },
  email: { bg: 'rgba(107,143,160,0.18)', color: '#6b8fa0' },
  chat: { bg: 'rgba(158,122,95,0.18)', color: '#9e7a5f' },
  whatsapp: { bg: 'rgba(37,211,102,0.18)', color: '#25d366' },
  instagram: { bg: 'rgba(193,53,132,0.18)', color: '#c13584' },
}

function ChannelPill({ channel }: { channel: string }) {
  const style = CHANNEL_BADGE[channel] ?? { bg: 'rgba(241,237,229,0.15)', color: 'var(--text-dim)' }
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
      style={{ ...mono, background: style.bg, color: style.color }}
    >
      {channel}
    </span>
  )
}

function MessageBubble({ msg }: { msg: NormalizedMessage }) {
  const isOut = msg.direction === 'outbound'
  const subject = msg.meta?.subject as string | undefined
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[65%] space-y-1 flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
        <div
          className="rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
          style={{
            background: isOut ? 'var(--accent)' : 'var(--bg-elevated)',
            color: isOut ? 'var(--text-inverse)' : 'var(--text)',
            borderBottomRightRadius: isOut ? 4 : undefined,
            borderBottomLeftRadius: !isOut ? 4 : undefined,
          }}
        >
          {subject && <div className="mb-1 text-[11px] font-semibold opacity-75">{subject}</div>}
          {msg.body || <span className="opacity-50 italic">empty</span>}
        </div>
        <div className="flex items-center gap-1.5 px-1">
          <ChannelPill channel={msg.channel} />
          <span className="text-[9px] text-[var(--text-dim)]">{formatTime(msg.sent_at)}</span>
        </div>
      </div>
    </div>
  )
}

export default function InboxPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const contactParam = searchParams.get('contact')

  // Thread list state
  const [threads, setThreads] = useState<CrmConversationThread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [threadsError, setThreadsError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Active thread state
  const [activeContactId, setActiveContactId] = useState<number | null>(
    contactParam ? Number(contactParam) : null
  )
  const [activeThread, setActiveThread] = useState<CrmConversationThread | null>(null)
  const [messages, setMessages] = useState<NormalizedMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)

  // Composer state
  const [composerChannel, setComposerChannel] = useState<Channel>('sms')
  const [composerBody, setComposerBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // Mobile: are we in message-stream view?
  const [mobileView, setMobileView] = useState<'list' | 'stream'>('list')

  const streamEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom of message stream on update
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load thread list
  const loadThreads = useCallback(async () => {
    setThreadsLoading(true)
    setThreadsError(null)
    try {
      const res = await fetch('/api/crm/inbox')
      const json = await res.json() as { threads?: CrmConversationThread[]; error?: string }
      if (!res.ok) throw new Error(json.error || 'Failed to load threads')
      setThreads(json.threads ?? [])
    } catch (e) {
      setThreadsError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setThreadsLoading(false)
    }
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])

  // Load messages for active thread
  const loadThread = useCallback(async (contactId: number) => {
    setThreadLoading(true)
    setThreadError(null)
    try {
      const res = await fetch(`/api/crm/inbox/${contactId}`)
      const json = await res.json() as {
        thread?: CrmConversationThread
        messages?: NormalizedMessage[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error || 'Failed to load thread')
      setActiveThread(json.thread ?? null)
      setMessages(json.messages ?? [])
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setThreadLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeContactId) {
      loadThread(activeContactId)
    } else {
      setActiveThread(null)
      setMessages([])
    }
  }, [activeContactId, loadThread])

  // Sync URL param → state on mount / back-navigation
  useEffect(() => {
    const id = contactParam ? Number(contactParam) : null
    setActiveContactId(id)
    if (id) setMobileView('stream')
  }, [contactParam])

  function selectContact(contactId: number) {
    setActiveContactId(contactId)
    setComposerBody('')
    setSendError(null)
    setMobileView('stream')
    router.replace(`/crm/inbox?contact=${contactId}`, { scroll: false })
  }

  function goBackToList() {
    setMobileView('list')
    setActiveContactId(null)
    router.replace('/crm/inbox', { scroll: false })
  }

  async function sendMessage() {
    if (!activeContactId || !composerBody.trim()) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/crm/inbox/${activeContactId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: composerChannel, body: composerBody.trim() }),
      })
      const json = await res.json() as { message?: NormalizedMessage; channel?: string; error?: string }
      if (!res.ok) throw new Error(json.error || 'Send failed')
      // The POST returns { channel, message } where message is the raw db row.
      // Normalize it to NormalizedMessage shape for appending.
      const raw = json.message as Record<string, unknown> | undefined
      if (raw) {
        const normalized: NormalizedMessage = {
          id: raw.id as number,
          channel: (json.channel ?? composerChannel) as NormalizedMessage['channel'],
          direction: 'outbound',
          body: composerBody.trim(),
          sent_at: (raw.sent_at as number | undefined) ?? Math.floor(Date.now() / 1000),
          meta: {},
        }
        setMessages((prev) => [...prev, normalized])
      }
      setComposerBody('')
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const filteredThreads = search.trim()
    ? threads.filter((t) =>
        t.contact_name.toLowerCase().includes(search.toLowerCase()) ||
        (t.contact_email ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : threads

  // Derive channels from active thread's channels string (comma-separated)
  const threadChannels = activeThread?.channels
    ? (activeThread.channels.split(',').map((c) => c.trim()).filter(Boolean) as Channel[])
    : []

  // Composer contact shape
  const composerContact = activeThread
    ? {
        id: activeThread.contact_id,
        name: activeThread.contact_name,
        email: activeThread.contact_email,
        phone: activeThread.contact_phone,
        company: null,
      }
    : null

  return (
    <main className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Desktop: two-column layout. Mobile: single column with pane toggling. */}
      <div className="flex flex-1 min-h-0">

        {/* Thread list pane */}
        <aside
          className={`flex flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] ${
            mobileView === 'stream' ? 'hidden md:flex' : 'flex'
          } w-full md:w-[320px] md:shrink-0`}
        >
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h1
              className="text-[13px] font-semibold mb-2"
              style={{ ...mono, letterSpacing: '-0.01em', color: 'var(--text)' }}
            >
              Inbox
            </h1>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-dim)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {threadsLoading ? (
              <div
                className="px-4 py-10 text-center text-[11px]"
                style={{ ...mono, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                Loading…
              </div>
            ) : threadsError ? (
              <div className="px-4 py-6 text-[12px]" style={{ color: 'var(--status-overdue)' }}>
                {threadsError}
                <button onClick={loadThreads} className="ml-2 underline text-[11px]">Retry</button>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-[13px] font-medium mb-1.5" style={{ color: 'var(--text)' }}>
                  {search ? 'No matches' : 'Inbox is quiet'}
                </p>
                <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
                  {search
                    ? 'Try a different name or email.'
                    : 'When contacts message you (SMS, email, chat, WhatsApp, Instagram), threads land here.'}
                </p>
              </div>
            ) : (
              filteredThreads.map((thread) => (
                <ThreadListItem
                  key={thread.contact_id}
                  thread={thread}
                  selected={thread.contact_id === activeContactId}
                  onClick={() => selectContact(thread.contact_id)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Message stream pane */}
        <section
          className={`flex flex-col flex-1 min-w-0 ${
            mobileView === 'list' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {!activeContactId ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                  Pick a conversation
                </p>
                <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>
                  Select a thread from the list to view messages.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Stream header */}
              <div
                className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-surface)]"
              >
                {/* Mobile back arrow */}
                <button
                  onClick={goBackToList}
                  className="md:hidden mr-1 text-[var(--text-dim)] hover:text-[var(--text)]"
                  aria-label="Back to thread list"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                {activeThread && (
                  <>
                    <Avatar name={activeThread.contact_name} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                        {activeThread.contact_name}
                      </div>
                      {threadChannels.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {threadChannels.map((ch) => (
                            <ChannelPill key={ch} channel={ch} />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {threadLoading && (
                  <span
                    className="text-[10px]"
                    style={{ ...mono, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
                  >
                    Loading…
                  </span>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {threadError ? (
                  <div className="text-[12px]" style={{ color: 'var(--status-overdue)' }}>
                    {threadError}
                    <button onClick={() => loadThread(activeContactId)} className="ml-2 underline text-[11px]">
                      Retry
                    </button>
                  </div>
                ) : messages.length === 0 && !threadLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
                      No messages yet.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => <MessageBubble key={`${msg.channel}-${msg.id}`} msg={msg} />)
                )}
                <div ref={streamEndRef} />
              </div>

              {/* Outbound stub disclaimer */}
              <div
                className="mx-5 mb-2 rounded-md px-3 py-1.5 text-[11px] text-center"
                style={{
                  background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
                  color: 'var(--text-dim)',
                  ...mono,
                  letterSpacing: '0.03em',
                }}
              >
                Outbound delivery via Twilio/SendGrid is not yet wired — messages are stored only.
              </div>

              {/* Composer */}
              <MessageComposer
                channel={(composerChannel as SharedChannel) in { sms: 1, email: 1, chat: 1 }
                  ? (composerChannel as SharedChannel)
                  : 'sms'}
                onChannelChange={(ch: SharedChannel) => {
                  // The existing Channel type in shared.tsx only includes sms|email|chat.
                  // Cast wider channels (whatsapp|instagram) through — composer only
                  // shows the toggle for the three base channels but we pass whatsapp/
                  // instagram through unchanged when thread channels dictate it.
                  setComposerChannel(ch as Channel)
                }}
                value={composerBody}
                onChange={setComposerBody}
                onSend={sendMessage}
                onAiDraft={() => {
                  // AI draft is a no-op stub here — the messaging-provider sprint
                  // will wire this up once crm-ai-service is extended.
                }}
                contactId={activeContactId}
                contact={composerContact}
                sending={sending}
                draftError={sendError}
                showChannelToggle
              />
            </>
          )}
        </section>
      </div>
    </main>
  )
}
