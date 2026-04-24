'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { StagePill } from '@/components/ui/StagePill'
import type { Workspace, Project, Stage, Task, Doc, ProjectTemplate, TemplateRole, TemplateVariable, TemplateTaskDef, TemplateStage } from '@/lib/types'
import { TemplateEditor } from '@/components/project/TemplateEditor'
import { ProjectDetailPopup } from '@/components/project/ProjectDetailPopup'
import { Dropdown } from '@/components/ui/Dropdown'
import { IconX, IconArrowRight, IconCheck } from '@/components/ui/Icons'
import { validateStageCapacity, formatCapacityWarning } from '@/lib/capacity-validation'
import type { ScheduleBlock } from '@/lib/scheduler'

const DAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const dow = result.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return result
}

function businessDaysBetween(a: Date, b: Date): number {
  let count = 0
  const d = new Date(a)
  while (d < b) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

/** Arrow icon matching stage headers in TemplateEditor */
function StageArrowIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <div
      className="rounded-md flex items-center justify-center shrink-0"
      style={{ width: size + 8, height: size + 8, background: color + '25' }}
    >
      <IconArrowRight size={size} style={{ color }} />
    </div>
  )
}

type StepId = 'choose' | 'configure' | 'stages' | 'custom_fields' | 'roles' | 'variables'

interface Template {
  id: number
  name: string
  description: string | null
  stages: string
  default_tasks: string
  roles?: string
  text_variables?: string
  workspace_id: number | null
  is_builtin: number
}

interface Folder {
  id: number
  name: string
  parent_id: number | null
}

interface Assignee {
  id: string
  name: string
  role: string
  type: 'human' | 'agent'
}

