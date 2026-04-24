'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar, avatarColor } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { AutoScheduleToggle } from '@/components/ui/AutoScheduleToggle'
import { useTeamMembers } from '@/lib/use-team-members'
import { DURATION_OPTIONS, formatDuration } from '@/lib/task-constants'
import { findAssignee } from '@/lib/assignee-utils'
import { CalendarDropdown } from '@/components/ui/DateTimePickers'
import { ProjectPicker, type SidebarWorkspace, type SidebarFolder, type SidebarProject } from '@/components/ui/ProjectPicker'
import { IconX, IconChevronDown, IconCheck, IconPerson, IconArrowRight } from '@/components/ui/Icons'

interface MeetingTask {
  id: number
  title: string
  status: string
  priority: string
  due_date: string | null
  duration_minutes: number
  assignee: string | null
  project_name: string | null
  project_id: number | null
  auto_schedule: boolean
  scheduled_start: string | null
  workspace_id: number | null
}

interface PlaudTranscript {
  id: number
  title: string
  summary: string
  recorded_at: string
  created_at: string
  processed: boolean
  processed_at: string | null
  action_item_count?: number
  doc_id?: number | null
  client_name?: string | null
  business_name?: string | null
  attendees?: string[]
  host?: string | null
  tasks?: MeetingTask[]
}

// SidebarProject, SidebarFolder, SidebarWorkspace imported from @/components/ui/ProjectPicker

type SortOrder = 'desc' | 'asc'

