'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { crmFetch } from '@/lib/crm-browser'

export type SnippetChannel = 'sms' | 'email' | 'internal'

export interface SnippetContact {
  name?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
}

export interface Snippet {
  id: number
  name: string
  channel: SnippetChannel
  subject: string | null
  body: string
}

/**
 * Hook that turns a textarea into a slash-command snippet launcher.
 * Type `/` at the start of a line or after a space, then letters to filter
 * templates by name. Arrow keys navigate, Enter inserts, Escape closes.
 *
 * Interpolation mirrors the workflow runner conventions:
 *   {{contact.first_name}} {{contact.last_name}} {{contact.email}}
 *   {{contact.phone}} {{contact.company}} {{contact.name}}
 *
 * The consumer renders the returned <SnippetMenu/> anywhere (absolute-positioned
 * on top of the textarea works well). Hooks up naturally to existing composers
 * without changing their send flow.
 */
export function useSnippetPicker(options: {
  channel: SnippetChannel
  text: string
  setText: (next: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  contact: SnippetContact | null | undefined
}) {
  const { channel, text, setText, textareaRef, contact } = options

  const [snippets, setSnippets] = useState<Snippet[]>([])
  const loadedForChannel = useRef<SnippetChannel | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [cursorAnchor, setCursorAnchor] = useState<{ slashPos: number; caret: number } | null>(null)

  // Fetch once per channel
  useEffect(() => {
    if (loadedForChannel.current === channel) return
    loadedForChannel.current = channel
    crmFetch<Snippet[]>(`/api/crm/message-templates?channel=${channel}`)
      .then(setSnippets)
      .catch(() => setSnippets([]))
  }, [channel])

  // Derive whether we're in snippet mode based on cursor position in text
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? text.length
    const before = text.slice(0, caret)
    // Find the start of the current "word" — last whitespace or start-of-string
    const wordStart = Math.max(
      before.lastIndexOf(' '),
      before.lastIndexOf('\n'),
      before.lastIndexOf('\t'),
    ) + 1
    const word = before.slice(wordStart)
    if (word.startsWith('/') && !word.includes(' ')) {
      setQuery(word.slice(1))
      setCursorAnchor({ slashPos: wordStart, caret })
      setSelectedIdx(0)
    } else {
      setQuery(null)
      setCursorAnchor(null)
    }
  }, [text, textareaRef])

  const matches = useMemo(() => {
    if (query === null) return []
    const q = query.toLowerCase()
    return snippets
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [snippets, query])

  function interpolate(body: string): string {
    if (!contact) return body
    const [firstName, ...rest] = (contact.name || '').trim().split(/\s+/)
    return body
      .replace(/\{\{\s*contact\.first_name\s*\}\}/g, firstName || '')
      .replace(/\{\{\s*contact\.last_name\s*\}\}/g, rest.join(' '))
      .replace(/\{\{\s*contact\.name\s*\}\}/g, contact.name || '')
      .replace(/\{\{\s*contact\.email\s*\}\}/g, contact.email || '')
      .replace(/\{\{\s*contact\.phone\s*\}\}/g, contact.phone || '')
      .replace(/\{\{\s*contact\.company\s*\}\}/g, contact.company || '')
  }

  function insertSnippet(snippet: Snippet) {
    if (!cursorAnchor) return
    const before = text.slice(0, cursorAnchor.slashPos)
    const after = text.slice(cursorAnchor.caret)
    const body = interpolate(snippet.body)
    const next = `${before}${body}${after}`
    setText(next)
    setQuery(null)
    setCursorAnchor(null)
    // Put caret just after the inserted body
    queueMicrotask(() => {
      const ta = textareaRef.current
      if (!ta) return
      const pos = before.length + body.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null || matches.length === 0) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIdx((i) => Math.min(matches.length - 1, i + 1))
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIdx((i) => Math.max(0, i - 1))
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const pick = matches[selectedIdx] ?? matches[0]
      if (pick) insertSnippet(pick)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery(null)
      setCursorAnchor(null)
      return true
    }
    return false
  }

  const menu = query !== null && matches.length > 0 ? (
    <SnippetMenu matches={matches} selectedIdx={selectedIdx} onPick={insertSnippet} />
  ) : null

  return { menu, onKeyDown, open: query !== null && matches.length > 0 }
}

function SnippetMenu({
  matches,
  selectedIdx,
  onPick,
}: {
  matches: Snippet[]
  selectedIdx: number
  onPick: (snippet: Snippet) => void
}) {
  return (
    <div
      role="listbox"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0, right: 0,
        maxHeight: 240,
        overflowY: 'auto',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
        padding: 6,
        zIndex: 40,
      }}
    >
      <div style={{
        padding: '4px 8px 6px',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}>
        Templates · {matches.length} match{matches.length === 1 ? '' : 'es'} · ↵ insert
      </div>
      {matches.map((snippet, i) => (
        <button
          key={snippet.id}
          onMouseDown={(e) => { e.preventDefault(); onPick(snippet) }}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '7px 10px',
            borderRadius: 7,
            border: 'none',
            cursor: 'pointer',
            background: i === selectedIdx ? 'var(--bg-elevated)' : 'transparent',
            color: 'var(--text)',
            display: 'flex', flexDirection: 'column', gap: 2,
            transition: 'background 120ms ease',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>{snippet.name}</span>
          <span style={{
            fontSize: 11, color: 'var(--text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {snippet.subject ? `${snippet.subject} — ` : ''}{snippet.body.replace(/\s+/g, ' ').slice(0, 80)}
          </span>
        </button>
      ))}
    </div>
  )
}