/** Calendar with stage color highlights + quick date options (matches Motion screenshots) */
function WizardCalendar({ value, onChange, onClose, stages, enabledStages, quickOptions, anchorRef }: {
  value: Date
  onChange: (d: Date) => void
  onClose: () => void
  stages: { stage: TemplateStage; index: number; startDate: Date; deadline: Date; businessDays: number }[]
  enabledStages: Set<number>
  quickOptions: { label: string; date: Date }[]
  anchorRef?: React.RefObject<HTMLElement | null>
}) {
  const [viewMonth, setViewMonth] = useState(value.getMonth())
  const [viewYear, setViewYear] = useState(value.getFullYear())
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)

  // Position relative to anchor (portal mode)
  const updatePos = useCallback(() => {
    if (!anchorRef?.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const calW = 500
    const calH = 420
    const spaceBelow = window.innerHeight - r.bottom
    const top = spaceBelow > calH + 8 ? r.bottom + 4 : r.top - calH - 4
    const left = Math.min(r.left, window.innerWidth - calW - 16)
    setPos({ top: Math.max(8, top), left: Math.max(8, left) })
  }, [anchorRef])

  useEffect(() => {
    if (anchorRef) {
      updatePos()
      window.addEventListener('scroll', updatePos, true)
      window.addEventListener('resize', updatePos)
      return () => { window.removeEventListener('scroll', updatePos, true); window.removeEventListener('resize', updatePos) }
    }
  }, [anchorRef, updatePos])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (anchorRef?.current?.contains(e.target as Node)) return
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, anchorRef])

  const today = new Date()
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()

  const cells: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = []
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i
    const m = viewMonth === 0 ? 11 : viewMonth - 1
    const y = viewMonth === 0 ? viewYear - 1 : viewYear
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true })
  }
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1
    const y = viewMonth === 11 ? viewYear + 1 : viewYear
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false })
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
    else setViewMonth(viewMonth - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
    else setViewMonth(viewMonth + 1)
  }

  const isSelected = (c: typeof cells[0]) => c.day === value.getDate() && c.month === value.getMonth() && c.year === value.getFullYear()
  const isToday = (c: typeof cells[0]) => c.day === today.getDate() && c.month === today.getMonth() && c.year === today.getFullYear()

  // Get stage color for a given date cell
  function getStageColor(c: typeof cells[0]): string | null {
    const d = new Date(c.year, c.month, c.day)
    for (const sd of stages) {
      if (!enabledStages.has(sd.index)) continue
      if (d >= sd.startDate && d <= sd.deadline) {
        return sd.stage.color
      }
    }
    return null
  }

  // Get stage arrow indicator (small dot below date if it's a stage boundary)
  function getStageBoundary(c: typeof cells[0]): { color: string; isDeadline: boolean } | null {
    const d = new Date(c.year, c.month, c.day)
    const dStr = d.toDateString()
    for (const sd of stages) {
      if (!enabledStages.has(sd.index)) continue
      if (sd.deadline.toDateString() === dStr) return { color: sd.stage.color, isDeadline: true }
      if (sd.startDate.toDateString() === dStr) return { color: sd.stage.color, isDeadline: false }
    }
    return null
  }

  const calEl = (
    <div ref={ref} className={`${anchorRef ? 'fixed' : 'absolute left-0 top-full mt-1'} z-[9999] flex rounded-lg border border-border-strong overflow-hidden`}
      style={anchorRef ? { top: pos.top, left: pos.left, background: 'var(--dropdown-bg)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } : { background: 'var(--dropdown-bg)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
      {/* Calendar side */}
      <div className="w-[300px]">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <span className="text-[13px] text-text font-medium">{fmtDate(value)}</span>
        </div>

        <div className="flex items-center justify-between px-4 py-2">
          <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-text-dim">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 2.5l-4 3.5 4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="text-[14px] text-text font-semibold">{MONTHS[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-text-dim">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <div className="grid grid-cols-7 px-3">
          {DAYS_SHORT.map(d => (
            <div key={d} className="text-center text-[11px] text-text-dim font-medium py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 px-3 pb-3">
          {cells.map((c, i) => {
            const sel = isSelected(c)
            const tod = isToday(c)
            const stageColor = getStageColor(c)
            const boundary = getStageBoundary(c)
            return (
              <button
                key={i}
                onClick={() => onChange(new Date(c.year, c.month, c.day))}
                className={`h-9 w-full flex items-center justify-center text-[13px] relative transition-colors ${
                  sel ? 'text-white font-bold' :
                  c.isCurrentMonth ? 'text-text hover:bg-hover' : 'text-text-dim/40 hover:bg-hover'
                }`}
                style={{
                  background: sel ? 'var(--accent)' : stageColor ? stageColor + '25' : undefined,
                  borderRadius: sel ? 6 : 0,
                }}
              >
                {c.day}
                {tod && !sel && (
                  <span className="absolute top-0 left-1 text-[7px] text-orange-400 font-bold">TODAY</span>
                )}
                {boundary && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full" style={{ background: boundary.color }} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Quick options side */}
      <div className="w-[200px] border-l border-border py-2">
        {quickOptions.map((opt, i) => (
          <button
            key={i}
            onClick={() => onChange(opt.date)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-[13px] text-text hover:bg-hover transition-colors"
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-text-dim">{fmtDate(opt.date)}</span>
          </button>
        ))}
      </div>
    </div>
  )

  if (anchorRef && typeof document !== 'undefined') {
    return createPortal(calEl, document.body)
  }
  return calEl
}

function parseJSON<T>(json: string | undefined | null, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) } catch { return fallback }
}

export function CreateProjectModal({
  workspaces,
  activeWorkspaceId,
  onClose,
}: {
  workspaces: Workspace[]
  activeWorkspaceId: number
  onClose: () => void
}) {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  // Scratch project popup state
  const [scratchProject, setScratchProject] = useState<Project | null>(null)
  const [scratchStages, setScratchStages] = useState<Stage[]>([])
  const [scratchWorkspace, setScratchWorkspace] = useState<Workspace | null>(null)

  // Form state
  const [step, setStep] = useState<StepId>('choose')
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
  const [projectName, setProjectName] = useState('')
  const [selectedWsId, setSelectedWsId] = useState(activeWorkspaceId)
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  const [templateFilterWsId, setTemplateFilterWsId] = useState<number | 'all'>(activeWorkspaceId)

  // Active projects per template (for card display)
  const [activeProjectsByTemplate, setActiveProjectsByTemplate] = useState<Record<number, { id: number; name: string }[]>>({})
  const [hoveredActiveProjects, setHoveredActiveProjects] = useState<number | null>(null)

  // AI generation modal state
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [aiWsId, setAiWsId] = useState(activeWorkspaceId)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiFiles, setAiFiles] = useState<{ name: string; mimeType: string; data: string }[]>([])
  const aiTextareaRef = useRef<HTMLTextAreaElement>(null)
  const aiFileInputRef = useRef<HTMLInputElement>(null)

  // New step data
  const [startDate, setStartDate] = useState<Date>(new Date())
  const [deadline, setDeadline] = useState<Date | null>(null)
  const [roleAssignments, setRoleAssignments] = useState<Record<string, string>>({})
  const [textVariables, setTextVariables] = useState<Record<string, string>>({})
  // Stage dates: which stages are enabled + their computed deadlines
  const [enabledStages, setEnabledStages] = useState<Set<number>>(new Set())
  // Calendar popup state
  const [calendarOpen, setCalendarOpen] = useState<'start' | 'deadline' | number | null>(null)
  const startDateRef = useRef<HTMLButtonElement>(null)
  const deadlineDateRef = useRef<HTMLButtonElement>(null)
  const stageDeadlineRefs = useRef<Map<number, HTMLButtonElement>>(new Map())
  // Capacity validation
  const [workBlocks, setWorkBlocks] = useState<ScheduleBlock[]>([])
  const [dailyCapPercent, setDailyCapPercent] = useState(85)

  // Custom fields
  const [customFields, setCustomFields] = useState<{ name: string; value: string; applyToAll: boolean }[]>([
    { name: 'Website', value: '', applyToAll: false },
  ])

  // Derived template data
  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  )
  const templateRoles = useMemo<TemplateRole[]>(
    () => selectedTemplate ? parseJSON(selectedTemplate.roles, []) : [],
    [selectedTemplate]
  )
  const templateVariables = useMemo<TemplateVariable[]>(
    () => selectedTemplate ? parseJSON(selectedTemplate.text_variables, []) : [],
    [selectedTemplate]
  )
  const templateTasks = useMemo<TemplateTaskDef[]>(
    () => selectedTemplate ? parseJSON(selectedTemplate.default_tasks, []) : [],
    [selectedTemplate]
  )
  const templateStages = useMemo<TemplateStage[]>(
    () => selectedTemplate ? parseJSON(selectedTemplate.stages, []) : [],
    [selectedTemplate]
  )
  const totalEstimatedMinutes = useMemo(
    () => templateTasks.reduce((sum, t) => sum + (t.duration_minutes ?? 0), 0),
    [templateTasks]
  )

  // Compute stage deadlines based on start date + expected durations
  const stageDeadlines = useMemo(() => {
    if (!startDate || templateStages.length === 0) return []
    let cursor = new Date(startDate)
    return templateStages.map((stage, i) => {
      const durationDays = stage.expected_duration_value || 5
      const unit = stage.expected_duration_unit || 'days'
      const bDays = unit === 'weeks' ? durationDays * 5 : unit === 'months' ? durationDays * 22 : durationDays
      const stageDeadline = addBusinessDays(cursor, bDays)
      const result = { stage, index: i, startDate: new Date(cursor), deadline: stageDeadline, businessDays: bDays }
      cursor = new Date(stageDeadline)
      return result
    })
  }, [startDate, templateStages])

  // Auto-compute project deadline from last stage
  const computedDeadline = useMemo(() => {
    if (stageDeadlines.length === 0) return null
    const lastEnabled = [...stageDeadlines].reverse().find((_, i) => enabledStages.has(stageDeadlines.length - 1 - i))
    return lastEnabled?.deadline || stageDeadlines[stageDeadlines.length - 1].deadline
  }, [stageDeadlines, enabledStages])

  // Capacity warnings per stage
  const stageCapacityWarnings = useMemo(() => {
    if (stageDeadlines.length === 0 || workBlocks.length === 0) return new Map<number, ReturnType<typeof validateStageCapacity>>()
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const warnings = new Map<number, ReturnType<typeof validateStageCapacity>>()
    for (const sd of stageDeadlines) {
      const tasks = templateTasks.filter(t => t.stage_index === sd.index)
      if (tasks.length === 0) continue
      const result = validateStageCapacity(tasks as { duration_minutes: number }[], fmt(sd.startDate), fmt(sd.deadline), workBlocks, dailyCapPercent)
      if (!result.fits) warnings.set(sd.index, result)
    }
    return warnings
  }, [stageDeadlines, templateTasks, workBlocks, dailyCapPercent])

  // Compute visible steps (skip steps that don't apply)
  const visibleSteps = useMemo<StepId[]>(() => {
    const steps: StepId[] = ['choose', 'configure']
    if (selectedTemplateId) {
      steps.push('stages')
      steps.push('custom_fields')
      if (templateRoles.length > 0) steps.push('roles')
      if (templateVariables.length > 0) steps.push('variables')
    }
    return steps
  }, [selectedTemplateId, templateRoles.length, templateVariables.length])

  const currentStepIndex = visibleSteps.indexOf(step)
  const isLastStep = currentStepIndex === visibleSteps.length - 1

  // Fetch templates, folders, assignees
  useEffect(() => {
    Promise.all([
      fetch('/api/templates').then(r => r.json()),
      fetch(`/api/folders?workspaceId=${activeWorkspaceId}`).then(r => r.json()),
      fetch('/api/team?format=assignees').then(r => r.json()).catch(() => []),
      fetch(`/api/projects?template_usage=1&workspaceId=${activeWorkspaceId}`).then(r => r.json()).catch(() => ({ usageByTemplate: {} })),
    ]).then(([t, f, a, p]) => {
      setTemplates(Array.isArray(t) ? t : [])
      setFolders(Array.isArray(f) ? f : [])
      setAssignees(Array.isArray(a) ? a : [])
      setActiveProjectsByTemplate(p?.usageByTemplate || {})
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [activeWorkspaceId])

  // Refetch folders when workspace changes
  useEffect(() => {
    fetch(`/api/folders?workspaceId=${selectedWsId}`).then(r => r.json()).then(f => {
      setFolders(Array.isArray(f) ? f : [])
    }).catch(() => {})
  }, [selectedWsId])

  // Auto-populate client_name from selected folder
  useEffect(() => {
    if (selectedFolderId) {
      const folder = folders.find(f => f.id === selectedFolderId)
      if (folder) {
        setTextVariables(prev => ({ ...prev, client_name: folder.name }))
      }
    }
  }, [selectedFolderId, folders])

  // Fetch work blocks + daily cap for capacity validation
  useEffect(() => {
    fetch('/api/schedules').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : (d.schedules || [])
      if (list.length > 0 && list[0].blocks) {
        try { setWorkBlocks(typeof list[0].blocks === 'string' ? JSON.parse(list[0].blocks) : list[0].blocks) } catch {}
      }
    }).catch(() => {})
    fetch('/api/settings').then(r => r.json()).then(d => {
      if (d.dailyCapPercent != null) setDailyCapPercent(Number(d.dailyCapPercent))
    }).catch(() => {})
  }, [])

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesWs = templateFilterWsId === 'all' || t.workspace_id === templateFilterWsId || t.is_builtin === 1
    return matchesSearch && matchesWs
  })

  function selectTemplate(id: number | null) {
    setSelectedTemplateId(id)
    const tmpl = templates.find(t => t.id === id)
    if (tmpl) setProjectName(tmpl.name)
    else setProjectName('')
    // Reset new step data
    setStartDate(new Date())
    setDeadline(null)
    setRoleAssignments({})
    // Enable all stages by default
    if (tmpl) {
      const stages = parseJSON<TemplateStage[]>(tmpl.stages, [])
      setEnabledStages(new Set(stages.map((_, i) => i)))
    }
    // Pre-fill text variables with defaults
    if (tmpl) {
      const vars = parseJSON<TemplateVariable[]>(tmpl.text_variables, [])
      const defaults: Record<string, string> = {}
      vars.forEach(v => { defaults[v.key] = v.default_value ?? '' })
      setTextVariables(defaults)
    } else {
      setTextVariables({})
    }
    setStep('configure')
  }

  const goNext = useCallback(() => {
    const nextIdx = currentStepIndex + 1
    if (nextIdx < visibleSteps.length) {
      setStep(visibleSteps[nextIdx])
    }
  }, [currentStepIndex, visibleSteps])

  const goBack = useCallback(() => {
    const prevIdx = currentStepIndex - 1
    if (prevIdx >= 0) {
      setStep(visibleSteps[prevIdx])
    }
  }, [currentStepIndex, visibleSteps])

  async function handleCreate() {
    if (!projectName.trim()) return
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        name: projectName.trim(),
        workspaceId: selectedWsId,
      }
      if (selectedTemplateId) body.templateId = selectedTemplateId
      if (selectedFolderId) body.folderId = selectedFolderId
      if (startDate) body.startDate = startDate.toISOString().split('T')[0]
      const dl = deadline || computedDeadline
      if (dl) body.deadline = dl.toISOString().split('T')[0]
      if (Object.keys(roleAssignments).length > 0) body.roleAssignments = roleAssignments
      // Always include project_name + pn in text variables for template substitution
      const allVars = { project_name: projectName.trim(), pn: projectName.trim(), ...textVariables }
      body.textVariables = allVars

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data?.id) {
        onClose()
        window.dispatchEvent(new Event('sidebar-refresh'))
        router.push(`/project/${data.public_id || data.id}`)
      }
    } catch {
      // ignore
    } finally {
      setCreating(false)
    }
  }

  // Stage colors for template preview
  function getStages(tmpl: Template): { name: string; color: string }[] {
    try { return JSON.parse(tmpl.stages) } catch { return [] }
  }

  function getTaskCount(tmpl: Template): number {
    try { return JSON.parse(tmpl.default_tasks).length } catch { return 0 }
  }

  function getTasksPerStage(tmpl: Template): number[] {
    try {
      const tasks = JSON.parse(tmpl.default_tasks)
      const stages = JSON.parse(tmpl.stages)
      return stages.map((_: any, i: number) => tasks.filter((t: any) => t.stage_index === i).length)
    } catch { return [] }
  }

  async function handleAiGenerate() {
    if (!aiDescription.trim() || aiGenerating) return
    setAiGenerating(true)
    setAiError(null)
    try {
      const res = await fetch('/api/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiDescription.trim(), workspaceId: aiWsId, documents: aiFiles.length > 0 ? aiFiles : undefined, preview: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      // Open in template editor as draft (id=0 means unsaved)
      // Will be saved to DB when user clicks Save in the editor
      setShowAiModal(false)
      setAiDescription('')
      setAiFiles([])
      setEditingTemplate(data)
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setAiGenerating(false)
    }
  }

  // Step indicator (only shown for template flows with multiple steps)
  const stepsAfterChoose = visibleSteps.filter(s => s !== 'choose')
  const showStepIndicator = step !== 'choose' && selectedTemplateId != null && stepsAfterChoose.length > 1
  const stepLabels: Record<StepId, string> = {
    choose: 'Template',
    configure: 'Name & workspace',
    stages: 'Stages & dates',
    custom_fields: 'Custom fields',
    roles: 'Roles',
    variables: 'Variables',
  }

  const stepIcons: Record<StepId, React.ReactNode> = {
    choose: null,
    configure: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
    stages: <IconArrowRight size={16} />,
    custom_fields: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
    roles: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.3" /></svg>,
    variables: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M4 3h8M6 13h4M5 3v10M11 3v10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  }

  // The wizard sidebar (only shown for template configuration steps)
  const wizardSteps = visibleSteps.filter(s => s !== 'choose')
  const showWizard = step !== 'choose' && selectedTemplateId != null

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={`relative ${showWizard ? 'w-[1050px]' : 'w-[894px]'} max-w-[calc(100vw-40px)] rounded-xl overflow-hidden flex flex-col`}
        style={{ height: 700, maxHeight: '90vh', background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header - only shown on choose step */}
        {!showWizard && (
          <div className="flex items-center justify-between pl-4 pr-3 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-[18px] font-semibold text-text">Create project</h2>
            <button onClick={onClose} className="w-[30px] h-[30px] flex items-center justify-center rounded-md hover:bg-hover text-text-dim hover:text-text transition-colors">
              <IconX size={14} />
            </button>
          </div>
        )}

        {/* ====== STEP: CHOOSE ====== */}
        {step === 'choose' && (
          <div className="flex-1 overflow-auto p-4">

            {/* Search + Workspace row */}
            <div className="flex items-center gap-2 mb-4" style={{ background: 'var(--bg-chrome)', borderRadius: 6, padding: '6px 8px' }}>
              {/* Search input */}
              <div className="relative flex-1">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search templates"
                  className="w-full pl-7 pr-3 py-[3px] rounded-md text-sm text-text placeholder:text-text-dim/50 outline-none"
                  style={{ background: 'transparent', border: 'none' }}
                />
              </div>

              {/* Workspace dropdown */}
              <Dropdown
                value={templateFilterWsId === 'all' ? 'all' : String(selectedWsId)}
                onChange={(val) => {
                  if (val === 'all') {
                    setTemplateFilterWsId('all')
                  } else {
                    const num = Number(val)
                    setSelectedWsId(num)
                    setTemplateFilterWsId(num)
                    setSelectedFolderId(null)
                  }
                }}
                options={[
                  { value: 'all', label: 'All workspaces' },
                  ...workspaces.map(ws => ({ value: String(ws.id), label: ws.name })),
                ]}
                minWidth={160}
              />
            </div>

            {/* Action cards row */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {/* AI Template card */}
              <div
                className="p-3 rounded-md flex flex-col gap-1.5"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderLeft: '3px solid #9333ea',
                }}
              >
                <div className="flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: '#c084fc' }}>
                    <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                  <span className="text-sm font-semibold" style={{ color: '#c084fc' }}>Create Project Template with AI</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                  Create a template for all projects with similar workflows.
                </p>
                <div className="mt-auto pt-1.5">
                  <button
                    onClick={() => setShowAiModal(true)}
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-white transition-opacity hover:opacity-90"
                    style={{ background: '#9333ea' }}
                  >
                    Create Project Template with AI
                  </button>
                </div>
              </div>

              {/* Scratch card */}
              <div
                className="p-3 rounded-md flex flex-col gap-1.5"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Create Project from Scratch</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-dim)' }}>
                  Create a project manually from scratch.
                </p>
                <div className="mt-auto pt-1.5">
                  <button
                    onClick={() => {
                      const ws = workspaces.find(w => w.id === activeWorkspaceId) || null
                      setScratchProject({
                        id: 0,
                        workspace_id: activeWorkspaceId,
                        folder_id: null,
                        name: 'Untitled Project',
                        description: '',
                        status: 'open',
                        color: '#ef5350',
                        assignee: null,
                        priority: null,
                        labels: null,
                        start_date: null,
                        deadline: null,
                        created_at: Math.floor(Date.now() / 1000),
                        updated_at: Math.floor(Date.now() / 1000),
                      } as Project)
                      setScratchStages([
                        { id: -1, project_id: 0, name: 'Todo', color: '#42a5f5', is_active: 1, sort_order: 0, created_at: 0 } as Stage,
                        { id: -2, project_id: 0, name: 'In Progress', color: '#ffd740', is_active: 0, sort_order: 1, created_at: 0 } as Stage,
                        { id: -3, project_id: 0, name: 'Done', color: '#00e676', is_active: 0, sort_order: 2, created_at: 0 } as Stage,
                      ])
                      setScratchWorkspace(ws)
                    }}
                    className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors hover:border-border-strong"
                    style={{
                      background: 'var(--bg-hover)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    {creating ? 'Creating...' : 'Create project from scratch'}
                  </button>
                </div>
              </div>
            </div>

            {/* Create from Template section */}
            {loading ? (
              <div className="text-center py-8 text-text-dim text-sm">Loading templates...</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[15px] font-semibold text-text flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-text-muted">
                      <path fill="currentColor" d="M9 3.15a1.35 1.35 0 0 1 2.7 0v.45a.9.9 0 0 0 .9.9h2.7a.9.9 0 0 1 .9.9v2.7a.9.9 0 0 1-.9.9h-.45a1.35 1.35 0 1 0 0 2.7h.45a.9.9 0 0 1 .9.9v2.7a.9.9 0 0 1-.9.9h-2.7a.9.9 0 0 1-.9-.9v-.45a1.35 1.35 0 1 0-2.7 0v.45a.9.9 0 0 1-.9.9H5.4a.9.9 0 0 1-.9-.9v-2.7a.9.9 0 0 0-.9-.9h-.45a1.35 1.35 0 1 1 0-2.7h.45a.9.9 0 0 0 .9-.9V5.4a.9.9 0 0 1 .9-.9h2.7a.9.9 0 0 0 .9-.9v-.45Z"/>
                    </svg>
                    Create from Template
                  </h3>
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/templates', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: 'New Template',
                          description: '',
                          stages: JSON.stringify([
                            { name: 'Todo', color: '#4285f4', sort_order: 0 },
                            { name: 'In Progress', color: '#ffd740', sort_order: 1 },
                            { name: 'Done', color: 'var(--accent)', sort_order: 2 },
                          ]),
                          default_tasks: '[]',
                        }),
                      })
                      const newTmpl = await res.json()
                      setTemplates(prev => [...prev, newTmpl])
                      setEditingTemplate(newTmpl)
                    }}
                    className="text-[13px] text-text-dim hover:text-text transition-colors flex items-center gap-1.5"
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    New project template
                  </button>
                </div>

                {filteredTemplates.length === 0 ? (
                  <div className="text-center py-8 text-text-dim text-sm">No templates found</div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {filteredTemplates.map(tmpl => {
                      const stages = getStages(tmpl)
                      const tasksPerStage = getTasksPerStage(tmpl)
                      const ws = workspaces.find(w => w.id === tmpl.workspace_id)
                      const activeProjects = activeProjectsByTemplate[tmpl.id] || []
                      const templateColor = (() => {
                        try { const r = JSON.parse(tmpl.roles || '[]'); return r[0]?.color } catch { return null }
                      })()
                      return (
                        <div
                          key={tmpl.id}
                          className="group rounded-lg text-left transition-all hover:border-text-dim/30 cursor-pointer flex flex-col overflow-hidden"
                          style={{ background: 'transparent', border: '1px solid var(--border)', width: 270, minHeight: 275, flex: '0 0 270px' }}
                          onClick={() => selectTemplate(tmpl.id)}
                        >
                          {/* Header: puzzle icon + workspace + edit */}
                          <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1">
                            <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: templateColor ? templateColor + '20' : '#ffffff12' }}>
                              <svg width="14" height="14" viewBox="0 0 18 18" fill="none" style={{ color: templateColor || '#6b7280' }}>
                                <path fill="currentColor" d="M9 3.15a1.35 1.35 0 0 1 2.7 0v.45a.9.9 0 0 0 .9.9h2.7a.9.9 0 0 1 .9.9v2.7a.9.9 0 0 1-.9.9h-.45a1.35 1.35 0 1 0 0 2.7h.45a.9.9 0 0 1 .9.9v2.7a.9.9 0 0 1-.9.9h-2.7a.9.9 0 0 1-.9-.9v-.45a1.35 1.35 0 1 0-2.7 0v.45a.9.9 0 0 1-.9.9H5.4a.9.9 0 0 1-.9-.9v-2.7a.9.9 0 0 0-.9-.9h-.45a1.35 1.35 0 1 1 0-2.7h.45a.9.9 0 0 0 .9-.9V5.4a.9.9 0 0 1 .9-.9h2.7a.9.9 0 0 0 .9-.9v-.45Z"/>
                              </svg>
                            </div>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: ws?.color || '#6b7280' }}>
                              <path fill="currentColor" d="M7.486 2.118 3.43 4.165c-.228.115-.342.173-.379.25a.25.25 0 0 0 0 .214c.037.078.15.136.379.25l4.056 2.048c.184.092.275.138.371.157a.7.7 0 0 0 .258 0c.097-.017.189-.062.373-.153l4.142-2.05c.232-.115.349-.173.386-.251a.25.25 0 0 0 0-.215c-.037-.078-.154-.136-.386-.251l-4.142-2.05c-.184-.09-.276-.136-.373-.154a.7.7 0 0 0-.258.001c-.096.019-.187.065-.37.157Z" opacity=".2"/>
                              <path fill="currentColor" d="M13.948 10.875a.666.666 0 0 1 .607 1.183L8.54 15.14l-.006.003c-.053.027-.193.103-.351.133a1.002 1.002 0 0 1-.368 0c-.158-.03-.299-.106-.352-.133l-6.172-3.08a.665.665 0 0 1 .594-1.19l6.112 3.05 5.95-3.047ZM1 7.692a.667.667 0 0 1 .898-.282L8 10.588l5.954-2.972a.665.665 0 0 1 .594 1.19l-6.013 3.002c-.053.027-.193.103-.351.133a1.004 1.004 0 0 1-.368 0c-.159-.03-.299-.106-.352-.133l-.01-.005L1.28 8.588A.666.666 0 0 1 1 7.692Z"/>
                            </svg>
                            <span className="truncate flex-1" style={{ fontSize: 11, color: 'white' }}>{ws?.name || 'No workspace'}</span>
                            <button
                              onClick={e => { e.stopPropagation(); setEditingTemplate(tmpl) }}
                              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:text-white hover:bg-hover transition-all shrink-0"
                              style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}
                            >
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
                              Edit
                            </button>
                            <button
                              onClick={async e => {
                                e.stopPropagation()
                                e.preventDefault()
                                const id = tmpl.id
                                setTemplates(prev => prev.filter(t => t.id !== id))
                                const res = await fetch('/api/templates', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), credentials: 'include' })
                                if (!res.ok) console.error('[Template Delete] Failed:', res.status, await res.text())
                              }}
                              className="opacity-0 group-hover:opacity-100 flex items-center p-1.5 rounded-md hover:text-red-400 hover:bg-hover transition-all shrink-0"
                              style={{ color: 'rgba(255,255,255,0.4)' }}
                            >
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3h4v1M5 4v8.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          </div>

                          {/* Template name */}
                          <div className="font-bold text-white px-3.5 mt-1" style={{ fontSize: 17 }}>{tmpl.name}</div>

                          {/* Description - single line truncated */}
                          <div className="text-white px-3.5 mt-1 truncate" style={{ fontSize: 11 }}>
                            {tmpl.description || 'No Description provided'}
                          </div>

                          {/* Active projects */}
                          <div className="px-3.5 mt-2 mb-2 relative">
                            <div
                              className="inline-flex items-center gap-1.5 text-white cursor-default"
                              style={{ fontSize: 12 }}
                              onMouseEnter={() => setHoveredActiveProjects(tmpl.id)}
                              onMouseLeave={() => setHoveredActiveProjects(null)}
                              onClick={e => e.stopPropagation()}
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
                                <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                                <path d="M8 1V8M8 8L14 4.5M8 8L2 4.5M8 8V15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.5" />
                              </svg>
                              {activeProjects.length} Active project{activeProjects.length !== 1 ? 's' : ''}
                            </div>
                            {hoveredActiveProjects === tmpl.id && activeProjects.length > 0 && (
                              <div
                                className="absolute left-0 top-full mt-1 z-50 rounded-lg border border-border shadow-xl py-2 px-3"
                                style={{ background: 'var(--border)', minWidth: 200 }}
                              >
                                <div className="text-xs text-text-dim mb-1.5">Template used in {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}</div>
                                {activeProjects.map(p => (
                                  <div key={p.id} className="flex items-center gap-1.5 py-1 text-sm text-text">
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0">
                                      <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                                      <path d="M8 1V8M8 8L14 4.5M8 8L2 4.5M8 8V15" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.5" />
                                    </svg>
                                    {p.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Stages stacked - max 3 visible, 4th fades */}
                          <div className="flex flex-col gap-0.5 px-3.5 pb-3 mt-auto overflow-hidden relative" style={{ background: 'var(--bg-chrome)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                            {stages.slice(0, 4).map((s, i) => (
                              <div key={i} className="flex items-center gap-2 py-0.5" style={i === 3 ? { opacity: 0.3, maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)' } : undefined}>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                                  <circle cx="8" cy="8" r="6" fill={s.color} />
                                  <path d="M6 5l4 3-4 3" fill="white" />
                                </svg>
                                <span
                                  className="font-semibold px-2 py-0.5 rounded-full truncate"
                                  style={{ fontSize: 11, background: s.color + '22', color: s.color, maxWidth: 180 }}
                                >
                                  {s.name}
                                </span>
                                <span className="ml-auto flex items-center gap-1 text-text-dim shrink-0" style={{ fontSize: 11 }}>
                                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                                    <rect x="1" y="1" width="12" height="12" rx="2" />
                                    <path d="M4 7l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  {tasksPerStage[i] || 0}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Wizard layout: sidebar + content */}
        {showWizard && (
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar nav */}
            <div className="w-[260px] shrink-0 border-r border-border flex flex-col" style={{ background: '#1e2022' }}>
              <div className="px-5 pt-5 pb-4">
                <h3 className="text-[15px] font-semibold text-text">Set up your project</h3>
              </div>
              <nav className="flex flex-col gap-0.5 px-3">
                {wizardSteps.map(s => {
                  const isCurrent = s === step
                  return (
                    <button
                      key={s}
                      onClick={() => setStep(s)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors text-left relative ${
                        isCurrent ? 'text-white bg-white/[0.06]' : 'text-[#b0b3b8] hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      {isCurrent && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-accent" />}
                      <span className={isCurrent ? 'text-white' : 'text-[#b0b3b8]'}>{stepIcons[s]}</span>
                      {stepLabels[s]}
                    </button>
                  )
                })}
              </nav>
              {/* Template name at bottom */}
              <div className="mt-auto px-4 py-3 flex items-center gap-2 text-[13px] text-text-dim truncate">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.3" className="shrink-0">
                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" strokeLinejoin="round" />
                </svg>
                <span className="truncate">{selectedTemplate?.name || 'Template'} ...</span>
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto p-8">

        {/* ====== STEP: CONFIGURE (Name & workspace) ====== */}
        {step === 'configure' && (
          <>
            <span className="text-[13px] text-text-dim mb-2 block">Name</span>
            <input
              autoFocus
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="My new project"
              className="w-full px-3 py-2 rounded-md text-[13px] text-text placeholder:text-text-dim/40 outline-none border border-border focus:border-[#5b6abf] transition-colors"
              style={{ background: '#1e2022' }}
              onKeyDown={e => {
                if (e.key === 'Enter' && projectName.trim()) goNext()
                if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); goNext() }
              }}
            />
            <div className="mt-4 text-[13px] text-text-dim flex items-center gap-1 flex-wrap">
              <span>Using</span>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.3" className="shrink-0">
                <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" strokeLinejoin="round" />
              </svg>
              <span className="text-text font-medium">{selectedTemplate?.name}</span>
              <span>in</span>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0 text-text-dim"><path d="M2 4c0-1.1.9-2 2-2h3l2 2h3c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V4z" stroke="currentColor" strokeWidth="1.3" /></svg>
              <span className="text-text font-medium">{workspaces.find(w => w.id === selectedWsId)?.name || 'Workspace'}</span>
            </div>
          </>
        )}

        {/* ====== STEP: STAGES & DATES ====== */}
        {step === 'stages' && (
          <>
            <h3 className="text-[20px] font-semibold text-text mb-1">Stages & dates</h3>
            <p className="text-[13px] text-text-dim mb-7">Select which stages you want to add or remove to your project.</p>

            {/* Start date + Deadline row */}
            <div className="flex items-end gap-3 mb-8">
              <div className="flex-1">
                <span className="text-[13px] text-text-dim mb-2 block">Start date</span>
                <div className="relative">
                  <button
                    ref={startDateRef}
                    onClick={() => setCalendarOpen(calendarOpen === 'start' ? null : 'start')}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-text hover:brightness-110 transition-colors text-left whitespace-nowrap"
                    style={{ background: '#1e2022', border: '1px solid var(--border)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    {startDate ? fmtDate(startDate) : 'Today'}
                  </button>
                  {calendarOpen === 'start' && (
                    <WizardCalendar
                      anchorRef={startDateRef}
                      value={startDate}
                      onChange={d => { setStartDate(d); setCalendarOpen(null) }}
                      onClose={() => setCalendarOpen(null)}
                      stages={stageDeadlines}
                      enabledStages={enabledStages}
                      quickOptions={[
                        { label: 'Today', date: new Date() },
                        { label: 'Tomorrow', date: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d })() },
                        { label: 'Next week', date: (() => { const d = new Date(); d.setDate(d.getDate() + (8 - d.getDay())); return d })() },
                        { label: 'Next month', date: (() => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return d })() },
                        { label: 'In 2 weeks', date: (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d })() },
                      ]}
                    />
                  )}
                </div>
              </div>
              <span className="text-text-dim pb-3.5">-</span>
              <div className="flex-1">
                <span className="text-[13px] text-text-dim mb-2 block">Deadline</span>
                <div className="relative">
                  <button
                    ref={deadlineDateRef}
                    onClick={() => setCalendarOpen(calendarOpen === 'deadline' ? null : 'deadline')}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-text hover:brightness-110 transition-colors text-left whitespace-nowrap"
                    style={{ background: '#1e2022', border: '1px solid var(--border)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    {(deadline || computedDeadline) ? fmtDate(deadline || computedDeadline!) : 'Auto'}
                  </button>
                  {calendarOpen === 'deadline' && (
                    <WizardCalendar
                      anchorRef={deadlineDateRef}
                      value={deadline || computedDeadline || new Date()}
                      onChange={d => { setDeadline(d); setCalendarOpen(null) }}
                      onClose={() => setCalendarOpen(null)}
                      stages={stageDeadlines}
                      enabledStages={enabledStages}
                      quickOptions={[
                        { label: 'Today', date: new Date() },
                        { label: 'Tomorrow', date: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d })() },
                        { label: 'This week', date: (() => { const d = new Date(); d.setDate(d.getDate() + (5 - d.getDay())); return d })() },
                        { label: '7 days from now', date: (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d })() },
                        { label: 'This month', date: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0) })() },
                        { label: 'Next week', date: (() => { const d = new Date(); d.setDate(d.getDate() + (12 - d.getDay())); return d })() },
                        { label: 'In 2 weeks', date: (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d })() },
                        { label: 'Next month', date: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 2, 0) })() },
                      ]}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Stage deadlines */}
            <h4 className="text-[18px] font-semibold text-text mb-5">Stage deadlines</h4>
            <div className="flex flex-col gap-4">
              {stageDeadlines.map(sd => {
                const enabled = enabledStages.has(sd.index)
                const capResult = stageCapacityWarnings.get(sd.index)
                const capWarning = capResult ? formatCapacityWarning(capResult.availableMinutes, capResult.totalTaskMinutes, 'stage') : null
                return (
                  <div key={sd.index}>
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    {/* Checkbox */}
                    <button
                      onClick={() => {
                        const next = new Set(enabledStages)
                        if (next.has(sd.index)) next.delete(sd.index)
                        else next.add(sd.index)
                        setEnabledStages(next)
                      }}
                      className="w-[22px] h-[22px] rounded-[5px] flex items-center justify-center shrink-0 border-2 transition-colors"
                      style={{
                        background: enabled ? sd.stage.color : 'transparent',
                        borderColor: enabled ? sd.stage.color : 'var(--border)',
                      }}
                    >
                      {enabled && <IconCheck size={13} style={{ color: '#fff' }} />}
                    </button>

                    {/* Stage arrow + name pill */}
                    <StagePill name={sd.stage.name} color={sd.stage.color} size="sm" />

                    {/* Duration text */}
                    <span className="text-[14px] text-text-dim">{sd.businessDays} business days</span>

                    {/* Spacer to push date right */}
                    <span className="flex-1" />

                    {/* Deadline date pill - clickable */}
                    <div className="relative shrink-0">
                      <button
                        ref={el => { if (el) stageDeadlineRefs.current.set(sd.index, el) }}
                        onClick={() => setCalendarOpen(calendarOpen === sd.index ? null : sd.index)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] text-text hover:brightness-110 transition-colors cursor-pointer border-none"
                        style={{ background: '#1e2022', border: '1px solid var(--border)' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        {fmtDate(sd.deadline)}
                      </button>
                      {calendarOpen === sd.index && (
                        <WizardCalendar
                          anchorRef={{ current: stageDeadlineRefs.current.get(sd.index) || null }}
                          value={sd.deadline}
                          onChange={d => {
                            // Recalculate this stage's business days from its start to the new deadline
                            // For now just update the project deadline if this is the last stage
                            setCalendarOpen(null)
                          }}
                          onClose={() => setCalendarOpen(null)}
                          stages={stageDeadlines}
                          enabledStages={enabledStages}
                          quickOptions={[
                            { label: 'Today', date: new Date() },
                            { label: 'Project start', date: startDate },
                            { label: 'Tomorrow', date: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d })() },
                            { label: 'This week', date: (() => { const d = new Date(); d.setDate(d.getDate() + (5 - d.getDay())); return d })() },
                            { label: '7 days from now', date: (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d })() },
                            { label: 'Next week', date: (() => { const d = new Date(); d.setDate(d.getDate() + (12 - d.getDay())); return d })() },
                            { label: 'In 2 weeks', date: (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d })() },
                            ...(computedDeadline ? [{ label: 'Project deadline', date: computedDeadline }] : []),
                          ]}
                        />
                      )}
                    </div>
                  </div>
                  {capWarning && (
                    <div className="mt-1 px-2 py-1 rounded text-[10px] flex flex-col gap-0.5" style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', color: '#eab308' }}>
                      <span className="font-medium">{capWarning.message}</span>
                      <span style={{ color: '#ca8a04' }}>{capWarning.suggestion}</span>
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          </>
        )}

        {/* ====== STEP: CUSTOM FIELDS ====== */}
        {step === 'custom_fields' && (
          <>
            <h3 className="text-[18px] font-semibold text-text mb-6">Custom fields</h3>
            <div className="flex flex-col gap-3">
              {customFields.map((cf, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className="text-[14px] text-text w-[80px]">{cf.name}:</span>
                  <span className="text-[14px] text-text-dim">{cf.value || 'None'}</span>
                  <label className="flex items-center gap-2 ml-auto text-[13px] text-text-dim cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cf.applyToAll}
                      onChange={e => {
                        const next = [...customFields]
                        next[i] = { ...next[i], applyToAll: e.target.checked }
                        setCustomFields(next)
                      }}
                      className="accent-accent"
                    />
                    Apply to all tasks
                  </label>
                </div>
              ))}
              <button
                onClick={() => setCustomFields([...customFields, { name: 'New field', value: '', applyToAll: false }])}
                className="flex items-center gap-1.5 text-[13px] text-text-dim hover:text-text transition-colors mt-2"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                Add custom field
              </button>
            </div>
          </>
        )}

        {/* ====== STEP: ROLES ====== */}
        {step === 'roles' && (
          <>
            <div className="mb-6">
              <h3 className="text-[18px] font-semibold text-text mb-1">Assign roles</h3>
              <p className="text-[13px] text-text-dim">
                This template defines {templateRoles.length} role{templateRoles.length !== 1 ? 's' : ''}. Assign a team member to each.
              </p>
            </div>

            <div className="space-y-4">
              {templateRoles.map(role => (
                <div key={role.name} className="p-3 rounded-md" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <div className="mb-2">
                    <span className="text-[14px] font-semibold text-text">{role.name}</span>
                    {role.description && (
                      <span className="text-[13px] text-text-dim ml-2">{role.description}</span>
                    )}
                  </div>
                  <Dropdown
                    value={roleAssignments[role.name] ?? ''}
                    onChange={(val) => setRoleAssignments(prev => ({ ...prev, [role.name]: val }))}
                    options={[
                      { value: '', label: 'Unassigned' },
                      ...assignees.map(a => ({ value: a.id, label: `${a.name} (${a.role})` })),
                    ]}
                    placeholder="Unassigned"
                    minWidth={200}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* ====== STEP: VARIABLES ====== */}
        {step === 'variables' && (
          <>
            <div className="mb-6">
              <h3 className="text-[18px] font-semibold text-text mb-1">Fill in variables</h3>
              <p className="text-[13px] text-text-dim">
                These values will be substituted into task names and descriptions.
              </p>
            </div>

            <div className="space-y-4">
              {templateVariables.map(v => (
                <label key={v.key} className="block">
                  <span className="text-[14px] font-semibold text-text mb-1 block">{v.label}</span>
                  <input
                    value={textVariables[v.key] ?? ''}
                    onChange={e => setTextVariables(prev => ({ ...prev, [v.key]: e.target.value }))}
                    placeholder={v.default_value || v.label}
                    className="w-full px-3 py-2.5 rounded-md text-sm text-text placeholder:text-text-dim/50 outline-none focus:ring-1 focus:ring-accent/40"
                    style={inputStyle}
                  />
                  <span className="text-[12px] text-text-dim/60 mt-1 block">
                    Used as <code className="px-1 py-0.5 rounded text-[11px]" style={{ background: 'var(--bg-hover)' }}>{`{{${v.key}}}`}</code> in task names
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

              </div>

              {/* ====== WIZARD FOOTER ====== */}
              <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <div>
                  {currentStepIndex >= 1 && (
                    <button
                      onClick={currentStepIndex === 1 ? () => { setStep('choose'); setSelectedTemplateId(null); setProjectName('') } : goBack}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] text-text-dim hover:text-text hover:bg-hover transition-colors"
                    >
                      Back
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => { setStep('choose') }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] text-text-dim hover:text-text hover:bg-hover transition-colors">
                    Cancel
                    <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)' }}>Esc</span>
                  </button>
                  <button
                    onClick={isLastStep ? handleCreate : goNext}
                    disabled={(step === 'configure' && !projectName.trim()) || creating}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold text-white bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLastStep ? (creating ? 'Creating...' : 'Continue') : 'Continue'}
                    {!creating && (
                      <span className="flex items-center gap-0.5 text-[11px] opacity-70">
                        <span>⌘</span><span>S</span>
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI Template Generation Modal */}
      {showAiModal && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center"
          onClick={() => { if (!aiGenerating) setShowAiModal(false) }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-[640px] rounded-xl overflow-hidden flex flex-col"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-0">
              <h2 className="text-[18px] font-semibold text-text flex items-center gap-2">
                <span className="text-[18px]">✨</span>
                Create Project Template with AI
                <span className="text-[12px] font-normal text-text-dim">(beta)</span>
              </h2>
              <button
                onClick={() => { if (!aiGenerating) setShowAiModal(false) }}
                className="p-1.5 rounded-md hover:bg-hover text-text-dim hover:text-text transition-colors"
              >
                <IconX />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 pt-5 pb-6 flex flex-col gap-5">
              {/* Workspace selector */}
              <div>
                <label className="text-[14px] font-medium text-text block mb-2">
                  Which workspace do you want to create the project workflow in?
                </label>
                <Dropdown
                  value={String(aiWsId)}
                  onChange={(val) => setAiWsId(Number(val))}
                  options={workspaces.map(ws => ({ value: String(ws.id), label: ws.name }))}
                  placeholder="Select workspace"
                  minWidth={240}
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[14px] font-semibold text-text block mb-2">Describe your project</label>
                <textarea
                  ref={aiTextareaRef}
                  value={aiDescription}
                  onChange={e => setAiDescription(e.target.value)}
                  placeholder="This project is for our web design agency to design a website for a client."
                  className="w-full px-4 py-3 rounded-lg text-[14px] text-text placeholder:text-text-dim/40 outline-none resize-none leading-relaxed"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', minHeight: 120 }}
                  onKeyDown={e => {
                    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleAiGenerate()
                    }
                  }}
                  autoFocus
                />
              </div>

              {/* Upload section */}
              <div>
                <label className="text-[14px] font-semibold text-text block mb-1.5">Upload up to 10 documents that are relevant</label>
                <p className="text-[13px] text-text-dim leading-relaxed mb-3">
                  Relevant documents can include PDFs, spreadsheets (.csv, .xlsx), text documents (.docx, .txt), or images (.jpeg, .png) that describe your Standard Operating Procedures. Or documents with sample projects or workflows you currently have in your organization.
                </p>
                <input
                  ref={aiFileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.csv,.xlsx,.xls,.docx,.txt,.jpeg,.jpg,.png"
                  className="hidden"
                  onChange={async e => {
                    const files = Array.from(e.target.files || []).slice(0, 10 - aiFiles.length)
                    for (const file of files) {
                      try {
                        const base64 = await new Promise<string>((resolve, reject) => {
                          const reader = new FileReader()
                          reader.onload = () => {
                            const result = reader.result as string
                            resolve(result.split(',')[1] || '') // strip data:...;base64, prefix
                          }
                          reader.onerror = reject
                          reader.readAsDataURL(file)
                        })
                        setAiFiles(prev => [...prev, { name: file.name, mimeType: file.type || 'application/octet-stream', data: base64 }].slice(0, 10))
                      } catch { /* skip unreadable files */ }
                    }
                    e.target.value = ''
                  }}
                />
                {/* Uploaded files list */}
                {aiFiles.length > 0 && (
                  <div className="flex flex-col gap-1.5 mb-3">
                    {aiFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] text-text" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" /><path d="M5 5h4M5 7.5h4M5 10h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                        <span className="flex-1 truncate">{f.name}</span>
                        <button onClick={() => setAiFiles(prev => prev.filter((_, j) => j !== i))} className="text-text-dim hover:text-red-400 transition-colors shrink-0">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
                {aiFiles.length < 10 && (
                  <button
                    onClick={() => aiFileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] text-text-dim hover:text-text transition-colors"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 10v2h10v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Upload {aiFiles.length > 0 ? `(${aiFiles.length}/10)` : ''}
                  </button>
                )}
              </div>

              {/* Error */}
              {aiError && (
                <div className="px-3 py-2 rounded-lg text-[13px] text-red-400 flex items-center justify-between" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <span>{aiError.includes('API key') ? 'Add your API key in Settings to use AI generation' : aiError}</span>
                  {aiError.includes('API key') && (
                    <a href="/settings" className="text-[12px] font-medium text-white px-2.5 py-1 rounded-md ml-2 shrink-0 no-underline" style={{ background: 'rgba(255,255,255,0.15)' }}>
                      Go to Settings
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-6 py-4 border-t"
              style={{ borderColor: 'var(--border)' }}
            >
              <button
                onClick={() => {
                  setShowAiModal(false)
                  // Trigger scratch creation
                  const ws = workspaces.find(w => w.id === activeWorkspaceId) || null
                  setScratchProject({
                    id: 0,
                    workspace_id: activeWorkspaceId,
                    folder_id: null,
                    name: 'Untitled Project',
                    description: '',
                    status: 'open',
                    color: '#ef5350',
                    assignee: null,
                    priority: null,
                    labels: null,
                    start_date: null,
                    deadline: null,
                    created_at: Math.floor(Date.now() / 1000),
                    updated_at: Math.floor(Date.now() / 1000),
                  } as Project)
                  setScratchStages([
                    { id: -1, project_id: 0, name: 'Todo', color: '#42a5f5', is_active: 1, sort_order: 0, created_at: 0 } as Stage,
                    { id: -2, project_id: 0, name: 'In Progress', color: '#ffd740', is_active: 0, sort_order: 1, created_at: 0 } as Stage,
                    { id: -3, project_id: 0, name: 'Done', color: '#00e676', is_active: 0, sort_order: 2, created_at: 0 } as Stage,
                  ])
                  setScratchWorkspace(ws)
                }}
                className="px-4 py-2 rounded-lg text-[13px] text-text hover:bg-hover transition-colors font-medium"
                style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
              >
                Create from scratch
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { if (!aiGenerating) setShowAiModal(false) }}
                  className="px-4 py-2 rounded-lg text-[13px] text-text-dim hover:text-text transition-colors flex items-center gap-2"
                >
                  Cancel
                  <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)' }}>Esc</span>
                </button>
                <button
                  onClick={handleAiGenerate}
                  disabled={!aiDescription.trim() || aiGenerating}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  style={{
                    background: aiDescription.trim() && !aiGenerating
                      ? 'linear-gradient(135deg, #c084fc 0%, #e879f9 50%, #c084fc 100%)'
                      : 'rgba(180,100,255,0.3)',
                    boxShadow: aiDescription.trim() && !aiGenerating ? '0 2px 12px rgba(180,100,255,0.3)' : 'none',
                  }}
                >
                  <span>✨</span>
                  {aiGenerating ? 'Generating...' : 'Generate & Preview'}
                  {!aiGenerating && (
                    <span className="flex items-center gap-0.5 text-[11px] opacity-70 ml-1">
                      <span>⌘</span><span>S</span>
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Editor overlay */}
      {editingTemplate && (
        <div onClick={e => e.stopPropagation()} className="fixed inset-0 z-[210]">
        <TemplateEditor
          template={editingTemplate}
          workspaceId={selectedWsId}
          onSave={(updated) => {
            setTemplates(prev => {
              const exists = prev.some(t => t.id === updated.id)
              return exists ? prev.map(t => t.id === updated.id ? updated : t) : [...prev, updated]
            })
            setEditingTemplate(updated)
          }}
          onClose={() => setEditingTemplate(null)}
          onCreateProject={(templateId) => {
            setEditingTemplate(null)
            selectTemplate(templateId)
          }}
        />
        </div>
      )}

      {/* From-Scratch Project Detail Popup (draft mode) */}
      {scratchProject && (
        <div onClick={e => e.stopPropagation()} className="fixed inset-0 z-[210]">
        <ProjectDetailPopup
          project={scratchProject}
          stages={scratchStages}
          tasks={[]}
          workspace={scratchWorkspace}
          docs={[]}
          folder={null}
          mode="create"
          workspaces={workspaces}
          onClose={() => setScratchProject(null)}
          onProjectUpdate={(p) => setScratchProject(p)}
          onCreate={async (data) => {
            setCreating(true)
            try {
              const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: data.name, workspaceId: data.workspaceId }),
              })
              const created = await res.json()
              if (created?.id) {
                // Update the project with all the extra fields from the draft
                const patchFields: Record<string, unknown> = { id: created.id }
                if (data.description) patchFields.description = data.description
                if (data.assignee) patchFields.assignee = data.assignee
                if (data.status !== 'open') patchFields.status = data.status
                if (data.priority) patchFields.priority = data.priority
                if (data.color !== '#ef5350') patchFields.color = data.color
                if (data.labels) patchFields.labels = data.labels
                if (data.start_date) patchFields.start_date = data.start_date
                if (data.deadline) patchFields.deadline = data.deadline
                if (Object.keys(patchFields).length > 1) {
                  await fetch('/api/projects', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patchFields),
                  })
                }
                window.dispatchEvent(new Event('sidebar-refresh'))
                onClose()
                router.push(`/project/${created.public_id || created.id}`)
              }
            } catch {} finally { setCreating(false) }
          }}
        />
        </div>
      )}
    </div>
  )
}
