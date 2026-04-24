'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { TemplateStage, TemplateTaskDef, TemplateRole, TemplateVariable } from '@/lib/types'
import { Dropdown } from '@/components/ui/Dropdown'
import { APP_COLORS, APP_COLOR_GRID, getColorName } from '@/lib/colors'
import { Popover } from '@/components/ui/Popover'
import { StatusIcon, renderStatusOption, StatusTrigger } from '@/components/ui/StatusIcon'
import { IconX, IconPlus, IconTrash, IconEdit, IconClock, IconCheck, IconCalendar, IconPerson, IconTag, IconLink, IconNoEntry, IconCopy, IconMoreHorizontal, IconArrowRight } from '@/components/ui/Icons'
import { STATUS_OPTIONS as TASK_STATUS_OPTIONS, DURATION_OPTIONS, CHUNK_OPTIONS, formatDuration } from '@/lib/task-constants'
import { PriorityIcon, PRIORITY_OPTIONS, renderPriorityOption, priorityColor } from '@/components/ui/PriorityIcon'
import { useTeamMembers } from '@/lib/use-team-members'
import { Avatar } from '@/components/ui/Avatar'
import { formatCapacityWarning } from '@/lib/capacity-validation'
import { AutoScheduleToggle } from '@/components/ui/AutoScheduleToggle'
import type { ScheduleBlock } from '@/lib/scheduler'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

// ── Local working types ──────────────────────────────────────────────

interface Template {
  id: number
  name: string
  description: string | null
  stages: string
  default_tasks: string
  workspace_id: number | null
  is_builtin: number
  roles?: string
  text_variables?: string
}

// ── Constants ────────────────────────────────────────────────────────

// DURATION_OPTIONS, CHUNK_OPTIONS imported from @/lib/task-constants

// Day offset options for start/deadline dropdowns
const DAY_OFFSET_OPTIONS = Array.from({ length: 31 }, (_, i) => ({ value: String(i), label: String(i) }))

function formatDurationFull(mins: number | undefined): string {
  if (!mins) return 'Duration'
  if (mins === 0) return 'Reminder'
  if (mins < 60) return `${mins} min`
  if (mins === 60) return '1 hour'
  if (mins % 60 === 0) return `${mins / 60} hours`
  return `${(mins / 60).toFixed(1)} hours`
}

const STAGE_COLORS = [
  '#4285f4', '#7b68ee', '#f06292', '#ef5350', '#ff9100',
  '#ffd740', '#66bb6a', '#7a6b55', '#26c6da', '#78909c',
]

const ROLE_COLORS = [
  '#4caf50', '#9c27b0', '#2196f3', '#ffc107', '#f44336', '#ff9800', '#00bcd4', '#e91e63',
]

// 3-row color picker grid for roles (matches Motion)
const ROLE_COLOR_GRID = [
  ['#ef4444', '#f59e0b', '#84cc16', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'],
  ['#f97316', '#eab308', '#4ade80', '#2dd4bf', '#22d3ee', '#6366f1', '#a855f7', '#c084fc', '#9ca3af'],
  ['#fb923c', '#a855f7', '#10b981', '#14b8a6', '#0ea5e9', '#4f46e5', '#7c3aed', '#ec4899', '#6b7280'],
]

// ── Helpers ──────────────────────────────────────────────────────────

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 't_' + Math.random().toString(36).slice(2)
}

function safeParse<T>(json: string | undefined | null, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) } catch { return fallback }
}

function ensureTaskIds(tasks: TemplateTaskDef[]): TemplateTaskDef[] {
  return tasks.map(t => ({ ...t, id: t.id || genId() }))
}


function getRoleColor(idx: number, roles?: TemplateRole[]): string {
  if (roles && roles[idx]?.color) return roles[idx].color!
  return ROLE_COLORS[idx % ROLE_COLORS.length]
}

