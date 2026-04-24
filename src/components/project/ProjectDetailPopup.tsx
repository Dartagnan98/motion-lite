'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Task, Project, Stage, Workspace, Doc, Folder, ProjectTemplate } from '@/lib/types'
import { StagePill } from '@/components/ui/StagePill'
import { APP_COLORS, getColorName } from '@/lib/colors'
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel'
import { AIProjectDialog } from './AIProjectDialog'
import DatePicker from '@/components/ui/DatePicker'
import { Dropdown } from '@/components/ui/Dropdown'
import { StatusIcon } from '@/components/ui/StatusIcon'
import { useTeamMembers } from '@/lib/use-team-members'
import { findAssignee } from '@/lib/assignee-utils'
import { Avatar } from '@/components/ui/Avatar'
import { PriorityIcon, PRIORITY_OPTIONS as SHARED_PRIORITY_OPTIONS, PRIORITY_CONFIG, renderPriorityOption } from '@/components/ui/PriorityIcon'
import { formatDuration } from '@/lib/task-constants'
import { Popover } from '@/components/ui/Popover'
import { IconX, IconPlus, IconCopy, IconMoreHorizontal, IconTrash, IconClock, IconCheck, IconWorkspace, IconLink } from '@/components/ui/Icons'
import { AutoScheduleToggle } from '@/components/ui/AutoScheduleToggle'
import { LabelPicker } from '@/components/ui/LabelPicker'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

interface ProjectDetailPopupProps {
  project: Project
  stages: Stage[]
  tasks: Task[]
  workspace: Workspace | null
  docs: Doc[]
  folder: Folder | null
  onClose: () => void
  onProjectUpdate?: (p: Project) => void
  onDocsUpdate?: (d: Doc[]) => void
  /** 'edit' = existing project (auto-saves), 'create' = draft mode (no DB writes until onCreate) */
  mode?: 'edit' | 'create'
  /** Called when user clicks "Create project" in create mode. Receives the draft project data. */
  onCreate?: (data: { name: string; description: string; workspaceId: number; assignee?: string; status: string; priority?: string; color: string; labels?: string; start_date?: string; deadline?: string }) => void
  /** Available workspaces for workspace picker in create mode */
  workspaces?: Workspace[]
}

// Project uses same status list as tasks
import { renderStatusOption, StatusTrigger } from '@/components/ui/StatusIcon'
import { STATUS_OPTIONS as TASK_STATUS_OPTIONS } from '@/lib/task-constants'

const PRIORITY_OPTIONS = [{ value: '', label: 'None', color: '#6b7280' }, ...SHARED_PRIORITY_OPTIONS]

// ASSIGNEE_OPTIONS removed -- now uses useTeamMembers() hook

