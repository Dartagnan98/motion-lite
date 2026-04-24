'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { BlockEditor, parseContent, serializeBlocks, type Block } from '@/components/docs/BlockEditor'
import { useTabContext } from '@/components/AppShell'
import { ColorPicker } from '@/components/ui/ColorPicker'
import type { Task } from '@/lib/types'
import { TERMINAL_STATUSES, formatDuration } from '@/lib/task-constants'

interface BreadcrumbItem {
  label: string
  type: string
  id?: number
}

interface CalendarEvent {
  id: string
  title: string
  start_time: string
  end_time: string
  all_day: number
}

interface DocData {
  id: number
  public_id?: string
  title: string
  content: string
  workspace_id: number | null
  folder_id: number | null
  project_id: number | null
  color: string | null
  icon: string | null
  published: number
  publish_slug: string | null
  share_mode: string
  created_at: number
  updated_at: number
}

interface DocVersion {
  id: number
  doc_id: number
  title: string
  content: string
  created_at: number
  source: string
}

interface Comment {
  id: number
  doc_id: number
  block_id: string | null
  parent_comment_id: number | null
  author: string
  content: string
  resolved: number
  created_at: number
  replies?: Comment[]
}

interface Share {
  id: number
  doc_id: number
  email: string
  role: string
  created_at: number
}

const DOC_ICONS = ['doc', 'note', 'book', 'star', 'heart', 'flag', 'bolt', 'globe', 'code', 'chart']

