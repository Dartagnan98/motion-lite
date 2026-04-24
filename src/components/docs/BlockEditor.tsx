'use client'

import { useState, useRef, useCallback, useEffect, forwardRef, useMemo, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Dropdown } from '@/components/ui/Dropdown'
import { Popover } from '@/components/ui/Popover'
import { Avatar } from '@/components/ui/Avatar'
import { AutoScheduleToggle } from '@/components/ui/AutoScheduleToggle'
import { CalendarDropdown } from '@/components/ui/DateTimePickers'
import { ProjectPicker, findProjectLocation, type SidebarWorkspace, type SidebarFolder, type SidebarProject } from '@/components/ui/ProjectPicker'
import { useTeamMembers } from '@/lib/use-team-members'
import { findAssignee } from '@/lib/assignee-utils'
import { apiFetch } from '@/lib/api-client'
import { DURATION_OPTIONS } from '@/lib/task-constants'
import { useRouter } from 'next/navigation'
import { IconX, IconCheck, IconCopy, IconTrash, IconClaude } from '@/components/ui/Icons'

// ─── Block Types ───

export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulleted_list'
  | 'numbered_list'
  | 'check_list'
  | 'code'
  | 'blockquote'
  | 'divider'
  | 'table'
  | 'link'
  | 'page-link'
  | 'youtube'
  | 'task_ref'
  | 'toggle'
  | 'callout'
  | 'toc'

export interface Block {
  id: string
  type: BlockType
  content: string
  checked?: boolean // for check_list
  rows?: string[][] // for table
  url?: string // for link
  docId?: number // for page-link
  taskId?: number // for checklist items linked to tasks
  taskStatus?: string // for task_ref blocks
  taskCreating?: boolean // for task_ref blocks in creation mode
  language?: string // for code blocks
  collapsed?: boolean // for toggle blocks
  toggleContent?: string // for toggle blocks nested text
  emoji?: string // for callout blocks
}

type LinkedTaskData = {
  id: number
  title: string
  status: string
  priority: string
  due_date: string | null
  duration_minutes: number
  assignee: string | null
  project_id: number | null
  project_name: string | null
  workspace_id: number | null
  workspace_name: string | null
  auto_schedule: boolean
  scheduled_start: string | null
  deleted: boolean
}

// Latest non-cancelled dispatch for a task. Drives the in-doc dispatch button /
// status pill on rich task cards.
type TaskDispatchInfo = {
  id: number
  status: string // queued | working | needs_review | done | failed
  agent_id: string
  run_type: 'single' | 'team_parent' | 'team_child' | string
  // Pipeline hints: if this dispatch is queued behind upstream deps, show which
  // agent/task the run is waiting on instead of a generic "Queued" pill.
  pending_dep_count?: number
  pending_dep_agent?: string | null
  pending_dep_title?: string | null
}

type TaskApiResponse = {
  task?: {
    id: number
    title: string
    status: string
    priority: string
    due_date: string | null
    duration_minutes?: number
    assignee: string | null
    project_id?: number | null
    workspace_id?: number | null
    auto_schedule?: number | boolean
    scheduled_start: string | null
  }
  meta?: {
    projectName?: string | null
    workspaceName?: string | null
  }
}

// Types imported from @/components/ui/ProjectPicker

function normalizeLinkedTask(data: TaskApiResponse | null): LinkedTaskData | null {
  if (!data?.task) return null
  const t = data.task
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_date: t.due_date,
    duration_minutes: t.duration_minutes ?? 30,
    assignee: t.assignee,
    project_id: t.project_id ?? null,
    project_name: data.meta?.projectName || null,
    workspace_id: t.workspace_id ?? null,
    workspace_name: data.meta?.workspaceName || null,
    auto_schedule: !!t.auto_schedule,
    scheduled_start: t.scheduled_start,
    deleted: !!(t as Record<string, unknown>).deleted_at,
  }
}

// findProjectLocation imported from @/components/ui/ProjectPicker

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

export function createEmptyBlock(type: BlockType = 'paragraph'): Block {
  if (type === 'table') {
    return { id: generateId(), type, content: '', rows: [['', '', ''], ['', '', '']] }
  }
  if (type === 'toggle') {
    return { id: generateId(), type, content: '', collapsed: true, toggleContent: '' }
  }
  if (type === 'callout') {
    return { id: generateId(), type, content: '', emoji: '\u{1F4A1}' }
  }
  return { id: generateId(), type, content: '' }
}

// Convert inline markdown to HTML (bold, italic, strikethrough, code, links)
function markdownInlineToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
}

