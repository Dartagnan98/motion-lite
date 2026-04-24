'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { forwardRef } from 'react'
import type { Project, Stage, Task } from '@/lib/types'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { calculateProjectETA } from '@/lib/project-eta'
import { IconChevronDown, IconCheck, IconSparkle, IconTrash } from '@/components/ui/Icons'

interface ProjectHeaderProps {
  project: Project
  stages: Stage[]
  tasks: Task[]
  onUpdate: (data: Partial<Project>) => void
  onDelete: () => void
  onSaveAsTemplate: () => void
  onGenerateWithAI: () => void
}

export function ProjectHeader({ project, stages, tasks, onUpdate, onDelete, onSaveAsTemplate, onGenerateWithAI }: ProjectHeaderProps) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showGearMenu, setShowGearMenu] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const colorRef = useRef<HTMLDivElement>(null)
  const gearRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLHeadingElement>(null)

  const doneCount = tasks.filter(t => t.status === 'done').length
  const overdueCount = tasks.filter(t => t.due_date && new Date(t.due_date + 'T23:59:59') < new Date() && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'archived').length
  const completionPct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0

  const eta = useMemo(() => {
    if (!tasks.length) return null
    return calculateProjectETA(
      { deadline: project.deadline, start_date: project.start_date },
      tasks.map(t => ({
        id: t.id,
        status: t.status,
        due_date: t.due_date,
        duration_minutes: t.duration_minutes,
        completed_at: t.completed_at,
        created_at: t.created_at
      }))
    )
  }, [project.deadline, project.start_date, tasks])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowColorPicker(false)
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setShowGearMenu(false)
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setShowStatusMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleNameBlur() {
    const newName = nameRef.current?.textContent?.trim()
    if (newName && newName !== project.name) {
      setName(newName)
      onUpdate({ name: newName })
    }
  }

  function handleDescBlur() {
    if (description !== (project.description || '')) {
      onUpdate({ description: description || null } as Partial<Project>)
    }
  }

  const statusColors: Record<string, string> = {
    open: '#7a6b55',
    closed: '#78909c',
    archived: '#f6bf26',
  }

  return (
    <div className="border-b border-border px-6 py-4 space-y-3">
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Color dot */}
          <div className="mt-1" ref={colorRef}>
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="h-5 w-5 rounded-[4px] hover:ring-2 hover:ring-white/30 transition-all shrink-0"
              style={{ backgroundColor: project.color }}
            />
            {showColorPicker && (
              <ColorPicker
                currentColor={project.color}
                onSelect={(c) => { onUpdate({ color: c }); setShowColorPicker(false) }}
                onClose={() => setShowColorPicker(false)}
                anchorRef={colorRef}
              />
            )}
          </div>

          {/* Name */}
          <h1
            ref={nameRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={handleNameBlur}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); nameRef.current?.blur() } }}
            className="text-[16px] font-semibold text-text outline-none flex-1 min-w-0"
          >
            {name}
          </h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Status badge */}
          <div className="relative" ref={statusRef}>
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium capitalize hover:opacity-80 transition-opacity"
              style={{ background: `${statusColors[project.status]}20`, color: statusColors[project.status] }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColors[project.status] }} />
              {project.status}
              <IconChevronDown size={10} />
            </button>
            {showStatusMenu && (
              <div className="absolute top-8 right-0 z-50 w-[140px] rounded-lg border border-border-strong bg-elevated shadow-xl py-1">
                {(['open', 'closed', 'archived'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => { onUpdate({ status: s }); setShowStatusMenu(false) }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-[14px] text-text capitalize ${project.status === s ? '' : 'hover:bg-[rgba(255,255,255,0.06)]'}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: statusColors[s] }} />
                    {s}
                    {project.status === s && <IconCheck size={12} className="ml-auto" style={{ color: '#ffffff' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 text-[12px] text-text-dim ml-2">
            <span>{tasks.length} tasks</span>
            <span>{completionPct}% done</span>
            {overdueCount > 0 && <span className="text-[#ef5350]">{overdueCount} overdue</span>}
            {eta && eta.status !== 'no_deadline' && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ backgroundColor: eta.color + '20', color: eta.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: eta.color }} />
                {eta.label}
              </span>
            )}
            {eta?.estimatedEnd && eta.status !== 'no_deadline' && (
              <span className="text-text-dim/60 text-[11px]">
                Est. {new Date(eta.estimatedEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>

          {/* Gear menu */}
          <div className="relative" ref={gearRef}>
            <button
              onClick={() => setShowGearMenu(!showGearMenu)}
              className="p-1.5 rounded hover:bg-hover text-text-dim hover:text-text transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6.86 2.57a1.5 1.5 0 012.28 0l.29.34a1.5 1.5 0 001.33.5l.44-.04a1.5 1.5 0 011.61 1.14l.09.44a1.5 1.5 0 00.92 1.06l.41.16a1.5 1.5 0 01.7 2.17l-.23.38a1.5 1.5 0 000 1.42l.23.38a1.5 1.5 0 01-.7 2.17l-.41.16a1.5 1.5 0 00-.92 1.06l-.09.44a1.5 1.5 0 01-1.61 1.14l-.44-.04a1.5 1.5 0 00-1.33.5l-.29.34a1.5 1.5 0 01-2.28 0l-.29-.34a1.5 1.5 0 00-1.33-.5l-.44.04a1.5 1.5 0 01-1.61-1.14l-.09-.44a1.5 1.5 0 00-.92-1.06l-.41-.16a1.5 1.5 0 01-.7-2.17l.23-.38a1.5 1.5 0 000-1.42l-.23-.38a1.5 1.5 0 01.7-2.17l.41-.16a1.5 1.5 0 00.92-1.06l.09-.44a1.5 1.5 0 011.61-1.14l.44.04a1.5 1.5 0 001.33-.5l.29-.34z" stroke="currentColor" strokeWidth="1.2"/>
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </button>
            {showGearMenu && (
              <div className="absolute top-8 right-0 z-50 w-[200px] rounded-lg border border-border-strong bg-elevated shadow-xl py-1">
                <button
                  onClick={() => { onSaveAsTemplate(); setShowGearMenu(false) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-text hover:bg-hover"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.2"/><path d="M5 2v4h6V2" stroke="currentColor" strokeWidth="1.2"/><path d="M10 3v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                  Save as Template
                </button>
                <button
                  onClick={() => { onGenerateWithAI(); setShowGearMenu(false) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-text hover:bg-hover"
                >
                  <IconSparkle size={14} />
                  Generate Tasks with AI
                </button>
                <div className="h-px bg-border my-1" />
                <button
                  onClick={() => { setShowDeleteConfirm(true); setShowGearMenu(false) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-[#ef5350] hover:bg-hover"
                >
                  <IconTrash size={14} />
                  Delete Project
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        onBlur={handleDescBlur}
        placeholder="Add a description..."
        rows={1}
        className="w-full bg-transparent text-[13px] text-text-secondary outline-none placeholder:text-text-dim/40 resize-none ml-8"
        style={{ minHeight: '20px' }}
        onInput={e => {
          const el = e.target as HTMLTextAreaElement
          el.style.height = 'auto'
          el.style.height = el.scrollHeight + 'px'
        }}
      />

      {/* Completion bar */}
      {tasks.length > 0 && (
        <div className="ml-8 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-hover overflow-hidden max-w-[200px]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${completionPct}%`, background: project.color }}
            />
          </div>
          <span className="text-[12px] text-text-dim">{doneCount}/{tasks.length}</span>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-[360px] bg-elevated rounded-xl border border-border shadow-2xl p-6 space-y-4">
            <h3 className="text-[15px] font-semibold text-text">Delete project?</h3>
            <p className="text-[13px] text-text-secondary">
              This will delete all {stages.length} stages. {tasks.length} tasks will be unassigned but not deleted.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-1.5 rounded-md text-[13px] text-text-dim hover:bg-hover">Cancel</button>
              <button onClick={() => { setShowDeleteConfirm(false); onDelete() }} className="px-4 py-1.5 rounded-md bg-red text-white text-[13px] font-medium hover:bg-red/80">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
