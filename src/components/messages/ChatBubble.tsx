'use client'

import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from 'react'
import { IconX } from '@/components/ui/Icons'

// ── Types ────────────────────────────────────────────────────────────
interface Channel {
  id: number
  name: string
  type: 'channel' | 'dm' | 'ai'
  unread: number
  last_message?: string
  last_message_at?: string
  avatar?: string
}

interface Message {
  id: number
  channel_id: number
  user_id: number
  user_name: string
  content: string
  created_at: string
}

interface MentionOption {
  id: string
  name: string
  type: 'user' | 'agent'
}

type TabType = 'channels' | 'dms' | 'ai'
type ViewType = 'list' | 'conversation'

// ── AI Agents ────────────────────────────────────────────────────────
const AI_AGENTS: Channel[] = [
  { id: -1, name: 'Jimmy', type: 'ai', unread: 0, avatar: 'J' },
  { id: -2, name: 'Gary', type: 'ai', unread: 0, avatar: 'G' },
  { id: -3, name: 'Ricky', type: 'ai', unread: 0, avatar: 'R' },
  { id: -4, name: 'Sofia', type: 'ai', unread: 0, avatar: 'S' },
]

// ── Icons ────────────────────────────────────────────────────────────
function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
        fill="white"
      />
    </svg>
  )
}

