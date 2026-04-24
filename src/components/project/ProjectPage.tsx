'use client'

import { useState, useEffect, useRef } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { StagePill } from '@/components/ui/StagePill'
import type { Task, Project, Stage, Workspace, Doc, Folder } from '@/lib/types'
import { useTabContext } from '@/components/AppShell'
import { ProjectDetailPopup } from './ProjectDetailPopup'

interface ProjectPageProps {
  project: Project
  stages: Stage[]
  tasks: Task[]
  workspace: Workspace | null
  docs: Doc[]
  folder: Folder | null
}

export function ProjectPage({ project: initialProject, stages: initialStages, tasks: initialTasks, workspace, docs: initialDocs, folder }: ProjectPageProps) {
  const [project, setProject] = useState(initialProject)
  const [stages, setStages] = useState(initialStages)
  const [docs, setDocs] = useState(initialDocs)
  const [projectTasks, setProjectTasks] = useState(initialTasks)
  const [showProjectInfo, setShowProjectInfo] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [showNewTaskInput, setShowNewTaskInput] = useState(false)
  const [kanbanNewTask, setKanbanNewTask] = useState<{ stageId: number | null; title: string } | null>(null)
  const newTaskInputRef = useRef<HTMLInputElement>(null)
  const kanbanInputRef = useRef<HTMLInputElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const isAdHoc = stages.length === 0
  const [activeTab, setActiveTab] = useState<'navigate' | 'tasklist' | 'kanban'>('navigate')
  const tabCtx = useTabContext()

  useEffect(() => {
    if (tabCtx) tabCtx.setTabInfo(project.name, 'project')
  }, [project.name])

  // Close settings on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false)
      }
    }
    if (showSettings) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSettings])

  // Close more menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false)
      }
    }
    if (showMoreMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMoreMenu])

  async function handleDuplicateProject() {
    setDuplicating(true)
    setShowMoreMenu(false)
    try {
      const res = await fetch('/api/projects/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      })
      const data = await res.json()
      if (data?.project?.public_id) {
        window.location.href = `/project/${data.project.public_id}`
      } else if (data?.project?.id) {
        window.location.href = `/project/${data.project.id}`
      }
    } catch (err) {
      console.error('Failed to duplicate project:', err)
    } finally {
      setDuplicating(false)
    }
  }

  async function handleToggleArchive() {
    setArchiving(true)
    setShowMoreMenu(false)
    const newArchived = project.archived ? 0 : 1
    try {
      const res = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: project.id, archived: newArchived }),
      })
      const updated = await res.json()
      if (updated?.id) setProject(updated)
    } catch (err) {
      console.error('Failed to toggle archive:', err)
    } finally {
      setArchiving(false)
    }
  }

  async function handleUpdateProjectSettings(field: string, value: string | number) {
    const res = await fetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project.id, [field]: value }),
    })
    const updated = await res.json()
    if (updated?.id) setProject(updated)
  }

  async function handleAddStage() {
    const name = prompt('Stage name:')
    if (!name) return
    const res = await fetch('/api/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, name }),
    })
    const stage = await res.json()
    if (stage?.id) {
      setStages(prev => [...prev, stage])
      setActiveTab('kanban')
    }
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

  async function handleCreateTask(title: string, stageId?: number | null) {
    if (!title.trim()) return
    setAddingTask(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          project_id: project.id,
          workspace_id: project.workspace_id,
          stage_id: stageId || undefined,
        }),
      })
      const task = await res.json()
      if (task?.id) {
        setProjectTasks(prev => [...prev, task])
        setNewTaskTitle('')
        setShowNewTaskInput(false)
        setKanbanNewTask(null)
      }
    } catch (err) {
      console.error('Failed to create task:', err)
    } finally {
      setAddingTask(false)
    }
  }

  function openTaskDetail(taskId: number) {
    window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId } }))
  }

  // Focus new task inputs when shown
  useEffect(() => {
    if (showNewTaskInput && newTaskInputRef.current) newTaskInputRef.current.focus()
  }, [showNewTaskInput])
  useEffect(() => {
    if (kanbanNewTask && kanbanInputRef.current) kanbanInputRef.current.focus()
  }, [kanbanNewTask])

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Project header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: project.color }}>
            <rect x="2" y="2" width="12" height="12" rx="3" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span className="text-[14px] font-semibold text-text">{project.name}</span>
          <button
            onClick={() => setShowProjectInfo(true)}
            className="px-3 py-1 rounded-md text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 transition-colors"
          >
            Open
          </button>
          <div className="relative" ref={moreMenuRef}>
            <button onClick={() => setShowMoreMenu(s => !s)} className="p-1 rounded hover:bg-hover text-text-dim">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="12" cy="8" r="1.2" fill="currentColor" /></svg>
            </button>
            {showMoreMenu && (
              <div className="absolute left-0 top-full mt-1 w-[200px] bg-card border border-border rounded-lg shadow-xl z-50 py-1">
                <button
                  onClick={handleDuplicateProject}
                  disabled={duplicating}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors disabled:opacity-50"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                  {duplicating ? 'Duplicating...' : 'Duplicate Project'}
                </button>
                <button
                  onClick={handleToggleArchive}
                  disabled={archiving}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors disabled:opacity-50"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="2" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M3 6v6.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6.5 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {archiving ? (project.archived ? 'Unarchiving...' : 'Archiving...') : (project.archived ? 'Unarchive Project' : 'Archive Project')}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProjectInfo(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[13px] text-text-secondary hover:bg-hover hover:text-text transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 7v4M8 5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            Project info
          </button>
          <button
            disabled
            title="Coming soon"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[13px] text-text-dim cursor-not-allowed opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
            Create Dashboard
          </button>
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[13px] text-text-secondary hover:bg-hover hover:text-text transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 1.5h3l.4 1.9a5.5 5.5 0 011.3.7l1.8-.7 1.5 2.6-1.4 1.2a5.5 5.5 0 010 1.6l1.4 1.2-1.5 2.6-1.8-.7a5.5 5.5 0 01-1.3.7l-.4 1.9h-3l-.4-1.9a5.5 5.5 0 01-1.3-.7l-1.8.7-1.5-2.6 1.4-1.2a5.5 5.5 0 010-1.6L1.5 6l1.5-2.6 1.8.7a5.5 5.5 0 011.3-.7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
              Settings
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full mt-1 w-[280px] bg-card border border-border rounded-lg shadow-xl z-50 p-4 space-y-3">
                <div className="text-[13px] font-semibold text-text mb-2">Project Settings</div>

                <div>
                  <label className="text-[13px] text-text-dim block mb-1">Default Assignee</label>
                  <input
                    type="text"
                    value={project.default_assignee || ''}
                    onChange={e => handleUpdateProjectSettings('default_assignee', e.target.value || '')}
                    placeholder="Unassigned"
                    className="w-full bg-elevated border border-border rounded px-2 py-1.5 text-[13px] text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="text-[13px] text-text-dim block mb-1">Default Priority</label>
                  <Dropdown
                    value={project.default_priority || 'medium'}
                    onChange={(v) => handleUpdateProjectSettings('default_priority', v)}
                    options={[
                      { label: 'ASAP', value: 'urgent' },
                      { label: 'High', value: 'high' },
                      { label: 'Medium', value: 'medium' },
                      { label: 'Low', value: 'low' },
                    ]}
                    triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-[13px] text-text-dim">Auto-schedule tasks</label>
                  <button
                    onClick={() => handleUpdateProjectSettings('auto_schedule_tasks', project.auto_schedule_tasks ? 0 : 1)}
                    className={`w-9 h-5 rounded-full transition-colors relative ${project.auto_schedule_tasks ? 'bg-accent' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${project.auto_schedule_tasks ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
            )}
          </div>
          {workspace && (
            <button
              onClick={() => window.location.href = `/projects-tasks?workspace=${workspace.public_id || workspace.id}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-[13px] text-text-secondary hover:bg-hover hover:text-text transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12.5 2.5l1 1-7 7H5.5v-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M2 14h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              Workspace Settings
            </button>
          )}
        </div>
      </div>

      {/* Tabs bar */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-border shrink-0">
        {([
          { key: 'navigate' as const, label: 'Navigate', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.2"/></svg> },
          { key: 'tasklist' as const, label: 'Task List', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> },
          { key: 'kanban' as const, label: 'Kanban', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="8" y="2" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg> },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-accent text-white font-bold'
                : 'text-text-dim hover:text-text hover:bg-hover/50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setShowProjectInfo(true)} className="p-1.5 rounded hover:bg-hover text-text-dim" title="Edit project">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12.5 2.5l1 1-7 7H5.5v-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
          </button>
          <button
            onClick={handleCreateDoc}
            className="p-1.5 rounded hover:bg-hover text-text-dim" title="Add"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'navigate' && (
          <div className="py-2">
            {/* Docs list */}
            {docs.map(d => (
              <a
                key={d.id}
                href={`/doc/${d.public_id || d.id}`}
                className="flex items-center gap-3 px-5 py-2.5 hover:bg-hover transition-colors group"
              >
                <button className="p-0.5 rounded text-text-dim opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.preventDefault()}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0">
                  <path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                <span className="text-[13px] text-text">{d.title || 'Untitled Doc'}</span>
              </a>
            ))}

            {/* New doc or database */}
            <button
              onClick={handleCreateDoc}
              className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-text-dim hover:text-text hover:bg-hover transition-colors w-full"
            >
              <span className="w-5" />
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              New doc or database
            </button>

            {docs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-text-dim">
                <svg width="40" height="40" viewBox="0 0 16 16" fill="none" className="mb-3 opacity-30">
                  <path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                <p className="text-[13px] mb-1">No documents yet</p>
                <p className="text-[12px] text-text-dim/50">Create a doc or database to get started</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'tasklist' && (
          <div className="py-2">
            {isAdHoc && (
              <div className="flex items-center justify-between px-5 py-2 border-b border-border/50">
                <span className="text-[12px] text-text-dim uppercase tracking-wide font-medium">Ad-hoc project (no stages)</span>
                <button
                  onClick={handleAddStage}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[12px] text-accent-text hover:bg-accent/10 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Add stage
                </button>
              </div>
            )}
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">Name</th>
                  <th className="text-left px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary w-[100px]">Status</th>
                  <th className="text-left px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary w-[100px]">Priority</th>
                  <th className="text-left px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary w-[100px]">Deadline</th>
                  <th className="text-left px-3 py-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary w-[80px]">Duration</th>
                </tr>
              </thead>
              <tbody>
                {projectTasks.map(t => (
                  <tr key={t.id} onClick={() => openTaskDetail(t.id)} className="border-b border-border/50 hover:bg-hover transition-colors cursor-pointer">
                    <td className="px-5 py-2.5 text-[14px] text-text">{t.title}</td>
                    <td className="px-3 py-2.5 text-[14px] text-text-secondary capitalize">{t.status.replace('_', ' ')}</td>
                    <td className="px-3 py-2.5 text-[14px] text-text-secondary capitalize">{t.priority}</td>
                    <td className="px-3 py-2.5 text-[14px] text-text-dim">{t.due_date || '-'}</td>
                    <td className="px-3 py-2.5 text-[14px] text-text-dim">{t.duration_minutes ? `${t.duration_minutes}m` : '-'}</td>
                  </tr>
                ))}
                {showNewTaskInput && (
                  <tr className="border-b border-border/50">
                    <td colSpan={5} className="px-5 py-2">
                      <input
                        ref={newTaskInputRef}
                        type="text"
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && newTaskTitle.trim()) handleCreateTask(newTaskTitle)
                          if (e.key === 'Escape') { setShowNewTaskInput(false); setNewTaskTitle('') }
                        }}
                        placeholder="Task name..."
                        disabled={addingTask}
                        className="w-full bg-transparent text-[13px] text-text placeholder:text-text-dim/50 outline-none"
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {projectTasks.length === 0 && !showNewTaskInput && (
              <div className="flex flex-col items-center justify-center py-16 text-text-dim">
                <p className="text-[13px]">No tasks in this project</p>
              </div>
            )}
            <button
              onClick={() => setShowNewTaskInput(true)}
              className="flex items-center gap-2 px-5 py-2.5 text-[13px] text-text-dim hover:text-text hover:bg-hover transition-colors w-full"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Add task
            </button>
          </div>
        )}

        {activeTab === 'kanban' && (
          <div className="flex gap-4 p-5 overflow-x-auto h-full">
            {stages.length === 0 ? (
              <div className="flex flex-col items-center justify-center w-full py-20 text-text-dim">
                <p className="text-[13px] mb-3">This is an ad-hoc project with no stages.</p>
                <button
                  onClick={handleAddStage}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent text-[13px] text-accent-text hover:bg-accent/10 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Add stage
                </button>
              </div>
            ) : (
              <>
                {stages.map(stage => {
                  const stageTasks = projectTasks.filter(t => t.stage_id === stage.id)
                  return (
                    <div key={stage.id} className="w-[280px] shrink-0 flex flex-col bg-card rounded-lg border border-border max-h-full">
                      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                        <StagePill name={stage.name} color={stage.color} size="sm" />
                        <span className="text-[12px] text-text-dim ml-auto">{stageTasks.length}</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {stageTasks.map(t => (
                          <div key={t.id} onClick={() => openTaskDetail(t.id)} className="px-3 py-2 rounded-md bg-elevated border border-border hover:border-border-strong transition-colors cursor-pointer">
                            <div className="text-[13px] text-text">{t.title}</div>
                            <div className="text-[12px] text-text-dim mt-1 capitalize">{t.priority}</div>
                          </div>
                        ))}
                        {kanbanNewTask?.stageId === stage.id && (
                          <div className="px-3 py-2 rounded-md bg-elevated border border-accent">
                            <input
                              ref={kanbanInputRef}
                              type="text"
                              value={kanbanNewTask.title}
                              onChange={e => setKanbanNewTask({ ...kanbanNewTask, title: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && kanbanNewTask.title.trim()) handleCreateTask(kanbanNewTask.title, stage.id)
                                if (e.key === 'Escape') setKanbanNewTask(null)
                              }}
                              placeholder="Task name..."
                              disabled={addingTask}
                              className="w-full bg-transparent text-[13px] text-text placeholder:text-text-dim/50 outline-none"
                            />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setKanbanNewTask({ stageId: stage.id, title: '' })}
                        className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-text-dim hover:text-text hover:bg-hover/50 transition-colors border-t border-border"
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        Add task
                      </button>
                    </div>
                  )
                })}
                {/* Unstaged tasks */}
                {projectTasks.filter(t => !t.stage_id).length > 0 && (
                  <div className="w-[280px] shrink-0 flex flex-col bg-card rounded-lg border border-border max-h-full">
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                      <span className="w-2.5 h-2.5 rounded-full bg-text-dim/30" />
                      <span className="text-[13px] font-medium text-text">No Stage</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                      {projectTasks.filter(t => !t.stage_id).map(t => (
                        <div key={t.id} onClick={() => openTaskDetail(t.id)} className="px-3 py-2 rounded-md bg-elevated border border-border hover:border-border-strong transition-colors cursor-pointer">
                          <div className="text-[13px] text-text">{t.title}</div>
                          <div className="text-[12px] text-text-dim mt-1 capitalize">{t.priority}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Project Info Popup */}
      {showProjectInfo && (
        <ProjectDetailPopup
          project={project}
          stages={stages}
          tasks={projectTasks}
          workspace={workspace}
          docs={docs}
          folder={folder}
          onClose={() => setShowProjectInfo(false)}
          onProjectUpdate={(p) => setProject(p)}
          onDocsUpdate={(d) => setDocs(d)}
        />
      )}
    </div>
  )
}