// Convert old plain text content to blocks
export function parseContent(content: string): Block[] {
  if (!content) return [createEmptyBlock()]
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
      // Normalize block types and convert any raw inline markdown in content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return parsed.map((b: any) => {
        let content = b.content || ''
        // If content has raw markdown (not already HTML), convert it
        if (content && !content.includes('<') && (/\*\*.+?\*\*/.test(content) || /~~.+?~~/.test(content) || /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/.test(content) || /`.+?`/.test(content) || /\[.+?\]\(.+?\)/.test(content))) {
          content = markdownInlineToHtml(content)
        }
        return {
          ...b,
          content,
          type: (b.type === 'checklist' ? 'check_list' : b.type) as BlockType,
        }
      }) as Block[]
    }
  } catch {
    // Not JSON, convert plain text to blocks
  }
  // Plain text with markdown: convert to proper blocks
  const lines = content.split('\n')
  const blocks: Block[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      blocks.push({ id: generateId(), type: 'paragraph', content: '' })
      continue
    }

    // Dividers
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      blocks.push({ id: generateId(), type: 'divider', content: '' })
      continue
    }

    // Headings: # ## ###
    if (/^###\s+/.test(trimmed)) {
      blocks.push({ id: generateId(), type: 'heading3', content: markdownInlineToHtml(trimmed.replace(/^###\s+/, '')) })
      continue
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push({ id: generateId(), type: 'heading2', content: markdownInlineToHtml(trimmed.replace(/^##\s+/, '')) })
      continue
    }
    if (/^#\s+/.test(trimmed)) {
      blocks.push({ id: generateId(), type: 'heading1', content: markdownInlineToHtml(trimmed.replace(/^#\s+/, '')) })
      continue
    }

    // Bulleted list: - text or * text
    if (/^[\-\*]\s+/.test(trimmed)) {
      const listContent = trimmed.replace(/^[\-\*]\s+/, '')
      // Check if it's a checklist: - [ ] or - [x]
      const checkMatch = listContent.match(/^\[( |x|X)\]\s*(.*)/)
      if (checkMatch) {
        blocks.push({ id: generateId(), type: 'check_list', content: markdownInlineToHtml(checkMatch[2]), checked: checkMatch[1] !== ' ' })
      } else {
        blocks.push({ id: generateId(), type: 'bulleted_list', content: markdownInlineToHtml(listContent) })
      }
      continue
    }

    // Numbered list: 1. text
    if (/^\d+\.\s+/.test(trimmed)) {
      blocks.push({ id: generateId(), type: 'numbered_list', content: markdownInlineToHtml(trimmed.replace(/^\d+\.\s+/, '')) })
      continue
    }

    // Blockquote: > text
    if (/^>\s+/.test(trimmed)) {
      blocks.push({ id: generateId(), type: 'blockquote', content: markdownInlineToHtml(trimmed.replace(/^>\s+/, '')) })
      continue
    }

    // Regular paragraph with inline markdown converted to HTML
    blocks.push({ id: generateId(), type: 'paragraph', content: markdownInlineToHtml(trimmed) })
  }

  return blocks.length > 0 ? blocks : [createEmptyBlock()]
}

export function serializeBlocks(blocks: Block[]): string {
  return JSON.stringify(blocks)
}

// ─── Slash Command Menu ───

interface SlashMenuItem {
  type: BlockType | 'new_task' | 'new_project' | 'new_doc' | 'new_database' | 'search' | 'ai_draft' | 'emoji' | 'inline_task'
  label: string
  icon: string
  group?: string
}

const slashMenuItems: SlashMenuItem[] = [
  { type: 'inline_task', label: 'Task', icon: 'task', group: 'actions' },
  { type: 'new_task', label: 'New task (open panel)', icon: 'task', group: 'actions' },
  { type: 'new_project', label: 'New project', icon: 'project', group: 'actions' },
  { type: 'new_doc', label: 'New doc (sub-page)', icon: 'doc', group: 'actions' },
  { type: 'new_database', label: 'New database', icon: 'database', group: 'actions' },
  { type: 'search', label: 'Search docs, projects or tasks', icon: 'search', group: 'actions' },
  { type: 'ai_draft', label: 'AI: Generate content', icon: 'ai', group: 'actions' },
  { type: 'heading1', label: 'Heading 1', icon: 'H1', group: 'blocks' },
  { type: 'heading2', label: 'Heading 2', icon: 'H2', group: 'blocks' },
  { type: 'heading3', label: 'Heading 3', icon: 'H3', group: 'blocks' },
  { type: 'toggle', label: 'Toggle list', icon: 'toggle', group: 'blocks' },
  { type: 'callout', label: 'Callout', icon: 'callout', group: 'blocks' },
  { type: 'toc', label: 'Table of contents', icon: 'toc', group: 'blocks' },
  { type: 'numbered_list', label: 'Numbered list', icon: 'ol', group: 'lists' },
  { type: 'bulleted_list', label: 'Bulleted list', icon: 'ul', group: 'lists' },
  { type: 'check_list', label: 'Check list', icon: 'check', group: 'lists' },
  { type: 'table', label: 'Table', icon: 'table', group: 'other' },
  { type: 'blockquote', label: 'Blockquote', icon: 'quote', group: 'other' },
  { type: 'divider', label: 'Divider', icon: 'divider', group: 'other' },
  { type: 'code', label: 'Code block', icon: 'code', group: 'other' },
  { type: 'link', label: 'Link', icon: 'link', group: 'other' },
  { type: 'emoji', label: 'Emoji', icon: 'emoji', group: 'other' },
]

// ─── Turn Into Menu Items ───

const turnIntoItems: { type: BlockType; label: string; icon: string }[] = [
  { type: 'heading1', label: 'Heading 1', icon: 'H1' },
  { type: 'heading2', label: 'Heading 2', icon: 'H2' },
  { type: 'heading3', label: 'Heading 3', icon: 'H3' },
  { type: 'paragraph', label: 'Paragraph', icon: 'Aa' },
  { type: 'bulleted_list', label: 'Bulleted list', icon: 'ul' },
  { type: 'numbered_list', label: 'Numbered list', icon: 'ol' },
  { type: 'check_list', label: 'Check list', icon: 'check' },
  { type: 'code', label: 'Code block', icon: 'code' },
  { type: 'blockquote', label: 'Block quote', icon: 'quote' },
  { type: 'toggle', label: 'Toggle list', icon: 'toggle' },
  { type: 'callout', label: 'Callout', icon: 'callout' },
]

// ─── Floating Formatting Toolbar ───

const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Red', value: '#ef5350' },
  { label: 'Orange', value: '#ff9100' },
  { label: 'Yellow', value: '#ffd740' },
  { label: 'Green', value: '#7a6b55' },
  { label: 'Blue', value: '#42a5f5' },
  { label: 'Purple', value: '#b388ff' },
  { label: 'Pink', value: '#ff80ab' },
  { label: 'Gray', value: '#78909c' },
]

const BG_COLORS = [
  { label: 'None', value: '' },
  { label: 'Red', value: 'rgba(239,83,80,0.15)' },
  { label: 'Orange', value: 'rgba(255,145,0,0.15)' },
  { label: 'Yellow', value: 'rgba(255,215,64,0.15)' },
  { label: 'Green', value: 'rgba(55,202,55,0.15)' },
  { label: 'Blue', value: 'rgba(66,165,245,0.15)' },
  { label: 'Purple', value: 'rgba(179,136,255,0.15)' },
  { label: 'Pink', value: 'rgba(255,128,171,0.15)' },
  { label: 'Gray', value: 'rgba(120,144,156,0.15)' },
]

function FloatingToolbar({ onFormat, onLink, onCreateTask, onAiAction }: {
  onFormat: (cmd: string, value?: string) => void
  onLink: () => void
  onCreateTask: () => void
  onAiAction?: (action: string) => void
}) {
  const [showTextColor, setShowTextColor] = useState(false)
  const [showBgColor, setShowBgColor] = useState(false)
  const [showAiMenu, setShowAiMenu] = useState(false)

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-card shadow-xl px-1.5 py-1 animate-in fade-in zoom-in-95 duration-150 relative">
      <ToolbarBtn onClick={() => onFormat('bold')} title="Bold (Cmd+B)">
        <span className="font-bold text-[12px]">B</span>
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onFormat('italic')} title="Italic (Cmd+I)">
        <span className="italic text-[12px]">I</span>
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onFormat('underline')} title="Underline (Cmd+U)">
        <span className="underline text-[12px]">U</span>
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onFormat('strikeThrough')} title="Strikethrough">
        <span className="line-through text-[12px]">S</span>
      </ToolbarBtn>
      <ToolbarBtn onClick={() => onFormat('inlineCode')} title="Inline code (Cmd+E)">
        <span className="font-mono text-[11px]">&lt;/&gt;</span>
      </ToolbarBtn>
      <div className="w-px h-4 bg-border mx-0.5" />
      <ToolbarBtn onClick={onLink} title="Link (Cmd+K)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6.5 9.5l3-3M7 11l-1.5 1.5a2.12 2.12 0 01-3-3L4 8m5-1l1.5-1.5a2.12 2.12 0 013 3L12 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </ToolbarBtn>
      <div className="w-px h-4 bg-border mx-0.5" />
      <ToolbarBtn onClick={onCreateTask} title="Create task from selection">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ToolbarBtn>
      <div className="w-px h-4 bg-border mx-0.5" />
      {/* Text color */}
      <div className="relative">
        <ToolbarBtn onClick={() => { setShowTextColor(!showTextColor); setShowBgColor(false) }} title="Text color">
          <span className="text-[12px] font-bold">A</span>
        </ToolbarBtn>
        {showTextColor && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 p-1.5 rounded-lg border border-border bg-card shadow-xl grid grid-cols-5 gap-1 w-[120px]">
            {TEXT_COLORS.map(c => (
              <button
                key={c.label}
                onMouseDown={(e) => { e.preventDefault(); onFormat('foreColor', c.value || 'inherit'); setShowTextColor(false) }}
                className="w-5 h-5 rounded-full border border-border hover:scale-110 transition-transform"
                style={{ background: c.value || 'var(--text)' }}
                title={c.label}
              />
            ))}
          </div>
        )}
      </div>
      {/* Background color */}
      <div className="relative">
        <ToolbarBtn onClick={() => { setShowBgColor(!showBgColor); setShowTextColor(false) }} title="Background color">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="10" width="12" height="3" rx="1" fill="var(--accent)" opacity="0.3" />
            <text x="5" y="9" fontSize="9" fill="currentColor" fontWeight="600">A</text>
          </svg>
        </ToolbarBtn>
        {showBgColor && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 p-1.5 rounded-lg border border-border bg-card shadow-xl grid grid-cols-5 gap-1 w-[120px]">
            {BG_COLORS.map(c => (
              <button
                key={c.label}
                onMouseDown={(e) => { e.preventDefault(); onFormat('backColor', c.value || 'transparent'); setShowBgColor(false) }}
                className="w-5 h-5 rounded-full border border-border hover:scale-110 transition-transform"
                style={{ background: c.value || 'var(--bg)' }}
                title={c.label}
              />
            ))}
          </div>
        )}
      </div>
      {onAiAction && (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />
          <div className="relative">
            <ToolbarBtn onClick={() => { setShowAiMenu(!showAiMenu); setShowTextColor(false); setShowBgColor(false) }} title="AI actions">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            </ToolbarBtn>
            {showAiMenu && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 py-1 rounded-lg border border-border bg-card shadow-xl min-w-[140px] animate-in fade-in zoom-in-95 duration-100">
                {[
                  { action: 'rewrite', label: 'Rewrite' },
                  { action: 'expand', label: 'Expand' },
                  { action: 'shorten', label: 'Shorten' },
                  { action: 'summarize', label: 'Summarize' },
                ].map(item => (
                  <button
                    key={item.action}
                    onMouseDown={(e) => { e.preventDefault(); onAiAction(item.action); setShowAiMenu(false) }}
                    className="w-full text-left px-2.5 py-1 text-[12px] text-text hover:bg-hover transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ToolbarBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-hover hover:text-text transition-colors"
    >
      {children}
    </button>
  )
}

// ProjectPicker imported from @/components/ui/ProjectPicker

function InlineDatePicker({ value, onChange, label }: { value: string | null; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dateValue = value ? new Date(value + 'T00:00:00') : new Date()
  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(!open)} className="text-[13px] text-text hover:text-text/70 transition-colors">
        {label}
      </button>
      {open && (
        <CalendarDropdown
          value={dateValue}
          onChange={(d) => { onChange(d.toISOString().split('T')[0]); setOpen(false) }}
          onClose={() => setOpen(false)}
          anchorRef={btnRef}
        />
      )}
    </>
  )
}

// ─── @ Mention Menu ───

interface MentionResult {
  type: 'doc' | 'task' | 'project'
  id: number
  public_id?: string
  title: string
}

// ─── Editor Component ───

export function BlockEditor({
  blocks,
  onChange,
  workspaceId,
  docId: currentDocId,
  projectId,
}: {
  blocks: Block[]
  onChange: (blocks: Block[]) => void
  workspaceId?: number | null
  docId?: number
  projectId?: number | null
}) {
  const router = useRouter()
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null)
  const [slashMenu, setSlashMenu] = useState<{ blockId: string; filter: string } | null>(null)
  const [blockMenu, setBlockMenu] = useState<{ blockId: string; x: number; y: number } | null>(null)
  const [turnIntoMenu, setTurnIntoMenu] = useState<{ blockId: string; x: number; y: number } | null>(null)
  const [slashMenuIndex, setSlashMenuIndex] = useState(0)
  const [resetCounter, setResetCounter] = useState(0)
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null)
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below'>('below')
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null)
  const [mentionMenu, setMentionMenu] = useState<{ blockId: string; filter: string; x: number; y: number } | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionResult[]>([])
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(new Set())
  const [taskDataMap, setTaskDataMap] = useState<Record<number, LinkedTaskData>>({})
  const [taskDispatchMap, setTaskDispatchMap] = useState<Record<number, TaskDispatchInfo>>({})
  const [sidebarWorkspaces, setSidebarWorkspaces] = useState<SidebarWorkspace[]>([])
  const teamMembers = useTeamMembers()
  const linkedTaskIdsKey = blocks.filter(b => b.taskId).map(b => b.taskId).join(',')

  // Fetch linked task data for check_list blocks with taskIds
  const fetchLinkedTasks = useCallback((taskIds: number[]) => {
    if (taskIds.length === 0) return
    Promise.all(taskIds.map(async (id) => {
      try {
        const res = await apiFetch(`/api/tasks?id=${id}`)
        if (res.status === 404) {
          return { id, title: '', status: 'cancelled', priority: 'none', due_date: null, duration_minutes: 0, assignee: null, project_id: null, project_name: null, workspace_id: null, workspace_name: null, auto_schedule: false, scheduled_start: null, deleted: true } as LinkedTaskData
        }
        if (!res.ok) return null
        return normalizeLinkedTask(await res.json())
      } catch { return null }
    })).then(results => {
      const map: Record<number, LinkedTaskData> = {}
      for (const task of results) { if (task) map[task.id] = task }
      setTaskDataMap(map)
    })
  }, [])

  useEffect(() => {
    const taskIds = Array.from(new Set(blocks.map(b => Number(b.taskId)).filter(id => Number.isFinite(id) && id > 0)))
    fetchLinkedTasks(taskIds)
  }, [linkedTaskIdsKey, fetchLinkedTasks])

  // Re-fetch linked task data on window focus (picks up status changes from task list)
  useEffect(() => {
    const onFocus = () => {
      const taskIds = Array.from(new Set(blocks.map(b => Number(b.taskId)).filter(id => Number.isFinite(id) && id > 0)))
      if (taskIds.length > 0) fetchLinkedTasks(taskIds)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [blocks, fetchLinkedTasks])

  // Fetch dispatch status for every linked task in this doc so rich task cards
  // can show an in-flight pill. One network request per poll, filtered client-side.
  const fetchTaskDispatches = useCallback(async () => {
    try {
      const res = await apiFetch('/api/dispatch')
      if (!res.ok) return
      const data = await res.json() as { dispatches?: Array<{
        id: number
        task_id: number | null
        status: string
        agent_id: string
        run_type?: string
        created_at: number
        pending_dep_count?: number
        pending_dep_agent?: string | null
        pending_dep_title?: string | null
      }> }
      const dispatches = data.dispatches || []
      // For each taskId, keep the most recently created dispatch (dispatches are
      // already ordered DESC by created_at from getDispatchesForDashboard).
      const map: Record<number, TaskDispatchInfo> = {}
      for (const d of dispatches) {
        if (!d.task_id || map[d.task_id]) continue
        map[d.task_id] = {
          id: d.id,
          status: d.status,
          agent_id: d.agent_id,
          run_type: (d.run_type as TaskDispatchInfo['run_type']) || 'single',
          pending_dep_count: d.pending_dep_count,
          pending_dep_agent: d.pending_dep_agent,
          pending_dep_title: d.pending_dep_title,
        }
      }
      setTaskDispatchMap(map)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    const taskIds = blocks.map(b => Number(b.taskId)).filter(id => Number.isFinite(id) && id > 0)
    if (taskIds.length === 0) {
      setTaskDispatchMap({})
      return
    }
    fetchTaskDispatches()
    // Poll while any dispatch is non-terminal. Simple fixed interval -- the
    // status payload is small and docs rarely stay open with many in-flight runs.
    const interval = setInterval(fetchTaskDispatches, 4000)
    return () => clearInterval(interval)
  }, [linkedTaskIdsKey, fetchTaskDispatches])

  useEffect(() => {
    let cancelled = false

    fetch('/api/sidebar')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (!cancelled && Array.isArray(data)) setSidebarWorkspaces(data)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set())
  const [mentionIndex, setMentionIndex] = useState(0)
  const blockRefs = useRef<Map<string, HTMLElement>>(new Map())
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const blockMenuRef = useRef<HTMLDivElement>(null)

  // Undo/redo for docs
  const undoStack = useRef<Block[][]>([])
  const redoStack = useRef<Block[][]>([])
  const MAX_UNDO = 50

  const lastBlocksRef = useRef<string>('')

  // Debounce undo snapshots so typing doesn't flood
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function pushUndoSnapshot() {
    const snap = JSON.stringify(blocks)
    if (snap === lastBlocksRef.current) return
    undoStack.current.push(JSON.parse(snap))
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
    redoStack.current = []
    lastBlocksRef.current = snap
  }

  // Push undo before content changes (debounced for typing)
  useEffect(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => {
      const snap = JSON.stringify(blocks)
      if (lastBlocksRef.current && snap !== lastBlocksRef.current) {
        undoStack.current.push(JSON.parse(lastBlocksRef.current))
        if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
      }
      lastBlocksRef.current = snap
    }, 500)
  }, [blocks])

  function handleUndo() {
    if (undoStack.current.length === 0) return
    redoStack.current.push(JSON.parse(JSON.stringify(blocks)))
    const prev = undoStack.current.pop()!
    onChange(prev)
    lastBlocksRef.current = JSON.stringify(prev)
    setResetCounter(c => c + 1)
  }

  function handleRedo() {
    if (redoStack.current.length === 0) return
    undoStack.current.push(JSON.parse(JSON.stringify(blocks)))
    const next = redoStack.current.pop()!
    onChange(next)
    lastBlocksRef.current = JSON.stringify(next)
    setResetCounter(c => c + 1)
  }

  // Track text selection for floating toolbar
  useEffect(() => {
    function handleSelection() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setToolbarPos(null)
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0) {
        setToolbarPos(null)
        return
      }
      // Check if selection is inside our editor
      const editorEl = document.querySelector('[data-block-editor]')
      if (!editorEl?.contains(range.commonAncestorContainer)) {
        setToolbarPos(null)
        return
      }
      setToolbarPos({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      })
    }
    document.addEventListener('selectionchange', handleSelection)
    return () => document.removeEventListener('selectionchange', handleSelection)
  }, [])

  // Handle paste to preserve formatting from external sources
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const editorEl = document.querySelector('[data-block-editor]')
      if (!editorEl?.contains(e.target as Node)) return

      // Check if we have HTML content
      const html = e.clipboardData?.getData('text/html')
      if (html) {
        e.preventDefault()
        // Clean the HTML but preserve basic formatting (b, i, u, a, br, p, h1-h6, ul, ol, li, code)
        const temp = document.createElement('div')
        temp.innerHTML = html
        // Remove scripts, styles, and dangerous elements
        temp.querySelectorAll('script, style, meta, link, iframe, object, embed, form').forEach(el => el.remove())
        // Strip event handler attributes (onerror, onload, onmouseover, etc.) and javascript: hrefs
        temp.querySelectorAll('*').forEach(el => {
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith('on') || (attr.name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:'))) {
              el.removeAttribute(attr.name)
            }
          }
        })
        // Get cleaned HTML
        const clean = temp.innerHTML
        document.execCommand('insertHTML', false, clean)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // Fetch mention results
  useEffect(() => {
    if (!mentionMenu) {
      setMentionResults([])
      return
    }
    const q = mentionMenu.filter
    const controller = new AbortController()
    Promise.all([
      fetch(`/api/docs?search=${encodeURIComponent(q)}&limit=3`, { signal: controller.signal }).then(r => r.json()).catch(() => []),
      fetch(`/api/tasks?search=${encodeURIComponent(q)}&limit=3`, { signal: controller.signal }).then(r => r.json()).catch(() => ({ tasks: [] })),
      fetch(`/api/projects?limit=5`, { signal: controller.signal }).then(r => r.json()).catch(() => []),
    ]).then(([docs, tasksData, projects]) => {
      const results: MentionResult[] = []
      if (Array.isArray(docs)) {
        docs.forEach((d: { id: number; title: string }) => results.push({ type: 'doc', id: d.id, title: d.title }))
      }
      const tasks = Array.isArray(tasksData) ? tasksData : (tasksData?.tasks || [])
      tasks.slice(0, 3).forEach((t: { id: number; title: string }) => results.push({ type: 'task', id: t.id, title: t.title }))
      if (Array.isArray(projects)) {
        projects.filter((p: { name: string }) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 3)
          .forEach((p: { id: number; name: string }) => results.push({ type: 'project', id: p.id, title: p.name }))
      }
      setMentionResults(results)
      setMentionIndex(0)
    })
    return () => controller.abort()
  }, [mentionMenu?.filter])

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setSlashMenu(null)
      }
      if (blockMenu && blockMenuRef.current && !blockMenuRef.current.contains(e.target as Node)) {
        setBlockMenu(null)
      }
      if (turnIntoMenu) setTurnIntoMenu(null)
      if (mentionMenu) setMentionMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [blockMenu, turnIntoMenu, mentionMenu])

  const updateBlock = useCallback((id: string, updates: Partial<Block>) => {
    const newBlocks = blocks.map(b => b.id === id ? { ...b, ...updates } : b)
    onChange(newBlocks)
  }, [blocks, onChange])

  const insertBlockAfter = useCallback((afterId: string, type: BlockType = 'paragraph') => {
    const idx = blocks.findIndex(b => b.id === afterId)
    const newBlock = createEmptyBlock(type)
    const newBlocks = [...blocks]
    newBlocks.splice(idx + 1, 0, newBlock)
    onChange(newBlocks)
    setTimeout(() => {
      const el = blockRefs.current.get(newBlock.id)
      if (el) {
        const editable = el.querySelector('[contenteditable]') as HTMLElement
        if (editable) editable.focus()
        else el.focus()
      }
    }, 20)
    return newBlock.id
  }, [blocks, onChange])

  const duplicateBlock = useCallback((id: string) => {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx === -1) return
    const src = blocks[idx]
    const dup: Block = { ...src, id: generateId() }
    const newBlocks = [...blocks]
    newBlocks.splice(idx + 1, 0, dup)
    onChange(newBlocks)
  }, [blocks, onChange])

  const deleteBlock = useCallback((id: string) => {
    if (blocks.length <= 1) {
      onChange([createEmptyBlock()])
      return
    }
    const idx = blocks.findIndex(b => b.id === id)
    const newBlocks = blocks.filter(b => b.id !== id)
    onChange(newBlocks)
    const focusIdx = Math.max(0, idx - 1)
    setTimeout(() => {
      const el = blockRefs.current.get(newBlocks[focusIdx].id)
      if (el) {
        const editable = el.querySelector('[contenteditable]') as HTMLElement
        if (editable) {
          editable.focus()
          const range = document.createRange()
          range.selectNodeContents(editable)
          range.collapse(false)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
      }
    }, 20)
  }, [blocks, onChange])

  // Compute which blocks are hidden by collapsed headings
  const hiddenBlocks = useMemo(() => {
    const hidden = new Set<string>()
    const headingLevels: Record<string, number> = { heading1: 1, heading2: 2, heading3: 3 }
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      const level = headingLevels[b.type]
      if (level && collapsedHeadings.has(b.id)) {
        // Hide all blocks until next heading of same or higher level
        for (let j = i + 1; j < blocks.length; j++) {
          const nextLevel = headingLevels[blocks[j].type]
          if (nextLevel && nextLevel <= level) break
          hidden.add(blocks[j].id)
        }
      }
    }
    return hidden
  }, [blocks, collapsedHeadings])

  function toggleHeadingCollapse(headingId: string) {
    setCollapsedHeadings(prev => {
      const next = new Set(prev)
      if (next.has(headingId)) next.delete(headingId)
      else next.add(headingId)
      return next
    })
  }

  const filteredSlashItems = slashMenu
    ? slashMenuItems.filter(item => item.label.toLowerCase().includes(slashMenu.filter.toLowerCase()))
    : []

  function clearBlockDOM(blockId: string) {
    setResetCounter(c => c + 1)
    for (const delay of [0, 30, 80]) {
      setTimeout(() => {
        const el = blockRefs.current.get(blockId)
        if (el) {
          const editable = el.querySelector('[contenteditable]') as HTMLElement
          if (editable) {
            editable.innerHTML = ''
            if (delay === 80) editable.focus()
          }
        }
      }, delay)
    }
  }

  function handleSlashSelect(item: SlashMenuItem) {
    if (!slashMenu) return
    const targetBlockId = slashMenu.blockId
    setSlashMenu(null)
    setSlashMenuIndex(0)

    if (item.type === 'emoji') {
      updateBlock(targetBlockId, { content: '' })
      setTimeout(() => clearBlockDOM(targetBlockId), 10)
      // Insert a common emoji picker (use native OS picker via Cmd+Ctrl+Space or insert directly)
      setTimeout(() => {
        const el = blockRefs.current.get(targetBlockId)
        if (el) {
          const editable = el.querySelector('[contenteditable]') as HTMLElement
          if (editable) {
            editable.focus()
            // Attempt to trigger OS emoji picker (works on macOS)
            const evt = new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, metaKey: true })
            editable.dispatchEvent(evt)
          }
        }
      }, 50)
      return
    }
    if (item.type === 'search') {
      updateBlock(targetBlockId, { content: '' })
      setTimeout(() => clearBlockDOM(targetBlockId), 10)
      window.dispatchEvent(new CustomEvent('open-search'))
      return
    }
    if (item.type === 'ai_draft') {
      updateBlock(targetBlockId, { content: '' })
      setTimeout(() => clearBlockDOM(targetBlockId), 10)
      window.dispatchEvent(new CustomEvent('open-ai-chat'))
      return
    }
    if (item.type === 'inline_task') {
      // Convert current block into an inline task creation form
      updateBlock(targetBlockId, { type: 'task_ref', content: '', taskCreating: true })
      setTimeout(() => clearBlockDOM(targetBlockId), 10)
      return
    }
    if (item.type === 'new_task' || item.type === 'new_project' || item.type === 'new_doc' || item.type === 'new_database') {
      handleCreateAction(item.type, targetBlockId)
      return
    }

    // TOC: atomic update -- convert + insert new block in one onChange call
    if (item.type === 'toc') {
      const idx = blocks.findIndex(b => b.id === targetBlockId)
      if (idx !== -1) {
        const newBlock = createEmptyBlock('paragraph')
        const newBlocks = [...blocks]
        newBlocks[idx] = { ...newBlocks[idx], type: 'toc' as BlockType, content: '' }
        newBlocks.splice(idx + 1, 0, newBlock)
        onChange(newBlocks)
        setTimeout(() => clearBlockDOM(targetBlockId), 10)
        setTimeout(() => {
          const el = blockRefs.current.get(newBlock.id)
          if (el) {
            const editable = el.querySelector('[contenteditable]') as HTMLElement
            if (editable) editable.focus()
          }
        }, 30)
      }
      return
    }

    // Divider: atomic update -- convert + insert new block in one onChange call
    if (item.type === 'divider') {
      const idx = blocks.findIndex(b => b.id === targetBlockId)
      if (idx !== -1) {
        const newBlock = createEmptyBlock('paragraph')
        const newBlocks = [...blocks]
        newBlocks[idx] = { ...newBlocks[idx], type: 'divider' as BlockType, content: '' }
        newBlocks.splice(idx + 1, 0, newBlock)
        onChange(newBlocks)
        setTimeout(() => clearBlockDOM(targetBlockId), 10)
        setTimeout(() => {
          const el = blockRefs.current.get(newBlock.id)
          if (el) {
            const editable = el.querySelector('[contenteditable]') as HTMLElement
            if (editable) editable.focus()
          }
        }, 30)
      }
      return
    }

    // Change the current block type and clear the slash text
    updateBlock(targetBlockId, { type: item.type as BlockType, content: '' })
    setTimeout(() => clearBlockDOM(targetBlockId), 10)
  }

  async function handleCreateAction(action: string, blockId: string) {
    updateBlock(blockId, { content: '' })
    setTimeout(() => clearBlockDOM(blockId), 10)

    if (action === 'new_task') {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled Task', workspace_id: workspaceId }),
      })
      const data = await res.json()
      if (data.task?.id) {
        window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: data.task.id } }))
      }
    } else if (action === 'new_doc') {
      const res = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Untitled Doc',
          workspace_id: workspaceId,
          parent_doc_id: currentDocId || null,
        }),
      })
      const data = await res.json()
      if (data.id) {
        // Insert page-link block for the new sub-doc
        const newBlocks = blocks.map(b => {
          if (b.id === blockId) {
            return { ...b, type: 'page-link' as BlockType, content: 'Untitled Doc', docId: data.public_id || data.id }
          }
          return b
        })
        onChange(newBlocks)
        // Open the new doc
        router.push(`/doc/${data.public_id || data.id}`)
      }
    } else if (action === 'new_database') {
      const res = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_sheet', name: 'Untitled Database' }),
      })
      const data = await res.json()
      if (data.id) {
        const dbPublicId = data.public_id || data.id
        // Insert page-link block pointing to the new database
        const newBlocks = blocks.map(b => {
          if (b.id === blockId) {
            return { ...b, type: 'page-link' as BlockType, content: 'Untitled Database', url: `/database?open=${dbPublicId}` }
          }
          return b
        })
        onChange(newBlocks)
        router.push(`/database?open=${dbPublicId}`)
      }
    } else if (action === 'new_project') {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled Project' }),
      })
      const data = await res.json()
      if (data.id) {
        const newBlocks = blocks.map(b => {
          if (b.id === blockId) {
            return { ...b, type: 'page-link' as BlockType, content: 'Untitled Project', url: `/tasks?project=${data.id}` }
          }
          return b
        })
        onChange(newBlocks)
      }
    }
  }

  function handleFormat(cmd: string, value?: string) {
    if (cmd === 'inlineCode') {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const range = sel.getRangeAt(0)
        const text = range.toString()
        const code = document.createElement('code')
        code.textContent = text
        code.style.cssText = 'background:rgba(255,255,255,0.06);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.9em;color:#e8e8ea'
        range.deleteContents()
        range.insertNode(code)
        sel.collapseToEnd()
      }
      return
    }
    if (cmd === 'foreColor' || cmd === 'backColor') {
      document.execCommand(cmd, false, value || '')
    } else {
      document.execCommand(cmd, false)
    }
  }

  function handleLink() {
    const url = prompt('Enter URL:')
    if (url) {
      document.execCommand('createLink', false, url)
    }
  }

  async function handleCreateTaskFromSelection() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return
    const selectedText = sel.toString().trim()
    if (!selectedText) return

    // Find the block that contains the selection
    const range = sel.getRangeAt(0)
    let targetBlockId: string | null = null
    for (const [id, el] of blockRefs.current.entries()) {
      if (el.contains(range.commonAncestorContainer)) {
        targetBlockId = id
        break
      }
    }

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selectedText,
          status: 'todo',
          priority: 'medium',
          project_id: projectId || undefined,
          workspace_id: workspaceId || undefined,
        }),
      })
      const data = await res.json()
      const taskId = data?.task?.id || data?.id
      if (taskId) {
        // Replace the block containing the selection with a task_ref block
        if (targetBlockId) {
          const idx = blocks.findIndex(b => b.id === targetBlockId)
          if (idx !== -1) {
            const newBlocks = [...blocks]
            newBlocks[idx] = {
              ...newBlocks[idx],
              type: 'task_ref',
              content: selectedText,
              taskId: taskId,
              taskStatus: 'todo',
              taskCreating: false,
            }
            onChange(newBlocks)
            setToolbarPos(null)
          }
        }
      }
    } catch {
      // silently fail
    }
  }

  async function handleAiAction(action: string) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return
    const selectedText = sel.toString().trim()
    if (!selectedText) return

    const range = sel.getRangeAt(0)

    try {
      const res = await fetch('/api/docs/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: currentDocId, action, selectedText }),
      })
      const data = await res.json()
      if (data?.text) {
        // Replace the selected text with the AI result
        range.deleteContents()
        range.insertNode(document.createTextNode(data.text))
        sel.removeAllRanges()
        setToolbarPos(null)

        // Sync block content back
        for (const [id, el] of blockRefs.current.entries()) {
          if (el.contains(range.startContainer) || el === range.startContainer) {
            const idx = blocks.findIndex(b => b.id === id)
            if (idx !== -1) {
              const newBlocks = [...blocks]
              newBlocks[idx] = { ...newBlocks[idx], content: el.innerHTML }
              onChange(newBlocks)
            }
            break
          }
        }
      }
    } catch {
      // silently fail
    }
  }

  async function handleInlineTaskCreate(blockId: string, title: string) {
    if (!title.trim()) return
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          status: 'todo',
          priority: 'medium',
          duration_minutes: 30,
          workspace_id: workspaceId || undefined,
        }),
      })
      const data = await res.json()
      const newTaskId = data?.task?.id || data?.id
      if (newTaskId) {
        updateBlock(blockId, {
          content: title.trim(),
          taskId: newTaskId,
          taskStatus: data?.task?.status || data?.status || 'todo',
          taskCreating: false,
        })
      }
    } catch {
      // revert to paragraph on error
      updateBlock(blockId, { type: 'paragraph', content: title, taskCreating: false })
    }
  }

  function handleMentionSelect(result: MentionResult) {
    if (!mentionMenu) return
    const blockId = mentionMenu.blockId
    setMentionMenu(null)

    // Remove the @query text and insert a styled mention
    const el = blockRefs.current.get(blockId)
    if (el) {
      const editable = el.querySelector('[contenteditable]') as HTMLElement
      if (editable) {
        const html = editable.innerHTML
        const atIdx = html.lastIndexOf('@')
        if (atIdx >= 0) {
          const typeIcon = result.type === 'doc' ? '\u{1F4C4}' : result.type === 'task' ? '\u2611' : '\u{1F4C1}'
          const link = result.type === 'doc' ? `/doc/${result.public_id || result.id}` : result.type === 'task' ? `/tasks?taskId=${result.public_id || result.id}` : `/project/${result.public_id || result.id}`
          const mention = `<a href="${link}" style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:4px;background:rgba(55,202,55,0.1);color:var(--accent);font-size:13px;text-decoration:none;cursor:pointer;" data-mention-type="${result.type}" data-mention-id="${result.id}" contenteditable="false">${typeIcon} ${result.title}</a>&nbsp;`
          editable.innerHTML = html.slice(0, atIdx) + mention
          // Move cursor to end
          const range = document.createRange()
          range.selectNodeContents(editable)
          range.collapse(false)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
          // Update block content
          updateBlock(blockId, { content: editable.innerHTML })
        }
      }
    }

    // If it's a task mention, also open the task detail
    if (result.type === 'task') {
      window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: result.id } }))
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLElement>, block: Block) {
    const target = e.currentTarget

    // Undo/Redo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); handleRedo(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); handleRedo(); return }

    // Formatting shortcuts
    if (e.metaKey || e.ctrlKey) {
      if (e.key === 'b') { e.preventDefault(); document.execCommand('bold'); return }
      if (e.key === 'i') { e.preventDefault(); document.execCommand('italic'); return }
      if (e.key === 'u') { e.preventDefault(); document.execCommand('underline'); return }
      if (e.key === 'k') {
        e.preventDefault()
        handleLink()
        return
      }
      if (e.key === 'e') {
        e.preventDefault()
        handleFormat('inlineCode')
        return
      }
      // Cmd+Shift+S = strikethrough
      if (e.shiftKey && e.key === 's') {
        e.preventDefault()
        document.execCommand('strikeThrough')
        return
      }
      // Cmd+Shift+1/2/3 = heading 1/2/3
      if (e.shiftKey && e.key === '1') {
        e.preventDefault()
        updateBlock(block.id, { type: block.type === 'heading1' ? 'paragraph' : 'heading1' })
        return
      }
      if (e.shiftKey && e.key === '2') {
        e.preventDefault()
        updateBlock(block.id, { type: block.type === 'heading2' ? 'paragraph' : 'heading2' })
        return
      }
      if (e.shiftKey && e.key === '3') {
        e.preventDefault()
        updateBlock(block.id, { type: block.type === 'heading3' ? 'paragraph' : 'heading3' })
        return
      }
      // Cmd+Shift+7 = numbered list
      if (e.shiftKey && e.key === '7') {
        e.preventDefault()
        updateBlock(block.id, { type: block.type === 'numbered_list' ? 'paragraph' : 'numbered_list' })
        return
      }
      // Cmd+Shift+8 = bulleted list
      if (e.shiftKey && e.key === '8') {
        e.preventDefault()
        updateBlock(block.id, { type: block.type === 'bulleted_list' ? 'paragraph' : 'bulleted_list' })
        return
      }
      // Cmd+Shift+9 = checklist
      if (e.shiftKey && e.key === '9') {
        e.preventDefault()
        updateBlock(block.id, { type: block.type === 'check_list' ? 'paragraph' : 'check_list' })
        return
      }
      // Cmd+Shift+B = blockquote
      if (e.shiftKey && e.key === 'b') {
        // Shift+B won't conflict since plain Cmd+B is caught above (no shift)
        e.preventDefault()
        updateBlock(block.id, { type: block.type === 'blockquote' ? 'paragraph' : 'blockquote' })
        return
      }
    }

    // @ mention detection
    if (mentionMenu && mentionMenu.blockId === block.id) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(Math.max(0, mentionIndex - 1)); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(Math.min(mentionResults.length - 1, mentionIndex + 1)); return }
      if (e.key === 'Enter' && mentionResults.length > 0) { e.preventDefault(); handleMentionSelect(mentionResults[mentionIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionMenu(null); return }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // In slash menu, select item
      if (slashMenu && filteredSlashItems.length > 0) {
        e.preventDefault()
        handleSlashSelect(filteredSlashItems[slashMenuIndex])
        return
      }
      e.preventDefault()
      insertBlockAfter(block.id)
      return
    }

    if (e.key === 'Backspace' && target.textContent === '') {
      e.preventDefault()
      if (block.type !== 'paragraph') {
        updateBlock(block.id, { type: 'paragraph' })
      } else {
        deleteBlock(block.id)
      }
      return
    }

    if (e.key === 'ArrowUp' && slashMenu) {
      e.preventDefault()
      setSlashMenuIndex(Math.max(0, slashMenuIndex - 1))
      return
    }
    if (e.key === 'ArrowDown' && slashMenu) {
      e.preventDefault()
      setSlashMenuIndex(Math.min(filteredSlashItems.length - 1, slashMenuIndex + 1))
      return
    }
    if (e.key === 'Escape' && slashMenu) {
      e.preventDefault()
      setSlashMenu(null)
      return
    }

    // Tab for indentation in code blocks
    if (e.key === 'Tab' && block.type === 'code') {
      e.preventDefault()
      document.execCommand('insertText', false, '  ')
    }

    // Tab/Shift+Tab for list indent/outdent
    if (e.key === 'Tab' && (block.type === 'bulleted_list' || block.type === 'numbered_list' || block.type === 'check_list')) {
      e.preventDefault()
      if (e.shiftKey) {
        document.execCommand('outdent', false)
      } else {
        document.execCommand('indent', false)
      }
    }
  }

  function moveBlock(fromId: string, toId: string, position: 'above' | 'below') {
    if (fromId === toId) return
    const fromIdx = blocks.findIndex(b => b.id === fromId)
    const toIdx = blocks.findIndex(b => b.id === toId)
    if (fromIdx === -1 || toIdx === -1) return

    const newBlocks = [...blocks]
    const [moved] = newBlocks.splice(fromIdx, 1)
    const insertIdx = newBlocks.findIndex(b => b.id === toId)
    if (position === 'above') {
      newBlocks.splice(insertIdx, 0, moved)
    } else {
      newBlocks.splice(insertIdx + 1, 0, moved)
    }
    onChange(newBlocks)
  }

  function getListNumber(idx: number): number {
    let num = 1
    for (let i = idx - 1; i >= 0; i--) {
      if (blocks[i].type === 'numbered_list') num++
      else break
    }
    return num
  }

  function extractYouTubeId(text: string): string | null {
    const match = text.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)
    return match ? match[1] : null
  }

  function handleInput(block: Block, el: HTMLElement) {
    const text = el.textContent || ''
    updateBlock(block.id, { content: el.innerHTML })

    // Auto-detect YouTube URLs and convert to embed
    if (block.type === 'paragraph') {
      const ytId = extractYouTubeId(text.trim())
      if (ytId && text.trim().match(/^https?:\/\//)) {
        updateBlock(block.id, { type: 'youtube', url: `https://www.youtube.com/embed/${ytId}`, content: text.trim() })
        return
      }
    }

    // Markdown auto-conversion on space
    if (text.endsWith(' ') || text.endsWith('\u00A0')) {
      const trimmed = text.trimEnd()
      // - or * -> bulleted list
      if (trimmed === '-' || trimmed === '*') {
        updateBlock(block.id, { type: 'bulleted_list', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      // [] -> checklist
      if (trimmed === '[]' || trimmed === '[ ]') {
        updateBlock(block.id, { type: 'check_list', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      // 1. -> numbered list
      if (/^\d+\.$/.test(trimmed)) {
        updateBlock(block.id, { type: 'numbered_list', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      // # -> heading1, ## -> heading2, ### -> heading3
      if (trimmed === '#') {
        updateBlock(block.id, { type: 'heading1', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      if (trimmed === '##') {
        updateBlock(block.id, { type: 'heading2', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      if (trimmed === '###') {
        updateBlock(block.id, { type: 'heading3', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      // >> -> toggle
      if (trimmed === '>>') {
        updateBlock(block.id, { type: 'toggle', content: '', collapsed: true, toggleContent: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      // > -> blockquote
      if (trimmed === '>') {
        updateBlock(block.id, { type: 'blockquote', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
      // --- -> divider + auto-insert new block below (atomic)
      if (trimmed === '---' || trimmed === '***') {
        const idx = blocks.findIndex(b => b.id === block.id)
        if (idx !== -1) {
          const newBlock = createEmptyBlock('paragraph')
          const newBlocks = [...blocks]
          newBlocks[idx] = { ...newBlocks[idx], type: 'divider' as BlockType, content: '' }
          newBlocks.splice(idx + 1, 0, newBlock)
          onChange(newBlocks)
          setTimeout(() => clearBlockDOM(block.id), 10)
          setTimeout(() => {
            const el = blockRefs.current.get(newBlock.id)
            if (el) {
              const editable = el.querySelector('[contenteditable]') as HTMLElement
              if (editable) editable.focus()
            }
          }, 30)
        }
        return
      }
      // ``` -> code block
      if (trimmed === '```') {
        updateBlock(block.id, { type: 'code', content: '' })
        setTimeout(() => clearBlockDOM(block.id), 10)
        return
      }
    }

    // Detect slash command
    if (text.endsWith('/') || (slashMenu && slashMenu.blockId === block.id)) {
      const slashIdx = text.lastIndexOf('/')
      if (slashIdx >= 0) {
        const filter = text.slice(slashIdx + 1)
        setSlashMenu({ blockId: block.id, filter })
        setSlashMenuIndex(0)
      }
    } else {
      if (slashMenu?.blockId === block.id) {
        setSlashMenu(null)
      }
    }

    // Detect @ mention
    const atMatch = text.match(/@(\w*)$/)
    if (atMatch) {
      const el2 = blockRefs.current.get(block.id)
      if (el2) {
        const rect = el2.getBoundingClientRect()
        setMentionMenu({
          blockId: block.id,
          filter: atMatch[1],
          x: rect.left + 44,
          y: rect.bottom + 4,
        })
      }
    } else if (mentionMenu?.blockId === block.id) {
      setMentionMenu(null)
    }
  }

  return (
    <div className="relative" data-block-editor>
      {blocks.map((block, blockIdx) => {
        if (hiddenBlocks.has(block.id)) return null
        const isHeading = block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3'
        const isCollapsed = collapsedHeadings.has(block.id)
        return (
        <div
          key={block.id}
          ref={(el) => { if (el) blockRefs.current.set(block.id, el) }}
          data-block-id={block.id}
          className={`group relative flex items-start gap-1 py-2.5 ${
            dragOverBlockId === block.id && draggedBlockId !== block.id
              ? dragOverPosition === 'above'
                ? 'border-t-2 border-accent'
                : 'border-b-2 border-accent'
              : ''
          } ${draggedBlockId === block.id ? 'opacity-30' : ''} ${selectedBlockIds.has(block.id) ? 'bg-accent/10 rounded-md' : ''}`}
          onClick={(e) => {
            if (e.shiftKey && focusedBlockId) {
              e.preventDefault()
              const startIdx = blocks.findIndex(b => b.id === focusedBlockId)
              const endIdx = blocks.findIndex(b => b.id === block.id)
              if (startIdx !== -1 && endIdx !== -1) {
                const minIdx = Math.min(startIdx, endIdx)
                const maxIdx = Math.max(startIdx, endIdx)
                const ids = new Set(blocks.slice(minIdx, maxIdx + 1).map(b => b.id))
                setSelectedBlockIds(ids)
              }
            } else {
              if (selectedBlockIds.size > 0) setSelectedBlockIds(new Set())
            }
          }}
          onFocus={() => setFocusedBlockId(block.id)}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const rect = e.currentTarget.getBoundingClientRect()
            const midY = rect.top + rect.height / 2
            setDragOverPosition(e.clientY < midY ? 'above' : 'below')
            setDragOverBlockId(block.id)
          }}
          onDragLeave={() => {
            if (dragOverBlockId === block.id) setDragOverBlockId(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (draggedBlockId) {
              moveBlock(draggedBlockId, block.id, dragOverPosition)
            }
            setDraggedBlockId(null)
            setDragOverBlockId(null)
          }}
        >
          {/* Toggle button for headings */}
          {isHeading && (
            <button
              onClick={() => toggleHeadingCollapse(block.id)}
              className={`absolute -left-5 top-3 w-4 h-4 flex items-center justify-center rounded text-text-dim hover:text-text opacity-0 group-hover:opacity-100 transition-all ${isCollapsed ? '!opacity-100' : ''}`}
              title={isCollapsed ? 'Expand section' : 'Collapse section'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {/* Block controls (+ and drag handle) */}
          <div className="flex items-center gap-0.5 pt-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-[44px]">
            <button
              onClick={() => insertBlockAfter(block.id)}
              className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text"
              title="Add block below"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              draggable
              onDragStart={(e) => {
                setDraggedBlockId(block.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', block.id)
              }}
              onDragEnd={() => {
                setDraggedBlockId(null)
                setDragOverBlockId(null)
              }}
              onClick={(e) => {
                setBlockMenu({ blockId: block.id, x: e.clientX, y: e.clientY })
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text cursor-grab active:cursor-grabbing"
              title="Drag to move / Click for menu"
            >
              <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                <circle cx="3" cy="3" r="1.2" fill="currentColor" />
                <circle cx="7" cy="3" r="1.2" fill="currentColor" />
                <circle cx="3" cy="7" r="1.2" fill="currentColor" />
                <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                <circle cx="3" cy="11" r="1.2" fill="currentColor" />
                <circle cx="7" cy="11" r="1.2" fill="currentColor" />
              </svg>
            </button>
          </div>

          {/* Block content */}
          <div
            className="flex-1 min-w-0"
            onContextMenu={(e) => {
              e.preventDefault()
              setBlockMenu({ blockId: block.id, x: e.clientX, y: e.clientY })
            }}
          >
            <BlockContent
              block={block}
              blockIdx={blockIdx}
              blocks={blocks}
              blockRefs={blockRefs}
              listNumber={block.type === 'numbered_list' ? getListNumber(blockIdx) : 1}
              isOnlyBlock={blocks.length === 1}
              resetCounter={resetCounter}
              onInput={(el) => handleInput(block, el)}
              onKeyDown={(e) => handleKeyDown(e, block)}
              onCheckToggle={() => updateBlock(block.id, { checked: !block.checked })}
              onTableChange={(rows) => updateBlock(block.id, { rows })}
              onUrlChange={(url) => updateBlock(block.id, { url })}
              onLanguageChange={(language) => updateBlock(block.id, { language })}
              onTaskCreate={(title) => handleInlineTaskCreate(block.id, title)}
              onTaskClick={(taskId) => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId } }))}
              onToggleCollapse={() => updateBlock(block.id, { collapsed: !block.collapsed })}
              onToggleContentChange={(toggleContent) => updateBlock(block.id, { toggleContent })}
              onEmojiCycle={() => {
                const emojis = ['\u{1F4A1}', '\u26A0\uFE0F', '\u{1F4CC}', '\u2705', '\u274C', '\u{1F4AC}', '\u{1F525}', '\u{1F4DD}']
                const current = block.emoji || '\u{1F4A1}'
                const idx = emojis.indexOf(current)
                const next = emojis[(idx + 1) % emojis.length]
                updateBlock(block.id, { emoji: next })
              }}
              onDeleteBlock={() => deleteBlock(block.id)}
              taskDataMap={taskDataMap}
              setTaskDataMap={setTaskDataMap}
              taskDispatchMap={taskDispatchMap}
              onDispatchChange={fetchTaskDispatches}
              sidebarWorkspaces={sidebarWorkspaces}
              currentWorkspaceId={workspaceId}
              teamMembers={teamMembers}
            />
          </div>

          {/* Slash command menu */}
          {slashMenu?.blockId === block.id && filteredSlashItems.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute left-[44px] top-full z-50 mt-1 w-[280px] rounded-lg overflow-hidden"
              style={{ background: 'var(--bg-modal)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }}
            >
              <div className="max-h-[380px] overflow-y-auto py-1">
                {filteredSlashItems.map((item, idx) => (
                  <button
                    key={item.type}
                    onMouseDown={(e) => { e.preventDefault(); handleSlashSelect(item) }}
                    className={`flex w-full items-center gap-2 px-2.5 py-1 text-[13px] text-left transition-colors ${
                      idx === slashMenuIndex ? 'text-text' : 'text-text hover:text-text'
                    }`}
                    style={{ background: idx === slashMenuIndex ? 'var(--hover)' : 'transparent' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = idx === slashMenuIndex ? 'var(--hover)' : 'transparent'}
                  >
                    <SlashIcon icon={item.icon} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )})}

      {/* Floating formatting toolbar */}
      {toolbarPos && (
        <div
          className="fixed z-[60]"
          style={{ left: toolbarPos.x, top: toolbarPos.y, transform: 'translate(-50%, -100%)' }}
        >
          <FloatingToolbar onFormat={handleFormat} onLink={handleLink} onCreateTask={handleCreateTaskFromSelection} onAiAction={handleAiAction} />
        </div>
      )}

      {/* @ Mention menu */}
      {mentionMenu && mentionResults.length > 0 && (
        <div
          className="fixed z-50 w-[260px] rounded-lg border border-border bg-card shadow-xl py-1"
          style={{ left: mentionMenu.x, top: mentionMenu.y }}
        >
          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-text-dim">
            Mention a doc, task, or project
          </div>
          {mentionResults.map((r, idx) => {
            const typeColors: Record<string, string> = { doc: 'bg-blue-500/15 text-blue-400', task: 'bg-accent text-white font-bold', project: 'bg-purple-500/15 text-purple-400' }
            return (
              <button
                key={`${r.type}-${r.id}`}
                onMouseDown={(e) => { e.preventDefault(); handleMentionSelect(r) }}
                className={`flex w-full items-center gap-2 px-2.5 py-1 text-[13px] text-left transition-colors ${
                  idx === mentionIndex ? 'bg-hover text-text' : 'text-text-secondary hover:bg-hover'
                }`}
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-medium tracking-wider shrink-0 ${typeColors[r.type] || ''}`}>{r.type}</span>
                <span className="truncate">{r.title}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Block context menu */}
      {blockMenu && (
        <BlockContextMenu
          ref={blockMenuRef}
          x={blockMenu.x}
          y={blockMenu.y}
          blockId={blockMenu.blockId}
          onClose={() => setBlockMenu(null)}
          onDelete={() => { deleteBlock(blockMenu.blockId); setBlockMenu(null) }}
          onDuplicate={() => { duplicateBlock(blockMenu.blockId); setBlockMenu(null) }}
          onTurnInto={(type: BlockType) => {
            updateBlock(blockMenu.blockId, { type })
            setBlockMenu(null)
          }}
        />
      )}

      {/* Turn into menu */}
      {turnIntoMenu && (
        <TurnIntoMenu
          x={turnIntoMenu.x}
          y={turnIntoMenu.y}
          onSelect={(type) => {
            updateBlock(turnIntoMenu.blockId, { type })
            setTurnIntoMenu(null)
          }}
          onClose={() => setTurnIntoMenu(null)}
        />
      )}
    </div>
  )
}

// ─── Block Content Renderer ───

function BlockContent({
  block,
  blockIdx,
  blocks,
  blockRefs,
  listNumber,
  isOnlyBlock,
  resetCounter,
  onInput,
  onKeyDown,
  onCheckToggle,
  onTableChange,
  onUrlChange,
  onLanguageChange,
  onTaskCreate,
  onTaskClick,
  onToggleCollapse,
  onToggleContentChange,
  onEmojiCycle,
  onDeleteBlock,
  taskDataMap,
  setTaskDataMap,
  taskDispatchMap,
  onDispatchChange,
  sidebarWorkspaces,
  currentWorkspaceId,
  teamMembers,
}: {
  block: Block
  blockIdx: number
  blocks: Block[]
  blockRefs: React.MutableRefObject<Map<string, HTMLElement>>
  listNumber: number
  isOnlyBlock: boolean
  resetCounter: number
  onInput: (el: HTMLElement) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  onCheckToggle: () => void
  onTableChange: (rows: string[][]) => void
  onUrlChange: (url: string) => void
  onLanguageChange: (language: string) => void
  onTaskCreate: (title: string) => void
  onTaskClick: (taskId: number) => void
  onToggleCollapse: () => void
  onToggleContentChange: (content: string) => void
  onEmojiCycle: () => void
  onDeleteBlock: () => void
  taskDataMap: Record<number, LinkedTaskData>
  setTaskDataMap: React.Dispatch<React.SetStateAction<Record<number, LinkedTaskData>>>
  taskDispatchMap: Record<number, TaskDispatchInfo>
  onDispatchChange: () => void
  sidebarWorkspaces: SidebarWorkspace[]
  currentWorkspaceId?: number | null
  teamMembers: { id: string; name: string; avatar: string; color: string }[]
}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used inside switch case
  const editableRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)
  const prevContent = useRef(block.content)

  // Set initial content
  useEffect(() => {
    if (editableRef.current && !initialized.current) {
      editableRef.current.innerHTML = block.content || ''
      initialized.current = true
    }
  }, [block.content])

  // Force-clear DOM when content becomes empty (slash command, type change, etc.)
  useEffect(() => {
    if (editableRef.current && block.content === '' && prevContent.current !== '') {
      editableRef.current.innerHTML = ''
    }
    prevContent.current = block.content
  }, [block.content, block.type, resetCounter])

  const editableProps = {
    ref: editableRef,
    contentEditable: true,
    suppressContentEditableWarning: true as const,
    onInput: () => editableRef.current && onInput(editableRef.current),
    onKeyDown,
    'data-placeholder': getPlaceholder(block.type, isOnlyBlock),
  }

  if (block.type === 'divider') {
    return <hr className="border-border-strong my-4" />
  }

  if (block.type === 'task_ref') {
    // Creation mode: show inline form
    if (block.taskCreating && !block.taskId) {
      return <InlineTaskForm onSubmit={onTaskCreate} />
    }
    // Read-only task reference
    // Tailwind class mapping for task card styling (not field config)
    const statusColors: Record<string, string> = {
      todo: 'bg-zinc-600 text-zinc-200',
      in_progress: 'bg-blue-600/20 text-blue-400',
      done: 'bg-green-600/20 text-green-400',
      blocked: 'bg-red-600/20 text-red-400',
      cancelled: 'bg-zinc-700 text-zinc-400',
    }
    const statusLabel = (block.taskStatus || 'todo').replace('_', ' ')
    const statusCls = statusColors[block.taskStatus || 'todo'] || statusColors.todo
    return (
      <button
        onClick={() => block.taskId && onTaskClick(block.taskId)}
        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border border-border bg-elevated hover:bg-hover transition-colors text-left group/task cursor-pointer"
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          block.taskStatus === 'done' ? 'border-accent bg-accent' : 'border-border-strong'
        }`}>
          {block.taskStatus === 'done' && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2.5 2.5L8 3" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className={`text-[14px] flex-1 ${block.taskStatus === 'done' ? 'text-text-dim line-through' : 'text-text'}`}>
          {block.content}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${statusCls}`}>
          {statusLabel}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim opacity-0 group-hover/task:opacity-100 transition-opacity shrink-0">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    )
  }

  if (block.type === 'table') {
    return (
      <TableBlock
        rows={block.rows || [['', ''], ['', '']]}
        onChange={onTableChange}
      />
    )
  }

  if (block.type === 'link') {
    return (
      <LinkBlock
        url={block.url || ''}
        onUrlChange={onUrlChange}
      />
    )
  }

  const baseClass = 'outline-none w-full empty:before:content-[attr(data-placeholder)] empty:before:text-text-dim'

  if (block.type === 'toggle') {
    const isExpanded = !block.collapsed
    return (
      <div>
        <div className="flex items-start gap-1.5">
          <button
            onClick={onToggleCollapse}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-dim hover:text-text hover:bg-hover transition-all mt-0.5"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div {...editableProps} className={`${baseClass} text-[14px] text-text leading-relaxed flex-1`} />
        </div>
        {isExpanded && (
          <div className="ml-7 mt-1 pl-3 border-l border-border">
            <textarea
              value={block.toggleContent || ''}
              onChange={(e) => onToggleContentChange(e.target.value)}
              placeholder="Toggle content..."
              className="w-full bg-transparent text-[13px] text-text-secondary outline-none resize-none leading-relaxed min-h-[32px] placeholder:text-text-dim"
              rows={2}
            />
          </div>
        )}
      </div>
    )
  }

  if (block.type === 'callout') {
    const emoji = block.emoji || '\u{1F4A1}'
    return (
      <div className="flex items-start gap-3 rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)', borderLeft: '3px solid var(--accent)' }}>
        <button
          onClick={onEmojiCycle}
          className="text-[20px] shrink-0 mt-0.5 hover:scale-110 transition-transform cursor-pointer"
          title="Click to change icon"
        >
          {emoji}
        </button>
        <div {...editableProps} className={`${baseClass} text-[14px] text-text leading-relaxed flex-1`} />
      </div>
    )
  }

  if (block.type === 'toc') {
    const headings = blocks.filter(b => b.type === 'heading1' || b.type === 'heading2' || b.type === 'heading3')
    return (
      <div className="rounded-lg px-4 py-3 border border-border" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-dim mb-2">Table of Contents</div>
        {headings.length === 0 ? (
          <div className="text-[13px] text-text-dim italic">No headings found</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {headings.map((h) => {
              const indent = h.type === 'heading2' ? 16 : h.type === 'heading3' ? 32 : 0
              const plainText = (h.content || '').replace(/<[^>]*>/g, '') || 'Untitled'
              return (
                <button
                  key={h.id}
                  onClick={() => {
                    const el = blockRefs.current.get(h.id)
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                  className="text-left text-[13px] text-text-secondary hover:text-text transition-colors py-0.5 truncate"
                  style={{ paddingLeft: indent }}
                >
                  {plainText}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  switch (block.type) {
    case 'heading1':
      return <div {...editableProps} className={`${baseClass} text-[28px] font-bold text-text leading-tight py-1`} />
    case 'heading2':
      return <div {...editableProps} className={`${baseClass} text-[22px] font-semibold text-text leading-tight py-0.5`} />
    case 'heading3':
      return <div {...editableProps} className={`${baseClass} text-[18px] font-semibold text-text leading-snug py-0.5`} />
    case 'bulleted_list':
      return (
        <div className="flex items-start gap-2">
          <span className="text-text text-[18px] leading-none pt-[3px] shrink-0">&#8226;</span>
          <div {...editableProps} className={`${baseClass} text-[16px] text-text leading-relaxed`} />
        </div>
      )
    case 'numbered_list':
      return (
        <div className="flex items-start gap-2">
          <span className="text-text text-[15px] pt-0.5 shrink-0 min-w-[18px] text-right">{listNumber}.</span>
          <div {...editableProps} className={`${baseClass} text-[16px] text-text leading-relaxed`} />
        </div>
      )
    case 'check_list': {
      const linkedTask = block.taskId ? taskDataMap[block.taskId] : null

      if (block.taskId && !linkedTask) {
        const fallbackTitle = (block.content || '').replace(/<[^>]*>/g, '').trim() || 'Loading task...'

        return (
          <div className="group/check flex items-start gap-3 py-1">
            <div className="mt-0.5 shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-text/50">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium text-accent-text/85 truncate">{fallbackTitle}</div>
            </div>
          </div>
        )
      }

      // Rich task card when linked to a real task
      if (linkedTask) {
        const isDeleted = linkedTask.deleted
        const isDone = linkedTask.status === 'done'
        const isCancelled = linkedTask.status === 'cancelled'
        const isTerminal = isDeleted || isDone || isCancelled

        // Overdue check
        const isOverdue = !isTerminal && linkedTask.due_date && new Date(linkedTask.due_date + 'T23:59:59') < new Date()

        // Deleted or cancelled from task list -> "Not relevant" state
        if (isDeleted || isCancelled) {
          const fallbackTitle = linkedTask.title || (block.content || '').replace(/<[^>]*>/g, '').trim()
          return (
            <div className="group/check flex items-start gap-3 py-1 opacity-50">
              <div className="mt-0.5 shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-text-dim/50">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[15px] text-text-dim line-through">{fallbackTitle}</span>
                <span className="ml-2 text-[11px] text-text-dim/60 uppercase tracking-wide">{isDeleted ? 'Removed' : 'Not relevant'}</span>
              </div>
              <button
                onClick={async () => {
                  if (!isDeleted) {
                    await fetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: linkedTask.id }) })
                  }
                  onDeleteBlock()
                }}
                className="opacity-0 group-hover/check:opacity-100 w-6 h-6 rounded flex items-center justify-center text-text-dim/40 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                title="Remove from doc"
              >
                <IconX size={12} />
              </button>
            </div>
          )
        }

        // Completed from task list -> completed state
        if (isDone) {
          return (
            <div className="group/check flex items-start gap-3 py-1">
              <div className="mt-0.5 shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-green-400">
                  <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 12l3 3 5-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[15px] text-text-dim line-through">{linkedTask.title}</span>
                <span className="ml-2 text-[11px] text-green-400/70 uppercase tracking-wide">Done</span>
              </div>
              <button
                onClick={() => {
                  fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: linkedTask.id, status: 'todo' }) })
                  setTaskDataMap(prev => ({ ...prev, [linkedTask.id]: { ...prev[linkedTask.id], status: 'todo' } }))
                }}
                className="opacity-0 group-hover/check:opacity-100 text-[11px] text-text-dim/50 hover:text-text px-1.5 py-0.5 rounded hover:bg-hover transition-colors shrink-0"
                title="Reopen task"
              >
                Undo
              </button>
            </div>
          )
        }

        // Active task - full editable card
        const durationLabel = linkedTask.duration_minutes >= 60
          ? `${Math.floor(linkedTask.duration_minutes / 60)} hour${linkedTask.duration_minutes >= 120 ? 's' : ''}`
          : `${linkedTask.duration_minutes} min`
        const dateLabel = linkedTask.due_date
          ? new Date(linkedTask.due_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : 'No date'

        // DURATION_OPTIONS imported from @/lib/task-constants
        const assigneeOpts = [{ value: '', label: 'Unassigned' }, ...teamMembers.map(m => ({ value: m.id, label: m.name }))]

        const updateTask = (field: string, value: unknown) => {
          fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: linkedTask.id, [field]: value }) })
          setTaskDataMap(prev => ({ ...prev, [linkedTask.id]: { ...prev[linkedTask.id], [field]: value } }))
        }

        const updateTaskProject = async (project: { id: number; name: string; workspaceId: number; workspaceName: string }) => {
          await fetch('/api/tasks', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: linkedTask.id, project_id: project.id }),
          })
          setTaskDataMap(prev => ({
            ...prev,
            [linkedTask.id]: {
              ...prev[linkedTask.id],
              project_id: project.id,
              project_name: project.name,
              workspace_id: project.workspaceId,
              workspace_name: project.workspaceName,
            },
          }))
        }

        return (
          <div className="group/check flex items-start gap-3 py-1">
            <div className="mt-0.5 shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-text/50">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span onClick={() => onTaskClick(linkedTask.id)} className="text-[15px] text-accent-text hover:underline cursor-pointer font-medium">
                  {linkedTask.title}
                </span>
                {isOverdue && (
                  <span className="text-[11px] font-medium text-[#ef5350] bg-[#ef535015] px-1.5 py-0.5 rounded-full uppercase tracking-wide">Overdue</span>
                )}
                <button onClick={() => onTaskClick(linkedTask.id)} className="text-text-dim/50 hover:text-text-dim shrink-0" title="Edit task">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-[13px] text-text whitespace-nowrap flex-wrap">
                <ProjectPicker
                  currentProjectId={linkedTask.project_id}
                  currentProjectName={linkedTask.project_name}
                  currentWorkspaceId={linkedTask.workspace_id || currentWorkspaceId}
                  currentWorkspaceName={linkedTask.workspace_name}
                  workspaces={sidebarWorkspaces}
                  onSelect={updateTaskProject}
                />
                <span className="opacity-30">|</span>
                <Dropdown value={String(linkedTask.duration_minutes)} onChange={v => updateTask('duration_minutes', Number(v))} options={DURATION_OPTIONS} minWidth={120}
                  renderTrigger={({ selected }) => <button className="text-[13px] text-text hover:text-text/70">{selected?.label || durationLabel}</button>} />
                <span className="opacity-30">|</span>
                <InlineDatePicker
                  value={linkedTask.due_date}
                  onChange={(d) => updateTask('due_date', d)}
                  label={dateLabel}
                />
                <span className="opacity-30">|</span>
                <Dropdown value={linkedTask.assignee || ''} onChange={v => updateTask('assignee', v || null)} options={assigneeOpts} searchable minWidth={170}
                  renderTrigger={() => {
                    const assigneeMember = findAssignee(linkedTask.assignee, teamMembers)
                    const assigneeName = assigneeMember?.name || linkedTask.assignee || 'Unassigned'
                    return (
                      <button className="flex items-center gap-1 text-[13px] text-text hover:text-text/70">
                        {linkedTask.assignee ? (<><Avatar name={assigneeName} size={16} src={assigneeMember?.avatar} color={assigneeMember?.color} /><span>{assigneeName}</span></>) : (<><div className="w-4 h-4 rounded-full bg-border flex items-center justify-center text-text-dim"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z" /></svg></div><span>Unassigned</span></>)}
                      </button>
                    )
                  }}
                  renderOption={(opt, isSel) => {
                    const m = findAssignee(opt.value, teamMembers)
                    return (
                      <div className="flex items-center gap-2 text-[13px]">
                        {m ? <Avatar name={m.name} size={16} src={m.avatar} color={m.color} /> : <div className="w-4 h-4 rounded-full bg-border flex items-center justify-center text-text-dim"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z" /></svg></div>}
                        <span>{opt.label}</span>
                        {isSel && <IconCheck size={10} className="ml-auto text-accent-text" strokeWidth={2.5} />}
                      </div>
                    )
                  }}
                />
                <span className="opacity-30">|</span>
                <AutoScheduleToggle active={linkedTask.auto_schedule} onChange={() => updateTask('auto_schedule', linkedTask.auto_schedule ? 0 : 1)} size="sm" compact scheduledDate={linkedTask.scheduled_start} />
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
              <RichTaskDispatchButton
                taskId={linkedTask.id}
                assignee={linkedTask.assignee}
                dispatch={taskDispatchMap[linkedTask.id] || null}
                onDispatchChange={onDispatchChange}
              />
              <button onClick={() => { updateTask('status', 'done') }} className="w-7 h-7 rounded flex items-center justify-center bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors" title="Complete task">
                <IconCheck size={14} strokeWidth={2.5} />
              </button>
              <button
                onClick={async () => {
                  await fetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: linkedTask.id }) })
                  onDeleteBlock()
                }}
                className="w-7 h-7 rounded flex items-center justify-center bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                title="Delete task and remove from doc"
              >
                <IconX size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )
      }

      // Default plain checklist (no linked task)
      return (
        <div className="group/check flex items-start gap-2">
          <button
            onClick={onCheckToggle}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border mt-1 transition-colors ${
              block.checked ? 'border-accent bg-accent' : 'border-text-dim hover:border-text'
            }`}
          >
            {block.checked && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2.5 2.5L8 3" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <div
            {...editableProps}
            className={`${baseClass} text-[14px] leading-relaxed flex-1 ${block.checked ? 'text-text-dim line-through' : 'text-text'}`}
          />
          {!block.checked && !block.taskId && (
            <button
              onClick={async () => {
                const text = block.content?.replace(/<[^>]*>/g, '') || ''
                if (!text.trim()) return
                try {
                  await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: text.trim(), status: 'todo', priority: 'medium', duration_minutes: 30 }),
                  })
                  onCheckToggle()
                } catch {}
              }}
              className="opacity-0 group-hover/check:opacity-100 shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent text-white font-bold hover:bg-accent/20 transition-all"
              title="Add to tasks"
            >
              + Task
            </button>
          )}
        </div>
      )
    }
    case 'code':
      return (
        <pre className="rounded-md border border-border overflow-x-auto relative group/code" style={{ background: 'var(--bg-elevated)' }}>
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <Dropdown
              value={block.language || ''}
              onChange={(v) => onLanguageChange(v)}
              searchable
              options={[
                { label: 'Plain text', value: '' },
                { label: 'JavaScript', value: 'javascript' },
                { label: 'TypeScript', value: 'typescript' },
                { label: 'Python', value: 'python' },
                { label: 'HTML', value: 'html' },
                { label: 'CSS', value: 'css' },
                { label: 'JSON', value: 'json' },
                { label: 'SQL', value: 'sql' },
                { label: 'Rust', value: 'rust' },
                { label: 'Go', value: 'go' },
                { label: 'Swift', value: 'swift' },
                { label: 'Java', value: 'java' },
                { label: 'C', value: 'c' },
                { label: 'C++', value: 'cpp' },
                { label: 'Ruby', value: 'ruby' },
                { label: 'PHP', value: 'php' },
                { label: 'Bash', value: 'bash' },
                { label: 'YAML', value: 'yaml' },
              ]}
              triggerClassName="text-[10px] text-text-dim bg-transparent border border-transparent hover:border-[var(--border)] rounded px-1 py-0.5 cursor-pointer inline-flex items-center gap-1 transition-colors"
              minWidth={150}
            />
            <button
              onClick={() => {
                const el = document.querySelector(`[data-block-code="${block.id}"]`)
                if (el) navigator.clipboard.writeText(el.textContent || '')
              }}
              className="text-[10px] text-text-dim hover:text-text opacity-0 group-hover/code:opacity-100 transition-opacity"
            >
              Copy
            </button>
          </div>
          <div className="px-3 pb-3">
            <div
              {...editableProps}
              data-block-code={block.id}
              className={`${baseClass} text-[13px] font-mono text-text leading-relaxed whitespace-pre`}
            />
          </div>
        </pre>
      )
    case 'blockquote':
      return (
        <div className="border-l-3 border-accent pl-4 py-0.5">
          <div {...editableProps} className={`${baseClass} text-[14px] text-text-secondary italic leading-relaxed`} />
        </div>
      )
    case 'page-link':
      return (
        <a
          href={`/doc/${block.docId}`}
          className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer no-underline"
          style={{ background: 'var(--bg-modal)', border: '1px solid var(--border)' }}
          onClick={e => e.stopPropagation()}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-modal)'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-dim">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <span className="text-[14px] font-medium text-text">{block.content}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto shrink-0 text-text-dim">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </a>
      )
    case 'youtube':
      return (
        <div className="rounded-md overflow-hidden border border-border" style={{ background: 'var(--bg)' }}>
          <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
            <iframe
              src={block.url || ''}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="YouTube video"
            />
          </div>
          {block.content && (
            <div className="px-3 py-1.5 text-[11px] text-text-dim truncate">{block.content}</div>
          )}
        </div>
      )
    default: // paragraph
      return <div {...editableProps} className={`${baseClass} text-[16px] text-text leading-relaxed`} />
  }
}

// ─── Inline Task Creation Form ───

function InlineTaskForm({ onSubmit }: { onSubmit: (title: string) => void }) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const today = new Date()
  const dateStr = `${today.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)} ${today.getMonth() + 1}/${today.getDate()}`

  return (
    <div className="flex items-center gap-2">
      {/* Open circle */}
      <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full" style={{ border: '1.5px solid #666' }} />
      <input
        ref={inputRef}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && title.trim()) {
            e.preventDefault()
            onSubmit(title)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
          }
        }}
        placeholder="Task name"
        className="flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-text-dim"
      />
      {title.trim() && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[13px]" style={{ color: '#888' }}>{dateStr}</span>
          <span className="text-[13px]" style={{ color: '#888' }}>30m</span>
        </div>
      )}
    </div>
  )
}

function getPlaceholder(type: BlockType, isOnlyBlock?: boolean): string {
  switch (type) {
    case 'heading1': return 'Heading 1'
    case 'heading2': return 'Heading 2'
    case 'heading3': return 'Heading 3'
    case 'code': return 'Code...'
    case 'blockquote': return 'Quote...'
    case 'toggle': return 'Toggle...'
    case 'callout': return 'Type something...'
    default: return isOnlyBlock ? "Type '/' for commands, '@' to mention..." : ''
  }
}

// ─── Link Block with Preview ───

interface LinkPreview {
  title: string | null
  description: string | null
  image: string | null
  domain: string | null
}

interface VideoEmbedInfo {
  platform: string
  id: string
  embedUrl: string
  thumbUrl: string | null
}

function getVideoEmbed(url: string): VideoEmbedInfo | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)
  if (yt) return { platform: 'youtube', id: yt[1], embedUrl: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0`, thumbUrl: `https://img.youtube.com/vi/${yt[1]}/mqdefault.jpg` }
  const vim = url.match(/vimeo\.com\/(\d+)/)
  if (vim) return { platform: 'vimeo', id: vim[1], embedUrl: `https://player.vimeo.com/video/${vim[1]}?autoplay=1`, thumbUrl: null }
  const loom = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/)
  if (loom) return { platform: 'loom', id: loom[1], embedUrl: `https://www.loom.com/embed/${loom[1]}?autoplay=1`, thumbUrl: null }
  return null
}

function normalizeUrl(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'rgba(255,0,0,0.85)',
  vimeo: 'rgba(26,183,234,0.85)',
  loom: 'rgba(98,77,227,0.85)',
}

function LinkBlock({ url, onUrlChange }: { url: string; onUrlChange: (url: string) => void }) {
  const [editing, setEditing] = useState(!url)
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const normalizedUrl = normalizeUrl(url)
  const videoEmbed = normalizedUrl ? getVideoEmbed(normalizedUrl) : null

  useEffect(() => {
    if (!normalizedUrl) { setPreview(null); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/messages/link-preview?url=${encodeURIComponent(normalizedUrl)}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setPreview(data)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [normalizedUrl])

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 50)
  }, [editing])

  const handleFinishEdit = () => {
    if (url) {
      const normalized = normalizeUrl(url)
      if (normalized !== url) onUrlChange(normalized)
      setEditing(false)
    }
  }

  // Edit mode -- URL input
  if (editing || !url) {
    return (
      <div className="flex items-center gap-2 rounded-md px-3 py-2 border border-border" style={{ background: 'var(--bg-modal)' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-text-dim">
          <path d="M6.5 9.5l3-3M7 11l-1.5 1.5a2.12 2.12 0 01-3-3L4 8m5-1l1.5-1.5a2.12 2.12 0 013 3L12 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url) { e.preventDefault(); handleFinishEdit() }
          }}
          onBlur={handleFinishEdit}
          placeholder="Paste URL..."
          className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim"
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-md px-3 py-3 border border-border" style={{ background: 'var(--bg-modal)' }}>
        <div className="h-4 w-4 rounded-full border-2 border-text-dim border-t-transparent animate-spin" />
        <span className="text-[12px] text-text-dim">Loading preview...</span>
      </div>
    )
  }

  // ── Video embed (YouTube, Vimeo, Loom) -- matches messages style ──
  if (videoEmbed) {
    const platformLabel = videoEmbed.platform.charAt(0).toUpperCase() + videoEmbed.platform.slice(1)

    if (playing) {
      return (
        <div className="group/link relative rounded-[10px] overflow-hidden" style={{ maxWidth: 264, background: 'var(--bg-modal)', border: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', paddingBottom: '56.25%' }}>
            <iframe
              src={videoEmbed.embedUrl}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
          {preview?.title && (
            <div style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{preview.title}</div>
              {preview?.description && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{preview.description}</div>}
            </div>
          )}
        </div>
      )
    }

    const thumb = videoEmbed.thumbUrl || preview?.image
    return (
      <div
        className="group/link relative rounded-[10px] overflow-hidden cursor-pointer"
        style={{ maxWidth: 264, background: 'var(--bg-modal)', border: '1px solid var(--border)' }}
        onClick={() => setPlaying(true)}
      >
        {/* Thumbnail */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {thumb ? (
            <img src={thumb} alt="" style={{ width: '100%', display: 'block', objectFit: 'cover', aspectRatio: '16/9' }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg-elevated)' }} />
          )}
          {/* Play button */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 48, height: 34, background: PLATFORM_COLORS[videoEmbed.platform] || 'rgba(0,0,0,0.7)',
            borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" stroke="none">
              <polygon points="8 5 19 12 8 19 8 5" />
            </svg>
          </div>
          {/* Platform badge */}
          <div style={{
            position: 'absolute', top: 8, left: 8, fontSize: 10, color: '#fff',
            background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: 4, fontWeight: 600,
          }}>
            {platformLabel}
          </div>
        </div>
        {/* Info bar */}
        <div style={{ padding: '8px 12px' }}>
          {preview?.title ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{preview.title}</div>
              {preview?.description && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{preview.description}</div>}
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#888' }}>{platformLabel} video</div>
          )}
        </div>
        {/* Edit button */}
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
          className="absolute top-2 right-2 opacity-0 group-hover/link:opacity-100 p-1.5 rounded-md transition-opacity"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: '#ccc' }}>
            <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    )
  }

  // ── Regular link -- compact by default, expandable ──
  const hasRichPreview = preview && (preview.title || preview.image)

  if (hasRichPreview && expanded) {
    // Expanded: full card with image on top
    return (
      <div className="group/link relative rounded-[10px] overflow-hidden" style={{ maxWidth: 440, background: 'var(--bg-modal)', border: '1px solid var(--border)' }}>
        <a href={normalizedUrl} target="_blank" rel="noopener noreferrer" className="block no-underline">
          {preview.image && (
            <div className="w-full overflow-hidden" style={{ maxHeight: 180, background: 'var(--bg-elevated)' }}>
              <img src={preview.image} alt="" className="w-full object-cover" style={{ maxHeight: 180 }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            </div>
          )}
          <div style={{ padding: '8px 12px' }}>
            {preview.domain && (
              <div style={{ fontSize: 10, color: '#666', marginBottom: 2, textTransform: 'lowercase' }}>{preview.domain}</div>
            )}
            {preview.title && (
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3, marginBottom: 2 }}>{preview.title}</div>
            )}
            {preview.description && (
              <div className="line-clamp-2" style={{ fontSize: 12, color: '#888', lineHeight: 1.4 }}>{preview.description}</div>
            )}
          </div>
        </a>
        {/* Collapse + Edit buttons */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/link:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(false) }}
            className="p-1.5 rounded-md" style={{ background: 'rgba(0,0,0,0.7)' }}
            title="Collapse"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: '#ccc' }}>
              <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setEditing(true) }}
            className="p-1.5 rounded-md" style={{ background: 'rgba(0,0,0,0.7)' }}
            title="Edit URL"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: '#ccc' }}>
              <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // Compact: inline card with small thumbnail
  if (hasRichPreview) {
    return (
      <div className="group/link relative flex items-center gap-3 rounded-[10px] overflow-hidden" style={{ maxWidth: 440, background: 'var(--bg-modal)', border: '1px solid var(--border)' }}>
        <a href={normalizedUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 flex-1 min-w-0 no-underline" style={{ padding: '8px 12px' }}>
          {preview.image && (
            <div className="shrink-0 rounded-md overflow-hidden" style={{ width: 48, height: 48, background: 'var(--bg-elevated)' }}>
              <img src={preview.image} alt="" className="w-full h-full object-cover" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {preview.title && (
              <div className="truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{preview.title}</div>
            )}
            {preview.description && (
              <div className="truncate" style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{preview.description}</div>
            )}
            <div className="truncate" style={{ fontSize: 10, color: '#666', marginTop: 1 }}>{preview.domain || normalizedUrl}</div>
          </div>
        </a>
        {/* Expand + Edit buttons */}
        <div className="flex gap-1 pr-2 opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setExpanded(true) }}
            className="p-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}
            title="Expand preview"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: '#888' }}>
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setEditing(true) }}
            className="p-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}
            title="Edit URL"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: '#888' }}>
              <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // Fallback: no rich preview, just show styled URL
  return (
    <div className="group/link flex items-center gap-2 rounded-[10px] px-3 py-2.5 relative" style={{ maxWidth: 440, background: 'var(--bg-modal)', border: '1px solid var(--border)' }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: '#666' }}>
        <path d="M6.5 9.5l3-3M7 11l-1.5 1.5a2.12 2.12 0 01-3-3L4 8m5-1l1.5-1.5a2.12 2.12 0 013 3L12 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <a href={normalizedUrl} target="_blank" rel="noopener noreferrer" className="flex-1 text-[13px] text-accent-text truncate no-underline hover:underline">{url}</a>
      <button
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        className="opacity-0 group-hover/link:opacity-100 p-1 rounded transition-opacity shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ color: '#888' }}>
          <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

// ─── Table Block ───

function TableBlock({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const updateCell = (ri: number, ci: number, val: string) => {
    const newRows = rows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? val : c) : [...r])
    onChange(newRows)
  }

  const addRow = () => onChange([...rows, new Array(rows[0]?.length || 2).fill('')])
  const addCol = () => onChange(rows.map(r => [...r, '']))

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="text-[13px]">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri === 0 ? 'bg-elevated' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-border px-2 py-1.5 min-w-[200px] w-[200px]">
                  <input
                    value={cell}
                    onChange={(e) => updateCell(ri, ci, e.target.value)}
                    className="w-full bg-transparent text-text outline-none"
                    placeholder=""
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 px-2 py-1.5 text-[11px] text-text-dim border-t border-border">
        <button onClick={addRow} className="hover:text-text">+ Row</button>
        <button onClick={addCol} className="hover:text-text">+ Column</button>
      </div>
    </div>
  )
}

// ─── Block Context Menu ───

const BlockContextMenu = forwardRef<HTMLDivElement, {
  x: number; y: number; blockId: string
  onClose: () => void; onDelete: () => void; onDuplicate: () => void; onTurnInto: (type: BlockType) => void
}>(function BlockContextMenu({ x, y, blockId, onClose, onDelete, onDuplicate, onTurnInto }, ref) {
  const menuItemCls = "flex w-full items-center gap-2 px-2.5 py-1 text-[13px] text-text transition-colors"
  const menuW = 220, menuH = 500
  const clampedX = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1920) - menuW - 10)
  const clampedY = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 1080) - menuH - 10)
  return (
    <div
      ref={ref}
      className="fixed z-50 w-[220px] rounded-md py-1 max-h-[80vh] overflow-y-auto"
      style={{ left: clampedX, top: clampedY, background: 'var(--bg-modal)', border: '1px solid var(--border-strong)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
    >
      <button
        onClick={() => { navigator.clipboard.writeText(`#block-${blockId}`); onClose() }}
        className={menuItemCls}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <IconCopy size={14} />
        Copy link to block
      </button>
      <button
        onClick={onDuplicate}
        className={menuItemCls}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <IconCopy size={14} />
        Duplicate
      </button>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
      <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider" style={{ color: '#666' }}>Turn into</div>
      {turnIntoItems.map((item) => (
        <button
          key={item.type}
          onClick={() => onTurnInto(item.type)}
          className={menuItemCls}
          onMouseEnter={(e) => e.currentTarget.style.background = '#2a2d31'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <SlashIcon icon={item.icon} />
          {item.label}
        </button>
      ))}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
      <button
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-[13px] text-red-400 transition-colors"
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--hover)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <IconTrash size={14} strokeWidth={1.3} />
        Delete block
      </button>
    </div>
  )
});

// ─── Turn Into Menu ───

function TurnIntoMenu({ x, y, onSelect, onClose }: { x: number; y: number; onSelect: (type: BlockType) => void; onClose: () => void }) {
  const menuW = 240, menuH = 400
  const clampedX = Math.min(x, window.innerWidth - menuW - 10)
  const clampedY = Math.min(y, window.innerHeight - menuH - 10)

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute w-[240px] rounded-lg py-1 max-h-[400px] overflow-y-auto"
        style={{ left: clampedX, top: clampedY, background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#666' }}>
          Turn into
        </div>
        {turnIntoItems.map((item) => (
          <button
            key={item.type}
            onClick={() => onSelect(item.type)}
            className="flex w-full items-center gap-2 px-2.5 py-1 text-[13px] text-text transition-colors"
            onMouseEnter={(e) => e.currentTarget.style.background = '#2a2d31'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <SlashIcon icon={item.icon} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Slash Menu Icon ───

function SlashIcon({ icon }: { icon: string }) {
  const cls = "flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold text-text-dim"

  switch (icon) {
    case 'H1': return <span className={cls}>H<sub>1</sub></span>
    case 'H2': return <span className={cls}>H<sub>2</sub></span>
    case 'H3': return <span className={cls}>H<sub>3</sub></span>
    case 'Aa': return <span className={cls}>Aa</span>
    case 'ai':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" stroke="var(--accent)" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </span>
      )
    case 'ul':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3h7M5 7h7M5 11h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="2" cy="3" r="1" fill="currentColor" />
            <circle cx="2" cy="7" r="1" fill="currentColor" />
            <circle cx="2" cy="11" r="1" fill="currentColor" />
          </svg>
        </span>
      )
    case 'ol':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3h7M5 7h7M5 11h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <text x="0" y="5" fontSize="5" fill="currentColor">1</text>
            <text x="0" y="9" fontSize="5" fill="currentColor">2</text>
            <text x="0" y="13" fontSize="5" fill="currentColor">3</text>
          </svg>
        </span>
      )
    case 'check':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 4l1.5 1.5L6 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 3h4M9 7h4M9 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
      )
    case 'code':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 3L1 7l3 4M10 3l3 4-3 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )
    case 'quote':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3v8M5 4h7M5 7h5M5 10h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
      )
    case 'divider':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      )
    case 'table':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1 5h12M1 9h12M5 1v12M9 1v12" stroke="currentColor" strokeWidth="0.8" />
          </svg>
        </span>
      )
    case 'task':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )
    case 'project':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 3.5A1.5 1.5 0 012.5 2H5l1.5 2h5A1.5 1.5 0 0113 5.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 011 10.5v-7z" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </span>
      )
    case 'doc':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8 1H3.5A1.5 1.5 0 002 2.5v9A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V5L8 1z" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </span>
      )
    case 'database':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1 4.5h12M4.5 1v12" stroke="currentColor" strokeWidth="1" />
          </svg>
        </span>
      )
    case 'search':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
      )
    case 'link':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5.5 8.5l3-3M6 10l-1.5 1.5a2 2 0 01-3-3L3 7m5-1l1.5-1.5a2 2 0 013 3L11 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
      )
    case 'toggle':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 2l5 5-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )
    case 'callout':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="7" cy="5" r="1" fill="currentColor" />
            <path d="M7 7.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
      )
    case 'toc':
      return (
        <span className={cls}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3h10M4 6.5h8M4 10h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="2" cy="6.5" r="0.8" fill="currentColor" />
            <circle cx="2" cy="10" r="0.8" fill="currentColor" />
          </svg>
        </span>
      )
    case 'emoji':
      return <span className={cls}>&#128512;</span>
    default:
      return <span className={cls}>?</span>
  }
}

// ---------------------------------------------------------------------------
// Rich task dispatch button
// ---------------------------------------------------------------------------

// Keep the in-doc dispatcher in sync with the TaskDetailPanel assignee → agent
// mapping. Default is the orchestrator team so one click fans out by default.
const RICH_ASSIGNEE_DISPATCH: Record<string, string> = {
  claude: 'claude',
  orchestrator: 'team',
  jimmy: 'jimmy',
  gary: 'gary',
  ricky: 'ricky',
  sofia: 'sofia',
}

function inferRichDispatchAgent(assignee: string | null): string {
  if (!assignee) return 'team'
  return RICH_ASSIGNEE_DISPATCH[assignee.trim().toLowerCase()] || 'team'
}

function RichTaskDispatchButton({
  taskId,
  assignee,
  dispatch,
  onDispatchChange,
}: {
  taskId: number
  assignee: string | null
  dispatch: TaskDispatchInfo | null
  onDispatchChange: () => void
}) {
  const [sending, setSending] = useState(false)

  // Active = we have a current dispatch AND it hasn't been approved/finalized.
  // 'done' here means the dispatch run completed, not that the task is done --
  // we still surface a pill so the user can jump in and review.
  const active = dispatch && dispatch.status !== 'cancelled'

  if (active) {
    const isReview  = dispatch!.status === 'needs_review'
    const isFailed  = dispatch!.status === 'failed'
    const isDone    = dispatch!.status === 'done'
    const isQueued  = dispatch!.status === 'queued'
    // Pipeline: queued but blocked behind an upstream dep. Show the upstream
    // agent so the user knows who they're waiting on, not a generic "Queued."
    const pendingCount = dispatch!.pending_dep_count || 0
    const isWaiting = isQueued && pendingCount > 0
    const isWorking = (dispatch!.status === 'working' || isQueued) && !isWaiting

    // Waiting state uses muted text-secondary so it reads as "paused, by design"
    // instead of "in flight." Colors only fire once the run actually starts.
    const color = isFailed  ? '#ef5350'
                : isReview  ? '#d9a040'
                : isDone    ? '#7a9e87'
                : isWaiting ? 'var(--text-secondary)'
                : 'var(--accent)'

    const waitingAgent = dispatch!.pending_dep_agent
      ? dispatch!.pending_dep_agent.charAt(0).toUpperCase() + dispatch!.pending_dep_agent.slice(1)
      : null
    const label = isFailed  ? 'Failed'
                : isReview  ? 'Review'
                : isDone    ? 'Ready'
                : isWaiting ? (waitingAgent ? `Waiting · ${waitingAgent}` : 'Waiting')
                : isQueued  ? 'Queued'
                : 'Working'

    const href = dispatch!.run_type === 'team_parent'
      ? '/dispatch'
      : `/dispatch/${dispatch!.id}`

    const title = isWaiting
      ? `Waiting on ${waitingAgent || 'upstream step'}${dispatch!.pending_dep_title ? ` — ${dispatch!.pending_dep_title}` : ''}`
      : `Dispatch #${dispatch!.id} · ${dispatch!.agent_id} · ${dispatch!.status}`

    return (
      <a
        href={href}
        onClick={e => e.stopPropagation()}
        className="h-7 inline-flex items-center gap-1.5 px-2 rounded transition-colors"
        style={{
          background: `color-mix(in oklab, ${color} 14%, transparent)`,
          color,
          fontSize: 11,
          fontWeight: 500,
          textDecoration: 'none',
          letterSpacing: '0.01em',
        }}
        title={title}
      >
        <span
          className="inline-block"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
            animation: isWorking ? 'dispatch-working-pulse 1.8s ease-in-out infinite' : undefined,
            opacity: isWaiting ? 0.6 : 1,
          }}
        />
        {label}
      </a>
    )
  }

  return (
    <button
      disabled={sending}
      onClick={async (e) => {
        e.stopPropagation()
        if (sending) return
        setSending(true)
        try {
          const agentId = inferRichDispatchAgent(assignee)
          await apiFetch('/api/dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, agentId, teamMode: agentId === 'team' }),
          })
          // Surface the new queued row immediately; the doc-level poller will
          // keep the pill in sync from here on.
          onDispatchChange()
        } finally {
          setSending(false)
        }
      }}
      className="w-7 h-7 rounded flex items-center justify-center transition-colors"
      style={{
        background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
        color: 'var(--accent)',
        opacity: sending ? 0.5 : 1,
        cursor: sending ? 'wait' : 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklab, var(--accent) 22%, transparent)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in oklab, var(--accent) 10%, transparent)' }}
      title={`Dispatch to ${inferRichDispatchAgent(assignee) === 'team' ? 'the team' : inferRichDispatchAgent(assignee)}`}
    >
      <IconClaude size={13} />
    </button>
  )
}