function formatDateGroup(iso: string) {
  const d = new Date(iso)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`
}

function formatDateCol(iso: string) {
  const d = new Date(iso)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

function AvatarStack({ names, photoMap, max = 4 }: { names: string[]; photoMap: Record<string, string>; max?: number }) {
  const visible = names.slice(0, max)
  const extra = names.length - max
  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((name, i) => (
        <div key={i} className="border-2 border-[var(--bg)] rounded-full shrink-0" style={{ zIndex: max - i }} title={name}>
          <Avatar name={name} size={22} src={photoMap[name] || null} />
        </div>
      ))}
      {extra > 0 && (
        <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-bold text-text-dim bg-border border-2 border-[var(--bg)] shrink-0">
          +{extra}
        </div>
      )}
    </div>
  )
}

function HostBadge({ name, photoMap }: { name: string; photoMap: Record<string, string> }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Avatar name={name} size={20} src={photoMap[name] || null} />
      <span className="text-[13px] text-text-secondary truncate">{name}</span>
    </div>
  )
}

// DURATION_OPTIONS, formatDuration imported from @/lib/task-constants

function formatTaskDate(d: string | null): string {
  if (!d) return 'No date'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function TaskActionRow({ task, photoMap, workspaces, onApprove, onDismiss, onUpdate, onNavigate }: {
  task: MeetingTask
  photoMap: Record<string, string>
  workspaces: SidebarWorkspace[]
  onApprove: () => void
  onDismiss: () => void
  onUpdate: (field: string, value: unknown) => void
  onNavigate: (taskId: number) => void
}) {
  const members = useTeamMembers()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const dateBtnRef = useRef<HTMLButtonElement>(null)

  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...members.map(m => ({ value: m.id, label: m.name })),
  ]

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-hover/50 transition-colors">
      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent-text/50">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
      </div>

      {/* Task content */}
      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-2">
          <span onClick={() => onNavigate(task.id)} className="text-[13px] text-accent-text hover:underline cursor-pointer">
            {task.title}
          </span>
          <button onClick={() => onNavigate(task.id)} className="text-text-dim/40 hover:text-text-dim shrink-0">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>

        {/* Metadata row -- all clickable dropdowns */}
        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-text-secondary whitespace-nowrap flex-wrap">
          {/* Workspace / Project picker */}
          <ProjectPicker
            currentProjectId={task.project_id}
            currentProjectName={task.project_name}
            workspaces={workspaces}
            onSelect={(project) => {
              onUpdate('project_id', project.id)
              onUpdate('project_name', project.name)
            }}
            compact
          />

          <span className="opacity-30">|</span>

          {/* Duration picker */}
          <Dropdown
            value={String(task.duration_minutes)}
            onChange={(v) => onUpdate('duration_minutes', Number(v))}
            options={DURATION_OPTIONS}
            minWidth={120}
            renderTrigger={({ selected }) => (
              <button className="text-[11px] text-text-secondary hover:text-text transition-colors">
                {selected?.label || formatDuration(task.duration_minutes)}
              </button>
            )}
          />

          <span className="opacity-30">|</span>

          {/* Date picker */}
          <button ref={dateBtnRef} onClick={() => setCalendarOpen(!calendarOpen)} className="text-[11px] text-text-secondary hover:text-text transition-colors">
            {formatTaskDate(task.due_date)}
          </button>
          {calendarOpen && (
            <CalendarDropdown
              value={task.due_date ? new Date(task.due_date + 'T00:00:00') : new Date()}
              onChange={(d) => { onUpdate('due_date', d.getTime() === 0 ? null : d.toISOString().split('T')[0]); setCalendarOpen(false) }}
              onClose={() => setCalendarOpen(false)}
              anchorRef={dateBtnRef}
            />
          )}

          <span className="opacity-30">|</span>

          {/* Assignee picker */}
          <Dropdown
            value={task.assignee || ''}
            onChange={(v) => onUpdate('assignee', v || null)}
            options={assigneeOptions}
            searchable
            minWidth={170}
            renderTrigger={() => (
              <button className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text transition-colors">
                {task.assignee ? (
                  <>
                    <Avatar name={task.assignee} size={14} src={photoMap[task.assignee] || photoMap[task.assignee.split(' ')[0]] || null} />
                    <span>{task.assignee}</span>
                  </>
                ) : (
                  <>
                    <div className="w-[14px] h-[14px] rounded-full bg-border flex items-center justify-center">
                      <IconPerson size={8} />
                    </div>
                    <span>Unassigned</span>
                  </>
                )}
              </button>
            )}
            renderOption={(opt, isSel) => {
              const m = findAssignee(opt.value, members)
              return (
                <div className="flex items-center gap-2 px-2.5 py-1">
                  {m ? (
                    <Avatar name={m.name} size={18} src={m.avatar} color={m.color} />
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full bg-border flex items-center justify-center text-text-dim">
                      <IconPerson size={10} />
                    </div>
                  )}
                  <span>{opt.label}</span>
                  {isSel && <IconCheck size={12} strokeWidth={2.5} className="ml-auto text-accent-text" />}
                </div>
              )
            }}
          />

          <span className="opacity-30">|</span>

          {/* Auto-schedule toggle */}
          <AutoScheduleToggle
            active={task.auto_schedule}
            onChange={() => onUpdate('auto_schedule', task.auto_schedule ? 0 : 1)}
            size="sm"
            compact
            scheduledDate={task.scheduled_start}
          />
        </div>
      </div>

      {/* Approve / Dismiss */}
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <button onClick={onApprove} className="w-8 h-8 rounded-md flex items-center justify-center bg-accent/12 text-accent-text hover:bg-accent/20 active:scale-95 transition-all duration-150">
          <IconCheck size={15} strokeWidth={2.5} />
        </button>
        <button onClick={onDismiss} className="w-8 h-8 rounded-md flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95 transition-all duration-150">
          <IconX size={15} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

export default function MeetingNotesPage() {
  const router = useRouter()
  const [transcripts, setTranscripts] = useState<PlaudTranscript[]>([])
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [expandedActionId, setExpandedActionId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [moveMenuId, setMoveMenuId] = useState<number | null>(null)
  const [moveFilter, setMoveFilter] = useState('')
  const [workspaces, setWorkspaces] = useState<SidebarWorkspace[]>([])
  const [expandedWs, setExpandedWs] = useState<Set<number>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({})
  const [clients, setClients] = useState<{ id: number; name: string; color: string }[]>([])
  const [reprocessingId, setReprocessingId] = useState<number | null>(null)
  const [dispatchingDocId, setDispatchingDocId] = useState<number | null>(null)
  const [dispatchToast, setDispatchToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const moveRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/meetings/transcripts?limit=100')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load recordings (${r.status})`)
        return r.json()
      })
      .then(data => {
        // Handle both old (array) and new (object with avatarMap) response formats
        if (Array.isArray(data)) {
          setTranscripts(data)
        } else if (data?.transcripts) {
          setTranscripts(data.transcripts)
          if (data.avatarMap) setPhotoMap(data.avatarMap)
        }
        setLoading(false)
      })
      .catch(err => {
        setError(err.message || 'Failed to load recordings')
        setLoading(false)
      })
  }, [])

  // Load workspace/folder tree for Move dropdown + client list
  useEffect(() => {
    fetch('/api/sidebar')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setWorkspaces(data)
      })
      .catch(() => {})
    fetch('/api/clients')
      .then(r => r.json())
      .then(data => {
        const profiles = data?.profiles || (Array.isArray(data) ? data : [])
        setClients(profiles.map((c: { id: number; name: string; avatar_color?: string }) => ({ id: c.id, name: c.name, color: c.avatar_color || '#6b7280' })))
      })
      .catch(() => {})
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) {
        setMoveMenuId(null)
        setMoveFilter('')
      }
    }
    if (moveMenuId !== null) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moveMenuId])

  useEffect(() => {
    if (expandedActionId === null) return
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-action-dropdown]')) {
        setExpandedActionId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expandedActionId])

  async function moveDoc(docId: number, target: { folderId?: number; projectId?: number }) {
    await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'doc', id: docId, targetFolderId: target.folderId || null, targetProjectId: target.projectId || null }),
    })
    // Update local state to show checkmark
    setTranscripts(prev => prev.map(t => {
      if (t.doc_id === docId) {
        return { ...t, moved_folder_id: target.folderId || null, moved_project_id: target.projectId || null } as PlaudTranscript & { moved_folder_id?: number | null; moved_project_id?: number | null }
      }
      return t
    }))
  }

  function openDoc(t: PlaudTranscript) {
    if (t.doc_id) {
      router.push(`/doc/${t.doc_id}`)
    }
  }

  async function dispatchToJimmy(docId: number) {
    setDispatchingDocId(docId)
    setDispatchToast(null)
    try {
      const res = await fetch('/api/meetings/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      })
      const data = await res.json()
      if (data.dispatched) {
        setDispatchToast({ kind: 'ok', msg: `Sent to Jimmy: ${data.reason}` })
      } else {
        setDispatchToast({ kind: 'err', msg: data.reason || data.error || 'Dispatch failed' })
      }
    } catch (err) {
      setDispatchToast({ kind: 'err', msg: 'Dispatch request failed' })
    } finally {
      setDispatchingDocId(null)
      setTimeout(() => setDispatchToast(null), 4000)
    }
  }

  async function reprocessTranscript(id: number) {
    setReprocessingId(id)
    try {
      const res = await fetch('/api/meetings/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcriptId: id }),
      })
      const data = await res.json()
      if (data.success && data.docId) {
        // Update local state with new doc_id and client info
        setTranscripts(prev => prev.map(t => t.id === id ? {
          ...t,
          doc_id: data.docId,
          client_name: data.clientName || t.client_name,
          business_name: data.businessName || t.business_name,
          attendees: data.attendees || t.attendees,
          host: data.host || t.host,
        } : t))
      } else {
        setError(data.error || 'Reprocess failed')
      }
    } catch (err) {
      setError('Failed to reprocess transcript')
    } finally {
      setReprocessingId(null)
    }
  }

  const searched = searchQuery
    ? transcripts.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.summary || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.client_name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : transcripts

  const sorted = [...searched].sort((a, b) => {
    const aT = new Date(a.recorded_at).getTime()
    const bT = new Date(b.recorded_at).getTime()
    return sortOrder === 'desc' ? bT - aT : aT - bT
  })

  // Group by date
  const grouped: Record<string, PlaudTranscript[]> = {}
  for (const t of sorted) {
    const dateKey = new Date(t.recorded_at).toISOString().split('T')[0]
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(t)
  }
  const groupKeys = Object.keys(grouped)

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function getMovedTarget(): { folderId?: number | null; projectId?: number | null } {
    const t = transcripts.find(t => t.id === moveMenuId) as (PlaudTranscript & { moved_folder_id?: number | null; moved_project_id?: number | null }) | undefined
    return { folderId: t?.moved_folder_id, projectId: t?.moved_project_id }
  }

  function renderFolders(folders: SidebarFolder[], depth: number): React.ReactNode {
    const moved = getMovedTarget()
    return folders
      .filter(f => !moveFilter || f.name.toLowerCase().includes(moveFilter.toLowerCase()) || (f.projects || []).some(p => p.name.toLowerCase().includes(moveFilter.toLowerCase())))
      .map(folder => {
        const hasChildren = (folder.subFolders && folder.subFolders.length > 0) || (folder.projects && folder.projects.length > 0)
        const isExp = expandedFolders.has(folder.id)
        const isMoved = moved.folderId === folder.id && !moved.projectId
        return (
          <div key={folder.id}>
            <div className="flex items-center" style={{ paddingLeft: `${12 + depth * 16}px` }}>
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedFolders(prev => { const n = new Set(prev); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n })
                  }}
                  className="w-5 h-5 rounded flex items-center justify-center shrink-0 hover:bg-hover transition-colors"
                >
                  <IconChevronDown size={8} strokeWidth={3} className={`text-text-dim transition-transform ${isExp ? '' : '-rotate-90'}`} />
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const t = transcripts.find(t => t.id === moveMenuId)
                  if (t?.doc_id) moveDoc(t.doc_id, { folderId: folder.id })
                }}
                className={`flex-1 flex items-center gap-2 py-1 text-[13px] transition-colors rounded px-1.5 ${isMoved ? 'bg-accent/10 text-accent-text' : 'text-text-secondary hover:bg-hover hover:text-text'}`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: folder.color || 'var(--text-dim)' }}>
                  <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                <span className="truncate flex-1 text-left">{folder.name}</span>
                {isMoved && <IconCheck size={12} strokeWidth={2.5} className="shrink-0 text-accent-text" />}
              </button>
            </div>
            {isExp && hasChildren && (
              <>
                {renderFolders(folder.subFolders || [], depth + 1)}
                {(folder.projects || [])
                  .filter(p => !moveFilter || p.name.toLowerCase().includes(moveFilter.toLowerCase()))
                  .map(project => {
                    const isProjectMoved = moved.projectId === project.id
                    return (
                      <div key={`p-${project.id}`} className="flex items-center" style={{ paddingLeft: `${28 + (depth + 1) * 16}px` }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const t = transcripts.find(t => t.id === moveMenuId)
                            if (t?.doc_id) moveDoc(t.doc_id, { projectId: project.id })
                          }}
                          className={`flex-1 flex items-center gap-2 py-1 text-[13px] transition-colors rounded px-1.5 ${isProjectMoved ? 'bg-accent/10 text-accent-text' : 'text-text-secondary hover:bg-hover hover:text-text'}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: project.color || '#666' }}>
                            <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                            <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                          </svg>
                          <span className="truncate flex-1 text-left">{project.name}</span>
                          {isProjectMoved && <IconCheck size={12} strokeWidth={2.5} className="shrink-0 text-accent-text" />}
                        </button>
                      </div>
                    )
                  })}
              </>
            )}
          </div>
        )
      })
  }

  function renderMoveTree(): React.ReactNode {
    return workspaces.map(ws => {
      const isExp = expandedWs.has(ws.id)
      const hasChildren = ws.folders.length > 0 || ws.projects.length > 0
      const moved = getMovedTarget()
      return (
        <div key={ws.id}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpandedWs(prev => { const n = new Set(prev); n.has(ws.id) ? n.delete(ws.id) : n.add(ws.id); return n })
            }}
            className="w-full flex items-center gap-2 px-3 py-1 text-[13px] text-text-secondary hover:bg-hover hover:text-text transition-colors"
          >
            <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 hover:bg-[rgba(255,255,255,0.1)] transition-colors">
              <IconChevronDown size={8} strokeWidth={3} className={`text-text-dim transition-transform ${isExp ? '' : '-rotate-90'}`} />
            </div>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0" stroke="currentColor" strokeWidth="1.2">
              <path d="M8 1L1 5.5l7 4.5 7-4.5L8 1zM1 8l7 4.5L15 8" />
            </svg>
            <span className="truncate">{ws.name}</span>
          </button>
          {isExp && hasChildren && (
            <>
              {renderFolders(ws.folders, 1)}
              {ws.projects
                .filter(p => !moveFilter || p.name.toLowerCase().includes(moveFilter.toLowerCase()))
                .map(project => {
                  const isProjectMoved = moved.projectId === project.id
                  return (
                    <div key={`rp-${project.id}`} className="flex items-center" style={{ paddingLeft: 28 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const t = transcripts.find(t => t.id === moveMenuId)
                          if (t?.doc_id) moveDoc(t.doc_id, { projectId: project.id })
                        }}
                        className={`flex-1 flex items-center gap-2 py-1 text-[13px] transition-colors rounded px-1.5 ${isProjectMoved ? 'bg-accent/10 text-accent-text' : 'text-text-secondary hover:bg-hover hover:text-text'}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: project.color || '#666' }}>
                          <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                          <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                        </svg>
                        <span className="truncate flex-1 text-left">{project.name}</span>
                        {isProjectMoved && <IconCheck size={12} strokeWidth={2.5} className="shrink-0 text-accent-text" />}
                      </button>
                    </div>
                  )
                })}
            </>
          )}
        </div>
      )
    })
  }

  if (loading) {
    return (
      <div className="h-full overflow-auto flex items-center justify-center text-text-dim">
        <div className="flex items-center gap-3">
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span className="text-[14px]">Loading recordings...</span>
        </div>
      </div>
    )
  }

  if (error && transcripts.length === 0) {
    return (
      <div className="h-full overflow-auto flex items-center justify-center text-text-dim">
        <div className="flex flex-col items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span className="text-[14px]">{error}</span>
          <button onClick={() => { setError(null); setLoading(true); window.location.reload() }} className="text-[13px] text-accent-text hover:underline">
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      {/* Error banner */}
      {error && transcripts.length > 0 && (
        <div className="flex items-center gap-2 px-6 py-2 bg-red-900/20 border-b border-red-500/30 text-red-300 text-[13px]">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200">&times;</button>
        </div>
      )}

      {/* Dispatch toast */}
      {dispatchToast && (
        <div className={`flex items-center gap-2 px-6 py-2 border-b text-[13px] ${dispatchToast.kind === 'ok' ? 'bg-accent/10 border-accent/30 text-accent-text' : 'bg-red-900/20 border-red-500/30 text-red-300'}`}>
          <span>{dispatchToast.msg}</span>
          <button onClick={() => setDispatchToast(null)} className="ml-auto opacity-70 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-6 py-2 border-b border-border">
        <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary bg-elevated border border-border hover:border-border-strong hover:text-text transition-all duration-150">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent-text opacity-70"><path d="M8 1L1 5.5l7 4.5 7-4.5L8 1z" /></svg>
          Group: Date
        </button>
        <button
          onClick={() => setSortOrder(s => s === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-text-secondary bg-elevated border border-border hover:border-border-strong hover:text-text transition-all duration-150"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h10M4 18h4" /></svg>
          Sort: Time
          <IconChevronDown size={8} strokeWidth={3} className={`transition-transform ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
        </button>

        <div className="flex-1" />

        {searchOpen ? (
          <div className="flex items-center gap-1.5 border border-border-strong rounded-md px-2.5 py-1.5 bg-elevated" style={{ minWidth: 200 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              autoFocus
              className="bg-transparent text-[12px] text-text placeholder-text-dim outline-none flex-1"
              placeholder="Search meetings..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setSearchOpen(false), setSearchQuery(''))}
            />
            <button onClick={() => { setSearchOpen(false); setSearchQuery('') }} className="text-text-dim hover:text-text transition-colors">
              <IconX size={10} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <button onClick={() => setSearchOpen(true)} className="p-1.5 rounded-md text-text-dim hover:text-text hover:bg-elevated border border-transparent hover:border-border transition-all duration-150">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
        )}
      </div>

      {/* Column headers */}
      <div className="sticky top-0 z-10 bg-[var(--bg)] border-b border-border">
        <div className="flex items-center px-6 py-2">
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Name</span>
          </div>
          <div className="w-[130px] shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Client</span>
          </div>
          <div className="w-[130px] shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">Action Items</span>
          </div>
          <div className="w-[110px] shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-dim">Time</span>
          </div>
          <div className="w-[140px] shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-dim">Host</span>
          </div>
          <div className="w-[110px] shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-dim">Attendees</span>
          </div>
          <div className="w-[100px] shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-text-dim">Date</span>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {sorted.length === 0 && (
        <div className="meeting-empty-state">
          <div className="meeting-empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
            </svg>
          </div>
          <p className="meeting-empty-title">{searchQuery ? 'No recordings match your search' : 'No Plaud recordings yet'}</p>
          <p className="meeting-empty-sub">
            {searchQuery ? 'Try a different search term or clear your filter.' : 'Voice recordings from Plaud will appear here and be automatically processed into notes and tasks.'}
          </p>
          {!searchQuery && (
            <a
              href="https://www.plaud.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="meeting-empty-cta"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
              </svg>
              Learn about Plaud
            </a>
          )}
        </div>
      )}

      {/* Grouped rows */}
      {groupKeys.map(dateKey => {
        const items = grouped[dateKey]
        const isCollapsed = collapsedGroups.has(dateKey)
        const label = formatDateGroup(items[0].recorded_at)

        return (
          <div key={dateKey}>
            {/* Date group header */}
            <button
              onClick={() => toggleGroup(dateKey)}
              className="w-full flex items-center gap-2.5 px-6 py-2 hover:bg-elevated/30 transition-colors"
            >
              <IconChevronDown size={9} strokeWidth={3} className={`text-text-dim/60 transition-transform shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
              <span className="text-[12px] font-semibold text-text-secondary">{label}</span>
              <span className="text-[11px] text-text-dim ml-auto">{items.length} recording{items.length !== 1 ? 's' : ''}</span>
            </button>

            {!isCollapsed && items.map((t, idx) => {
              const actionCount = t.action_item_count ?? 0
              const isHovered = hoveredId === t.id
              const isExpanded = expandedActionId === t.id
              const attendees = t.attendees || []
              const host = t.host || (attendees.length > 0 ? attendees[0] : null)

              return (
                <div key={t.id}>
                  <div
                    className="relative flex items-center px-6 py-3 border-b border-border/50 hover:bg-elevated/40 transition-all duration-150 cursor-pointer group"
                    onMouseEnter={() => setHoveredId(t.id)}
                    onMouseLeave={() => { if (moveMenuId !== t.id) setHoveredId(null) }}
                    onClick={() => openDoc(t)}
                  >
                    {/* Row number */}
                    <span className="text-[12px] text-text-dim/40 w-5 shrink-0">{idx + 1}</span>

                    {/* Name + hover actions */}
                    <div className="flex-1 min-w-0 flex items-center gap-2 pr-2">
                      <span className="text-[14px] text-text font-semibold truncate group-hover:text-white transition-colors">{t.title}</span>

                      {/* Hover actions: Reprocess + Share + Move */}
                      {isHovered && (
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => reprocessTranscript(t.id)}
                            disabled={reprocessingId === t.id}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-accent-text bg-accent/10 border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-50"
                          >
                            {reprocessingId === t.id ? (
                              <>
                                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                                </svg>
                                Processing...
                              </>
                            ) : (
                              <>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                                </svg>
                                Reprocess
                              </>
                            )}
                          </button>
                        </div>
                      )}
                      {isHovered && t.doc_id && (
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => dispatchToJimmy(t.doc_id!)}
                            disabled={dispatchingDocId === t.doc_id}
                            title="Send a pointer to Jimmy (Mac) via Tailscale"
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-accent-text bg-accent/10 border border-accent/30 hover:bg-accent/20 transition-colors disabled:opacity-50"
                          >
                            {dispatchingDocId === t.doc_id ? (
                              <>
                                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                                </svg>
                                Dispatching
                              </>
                            ) : (
                              <>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                                </svg>
                                Dispatch
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => router.push(`/doc/${t.doc_id}`)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-text-secondary bg-elevated border border-border hover:bg-hover transition-colors"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
                            </svg>
                            Share
                          </button>
                          <div className="relative" ref={moveMenuId === t.id ? moveRef : undefined}>
                            <button
                              onClick={() => { setMoveMenuId(moveMenuId === t.id ? null : t.id); setMoveFilter('') }}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-text-secondary bg-elevated border border-border hover:bg-hover transition-colors"
                            >
                              <IconArrowRight size={10} strokeWidth={2} />
                              Move
                            </button>
                            {moveMenuId === t.id && (
                              <div className="absolute top-full left-0 mt-1 w-[240px] bg-elevated rounded-lg py-1 z-30 animate-in fade-in slide-in-from-top-1 duration-150" style={{ border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 8px 32px rgba(14,18,20,0.65), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
                                <div className="px-2.5 py-1.5">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={moveFilter}
                                    onChange={e => setMoveFilter(e.target.value)}
                                    placeholder="Filter..."
                                    className="w-full bg-transparent text-[12px] text-text placeholder-text-dim outline-none"
                                    onClick={e => e.stopPropagation()}
                                  />
                                </div>
                                <div className="border-t border-border/50 max-h-[200px] overflow-y-auto">
                                  {renderMoveTree()}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Client */}
                    <div className="w-[130px] shrink-0" onClick={e => e.stopPropagation()}>
                      <Dropdown
                        value={t.client_name || ''}
                        onChange={async (v) => {
                          const newClient = v || null
                          setTranscripts(prev => prev.map(tr => tr.id === t.id ? { ...tr, client_name: newClient } : tr))
                          if (t.doc_id) {
                            const docRes = await fetch(`/api/docs?id=${t.doc_id}`)
                            const doc = await docRes.json()
                            if (doc?.content) {
                              const blocks = JSON.parse(doc.content)
                              const clientIdx = blocks.findIndex((b: { type: string; content: string }) => b.type === 'paragraph' && b.content?.startsWith('Client: '))
                              if (clientIdx >= 0) {
                                if (newClient) blocks[clientIdx].content = `Client: ${newClient}`
                                else blocks.splice(clientIdx, 1)
                              } else if (newClient) {
                                const insertIdx = blocks.findIndex((b: { type: string }) => b.type === 'divider')
                                blocks.splice(insertIdx >= 0 ? insertIdx : 1, 0, { id: Math.random().toString(36).slice(2, 10), type: 'paragraph', content: `Client: ${newClient}` })
                              }
                              await fetch('/api/docs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.doc_id, content: JSON.stringify(blocks) }) })
                            }
                          }
                        }}
                        options={[
                          { value: 'Personal', label: 'Personal' },
                          ...clients.map(c => ({ value: c.name, label: c.name })),
                        ]}
                        searchable
                        minWidth={160}
                        renderTrigger={() => {
                          const client = t.client_name ? clients.find(c => c.name === t.client_name) : null
                          return (
                            <button className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text transition-colors truncate">
                              {client ? (
                                <Avatar name={client.name} size={16} color={client.color} />
                              ) : t.client_name ? (
                                <Avatar name={t.client_name} size={16} color="#6b7280" />
                              ) : null}
                              <div className="truncate text-left">
                                <span className="truncate">{t.client_name || '-'}</span>
                                {t.business_name && <div className="text-[11px] text-text-dim truncate">{t.business_name}</div>}
                              </div>
                            </button>
                          )
                        }}
                        renderOption={(opt, isSel) => {
                          const client = clients.find(c => c.name === opt.value)
                          return (
                            <div className="flex items-center gap-2 text-[13px]">
                              {opt.value ? (
                                <Avatar name={opt.label} size={16} color={client?.color || '#6b7280'} />
                              ) : (
                                <div className="w-4 h-4 rounded-full bg-border flex items-center justify-center text-text-dim shrink-0">
                                  <IconPerson size={8} />
                                </div>
                              )}
                              <span>{opt.label}</span>
                              {isSel && <IconCheck size={10} strokeWidth={2.5} className="ml-auto text-accent-text" />}
                            </div>
                          )
                        }}
                      />
                    </div>

                    {/* Action Items */}
                    <div className="w-[130px] shrink-0 relative">
                      {actionCount > 0 ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedActionId(isExpanded ? null : t.id) }}
                          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                        >
                          <span className="w-4 h-4 rounded-full border-2 border-orange-400/50 shrink-0" />
                          <span className="text-[13px] font-medium text-text">{actionCount}</span>
                          <span className="text-[12px] text-text-dim">to review</span>
                        </button>
                      ) : (
                        <span className="text-[13px] text-text-dim">-</span>
                      )}

                      {/* Floating action items portal */}
                      {isExpanded && (t.tasks || []).length > 0 && (
                        <div
                          data-action-dropdown
                          className="absolute top-full left-0 mt-1 w-[680px] bg-elevated border border-border rounded-lg shadow-2xl z-40"
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="max-h-[450px] overflow-y-auto py-2">
                            {(t.tasks || []).map(task => (
                              <TaskActionRow
                                key={task.id}
                                task={task}
                                photoMap={photoMap}
                                workspaces={workspaces}
                                onApprove={async () => {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, status: 'done' }) })
                                  setTranscripts(prev => prev.map(tr => tr.id === t.id ? { ...tr, tasks: tr.tasks?.filter(tk => tk.id !== task.id), action_item_count: (tr.action_item_count || 1) - 1 } : tr))
                                }}
                                onDismiss={async () => {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, status: 'cancelled' }) })
                                  setTranscripts(prev => prev.map(tr => tr.id === t.id ? { ...tr, tasks: tr.tasks?.filter(tk => tk.id !== task.id), action_item_count: (tr.action_item_count || 1) - 1 } : tr))
                                }}
                                onUpdate={(field, value) => {
                                  fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, [field]: value }) })
                                  setTranscripts(prev => prev.map(tr => tr.id === t.id ? { ...tr, tasks: tr.tasks?.map(tk => tk.id === task.id ? { ...tk, [field]: value } : tk) } : tr))
                                }}
                                onNavigate={(taskId) => router.push(`/projects-tasks?taskId=${(task as any).public_id || taskId}`)}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Time */}
                    <div className="w-[110px] shrink-0">
                      <span className="text-[13px] text-text-secondary">{formatTime(t.recorded_at)}</span>
                    </div>

                    {/* Host */}
                    <div className="w-[140px] shrink-0 min-w-0">
                      {host ? <HostBadge name={host} photoMap={photoMap} /> : <span className="text-[13px] text-text-dim">-</span>}
                    </div>

                    {/* Attendees */}
                    <div className="w-[110px] shrink-0">
                      {attendees.length > 0 ? (
                        <AvatarStack names={attendees} photoMap={photoMap} max={4} />
                      ) : (
                        <span className="text-[13px] text-text-dim">-</span>
                      )}
                    </div>

                    {/* Date */}
                    <div className="w-[100px] shrink-0">
                      <span className="text-[13px] text-text-dim">{formatDateCol(t.recorded_at)}</span>
                    </div>
                  </div>

                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
