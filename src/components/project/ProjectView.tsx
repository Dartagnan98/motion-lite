'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { Task, Project, Stage, Workspace, Doc, Folder } from '@/lib/types'
import { StagePill } from '@/components/ui/StagePill'
import { useTabContext } from '@/components/AppShell'
import { getColorName } from '@/lib/colors'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel'
import { AIProjectDialog } from './AIProjectDialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { useTeamMembers } from '@/lib/use-team-members'
import { findAssignee } from '@/lib/assignee-utils'
import { Avatar } from '@/components/ui/Avatar'
import { PROJECT_STATUS_OPTIONS as STATUS_OPTIONS, PRIORITY_COLORS, formatDuration } from '@/lib/task-constants'
import { IconCopy, IconMoreHorizontal, IconSparkle, IconTrash, IconClock, IconChevronRight, IconPlus } from '@/components/ui/Icons'

interface ProjectViewProps {
  project: Project
  stages: Stage[]
  tasks: Task[]
  workspace: Workspace | null
  docs: Doc[]
  folder: Folder | null
}

export function ProjectView({ project: initialProject, stages: initialStages, tasks: initialTasks, workspace, docs: initialDocs, folder }: ProjectViewProps) {
  const teamMembers = useTeamMembers()
  const [project, setProject] = useState(initialProject)
  const [stages, setStages] = useState(initialStages)
  const [tasks, setTasks] = useState(initialTasks)
  const [docs, setDocs] = useState(initialDocs)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [description, setDescription] = useState(project.description || '')
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [showAIDialog, setShowAIDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [showDocs, setShowDocs] = useState(true)
  const [showAttachments, setShowAttachments] = useState(false)
  const [addingTaskStage, setAddingTaskStage] = useState<number | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef<HTMLDivElement>(null)
  const tabCtx = useTabContext()

  useEffect(() => {
    if (tabCtx) tabCtx.setTabInfo(project.name, 'project')
  }, [project.name])

  useEffect(() => {
    if (editorRef.current && project.description) {
      editorRef.current.innerHTML = project.description
    }
  }, [])

  // Close color picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowColorPicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function saveField(field: string, value: unknown) {
    setProject(prev => ({ ...prev, [field]: value } as Project))
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
    await fetch('/api/projects', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project.id }),
    })
    window.location.href = '/'
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

  async function handleAddTask(stageId: number | null) {
    if (!newTaskTitle.trim()) return
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTaskTitle.trim(),
        project_id: project.id,
        stage_id: stageId,
        workspace_id: project.workspace_id,
        status: 'todo',
      }),
    })
    setNewTaskTitle('')
    setAddingTaskStage(null)
    window.location.reload()
  }

  async function handleCreateDoc() {
    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, workspaceId: project.workspace_id }),
    })
    const doc = await res.json()
    if (doc?.public_id) window.location.href = `/doc/${doc.public_id}`
    else if (doc?.id) window.location.href = `/doc/${doc.id}`
  }

  // Check if project has a missed deadline
  const hasMissedDeadline = tasks.some(t =>
    t.due_date && new Date(t.due_date + 'T23:59:59') < new Date() &&
    t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'archived'
  )

  const doneCount = tasks.filter(t => t.status === 'done').length
  // Group tasks by stage for the right panel
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

  return (
    <div className="h-full flex min-h-0">

      {/* ─── LEFT: Content Panel ─── */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border overflow-y-auto">

        {/* Header actions */}
        <div className="flex items-center justify-between px-4 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] text-text-dim hover:bg-hover hover:text-text transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.2"/><path d="M5 2v4h6V2" stroke="currentColor" strokeWidth="1.2"/><path d="M10 3v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              Use template
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button className="rounded-md p-1.5 text-text-dim hover:bg-hover hover:text-text" title="Copy">
              <IconCopy size={14} />
            </button>
            <button className="rounded-md p-1.5 text-text-dim hover:bg-hover hover:text-text" title="More">
              <IconMoreHorizontal size={14} />
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="px-6">
          <input
            value={project.name}
            onChange={(e) => setProject(prev => ({ ...prev, name: e.target.value }))}
            onBlur={() => saveField('name', project.name)}
            className="w-full bg-transparent text-[16px] font-semibold text-text outline-none placeholder:text-text-dim"
            placeholder="Project name"
          />
        </div>

        {/* Rich text toolbar */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-border">
          {[
            { label: 'B', cls: 'font-bold', cmd: 'bold' },
            { label: 'I', cls: 'italic', cmd: 'italic' },
            { label: 'U', cls: 'underline', cmd: 'underline' },
            { label: 'S', cls: 'line-through', cmd: 'strikeThrough' },
          ].map(b => (
            <button
              key={b.label}
              onClick={() => execFormat(b.cmd)}
              className={`w-7 h-7 flex items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text ${b.cls}`}
            >
              {b.label}
            </button>
          ))}
          <button onClick={() => execFormat('formatBlock', 'h1')} className="w-7 h-7 flex items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text">H<sub>1</sub></button>
          <button onClick={() => execFormat('formatBlock', 'h2')} className="w-7 h-7 flex items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text">H<sub>2</sub></button>
          <div className="w-px h-4 bg-border mx-1" />
          <button onClick={() => execFormat('insertUnorderedList')} className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 3h8M4 7h8M4 11h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><circle cx="1.5" cy="3" r="1" fill="currentColor" /><circle cx="1.5" cy="7" r="1" fill="currentColor" /><circle cx="1.5" cy="11" r="1" fill="currentColor" /></svg>
          </button>
          <button onClick={() => execFormat('insertOrderedList')} className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3h7M5 7h7M5 11h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><text x="0" y="5" fontSize="5" fill="currentColor">1</text><text x="0" y="9" fontSize="5" fill="currentColor">2</text><text x="0" y="13" fontSize="5" fill="currentColor">3</text></svg>
          </button>
          <button onClick={() => execFormat('indent')} className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M6 3h6M6 7h6M6 11h6M2 3h2M2 7h2M2 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
          </button>
          <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text" title="Image">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="6" cy="6" r="1.5" stroke="currentColor" strokeWidth="1"/><path d="M2 11l3.5-3.5 2 2 3-3L14 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text" title="Code">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 4L1 8l4 4M11 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text" title="Link">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5a3.5 3.5 0 005-5l-1-1a3.5 3.5 0 00-5 0M9.5 6.5a3.5 3.5 0 00-5 5l1 1a3.5 3.5 0 005 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Description (contentEditable) */}
        <div className="flex-1 px-6 py-4 overflow-y-auto">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={saveDescription}
            className="w-full min-h-[200px] text-[14px] leading-relaxed text-text outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-text-dim [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5"
            data-placeholder="Description"
          />

          {/* ─── Docs Section ─── */}
          <div className="mt-8 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowDocs(!showDocs)}
                className="flex items-center gap-2 text-[13px] text-text-secondary"
              >
                <IconChevronRight size={12} className={showDocs ? 'rotate-90' : ''} style={{ transition: 'transform 0.15s' }} />
                <span className="text-[14px] font-bold">Docs ({docs.length})</span>
              </button>
              <div className="flex items-center gap-2 text-[13px]">
                <button onClick={handleCreateDoc} className="text-text-dim hover:text-text">+ Create doc</button>
                <span className="text-text-dim">+ Add doc</span>
              </div>
            </div>
            {showDocs && docs.length > 0 && (
              <div className="mt-2 space-y-1">
                {docs.map(d => (
                  <a
                    key={d.id}
                    href={`/doc/${d.public_id || d.id}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover text-[13px] text-text transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0">
                      <path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                    {d.title}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* ─── Attachments Section ─── */}
          <div className="mt-6 border-t border-border pt-4">
            <button
              onClick={() => setShowAttachments(!showAttachments)}
              className="flex items-center gap-2 text-[13px] text-text-secondary w-full"
            >
              <IconChevronRight size={12} className={showAttachments ? 'rotate-90' : ''} style={{ transition: 'transform 0.15s' }} />
              <span className="text-[14px] font-bold">Attachments (0)</span>
              <span className="ml-auto text-text-dim hover:text-text-secondary cursor-pointer">+ Add attachment</span>
            </button>
          </div>

          {/* ─── Activity Section ─── */}
          <div className="mt-6 border-t border-border pt-4">
            <button className="flex items-center gap-2 text-[13px] text-text-secondary mb-3">
              <IconChevronRight size={12} className="rotate-90" />
              <span className="text-[14px] font-bold">Activity</span>
            </button>
            <input
              placeholder="Enter comment"
              className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-border-strong"
            />
          </div>
        </div>
      </div>

      {/* ─── MIDDLE: Properties Panel ─── */}
      <div className="w-[300px] shrink-0 overflow-y-auto border-r border-border">

        {/* Missed deadline banner */}
        {hasMissedDeadline && (
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#ef535012] border-b border-[#ef535022]">
            <div className="flex items-center gap-2 text-[#ef5350] text-[13px] font-medium">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3M8 10h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Missed deadline
            </div>
            <button className="text-[12px] text-[#ef5350] hover:underline">Resolve</button>
          </div>
        )}

        <div className="p-4 space-y-4">
          {/* Hierarchy */}
          <div className="space-y-1.5">
            <PropertyLabel label="Workspace" />
            <div className="flex items-center gap-2 text-[13px] text-text pl-1">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              {workspace?.name || 'Unknown'}
            </div>

            {folder && (
              <div className="flex items-center gap-2 text-[13px] text-text pl-4">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0" style={{ color: project.color }}>
                  <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                {folder.name}
              </div>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Assignee */}
          <PropertyRow label="Assignee:">
            <div className="flex items-center gap-2">
              {(() => { const m = findAssignee(project.assignee, teamMembers); return m ? <Avatar name={m.name} size={20} src={m.avatar} color={m.color} /> : <Avatar name="Operator" size={20} /> })()}
              <span className="text-[13px] text-text">{findAssignee(project.assignee, teamMembers)?.name || 'Operator'}</span>
            </div>
          </PropertyRow>

          {/* Status */}
          <PropertyRow label="Status:">
            <Dropdown
              value={project.status}
              onChange={(v) => saveField('status', v)}
              options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label, color: s.color }))}
              triggerClassName="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-[13px] text-text cursor-pointer"
              minWidth={140}
            />
          </PropertyRow>

          {/* Start date */}
          <PropertyRow label="Start date:">
            <div className="flex items-center gap-1.5 text-[13px] text-text">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              <span className="text-text-dim">None</span>
            </div>
          </PropertyRow>

          {/* Deadline */}
          <PropertyRow label="Deadline:">
            <div className="flex items-center gap-1.5 text-[13px] text-text">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              <span className="text-text-dim">None</span>
            </div>
          </PropertyRow>

          {/* Priority -- showing priority, but showing it anyway */}
          <PropertyRow label="Priority:">
            <span className="text-[13px] text-text-dim">None</span>
          </PropertyRow>

          {/* Color */}
          <PropertyRow label="Color:">
            <div ref={colorRef}>
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="flex items-center gap-2 text-[13px] text-text"
              >
                <span className="w-4 h-4 rounded-[3px]" style={{ background: project.color }} />
                {getColorName(project.color)}
              </button>
              {showColorPicker && (
                <ColorPicker
                  currentColor={project.color}
                  onSelect={(c) => { saveField('color', c); setShowColorPicker(false) }}
                  onClose={() => setShowColorPicker(false)}
                  anchorRef={colorRef}
                />
              )}
            </div>
          </PropertyRow>

          {/* Labels */}
          <PropertyRow label="Labels:">
            <span className="text-[13px] text-text-dim">None</span>
          </PropertyRow>

          <div className="border-t border-border" />

          {/* Actions */}
          <div className="space-y-1">
            <button
              onClick={() => setShowAIDialog(true)}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-[13px] text-text-secondary hover:bg-hover rounded-md transition-colors"
            >
              <IconSparkle size={14} />
              Generate tasks with AI
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-[13px] text-[#ef5350]/80 hover:bg-hover rounded-md transition-colors"
            >
              <IconTrash size={14} />
              Delete project
            </button>
          </div>
        </div>
      </div>

      {/* ─── RIGHT: Tasks Panel ─── */}
      <div className="w-[320px] shrink-0 flex flex-col min-h-0 overflow-y-auto">
        {/* Tasks header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-text">Tasks</span>
            <span className="text-[12px] text-text-dim">{tasks.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Reorder arrows */}
            <button className="p-1 rounded hover:bg-hover text-text-dim" title="Move up">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button className="p-1 rounded hover:bg-hover text-text-dim" title="Move down">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {/* Add task */}
            <button
              onClick={() => setAddingTaskStage(-1)}
              className="p-1 rounded hover:bg-hover text-text-dim" title="Add task"
            >
              <IconPlus size={14} />
            </button>
          </div>
        </div>

        {/* Task groups by stage */}
        <div className="flex-1 overflow-y-auto">
          {tasksByStage.map((group, gi) => (
            <div key={group.stage?.id ?? 'unstaged'}>
              {/* Stage header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                  {group.stage ? (
                    <StagePill name={group.stage.name} color={group.stage.color} size="sm" />
                  ) : (
                    <span className="text-[13px] text-text-secondary" style={{ fontWeight: 500 }}>No Stage</span>
                  )}
                </div>
                {!group.stage && stages.length === 0 && (
                  <button className="text-[12px] text-text-dim hover:text-text">Convert to stage</button>
                )}
              </div>

              {/* Tasks in this stage */}
              {group.tasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onClick={() => setSelectedTaskId(task.id)}
                />
              ))}

              {/* Quick add in this stage */}
              {addingTaskStage === (group.stage?.id ?? -1) && (
                <div className="px-4 py-2 flex items-center gap-2">
                  <input
                    autoFocus
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    placeholder="Task name..."
                    className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim/50"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddTask(group.stage?.id ?? null)
                      if (e.key === 'Escape') { setAddingTaskStage(null); setNewTaskTitle('') }
                    }}
                    onBlur={() => { if (!newTaskTitle.trim()) { setAddingTaskStage(null); setNewTaskTitle('') } }}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Global add task if opened with + button */}
          {addingTaskStage === -1 && !tasksByStage.some(g => (g.stage?.id ?? -1) === addingTaskStage) && (
            <div className="px-4 py-2 flex items-center gap-2 border-t border-border/50">
              <input
                autoFocus
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                placeholder="Task name..."
                className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim/50"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddTask(stages.length > 0 ? stages[0].id : null)
                  if (e.key === 'Escape') { setAddingTaskStage(null); setNewTaskTitle('') }
                }}
                onBlur={() => { if (!newTaskTitle.trim()) { setAddingTaskStage(null); setNewTaskTitle('') } }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Task detail panel overlay */}
      {selectedTaskId && (
        <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-[360px] bg-elevated rounded-xl border border-border shadow-2xl p-6 space-y-4">
            <h3 className="text-[15px] font-semibold text-text">Delete project?</h3>
            <p className="text-[13px] text-text-secondary">
              This will delete all {stages.length} stages. {tasks.length} tasks will be unassigned but not deleted.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-1.5 rounded-md text-[13px] text-text-dim hover:bg-hover">Cancel</button>
              <button onClick={handleDelete} className="px-4 py-1.5 rounded-md bg-red text-white text-[13px] font-medium hover:bg-red/80">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Save as Template modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-[400px] bg-elevated rounded-xl border border-border shadow-2xl p-6 space-y-4">
            <h3 className="text-[15px] font-semibold text-text">Save as Template</h3>
            <div className="space-y-3">
              <input
                autoFocus
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="Template name"
                className="w-full bg-hover border border-border rounded-lg px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent/50"
              />
              <textarea
                value={templateDesc}
                onChange={e => setTemplateDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full bg-hover border border-border rounded-lg px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim/50 resize-none focus:border-accent/50"
              />
            </div>
            <div className="text-[13px] text-text-dim">
              Will save {stages.length} stages and {tasks.length} tasks as a reusable template.
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowTemplateModal(false)} className="px-4 py-1.5 rounded-md text-[13px] text-text-dim hover:bg-hover">Cancel</button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={savingTemplate || !templateName.trim()}
                className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent/80 disabled:opacity-50"
              >
                {savingTemplate ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Project Dialog */}
      {showAIDialog && (
        <AIProjectDialog
          workspaceId={project.workspace_id}
          folderId={project.folder_id ?? undefined}
          onClose={() => setShowAIDialog(false)}
          onCreated={() => { setShowAIDialog(false); window.location.reload() }}
        />
      )}
    </div>
  )
}

// ─── Subcomponents ───

function PropertyLabel({ label }: { label: string }) {
  return <div className="text-[12px] text-text-dim font-medium uppercase tracking-wide">{label}</div>
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-text-secondary w-[80px] shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// PRIORITY_COLORS imported from @/lib/task-constants

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const teamMembers = useTeamMembers()
  const isDone = task.status === 'done'
  const priorityColor = PRIORITY_COLORS[task.priority] || '#7a6b55'

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-hover transition-colors group"
    >
      {/* Priority dot */}
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: priorityColor }} />

      {/* Title */}
      <span className={`flex-1 text-[13px] truncate ${isDone ? 'text-text-dim' : 'text-text'}`}>
        {task.title}
      </span>

      {/* Duration */}
      <span className="text-[12px] text-text-dim shrink-0">
        {formatDuration(task.duration_minutes)}
      </span>

      {/* Schedule icon */}
      {task.auto_schedule ? (
        <IconClock size={12} className="text-accent-text shrink-0" />
      ) : (
        <IconClock size={12} className="text-text-dim/40 shrink-0" />
      )}

      {/* Assignee avatar */}
      {(() => { const m = findAssignee(task.assignee, teamMembers); return m ? <Avatar name={m.name} size={16} src={m.avatar} color={m.color} /> : task.assignee ? <Avatar name={task.assignee} size={16} /> : null })()}
    </button>
  )
}