export function ProjectDetailPopup({ project: initialProject, stages: initialStages, tasks: initialTasks, workspace, docs: initialDocs, folder, onClose, onProjectUpdate, onDocsUpdate, mode = 'edit', onCreate, workspaces }: ProjectDetailPopupProps) {
  const [project, setProject] = useState(initialProject)
  const [stages, setStages] = useState(initialStages)
  const [tasks, setTasks] = useState(initialTasks)
  const [docs, setDocs] = useState(initialDocs)
  const ASSIGNEE_OPTIONS = useTeamMembers()
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [showAIDialog, setShowAIDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [availableTemplates, setAvailableTemplates] = useState<ProjectTemplate[]>([])
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [showDocs, setShowDocs] = useState(true)
  const [showAttachments, setShowAttachments] = useState(false)
  const [showActivity, setShowActivity] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [activities, setActivities] = useState<{ id: number; message: string; activity_type: string; agent_id?: string; created_at: number }[]>([])
  const [addingTaskStage, setAddingTaskStage] = useState<number | null>(null)
  const [showCreateStage, setShowCreateStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState('medium')
  const [newTaskDuration, setNewTaskDuration] = useState(30)
  const [newTaskAutoSchedule, setNewTaskAutoSchedule] = useState(true)
  const [folderPopupOpen, setFolderPopupOpen] = useState(false)
  const [folderPopupPos, setFolderPopupPos] = useState<{ top: number; left: number } | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [sidebarData, setSidebarData] = useState<any[]>([])
  const [currentFolder, setCurrentFolder] = useState(folder)
  const [allLabels, setAllLabels] = useState<{ id: number; name: string; color: string }[]>([])
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editorRef.current && project.description) {
      editorRef.current.innerHTML = project.description
    }
  }, [])

  // Fetch workspace/folder tree for folder picker
  useEffect(() => {
    fetch('/api/sidebar').then(r => r.json()).then(data => setSidebarData(data)).catch(() => {})
  }, [])

  // Fetch all labels for picker
  useEffect(() => {
    fetch('/api/labels').then(r => r.json()).then(d => { if (Array.isArray(d)) setAllLabels(d) }).catch(() => {})
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function saveField(field: string, value: unknown) {
    const updated = { ...project, [field]: value } as Project
    setProject(updated)
    onProjectUpdate?.(updated)
    // In create mode, only update local state (no DB writes)
    if (mode === 'create') return
    await fetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project.id, [field]: value }),
    })
  }

  async function saveDescription() {
    const html = editorRef.current?.innerHTML || ''
    if (html !== (project.description || '')) {
      await saveField('description', html)
    }
  }

  function execFormat(cmd: string, val?: string) {
    document.execCommand(cmd, false, val)
    editorRef.current?.focus()
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/projects?id=${project.public_id || project.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Failed to delete project:', err)
        return
      }
      window.location.href = '/'
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }

  async function handleSaveAsTemplate() {
    if (!templateName.trim()) return
    setSavingTemplate(true)
    await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromProjectId: project.id, name: templateName.trim(), description: templateDesc }),
    })
    setSavingTemplate(false)
    setShowTemplateModal(false)
    setTemplateName('')
    setTemplateDesc('')
  }

  async function fetchTemplates() {
    if (availableTemplates.length > 0) return
    const res = await fetch('/api/templates')
    if (res.ok) setAvailableTemplates(await res.json())
  }

  async function handleApplyTemplate(templateId: number) {
    setApplyingTemplate(true)
    setTemplatePickerOpen(false)
    try {
      const res = await fetch('/api/templates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, projectId: project.id }),
      })
      if (res.ok) {
        window.location.reload()
      }
    } finally {
      setApplyingTemplate(false)
    }
  }

  function resetNewTask() {
    setNewTaskTitle(''); setNewTaskDesc(''); setNewTaskPriority('medium'); setNewTaskDuration(30); setNewTaskAutoSchedule(true); setAddingTaskStage(null)
  }
  async function handleAddTask(stageId: number | null) {
    if (!newTaskTitle.trim()) return
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTaskTitle.trim(),
        description: newTaskDesc.trim() || null,
        project_id: project.id,
        stage_id: stageId,
        workspace_id: project.workspace_id,
        status: 'todo',
        priority: newTaskPriority,
        duration_minutes: newTaskDuration,
        auto_schedule: newTaskAutoSchedule ? 1 : 0,
      }),
    })
    const newTask = await res.json().catch(() => null)
    resetNewTask()
    if (newTask) {
      setTasks(prev => [...prev, newTask])
      window.dispatchEvent(new Event('sidebar-refresh'))
    }
  }

  async function handleCreateDoc() {
    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, workspaceId: project.workspace_id }),
    })
    const doc = await res.json()
    if (doc?.id) {
      setDocs(prev => [...prev, doc])
      onDocsUpdate?.([...docs, doc])
      window.location.href = `/doc/${doc.public_id || doc.id}`
    }
  }

  // Load project activities
  useEffect(() => {
    if (mode === 'create') return
    fetch(`/api/activities?projectId=${project.public_id || project.id}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setActivities(data) })
      .catch(() => {})
  }, [project.id, mode])

  async function submitComment() {
    if (!commentText.trim() || mode === 'create') return
    await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.public_id || project.id, activityType: 'comment', message: commentText.trim() }),
    })
    setCommentText('')
    fetch(`/api/activities?projectId=${project.public_id || project.id}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setActivities(data) })
      .catch(() => {})
  }

  const now = new Date()
  const projectDeadline = project.deadline ? new Date(project.deadline) : null
  const projectDeadlineMissed = projectDeadline && projectDeadline < now && project.status === 'open'
  const hasMissedDeadline = projectDeadlineMissed || tasks.some(t =>
    t.due_date && new Date(t.due_date + 'T23:59:59') < new Date() &&
    t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'archived'
  )
  const daysMissed = projectDeadlineMissed ? Math.floor((now.getTime() - projectDeadline!.getTime()) / 86400000) : 0
  const [showResolvePopup, setShowResolvePopup] = useState(false)

  const currentStatus = TASK_STATUS_OPTIONS.find(s => s.value === project.status) || TASK_STATUS_OPTIONS[0]

  const tasksByStage = useMemo(() => {
    const groups: { stage: Stage | null; tasks: Task[] }[] = []
    const unstaged = tasks.filter(t => !t.stage_id)
    if (unstaged.length > 0 || stages.length === 0) {
      groups.push({ stage: null, tasks: unstaged })
    }
    for (const stage of stages) {
      groups.push({ stage, tasks: tasks.filter(t => t.stage_id === stage.id) })
    }
    return groups
  }, [tasks, stages])

  const hasAutoScheduledTasks = tasks.some(t => t.auto_schedule)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`${mode === 'create' ? 'w-[820px] md:w-[900px] lg:w-[960px]' : 'w-[1060px] md:w-[1140px] lg:w-[1240px] xl:w-[1400px]'} max-w-[calc(100vw-56px)] h-[850px] max-h-[calc(100vh-80px)] animate-glass-in rounded-lg overflow-hidden flex flex-col`} style={{ background: 'var(--bg-modal)', boxShadow: 'var(--glass-shadow-lg)', border: '1px solid var(--border-default)' }}>

        {/* Grid: 2-col in create mode, 3-col in edit mode */}
        <div className={`flex-1 min-h-0 grid ${mode === 'create' ? 'grid-cols-[1fr_280px] md:grid-cols-[1fr_300px]' : 'grid-cols-[1fr_270px_320px] md:grid-cols-[1fr_270px_380px] lg:grid-cols-[1fr_270px_420px]'}`}>

          {/* ─── LEFT: Content Panel ─── */}
          <div className="flex flex-col min-w-0 overflow-y-auto" style={{ background: 'var(--bg-modal, var(--bg-surface))' }}>

            {/* Header actions */}
            <div className="flex items-center justify-between px-6 py-4 shrink-0">
              <div className="flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="shrink-0">
                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" fill={project.color} opacity="0.15" />
                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke={project.color} strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke={project.color} strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                {mode === 'create' ? (
                  <span className="text-[13px] text-text-dim">New project</span>
                ) : (
                  <Popover
                    open={templatePickerOpen}
                    onOpenChange={(next) => {
                      setTemplatePickerOpen(next)
                      if (next) fetchTemplates()
                    }}
                    trigger={
                      <button
                        onClick={() => { setTemplatePickerOpen(!templatePickerOpen); if (!templatePickerOpen) fetchTemplates() }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[13px] text-text-dim hover:bg-hover hover:text-text transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.2"/><path d="M5 2v4h6V2" stroke="currentColor" strokeWidth="1.2"/><path d="M10 3v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        {applyingTemplate ? 'Applying...' : 'Use template'}
                      </button>
                    }
                    minWidth={220}
                  >
                    <div className="py-1 max-h-[260px] overflow-y-auto">
                      {availableTemplates.length === 0 ? (
                        <div className="px-3 py-2 text-[13px] text-text-dim">Loading...</div>
                      ) : (
                        <>
                          {availableTemplates.map(t => {
                            const stageCount = JSON.parse(t.stages || '[]').length
                            const taskCount = JSON.parse(t.default_tasks || '[]').length
                            return (
                              <button
                                key={t.id}
                                onClick={() => handleApplyTemplate(t.id)}
                                className="flex flex-col gap-0.5 w-full px-3 py-2 text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors cursor-pointer"
                              >
                                <span className="text-[13px] text-text truncate">{t.name}</span>
                                <span className="text-[11px] text-text-dim">{stageCount} stages, {taskCount} tasks</span>
                              </button>
                            )
                          })}
                          <div className="border-t border-border my-1" />
                          <button
                            onClick={() => { setTemplatePickerOpen(false); setShowTemplateModal(true) }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text-dim hover:bg-[rgba(255,255,255,0.06)] hover:text-text transition-colors cursor-pointer"
                          >
                            <IconPlus size={12} />
                            Save as template
                          </button>
                        </>
                      )}
                    </div>
                  </Popover>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="Copy">
                  <IconCopy />
                </button>
                <Popover
                  open={showMoreMenu}
                  onOpenChange={setShowMoreMenu}
                  trigger={
                    <button className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="More">
                      <IconMoreHorizontal />
                    </button>
                  }
                  align="end"
                >
                  <div className="py-1 min-w-[160px]">
                    <button
                      onClick={async () => {
                        setShowMoreMenu(false)
                        if (!confirm(`Delete "${project.name}"? This will delete all tasks and stages.`)) return
                        await fetch('/api/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: project.id }) })
                        window.dispatchEvent(new Event('sidebar-refresh'))
                        onClose()
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-red-400/10 transition-colors text-left"
                    >
                      <IconTrash size={13} />
                      Delete project
                    </button>
                  </div>
                </Popover>
                <button
                  onClick={onClose}
                  className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text"
                  title="Close"
                >
                  <IconX />
                </button>
              </div>
            </div>

            {/* Title */}
            <div className="px-6 py-2">
              <input
                value={project.name}
                onChange={(e) => setProject(prev => ({ ...prev, name: e.target.value }))}
                onBlur={() => saveField('name', project.name)}
                className="w-full bg-transparent text-[18px] font-semibold text-text outline-none placeholder:text-text-dim input-title"
                placeholder={mode === 'create' ? 'Project title' : 'Project name'}
              />
            </div>

            {/* Rich text toolbar */}
            <div className="flex items-center gap-2 px-6 py-1.5 h-10 border-b border-border sticky top-0 z-[1]" style={{ background: 'var(--bg-modal)' }}>
              {[
                { label: 'B', cls: 'font-bold', cmd: 'bold' },
                { label: 'I', cls: 'italic', cmd: 'italic' },
                { label: 'U', cls: 'underline', cmd: 'underline' },
                { label: 'S', cls: 'line-through', cmd: 'strikeThrough' },
              ].map(b => (
                <button
                  key={b.label}
                  onClick={() => execFormat(b.cmd)}
                  className={`w-[30px] h-[30px] flex items-center justify-center rounded-md text-[12px] text-text-dim hover:bg-hover hover:text-text ${b.cls}`}
                >
                  {b.label}
                </button>
              ))}
              <button onClick={() => execFormat('formatBlock', 'h1')} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-[11px] font-bold text-text-dim hover:bg-hover hover:text-text">H<sub>1</sub></button>
              <button onClick={() => execFormat('formatBlock', 'h2')} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-[11px] font-bold text-text-dim hover:bg-hover hover:text-text">H<sub>2</sub></button>
              <button onClick={() => execFormat('formatBlock', 'h3')} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-[10px] font-bold text-text-dim hover:bg-hover hover:text-text">H<sub>3</sub></button>
              <span className="w-px h-4 bg-border mx-1" />
              <button onClick={() => execFormat('insertUnorderedList')} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="Bullet list">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="3" cy="4" r="1.2" fill="currentColor"/><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </button>
              <button onClick={() => execFormat('insertOrderedList')} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="Numbered list">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><text x="1" y="5.5" fontSize="5" fill="currentColor" fontWeight="600">1</text><text x="1" y="9.5" fontSize="5" fill="currentColor" fontWeight="600">2</text><text x="1" y="13.5" fontSize="5" fill="currentColor" fontWeight="600">3</text><path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </button>
              <button onClick={() => execFormat('indent')} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="Indent">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M6 7h8M6 11h8M2 15h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M2 6l3 2.5L2 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <span className="w-px h-4 bg-border mx-1" />
              <button className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="Image">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="5" cy="6" r="1.5" stroke="currentColor" strokeWidth="1"/><path d="M1.5 11l3.5-3.5 3 3 2-2 4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
              </button>
              <button onClick={() => execFormat('formatBlock', 'pre')} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="Code">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 4L1 8l4 4M11 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button onClick={() => { const url = prompt('Enter URL:'); if (url) execFormat('createLink', url) }} className="w-[30px] h-[30px] flex items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text" title="Link">
                <IconLink size={14} />
              </button>
            </div>

            {/* Description + Docs + Attachments — single scrollable area */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              {/* Description */}
              <div className="px-6 py-4">
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={saveDescription}
                  className="w-full min-h-[80px] text-[14px] leading-[18px] text-text outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-text-dim/30 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-accent-text [&_a]:underline [&_pre]:bg-hover [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:text-[12px] [&_pre]:font-mono"
                  data-placeholder="Add a description..."
                />
              </div>


              {/* Spacer pushes sections toward bottom */}
              <div className="flex-1" />

              {/* Docs Section */}
              <div className="px-6 py-2">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setShowDocs(!showDocs)}
                    className="flex items-center gap-2 text-[14px]"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={`text-white ${showDocs ? 'rotate-90' : ''}`} style={{ transition: 'transform 0.15s' }}>
                      <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="font-semibold text-white">Docs ({docs.length})</span>
                  </button>
                  <div className="flex items-center gap-3 text-[14px]">
                    <button onClick={handleCreateDoc} className="text-white hover:text-white/80 transition-colors">+ Create doc</button>
                    <span className="text-white hover:text-white/80 transition-colors cursor-pointer">+ Add doc</span>
                  </div>
                </div>
                {showDocs && docs.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {docs.map(d => (
                      <a
                        key={d.id}
                        href={`/doc/${d.public_id || d.id}`}
                        className="flex items-center gap-1 pl-7 pr-1 leading-8 rounded-sm hover:bg-hover text-[14px] text-white transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-white shrink-0">
                          <path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
                        </svg>
                        {d.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Attachments Section */}
              <div className="px-6 py-2">
                <button
                  onClick={() => setShowAttachments(!showAttachments)}
                  className="flex items-center gap-2 text-[14px] w-full"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={`text-white ${showAttachments ? 'rotate-90' : ''}`} style={{ transition: 'transform 0.15s' }}>
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="font-semibold text-white">Attachments (0)</span>
                  <span className="ml-auto text-[14px] text-white hover:text-white/80 cursor-pointer">+ Add attachment</span>
                </button>
              </div>

              {/* Activity Section (edit mode only) */}
              {mode !== 'create' && <div className="px-6 pt-2 pb-[80px]">
                <button
                  onClick={() => setShowActivity(!showActivity)}
                  className="flex items-center gap-2 text-[14px] mb-2"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={`text-white ${showActivity ? 'rotate-90' : ''}`} style={{ transition: 'transform 0.15s' }}>
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="font-semibold text-white">Activity</span>
                </button>

                {showActivity && (
                  <>
                    {/* Comment input */}
                    <div className="mb-2">
                      <input
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
                        placeholder="Enter comment"
                        className="w-full rounded-md border border-border px-2.5 py-1.5 text-[14px] text-white outline-none placeholder:text-white/40 focus:border-border-strong"
                        style={{ background: 'var(--bg-chrome)' }}
                      />
                    </div>

                    {/* Activity entries */}
                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                      {activities.slice(0, 8).map((a) => (
                        <div key={a.id} className="flex items-start gap-2 text-[14px]">
                          <div className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold shrink-0 mt-0.5" style={{ backgroundColor: (a.activity_type === 'comment' ? '#42a5f5' : '#6b7280') + '22', color: a.activity_type === 'comment' ? '#42a5f5' : '#6b7280' }}>
                            {a.agent_id ? a.agent_id[0].toUpperCase() : 'D'}
                          </div>
                          <div className="flex-1 min-w-0">
                            {a.activity_type === 'comment' && <span className="text-white/60 text-[12px] mr-1">comment:</span>}
                            <span className="text-white">{a.message}</span>
                            <span className="text-white/60 ml-1.5">{new Date(a.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              }
            </div>
            {/* end scrollable area */}
          </div>

          {/* ─── Properties Panel ─── */}
          <div className={`overflow-y-auto ${mode === 'create' ? 'rounded-r-lg' : ''}`} style={{ background: 'var(--bg)', borderLeft: '0.5px solid var(--border-default)', borderRight: mode !== 'create' ? '0.5px solid var(--border-default)' : 'none' }}>

            {/* ETA banner (edit mode only) */}
            {mode !== 'create' && !hasAutoScheduledTasks && tasks.length > 0 && (
              <div className="flex items-start gap-2 px-4 py-3 bg-hover/50 border-b border-border">
                <IconClock size={14} className="text-text-dim shrink-0 mt-0.5" />
                <span className="text-[11px] text-text-dim leading-tight">No ETA because there are no auto-scheduled tasks in this project</span>
              </div>
            )}

            {/* Missed deadline banner */}
            {mode !== 'create' && hasMissedDeadline && (
              <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ background: 'rgba(239, 83, 80, 0.12)', borderColor: 'rgba(239, 83, 80, 0.15)' }}>
                <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: '#ef5350' }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3M8 10h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  Missed deadline
                </div>
                <button
                  onClick={() => setShowResolvePopup(true)}
                  className="text-[12px] font-medium hover:text-white px-2.5 py-1 rounded-md transition-colors"
                  style={{ color: '#ef5350', background: 'rgba(239, 83, 80, 0.15)' }}
                >
                  Resolve
                </button>
              </div>
            )}

            {/* Missed deadline resolve popup */}
            {showResolvePopup && typeof document !== 'undefined' && createPortal(
              <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setShowResolvePopup(false)}>
                <div className="fixed inset-0 bg-black/60" />
                <div
                  {...popupSurfaceDataProps}
                  className={withPopupSurfaceClassName('relative rounded-xl border border-border shadow-2xl animate-glass-in w-[420px] max-h-[90vh] overflow-y-auto')}
                  style={{ background: '#1e2124' }}
                  onMouseDown={stopPopupMouseDown}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 pt-5 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-red/15 flex items-center justify-center">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-red">
                          <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.3"/>
                          <path d="M8 5v3M8 10h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-[14px] font-semibold text-white">Missed deadline</h3>
                        <p className="text-[12px] text-text-dim">
                          {projectDeadline
                            ? `Due ${projectDeadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${daysMissed} day${daysMissed !== 1 ? 's' : ''} overdue`
                            : 'Tasks in this project have missed deadlines'}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setShowResolvePopup(false)} className="text-text-dim hover:text-white transition-colors p-1 rounded hover:bg-hover">
                      <IconX size={16} />
                    </button>
                  </div>

                  <div className="px-5 pb-5 space-y-4">
                    {/* Extend deadline section */}
                    {projectDeadline && (
                      <div>
                        <p className="text-[12px] text-text-dim font-medium mb-2.5 uppercase tracking-wide">Extend deadline</p>
                        <div className="grid grid-cols-3 gap-2">
                          {(() => {
                            const endOfWeek = new Date(now)
                            endOfWeek.setDate(now.getDate() + (7 - now.getDay()))
                            const oneMonth = new Date(now)
                            oneMonth.setMonth(now.getMonth() + 1)
                            const twoWeeks = new Date(now)
                            twoWeeks.setDate(now.getDate() + 14)
                            const options = [
                              { label: 'End of week', date: endOfWeek },
                              { label: '2 weeks', date: twoWeeks },
                              { label: '1 month', date: oneMonth },
                            ]
                            return options.map(opt => (
                              <button
                                key={opt.label}
                                onClick={async () => {
                                  await saveField('deadline', opt.date.toISOString().split('T')[0])
                                  setShowResolvePopup(false)
                                }}
                                className="flex flex-col items-center gap-1 px-3 py-3 rounded-lg border border-border hover:border-white/20 hover:bg-hover transition-colors"
                              >
                                <span className="text-[13px] font-medium text-white">{opt.label}</span>
                                <span className="text-[11px] text-text-dim">{opt.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              </button>
                            ))
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Divider */}
                    <div className="border-t border-border" />

                    {/* Complete project */}
                    <button
                      onClick={async () => {
                        await saveField('status', 'closed')
                        setShowResolvePopup(false)
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-md bg-green/15 flex items-center justify-center shrink-0">
                        <IconCheck size={14} className="text-green" />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-white">Complete project</p>
                        <p className="text-[11px] text-text-dim">Mark as done and close</p>
                      </div>
                    </button>

                    {/* Cancel project */}
                    <button
                      onClick={async () => {
                        await saveField('status', 'archived')
                        setShowResolvePopup(false)
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-md bg-red/10 flex items-center justify-center shrink-0">
                        <IconX size={14} className="text-red" />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-white">Cancel project</p>
                        <p className="text-[11px] text-text-dim">Cancel and archive</p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )}

            <div>
              {/* Workspace / Folder / Stage hierarchy */}
              <div className="flex flex-col gap-3 p-4 lg:py-5 lg:px-5 text-[14px] text-white">
                {/* Workspace */}
                <div className="flex items-center gap-2.5">
                  <IconWorkspace size={18} className="shrink-0" strokeWidth={1.8} style={{ color: workspace?.color || 'var(--text-secondary)' }} />
                  <span>{workspace?.name || 'Unknown'}</span>
                </div>
                {/* Folder */}
                <div
                  className="flex items-center gap-2.5 cursor-pointer hover:text-text transition-colors"
                  onClick={e => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    setFolderPopupPos({ top: rect.bottom + 4, left: rect.left })
                    setFolderPopupOpen(true)
                    setFolderFilter('')
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: currentFolder ? (project.color || '#4ade80') : 'var(--text-dim)' }}>
                    <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                  {currentFolder ? (
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">{currentFolder.name}</span>
                  ) : (
                    <span>No folder</span>
                  )}
                </div>
                {/* Folder picker popup */}
                {folderPopupOpen && folderPopupPos && typeof document !== 'undefined' && createPortal(
                  <div className="fixed inset-0 z-[9999]" onClick={() => setFolderPopupOpen(false)}>
                    <div
                      {...popupSurfaceDataProps}
                      className={withPopupSurfaceClassName('fixed rounded-lg border border-border shadow-2xl animate-glass-in overflow-hidden')}
                      style={{ top: folderPopupPos.top, left: folderPopupPos.left, minWidth: 280, maxHeight: 340, background: 'var(--border)' }}
                      onMouseDown={stopPopupMouseDown}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="px-3 pt-3 pb-2">
                        <input
                          autoFocus
                          value={folderFilter}
                          onChange={e => setFolderFilter(e.target.value)}
                          placeholder="Filter..."
                          className="w-full text-sm rounded-md px-2.5 py-1.5 outline-none text-text border border-transparent focus:border-white/15"
                          style={{ background: 'var(--bg-chrome)' }}
                        />
                      </div>
                      <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                        {(() => {
                          const ws = sidebarData.find((w: any) => w.id === project.workspace_id)
                          if (!ws) return <div className="px-3 py-2 text-sm text-text-dim">No workspace found</div>
                          const q = folderFilter.toLowerCase()
                          const folderMatches = (f: any): boolean =>
                            f.name.toLowerCase().includes(q) || (f.subFolders || []).some((sf: any) => folderMatches(sf))
                          const renderFolders = (folders: any[], depth: number): React.ReactNode =>
                            folders.filter((f: any) => !q || folderMatches(f)).map((f: any) => {
                              const fc = f.color || '#6b7280'
                              return (
                                <div key={f.id}>
                                  <button
                                    onClick={() => {
                                      setCurrentFolder({ id: f.id, public_id: f.public_id || '', name: f.name, color: fc, workspace_id: project.workspace_id, parent_id: f.parent_id ?? null, sort_order: 0, created_at: 0, updated_at: 0 })
                                      saveField('folder_id', f.id)
                                      setFolderPopupOpen(false)
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text bg-transparent border-none cursor-pointer hover:bg-white/5 text-left"
                                    style={{ paddingLeft: 12 + depth * 16 }}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M2 4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" fill={fc} fillOpacity="0.3" stroke={fc} strokeWidth="1.2" /></svg>
                                    <span className={`overflow-hidden text-ellipsis whitespace-nowrap ${currentFolder?.id === f.id ? 'font-semibold' : ''}`} style={{ maxWidth: 200 }}>{f.name}</span>
                                  </button>
                                  {f.subFolders?.length > 0 && renderFolders(f.subFolders, depth + 1)}
                                </div>
                              )
                            })
                          return renderFolders(ws.folders || [], 0)
                        })()}
                      </div>
                      <div className="border-t border-border/30 px-3 py-2">
                        <button
                          onClick={() => { setCurrentFolder(null); saveField('folder_id', null); setFolderPopupOpen(false) }}
                          className="w-full flex items-center gap-2 text-sm text-text-dim bg-transparent border-none cursor-pointer hover:text-text text-left py-1"
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-muted"><path d="M2 4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2" /></svg>
                          No folder
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
                {/* Active stage */}
                {(() => {
                  const activeStage = stages.find(s => s.is_active) || stages[0]
                  if (!activeStage) return (
                    <div className="flex" ><StagePill name="No Stage" color="#6b7280" size="sm" /></div>
                  )
                  return (
                    <div ><StagePill name={activeStage.name} color={activeStage.color} size="sm" /></div>
                  )
                })()}
              </div>

              {/* Properties section */}
              <div className="flex flex-col gap-0.5 px-3 py-3 lg:px-5 border-t border-border/30">

              {/* Assignee */}
              <PropRow label="Assignee:">
                <Dropdown
                  value={project.assignee || ''}
                  onChange={v => saveField('assignee', v || null)}
                  placeholder="Unassigned"
                  minWidth={140}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...ASSIGNEE_OPTIONS.map(a => ({
                      value: a.id,
                      label: a.name,
                    })),
                  ]}
                  renderOption={(opt, isSelected) => {
                    const m = ASSIGNEE_OPTIONS.find(a => a.id === opt.value)
                    return (
                      <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${isSelected ? 'bg-[rgba(255,255,255,0.08)]' : 'hover:bg-[rgba(255,255,255,0.06)]'}`} style={{ borderRadius: 'var(--radius-sm)' }}>
                        {m ? (
                          <Avatar name={m.name} size={18} src={m.avatar} color={m.color} />
                        ) : (
                          <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-border text-text-dim shrink-0">
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                          </div>
                        )}
                        <span className="flex-1 text-text truncate">{opt.label}</span>
                        {isSelected && <IconCheck size={12} className="shrink-0 text-blue" />}
                      </div>
                    )
                  }}
                  renderTrigger={({ selected }) => {
                    const a = findAssignee(project.assignee, ASSIGNEE_OPTIONS)
                    return (
                      <button type="button" className="flex items-center gap-1.5 px-1 py-0.5 rounded-sm text-[14px] text-text hover:bg-[rgba(255,255,255,0.06)] cursor-pointer transition-colors">
                        {a ? <Avatar name={a.name} size={18} src={a.avatar} color={a.color} /> : null}
                        {selected?.label || 'Unassigned'}
                      </button>
                    )
                  }}
                />
              </PropRow>

              {/* Status */}
              <PropRow label="Status:">
                <Dropdown
                  value={project.status}
                  onChange={v => saveField('status', v)}
                  minWidth={120}
                  options={TASK_STATUS_OPTIONS}
                  renderTrigger={() => <StatusTrigger status={project.status} />}
                  renderOption={(opt, isSelected) => renderStatusOption(opt, isSelected)}
                />
              </PropRow>

              {/* Start date */}
              <PropRow label="Start date:">
                <ProjectDatePicker
                  value={project.start_date || null}
                  onChange={v => saveField('start_date', v)}
                  icon="start"
                />
              </PropRow>

              {/* Deadline */}
              <PropRow label="Deadline:">
                <ProjectDatePicker
                  value={project.deadline || null}
                  onChange={v => saveField('deadline', v)}
                  icon="deadline"
                />
              </PropRow>

              {/* Priority */}
              <PropRow label="Priority:">
                <Dropdown
                  value={project.priority || ''}
                  onChange={v => saveField('priority', v || null)}
                  placeholder="None"
                  minWidth={120}
                  options={PRIORITY_OPTIONS.map(p => ({ value: p.value, label: p.label }))}
                  renderOption={renderPriorityOption}
                  renderTrigger={() => {
                    const p = PRIORITY_OPTIONS.find(o => o.value === (project.priority || '')) || PRIORITY_OPTIONS[0]
                    return (
                      <button type="button" className="flex items-center gap-1.5 px-1 py-0.5 rounded-sm text-[14px] text-text hover:bg-[rgba(255,255,255,0.06)] cursor-pointer transition-colors">
                        {p.value && <PriorityIcon priority={p.value} size={14} />}
                        <span style={{ color: p.color }}>{p.label}</span>
                      </button>
                    )
                  }}
                />
              </PropRow>

              {/* Color */}
              <PropRow label="Color:">
                <Dropdown
                  value={project.color}
                  onChange={(v) => saveField('color', v)}
                  options={APP_COLORS.map(c => ({ value: c.value, label: c.name }))}
                  renderOption={(opt, isSelected) => (
                    <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${isSelected ? 'bg-[rgba(255,255,255,0.08)]' : 'hover:bg-[rgba(255,255,255,0.06)]'}`} style={{ borderRadius: 'var(--radius-sm)' }}>
                      <span className="w-3.5 h-3.5 rounded-[3px] shrink-0" style={{ background: opt.value }} />
                      <span className="flex-1 text-text truncate">{opt.label}</span>
                      {isSelected && <IconCheck size={12} className="shrink-0" style={{ color: '#ffffff' }} />}
                    </div>
                  )}
                  renderTrigger={({ selected }) => (
                    <button type="button" className="flex items-center gap-1.5 text-[14px] text-text hover:opacity-80 transition-opacity cursor-pointer">
                      <span className="w-3.5 h-3.5 rounded-[3px]" style={{ background: project.color }} />
                      {getColorName(project.color)}
                    </button>
                  )}
                  minWidth={140}
                />
              </PropRow>

              {/* Labels */}
              <PropRow label="Labels:">
                <LabelPicker
                  currentLabels={project.labels || ''}
                  allLabels={allLabels}
                  onUpdate={val => saveField('labels', val || null)}
                  onLabelsRefresh={() => fetch('/api/labels').then(r => r.json()).then(d => { if (Array.isArray(d)) setAllLabels(d) }).catch(() => {})}
                  compact
                />
              </PropRow>

              </div>{/* end properties section */}

              {/* Actions */}
              <div className="space-y-1 px-3 py-3 lg:px-5 border-t border-border/30">
                <button onClick={() => setShowAIDialog(true)} className="flex items-center gap-1.5 w-full px-1.5 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-hover/40 rounded-md transition-colors">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-dim"><path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                  Generate tasks with AI
                </button>
                <button className="flex items-center gap-1.5 w-full px-1.5 py-1.5 text-[13px] font-medium text-text-dim hover:bg-hover/40 rounded-md transition-colors">
                  <IconPlus size={16} className="text-text-dim" />
                  Add custom field
                </button>
                {mode !== 'create' && (
                  <button onClick={() => setShowDeleteConfirm(true)} className="flex items-center gap-1.5 w-full px-1.5 py-1.5 text-[13px] font-medium text-red hover:bg-hover/40 rounded-md transition-colors">
                    <IconTrash size={14} />
                    Delete project
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ─── RIGHT: Tasks Panel (edit mode only) ─── */}
          {mode !== 'create' && <div className="flex flex-col min-h-0 overflow-y-auto rounded-r-lg" style={{ background: 'var(--bg-surface)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-text">Tasks</span>
                <span className="text-[11px] text-text-dim px-1.5 py-0.5 rounded-md bg-hover">{tasks.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setAddingTaskStage(-1)} className="p-1.5 rounded-md hover:bg-hover text-text-dim hover:text-text" title="Add task">
                  <IconPlus size={14} />
                </button>
              </div>
            </div>

            {/* Stage timeline bar */}
            {stages.length > 0 && (() => {
              // Compute date ranges for each stage from its tasks
              const stageTimeline = stages.map(s => {
                const stageTasks = tasks.filter(t => t.stage_id === s.id)
                const starts = stageTasks.map(t => t.scheduled_start || t.start_date).filter(Boolean) as string[]
                const ends = stageTasks.map(t => t.due_date || t.scheduled_end).filter(Boolean) as string[]
                const earliest = starts.length > 0 ? starts.sort()[0] : null
                const latest = ends.length > 0 ? ends.sort().reverse()[0] : null
                const allDone = stageTasks.length > 0 && stageTasks.every(t => t.status === 'done')
                const hasActive = stageTasks.some(t => t.status === 'in_progress')
                return { stage: s, start: earliest, end: latest, allDone, hasActive }
              })

              const fmtShort = (iso: string) => {
                const d = new Date(iso)
                return `${d.getMonth() + 1}/${d.getDate()}`
              }

              // Find first start and last end across all stages
              const allStarts = stageTimeline.map(st => st.start).filter(Boolean) as string[]
              const allEnds = stageTimeline.map(st => st.end).filter(Boolean) as string[]
              const firstDate = allStarts.length > 0 ? allStarts.sort()[0] : null
              const lastDate = allEnds.length > 0 ? allEnds.sort().reverse()[0] : null

              return (
                <div className="px-4 py-3 border-b border-border shrink-0" style={{ background: 'var(--bg-elevated)' }}>
                  {/* Circles row -- lines connect at circle center */}
                  <div className="relative">
                    <div className="flex items-center" style={{ height: 18 }}>
                      {stageTimeline.map((st, i) => {
                        const color = st.allDone ? '#00e676' : st.stage.color
                        return (
                          <div key={st.stage.id} className="contents">
                            {i > 0 && (
                              <div className="flex-1 h-[3px] rounded-full" style={{ background: stageTimeline[i - 1].allDone ? '#00e676' : stageTimeline[i - 1].stage.color, opacity: 0.5 }} />
                            )}
                            <div
                              className="w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0"
                              style={{ background: color }}
                              title={st.stage.name}
                            >
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6h7M6.5 3L9.5 6L6.5 9" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {/* Dates row */}
                    {(firstDate || lastDate) && (
                      <div className="flex justify-between mt-1" style={{ height: 14 }}>
                        <span className="text-[10px] text-text-dim font-medium whitespace-nowrap">{firstDate ? fmtShort(firstDate) : ''}</span>
                        <span className="text-[10px] text-text-dim font-medium whitespace-nowrap">{lastDate ? fmtShort(lastDate) : ''}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            <div className="flex-1 overflow-y-auto">
              {/* Inline task creation form -- appears at top, before stages */}
              {addingTaskStage !== null && (
                <div className="border-b border-border/40 px-4 py-2" style={{ background: 'var(--bg-chrome)' }}>
                  {/* Row 1: Status + Name + Auto-schedule switch -- matches TaskRow h-[32px] */}
                  <div className="flex items-center gap-2" style={{ height: 32, marginBottom: 4 }}>
                    <StatusIcon status="todo" size={14} />
                    <input
                      autoFocus
                      value={newTaskTitle}
                      onChange={e => setNewTaskTitle(e.target.value)}
                      placeholder="Name"
                      className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-text-dim/60"
                      style={{ color: '#fff' }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) handleAddTask(addingTaskStage === -1 ? null : addingTaskStage)
                        if (e.key === 'Escape') resetNewTask()
                      }}
                    />
                    {/* Auto-schedule sliding switch */}
                    <AutoScheduleToggle
                      size="sm"
                      compact
                      active={newTaskAutoSchedule}
                      onChange={() => setNewTaskAutoSchedule(!newTaskAutoSchedule)}
                    />
                    <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-border shrink-0" title="Unassigned">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.3"/></svg>
                    </div>
                  </div>
                  {/* Row 2: Description */}
                  <div style={{ paddingLeft: 22, marginBottom: 6 }}>
                    <input value={newTaskDesc} onChange={e => setNewTaskDesc(e.target.value)} placeholder="Description" className="text-[13px] w-full bg-transparent outline-none placeholder:text-text-dim/40" style={{ color: 'var(--text-secondary)' }} />
                  </div>
                  {/* Row 3: Quick-set buttons */}
                  <div className="flex items-center gap-1.5" style={{ paddingLeft: 22, marginBottom: 6 }}>
                    <button onClick={() => { const k = Object.keys(PRIORITY_CONFIG); setNewTaskPriority(k[(k.indexOf(newTaskPriority) + 1) % k.length]) }} className="flex items-center justify-center rounded" style={{ width: 24, height: 24, background: 'rgba(255,255,255,0.07)' }}><PriorityIcon priority={newTaskPriority} size={12} /></button>
                    <button className="flex items-center justify-center rounded" style={{ width: 24, height: 24, background: 'rgba(255,255,255,0.07)' }}><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4l5.5-2L14 4v7l-5.5 3L3 11V4z" stroke="var(--text-secondary)" strokeWidth="1.3" strokeLinejoin="round"/></svg></button>
                    <div className="flex items-center justify-center rounded-full overflow-hidden" style={{ width: 24, height: 24, background: 'rgba(255,255,255,0.07)' }}><Avatar name="You" size={24} /></div>
                    <span className="text-[11px] text-text-dim px-1.5 py-px rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>{newTaskDuration} min</span>
                    <span className="text-[11px] text-text-dim px-1.5 py-px rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>Due tomorrow</span>
                  </div>
                  {/* Row 4: Blockers + Cancel/Save */}
                  <div className="flex items-center justify-between pt-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-[11px] text-text px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>Blocked by 0 tasks</span>
                    <div className="flex items-center gap-2">
                      <button onClick={resetNewTask} className="text-[11px] text-text-dim hover:text-text">Cancel</button>
                      <button onClick={() => handleAddTask(addingTaskStage === -1 ? null : addingTaskStage)} disabled={!newTaskTitle.trim()} className="flex items-center gap-1 text-[11px] text-text-dim px-2 py-0.5 rounded disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.08)' }}>Save <span className="opacity-40">&#8984;&#8629;</span></button>
                    </div>
                  </div>
                </div>
              )}

              {tasksByStage.map((group) => {
                // Compute stage date range from tasks
                const stageTasks = group.tasks
                const stageStartDate = stageTasks.reduce((min, t) => {
                  const d = t.scheduled_start || t.start_date
                  if (!d) return min
                  return !min || d < min ? d : min
                }, '' as string)
                const stageEndDate = stageTasks.reduce((max, t) => {
                  const d = t.due_date || t.scheduled_end
                  if (!d) return max
                  return !max || d > max ? d : max
                }, '' as string)
                const fmtStageDate = (iso: string) => {
                  if (!iso) return ''
                  const d = new Date(iso)
                  const day = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()]
                  return `${day} ${d.getMonth() + 1}/${d.getDate()}`
                }
                // Check if stage deadline is missed
                const now = new Date()
                const deadlineMissed = stageEndDate && new Date(stageEndDate) < now && stageTasks.some(t => t.status !== 'done' && t.status !== 'cancelled')
                const daysMissed = deadlineMissed ? Math.floor((now.getTime() - new Date(stageEndDate).getTime()) / 86400000) : 0

                return (
                <div key={group.stage?.id ?? 'unstaged'}>
                  {/* Stage header */}
                  {(stages.length > 0 || !group.stage) && (
                    <div className="flex items-center gap-2 px-4 py-2 group/stage">
                      <div className="min-w-0 flex-1 overflow-hidden" style={{ marginLeft: -4 }}>
                        {group.stage ? (
                          <StagePill name={group.stage.name} color={group.stage.color || 'var(--text-dim)'} size="sm" />
                        ) : (
                          <div className="flex"><StagePill name="No Stage" color="#6b7280" size="sm" /></div>
                        )}
                      </div>

                      {/* Convert to stage button for unstaged tasks */}
                      {!group.stage && (
                        <button
                          onClick={() => { setShowCreateStage(true); setNewStageName('') }}
                          className="shrink-0 px-2.5 py-1 rounded-md text-[12px] font-medium text-text hover:bg-hover transition-colors"
                          style={{ background: 'rgba(255,255,255,0.08)' }}
                        >
                          Convert to stage
                        </button>
                      )}

                      {/* Hover action buttons */}
                      {group.stage && (
                        <div className="hidden group-hover/stage:flex items-center gap-0.5 shrink-0">
                          {/* Auto-schedule all */}
                          <span onClick={e => e.stopPropagation()}>
                            <AutoScheduleToggle
                              size="sm"
                              compact
                              active={stageTasks.every(t => !!t.auto_schedule)}
                              onChange={async () => {
                                const allOn = stageTasks.every(t => !!t.auto_schedule)
                                for (const t of stageTasks) {
                                  await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, auto_schedule: allOn ? 0 : 1 }) })
                                }
                                onProjectUpdate?.(project)
                              }}
                            />
                          </span>
                          {/* Complete stage */}
                          <button
                            onClick={async () => {
                              if (!group.stage) return
                              for (const t of stageTasks.filter(t => t.status !== 'done')) {
                                await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, status: 'done', completed_at: new Date().toISOString() }) })
                              }
                              onProjectUpdate?.(project)
                            }}
                            className="p-1 rounded hover:bg-hover text-green hover:text-green" title="Complete stage"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          {/* Cancel stage */}
                          <button
                            onClick={async () => {
                              if (!group.stage) return
                              for (const t of stageTasks.filter(t => t.status !== 'cancelled')) {
                                await fetch('/api/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, status: 'cancelled' }) })
                              }
                              onProjectUpdate?.(project)
                            }}
                            className="p-1 rounded hover:bg-hover text-text-dim hover:text-text" title="Cancel stage"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                          </button>
                          {/* Delete stage */}
                          <button
                            onClick={async () => {
                              if (!group.stage || !confirm(`Delete stage "${group.stage.name}"? Tasks will move to "No Stage".`)) return
                              await fetch('/api/stages', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: group.stage.id }) })
                              onProjectUpdate?.(project)
                            }}
                            className="p-1 rounded hover:bg-hover text-red hover:text-red" title="Remove stage"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 5h8l-.7 8H4.7L4 5zM6.5 3h3M3 5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                        </div>
                      )}

                      {/* Missed deadline indicator */}
                      {deadlineMissed && (
                        <span className="shrink-0 flex items-center justify-center w-[22px] h-[22px] rounded-md bg-red/20 text-red cursor-pointer" title={`Missed deadline by ${daysMissed} day${daysMissed !== 1 ? 's' : ''}\nClick to see how to resolve this\nETA: ${stageEndDate ? new Date(stageEndDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '--'}`}>
                          <span className="text-[9px] font-black leading-none">!!!</span>
                        </span>
                      )}

                      {/* Date range */}
                      {stageStartDate && (
                        <span className="ml-auto text-[12px] text-text-dim shrink-0 whitespace-nowrap">
                          {fmtStageDate(stageStartDate)} - <span className="text-text font-medium">{fmtStageDate(stageEndDate)}</span>
                        </span>
                      )}

                      {/* Add task to stage */}
                      {group.stage && (
                        <button onClick={() => setAddingTaskStage(group.stage!.id)} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text shrink-0 hidden group-hover/stage:block" title="Add task">
                          <IconPlus size={12} />
                        </button>
                      )}
                    </div>
                  )}

                  {group.tasks.map(task => (
                    <TaskRow key={task.id} task={task} onClick={() => setSelectedTaskId(task.id)} />
                  ))}

                  {/* Add task below each stage's/unstaged tasks */}
                  <button
                    onClick={() => setAddingTaskStage(group.stage?.id ?? -1)}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] text-text-dim hover:text-text-secondary transition-colors w-full"
                  >
                    <IconPlus size={10} />
                    Add task
                  </button>

                </div>
              )})}

              {/* Add stage button -- only when stages already exist */}
              {stages.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2">
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  <button
                    onClick={() => { setShowCreateStage(true); setNewStageName('') }}
                    className="flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text-secondary transition-colors shrink-0"
                  >
                    <IconPlus size={10} />
                    Add stage
                  </button>
                  <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                </div>
              )}

              {/* Empty state */}
              {tasks.length === 0 && stages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                  <p className="text-[13px] text-text-dim">No tasks yet</p>
                  <button
                    onClick={() => setAddingTaskStage(-1)}
                    className="mt-2 text-[13px] text-text-secondary hover:text-text transition-colors"
                  >
                    + Add a task
                  </button>
                </div>
              )}
            </div>
          </div>
          }
        </div>

        {/* Create stage modal */}
        {showCreateStage && createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowCreateStage(false)}>
            <div
              className="w-[420px] rounded-lg overflow-hidden"
              style={{ background: 'var(--bg-modal, var(--bg-surface))', border: '1px solid var(--border-default)', boxShadow: 'var(--glass-shadow-lg)' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
                <h3 className="text-[15px] font-semibold text-text">Create new stage</h3>
                <button onClick={() => setShowCreateStage(false)} className="p-1 rounded hover:bg-hover text-text-dim hover:text-text">
                  <IconX size={14} />
                </button>
              </div>
              <div className="px-5 py-5">
                <div className="flex items-center gap-3">
                  <span className="shrink-0 rounded-full flex items-center justify-center" style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.1)' }}>
                    <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6h7M6.5 3L9.5 6L6.5 9" stroke="var(--text-secondary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <input
                    autoFocus
                    value={newStageName}
                    onChange={e => setNewStageName(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && newStageName.trim()) {
                        const res = await fetch('/api/stages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, name: newStageName.trim() }) })
                        if (res.ok) { const stage = await res.json(); setStages(prev => [...prev, stage]); setShowCreateStage(false); onProjectUpdate?.(project) }
                      }
                    }}
                    placeholder="Stage name"
                    className="flex-1 px-3 py-2 rounded-md text-[14px] text-white placeholder:text-text-dim outline-none border border-border/50 focus:border-white/20"
                    style={{ background: 'var(--bg-chrome)' }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/30">
                <button onClick={() => setShowCreateStage(false)} className="px-3.5 py-1.5 rounded-md text-[13px] font-medium text-text hover:bg-hover transition-colors" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  Cancel
                </button>
                <button
                  disabled={!newStageName.trim()}
                  onClick={async () => {
                    const res = await fetch('/api/stages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, name: newStageName.trim() }) })
                    if (res.ok) { const stage = await res.json(); setStages(prev => [...prev, stage]); setShowCreateStage(false); onProjectUpdate?.(project) }
                  }}
                  className="px-3.5 py-1.5 rounded-md text-[13px] font-medium text-text disabled:opacity-30 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  Create new stage
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Create mode footer — matching Motion: Cancel (Esc) + Save project (⌘S) */}
        {mode === 'create' && (
          <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-border shrink-0">
            <button onClick={onClose} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] text-text-dim hover:text-text hover:bg-hover transition-colors">
              Cancel
              <kbd className="text-[11px] text-text-dim bg-hover px-1.5 py-0.5 rounded">Esc</kbd>
            </button>
            <button
              onClick={() => {
                if (!project.name.trim()) return
                const desc = editorRef.current?.innerHTML || ''
                onCreate?.({
                  name: project.name.trim(),
                  description: desc,
                  workspaceId: project.workspace_id,
                  assignee: project.assignee || undefined,
                  status: project.status || 'open',
                  priority: project.priority || undefined,
                  color: project.color || '#ef5350',
                  labels: project.labels || undefined,
                  start_date: project.start_date || undefined,
                  deadline: project.deadline || undefined,
                })
              }}
              disabled={!project.name.trim()}
              className="flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-medium text-white bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save project
              <kbd className="text-[11px] text-white/60 bg-white/10 px-1.5 py-0.5 rounded">⌘S</kbd>
            </button>
          </div>
        )}

        {/* Task detail panel overlay */}
        {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />}

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
            <div className="w-full max-w-[360px] bg-elevated rounded-xl border border-border shadow-2xl p-6 space-y-4">
              <h3 className="text-[15px] font-semibold text-text">Delete project?</h3>
              <p className="text-[13px] text-text-secondary">This will delete all {stages.length} stages. {tasks.length} tasks will be unassigned but not deleted.</p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-1.5 rounded-md text-[12px] text-text-dim hover:bg-hover">Cancel</button>
                <button onClick={handleDelete} className="px-4 py-1.5 rounded-md bg-red text-white text-[12px] font-medium hover:bg-red/80">Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Save as Template modal */}
        {showTemplateModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
            <div className="w-full max-w-[400px] bg-elevated rounded-xl border border-border shadow-2xl p-6 space-y-4">
              <h3 className="text-[15px] font-semibold text-text">Save as Template</h3>
              <div className="space-y-3">
                <input autoFocus value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Template name" className="w-full bg-hover border border-border rounded-lg px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent/50" />
                <textarea value={templateDesc} onChange={e => setTemplateDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full bg-hover border border-border rounded-lg px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim/50 resize-none focus:border-accent/50" />
              </div>
              <div className="text-[12px] text-text-dim">Will save {stages.length} stages and {tasks.length} tasks as a reusable template.</div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setShowTemplateModal(false)} className="px-4 py-1.5 rounded-md text-[12px] text-text-dim hover:bg-hover">Cancel</button>
                <button onClick={handleSaveAsTemplate} disabled={savingTemplate || !templateName.trim()} className="px-4 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent/80 disabled:opacity-50">{savingTemplate ? 'Saving...' : 'Save Template'}</button>
              </div>
            </div>
          </div>
        )}

        {/* AI Dialog */}
        {showAIDialog && (
          <AIProjectDialog workspaceId={project.workspace_id} folderId={project.folder_id ?? undefined} onClose={() => setShowAIDialog(false)} onCreated={() => { setShowAIDialog(false); window.location.reload() }} />
        )}
      </div>
    </div>
  )
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 min-h-[30px] w-full px-1 text-[14px] text-text hover:bg-hover/40 transition-colors rounded-sm">
      <span className="text-[14px] shrink-0 text-text-secondary">{label}</span>
      <div className="flex-1 min-w-0 flex items-center">{children}</div>
    </div>
  )
}

const TASK_PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef5350',
  high: '#ff7043',
  medium: '#ffd740',
  low: '#78909c',
}

function formatDateFriendly(dateStr: string | null): string {
  if (!dateStr) return 'None'
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`
}

function ProjectDatePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void; icon: 'start' | 'deadline' }) {
  return (
    <DatePicker
      value={value || ''}
      onChange={v => onChange(v || null)}
      size="sm"
      placeholder="No date"
    />
  )
}

// ProjectLabelEditor removed -- now uses shared LabelPicker component

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const ASSIGNEE_OPTIONS = useTeamMembers()
  const isDone = task.status === 'done'

  const assignee = findAssignee(task.assignee, ASSIGNEE_OPTIONS)

  return (
    <button onClick={onClick} className="flex items-center gap-2 w-full px-4 h-[32px] text-left hover:bg-hover/40 transition-colors group" title={task.title}>
      {/* Status circle */}
      <span title={task.status.replace(/_/g, ' ')}>
        <StatusIcon status={task.status} size={14} />
      </span>

      {/* Title */}
      <span className={`flex-1 text-[13px] truncate ${isDone ? 'text-text-dim' : 'text-text'}`}>{task.title}</span>

      {/* Duration */}
      {task.duration_minutes > 0 && <span className="text-[11px] text-text-dim shrink-0">{formatDuration(task.duration_minutes)}</span>}

      {/* Auto-schedule toggle (sm) */}
      <span className="shrink-0" onClick={e => e.stopPropagation()}>
        <AutoScheduleToggle
          size="sm"
          compact
          active={!!task.auto_schedule}
          onChange={async () => {
            await fetch('/api/tasks', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: task.id, auto_schedule: task.auto_schedule ? 0 : 1 }),
            })
          }}
        />
      </span>

      {/* Assignee avatar */}
      {assignee ? (
        <span title={assignee.name} className="shrink-0">
          <Avatar name={assignee.name} size={18} src={assignee.avatar} color={assignee.color} />
        </span>
      ) : (
        <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-border shrink-0" title="Unassigned">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.3"/></svg>
        </div>
      )}
    </button>
  )
}