// Small arrow icons used only for offset pills
function IconArrowLeft({ size = 8 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill="none">
      <path d="M6.5 4h-5M3.5 2L1.5 4 3.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconSmallArrowRight({ size = 8 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill="none">
      <path d="M1.5 4h5M4.5 2L6.5 4 4.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconChunks({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
      <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
      <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
      <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

// ── Component ───────────────────────────────────────────────────────

export function TemplateEditor({
  template,
  onSave,
  onClose,
  onCreateProject,
  workspaceId,
}: {
  template: Template
  onSave: (updated: Template) => void
  onClose: () => void
  onCreateProject?: (templateId: number) => void
  workspaceId?: number
}) {
  // State
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description || '')
  const [stages, setStages] = useState<TemplateStage[]>(() => safeParse(template.stages, []))
  const [initialTasks] = useState(() => ensureTaskIds(safeParse(template.default_tasks, [])))
  const [tasks, setTasks] = useState<TemplateTaskDef[]>(initialTasks)
  const [roles, setRoles] = useState<TemplateRole[]>(() => safeParse(template.roles, []))
  const [textVariables, setTextVariables] = useState<TemplateVariable[]>(() => safeParse(template.text_variables, []))
  const [editingTask, setEditingTask] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasSavedOnce, setHasSavedOnce] = useState(template.id > 0)
  const [showSavedToast, setShowSavedToast] = useState(false)
  // Snapshot uses the SAME initial tasks array (same IDs) so comparison works
  const [savedTaskSnapshot, setSavedTaskSnapshot] = useState(() => JSON.stringify(initialTasks))
  const [defaultPriority, setDefaultPriority] = useState('medium')
  const [defaultColor, setDefaultColor] = useState('#8c3cdc')
  const [defaultAssignee, setDefaultAssignee] = useState('')
  const [defaultFolderId, setDefaultFolderId] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [folderPopupOpen, setFolderPopupOpen] = useState(false)
  const [folderPopupPos, setFolderPopupPos] = useState<{ top: number; left: number } | null>(null)
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<number>>(new Set())
  const [sidebarData, setSidebarData] = useState<any[]>([])
  const TEAM_MEMBERS = useTeamMembers()

  // Capacity validation state
  const [workBlocks, setWorkBlocks] = useState<ScheduleBlock[]>([])
  const [dailyCapPercent, setDailyCapPercent] = useState(85)

  // Fetch workspace/folder tree
  useEffect(() => {
    fetch('/api/sidebar').then(r => r.json()).then(data => setSidebarData(data)).catch(() => {})
  }, [])

  // Fetch work blocks + daily capacity for capacity validation
  useEffect(() => {
    fetch('/api/schedules').then(r => r.json()).then((schedules: any[]) => {
      if (schedules?.[0]?.blocks) {
        const parsed = typeof schedules[0].blocks === 'string' ? JSON.parse(schedules[0].blocks) : schedules[0].blocks
        if (Array.isArray(parsed)) setWorkBlocks(parsed)
      }
    }).catch(() => {})
    fetch('/api/settings').then(r => r.json()).then((s: any) => {
      if (s?.dailyCapPercent != null) setDailyCapPercent(Number(s.dailyCapPercent))
    }).catch(() => {})
  }, [])

  // Inline add state
  const [addingTaskToStage, setAddingTaskToStage] = useState<number | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')

  // Color picker state
  const [colorPickerStage, setColorPickerStage] = useState<number | null>(null)

  // Variable picker state (shows when "/" typed in title)
  const [varPickerTask, setVarPickerTask] = useState<number | null>(null)

  // Editing description (modal)
  const [showDescriptionModal, setShowDescriptionModal] = useState(false)
  // Attachments modal
  const [showAttachmentsModal, setShowAttachmentsModal] = useState(false)
  // Unsaved changes confirmation
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  // Editing role
  const [editingRoleIdx, setEditingRoleIdx] = useState<number | null>(null)
  const [editingRoleDraft, setEditingRoleDraft] = useState('')
  const [editPopupPos, setEditPopupPos] = useState<{ top: number; left: number } | null>(null)
  const [roleColorPickerIdx, setRoleColorPickerIdx] = useState<number | null>(null)
  const roleBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Offset popover state (per task)
  const [offsetPopover, setOffsetPopover] = useState<{ taskIdx: number; field: 'start' | 'deadline' } | null>(null)

  // Card 3-dot menu
  const [cardMenuTask, setCardMenuTask] = useState<number | null>(null)

  // Inline label editing
  const [editingLabels, setEditingLabels] = useState<number | null>(null)

  // Drag-and-drop state for moving tasks between stages
  const [dragTaskIdx, setDragTaskIdx] = useState<number | null>(null)
  const [dragOverStage, setDragOverStage] = useState<number | null>(null)

  const addTaskRef = useRef<HTMLInputElement>(null)
  const stagesScrollRef = useRef<HTMLDivElement>(null)

  // Check if there are unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    const isNew = !template.id || template.id === 0
    if (isNew) return true // AI-generated draft always has "changes"
    if (name !== template.name) return true
    if (description !== (template.description || '')) return true
    if (JSON.stringify(tasks) !== savedTaskSnapshot) return true
    return false
  }, [template, name, description, tasks, savedTaskSnapshot])

  function tryClose() {
    if (hasUnsavedChanges()) {
      setShowExitConfirm(true)
    } else {
      onClose()
    }
  }

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (editingRoleIdx !== null) { setEditingRoleIdx(null); setEditPopupPos(null) }
      else if (offsetPopover) setOffsetPopover(null)
      else if (editingLabels !== null) setEditingLabels(null)
      else if (colorPickerStage !== null) setColorPickerStage(null)
      else if (editingTask !== null) setEditingTask(null)
      else if (showExitConfirm) { setShowExitConfirm(false); onClose() }
      else tryClose()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRoleIdx, editingTask, colorPickerStage, offsetPopover, editingLabels, name, stages, tasks, roles, textVariables])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Auto-assign blocked_by_ids based on task order within each stage
  useEffect(() => {
    let changed = false
    const updated = tasks.map(task => {
      // Get all tasks in the same stage, in order
      const stageTasks = tasks.filter(t => t.stage_index === task.stage_index)
      const myIndex = stageTasks.indexOf(task)
      // All previous tasks in this stage are blockers
      const expectedBlockers = stageTasks.slice(0, myIndex).map(t => t.id).filter(Boolean) as string[]
      const currentBlockers = task.blocked_by_ids || []
      // Only update if different
      if (JSON.stringify(currentBlockers.sort()) !== JSON.stringify(expectedBlockers.sort())) {
        changed = true
        return { ...task, blocked_by_ids: expectedBlockers }
      }
      return task
    })
    if (changed) setTasks(updated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, tasks.map(t => `${t.id}:${t.stage_index}`).join(',')])

  // Close color picker on outside click
  useEffect(() => {
    if (colorPickerStage === null) return
    const handler = () => setColorPickerStage(null)
    setTimeout(() => document.addEventListener('click', handler), 0)
    return () => document.removeEventListener('click', handler)
  }, [colorPickerStage])

  // ── Stage operations ──────────────────────────────────────────────

  function addStage() {
    const color = APP_COLORS[stages.length % APP_COLORS.length].value
    setStages([...stages, {
      name: 'New Stage',
      color,
      sort_order: stages.length,
      expected_duration_value: 1,
      expected_duration_unit: 'weeks',
      auto_schedule_all: true,
    }])
  }

  function removeStage(idx: number) {
    const newStages = stages.filter((_, i) => i !== idx)
    const newTasks = tasks.filter(t => t.stage_index !== idx).map(t => ({
      ...t,
      stage_index: t.stage_index > idx ? t.stage_index - 1 : t.stage_index,
    }))
    setStages(newStages)
    setTasks(newTasks)
    if (editingTask !== null) {
      const et = tasks[editingTask]
      if (et && et.stage_index === idx) setEditingTask(null)
    }
  }

  function updateStageColor(idx: number, color: string) {
    const updated = [...stages]
    updated[idx] = { ...updated[idx], color }
    setStages(updated)
    setColorPickerStage(null)
  }

  function updateStageName(idx: number, newName: string) {
    const updated = [...stages]
    updated[idx] = { ...updated[idx], name: newName }
    setStages(updated)
  }

  function updateStage(idx: number, updates: Partial<TemplateStage>) {
    const updated = [...stages]
    updated[idx] = { ...updated[idx], ...updates }
    setStages(updated)
  }

  // ── Task operations ───────────────────────────────────────────────

  function addTask(stageIndex: number) {
    if (!newTaskTitle.trim()) return
    const newTask: TemplateTaskDef = {
      id: genId(),
      title: newTaskTitle.trim(),
      status: 'todo',
      priority: 'medium',
      stage_index: stageIndex,
      duration_minutes: 60,
      auto_schedule: true,
    }
    const newTasks = [...tasks, newTask]
    setTasks(newTasks)
    setEditingTask(newTasks.length - 1)
    setNewTaskTitle('')
    setAddingTaskToStage(null)
  }

  function handleTaskDrop(targetStageIdx: number) {
    if (dragTaskIdx === null) return
    if (tasks[dragTaskIdx]?.stage_index !== targetStageIdx) {
      updateTask(dragTaskIdx, { stage_index: targetStageIdx })
    }
    setDragTaskIdx(null)
    setDragOverStage(null)
  }

  function removeTask(taskIdx: number) {
    const removedId = tasks[taskIdx]?.id
    const newTasks = tasks.filter((_, i) => i !== taskIdx).map(t => ({
      ...t,
      blocked_by_ids: t.blocked_by_ids?.filter(bid => bid !== removedId),
    }))
    setTasks(newTasks)
    if (editingTask === taskIdx) setEditingTask(null)
    else if (editingTask !== null && editingTask > taskIdx) setEditingTask(editingTask - 1)
  }

  function moveTask(taskIdx: number, direction: 'up' | 'down' | 'top' | 'bottom') {
    const task = tasks[taskIdx]
    if (!task) return
    const stageIdx = task.stage_index
    const stageTasks = tasks.map((t, i) => ({ ...t, _origIdx: i })).filter(t => t.stage_index === stageIdx)
    const posInStage = stageTasks.findIndex(t => t._origIdx === taskIdx)
    if (posInStage < 0) return

    let newPos = posInStage
    if (direction === 'up' && posInStage > 0) newPos = posInStage - 1
    else if (direction === 'down' && posInStage < stageTasks.length - 1) newPos = posInStage + 1
    else if (direction === 'top') newPos = 0
    else if (direction === 'bottom') newPos = stageTasks.length - 1
    if (newPos === posInStage) return

    // Reorder within stage
    const reordered = [...stageTasks]
    const [moved] = reordered.splice(posInStage, 1)
    reordered.splice(newPos, 0, moved)

    // Rebuild full task list preserving other stages
    const newTasks = tasks.filter(t => t.stage_index !== stageIdx)
    reordered.forEach(t => { const { _origIdx, ...rest } = t; newTasks.push(rest as typeof tasks[0]) })
    // Sort to keep stage ordering consistent
    newTasks.sort((a, b) => a.stage_index - b.stage_index)
    setTasks(newTasks)
  }

  function updateTask(taskIdx: number, updates: Partial<TemplateTaskDef>) {
    const updated = [...tasks]
    updated[taskIdx] = { ...updated[taskIdx], ...updates }
    setTasks(updated)
  }

  // ── Role operations ───────────────────────────────────────────────

  const newRoleInputRef = useRef<HTMLInputElement>(null)

  function addRole() {
    const color = ROLE_COLORS[roles.length % ROLE_COLORS.length]
    setRoles([...roles, { name: '', description: '', color }])
    setEditingRoleIdx(roles.length)
    setEditingRoleDraft('')
  }

  function updateRole(idx: number, updates: Partial<TemplateRole>) {
    const updated = [...roles]
    updated[idx] = { ...updated[idx], ...updates }
    setRoles(updated)
  }

  function removeRole(idx: number) {
    setRoles(roles.filter((_, i) => i !== idx))
    if (editingRoleIdx === idx) setEditingRoleIdx(null)
  }

  // ── Assignee options (roles + team members) ─────────────────────

  // Build combined list: roles first (with color dots), then team members (with avatars)
  function getAssigneeOptions() {
    const opts: { value: string; label: string; color?: string; group?: string; avatar?: string; memberColor?: string }[] = [
      { value: '', label: 'Unassigned' },
    ]
    // Roles
    for (let i = 0; i < roles.length; i++) {
      const r = roles[i]
      if (!r.name.trim()) continue
      opts.push({ value: `role:${r.name}`, label: r.name, color: getRoleColor(i, roles), group: 'Roles' })
    }
    // Team members
    for (const m of TEAM_MEMBERS) {
      opts.push({ value: `member:${m.id}`, label: m.name, avatar: m.avatar, memberColor: m.color, group: 'Team' })
    }
    return opts
  }

  function renderAssigneeOption(opt: { value: string; label: string; color?: string; avatar?: string; memberColor?: string }, isSelected: boolean) {
    const isRole = opt.value.startsWith('role:')
    const isMember = opt.value.startsWith('member:')
    const m = isMember ? TEAM_MEMBERS.find(t => `member:${t.id}` === opt.value) : null
    return (
      <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${isSelected ? 'bg-[rgba(255,255,255,0.08)]' : 'hover:bg-[rgba(255,255,255,0.06)]'}`} style={{ borderRadius: 'var(--radius-sm)' }}>
        {isRole && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: opt.color }} />}
        {m && <Avatar name={m.name} size={18} src={m.avatar} color={m.color} />}
        {!isRole && !isMember && <IconPerson size={13} />}
        <span className="flex-1 text-text truncate">{opt.label}</span>
        {isRole && <span className="text-[13px] text-text-dim">Role</span>}
        {isSelected && <IconCheck size={12} />}
      </div>
    )
  }

  function getAssigneeDisplay(val: string | undefined) {
    if (!val) return { label: 'Unassigned', color: undefined, member: undefined }
    if (val.startsWith('role:')) {
      const roleName = val.slice(5)
      const ri = roles.findIndex(r => r.name === roleName)
      return { label: roleName, color: ri >= 0 ? getRoleColor(ri, roles) : undefined, member: undefined }
    }
    if (val.startsWith('member:')) {
      const memberId = val.slice(7)
      const m = TEAM_MEMBERS.find(t => t.id === memberId)
      return { label: m?.name || memberId, color: undefined, member: m }
    }
    // Legacy: plain role name
    const ri = roles.findIndex(r => r.name === val)
    if (ri >= 0) return { label: val, color: getRoleColor(ri, roles), member: undefined }
    return { label: val, color: undefined, member: undefined }
  }

  // ── Variable operations ───────────────────────────────────────────

  function addVariable() {
    setTextVariables([...textVariables, { key: '', label: '', default_value: '' }])
  }

  function updateVariable(idx: number, updates: Partial<TemplateVariable>) {
    const updated = [...textVariables]
    updated[idx] = { ...updated[idx], ...updates }
    setTextVariables(updated)
  }

  function removeVariable(idx: number) {
    setTextVariables(textVariables.filter((_, i) => i !== idx))
  }

  // ── Save ──────────────────────────────────────────────────────────

  async function handleSave(): Promise<Template | null> {
    if (!name.trim() || saving) return null
    setSaving(true)
    try {
      const isNew = !template.id || template.id === 0
      const res = await fetch('/api/templates', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isNew ? {} : { id: template.id }),
          name,
          description: description || null,
          stages: JSON.stringify(stages),
          default_tasks: JSON.stringify(tasks),
          roles: JSON.stringify(roles.filter(r => r.name.trim())),
          text_variables: JSON.stringify(textVariables.filter(v => v.key.trim())),
          ...(isNew && template.workspace_id ? { workspace_id: template.workspace_id } : {}),
        }),
      })
      const updated = await res.json()
      onSave(updated)
      setShowSavedToast(true)
      setTimeout(() => setShowSavedToast(false), 3500)
      return updated
    } finally {
      setSaving(false)
      setHasSavedOnce(true)
      setSavedTaskSnapshot(JSON.stringify(tasks))
    }
  }

  // ── Derived state ─────────────────────────────────────────────────

  const editedTask = editingTask !== null ? tasks[editingTask] : null
  const editedTaskStage = editedTask ? stages[editedTask.stage_index] : null

  // Parse snapshot once (not inside every card's render)
  const savedTasksMap = React.useMemo(() => {
    const map = new Map<string, TemplateTaskDef>()
    try {
      const arr = JSON.parse(savedTaskSnapshot) as TemplateTaskDef[]
      for (const t of arr) if (t.id) map.set(t.id, t)
    } catch {}
    return map
  }, [savedTaskSnapshot])

  // ── Capacity overflow warnings per stage ──────────────────────────
  const stageOverflows = useMemo(() => {
    if (workBlocks.length === 0) return new Map<number, { message: string; suggestion: string }>()
    // Compute average daily work minutes for weekdays (Mon-Fri = day 1-5)
    let weekdayMinutes = 0
    let weekdayCount = 0
    for (let d = 1; d <= 5; d++) {
      let dayTotal = 0
      for (const b of workBlocks) {
        if (b.day === d) {
          const [sh, sm] = b.start.split(':').map(Number)
          const [eh, em] = b.end.split(':').map(Number)
          const mins = (eh * 60 + em) - (sh * 60 + sm)
          if (mins > 0) dayTotal += mins
        }
      }
      if (dayTotal > 0) { weekdayMinutes += dayTotal; weekdayCount++ }
    }
    const avgDailyMinutes = weekdayCount > 0 ? weekdayMinutes / weekdayCount : 480

    const map = new Map<number, { message: string; suggestion: string }>()
    stages.forEach((stage, si) => {
      const stageTasks = tasks.filter(t => t.stage_index === si)
      const totalMins = stageTasks.reduce((sum, t) => sum + (t.duration_minutes || 0), 0)
      if (totalMins === 0) return

      const durationValue = stage.expected_duration_value ?? 1
      const durationUnit = stage.expected_duration_unit || 'weeks'
      let workDays: number
      if (durationUnit === 'days') {
        // Calendar days -- estimate ~71% are weekdays
        workDays = Math.round(durationValue * 5 / 7)
      } else if (durationUnit === 'months') {
        workDays = durationValue * 22
      } else {
        // weeks
        workDays = durationValue * 5
      }
      if (workDays < 1) workDays = 1

      const available = Math.floor(workDays * avgDailyMinutes * (dailyCapPercent / 100))
      if (totalMins > available) {
        map.set(si, formatCapacityWarning(available, totalMins, 'template'))
      }
    })
    return map
  }, [stages, tasks, workBlocks, dailyCapPercent])

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center font-sans">
      {/* Backdrop */}
      <div onClick={tryClose} className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div className="relative flex flex-col overflow-hidden rounded-xl border border-border-strong shadow-2xl"
        style={{ width: 'calc(100vw - 80px)', height: 'calc(100vh - 60px)', background: 'var(--bg-modal)' }}
      >
      {/* ── Main layout: sidebar + columns ──────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left Sidebar ──────────────────────────────────────── */}
        <div className="w-[260px] shrink-0 overflow-auto flex flex-col gap-6 rounded-tl-xl border-r border-border p-4 px-3"
          style={{ background: 'var(--bg-chrome)' }}
        >
          {/* Template info section */}
          <div>
            <div className="text-sm font-bold text-text pl-1 flex items-center gap-1.5 mb-2">
              Template info
            </div>
            <SidebarRow label="Template name:">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full text-sm text-text bg-surface border border-border rounded px-2 py-1 outline-none font-inherit"
                placeholder="Template name"
              />
            </SidebarRow>
            <SidebarRow label="Description:">
              <button
                onClick={() => setShowDescriptionModal(true)}
                className="text-sm text-text-secondary bg-transparent border-none cursor-pointer p-0 font-inherit flex items-center gap-1 hover:text-text transition-colors"
              >
                <IconEdit size={11} />
                Edit
              </button>
            </SidebarRow>
            {false && (
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Add description..."
                rows={3}
                className="w-full text-sm text-text bg-surface border border-border rounded px-2 py-1.5 outline-none resize-y font-inherit mt-1 box-border"
              />
            )}
          </div>

          {/* Project defaults section */}
          <div>
            <div className="text-sm font-bold text-text pl-1 flex items-center gap-1.5 mb-2">
              Project defaults
            </div>
            <SidebarRow label="Color:">
              <Dropdown
                value={defaultColor}
                onChange={setDefaultColor}
                options={APP_COLORS.map(c => ({ value: c.value, label: c.name }))}
                renderOption={(opt, isSelected) => (
                  <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${isSelected ? 'bg-[rgba(255,255,255,0.08)]' : 'hover:bg-[rgba(255,255,255,0.06)]'}`} style={{ borderRadius: 'var(--radius-sm)' }}>
                    <span className="w-3 h-3 rounded-[3px] shrink-0" style={{ background: opt.value }} />
                    <span className="flex-1 text-text">{opt.label}</span>
                    {isSelected && <IconCheck size={12} />}
                  </div>
                )}
                renderTrigger={() => (
                  <span className="flex items-center gap-1.5 cursor-pointer py-0.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: defaultColor }} />
                    <span className="text-sm text-text">{getColorName(defaultColor)}</span>
                  </span>
                )}
                minWidth={120}
              />
            </SidebarRow>
            <SidebarRow label="">
              <div
                className="flex items-center gap-2 text-[13px] text-text cursor-pointer py-0.5 max-w-full"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setFolderPopupPos({ top: rect.bottom + 4, left: rect.left })
                  setFolderPopupOpen(true)
                  setFolderFilter('')
                }}
              >
                {(() => {
                  if (!defaultFolderId) return (
                    <>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-muted shrink-0"><path d="M2 4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2" /></svg>
                      <span>No folder</span>
                    </>
                  )
                  const ws = sidebarData.find((w: any) => w.id === (workspaceId || template.workspace_id))
                  if (ws) {
                    const findFolder = (folders: any[]): { name: string; color: string } | null => {
                      for (const f of folders) {
                        if (f.id === defaultFolderId) return { name: f.name, color: f.color || '#6b7280' }
                        const sub = findFolder(f.subFolders || [])
                        if (sub) return sub
                      }
                      return null
                    }
                    const folder = findFolder(ws.folders || [])
                    if (folder) {
                      const fc = folder.color
                      return (
                        <>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M2 4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" fill={fc} fillOpacity="0.3" stroke={fc} strokeWidth="1.2" /></svg>
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: 180 }}>{folder.name}</span>
                        </>
                      )
                    }
                  }
                  return 'No folder'
                })()}
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
                    {/* Filter input */}
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
                    {/* Folders from template's workspace */}
                    <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                      {(() => {
                        const ws = sidebarData.find((w: any) => w.id === (workspaceId || template.workspace_id))
                        if (!ws) return <div className="px-3 py-2 text-sm text-text-dim">No workspace selected</div>
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
                                    setDefaultFolderId(f.id); setFolderPopupOpen(false)
                                    // Auto-populate client_name variable from folder name
                                    const hasClientName = textVariables.some(v => v.key === 'client_name')
                                    if (hasClientName) {
                                      setTextVariables(prev => prev.map(v => v.key === 'client_name' ? { ...v, default_value: f.name } : v))
                                    } else {
                                      setTextVariables(prev => [...prev, { key: 'client_name', label: 'Client Name', default_value: f.name }])
                                    }
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-text bg-transparent border-none cursor-pointer hover:bg-white/5 text-left"
                                  style={{ paddingLeft: 12 + depth * 16 }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M2 4a1 1 0 011-1h4l2 2h4a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" fill={fc} fillOpacity="0.3" stroke={fc} strokeWidth="1.2" /></svg>
                                  <span className={`overflow-hidden text-ellipsis whitespace-nowrap ${defaultFolderId === f.id ? 'font-semibold' : ''}`} style={{ maxWidth: 200 }}>{f.name}</span>
                                </button>
                                {f.subFolders?.length > 0 && renderFolders(f.subFolders, depth + 1)}
                              </div>
                            )
                          })
                        return renderFolders(ws.folders || [], 0)
                      })()}
                    </div>
                    {/* No folder option + Create folder */}
                    <div className="border-t border-border/30 px-3 py-2 flex flex-col gap-1">
                      <button
                        onClick={() => { setDefaultFolderId(null); setFolderPopupOpen(false) }}
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
            </SidebarRow>
            <SidebarRow label="Assignee:">
              <Dropdown
                value={defaultAssignee}
                onChange={setDefaultAssignee}
                options={getAssigneeOptions()}
                renderOption={(opt, isSelected) => renderAssigneeOption(opt as any, isSelected)}
                renderTrigger={() => {
                  const d = getAssigneeDisplay(defaultAssignee)
                  return (
                    <span className="flex items-center gap-1.5 cursor-pointer py-0.5" style={d.color ? { color: d.color } : undefined}>
                      {d.member ? <Avatar name={d.member.name} size={18} src={d.member.avatar} color={d.member.color} /> : <IconPerson size={12} />}
                      <span className="text-sm">{d.label}</span>
                    </span>
                  )
                }}
                minWidth={140}
              />
            </SidebarRow>
            <SidebarRow label="Labels:">
              <span className="text-sm text-text-secondary">None</span>
            </SidebarRow>
            <SidebarRow label="Priority:">
              <Dropdown
                value={defaultPriority}
                onChange={setDefaultPriority}
                options={PRIORITY_OPTIONS}
                renderOption={renderPriorityOption}
                renderTrigger={({ selected }) => (
                  <span className="flex items-center gap-1.5 cursor-pointer py-0.5">
                    <PriorityIcon priority={defaultPriority} size={12} />
                    <span className="text-sm text-text">{selected?.label || 'Medium'}</span>
                  </span>
                )}
                minWidth={120}
              />
            </SidebarRow>
            <SidebarRow label="Description:">
              <button onClick={() => setShowDescriptionModal(true)} className="flex items-center gap-1.5 text-[13px] text-text cursor-pointer bg-transparent border-none font-inherit p-0 hover:text-text-secondary transition-colors">
                <IconEdit size={11} />
                Edit
              </button>
            </SidebarRow>
            <SidebarRow label="Attachments:">
              <button onClick={() => setShowAttachmentsModal(true)} className="flex items-center gap-1.5 text-[13px] text-text-dim cursor-pointer bg-transparent border-none font-inherit p-0 hover:text-text transition-colors">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M7.5 4.5l-4 4a3 3 0 004.24 4.24l5.5-5.5a2 2 0 00-2.83-2.83l-5.5 5.5a1 1 0 001.42 1.42l4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                None
              </button>
            </SidebarRow>
          </div>

          {/* Roles section */}
          <div>
            <div className="text-sm font-bold text-text pl-1 flex items-center gap-1.5 mb-2">
              Roles
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="cursor-help shrink-0">
                <title>Roles are assignable positions in a project template</title>
                <circle cx="8" cy="8" r="7" stroke="var(--text-muted)" strokeWidth="1.2" />
                <text x="8" y="11.5" textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontWeight="600">?</text>
              </svg>
            </div>
            <div className="flex flex-col gap-1.5">
              {roles.map((role, ri) => {
                const roleColor = getRoleColor(ri, roles)
                const isEditing = editingRoleIdx === ri
                const showColorPicker = roleColorPickerIdx === ri
                return (
                  <div key={ri} className="relative">
                    <div className="group flex items-center gap-1.5">
                      {/* Role pill (always visible) */}
                      <button
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 cursor-pointer border-none transition-opacity hover:opacity-80"
                        style={{ background: roleColor + '20' }}
                        onClick={e => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          setEditPopupPos({ top: rect.bottom + 4, left: rect.left })
                          setEditingRoleIdx(ri); setEditingRoleDraft(role.name)
                        }}
                      >
                        <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: roleColor + '30' }}>
                          <span style={{ color: roleColor }}><IconPerson size={12} /></span>
                        </span>
                        <span className="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: roleColor }}>
                          {role.name || 'Unnamed role'}
                        </span>
                      </button>
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={e => {
                          e.stopPropagation()
                          if (isEditing) { setEditingRoleIdx(null); setEditPopupPos(null); return }
                          const rect = e.currentTarget.parentElement!.getBoundingClientRect()
                          setEditPopupPos({ top: rect.bottom + 4, left: rect.left })
                          setEditingRoleIdx(ri); setEditingRoleDraft(role.name)
                        }}
                        className="group-hover:!opacity-100 p-1 border-none text-text-muted cursor-pointer opacity-0 transition-opacity flex items-center bg-transparent"
                      >
                        <IconEdit size={12} />
                      </button>
                      <button
                        onClick={() => removeRole(ri)}
                        className="group-hover:!opacity-100 p-0.5 border-none text-text-muted cursor-pointer opacity-0 transition-opacity flex items-center bg-transparent hover:!text-red"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                    {/* Edit popup (pencil or pill click) -- portal rendered */}
                    {isEditing && editPopupPos && typeof document !== 'undefined' && createPortal(
                      <div className="fixed inset-0 z-[9999]" onMouseDown={() => {
                        if (!editingRoleDraft.trim()) { setRoles(prev => prev.filter((_, i) => i !== ri)) }
                        setEditingRoleIdx(null); setEditPopupPos(null)
                      }}>
                        <div
                          {...popupSurfaceDataProps}
                          className={withPopupSurfaceClassName('fixed rounded-lg border border-border shadow-2xl animate-glass-in overflow-hidden')}
                          style={{ top: editPopupPos.top, left: editPopupPos.left, minWidth: 280, background: 'var(--border)' }}
                          onMouseDown={stopPopupMouseDown}
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2.5 px-3 py-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: roleColor + '25' }}>
                              <span style={{ color: roleColor }}><IconPerson size={16} /></span>
                            </div>
                            <input
                              autoFocus
                              value={editingRoleDraft}
                              onChange={e => setEditingRoleDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  if (editingRoleDraft.trim()) { updateRole(ri, { name: editingRoleDraft.trim() }) }
                                  else { setRoles(prev => prev.filter((_, i) => i !== ri)) }
                                  setEditingRoleIdx(null)
                                }
                                if (e.key === 'Escape') {
                                  if (!role.name.trim()) { setRoles(prev => prev.filter((_, i) => i !== ri)) }
                                  setEditingRoleIdx(null)
                                }
                              }}
                              className="flex-1 text-sm font-medium rounded-md px-2.5 py-1.5 outline-none text-text min-w-0 border border-transparent focus:border-white/15"
                              style={{ background: 'var(--bg-chrome)' }}
                              placeholder="Role name..."
                            />
                          </div>
                          <div className="flex items-center justify-end gap-3 px-3 py-2 border-t border-border/30">
                            <button
                              onClick={() => {
                                if (!role.name.trim()) { setRoles(prev => prev.filter((_, i) => i !== ri)) }
                                setEditingRoleIdx(null)
                              }}
                              className="text-[12px] text-text-dim bg-transparent border-none cursor-pointer hover:text-text font-inherit"
                            >Cancel</button>
                            <button
                              onClick={() => {
                                if (editingRoleDraft.trim()) { updateRole(ri, { name: editingRoleDraft.trim() }) }
                                else { setRoles(prev => prev.filter((_, i) => i !== ri)) }
                                setEditingRoleIdx(null)
                              }}
                              className="text-[12px] text-text-dim bg-transparent border-none cursor-pointer hover:text-text font-inherit"
                            >Save</button>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                    {/* Color picker popup (person icon) -- portal rendered */}
                    {showColorPicker && typeof document !== 'undefined' && createPortal(
                      <div className="fixed inset-0 z-[9999]" onClick={() => setRoleColorPickerIdx(null)}>
                        <div
                          {...popupSurfaceDataProps}
                          className={withPopupSurfaceClassName('fixed rounded-lg border border-border shadow-2xl animate-glass-in overflow-hidden')}
                          style={{ top: '30%', left: '260px', minWidth: 280, background: 'var(--border)' }}
                          onMouseDown={stopPopupMouseDown}
                          onClick={e => e.stopPropagation()}
                        >
                          {/* Person icon + name input */}
                          <div className="flex items-center gap-2.5 px-3 py-2.5">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: roleColor + '25' }}>
                              <span style={{ color: roleColor }}><IconPerson size={16} /></span>
                            </div>
                            <input
                              autoFocus
                              value={role.name}
                              onChange={e => updateRole(ri, { name: e.target.value })}
                              className="flex-1 text-sm font-medium rounded-md px-2.5 py-1.5 outline-none text-text min-w-0 border border-transparent focus:border-white/15"
                              style={{ background: 'var(--bg-chrome)' }}
                              placeholder="Role name..."
                            />
                          </div>
                          {/* Color grid */}
                          <div className="flex flex-col gap-1 px-3 pt-2 pb-2">
                            {APP_COLOR_GRID.map((row, rowIdx) => (
                              <div key={rowIdx} className="flex gap-1">
                                {row.map(c => (
                                  <button
                                    key={c}
                                    onClick={() => updateRole(ri, { color: c })}
                                    className="w-[22px] h-[22px] rounded-[4px] border-none cursor-pointer transition-transform hover:scale-110 flex items-center justify-center"
                                    style={{ background: c }}
                                  >
                                    {roleColor === c && <IconCheck size={11} className="text-white" />}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                          {/* Color name pill */}
                          <div className="px-3 pb-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: roleColor + '25', color: roleColor }}>
                              {getColorName(roleColor)}
                            </span>
                          </div>
                          {/* Cancel / Save */}
                          <div className="flex items-center justify-end gap-3 px-3 py-2">
                            <button onClick={() => setRoleColorPickerIdx(null)} className="text-[12px] text-text-dim bg-transparent border-none cursor-pointer hover:text-text font-inherit">Cancel</button>
                            <button onClick={() => setRoleColorPickerIdx(null)} className="text-[12px] text-text-dim bg-transparent border-none cursor-pointer hover:text-text font-inherit">Save</button>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                )
              })}
              <button
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setEditPopupPos({ top: rect.bottom + 4, left: rect.left })
                  addRole()
                }}
                className="flex items-center gap-1 text-[13px] text-text-dim bg-transparent border-none cursor-pointer py-1 font-inherit hover:text-text"
              >
                <IconPlus size={13} /> Add role
              </button>
            </div>
          </div>

          {/* Text variables section */}
          <div className="flex-1">
            <div className="text-sm font-bold text-text pl-1 flex items-center gap-1.5 mb-2">
              Text variables
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="cursor-help shrink-0">
                <title>Variables that get replaced when creating a project from this template</title>
                <circle cx="8" cy="8" r="7" stroke="var(--text-muted)" strokeWidth="1.2" />
                <text x="8" y="11.5" textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontWeight="600">?</text>
              </svg>
            </div>

            {/* Built-in variable: Project Name */}
            <div className="flex items-center justify-between px-1 py-1.5 mb-1.5 rounded">
              <div className="flex items-center gap-2 text-[12px] text-text-dim">
                <span>Project name:</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold text-white" style={{ background: '#1e3a5f' }}>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" fill="#3b82f6" /><text x="8" y="11" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">T</text></svg>
                  PN
                </span>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText('{{pn}}')}
                className="p-1 text-text-muted hover:text-text cursor-pointer bg-transparent border-none transition-colors"
                title="Copy {{pn}}"
              >
                <IconCopy size={13} />
              </button>
            </div>
            <p className="text-[10px] text-text-muted px-1 mb-2">
              {'Type "/" in task titles to insert variables'}
            </p>

            <div className="flex flex-col gap-1.5">
              {textVariables.map((v, vi) => {
                const initials = (v.label || v.key || '??').split(/[\s_-]+/).map(w => w[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 2)
                const varColors = ['#8c3cdc', '#3c8cdc', '#dd643c', '#3bdd8c', '#ddb53c', '#dd3c64', '#3cddb4']
                const varColor = varColors[vi % varColors.length]
                return (
                <div key={vi} className="hover:bg-hover flex items-center gap-1.5 px-1 py-0.5 rounded transition-colors min-h-[30px]">
                  <span className="text-[12px] text-text-dim overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: 90 }}>
                    {v.label || v.key || 'Unnamed'}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold text-white shrink-0" style={{ background: varColor + '30' }}>
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" fill={varColor} /><text x="8" y="11" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">T</text></svg>
                    {initials}
                  </span>
                  <button
                    onClick={() => { if (v.key) navigator.clipboard?.writeText(`{{${v.key}}}`) }}
                    className="p-0.5 bg-transparent border-none text-text-muted cursor-pointer flex items-center"
                    title="Copy variable tag"
                  >
                    <IconCopy size={13} />
                  </button>
                  <button
                    onClick={() => removeVariable(vi)}
                    className="p-0.5 bg-transparent border-none text-text-muted cursor-pointer flex items-center hover:!text-red"
                  >
                    <IconX size={13} />
                  </button>
                </div>
                )
              })}
              <button
                onClick={addVariable}
                className="flex items-center gap-1 text-[13px] text-text-dim bg-transparent border-none cursor-pointer py-1 px-1 font-inherit hover:text-text"
              >
                <IconPlus size={13} /> Add text variable
              </button>
              {/* Inline edit for the last added variable (if it has no key yet) */}
              {textVariables.length > 0 && !textVariables[textVariables.length - 1].key && (
                <div className="flex flex-col gap-1 py-1.5">
                  <input
                    autoFocus
                    value={textVariables[textVariables.length - 1].key}
                    onChange={e => updateVariable(textVariables.length - 1, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                    placeholder="key (e.g. project_name)"
                    className="w-full text-xs font-mono text-text bg-surface border border-border rounded-md px-2 py-1 outline-none box-border"
                  />
                  <input
                    value={textVariables[textVariables.length - 1].label}
                    onChange={e => updateVariable(textVariables.length - 1, { label: e.target.value })}
                    placeholder="Display label"
                    className="w-full text-xs text-text bg-surface border border-border rounded-md px-2 py-1 outline-none font-inherit box-border"
                  />
                  <input
                    value={textVariables[textVariables.length - 1].default_value || ''}
                    onChange={e => updateVariable(textVariables.length - 1, { default_value: e.target.value })}
                    placeholder="Default value"
                    className="w-full text-xs text-text-dim bg-surface border border-border rounded-md px-2 py-1 outline-none font-inherit box-border"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Main Area: Stage Columns ───────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Stages header row */}
          <div className="flex items-center justify-between pt-[18px] px-5 pl-[22px] pb-2 shrink-0">
            <span className="text-base font-bold text-text">Stages</span>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-text-muted select-none hidden md:inline">
                Hold shift while scrolling to scroll horizontally
              </span>
              <button
                onClick={() => stagesScrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
                className="flex items-center justify-center w-[25px] h-[25px] rounded-md border border-border-default bg-transparent text-text-secondary cursor-pointer p-0 hover:bg-white/5"
              >
                <IconArrowLeft size={13} />
              </button>
              <button
                onClick={() => stagesScrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
                className="flex items-center justify-center w-[25px] h-[25px] rounded-md border border-border-default bg-transparent text-text-secondary cursor-pointer p-0 hover:bg-white/5"
              >
                <IconSmallArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* Scrollable stage columns */}
          <div
            ref={stagesScrollRef}
            className="flex-1 overflow-auto flex flex-row items-start gap-4 min-h-0 px-5 pt-2 pb-4"
          >
          {stages.map((stage, si) => {
            const stageTasks = tasks.map((t, i) => ({ ...t, _idx: i })).filter(t => t.stage_index === si)
            return (
              <div
                key={si}
                onDragOver={e => { e.preventDefault(); setDragOverStage(si) }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={e => { e.preventDefault(); handleTaskDrop(si) }}
                className="min-w-[305px] max-w-[305px] w-[305px] shrink-0 flex flex-col rounded-lg overflow-visible transition-colors"
                style={{ border: dragOverStage === si && dragTaskIdx !== null ? '2px solid var(--accent, #37ca37)' : '2px solid transparent' }}
              >
                {/* Colored top bar */}
                <div className="h-[3px] rounded-t-lg" style={{ background: stage.color }} />

                {/* Stage header */}
                <div className="group px-3 pt-2.5 pb-2 min-h-[130px]" style={{ background: 'var(--border)' }}>
                  {/* Row 1: arrow icon + stage name + trash */}
                  <div className="flex items-center gap-2 mb-2">
                    {/* Arrow icon in rounded square with stage color */}
                    <div className="relative">
                      <button
                        onClick={e => { e.stopPropagation(); setColorPickerStage(colorPickerStage === si ? null : si) }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 cursor-pointer border-none"
                        style={{ background: stage.color + '20' }}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="6" fill={stage.color} />
                          <path d="M6 5l4 3-4 3" fill="white" />
                        </svg>
                      </button>
                      {colorPickerStage === si && (
                        <div
                          onClick={e => e.stopPropagation()}
                          className="absolute top-[40px] left-0 z-50 p-2.5 rounded-lg border border-border shadow-lg animate-glass-in"
                          style={{ background: 'var(--border)' }}
                        >
                          <div className="flex flex-col gap-1">
                            {APP_COLOR_GRID.map((row, rowIdx) => (
                              <div key={rowIdx} className="flex gap-1">
                                {row.map(c => (
                                  <button
                                    key={c}
                                    onClick={() => updateStageColor(si, c)}
                                    className="w-[18px] h-[18px] rounded-[3px] border-none cursor-pointer transition-transform hover:scale-110 flex items-center justify-center"
                                    style={{ background: c }}
                                  >
                                    {stage.color === c && <IconCheck size={13} className="text-white" />}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                          <div className="mt-1.5 text-[13px] text-text-dim text-center font-medium">
                            {getColorName(stage.color)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Stage name input -- dark field */}
                    <input
                      value={stage.name}
                      onChange={e => updateStageName(si, e.target.value)}
                      className="input-sm flex-1 font-medium text-text outline-none px-2 py-[3px] rounded-md font-inherit min-w-0 border border-transparent focus:border-white/15"
                      style={{ background: 'var(--bg-chrome)' }}
                    />

                    {/* Delete stage */}
                    <button
                      onClick={() => removeStage(si)}
                      className="p-1.5 bg-transparent border-none text-text-muted cursor-pointer rounded hover:text-red transition-colors flex items-center"
                      title="Remove stage"
                    >
                      <IconTrash size={18} />
                    </button>
                  </div>

                  {/* Row 2: Expected duration */}
                  <div className="flex items-center gap-1.5 text-[13px] text-text-dim mb-1.5">
                    <span className="text-text-muted">Expected duration:</span>
                    <input
                      type="number"
                      min={1}
                      value={stage.expected_duration_value ?? 1}
                      onChange={e => updateStage(si, { expected_duration_value: e.target.value ? Number(e.target.value) : 1 })}
                      className="w-9 text-xs text-text bg-surface border border-border rounded px-1 py-0.5 outline-none text-center font-inherit"
                    />
                    <Dropdown
                      options={[
                        { label: 'days', value: 'days' },
                        { label: 'weeks', value: 'weeks' },
                        { label: 'months', value: 'months' },
                      ]}
                      value={stage.expected_duration_unit || 'weeks'}
                      onChange={v => updateStage(si, { expected_duration_unit: v as 'days' | 'weeks' | 'months' })}
                      minWidth={80}
                      triggerClassName="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-text bg-transparent border border-border hover:bg-white/5 cursor-pointer"
                    />
                  </div>

                  {/* Row 3: Auto-schedule toggle */}
                  <AutoScheduleToggle
                    size="sm"
                    active={stage.auto_schedule_all ?? true}
                    onChange={() => updateStage(si, { auto_schedule_all: !(stage.auto_schedule_all ?? true) })}
                    label="Auto-schedule all tasks in this stage"
                  />
                </div>

                {/* Capacity overflow warning */}
                {stageOverflows.get(si) && (
                  <div className="mx-2 mb-2 px-2 py-1.5 rounded-md text-[10px] flex flex-col gap-0.5" style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', color: '#eab308' }}>
                    <span className="font-medium">{stageOverflows.get(si)!.message}</span>
                    <span style={{ color: '#ca8a04' }}>{stageOverflows.get(si)!.suggestion}</span>
                  </div>
                )}

                {/* Task cards */}
                <div className="flex flex-col gap-1.5 py-1.5" style={{ background: 'var(--bg-modal)' }}>
                  {stageTasks.map(task => {
                    const assignedRole = task.role
                    const roleIdx = roles.findIndex(r => r.name === assignedRole)
                    const roleColor = roleIdx >= 0 ? getRoleColor(roleIdx, roles) : undefined
                    const hasDeps = task.blocked_by_ids && task.blocked_by_ids.length > 0
                    const isEvent = task.task_type === 'event'
                    // Modified = field changed from saved version
                    const savedVersion = task.id ? savedTasksMap.get(task.id) : undefined
                    const isModified = savedVersion ? JSON.stringify({ ...task, _idx: undefined }) !== JSON.stringify({ ...savedVersion, _idx: undefined }) : true

                    return (
                      <div key={task._idx} className="flex flex-col gap-1.5">
                      <div
                        draggable
                        onDragStart={e => {
                          setDragTaskIdx(task._idx)
                          e.dataTransfer.effectAllowed = 'move'
                          if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '0.4'
                        }}
                        onDragEnd={e => {
                          setDragTaskIdx(null)
                          setDragOverStage(null)
                          if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1'
                        }}
                        className="bg-elevated rounded-lg overflow-visible cursor-grab transition-opacity min-h-[250px] flex flex-col"
                        style={{ border: hasSavedOnce && isModified ? '2px solid #f97316' : '1px solid var(--border)' }}
                      >
                        {/* Task/Event toggle + menu */}
                        <div className="flex items-center justify-between px-2 pt-1.5 pb-1" style={{ background: 'var(--bg-chrome)', borderRadius: '8px 8px 0 0' }}>
                          <div className="flex items-center rounded-md overflow-hidden" style={{ background: 'var(--bg-chrome)' }}>
                            <button
                              onClick={() => updateTask(task._idx, { task_type: 'task' })}
                              className={`px-2.5 py-1 text-[11px] font-medium border-none cursor-pointer transition-colors ${(task.task_type || 'task') === 'task' ? 'bg-white/10 text-text' : 'bg-transparent text-text-dim hover:text-text-secondary'}`}
                            >
                              Task
                            </button>
                            <button
                              onClick={() => updateTask(task._idx, { task_type: 'event' })}
                              className={`px-2.5 py-1 text-[11px] font-medium border-none cursor-pointer transition-colors ${task.task_type === 'event' ? 'bg-white/10 text-text' : 'bg-transparent text-text-dim hover:text-text-secondary'}`}
                            >
                              Event
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasSavedOnce && isModified && <span className="text-[11px] italic text-orange-400 font-medium">Modified</span>}
                          <div className="relative">
                            <button
                              onClick={e => { e.stopPropagation(); setCardMenuTask(cardMenuTask === task._idx ? null : task._idx) }}
                              className="p-1 rounded hover:bg-white/10 text-text-dim cursor-pointer border-none bg-transparent transition-colors"
                            >
                              <IconMoreHorizontal size={14} />
                            </button>
                            {cardMenuTask === task._idx && (
                              <div
                                onClick={e => e.stopPropagation()}
                                className="absolute right-0 top-full mt-1 z-50 py-1 rounded-lg border border-border shadow-lg animate-glass-in min-w-[160px]"
                                style={{ background: 'var(--border)' }}
                              >
                                <button onClick={() => { setEditingTask(task._idx); setCardMenuTask(null) }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text hover:bg-white/[0.06] cursor-pointer border-none bg-transparent font-inherit text-left">
                                  <IconEdit size={14} />
                                  Edit task
                                </button>
                                <div className="border-t border-border my-1" />
                                <button onClick={() => { moveTask(task._idx, 'top'); setCardMenuTask(null) }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text hover:bg-white/[0.06] cursor-pointer border-none bg-transparent font-inherit text-left">
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 3h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                                  Move to top
                                </button>
                                <button onClick={() => { moveTask(task._idx, 'up'); setCardMenuTask(null) }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text hover:bg-white/[0.06] cursor-pointer border-none bg-transparent font-inherit text-left">
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 4v8M4 8l4-4 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  Move up
                                </button>
                                <button onClick={() => { moveTask(task._idx, 'down'); setCardMenuTask(null) }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text hover:bg-white/[0.06] cursor-pointer border-none bg-transparent font-inherit text-left">
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 12V4M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  Move down
                                </button>
                                <button onClick={() => { moveTask(task._idx, 'bottom'); setCardMenuTask(null) }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text hover:bg-white/[0.06] cursor-pointer border-none bg-transparent font-inherit text-left">
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                                  Move to bottom
                                </button>
                                <div className="border-t border-border my-1" />
                                <button onClick={() => { removeTask(task._idx); setCardMenuTask(null) }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-400 hover:bg-red-500/10 cursor-pointer border-none bg-transparent font-inherit text-left">
                                  <IconTrash size={14} />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                          </div>{/* /flex wrapper for Modified + menu */}
                        </div>

                        {/* Event: "Schedule" prefix */}
                        {isEvent && (
                          <div className="px-2.5 pt-1">
                            <span className="text-[11px] text-yellow-600 font-medium">Schedule</span>
                          </div>
                        )}

                        {/* Title with "/" variable picker + pill rendering */}
                        <div className="mb-2 px-2.5 pt-2 relative">
                          {/* Render title with variable pills when not editing */}
                          <div className="relative">
                            <input
                              value={task.title}
                              onChange={e => {
                                const val = e.target.value
                                updateTask(task._idx, { title: val })
                                if (val.endsWith('/')) setVarPickerTask(task._idx)
                                else setVarPickerTask(null)
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Escape') setVarPickerTask(null)
                                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                              }}
                              className="input-sm font-medium text-text leading-normal block w-full bg-transparent border border-transparent rounded outline-none py-0.5 font-inherit box-border focus:border-white/15 focus:bg-white/[0.04] focus:px-1"
                              style={{ color: task.title.includes('{{') ? 'transparent' : undefined, caretColor: 'white' }}
                            />
                            {/* Pill overlay for variables */}
                            {task.title.includes('{{') && (
                              <div className="absolute inset-0 flex items-center pointer-events-none py-0.5 text-[12px] font-medium leading-snug overflow-hidden">
                                {task.title.split(/(\{\{[^}]+\}\})/).map((part, pi) => {
                                  const match = part.match(/^\{\{(\w+)\}\}$/)
                                  if (match) {
                                    const key = match[1]
                                    const initials = key.split(/[_\s-]+/).map(w => w[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 3)
                                    const pillColor = key === 'pn' || key === 'project_name' ? '#1e3a5f' : key === 'client_name' ? '#3c8cdc' : 'rgba(255,255,255,0.15)'
                                    return (
                                      <span key={pi} className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-bold text-white mx-0.5 shrink-0" style={{ background: pillColor }}>
                                        {initials}
                                      </span>
                                    )
                                  }
                                  return <span key={pi} className="text-text">{part}</span>
                                })}
                              </div>
                            )}
                          </div>
                          {/* Variable picker dropdown */}
                          {varPickerTask === task._idx && (
                            <div className="absolute left-2 top-full mt-1 z-50 rounded-lg border border-border shadow-lg animate-glass-in py-1 min-w-[200px]" style={{ background: 'var(--border)' }}>
                              <div className="px-2.5 py-1.5">
                                <input
                                  autoFocus
                                  placeholder="pn"
                                  className="input-compact w-full bg-transparent border-none outline-none text-text text-[12px] font-inherit"
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') setVarPickerTask(null)
                                  }}
                                  readOnly
                                />
                              </div>
                              {/* Built-in: Project Name */}
                              <button
                                onClick={() => {
                                  const current = task.title
                                  // Replace trailing "/" with {{pn}}
                                  const newTitle = current.endsWith('/') ? current.slice(0, -1) + '{{pn}}' : current + '{{pn}}'
                                  updateTask(task._idx, { title: newTitle })
                                  setVarPickerTask(null)
                                }}
                                className="flex items-center gap-2 w-full px-2.5 py-2 text-[13px] text-text hover:bg-white/[0.06] cursor-pointer border-none bg-transparent font-inherit text-left transition-colors"
                              >
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: '#1e3a5f' }}>
                                  <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" fill="#3b82f6" /><text x="8" y="11" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">T</text></svg>
                                  PN
                                </span>
                                <span>Project name</span>
                              </button>
                              {/* Custom variables */}
                              {textVariables.filter(v => v.key.trim()).map((v, vi) => (
                                <button
                                  key={vi}
                                  onClick={() => {
                                    const current = task.title
                                    const tag = `{{${v.key}}}`
                                    const newTitle = current.endsWith('/') ? current.slice(0, -1) + tag : current + tag
                                    updateTask(task._idx, { title: newTitle })
                                    setVarPickerTask(null)
                                  }}
                                  className="flex items-center gap-2 w-full px-2.5 py-2 text-[13px] text-text hover:bg-white/[0.06] cursor-pointer border-none bg-transparent font-inherit text-left transition-colors"
                                >
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-white/10">
                                    {v.key.toUpperCase()}
                                  </span>
                                  <span>{v.label || v.key}</span>
                                </button>
                              ))}
                              {/* New text variable */}
                              <div className="border-t border-border mt-1 pt-1">
                                <button
                                  onClick={() => setVarPickerTask(null)}
                                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[12px] text-text-dim hover:text-text cursor-pointer border-none bg-transparent font-inherit text-left transition-colors"
                                >
                                  <IconPlus size={11} />
                                  New text variable
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Two-column grid rows */}
                        <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-[13px] text-text px-2.5">

                          {/* Start offset */}
                          <Popover
                            open={offsetPopover?.taskIdx === task._idx && offsetPopover?.field === 'start'}
                            onOpenChange={open => setOffsetPopover(open ? { taskIdx: task._idx, field: 'start' } : null)}
                            trigger={
                              <span
                                onClick={() => setOffsetPopover(offsetPopover?.taskIdx === task._idx && offsetPopover?.field === 'start' ? null : { taskIdx: task._idx, field: 'start' })}
                                className="flex items-center gap-1.5 py-1 px-1 -mx-1 cursor-pointer text-[13px] rounded hover:bg-white/[0.06] transition-colors"
                              >
                                <IconCalendar size={13} />
                                <span className="inline-flex items-center gap-1.5 rounded-md text-[11px] font-semibold px-2 py-0.5"
                                  style={{ background: stage.color + '25' }}
                                >
                                  <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0" style={{ background: stage.color }}>
                                    <span className="text-white"><IconSmallArrowRight size={7} /></span>
                                  </span>
                                  <span className="text-white">Start</span>
                                </span>
                                <span className="text-text">+{task.offset_days ?? 0}d</span>
                              </span>
                            }
                            minWidth={420}
                          >
                            <div className="p-3.5 space-y-3 rounded-lg -m-px" style={{ background: 'var(--border)' }}>
                              <div className="text-sm font-medium text-text">Start Date</div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] font-semibold cursor-pointer whitespace-nowrap" style={{ background: 'var(--bg-surface)', color: stage.color }}>
                                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: stage.color }}>
                                    <span className="text-white"><IconSmallArrowRight size={13} /></span>
                                  </span>
                                  Stage start
                                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                </div>
                                <div className="flex items-center gap-1 rounded-lg px-3 py-2.5 text-[13px] text-text-dim cursor-pointer" style={{ background: 'var(--bg-surface)' }}>
                                  plus
                                  <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                </div>
                                <Dropdown
                                  value={String(task.offset_days ?? 0)}
                                  onChange={v => updateTask(task._idx, { offset_days: Number(v) })}
                                  options={DAY_OFFSET_OPTIONS}
                                  minWidth={60}
                                  renderTrigger={({ selected }) => (
                                    <span className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] text-text cursor-pointer min-w-[56px] justify-between" style={{ background: 'var(--bg-surface)' }}>
                                      {selected?.label ?? '0'}
                                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                    </span>
                                  )}
                                />
                                <Dropdown
                                  value={task.offset_unit || 'days'}
                                  onChange={v => updateTask(task._idx, { offset_unit: v as 'days' | 'weekdays' | 'weeks' })}
                                  options={[{ value: 'days', label: 'days' }, { value: 'weekdays', label: 'weekdays' }, { value: 'weeks', label: 'weeks' }]}
                                  minWidth={110}
                                  renderTrigger={({ selected }) => (
                                    <span className="flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-[13px] text-text cursor-pointer" style={{ background: 'var(--bg-surface)' }}>
                                      {selected?.label || 'days'}
                                      <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                    </span>
                                  )}
                                />
                              </div>
                            </div>
                          </Popover>

                          {/* Deadline offset */}
                          <Popover
                            open={offsetPopover?.taskIdx === task._idx && offsetPopover?.field === 'deadline'}
                            onOpenChange={open => setOffsetPopover(open ? { taskIdx: task._idx, field: 'deadline' } : null)}
                            trigger={
                              <span
                                onClick={() => setOffsetPopover(offsetPopover?.taskIdx === task._idx && offsetPopover?.field === 'deadline' ? null : { taskIdx: task._idx, field: 'deadline' })}
                                className="flex items-center gap-1.5 py-1 px-1 -mx-1 cursor-pointer text-[13px] rounded hover:bg-white/[0.06] transition-colors"
                              >
                                <IconCalendar size={13} />
                                <span className="inline-flex items-center gap-1.5 rounded-md text-[11px] font-semibold px-2 py-0.5"
                                  style={{ background: stage.color + '25' }}
                                >
                                  <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0" style={{ background: stage.color }}>
                                    <span className="text-white"><IconArrowLeft size={7} /></span>
                                  </span>
                                  <span className="text-white">Deadline</span>
                                </span>
                                <span className="text-text">-{task.deadline_offset_days ?? 0}d</span>
                              </span>
                            }
                            minWidth={420}
                          >
                            <div className="p-3.5 space-y-3 rounded-lg -m-px" style={{ background: 'var(--border)' }}>
                              <div className="text-sm font-medium text-text">Deadline</div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] font-semibold cursor-pointer whitespace-nowrap" style={{ background: 'var(--bg-surface)', color: stage.color }}>
                                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: stage.color }}>
                                    <span className="text-white"><IconArrowLeft size={13} /></span>
                                  </span>
                                  Stage deadline
                                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                </div>
                                <div className="flex items-center gap-1 rounded-lg px-3 py-2.5 text-[13px] text-text-dim cursor-pointer" style={{ background: 'var(--bg-surface)' }}>
                                  minus
                                  <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                </div>
                                <Dropdown
                                  value={String(task.deadline_offset_days ?? 0)}
                                  onChange={v => updateTask(task._idx, { deadline_offset_days: Number(v) })}
                                  options={DAY_OFFSET_OPTIONS}
                                  minWidth={60}
                                  renderTrigger={({ selected }) => (
                                    <span className="flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] text-text cursor-pointer min-w-[56px] justify-between" style={{ background: 'var(--bg-surface)' }}>
                                      {selected?.label ?? '0'}
                                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                    </span>
                                  )}
                                />
                                <Dropdown
                                  value={task.deadline_offset_unit || 'days'}
                                  onChange={v => updateTask(task._idx, { deadline_offset_unit: v as 'days' | 'weekdays' | 'weeks' })}
                                  options={[{ value: 'days', label: 'days' }, { value: 'weekdays', label: 'weekdays' }, { value: 'weeks', label: 'weeks' }]}
                                  minWidth={110}
                                  renderTrigger={({ selected }) => (
                                    <span className="flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-[13px] text-text cursor-pointer" style={{ background: 'var(--bg-surface)' }}>
                                      {selected?.label || 'days'}
                                      <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="opacity-40"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                                    </span>
                                  )}
                                />
                              </div>
                            </div>
                          </Popover>

                          {/* Status */}
                          <Dropdown
                            value={task.status || 'todo'}
                            onChange={v => updateTask(task._idx, { status: v })}
                            options={TASK_STATUS_OPTIONS}
                            renderOption={renderStatusOption}
                            renderTrigger={({ selected }) => (
                              <span className="flex items-center gap-1.5 py-1 px-1 -mx-1 cursor-pointer text-[13px] rounded hover:bg-white/[0.06] transition-colors">
                                <StatusIcon status={selected?.value || 'todo'} size={13} />
                                <span className="text-[13px]">{selected?.label || 'Todo'}</span>
                              </span>
                            )}
                            minWidth={120}
                          />

                          {/* Duration + Chunks */}
                          <span className="flex items-center gap-1 py-0.5">
                            <Dropdown
                              value={task.duration_minutes !== undefined ? String(task.duration_minutes) : ''}
                              onChange={v => updateTask(task._idx, { duration_minutes: v !== '' ? Number(v) : undefined })}
                              options={DURATION_OPTIONS}
                              searchable
                              placeholder="Choose or type a duration"
                              renderTrigger={({ selected }) => (
                                <span className="flex items-center gap-1.5 py-1 px-1 -mx-1 cursor-pointer text-[13px] rounded hover:bg-white/[0.06] transition-colors">
                                  <IconClock size={13} />
                                  <span>{formatDurationFull(task.duration_minutes)}</span>
                                </span>
                              )}
                              minWidth={120}
                            />
                            {/* Chunks icon */}
                            <Dropdown
                              value={task.min_chunk_minutes ? String(task.min_chunk_minutes) : ''}
                              onChange={v => updateTask(task._idx, { min_chunk_minutes: v ? Number(v) : undefined })}
                              options={[{ value: '', label: 'No chunking' }, ...CHUNK_OPTIONS.filter(o => o.value !== '0')]}
                              renderTrigger={() => (
                                <span className={`flex items-center justify-center w-6 h-6 rounded cursor-pointer transition-colors hover:bg-white/[0.06] ${task.min_chunk_minutes ? 'text-text bg-white/[0.08]' : 'text-text-dim'}`}>
                                  <IconChunks size={13} />
                                </span>
                              )}
                              minWidth={120}
                            />
                          </span>

                          {/* Priority */}
                          <Dropdown
                            value={task.priority || 'medium'}
                            onChange={v => updateTask(task._idx, { priority: v })}
                            options={PRIORITY_OPTIONS}
                            renderOption={renderPriorityOption}
                            renderTrigger={({ selected }) => (
                              <span className="flex items-center gap-1.5 py-1 px-1 -mx-1 cursor-pointer text-[13px] rounded hover:bg-white/[0.06] transition-colors">
                                <PriorityIcon priority={task.priority || 'medium'} size={13} />
                                <span className="text-[13px] text-text">{selected?.label || 'Medium'}</span>
                              </span>
                            )}
                            minWidth={120}
                          />

                          {/* Assignee (Role or Person) */}
                          <Dropdown
                            value={task.role || ''}
                            onChange={v => updateTask(task._idx, { role: v || undefined })}
                            options={getAssigneeOptions()}
                            renderOption={(opt, isSelected) => renderAssigneeOption(opt as any, isSelected)}
                            renderTrigger={() => {
                              const d = getAssigneeDisplay(task.role)
                              const hasRole = task.role && d.color
                              return hasRole ? (
                                <span className="inline-flex items-center gap-1.5 py-1 px-2 rounded-full cursor-pointer text-xs font-medium" style={{ background: d.color + '20', color: d.color }}>
                                  <IconPerson size={11} />
                                  {d.label}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 py-1 px-1 -mx-1 cursor-pointer text-text rounded hover:bg-white/[0.06] transition-colors">
                                  {d.member ? <Avatar name={d.member.name} size={18} src={d.member.avatar} color={d.member.color} /> : <IconPerson size={12} />}
                                  <span className="">{d.label}</span>
                                </span>
                              )
                            }}
                            minWidth={140}
                          />

                          {/* Labels (click-to-edit inline input) */}
                          <span
                            onClick={e => { e.stopPropagation(); setEditingLabels(editingLabels === task._idx ? null : task._idx) }}
                            className="flex items-center gap-1.5 cursor-pointer relative py-1 px-1 -mx-1 rounded hover:bg-white/[0.06] transition-colors"
                          >
                            <IconTag size={13} />
                            {editingLabels === task._idx ? (
                              <span onClick={e => e.stopPropagation()}>
                                <input autoFocus value={(task.labels || []).join(', ')}
                                  onChange={e => { const labels = e.target.value ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : []; updateTask(task._idx, { labels }) }}
                                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingLabels(null) }}
                                  onBlur={() => setEditingLabels(null)} placeholder="label1, label2..."
                                  className="text-[11px] text-text bg-black/30 border border-white/10 rounded-sm outline-none px-1 py-px font-inherit w-[90px]"
                                />
                              </span>
                            ) : (
                              <span className="text-[13px]">{task.labels && task.labels.length > 0 ? task.labels.join(', ') : 'Labels'}</span>
                            )}
                          </span>

                          {/* Blocked by */}
                          <Dropdown
                            value=""
                            onChange={v => {
                              const current = task.blocked_by_ids || []
                              const updated = current.includes(v) ? current.filter(id => id !== v) : [...current, v]
                              updateTask(task._idx, { blocked_by_ids: updated })
                            }}
                            options={tasks.filter(t => t.id !== task.id).map(bt => {
                              const stg = stages[bt.stage_index]
                              return { label: bt.title || 'Untitled', value: bt.id!, description: stg?.name, color: stg?.color }
                            })}
                            renderTrigger={() => (
                              <span className="flex items-center gap-1.5 py-1 px-1 -mx-1 cursor-pointer text-[13px] rounded hover:bg-white/[0.06] transition-colors">
                                <IconNoEntry size={13} />
                                <span className="text-[13px]">{hasDeps ? `${task.blocked_by_ids!.length} blocker${task.blocked_by_ids!.length > 1 ? 's' : ''}` : 'Blocked by'}</span>
                              </span>
                            )}
                            searchable
                            minWidth={160}
                          />
                        </div>

                        {/* Footer: Auto-schedule + Edit */}
                        <div className="flex items-center justify-between mt-auto px-2 py-1.5 rounded-b-lg" style={{ background: 'var(--bg-chrome)' }}>
                          <div onClick={e => e.stopPropagation()}>
                            <AutoScheduleToggle
                              size="sm"
                              active={task.auto_schedule !== false}
                              onChange={() => updateTask(task._idx, { auto_schedule: task.auto_schedule === false ? true : false })}
                              label="Auto-scheduled"
                            />
                          </div>
                          <button onClick={() => setEditingTask(task._idx)}
                            className="flex items-center gap-1 text-xs text-text-secondary bg-white/5 border border-border-default cursor-pointer px-2.5 py-0.5 rounded-md font-inherit hover:bg-white/10"
                          >
                            <IconEdit size={13} />
                            Edit
                          </button>
                        </div>
                      </div>
                      {/* Event: How it works diagram */}
                      {isEvent && (
                        <div className="px-2 py-2">
                          <div className="text-[11px] text-text-dim font-medium mb-2 flex items-center gap-1">
                            How it works
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-text-muted"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" /><text x="8" y="11" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="600">?</text></svg>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {/* Schedule task pill */}
                            <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5 border-l-2 text-[10px] font-medium" style={{ background: 'var(--bg-chrome)', borderColor: stage.color }}>
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="var(--text-secondary)" strokeWidth="1.2" /></svg>
                              Schedule {task.title ? (task.title.length > 12 ? task.title.slice(0, 12) + '...' : task.title) : 'task'}...
                            </div>
                            {/* Arrow with checkmark */}
                            <div className="flex items-center gap-0.5 text-text-muted">
                              <span>—</span>
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#22c55e" /><path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              <span>→</span>
                            </div>
                            {/* Event pill */}
                            <div className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium" style={{ background: '#1e3a5f', color: '#93c5fd' }}>
                              {task.title ? (task.title.length > 14 ? task.title.slice(0, 14) + '...' : task.title) : 'Event'}
                            </div>
                          </div>
                        </div>
                      )}
                      </div>
                    )
                  })}

                  {/* Inline add task */}
                  {addingTaskToStage === si && (
                    <div className="rounded-md border border-white/10 px-2.5 py-1.5" style={{ background: 'var(--border)' }}>
                      <input
                        ref={addTaskRef}
                        autoFocus
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        placeholder="Task name..."
                          className="input-sm w-full text-text bg-transparent border-none outline-none font-inherit"
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newTaskTitle.trim()) addTask(si)
                            if (e.key === 'Escape') { setAddingTaskToStage(null); setNewTaskTitle('') }
                          }}
                          onBlur={() => {
                            if (newTaskTitle.trim()) addTask(si)
                            else { setAddingTaskToStage(null); setNewTaskTitle('') }
                          }}
                        />
                    </div>
                  )}

                  {/* + Add task or event */}
                  <button
                    onClick={() => {
                      const newTask: TemplateTaskDef = {
                        id: genId(),
                        title: '',
                        status: 'todo',
                        priority: 'medium',
                        stage_index: si,
                        duration_minutes: 30,
                        auto_schedule: true,
                      }
                      setTasks(prev => [...prev, newTask])
                    }}
                    className="flex items-center justify-center gap-1.5 w-full py-2.5 text-[13px] text-text-dim cursor-pointer bg-transparent border-none font-inherit hover:text-text transition-colors"
                  >
                    <IconPlus size={12} />
                    Add task or event
                  </button>
                </div>
              </div>
            )
          })}

          {/* Add stage column */}
          <div className="min-w-[200px] shrink-0 flex items-start justify-center pt-6">
            <button
              onClick={addStage}
              className="flex items-center gap-2 text-[13px] text-text-muted bg-white/[0.04] border border-dashed border-white/10 rounded-lg px-5 py-2.5 cursor-pointer font-inherit transition-all hover:text-text-secondary hover:border-white/20 hover:bg-white/[0.06]"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Add Stage
            </button>
          </div>

          {/* Empty state */}
          {stages.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-[60px]">
              No stages yet. Click &quot;Add Stage&quot; to get started.
            </div>
          )}
        </div>
        </div>{/* /stages flex-col wrapper */}
      </div>

      {/* ── Task Detail Overlay (matches TaskDetailPanel layout exactly) ── */}
      {editedTask && editingTask !== null && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-5" onClick={() => setEditingTask(null)}>
          <div className="w-[calc(100vw-120px)] max-w-[1100px] h-[min(740px,calc(100vh-100px))] rounded-xl border border-border-strong shadow-2xl overflow-hidden" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
          <div className="flex h-full overflow-hidden">
          {/* Left pane: Title, Description, Activity */}
          <div className="flex-1 flex flex-col min-w-0 rounded-l-lg overflow-hidden" style={{ background: 'var(--bg-modal)' }}>

            {/* Header with actions */}
            <div className="flex items-center justify-end gap-1 px-4 py-2">
              <button className="rounded-md p-1.5 text-text-dim hover:bg-hover hover:text-text-secondary" title="More">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="4" cy="8" r="1.2" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                  <circle cx="12" cy="8" r="1.2" fill="currentColor" />
                </svg>
              </button>
              <button onClick={() => setEditingTask(null)} className="rounded-md p-1.5 text-text-dim hover:bg-hover hover:text-text ml-1">
                <IconX size={14} />
              </button>
            </div>

            {/* Title */}
            <div className="px-6">
              <input
                value={editedTask.title}
                onChange={e => updateTask(editingTask, { title: e.target.value })}
                className="w-full bg-transparent text-[18px] font-semibold text-text outline-none placeholder:text-text-dim"
                placeholder="Task title"
              />
            </div>

            {/* Rich text toolbar */}
            <div className="flex items-center gap-1 px-6 py-3 border-b border-border">
              {['B', 'I', 'U', 'S'].map(b => (
                <button key={b} className={`flex h-7 w-7 items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text-secondary ${b === 'B' ? 'font-bold' : b === 'I' ? 'italic' : b === 'U' ? 'underline' : 'line-through'}`}>{b}</button>
              ))}
              <button className="flex h-7 w-7 items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text-secondary">H1</button>
              <button className="flex h-7 w-7 items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text-secondary">H2</button>
              <div className="w-px h-4 bg-border mx-1" />
              <button className="flex h-7 w-7 items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text-secondary">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M4 3h8M4 7h8M4 11h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="1.5" cy="3" r="1" fill="currentColor" />
                  <circle cx="1.5" cy="7" r="1" fill="currentColor" />
                  <circle cx="1.5" cy="11" r="1" fill="currentColor" />
                </svg>
              </button>
              <button className="flex h-7 w-7 items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text-secondary">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 3h7M5 7h7M5 11h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <text x="0" y="5" fontSize="5" fill="currentColor" fontFamily="sans-serif">1</text>
                  <text x="0" y="9" fontSize="5" fill="currentColor" fontFamily="sans-serif">2</text>
                  <text x="0" y="13" fontSize="5" fill="currentColor" fontFamily="sans-serif">3</text>
                </svg>
              </button>
              <button className="flex h-7 w-7 items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text-secondary">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M6 3h6M6 7h6M6 11h6M2 3l2 0M2 7l2 0M2 11l2 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Description + Subtasks + Attachments + Activity */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Description */}
              <div className="px-6 py-4">
                <textarea
                  value={editedTask.description || ''}
                  onChange={e => updateTask(editingTask, { description: e.target.value })}
                  placeholder="Description"
                  className="w-full min-h-[300px] text-[14px] leading-relaxed text-text outline-none resize-none bg-transparent placeholder:text-text-dim"
                />
              </div>

              {/* Subtasks */}
              <div className="pt-2 px-4 pb-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[12px] font-semibold text-text-secondary">Subtasks</span>
                  <span className="text-[11px] text-text-dim">({(editedTask.checklist || []).length})</span>
                  <button
                    onClick={() => updateTask(editingTask, { checklist: [...(editedTask.checklist || []), ''] })}
                    className="ml-auto text-[11px] text-text-dim hover:text-text-secondary"
                  >
                    + Add subtask
                  </button>
                </div>
                {(editedTask.checklist || []).map((item, ci) => (
                  <div key={ci} className="flex items-center gap-2 py-1.5 group">
                    <div className="flex h-4 w-4 items-center justify-center rounded border border-border-strong shrink-0" />
                    <input
                      value={item}
                      onChange={e => {
                        const newChecklist = [...(editedTask.checklist || [])]
                        newChecklist[ci] = e.target.value
                        updateTask(editingTask, { checklist: newChecklist })
                      }}
                      className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim"
                      placeholder="Subtask title"
                    />
                    <button
                      onClick={() => updateTask(editingTask, { checklist: (editedTask.checklist || []).filter((_, i) => i !== ci) })}
                      className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 shrink-0 transition-opacity"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              {/* Attachments */}
              <div className="pt-2 px-4">
                <button className="flex items-center gap-2 text-[12px] w-full">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="text-text-dim">
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="font-semibold text-text-secondary">Attachments (0)</span>
                </button>
              </div>

              {/* Activity */}
              <div className="px-4 pb-3 pt-2 shrink-0">
                <button className="flex items-center gap-2 text-[12px] mb-2">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="rotate-90 text-text-dim">
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="font-semibold text-text-secondary">Activity</span>
                </button>

                {/* Comment input */}
                <div className="mb-2">
                  <input
                    placeholder="Enter comment"
                    className="w-full rounded-md border border-border px-2.5 py-1.5 text-[12px] text-text outline-none placeholder:text-text-dim focus:border-border-strong"
                    style={{ background: 'var(--bg-chrome)' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right pane: Properties */}
          <div className="w-[300px] shrink-0 overflow-y-auto rounded-r-lg border-l border-border" style={{ background: 'var(--bg-chrome)' }}>

            {/* Breadcrumb: stage info */}
            <div className="px-3 pt-3 pb-2">
              <div className="space-y-1.5">
                {editedTaskStage && (
                  <div className="flex items-center gap-2 text-[13px]">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: editedTaskStage.color || 'var(--text-secondary)' }}>
                      <path d="M3 8h7M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="inline-flex rounded-md px-2 py-0.5 text-[12px] font-medium" style={{ backgroundColor: editedTaskStage.color + '22', color: editedTaskStage.color }}>
                      {editedTaskStage.name}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ height: 16 }} />

              {/* Auto-schedule */}
              <OverlayPropRow label="Auto-schedule">
                <AutoScheduleToggle
                  size="sm"
                  active={editedTask.auto_schedule !== false}
                  onChange={() => updateTask(editingTask, { auto_schedule: editedTask.auto_schedule === false ? true : false })}
                  label="Auto-scheduled"
                />
              </OverlayPropRow>

              <div style={{ height: 16 }} />

              {/* Stage */}
              <OverlayPropRow label="Stage:">
                <Dropdown
                  value={String(editedTask.stage_index)}
                  onChange={(v) => updateTask(editingTask, { stage_index: Number(v) })}
                  options={stages.map((s, i) => ({ value: String(i), label: s.name, color: s.color }))}
                  renderTrigger={({ selected }) => {
                    const stage = stages[editedTask.stage_index]
                    return (
                      <button type="button" className="flex items-center gap-1.5 text-[13px] hover:opacity-80 transition-opacity cursor-pointer">
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim"><path d="M3 8h7M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {stage ? (
                          <span className="inline-flex rounded-md px-2 py-0.5 text-[12px] font-medium" style={{ backgroundColor: stage.color + '22', color: stage.color }}>
                            {stage.name}
                          </span>
                        ) : (
                          <span className="text-text-dim">None</span>
                        )}
                      </button>
                    )
                  }}
                  minWidth={120}
                />
              </OverlayPropRow>

              {/* Assignee */}
              <OverlayPropRow label="Assignee:">
                <Dropdown
                  value={editedTask.role || ''}
                  onChange={(v) => updateTask(editingTask, { role: v || undefined })}
                  options={getAssigneeOptions()}
                  renderOption={(opt, isSelected) => renderAssigneeOption(opt as any, isSelected)}
                  renderTrigger={() => {
                    const d = getAssigneeDisplay(editedTask.role)
                    return (
                      <button type="button" className="flex items-center gap-2 text-[13px] hover:opacity-80 transition-opacity cursor-pointer">
                        {d.member ? (
                          <>
                            <Avatar name={d.member.name} size={18} src={d.member.avatar} color={d.member.color} />
                            <span className="text-text">{d.member.name}</span>
                          </>
                        ) : d.color ? (
                          <>
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                            <span style={{ color: d.color }}>{d.label}</span>
                          </>
                        ) : (
                          <>
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-border text-text-dim shrink-0">
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                            </div>
                            <span className="text-text-dim">Unassigned</span>
                          </>
                        )}
                      </button>
                    )
                  }}
                  minWidth={140}
                />
              </OverlayPropRow>

              {/* Status */}
              <OverlayPropRow label="Status:">
                <Dropdown
                  value={editedTask.status || 'todo'}
                  onChange={(v) => updateTask(editingTask, { status: v })}
                  options={TASK_STATUS_OPTIONS}
                  renderOption={renderStatusOption}
                  renderTrigger={({ selected }) => (
                    <StatusTrigger status={selected?.value || editedTask.status || 'todo'} />
                  )}
                  minWidth={120}
                />
              </OverlayPropRow>

              {/* Priority */}
              <OverlayPropRow label="Priority:">
                <Dropdown
                  value={editedTask.priority || 'medium'}
                  onChange={(v) => updateTask(editingTask, { priority: v })}
                  options={PRIORITY_OPTIONS}
                  renderOption={renderPriorityOption}
                  renderTrigger={({ selected }) => (
                    <button type="button" className="flex items-center gap-1.5 text-[13px] text-text hover:opacity-80 transition-opacity cursor-pointer">
                      <PriorityIcon priority={editedTask.priority || 'medium'} size={14} />
                      <span style={{ color: priorityColor(editedTask.priority || 'medium') }}>{selected?.label || 'Medium'}</span>
                    </button>
                  )}
                  minWidth={120}
                />
              </OverlayPropRow>

              <div className="h-1" />

              {/* Duration */}
              <OverlayPropRow label="Duration:">
                <Dropdown
                  value={editedTask.duration_minutes !== undefined ? String(editedTask.duration_minutes) : ''}
                  onChange={(v) => updateTask(editingTask, { duration_minutes: v !== '' ? Number(v) : undefined })}
                  options={DURATION_OPTIONS}
                  searchable
                  renderTrigger={({ selected }) => (
                    <button type="button" className="flex items-center gap-1.5 text-[13px] text-text hover:opacity-80 transition-opacity cursor-pointer">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim">
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
                        <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span>{formatDurationFull(editedTask.duration_minutes)}</span>
                    </button>
                  )}
                  minWidth={120}
                />
              </OverlayPropRow>

              {/* Min chunk */}
              <div className="flex items-center gap-2 pl-6" style={{ height: 33, marginBottom: 7 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  <path d="M2 2v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Min chunk:</span>
                <Dropdown
                  value={editedTask.min_chunk_minutes ? String(editedTask.min_chunk_minutes) : '0'}
                  onChange={(v) => updateTask(editingTask, { min_chunk_minutes: v ? Number(v) : undefined })}
                  options={CHUNK_OPTIONS}
                  renderTrigger={({ selected }) => (
                    <span className="text-[13px] text-white font-medium hover:text-text-secondary transition-colors cursor-pointer">
                      {selected?.label || 'No Chunks'}
                    </span>
                  )}
                  minWidth={120}
                />
              </div>

              {/* Start offset */}
              <OverlayPropRow label="Start offset:">
                <div className="flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  <span className="text-[13px] text-text-dim">+</span>
                  <input
                    type="number"
                    min={0}
                    value={editedTask.offset_days ?? 0}
                    onChange={e => updateTask(editingTask, { offset_days: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-10 bg-transparent text-[13px] text-text border border-border rounded px-1 py-0.5 outline-none text-center"
                  />
                  <span className="text-[13px] text-text-dim">days</span>
                </div>
              </OverlayPropRow>

              {/* Deadline offset */}
              <OverlayPropRow label="Deadline:">
                <div className="flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="8" cy="10" r="1" fill="currentColor" /></svg>
                  <span className="text-[13px] text-text-dim">+</span>
                  <input
                    type="number"
                    min={0}
                    value={editedTask.deadline_offset_days ?? 0}
                    onChange={e => updateTask(editingTask, { deadline_offset_days: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-10 bg-transparent text-[13px] text-text border border-border rounded px-1 py-0.5 outline-none text-center"
                  />
                  <span className="text-[13px] text-text-dim">days</span>
                </div>
              </OverlayPropRow>

              {/* Hard deadline */}
              <div className="flex items-center gap-2 pl-6" style={{ height: 33, marginBottom: 7 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  <path d="M2 2v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Hard deadline:</span>
                <button
                  onClick={() => updateTask(editingTask, { hard_deadline: !editedTask.hard_deadline })}
                  className={`flex h-4 w-7 items-center rounded-full transition-colors ${
                    editedTask.hard_deadline ? 'bg-accent' : 'bg-border-strong'
                  }`}
                >
                  <div
                    className={`h-3 w-3 rounded-full bg-white transition-transform ${
                      editedTask.hard_deadline ? 'translate-x-[13px]' : 'translate-x-[2px]'
                    }`}
                  />
                </button>
              </div>

              <div className="h-1" />

              {/* Labels */}
              <OverlayPropRow label="Labels:">
                <div className="space-y-1">
                  {editedTask.labels && editedTask.labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {editedTask.labels.map((l, li) => (
                        <span key={li} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px]" style={{ background: '#7a6b5522', color: '#7a6b55' }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: '#7a6b55' }} />
                          {l}
                          <button
                            onClick={() => updateTask(editingTask, { labels: editedTask.labels!.filter((_, i) => i !== li) })}
                            className="hover:brightness-150"
                          >
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <input
                    value=""
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim()
                        if (val) {
                          updateTask(editingTask, { labels: [...(editedTask.labels || []), val] });
                          (e.target as HTMLInputElement).value = ''
                        }
                      }
                    }}
                    placeholder={editedTask.labels && editedTask.labels.length > 0 ? 'Add label' : 'None'}
                    className="text-[12px] text-text-dim hover:text-text bg-transparent border-none outline-none cursor-pointer"
                  />
                </div>
              </OverlayPropRow>

              <div className="h-3" />

              {/* Blocked By */}
              <div className="flex items-center gap-1.5" style={{ height: 28, marginBottom: 2 }}>
                <span className="shrink-0 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Blocked By:</span>
                <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-red-400 shrink-0">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {editedTask.blocked_by_ids && editedTask.blocked_by_ids.length > 0 ? (
                    editedTask.blocked_by_ids.map(bid => {
                      const blocker = tasks.find(t => t.id === bid)
                      return (
                        <span key={bid} className="inline-flex items-center gap-1 px-1.5 py-px rounded-md bg-red-400/10 text-red-400 text-[11px]">
                          {blocker?.title || bid}
                          <button onClick={() => updateTask(editingTask, { blocked_by_ids: editedTask.blocked_by_ids!.filter(id => id !== bid) })} className="hover:text-white ml-0.5">&times;</button>
                        </span>
                      )
                    })
                  ) : (
                    <span className="text-[13px] text-text font-medium">None</span>
                  )}
                </div>
              </div>
              <Dropdown
                options={tasks.filter(t => t.id !== editedTask.id && !(editedTask.blocked_by_ids || []).includes(t.id!)).map(t => {
                  const stg = stages[t.stage_index]
                  return { label: t.title || 'Untitled', value: t.id!, description: stg?.name, color: stg?.color }
                })}
                value=""
                onChange={v => {
                  if (!v) return
                  const current = editedTask.blocked_by_ids || []
                  if (!current.includes(v)) {
                    updateTask(editingTask, { blocked_by_ids: [...current, v] })
                  }
                }}
                placeholder="+ Add blocker"
                searchable
                minWidth={160}
                triggerClassName="text-[11px] text-text-dim hover:text-text"
              />

              {/* Delete */}
              <div className="pt-3">
                <button
                  onClick={() => { removeTask(editingTask); setEditingTask(null) }}
                  className="flex items-center gap-2 text-[13px] text-red-400 hover:text-red-300"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5M4 4l1 9a1 1 0 001 1h4a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Delete task
                </button>
              </div>
            </div>
          </div>
          </div>
          </div>
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 border-t border-border-default"
        style={{ background: 'var(--bg-chrome)' }}
      >
        {/* Left: create project */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={async () => {
              const saved = await handleSave()
              if (saved?.id) onCreateProject?.(saved.id)
              else if (template.id) onCreateProject?.(template.id)
            }}
            className="flex items-center gap-1.5 text-[13px] text-text-secondary bg-transparent border border-border-default rounded-md px-3 py-1.5 cursor-pointer font-inherit transition-all hover:bg-white/[0.06] hover:text-text"
          >
            Create project with template
          </button>
          <span className="text-xs text-text-muted">
            {stages.length} stage{stages.length !== 1 ? 's' : ''} &middot; {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>
        {/* Right: Cancel + Save */}
        <div className="flex items-center gap-2">
          <button
            onClick={tryClose}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-text-dim bg-transparent border border-border-default rounded-md cursor-pointer font-inherit transition-all hover:bg-white/[0.06] hover:text-text"
          >
            Cancel
            <span className="text-[13px] text-text-muted border border-border-default rounded-[3px] px-1 py-px">Esc</span>
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium text-white border-none rounded-md font-inherit transition-all"
            style={{
              background: saving || !name.trim() ? 'rgba(55,202,55,0.3)' : 'var(--accent, #37ca37)',
              cursor: saving || !name.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
            <span className="text-[13px] opacity-50 border border-white/15 rounded-[3px] px-1 py-px">&#8984;S</span>
          </button>
        </div>
      </div>

      {/* ── Description Modal ────────────────────────────────── */}
      {showDescriptionModal && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center" onClick={() => setShowDescriptionModal(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-[600px] max-h-[80vh] rounded-lg border border-border shadow-2xl flex flex-col" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-text">Edit project description</h3>
              <button onClick={() => setShowDescriptionModal(false)} className="p-1 text-text-dim hover:text-text bg-transparent border-none cursor-pointer rounded"><IconX size={16} /></button>
            </div>
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-5 py-2 border-b border-border">
              {[
                { label: 'B', cls: 'font-bold' },
                { label: 'I', cls: 'italic' },
                { label: 'U', cls: 'underline' },
                { label: 'S', cls: 'line-through' },
              ].map(b => (
                <button key={b.label} className={`w-7 h-7 flex items-center justify-center rounded text-[12px] text-text-dim hover:bg-white/[0.06] hover:text-text bg-transparent border-none cursor-pointer ${b.cls}`}>{b.label}</button>
              ))}
              <span className="w-px h-4 bg-border mx-0.5" />
              <button className="w-7 h-7 flex items-center justify-center rounded text-[11px] font-bold text-text-dim hover:bg-white/[0.06] bg-transparent border-none cursor-pointer">H<sub>1</sub></button>
              <button className="w-7 h-7 flex items-center justify-center rounded text-[11px] font-bold text-text-dim hover:bg-white/[0.06] bg-transparent border-none cursor-pointer">H<sub>2</sub></button>
              <span className="w-px h-4 bg-border mx-0.5" />
              <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-white/[0.06] bg-transparent border-none cursor-pointer">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="3" cy="4" r="1.2" fill="currentColor"/><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </button>
              <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-white/[0.06] bg-transparent border-none cursor-pointer">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><text x="1" y="5.5" fontSize="5" fill="currentColor" fontWeight="600">1</text><text x="1" y="9.5" fontSize="5" fill="currentColor" fontWeight="600">2</text><text x="1" y="13.5" fontSize="5" fill="currentColor" fontWeight="600">3</text><path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </button>
              <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-white/[0.06] bg-transparent border-none cursor-pointer">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M6 7h8M6 11h8M2 15h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M2 6l3 2.5L2 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <span className="w-px h-4 bg-border mx-0.5" />
              <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-white/[0.06] bg-transparent border-none cursor-pointer">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 4L1 8l4 4M11 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button className="w-7 h-7 flex items-center justify-center rounded text-text-dim hover:bg-white/[0.06] bg-transparent border-none cursor-pointer">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </button>
            </div>
            {/* Editor */}
            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-[300px]">
              <textarea
                autoFocus
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Add a description..."
                className="w-full h-full min-h-[280px] text-sm text-text bg-transparent border-none outline-none resize-none font-inherit leading-relaxed"
              />
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border">
              <button onClick={() => setShowDescriptionModal(false)} className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] text-text-dim bg-transparent border border-border cursor-pointer font-inherit hover:bg-white/[0.04]">
                Cancel <span className="text-[10px] opacity-40 border border-white/15 rounded-[3px] px-1">Esc</span>
              </button>
              <button onClick={() => setShowDescriptionModal(false)} className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] text-white font-medium border-none cursor-pointer font-inherit" style={{ background: '#3b82f6' }}>
                Save <span className="text-[10px] opacity-60">&#8984;S</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Attachments Modal ────────────────────────────────── */}
      {showAttachmentsModal && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center" onClick={() => setShowAttachmentsModal(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-[480px] rounded-lg border border-border shadow-2xl flex flex-col" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-text">Attachments (0)</h3>
              <button onClick={() => setShowAttachmentsModal(false)} className="p-1 text-text-dim hover:text-text bg-transparent border-none cursor-pointer rounded"><IconX size={16} /></button>
            </div>
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <p className="text-sm font-semibold text-text">No attachments yet</p>
              <button className="flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text bg-transparent border-none cursor-pointer font-inherit">
                <IconPlus size={12} /> Add attachment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Exit Without Saving Confirmation ──────────────── */}
      {showExitConfirm && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[250] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowExitConfirm(false)} />
          <div className="relative rounded-lg border border-border shadow-2xl p-6 flex flex-col gap-4" style={{ background: 'var(--bg-surface)', minWidth: 360 }}>
            <h3 className="text-base font-semibold text-text">Exit without saving?</h3>
            <p className="text-sm text-text-dim">You have unsaved changes. Are you sure you want to exit?</p>
            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 rounded-md text-sm text-text bg-transparent border border-border cursor-pointer hover:bg-hover transition-colors font-inherit"
              >
                Keep editing
              </button>
              <button
                onClick={() => { setShowExitConfirm(false); onClose() }}
                className="px-4 py-2 rounded-md text-sm text-white bg-red-500/80 hover:bg-red-500 border-none cursor-pointer transition-colors font-inherit"
              >
                Exit without saving
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Saved Toast ──────────────────────────────────── */}
      {showSavedToast && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 99999, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600, color: '#fff', background: 'rgba(40,44,46,0.97)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
          Template saved
        </div>,
        document.body
      )}

      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="hover:bg-hover flex items-center gap-1 min-h-[32px] px-1 rounded transition-colors text-sm">
      {label && <span className="text-sm text-text-secondary shrink-0">{label}</span>}
      <div className="flex items-center min-w-0 text-sm">{children}</div>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
      <span className="text-[13px] text-text-secondary shrink-0">{label}</span>
      {children}
    </div>
  )
}

/** Matches PropertyRow from TaskDetailPanel exactly */
function OverlayPropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5" style={{ height: 28, marginBottom: 2 }}>
      <span className="shrink-0 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="min-w-0 text-[13px] flex items-center" style={{ color: '#ffffff' }}>{children}</div>
    </div>
  )
}

function ToggleSwitch({ checked, onChange, small }: { checked: boolean; onChange: (v: boolean) => void; small?: boolean }) {
  const w = small ? 28 : 36
  const h = small ? 16 : 20
  const knob = small ? 12 : 16
  const onLeft = small ? 14 : 18
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className="relative border-none cursor-pointer p-0 shrink-0 transition-colors"
      style={{
        width: w,
        height: h,
        borderRadius: h / 2,
        background: checked ? 'var(--purple)' : 'rgba(255,255,255,0.1)',
      }}
    >
      <div
        className="absolute top-0.5 rounded-full bg-white transition-[left]"
        style={{
          left: checked ? onLeft : 2,
          width: knob,
          height: knob,
        }}
      />
    </button>
  )
}