function CloseIcon() {
  return <IconX />
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M14 2L7 9M14 2l-4.5 12-2-5.5L2 6.5 14 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────
function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getInitial(name: string): string {
  return (name || '?')[0].toUpperCase()
}

import { avatarColor } from '@/components/ui/Avatar'

const AGENT_COLORS: Record<string, string> = {
  J: avatarColor('jimmy'),
  G: avatarColor('gary'),
  R: avatarColor('ricky'),
  S: avatarColor('sofia'),
}

// ── Component ────────────────────────────────────────────────────────
export function ChatBubble() {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('chatBubbleOpen') === 'true'
  })
  const [activeView, setActiveView] = useState<ViewType>('list')
  const [activeTab, setActiveTab] = useState<TabType>('channels')
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [sending, setSending] = useState(false)

  // Mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Persist open state
  useEffect(() => {
    localStorage.setItem('chatBubbleOpen', String(isOpen))
  }, [isOpen])

  // Fetch channels
  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/channels')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setChannels(data)
    } catch {
      // API may not exist yet -- fail silently
    }
  }, [])

  // Fetch unread count
  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/unread?user_id=1')
      if (!res.ok) return
      const data = await res.json()
      setUnreadTotal(data.total ?? 0)
    } catch {
      // fail silently
    }
  }, [])

  // Fetch messages for active channel
  const fetchMessages = useCallback(async (channelId: number) => {
    try {
      const res = await fetch(`/api/messages/channels/${channelId}/messages?limit=30`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setMessages(data)
    } catch {
      // fail silently
    }
  }, [])

  // Mark channel as read
  const markRead = useCallback(async (channelId: number) => {
    try {
      await fetch(`/api/messages/channels/${channelId}/read`, { method: 'POST' })
      fetchUnread()
    } catch {
      // fail silently
    }
  }, [fetchUnread])

  // Refs for stable polling closure
  const isOpenRef = useRef(isOpen)
  const activeViewRef = useRef(activeView)
  useEffect(() => { isOpenRef.current = isOpen }, [isOpen])
  useEffect(() => { activeViewRef.current = activeView }, [activeView])

  // Initial load + polling
  useEffect(() => {
    fetchChannels()
    fetchUnread()

    pollRef.current = setInterval(() => {
      fetchUnread()
      if (isOpenRef.current && activeViewRef.current === 'list') fetchChannels()
    }, 30000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchChannels, fetchUnread])

  // When opening a conversation
  useEffect(() => {
    if (activeView === 'conversation' && activeChannel) {
      fetchMessages(activeChannel.id)
      markRead(activeChannel.id)
    }
  }, [activeView, activeChannel, fetchMessages, markRead])

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Poll messages in conversation view
  useEffect(() => {
    if (activeView !== 'conversation' || !activeChannel) return
    const interval = setInterval(() => {
      fetchMessages(activeChannel.id)
    }, 5000)
    return () => clearInterval(interval)
  }, [activeView, activeChannel, fetchMessages])

  // ── Mention logic ──────────────────────────────────────────────────
  const allMentionOptions: MentionOption[] = [
    ...AI_AGENTS.map(a => ({ id: a.name.toLowerCase(), name: a.name, type: 'agent' as const })),
    // Could add real users here from an API
  ]

  function handleInputChange(val: string) {
    setInputValue(val)

    // Check for @ mention
    const cursorPos = inputRef.current?.selectionStart ?? val.length
    const textBeforeCursor = val.slice(0, cursorPos)
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/)

    if (mentionMatch) {
      const q = mentionMatch[1].toLowerCase()
      setMentionQuery(q)
      const filtered = allMentionOptions.filter(o => o.name.toLowerCase().startsWith(q))
      setMentionOptions(filtered)
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
      setMentionOptions([])
    }
  }

  function insertMention(option: MentionOption) {
    const cursorPos = inputRef.current?.selectionStart ?? inputValue.length
    const textBeforeCursor = inputValue.slice(0, cursorPos)
    const textAfterCursor = inputValue.slice(cursorPos)
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/)

    if (mentionMatch) {
      const before = textBeforeCursor.slice(0, mentionMatch.index)
      const newVal = `${before}@${option.name} ${textAfterCursor}`
      setInputValue(newVal)
    }

    setMentionQuery(null)
    setMentionOptions([])
    inputRef.current?.focus()
  }

  // ── Send message ───────────────────────────────────────────────────
  async function sendMessage() {
    if (!inputValue.trim() || !activeChannel || sending) return

    setSending(true)
    const content = inputValue.trim()
    setInputValue('')

    // Optimistic update
    const optimistic: Message = {
      id: Date.now(),
      channel_id: activeChannel.id,
      user_id: 1,
      user_name: 'You',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])

    try {
      const res = await fetch(`/api/messages/channels/${activeChannel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, user_id: 1 }),
      })
      if (res.ok) {
        // Refresh real messages
        fetchMessages(activeChannel.id)
      }
    } catch {
      // Keep optimistic message on failure
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Mention navigation
    if (mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => Math.min(i + 1, mentionOptions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionOptions[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        setMentionOptions([])
        return
      }
    }

    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Open channel ───────────────────────────────────────────────────
  function openChannel(channel: Channel) {
    setActiveChannel(channel)
    setActiveView('conversation')
    setMessages([])
  }

  function goBack() {
    setActiveView('list')
    setActiveChannel(null)
    setMessages([])
    fetchChannels()
  }

  // ── Filter channels by tab ────────────────────────────────────────
  function getFilteredChannels(): Channel[] {
    if (activeTab === 'ai') return AI_AGENTS
    return channels.filter(c => {
      if (activeTab === 'channels') return c.type === 'channel'
      if (activeTab === 'dms') return c.type === 'dm'
      return true
    })
  }

  // ── Render ─────────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed z-50 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--accent)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)',
          cursor: 'pointer',
          color: 'white',
        }}
        aria-label="Open chat"
      >
        <ChatIcon />
        {unreadTotal > 0 && (
          <span
            className="absolute flex items-center justify-center text-white font-semibold"
            style={{
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              background: 'var(--red)',
              fontSize: 11,
              padding: '0 5px',
              border: '2px solid var(--bg)',
            }}
          >
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>
    )
  }

  const filtered = getFilteredChannels()

  return (
    <div
      className="fixed z-50 flex flex-col glass-elevated animate-glass-in"
      style={{
        bottom: 24,
        right: 24,
        width: 380,
        height: 560,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {/* ── Channel List View ──────────────────────────────────────── */}
      {activeView === 'list' && (
        <>
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 shrink-0"
            style={{
              height: 52,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
              Messages
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center rounded-md transition-colors"
              style={{
                width: 28,
                height: 28,
                color: 'var(--text-dim)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Tabs */}
          <div
            className="flex shrink-0 gap-1 px-3"
            style={{
              height: 40,
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {(['channels', 'dms', 'ai'] as TabType[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1 rounded-md text-[12px] font-medium transition-all"
                style={{
                  background: activeTab === tab ? 'var(--accent)' : 'transparent',
                  color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {tab === 'channels' ? 'Channels' : tab === 'dms' ? 'DMs' : 'AI'}
              </button>
            ))}
          </div>

          {/* Channel list */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
                  No {activeTab === 'ai' ? 'agents' : activeTab} yet
                </span>
              </div>
            ) : (
              filtered.map(channel => (
                <button
                  key={`${channel.type}-${channel.id}`}
                  onClick={() => openChannel(channel)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Avatar */}
                  <div
                    className="flex items-center justify-center shrink-0 rounded-full text-[13px] font-semibold"
                    style={{
                      width: 36,
                      height: 36,
                      background: channel.type === 'ai'
                        ? (AGENT_COLORS[getInitial(channel.name)] || 'var(--accent)')
                        : 'var(--bg-elevated)',
                      color: 'var(--text)',
                    }}
                  >
                    {channel.avatar || getInitial(channel.name)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>
                        {channel.type === 'channel' ? `# ${channel.name}` : channel.name}
                      </span>
                      {channel.last_message_at && (
                        <span className="text-[11px] shrink-0 ml-2" style={{ color: 'var(--text-dim)' }}>
                          {formatTime(channel.last_message_at)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span
                        className="text-[12px] truncate"
                        style={{ color: 'var(--text-secondary)', maxWidth: channel.unread > 0 ? 'calc(100% - 28px)' : '100%' }}
                      >
                        {channel.type === 'ai'
                          ? `Chat with ${channel.name}`
                          : (channel.last_message || 'No messages yet')}
                      </span>
                      {channel.unread > 0 && (
                        <span
                          className="flex items-center justify-center shrink-0 text-white font-semibold"
                          style={{
                            minWidth: 18,
                            height: 18,
                            borderRadius: 9,
                            background: 'var(--accent-text)',
                            fontSize: 10,
                            padding: '0 5px',
                          }}
                        >
                          {channel.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {/* ── Conversation View ──────────────────────────────────────── */}
      {activeView === 'conversation' && activeChannel && (
        <>
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 shrink-0"
            style={{
              height: 52,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <button
              onClick={goBack}
              className="flex items-center justify-center rounded-md transition-colors"
              style={{
                width: 28,
                height: 28,
                color: 'var(--text-dim)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              aria-label="Back to channels"
            >
              <BackIcon />
            </button>
            <div className="flex-1 min-w-0">
              <span className="text-[14px] font-semibold truncate block" style={{ color: 'var(--text)' }}>
                {activeChannel.type === 'channel' ? `# ${activeChannel.name}` : activeChannel.name}
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center rounded-md transition-colors"
              style={{
                width: 28,
                height: 28,
                color: 'var(--text-dim)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-[13px]" style={{ color: 'var(--text-dim)' }}>
                  No messages yet. Say something.
                </span>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className="flex gap-2.5 mb-3">
                  {/* Avatar */}
                  <div
                    className="flex items-center justify-center shrink-0 rounded-full text-[11px] font-semibold"
                    style={{
                      width: 28,
                      height: 28,
                      marginTop: 2,
                      background: msg.user_name === 'You'
                        ? 'var(--accent)'
                        : (AGENT_COLORS[getInitial(msg.user_name)] || 'var(--bg-elevated)'),
                      color: 'var(--text)',
                    }}
                  >
                    {getInitial(msg.user_name)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                        {msg.user_name}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                    <div
                      className="text-[13px] mt-0.5 whitespace-pre-wrap break-words"
                      style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            className="shrink-0 px-3 pb-3 relative"
          >
            {/* Mention popover */}
            {mentionQuery !== null && mentionOptions.length > 0 && (
              <div
                className="absolute left-3 right-3 glass-elevated rounded-lg overflow-hidden"
                style={{
                  bottom: '100%',
                  marginBottom: 4,
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {mentionOptions.map((opt, i) => (
                  <button
                    key={opt.id}
                    onClick={() => insertMention(opt)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                    style={{
                      background: i === mentionIndex ? 'rgba(255,255,255,0.06)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={() => setMentionIndex(i)}
                  >
                    <div
                      className="flex items-center justify-center rounded-full text-[10px] font-semibold"
                      style={{
                        width: 22,
                        height: 22,
                        background: opt.type === 'agent'
                          ? (AGENT_COLORS[getInitial(opt.name)] || 'var(--accent)')
                          : 'var(--bg-elevated)',
                        color: 'var(--text)',
                      }}
                    >
                      {getInitial(opt.name)}
                    </div>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>
                      {opt.name}
                    </span>
                    {opt.type === 'agent' && (
                      <span className="text-[10px] ml-auto" style={{ color: 'var(--text-dim)' }}>
                        AI Agent
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div
              className="flex items-end gap-2 glass-input"
              style={{
                padding: '8px 10px',
                borderRadius: 12,
              }}
            >
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={e => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 resize-none text-[13px] bg-transparent outline-none"
                style={{
                  color: 'var(--text)',
                  border: 'none',
                  minHeight: 20,
                  maxHeight: 80,
                  lineHeight: '20px',
                 
                }}
                rows={1}
                onInput={e => {
                  const t = e.currentTarget
                  t.style.height = '20px'
                  t.style.height = Math.min(t.scrollHeight, 80) + 'px'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!inputValue.trim() || sending}
                className="flex items-center justify-center shrink-0 rounded-md transition-all"
                style={{
                  width: 28,
                  height: 28,
                  background: inputValue.trim() ? 'var(--accent)' : 'transparent',
                  color: inputValue.trim() ? 'var(--text)' : 'var(--text-dim)',
                  border: 'none',
                  cursor: inputValue.trim() ? 'pointer' : 'default',
                  opacity: sending ? 0.5 : 1,
                }}
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