export default function DocPage({ params }: { params: Promise<{ params: string[] }> }) {
  const [doc, setDoc] = useState<DocData | null>(null)
  const [title, setTitle] = useState('')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [parentColor, setParentColor] = useState<string | null>(null)
  const [showDocColorPicker, setShowDocColorPicker] = useState(false)
  const docColorTriggerRef = useRef<HTMLButtonElement>(null)

  // Panels
  const [activePanel, setActivePanel] = useState<'none' | 'versions' | 'comments' | 'share' | 'appearance' | 'toc'>('none')

  // Version history
  const [versions, setVersions] = useState<DocVersion[]>([])

  // AI Chat
  const [aiChatOpen, setAiChatOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResponse, setAiResponse] = useState('')

  // Comments
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')

  // Sharing
  const [shares, setShares] = useState<Share[]>([])
  const [shareEmail, setShareEmail] = useState('')
  const [shareRole, setShareRole] = useState('viewer')

  // Publishing
  const [publishUrl, setPublishUrl] = useState<string | null>(null)
  const [publishCopied, setPublishCopied] = useState(false)
  const [docLinkCopied, setDocLinkCopied] = useState(false)

  // Error feedback
  const [panelError, setPanelError] = useState<string | null>(null)

  // Agenda calendar (shown when doc is inside an Agenda folder)
  const [isAgendaDoc, setIsAgendaDoc] = useState(false)
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [calTasks, setCalTasks] = useState<Task[]>([])
  const [calDate, setCalDate] = useState(() => new Date())

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabCtx = useTabContext()

  useEffect(() => {
    params.then(p => {
      // URL: /doc/{docId} or /doc/{workspaceId}/{docId} -- doc ID is always last
      const segments = p.params
      setDocId(segments[segments.length - 1])
    })
  }, [params])

  useEffect(() => {
    if (!docId) return
    // Accept numeric ID or public_id
    fetch(`/api/docs?id=${docId}&breadcrumb=true`)
      .then(r => {
        if (!r.ok) {
          setNotFound(true)
          tabCtx?.setTabInfo('Not Found', 'doc')
          return null
        }
        return r.json()
      })
      .then((d: (DocData & { breadcrumb?: BreadcrumbItem[] }) | null) => {
        if (!d || !d.id) {
          setNotFound(true)
          tabCtx?.setTabInfo('Not Found', 'doc')
          return
        }
        setDoc(d)
        setParentColor((d as any).parentColor || null)
        const isUntitled = !d.title || d.title === 'Untitled Doc'
        setTitle(isUntitled ? '' : d.title)
        setBlocks(parseContent(d.content || ''))
        lastServerContent.current = d.content || ''
        tabCtx?.setTabInfo(isUntitled ? 'Untitled Doc' : d.title, 'doc')
        if (d.published && d.publish_slug) {
          setPublishUrl(`${window.location.origin}/published/${d.publish_slug}`)
        }
        if (d.breadcrumb) {
          const hasAgendaFolder = d.breadcrumb.some((b: BreadcrumbItem) => b.type === 'folder' && b.label === 'Agenda')
          setIsAgendaDoc(hasAgendaFolder)
        }
        // Refresh sidebar so newly created docs appear in the tree
        window.dispatchEvent(new CustomEvent('sidebar-refresh'))
      })
  }, [docId])

  // Listen for open-ai-chat event from slash commands
  useEffect(() => {
    function handleOpenAI() { setAiChatOpen(true) }
    window.addEventListener('open-ai-chat', handleOpenAI)
    return () => window.removeEventListener('open-ai-chat', handleOpenAI)
  }, [])

  // Track the last content we saved/parsed to avoid overwriting with identical content
  const lastServerContent = useRef<string | null>(null)

  // Poll for external changes (simple real-time sync)
  const docRef = useRef(doc)
  useEffect(() => { docRef.current = doc }, [doc])
  useEffect(() => {
    if (!doc || !doc.id) return
    const docId = doc.public_id || doc.id
    const interval = setInterval(async () => {
      const current = docRef.current
      if (!current) return
      const res = await fetch(`/api/docs?id=${docId}`)
      if (!res.ok) return
      const d = await res.json()
      if (d && d.id && d.updated_at > current.updated_at) {
        setDoc(d)
        // Only update blocks if content actually changed AND we're not actively saving
        const serverContent = d.content || ''
        if (!saveTimer.current && serverContent !== lastServerContent.current) {
          lastServerContent.current = serverContent
          setBlocks(parseContent(serverContent))
        }
      }
    }, 5000)
    return () => clearInterval(interval)
  // Stable deps: only re-register when the doc identity changes, not on every update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id])

  // Agenda calendar data fetching
  useEffect(() => {
    if (!isAgendaDoc) return
    const start = new Date(calDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(calDate)
    end.setHours(23, 59, 59, 999)
    fetch(`/api/calendar-events?start=${start.toISOString()}&end=${end.toISOString()}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCalEvents(d) })
      .catch(() => {})
    fetch('/api/tasks?all=1')
      .then(r => r.json())
      .then(d => setCalTasks(d.tasks || []))
      .catch(() => {})
  }, [isAgendaDoc, calDate])

  const calHours = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 6), [])
  const calToday = useMemo(() => new Date(), [])
  const calDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const calMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  function isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  }

  function formatTime12(date: Date) {
    let h = date.getHours()
    const m = date.getMinutes()
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return m === 0 ? `${h} ${ampm}` : `${h}:${m.toString().padStart(2, '0')} ${ampm}`
  }

  const scheduledCalTasks = useMemo(() => {
    return calTasks
      .filter(t => !TERMINAL_STATUSES.includes(t.status))
      .filter(t => t.scheduled_start && isSameDay(new Date(t.scheduled_start), calDate))
  }, [calTasks, calDate])

  const save = useCallback(async (t: string, b: Block[]) => {
    if (!doc || !doc.id) return
    setSaving(true)
    try {
      const res = await fetch('/api/docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doc.id, title: t || 'Untitled Doc', content: serializeBlocks(b) }),
      })
      if (!res.ok) {
        console.error('Save failed:', res.status)
        setSaving(false)
        return
      }
      const updated = await res.json()
      if (updated) setDoc(updated)
      lastServerContent.current = serializeBlocks(b)
      setSaving(false)
      setLastSaved(new Date())
      window.dispatchEvent(new CustomEvent('sidebar-refresh'))
    } catch (err) {
      console.error('Save error:', err)
      setSaving(false)
    }
  }, [doc])

  const debouncedSave = useCallback((t: string, b: Block[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { save(t, b); saveTimer.current = null }, 1000)
  }, [save])

  function handleTitleChange(val: string) {
    setTitle(val)
    const saveTitle = val || 'Untitled Doc'
    debouncedSave(val, blocks)
    tabCtx?.setTabInfo(saveTitle, 'doc')
    // Update breadcrumb last item (doc title) in real-time
    if (tabCtx?.breadcrumbs && tabCtx.breadcrumbs.length > 0) {
      const updated = [...tabCtx.breadcrumbs]
      updated[updated.length - 1] = { ...updated[updated.length - 1], label: saveTitle }
      tabCtx.setBreadcrumbs(updated)
    }
  }

  function handleBlocksChange(newBlocks: Block[]) {
    setBlocks(newBlocks)
    debouncedSave(title, newBlocks)
  }

  // Cmd+S
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save(title, blocks)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [title, blocks, save])

  // ─── Panel data loaders ───

  async function loadVersions() {
    if (!doc) return
    const res = await fetch(`/api/docs?id=${doc.public_id || doc.id}&versions=true`)
    const data = await res.json()
    if (Array.isArray(data)) setVersions(data)
  }

  async function loadComments() {
    if (!doc) return
    const res = await fetch(`/api/docs/comments?docId=${doc.public_id || doc.id}`)
    const data = await res.json()
    if (Array.isArray(data)) setComments(data)
  }

  async function loadShares() {
    if (!doc) return
    const res = await fetch(`/api/docs/share?docId=${doc.public_id || doc.id}`)
    const data = await res.json()
    if (Array.isArray(data)) setShares(data)
  }

  function openPanel(panel: typeof activePanel) {
    if (activePanel === panel) {
      setActivePanel('none')
      return
    }
    setActivePanel(panel)
    if (panel === 'versions') loadVersions()
    if (panel === 'comments') loadComments()
    if (panel === 'share') loadShares()
  }

  async function restoreVersion(version: DocVersion) {
    if (!doc) return
    try {
      const res = await fetch('/api/docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doc.id, title: version.title, content: version.content }),
      })
      if (!res.ok) { setPanelError('Failed to restore version'); return }
      const updated = await res.json()
      if (updated) setDoc(updated)
      setTitle(version.title || '')
      setBlocks(parseContent(version.content))
      lastServerContent.current = version.content
      setActivePanel('none')
      setLastSaved(new Date())
      window.dispatchEvent(new CustomEvent('sidebar-refresh'))
    } catch { setPanelError('Failed to restore version') }
  }

  // ─── Comments ───

  async function submitComment() {
    if (!doc || !newComment.trim()) return
    try {
      const res = await fetch('/api/docs/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id, content: newComment }),
      })
      if (!res.ok) { setPanelError('Failed to add comment'); return }
      setNewComment('')
      loadComments()
    } catch { setPanelError('Failed to add comment') }
  }

  async function submitReply(parentId: number) {
    if (!doc || !replyText.trim()) return
    try {
      const res = await fetch('/api/docs/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id, parentCommentId: parentId, content: replyText }),
      })
      if (!res.ok) { setPanelError('Failed to add reply'); return }
      setReplyText('')
      setReplyTo(null)
      loadComments()
    } catch { setPanelError('Failed to add reply') }
  }

  async function resolveComment(id: number) {
    try {
      const res = await fetch('/api/docs/comments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'resolve' }),
      })
      if (!res.ok) { setPanelError('Failed to resolve comment'); return }
      loadComments()
    } catch { setPanelError('Failed to resolve comment') }
  }

  // ─── Sharing ───

  async function addShare() {
    if (!doc || !shareEmail.trim()) return
    try {
      const res = await fetch('/api/docs/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id, email: shareEmail, role: shareRole }),
      })
      if (!res.ok) { setPanelError('Failed to share doc'); return }
      setShareEmail('')
      loadShares()
    } catch { setPanelError('Failed to share doc') }
  }

  async function removeShare(email: string) {
    if (!doc) return
    try {
      const res = await fetch(`/api/docs/share?docId=${doc.public_id || doc.id}&email=${encodeURIComponent(email)}`, { method: 'DELETE' })
      if (!res.ok) { setPanelError('Failed to remove share'); return }
      loadShares()
    } catch { setPanelError('Failed to remove share') }
  }

  // ─── Publishing ───

  async function togglePublish() {
    if (!doc) return
    setPanelError(null)
    try {
      if (doc.published) {
        const res = await fetch('/api/docs/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: doc.id, action: 'unpublish' }),
        })
        if (!res.ok) { setPanelError('Failed to unpublish'); return }
        setPublishUrl(null)
        setDoc({ ...doc, published: 0, publish_slug: null })
      } else {
        const res = await fetch('/api/docs/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: doc.id }),
        })
        if (!res.ok) { setPanelError('Failed to publish'); return }
        const data = await res.json()
        if (data.slug) {
          const url = `${window.location.origin}/published/${data.slug}`
          setPublishUrl(url)
          setDoc({ ...doc, published: 1, publish_slug: data.slug })
        } else {
          setPanelError('Publish failed - no URL generated')
        }
      }
    } catch { setPanelError('Publish operation failed') }
  }

  function copyPublishUrl() {
    if (publishUrl) {
      navigator.clipboard.writeText(publishUrl)
      setPublishCopied(true)
      setTimeout(() => setPublishCopied(false), 2000)
    }
  }

  // ─── Appearance ───

  async function setDocColor(color: string | null) {
    if (!doc) return
    try {
      const res = await fetch('/api/docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doc.id, color }),
      })
      if (!res.ok) { setPanelError('Failed to update color'); return }
      setDoc({ ...doc, color })
      window.dispatchEvent(new CustomEvent('sidebar-refresh'))
    } catch { setPanelError('Failed to update color') }
  }

  async function setDocIcon(icon: string | null) {
    if (!doc) return
    try {
      const res = await fetch('/api/docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doc.id, icon }),
      })
      if (!res.ok) { setPanelError('Failed to update icon'); return }
      setDoc({ ...doc, icon })
      window.dispatchEvent(new CustomEvent('sidebar-refresh'))
    } catch { setPanelError('Failed to update icon') }
  }

  // ─── AI Chat ───

  async function handleAiSubmit() {
    if (!aiPrompt.trim() || aiLoading || !doc) return
    setAiLoading(true)
    setAiResponse('')
    try {
      const res = await fetch('/api/docs/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id, prompt: aiPrompt }),
      })
      const data = await res.json()
      if (data.text) setAiResponse(data.text)
      if (data.error) setAiResponse(`Error: ${data.error}`)
    } catch {
      setAiResponse('Failed to get AI response')
    }
    setAiLoading(false)
  }

  async function handleAiAction(action: string) {
    if (aiLoading || !doc) return
    setAiLoading(true)
    setAiResponse('')
    try {
      const sel = window.getSelection()
      const selectedText = sel?.toString() || ''
      const res = await fetch('/api/docs/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id, action, selectedText, prompt: '' }),
      })
      const data = await res.json()
      if (data.text) setAiResponse(data.text)
      if (data.error) setAiResponse(`Error: ${data.error}`)
    } catch {
      setAiResponse('Failed to get AI response')
    }
    setAiLoading(false)
  }

  function applyAiDraft() {
    if (!aiResponse) return
    const lines = aiResponse.split('\n')
    const newBlocks: Block[] = []
    for (const line of lines) {
      const id = Math.random().toString(36).slice(2, 10)
      if (line.startsWith('# ')) newBlocks.push({ id, type: 'heading1', content: line.slice(2) })
      else if (line.startsWith('## ')) newBlocks.push({ id, type: 'heading2', content: line.slice(3) })
      else if (line.startsWith('### ')) newBlocks.push({ id, type: 'heading3', content: line.slice(4) })
      else if (line.startsWith('- ')) newBlocks.push({ id, type: 'bulleted_list', content: line.slice(2) })
      else if (/^\d+\.\s/.test(line)) newBlocks.push({ id, type: 'numbered_list', content: line.replace(/^\d+\.\s/, '') })
      else if (line.trim()) newBlocks.push({ id, type: 'paragraph', content: line })
    }
    if (newBlocks.length > 0) {
      const combined = [...blocks, ...newBlocks]
      setBlocks(combined)
      debouncedSave(title, combined)
      setAiResponse('')
      setAiPrompt('')
    }
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-text-dim text-sm">{notFound ? 'Document not found' : 'Loading...'}</div>
      </div>
    )
  }

  const wordCount = blocks.reduce((acc, b) => {
    const text = b.content?.replace(/<[^>]*>/g, '') || ''
    return acc + (text.trim() ? text.trim().split(/\s+/).length : 0)
  }, 0)

  const unresolvedCount = comments.filter(c => !c.resolved && !c.parent_comment_id).length

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        {/* Main editor area */}
        <div className="flex-1 overflow-auto">
          <div className={`mx-auto px-1 py-2 doc-content-area ${isAgendaDoc ? 'max-w-[680px] sm:px-16 sm:py-12' : 'max-w-5xl sm:px-10 sm:py-8'}`}>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-6 text-[14px] text-text-dim flex-wrap gap-y-2">
              <div className="flex items-center gap-2">
                {/* Doc icon */}
                <button
                  onClick={() => openPanel('appearance')}
                  className="flex items-center gap-1 hover:text-text transition-colors"
                  title="Change appearance"
                >
                  <DocIcon icon={doc.icon} color={doc.color || parentColor} size={16} />
                </button>
                {doc.published && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider bg-accent text-white font-bold">
                    Published
                  </span>
                )}
                {doc.share_mode !== 'private' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider bg-blue-500/10 text-blue-400">
                    Shared
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {saving && <span>Saving...</span>}
                {!saving && lastSaved && (
                  <span>Saved {lastSaved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                )}
                <span>{wordCount} words</span>
                <div className="w-px h-3 bg-border mx-1" />

                {/* Comments */}
                <button
                  onClick={() => openPanel('comments')}
                  className={`doc-toolbar-btn${activePanel === 'comments' ? ' active' : ''}`}
                  title="Comments"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                  {unresolvedCount > 0 ? `Comments (${unresolvedCount})` : 'Comments'}
                </button>

                {/* Share */}
                <button
                  onClick={() => openPanel('share')}
                  className={`doc-toolbar-btn${activePanel === 'share' ? ' active' : ''}`}
                  title="Share & Publish"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
                    <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
                    <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M5.7 7l4.6-2M5.7 9l4.6 2" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                  Share
                </button>

                {/* Version history */}
                <button
                  onClick={() => openPanel('versions')}
                  className={`doc-toolbar-btn${activePanel === 'versions' ? ' active' : ''}`}
                  title="Version history"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  History
                </button>

                {/* Table of contents */}
                <button
                  onClick={() => openPanel('toc')}
                  className={`doc-toolbar-btn${activePanel === 'toc' ? ' active' : ''}`}
                  title="Table of contents"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  TOC
                </button>

                {/* AI */}
                <button
                  onClick={() => setAiChatOpen(!aiChatOpen)}
                  className={`doc-toolbar-btn${aiChatOpen ? ' active' : ''}`}
                  title="AI assistant"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1l1.8 5.4L15 8l-5.2 1.6L8 15l-1.8-5.4L1 8l5.2-1.6L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                  AI
                </button>
              </div>
            </div>

            {/* Title */}
            {isAgendaDoc ? (
              <div className="mb-6 pl-[44px]">
                {/* Day label: "SATURDAY" */}
                <div className="agenda-day-label">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}
                </div>
                {/* Date: "April 4" */}
                <div className="agenda-day-date">
                  {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                </div>
              </div>
            ) : (
              <textarea
                autoFocus
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const firstBlock = document.querySelector('[contenteditable]') as HTMLElement
                    if (firstBlock) firstBlock.focus()
                  }
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = target.scrollHeight + 'px'
                }}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto'
                    el.style.height = el.scrollHeight + 'px'
                  }
                }}
                rows={1}
                style={{ fontSize: '40px', lineHeight: '1.1', fontWeight: 700, resize: 'none', overflow: 'hidden' }}
                className="doc-title-input w-full bg-transparent text-text outline-none placeholder:text-text-dim/30 mb-4 pl-[44px]"
                placeholder="New doc"
              />
            )}

            {/* Block editor */}
            {isAgendaDoc ? (
              <div className="pl-[44px]">
                <div className="agenda-section-label">Today&apos;s Tasks</div>
                {blocks.length === 0 || blocks.every(b => {
                  const text = (b.content || '').replace(/<[^>]*>/g, '').trim().toLowerCase()
                  return !text || text === "today's tasks" || text === 'no tasks scheduled for today.' || text === 'no tasks scheduled for today'
                }) ? (
                  <div className="agenda-empty">
                    <svg className="agenda-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.4"/>
                      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.4"/>
                      <path d="M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      <path d="M8 14l2.5 2.5L16 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="agenda-empty-text">Nothing scheduled for today.</span>
                    <span className="agenda-empty-link" onClick={() => window.dispatchEvent(new CustomEvent('open-calendar'))}>+ Add a task</span>
                  </div>
                ) : (
                  <BlockEditor
                    blocks={blocks}
                    onChange={handleBlocksChange}
                    workspaceId={doc.workspace_id}
                    docId={doc.id}
                    projectId={doc.project_id}
                  />
                )}
              </div>
            ) : (
              <BlockEditor
                blocks={blocks}
                onChange={handleBlocksChange}
                workspaceId={doc.workspace_id}
                docId={doc.id}
                projectId={doc.project_id}
              />
            )}
          </div>
        </div>

        {/* Right sidebar panel */}
        {activePanel !== 'none' && (
          <div className="w-[320px] border-l border-border bg-card flex flex-col shrink-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="text-[14px] font-semibold text-text">
                {activePanel === 'versions' && 'Version History'}
                {activePanel === 'comments' && 'Comments'}
                {activePanel === 'share' && 'Share & Publish'}
                {activePanel === 'appearance' && 'Appearance'}
                {activePanel === 'toc' && 'Table of Contents'}
              </h3>
              <button onClick={() => setActivePanel('none')} className="text-text-dim hover:text-text">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Error banner */}
              {panelError && (
                <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between">
                  <span className="text-[13px] text-red-400">{panelError}</span>
                  <button onClick={() => setPanelError(null)} className="text-red-400 hover:text-red-300 text-[10px]">Dismiss</button>
                </div>
              )}
              {/* ─── Version History ─── */}
              {activePanel === 'versions' && (
                versions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-text-dim">
                    No previous versions yet.
                  </div>
                ) : (
                  versions.map(v => (
                    <div key={v.id} className="border-b border-border px-4 py-3 hover:bg-hover transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-text">
                          {new Date(v.created_at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                        <span className="text-[10px] uppercase font-medium text-text-dim px-1.5 py-0.5 rounded bg-elevated">{v.source}</span>
                      </div>
                      <p className="text-[10px] text-text-dim mt-1 truncate">{v.title}</p>
                      <button onClick={() => restoreVersion(v)} className="mt-2 text-[10px] text-accent-text hover:underline">
                        Restore this version
                      </button>
                    </div>
                  ))
                )
              )}

              {/* ─── Comments ─── */}
              {activePanel === 'comments' && (
                <div>
                  {/* New comment input */}
                  <div className="px-4 py-3 border-b border-border">
                    <textarea
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitComment() } }}
                      placeholder="Add a comment..."
                      className="w-full bg-elevated border border-border rounded px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim resize-none h-16"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={submitComment}
                        disabled={!newComment.trim()}
                        className="px-3 py-1 rounded text-[13px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
                      >
                        Comment
                      </button>
                    </div>
                  </div>

                  {comments.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-text-dim">
                      No comments yet.
                    </div>
                  ) : (
                    comments.map(c => (
                      <div key={c.id} className={`border-b border-border px-4 py-3 ${c.resolved ? 'opacity-50' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-medium text-text">{c.author}</span>
                          <span className="text-[10px] text-text-dim">
                            {new Date(c.created_at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[13px] text-text-secondary mt-1">{c.content}</p>

                        {/* Replies */}
                        {c.replies && c.replies.length > 0 && (
                          <div className="mt-2 ml-3 border-l-2 border-border pl-3 space-y-2">
                            {c.replies.map(r => (
                              <div key={r.id}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-medium text-text">{r.author}</span>
                                  <span className="text-[10px] text-text-dim">
                                    {new Date(r.created_at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-[13px] text-text-secondary">{r.content}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-2">
                          {!c.resolved && (
                            <>
                              <button
                                onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                                className="text-[10px] text-text-dim hover:text-text transition-colors"
                              >
                                Reply
                              </button>
                              <button
                                onClick={() => resolveComment(c.id)}
                                className="text-[10px] text-text-dim hover:text-accent-text transition-colors"
                              >
                                Resolve
                              </button>
                            </>
                          )}
                        </div>

                        {/* Reply input */}
                        {replyTo === c.id && (
                          <div className="mt-2 flex gap-2">
                            <input
                              autoFocus
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitReply(c.id) } }}
                              placeholder="Reply..."
                              className="flex-1 bg-elevated border border-border rounded px-2 py-1 text-[13px] text-text outline-none placeholder:text-text-dim"
                            />
                            <button
                              onClick={() => submitReply(c.id)}
                              className="px-2 py-1 rounded text-[10px] bg-accent text-white"
                            >
                              Send
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ─── Share & Publish ─── */}
              {activePanel === 'share' && (
                <div>
                  {/* Publishing */}
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[13px] font-medium text-text">Publish</span>
                      <button
                        onClick={togglePublish}
                        className={`relative w-10 h-5 rounded-full transition-colors ${doc.published ? 'bg-accent' : 'bg-border-strong'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform`} style={{ left: doc.published ? '22px' : '2px' }} />
                      </button>
                    </div>
                    <p className="text-[10px] text-text-dim">
                      {doc.published ? 'Anyone with the link can view this doc (read-only).' : 'Generate a public link for external viewing.'}
                    </p>
                    {publishUrl && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          readOnly
                          value={publishUrl}
                          className="flex-1 bg-elevated border border-border rounded px-2 py-1 text-[10px] text-text-secondary outline-none"
                        />
                        <button
                          onClick={copyPublishUrl}
                          className="px-2 py-1 rounded text-[10px] bg-elevated hover:bg-hover border border-border text-text-secondary"
                        >
                          {publishCopied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Sharing */}
                  <div className="px-4 py-3">
                    <span className="text-[13px] font-medium text-text">Share with people</span>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        value={shareEmail}
                        onChange={e => setShareEmail(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addShare() }}
                        placeholder="Email address"
                        className="flex-1 bg-elevated border border-border rounded px-2 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim"
                      />
                      <Dropdown
                        value={shareRole}
                        onChange={(v) => setShareRole(v)}
                        options={[
                          { label: 'Viewer', value: 'viewer' },
                          { label: 'Editor', value: 'editor' },
                          { label: 'Full Access', value: 'full_access' },
                        ]}
                        triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                        minWidth={140}
                      />
                      <button
                        onClick={addShare}
                        disabled={!shareEmail.trim()}
                        className="px-3 py-1.5 rounded text-[13px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>

                    {/* Current shares */}
                    {shares.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {shares.map(s => (
                          <div key={s.id} className="flex items-center justify-between py-1.5">
                            <div>
                              <span className="text-[13px] text-text">{s.email}</span>
                              <span className="text-[10px] text-text-dim ml-2 capitalize">{s.role.replace('_', ' ')}</span>
                            </div>
                            <button
                              onClick={() => removeShare(s.email)}
                              className="text-[10px] text-red-400 hover:text-red-300"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Copy doc link */}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.href)
                        setDocLinkCopied(true)
                        setTimeout(() => setDocLinkCopied(false), 2000)
                      }}
                      className="mt-3 flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                      {docLinkCopied ? 'Link copied!' : 'Copy link to doc'}
                    </button>
                  </div>
                </div>
              )}

              {/* ─── Appearance ─── */}
              {activePanel === 'appearance' && (
                <div className="px-4 py-3">
                  {/* Color */}
                  <div className="mb-4">
                    <button
                      ref={docColorTriggerRef}
                      onClick={() => setShowDocColorPicker(!showDocColorPicker)}
                      className="flex items-center gap-2 text-[13px] font-medium text-text hover:text-text-secondary transition-colors"
                    >
                      <span
                        className="w-5 h-5 rounded-full border border-border shrink-0"
                        style={{ backgroundColor: doc.color || parentColor || 'var(--elevated)' }}
                      />
                      Color
                      {!doc.color && parentColor && <span className="text-[10px] text-text-dim ml-1">(inherited)</span>}
                    </button>
                    {showDocColorPicker && (
                      <ColorPicker
                        currentColor={doc.color || parentColor}
                        onSelect={(color) => {
                          setDocColor(color)
                          setShowDocColorPicker(false)
                        }}
                        onClear={() => {
                          setDocColor(null)
                          setShowDocColorPicker(false)
                        }}
                        onClose={() => setShowDocColorPicker(false)}
                        anchorRef={docColorTriggerRef}
                      />
                    )}
                  </div>

                  {/* Icon */}
                  <div>
                    <span className="text-[13px] font-medium text-text">Icon</span>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        onClick={() => setDocIcon(null)}
                        className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[10px] ${!doc.icon ? 'border-accent text-accent-text' : 'border-border text-text-dim'} hover:bg-hover transition-colors`}
                      >
                        x
                      </button>
                      {DOC_ICONS.map(ic => (
                        <button
                          key={ic}
                          onClick={() => setDocIcon(ic)}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center ${doc.icon === ic ? 'border-accent bg-accent/10' : 'border-border'} hover:bg-hover transition-colors`}
                        >
                          <DocIconSvg icon={ic} size={16} color={doc.color || parentColor || undefined} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activePanel === 'toc' && (
                <div className="px-4 py-3 space-y-1">
                  {blocks.filter(b => b.type === 'heading1' || b.type === 'heading2' || b.type === 'heading3').length === 0 ? (
                    <p className="text-[13px] text-text-dim py-4 text-center">No headings in this document yet.</p>
                  ) : (
                    blocks.filter(b => b.type === 'heading1' || b.type === 'heading2' || b.type === 'heading3').map(b => {
                      const indent = b.type === 'heading2' ? 'pl-4' : b.type === 'heading3' ? 'pl-8' : ''
                      const size = b.type === 'heading1' ? 'text-[13px] font-semibold' : b.type === 'heading2' ? 'text-[13px] font-medium' : 'text-[10px]'
                      return (
                        <button
                          key={b.id}
                          onClick={() => {
                            const el = document.querySelector(`[data-block-id="${b.id}"]`) as HTMLElement
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }}
                          className={`block w-full text-left py-1.5 px-2 rounded hover:bg-hover text-text-secondary hover:text-text transition-colors truncate ${indent} ${size}`}
                        >
                          {b.content?.replace(/<[^>]*>/g, '') || 'Untitled'}
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Agenda Day Calendar (only for agenda docs) */}
        {isAgendaDoc && activePanel === 'none' && (
          <div className="hidden sm:block w-[300px] border-l border-border overflow-y-auto shrink-0">
            <div className="sticky top-0 bg-bg z-10 px-5 pt-5 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {isSameDay(calDate, calToday) && (
                    <span className="text-[13px] text-white font-bold bg-accent px-2 py-0.5 rounded">Today</span>
                  )}
                  <span className="text-[13px] font-medium text-text">
                    {calDayNames[calDate.getDay()]} {calMonthNames[calDate.getMonth()]} {calDate.getDate()}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => setCalDate(prev => { const n = new Date(prev); n.setDate(n.getDate() - 1); return n })}
                    className="p-1.5 rounded hover:bg-hover transition-colors text-text-secondary hover:text-text"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                  <button
                    onClick={() => setCalDate(prev => { const n = new Date(prev); n.setDate(n.getDate() + 1); return n })}
                    className="p-1.5 rounded hover:bg-hover transition-colors text-text-secondary hover:text-text"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <div className="px-5 pb-5">
              <div className="relative" style={{ height: `${calHours.length * 60}px` }}>
                {calHours.map((hour, i) => (
                  <div key={hour} className="absolute w-full flex items-start" style={{ top: `${i * 60}px` }}>
                    <span className="agenda-time-label w-12 text-right pr-2 -mt-1.5 select-none">
                      {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                    </span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                ))}

                {calEvents.filter(e => !e.all_day).map(event => {
                  const start = new Date(event.start_time)
                  const end = new Date(event.end_time)
                  const startMin = start.getHours() * 60 + start.getMinutes()
                  const endMin = end.getHours() * 60 + end.getMinutes()
                  const gridStart = 6 * 60
                  const top = ((startMin - gridStart) / 60) * 60
                  const height = Math.max(((endMin - startMin) / 60) * 60, 20)
                  if (startMin < gridStart || top < 0) return null
                  return (
                    <div key={event.id} className="absolute rounded-md px-2 py-1 overflow-hidden" style={{ top: `${top}px`, left: '52px', right: '4px', height: `${height}px`, background: 'rgba(66, 133, 244, 0.15)', borderLeft: '3px solid #4285f4' }}>
                      <p className="text-[10px] font-medium text-[#4285f4] truncate">{event.title}</p>
                      <p className="text-[10px] text-[#4285f4]/60">{formatTime12(start)} - {formatTime12(end)}</p>
                    </div>
                  )
                })}

                {scheduledCalTasks.map(task => {
                  if (!task.scheduled_start) return null
                  const start = new Date(task.scheduled_start)
                  const startMin = start.getHours() * 60 + start.getMinutes()
                  const dur = task.duration_minutes || 30
                  const gridStart = 6 * 60
                  const top = ((startMin - gridStart) / 60) * 60
                  const height = Math.max((dur / 60) * 60, 20)
                  if (startMin < gridStart || top < 0) return null
                  return (
                    <div key={`task-${task.id}`} className="absolute rounded-md px-2 py-1 overflow-hidden" style={{ top: `${top}px`, left: '52px', right: '4px', height: `${height}px`, background: 'rgba(18, 56, 46, 0.15)', borderLeft: '3px solid var(--accent)' }}>
                      <p className="text-[10px] font-medium text-accent-text truncate">{task.title}</p>
                      <p className="text-[10px] text-accent-text/60">{formatTime12(start)} - {formatDuration(dur)}</p>
                    </div>
                  )
                })}

                {isSameDay(calDate, calToday) && (() => {
                  const now = new Date()
                  const nowMin = now.getHours() * 60 + now.getMinutes()
                  const gridStart = 6 * 60
                  const top = ((nowMin - gridStart) / 60) * 60
                  if (top < 0 || nowMin < gridStart) return null
                  return (
                    <div className="absolute w-full" style={{ top: `${top}px`, left: '48px' }}>
                      <div className="flex items-center">
                        <div className="agenda-now-dot w-2 h-2 rounded-full -ml-1" />
                        <div className="agenda-now-line flex-1 border-t" />
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI Chat Bar */}
      {aiChatOpen && (
        <div className="border-t border-border bg-card shrink-0">
          {aiResponse && (
            <div className="px-6 py-3 border-b border-border max-h-[200px] overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] text-text-secondary whitespace-pre-wrap flex-1">{aiResponse}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={applyAiDraft} className="px-2.5 py-1 rounded text-[10px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors">
                    Insert into doc
                  </button>
                  <button onClick={() => setAiResponse('')} className="px-2 py-1 rounded text-[10px] text-text-dim hover:text-text hover:bg-hover transition-colors">
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-6 pt-2 pb-1">
            <span className="text-[10px] font-medium text-text-dim uppercase tracking-wider mr-1">AI:</span>
            {['Summarize', 'Rewrite', 'Expand', 'Shorten'].map(action => (
              <button
                key={action}
                onClick={() => handleAiAction(action.toLowerCase())}
                disabled={aiLoading}
                className="px-2 py-0.5 rounded text-[10px] text-text-secondary border border-border hover:bg-hover hover:text-text transition-colors disabled:opacity-40"
              >
                {action}
              </button>
            ))}
            <button
              onClick={() => {
                const role = window.prompt('Get feedback as what role?', 'marketer')
                if (role) {
                  setAiLoading(true)
                  setAiResponse('')
                  fetch('/api/docs/ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ docId: doc.id, action: 'critique', prompt: role }),
                  }).then(r => r.json()).then(data => {
                    if (data.text) setAiResponse(data.text)
                    if (data.error) setAiResponse(`Error: ${data.error}`)
                  }).catch(() => setAiResponse('Failed to get AI response')).finally(() => setAiLoading(false))
                }
              }}
              disabled={aiLoading}
              className="px-2 py-0.5 rounded text-[10px] text-text-secondary border border-border hover:bg-hover hover:text-text transition-colors disabled:opacity-40"
            >
              Critique as...
            </button>
          </div>
          <div className="flex items-center gap-2 px-6 py-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-accent-text shrink-0">
              <path d="M8 1l1.8 5.4L15 8l-5.2 1.6L8 15l-1.8-5.4L1 8l5.2-1.6L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <input
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSubmit() } }}
              placeholder="Ask AI to write, edit, or improve this doc..."
              className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim"
              disabled={aiLoading}
            />
            <button
              onClick={handleAiSubmit}
              disabled={!aiPrompt.trim() || aiLoading}
              className="px-3 py-1 rounded text-[13px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
            >
              {aiLoading ? 'Thinking...' : 'Send'}
            </button>
            <button onClick={() => { setAiChatOpen(false); setAiResponse(''); setAiPrompt('') }} className="text-text-dim hover:text-text transition-colors">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="doc-status-bar flex items-center justify-between shrink-0">
        <span>Doc #{doc.id}</span>
        <div className="flex items-center gap-3">
          <span>Created {new Date(doc.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          {!aiChatOpen && (
            <button onClick={() => setAiChatOpen(true)} className="flex items-center gap-1 text-text-dim hover:text-accent-text transition-colors">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 1l1.8 5.4L15 8l-5.2 1.6L8 15l-1.8-5.4L1 8l5.2-1.6L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              AI
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Doc Icon Components ───

function DocIcon({ icon, color, size = 16 }: { icon: string | null; color: string | null; size?: number }) {
  if (!icon) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke={color || 'currentColor'} strokeWidth="1.3" />
        <path d="M9 2v4h4" stroke={color || 'currentColor'} strokeWidth="1.3" />
      </svg>
    )
  }
  return <DocIconSvg icon={icon} size={size} color={color || undefined} />
}

function DocIconSvg({ icon, size = 16, color }: { icon: string; size?: number; color?: string }) {
  const c = color || 'currentColor'
  switch (icon) {
    case 'doc':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke={c} strokeWidth="1.3" /><path d="M9 2v4h4" stroke={c} strokeWidth="1.3" /></svg>
    case 'note':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke={c} strokeWidth="1.3" /><path d="M5.5 5.5h5M5.5 8h3" stroke={c} strokeWidth="1" strokeLinecap="round" /></svg>
    case 'book':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M3 12.5V3a1 1 0 011-1h8a1 1 0 011 1v10H4.5a1.5 1.5 0 010-3H12" stroke={c} strokeWidth="1.3" strokeLinejoin="round" /></svg>
    case 'star':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 4.5H14l-3.5 2.7 1.3 4.3L8 10.8l-3.8 2.7 1.3-4.3L2 6.5h4.5L8 2z" stroke={c} strokeWidth="1.2" strokeLinejoin="round" /></svg>
    case 'heart':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M8 13.5S2 10 2 6a3 3 0 016 0 3 3 0 016 0c0 4-6 7.5-6 7.5z" stroke={c} strokeWidth="1.3" /></svg>
    case 'flag':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M3 14V2m0 0l10 4.5L3 9" stroke={c} strokeWidth="1.3" strokeLinejoin="round" /></svg>
    case 'bolt':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" stroke={c} strokeWidth="1.2" strokeLinejoin="round" /></svg>
    case 'globe':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke={c} strokeWidth="1.3" /><path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12" stroke={c} strokeWidth="1" /></svg>
    case 'code':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M5 4L2 8l3 4M11 4l3 4-3 4" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'chart':
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><rect x="2" y="8" width="3" height="6" rx="0.5" stroke={c} strokeWidth="1.2" /><rect x="6.5" y="5" width="3" height="9" rx="0.5" stroke={c} strokeWidth="1.2" /><rect x="11" y="2" width="3" height="12" rx="0.5" stroke={c} strokeWidth="1.2" /></svg>
    default:
      return <svg width={size} height={size} viewBox="0 0 16 16" fill="none"><path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke={c} strokeWidth="1.3" /><path d="M9 2v4h4" stroke={c} strokeWidth="1.3" /></svg>
  }
}
