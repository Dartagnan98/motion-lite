'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { LabelChip, safeParseLabels, LABEL_COLORS } from '@/components/ui/LabelChip'
import { StagePill } from '@/components/ui/StagePill'
import { AutoScheduleToggle } from '@/components/ui/AutoScheduleToggle'
import { useSearchParams } from 'next/navigation'
import type { Workspace, Project, Stage, Folder, Doc } from '@/lib/types'
import type { EnrichedTask, View, Label } from '@/lib/db'
import { TaskDetailPanel } from './TaskDetailPanel'
import { useActiveWorkspace } from '@/lib/use-active-workspace'
import { apiFetch } from '@/lib/api-client'
import { ProjectDetailPopup } from '@/components/project/ProjectDetailPopup'
import { CreateProjectModal } from '@/components/sidebar/CreateProjectModal'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { showUndoToast } from '@/components/ui/UndoToast'
import { StatusIcon, statusConfig } from '@/components/ui/StatusIcon'
import { Dropdown } from '@/components/ui/Dropdown'
import { Popover } from '@/components/ui/Popover'
import DatePicker from '@/components/ui/DatePicker'
import { CalendarDropdown } from '@/components/ui/DateTimePickers'
import { renderStatusOption } from '@/components/ui/StatusIcon'
import { STATUS_OPTIONS as TASK_STATUS_OPTIONS, DURATION_OPTIONS, PRIORITY_ORDER, STATUS_ORDER } from '@/lib/task-constants'
import { useTeamMembers } from '@/lib/use-team-members'
import { Avatar } from '@/components/ui/Avatar'
import { PriorityIcon, PRIORITY_CONFIG, PRIORITY_OPTIONS as SHARED_PRIORITY, renderPriorityOption, priorityColor } from '@/components/ui/PriorityIcon'
import { findAssignee } from '@/lib/assignee-utils'
import { IconX, IconPlus, IconCheck, IconMoreHorizontal } from '@/components/ui/Icons'

type GroupLevel = 'workspace' | 'project' | 'stage' | 'assignee' | 'status' | 'priority' | 'folder' | 'label' | 'due_date' | 'start_date' | 'created_at' | 'updated_at' | 'completed_at'
type SortField = 'sort_order' | 'title' | 'priority' | 'due_date' | 'start_date' | 'created_at' | 'status' | 'assignee' | 'project' | 'workspace' | 'duration' | 'updated_at'

interface ViewConfig {
  groupBy: GroupLevel[]
  sortBy: SortField
  sortDir: 'asc' | 'desc'
  filters: { search: string; status: string; priority: string; assignee: string; project: string; workspace: string }
  hideEmptyGroups: boolean
  columnOrder?: string[]
  showResolvedTasks?: boolean
  showPastDeadlineOnly?: boolean
  workspaceScope?: 'all' | number
}

const DEFAULT_CONFIG: ViewConfig = {
  groupBy: ['workspace', 'project', 'stage'],
  sortBy: 'sort_order',
  sortDir: 'asc',
  filters: { search: '', status: '', priority: '', assignee: '', project: '', workspace: '' },
  hideEmptyGroups: false,
  showResolvedTasks: false,
  showPastDeadlineOnly: false,
}

const VIEW_TYPE_ICONS: Record<string, React.ReactNode> = {
  list: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  kanban: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="8" y="2" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg>,
  gantt: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 4h6M3 8h8M3 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  dashboard: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="2" y="9" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg>,
  workload: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="10" width="3" height="4" rx="0.5" fill="currentColor" fillOpacity="0.4" /><rect x="6.5" y="6" width="3" height="8" rx="0.5" fill="currentColor" fillOpacity="0.6" /><rect x="11" y="3" width="3" height="11" rx="0.5" fill="currentColor" fillOpacity="0.8" /></svg>,
}

const GROUP_LEVEL_LABELS: Record<GroupLevel, string> = {
  workspace: 'Workspace', project: 'Project', stage: 'Stage',
  assignee: 'Assignee', status: 'Status', priority: 'Priority',
  folder: 'Folder', label: 'Label', due_date: 'Deadline',
  start_date: 'Start date', created_at: 'Created at',
  updated_at: 'Updated at', completed_at: 'Completed at',
}

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'sort_order', label: 'Manual' },
  { value: 'title', label: 'Name' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Deadline' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'created_at', label: 'Created' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'project', label: 'Project' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'duration', label: 'Duration' },
  { value: 'updated_at', label: 'Updated' },
]

const priorityConfig = PRIORITY_CONFIG

// assigneeColors + ASSIGNEES removed -- now uses useTeamMembers() hook

const COLS = [
  { key: 'status', label: 'Status', w: 'w-[115px]' },
  { key: 'priority', label: 'Priority', w: 'w-[110px]' },
  { key: 'assignee', label: 'Assignee', w: 'w-[175px]' },
  { key: 'project', label: 'Project', w: 'w-[150px]' },
  { key: 'stage', label: 'Stage', w: 'w-[120px]' },
  { key: 'due_date', label: 'Deadline', w: 'w-[120px]' },
  { key: 'start_date', label: 'Start Date', w: 'w-[130px]' },
  { key: 'created_at', label: 'Created At', w: 'w-[130px]' },
  { key: 'duration', label: 'Duration', w: 'w-[100px]' },
  { key: 'completed_time', label: 'Completed Time', w: 'w-[140px]' },
  { key: 'completed_at', label: 'Completed At', w: 'w-[135px]' },
  { key: 'workspace', label: 'Workspace', w: 'w-[130px]' },
  { key: 'folder', label: 'Folder', w: 'w-[175px]' },
  { key: 'labels', label: 'Labels', w: 'w-[150px]' },
  { key: 'blocked_by', label: 'Blocked By', w: 'w-[120px]' },
  { key: 'blocking', label: 'Blocking', w: 'w-[100px]' },
  { key: 'schedule', label: 'Schedule', w: 'w-[100px]' },
  { key: 'hard_deadline', label: 'Hard Deadline', w: 'w-[135px]' },
  { key: 'updated_at', label: 'Updated At', w: 'w-[130px]' },
]

// Chevron SVG
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
      className={`shrink-0 transition-transform text-text-dim ${expanded ? 'rotate-90' : ''}`}>
      <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ProjectsTasksView({
  tasks: initialTasks,
  workspaces: initialWorkspaces,
  projects: initialProjects,
  stages: initialStages,
  folders,
  views: initialViews,
  labels: initialLabels,
}: {
  tasks: EnrichedTask[]
  workspaces: Workspace[]
  projects: Project[]
  stages: Stage[]
  folders: Folder[]
  views: View[]
  labels: Label[]
}) {
  const { workspaceId: activeWsId } = useActiveWorkspace()
  const teamMembers = useTeamMembers()
  const ASSIGNEES = useMemo(() => teamMembers.map(m => m.id), [teamMembers])
  const assigneeColors = useMemo(() => Object.fromEntries(teamMembers.map(m => [m.id, m.color])), [teamMembers])
  const [allTasks, setAllTasks] = useState(initialTasks)
  const [projects, setProjects] = useState(initialProjects)
  const [stages, setStages] = useState(initialStages)
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refreshTasks = useCallback(() => {
    setIsRefreshing(true)
    Promise.all([
      apiFetch('/api/tasks?all=1').then(r => r.json()),
      apiFetch('/api/projects?all=1').then(r => r.json()),
      apiFetch('/api/stages').then(r => r.json()),
      apiFetch('/api/workspaces').then(r => r.json()),
    ]).then(([tasksData, projData, stagesData, wsData]) => {
      if (Array.isArray(tasksData.tasks)) setAllTasks(tasksData.tasks)
      if (Array.isArray(projData)) setProjects(projData)
      else if (Array.isArray(projData.projects)) setProjects(projData.projects)
      if (Array.isArray(stagesData)) setStages(stagesData)
      else if (Array.isArray(stagesData.stages)) setStages(stagesData.stages)
      if (Array.isArray(wsData)) setWorkspaces(wsData)
      else if (Array.isArray(wsData.workspaces)) setWorkspaces(wsData.workspaces)
    }).catch(() => {}).finally(() => setIsRefreshing(false))
  }, [])
  const searchParams = useSearchParams()
  const urlViewId = searchParams.get('view') ? Number(searchParams.get('view')) : null

  const [views, setViews] = useState(initialViews)
  const [allLabels, setAllLabels] = useState(initialLabels)
  const [activeViewId, setActiveViewId] = useState<number | null>(() => {
    if (urlViewId && initialViews.some(v => v.id === urlViewId)) return urlViewId
    return initialViews[0]?.id ?? null
  })
  const [viewConfig, setViewConfig] = useState<ViewConfig>(() => {
    const targetView = urlViewId ? initialViews.find(v => v.id === urlViewId) : initialViews[0]
    if (targetView?.config) {
      try { return { ...DEFAULT_CONFIG, ...JSON.parse(targetView.config) } } catch { /* */ }
    }
    return DEFAULT_CONFIG
  })

  // Refresh task list when projects/tasks change (e.g. after creating a project from template)
  // Clean up stale popover portals on mount
  useEffect(() => {
    document.querySelectorAll('body > .animate-glass-in').forEach(el => el.remove())
  }, [])

  useEffect(() => {
    const handler = () => refreshTasks()
    window.addEventListener('sidebar-refresh', handler)
    window.addEventListener('undo-restore', handler)
    return () => { window.removeEventListener('sidebar-refresh', handler); window.removeEventListener('undo-restore', handler) }
  }, [refreshTasks])

  // React to URL view param changes
  useEffect(() => {
    if (urlViewId && urlViewId !== activeViewId && views.some(v => v.id === urlViewId)) {
      setActiveViewId(urlViewId)
      const v = views.find(vw => vw.id === urlViewId)
      if (v?.config) {
        try { setViewConfig({ ...DEFAULT_CONFIG, ...JSON.parse(v.config) }) } catch { /* */ }
      } else {
        setViewConfig(DEFAULT_CONFIG)
      }
    }
  }, [urlViewId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Workspace-scoped tasks (must be after viewConfig is declared)
  const tasks = useMemo(() => {
    const wsScope = viewConfig.workspaceScope
    if (wsScope && wsScope !== 'all' && typeof wsScope === 'number') {
      return allTasks.filter(t => t.workspace_id === wsScope || !t.workspace_id)
    }
    if (!activeWsId) return allTasks
    return allTasks.filter(t => t.workspace_id === activeWsId || !t.workspace_id)
  }, [allTasks, activeWsId, viewConfig.workspaceScope])

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set())
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', assignee: '', project: '', labels: [] as string[] })
  const [bulkField, setBulkField] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ taskId: number; field: string } | null>(null)
  const [addingTaskKeys, setAddingTaskKeys] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showNewViewModal, setShowNewViewModal] = useState(false)
  const [showGroupByPanel, setShowGroupByPanel] = useState(false)
  const [taskContextMenu, setTaskContextMenu] = useState<{ x: number; y: number; task: EnrichedTask } | null>(null)
  const [showSortPanel, setShowSortPanel] = useState(false)
  const [showViewManager, setShowViewManager] = useState(false)
  const [showSortGroupsPanel, setShowSortGroupsPanel] = useState(false)
  const [showColumnConfig, setShowColumnConfig] = useState(false)
  const [renamingViewId, setRenamingViewId] = useState<number | null>(null)
  const [dragColKey, setDragColKey] = useState<string | null>(null)
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null)
  const [projectPopup, setProjectPopup] = useState<{ project: Project; docs: Doc[] } | null>(null)
  const [showResolvedTasks, setShowResolvedTasks] = useState(false)
  const [showPastDeadlineOnly, setShowPastDeadlineOnly] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [navigateView, setNavigateView] = useState(false)
  const [viewTabOverflow, setViewTabOverflow] = useState(100)
  const [moreViewsOpen, setMoreViewsOpen] = useState(false)
  const viewTabsContainerRef = useRef<HTMLDivElement>(null)
  const viewTabsMeasureRef = useRef<HTMLDivElement>(null)

  async function openProjectPopup(projectId: number) {
    const proj = projects.find(p => p.id === projectId)
    if (!proj) return
    try {
      const res = await fetch(`/api/docs?projectId=${projectId}`)
      const docs = await res.json()
      setProjectPopup({ project: proj, docs: Array.isArray(docs) ? docs : [] })
    } catch {
      setProjectPopup({ project: proj, docs: [] })
    }
  }

  // Switch active view
  const switchView = useCallback((viewId: number) => {
    setActiveViewId(viewId)
    const v = views.find(vw => vw.id === viewId)
    if (v?.config) {
      try {
        const parsed = { ...DEFAULT_CONFIG, ...JSON.parse(v.config) }
        setViewConfig(parsed)
        setShowResolvedTasks(parsed.showResolvedTasks ?? false)
        setShowPastDeadlineOnly(parsed.showPastDeadlineOnly ?? false)
      } catch { /* */ }
    } else {
      setViewConfig(DEFAULT_CONFIG)
      setShowResolvedTasks(false)
      setShowPastDeadlineOnly(false)
    }
  }, [views])

  // Persist view config changes
  const updateViewConfig = useCallback(async (patch: Partial<ViewConfig>) => {
    const next = { ...viewConfig, ...patch }
    setViewConfig(next)
    if (activeViewId) {
      await fetch('/api/views', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeViewId, config: next }),
      })
    }
  }, [viewConfig, activeViewId])

  // Create new view
  const createNewView = useCallback(async (name: string, viewType: string) => {
    const res = await fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, view_type: viewType, config: DEFAULT_CONFIG }),
    })
    const newView = await res.json()
    setViews(prev => [...prev, newView])
    switchView(newView.id)
    setShowNewViewModal(false)
  }, [switchView])

  // Delete view
  const deleteView = useCallback(async (viewId: number) => {
    await fetch('/api/views', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: viewId }),
    })
    setViews(prev => prev.filter(v => v.id !== viewId))
    if (activeViewId === viewId) {
      const remaining = views.filter(v => v.id !== viewId)
      if (remaining.length) switchView(remaining[0].id)
      else setActiveViewId(null)
    }
  }, [activeViewId, views, switchView])

  // Rename view
  const renameView = useCallback(async (viewId: number, name: string) => {
    setViews(prev => prev.map(v => v.id === viewId ? { ...v, name } : v))
    setRenamingViewId(null)
    await fetch('/api/views', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: viewId, name }),
    })
  }, [])

  // Measure view tabs overflow for "X more" dropdown
  useEffect(() => {
    const container = viewTabsContainerRef.current
    const measure = viewTabsMeasureRef.current
    if (!container || !measure) return

    const recalc = () => {
      const containerWidth = container.offsetWidth
      const tabs = measure.querySelectorAll<HTMLElement>('[data-mtab]')
      if (!tabs.length) { setViewTabOverflow(100); return }

      const moreButtonWidth = 90
      let sum = 0
      let cutoff = tabs.length

      for (let i = 0; i < tabs.length; i++) {
        sum += tabs[i].offsetWidth + 4
        const remaining = tabs.length - i - 1
        if (remaining > 0 && sum + moreButtonWidth > containerWidth) {
          cutoff = i
          break
        }
        if (remaining === 0 && sum > containerWidth) {
          cutoff = i
          break
        }
      }

      setViewTabOverflow(cutoff)
    }

    requestAnimationFrame(recalc)
    const ro = new ResizeObserver(() => requestAnimationFrame(recalc))
    ro.observe(container)
    return () => ro.disconnect()
  }, [views])

  const visibleViews = views.slice(0, Math.min(viewTabOverflow, views.length))
  const overflowViews = views.slice(Math.min(viewTabOverflow, views.length))

  function toggleCollapse(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const updateTask = useCallback(async (id: number, field: string, value: unknown) => {
    setAllTasks(prev => prev.map(t => {
      if (t.id !== id) return t
      const updated = { ...t, [field]: value }
      if (field === 'project_id') {
        const proj = projects.find(p => p.id === value)
        updated.project_name = proj?.name || null
        updated.project_color = proj?.color || null
        // Auto-inherit folder from project
        if (proj?.folder_id) {
          updated.folder_id = proj.folder_id
          const f = folders.find(fo => fo.id === proj.folder_id)
          updated.folder_name = f?.name || null
        }
      }
      if (field === 'stage_id') {
        const s = stages.find(st => st.id === value)
        updated.stage_name = s?.name || null
        updated.stage_color = s?.color || null
      }
      if (field === 'folder_id') {
        const f = folders.find(fo => fo.id === value)
        updated.folder_name = f?.name || null
      }
      if (field === 'status' && value === 'done') updated.completed_at = Math.floor(Date.now() / 1000)
      if (field === 'status' && value !== 'done') updated.completed_at = null
      return updated
    }))

    const body: Record<string, unknown> = { id, [field]: value }
    if (field === 'project_id') {
      const proj = projects.find(p => p.id === value)
      if (proj?.folder_id) body.folder_id = proj.folder_id
    }
    if (field === 'status' && value === 'done') body.completed_at = Math.floor(Date.now() / 1000)
    if (field === 'status' && value !== 'done') body.completed_at = null

    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }, [projects, stages, folders])

  const filteredTasks = useMemo(() => {
    let result = tasks
    // Hide archived tasks by default unless the status filter is explicitly set to 'archived'
    if (filters.status !== 'archived') {
      result = result.filter(t => t.status !== 'archived')
    }
    // Hide resolved (done/cancelled) unless toggle is on
    if (!showResolvedTasks && filters.status !== 'done' && filters.status !== 'cancelled') {
      result = result.filter(t => t.status !== 'done' && t.status !== 'cancelled')
    }
    if (filters.search) {
      const q = filters.search.toLowerCase()
      result = result.filter(t => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
    }
    if (filters.status) result = result.filter(t => t.status === filters.status)
    if (filters.priority) result = result.filter(t => t.priority === filters.priority)
    if (filters.assignee) result = result.filter(t => t.assignee === filters.assignee)
    if (filters.project) result = result.filter(t => String(t.project_id) === filters.project)
    if (filters.labels.length > 0) {
      result = result.filter(t => {
        const taskLabels: string[] = safeParseLabels(t.labels)
        return filters.labels.some(fl => taskLabels.includes(fl))
      })
    }
    // Only show scheduled tasks past their deadline
    if (showPastDeadlineOnly) {
      const now = new Date()
      result = result.filter(t => t.due_date && parseDate(t.due_date) < now && t.status !== 'done' && t.status !== 'cancelled')
    }
    return result
  }, [tasks, filters, showResolvedTasks, showPastDeadlineOnly])

  type Row =
    | { type: 'group'; level: GroupLevel; id: string | number | null; name: string; color: string; count: number; key: string; depth: number; groupTasks?: EnrichedTask[] }
    | { type: 'task'; task: EnrichedTask; idx: number; parentKey: string }
    | { type: 'addtask'; projId: number | null; stageId: number | null; wsId: number; parentKey: string; groupTasks: EnrichedTask[] }

  // Sort tasks within groups
  const sortedFilteredTasks = useMemo(() => {
    const sorted = [...filteredTasks]
    const { sortBy, sortDir } = viewConfig
    if (sortBy === 'sort_order') return sorted

    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'title': cmp = a.title.localeCompare(b.title); break
        case 'priority': cmp = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9); break
        case 'due_date': {
          const ad = a.due_date ? parseDate(a.due_date).getTime() : Infinity
          const bd = b.due_date ? parseDate(b.due_date).getTime() : Infinity
          cmp = ad - bd; break
        }
        case 'start_date': {
          const asd = a.start_date ? new Date(a.start_date).getTime() : Infinity
          const bsd = b.start_date ? new Date(b.start_date).getTime() : Infinity
          cmp = asd - bsd; break
        }
        case 'created_at': cmp = a.created_at - b.created_at; break
        case 'status': cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9); break
        case 'assignee': cmp = (a.assignee || 'zzz').localeCompare(b.assignee || 'zzz'); break
        case 'project': cmp = (a.project_name || 'zzz').localeCompare(b.project_name || 'zzz'); break
        case 'workspace': cmp = (a.workspace_id || 0) - (b.workspace_id || 0); break
        case 'duration': cmp = (a.duration_minutes || 0) - (b.duration_minutes || 0); break
        case 'updated_at': cmp = (a.updated_at || 0) - (b.updated_at || 0); break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [filteredTasks, viewConfig])

  // Get group key/name/color for a task at a given group level
  const getGroupInfo = useCallback((task: EnrichedTask, level: GroupLevel): { id: string | number | null; name: string; color: string } => {
    function dateBucket(dateStr: string | null, tsVal?: number | null): { id: string; name: string } {
      const ts = dateStr ? parseDate(dateStr).getTime() : tsVal ? tsVal * 1000 : 0
      if (!ts) return { id: 'none', name: 'No date' }
      const d = new Date(ts)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { id: key, name: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
    }

    switch (level) {
      case 'workspace': {
        const ws = workspaces.find(w => w.id === task.workspace_id)
        return { id: task.workspace_id || 0, name: ws?.name || 'No Workspace', color: ws?.color || '#6b7280' }
      }
      case 'project':
        return { id: task.project_id, name: task.project_name || 'No Project', color: task.project_color || '#6b7280' }
      case 'stage':
        return { id: task.stage_id, name: task.stage_name || 'No Stage', color: task.stage_color || '#6b7280' }
      case 'assignee':
        return { id: task.assignee || 'unassigned', name: task.assignee ? (task.assignee === 'operator' ? 'Operator' : task.assignee.charAt(0).toUpperCase() + task.assignee.slice(1)) : 'Unassigned', color: assigneeColors[task.assignee || ''] || '#6b7280' }
      case 'status': {
        const sc = statusConfig[task.status] || statusConfig.todo
        return { id: task.status, name: sc.label, color: sc.color }
      }
      case 'priority': {
        const pc = priorityConfig[task.priority] || priorityConfig.medium
        return { id: task.priority, name: pc.label, color: pc.color }
      }
      case 'folder':
        return { id: task.folder_id || 'none', name: task.folder_name || 'No Folder', color: '#6b7280' }
      case 'label': {
        const labels: string[] = safeParseLabels(task.labels)
        const first = labels[0] || 'No Label'
        return { id: first, name: first, color: '#7a6b55' }
      }
      case 'due_date': {
        const b = dateBucket(task.due_date)
        return { ...b, color: '#ef5350' }
      }
      case 'start_date': {
        const b = dateBucket(task.start_date)
        return { ...b, color: '#42a5f5' }
      }
      case 'created_at': {
        const b = dateBucket(null, task.created_at)
        return { ...b, color: '#6b7280' }
      }
      case 'updated_at': {
        const b = dateBucket(null, task.updated_at)
        return { ...b, color: '#6b7280' }
      }
      case 'completed_at': {
        const b = dateBucket(null, task.completed_at)
        return { ...b, color: '#00e676' }
      }
    }
  }, [workspaces])

  const rows = useMemo(() => {
    const result: Row[] = []
    const groupLevels = viewConfig.groupBy

    function buildGroups(tasks: EnrichedTask[], depth: number, parentKey: string, ctx: { wsId?: number; projId?: number | null; stageId?: number | null } = {}) {
      if (depth >= groupLevels.length) {
        // Leaf level: emit tasks
        tasks.forEach((t, idx) => {
          result.push({ type: 'task', task: t, idx: idx + 1, parentKey })
        })
        // Add task row - derive project/stage/workspace from first task or context
        const first = tasks[0]
        result.push({
          type: 'addtask',
          projId: first?.project_id ?? ctx.projId ?? null,
          stageId: first?.stage_id ?? ctx.stageId ?? null,
          wsId: first?.workspace_id || ctx.wsId || workspaces[0]?.id || 0,
          parentKey,
          groupTasks: tasks,
        })
        return
      }

      const level = groupLevels[depth]
      const groupMap = new Map<string, { info: { id: string | number | null; name: string; color: string }; tasks: EnrichedTask[] }>()

      // Pre-seed groups for projects/workspaces/stages so empty ones still appear
      if (level === 'project' && !viewConfig.hideEmptyGroups) {
        // Add "No Project" group first
        groupMap.set('none', { info: { id: null, name: 'No Project', color: '#6b7280' }, tasks: [] })
        // Filter by workspace when nested inside a workspace group
        const scopedProjects = ctx.wsId ? projects.filter(p => p.workspace_id === ctx.wsId) : projects
        for (const p of scopedProjects) {
          groupMap.set(String(p.id), { info: { id: p.id, name: p.name, color: p.color }, tasks: [] })
        }
      }
      if (level === 'workspace' && !viewConfig.hideEmptyGroups) {
        for (const w of workspaces) {
          groupMap.set(String(w.id), { info: { id: w.id, name: w.name, color: w.color || '#6b7280' }, tasks: [] })
        }
      }
      if (level === 'stage' && !viewConfig.hideEmptyGroups) {
        // Seed stages for this project (but NOT "No Stage" - only show it if tasks actually have no stage)
        if (ctx.projId) {
          const projectStages = stages.filter(s => s.project_id === ctx.projId)
          for (const s of projectStages) {
            groupMap.set(String(s.id), { info: { id: s.id, name: s.name, color: s.color }, tasks: [] })
          }
        }
      }

      for (const t of tasks) {
        const info = getGroupInfo(t, level)
        const gKey = String(info.id ?? 'none')
        if (!groupMap.has(gKey)) groupMap.set(gKey, { info, tasks: [] })
        groupMap.get(gKey)!.tasks.push(t)
      }

      // If no groups at all (e.g. project with no stages and no tasks), emit addtask directly
      if (groupMap.size === 0 && tasks.length === 0) {
        result.push({
          type: 'addtask',
          projId: ctx.projId ?? null,
          stageId: ctx.stageId ?? null,
          wsId: ctx.wsId || workspaces[0]?.id || 0,
          parentKey,
          groupTasks: [],
        })
        return
      }

      for (const [gId, group] of groupMap) {
        // Hide empty "No Stage" groups
        if (level === 'stage' && gId === 'none' && group.tasks.length === 0) continue
        const key = `${level}-${parentKey}-${gId}`
        // Collect all tasks recursively under this group (for select-all checkbox)
        const collectAllTasks = (tasks: EnrichedTask[]): EnrichedTask[] => tasks
        result.push({
          type: 'group',
          level,
          id: group.info.id,
          name: group.info.name,
          color: group.info.color,
          count: group.tasks.length,
          key,
          depth,
          groupTasks: collectAllTasks(group.tasks),
        })

        if (!collapsed.has(key)) {
          const nextCtx = { ...ctx }
          if (level === 'workspace') nextCtx.wsId = typeof group.info.id === 'number' ? group.info.id : ctx.wsId
          if (level === 'project') nextCtx.projId = typeof group.info.id === 'number' ? group.info.id : null
          if (level === 'stage') nextCtx.stageId = typeof group.info.id === 'number' ? group.info.id : null
          buildGroups(group.tasks, depth + 1, key, nextCtx)
        }
      }
    }

    if (groupLevels.length === 0) {
      // No grouping - flat list
      sortedFilteredTasks.forEach((t, idx) => {
        result.push({ type: 'task', task: t, idx: idx + 1, parentKey: 'root' })
      })
      result.push({ type: 'addtask', projId: null, stageId: null, wsId: sortedFilteredTasks[0]?.workspace_id || 0, parentKey: 'root', groupTasks: sortedFilteredTasks })
    } else {
      buildGroups(sortedFilteredTasks, 0, 'root')
    }

    return result
  }, [sortedFilteredTasks, viewConfig.groupBy, collapsed, getGroupInfo])

  const allTaskIds = filteredTasks.map(t => t.id)
  const allGroupKeys = rows.filter(r => r.type === 'group').map(r => (r as { key: string }).key)
  const allSelected = selectedIds.size > 0 && selectedIds.size === allTaskIds.length && selectedGroupKeys.size === allGroupKeys.length
  const lastClickedIdx = useRef<number | null>(null)
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
      setSelectedGroupKeys(new Set())
    } else {
      setSelectedIds(new Set(filteredTasks.map(t => t.id)))
      setSelectedGroupKeys(new Set(allGroupKeys))
    }
  }
  function toggleOne(id: number, event?: React.MouseEvent) {
    const taskRows = rows.filter(r => r.type === 'task') as { type: 'task'; task: EnrichedTask; idx: number; parentKey: string }[]
    const currentIdx = taskRows.findIndex(r => r.task.id === id)

    if (event?.shiftKey && lastClickedIdx.current !== null && currentIdx !== -1) {
      // Shift+click: select range between lastClickedIdx and currentIdx
      const start = Math.min(lastClickedIdx.current, currentIdx)
      const end = Math.max(lastClickedIdx.current, currentIdx)
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (let i = start; i <= end; i++) {
          next.add(taskRows[i].task.id)
        }
        return next
      })
    } else {
      setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
    }
    lastClickedIdx.current = currentIdx
  }

  // Map field names to bulk API action names
  const fieldToAction: Record<string, string> = {
    priority: 'set_priority',
    status: 'set_status',
    assignee: 'set_assignee',
    project_id: 'set_project',
  }

  async function bulkUpdate(field: string, value: unknown) {
    const ids = Array.from(selectedIds)
    setAllTasks(prev => prev.map(t => {
      if (!ids.includes(t.id)) return t
      const updated = { ...t, [field]: value }
      if (field === 'status' && value === 'done') updated.completed_at = Math.floor(Date.now() / 1000)
      if (field === 'status' && value !== 'done') updated.completed_at = null
      return updated
    }))

    const action = fieldToAction[field]
    if (action) {
      await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: ids, action, value }),
      })
    } else {
      // Fallback for fields without a dedicated bulk action (e.g. duration_minutes)
      await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: ids, action: 'update', data: { [field]: value } }),
      })
    }
  }

  async function bulkDelete() {
    // Collect selected group rows to determine what to delete
    const selectedGroups = rows.filter(r => r.type === 'group' && selectedGroupKeys.has((r as { key: string }).key)) as { level: string; id: string | number | null; name: string; key: string }[]
    const projectsToDelete = selectedGroups.filter(g => g.level === 'project' && g.id).map(g => ({ id: Number(g.id), name: g.name }))
    const stagesToDelete = selectedGroups.filter(g => g.level === 'stage' && g.id).map(g => ({ id: Number(g.id), name: g.name }))
    const workspacesToDelete = selectedGroups.filter(g => g.level === 'workspace' && g.id).map(g => ({ id: Number(g.id), name: g.name }))
    const taskIds = Array.from(selectedIds)

    // Build label for undo toast
    const parts: string[] = []
    if (workspacesToDelete.length > 0) parts.push(`${workspacesToDelete.length} workspace${workspacesToDelete.length > 1 ? 's' : ''}`)
    if (projectsToDelete.length > 0) parts.push(`${projectsToDelete.length} project${projectsToDelete.length > 1 ? 's' : ''}`)
    if (stagesToDelete.length > 0) parts.push(`${stagesToDelete.length} stage${stagesToDelete.length > 1 ? 's' : ''}`)
    if (taskIds.length > 0) parts.push(`${taskIds.length} task${taskIds.length > 1 ? 's' : ''}`)
    if (parts.length === 0) return

    // Optimistic UI: remove from state immediately
    const deletedProjectIds = new Set(projectsToDelete.map(p => p.id))
    const deletedStageIds = new Set(stagesToDelete.map(s => s.id))
    const deletedWsIds = new Set(workspacesToDelete.map(w => w.id))

    setAllTasks(prev => prev.filter(t => {
      if (taskIds.includes(t.id)) return false
      if (t.project_id && deletedProjectIds.has(t.project_id)) return false
      if (t.stage_id && deletedStageIds.has(t.stage_id)) return false
      return true
    }))
    if (deletedProjectIds.size > 0) {
      setProjects(prev => prev.filter(p => !deletedProjectIds.has(p.id)))
      setStages(prev => prev.filter(s => !deletedProjectIds.has(s.project_id)))
    }
    if (deletedStageIds.size > 0) setStages(prev => prev.filter(s => !deletedStageIds.has(s.id)))
    if (deletedWsIds.size > 0) setWorkspaces(prev => prev.filter(w => !deletedWsIds.has(w.id)))

    setSelectedIds(new Set())
    setSelectedGroupKeys(new Set())

    // Fire soft-delete API calls in background
    if (taskIds.length > 0) {
      fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds, action: 'delete' }),
      })
    }
    for (const p of projectsToDelete) {
      const proj = projects.find(pr => pr.id === p.id)
      fetch(`/api/projects?id=${proj?.public_id || p.id}`, { method: 'DELETE' })
    }
    for (const s of stagesToDelete) {
      fetch('/api/stages', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }) })
    }
    for (const w of workspacesToDelete) {
      const ws2 = workspaces.find(ws3 => ws3.id === w.id)
      fetch(`/api/workspaces?id=${ws2?.public_id || w.id}`, { method: 'DELETE' })
    }
    window.dispatchEvent(new Event('sidebar-refresh'))

    // Show undo toast
    showUndoToast({
      label: `Deleted ${parts.join(', ')}`,
      projectIds: projectsToDelete.map(p => p.id),
      stageIds: stagesToDelete.map(s => s.id),
      taskIds,
    })
  }

  const assigneeList = useMemo(() => {
    const set = new Set<string>()
    tasks.forEach(t => { if (t.assignee) set.add(t.assignee) })
    return Array.from(set).sort()
  }, [tasks])

  const stagesForProject = useCallback((projectId: number | null) => {
    if (!projectId) return []
    return stages.filter(s => s.project_id === projectId)
  }, [stages])

  const orderedCols = useMemo(() => {
    if (!viewConfig.columnOrder || viewConfig.columnOrder.length === 0) return COLS
    const colMap = new Map(COLS.map(c => [c.key, c]))
    const ordered: typeof COLS = []
    for (const key of viewConfig.columnOrder) {
      const col = colMap.get(key)
      if (col) ordered.push(col)
    }
    // Append any new COLS not in the saved order
    for (const col of COLS) {
      if (!viewConfig.columnOrder.includes(col.key)) ordered.push(col)
    }
    return ordered
  }, [viewConfig.columnOrder])

  const colCount = orderedCols.length + 1
  const activeViewType = views.find(v => v.id === activeViewId)?.view_type || 'list'

  // Kanban navigation state: selected values for each hierarchy level above the column level
  const [kanbanNav, setKanbanNav] = useState<Record<string, string | null>>({})

  // Build kanban hierarchy: upper levels = tab selectors, last level = columns
  const kanbanData = useMemo(() => {
    const groupLevels: GroupLevel[] = viewConfig.groupBy.length > 0 ? viewConfig.groupBy : ['status']
    // The last level becomes columns, upper levels become navigation tabs
    const columnLevel = groupLevels[groupLevels.length - 1]
    const navLevels = groupLevels.slice(0, -1)

    // Build nav tabs for each level by progressively filtering
    let filteredForKanban = sortedFilteredTasks
    const navTabs: { level: GroupLevel; items: { id: string; name: string; color: string; count: number }[]; selected: string | null }[] = []

    for (const level of navLevels) {
      // Get unique values at this level
      const itemMap = new Map<string, { name: string; color: string; count: number }>()
      for (const t of filteredForKanban) {
        const info = getGroupInfo(t, level)
        const key = String(info.id ?? 'none')
        if (!itemMap.has(key)) itemMap.set(key, { name: info.name, color: info.color, count: 0 })
        itemMap.get(key)!.count++
      }

      const items = Array.from(itemMap.entries()).map(([id, v]) => ({ id, ...v }))
      const selected = kanbanNav[level] ?? null

      navTabs.push({ level, items, selected })

      // If a selection is made, filter tasks for the next level
      if (selected) {
        filteredForKanban = filteredForKanban.filter(t => {
          const info = getGroupInfo(t, level)
          return String(info.id ?? 'none') === selected
        })
      }
    }

    // Build columns from the last level using the filtered tasks
    const colMap = new Map<string, { id: string | number | null; name: string; color: string; tasks: EnrichedTask[] }>()

    // Pre-populate columns for known values so empty ones show
    if (columnLevel === 'stage') {
      // Don't pre-seed "No Stage" - only show if tasks actually have no stage
      const selectedProject = kanbanNav['project']
      const relevantStages = selectedProject ? stages.filter(s => String(s.project_id) === selectedProject) : stages
      relevantStages.forEach(s => colMap.set(String(s.id), { id: s.id, name: s.name, color: s.color, tasks: [] }))
    } else if (columnLevel === 'status') {
      Object.entries(statusConfig).forEach(([k, v]) => colMap.set(k, { id: k, name: v.label, color: v.color, tasks: [] }))
    } else if (columnLevel === 'priority') {
      Object.entries(priorityConfig).forEach(([k, v]) => colMap.set(k, { id: k, name: v.label, color: v.color, tasks: [] }))
    } else if (columnLevel === 'assignee') {
      colMap.set('unassigned', { id: 'unassigned', name: 'Unassigned', color: '#6b7280', tasks: [] })
      teamMembers.forEach(m => colMap.set(m.id, { id: m.id, name: m.name, color: m.color, tasks: [] }))
    } else if (columnLevel === 'project') {
      colMap.set('none', { id: null, name: 'No Project', color: '#6b7280', tasks: [] })
      projects.forEach(p => colMap.set(String(p.id), { id: p.id, name: p.name, color: p.color, tasks: [] }))
    } else if (columnLevel === 'workspace') {
      workspaces.forEach(w => colMap.set(String(w.id), { id: w.id, name: w.name, color: w.color, tasks: [] }))
    } else if (columnLevel === 'folder') {
      colMap.set('none', { id: null, name: 'No Folder', color: '#6b7280', tasks: [] })
      folders.forEach(f => colMap.set(String(f.id), { id: f.id, name: f.name, color: f.color, tasks: [] }))
    }
    // For date-based and label grouping, columns are created dynamically from the data

    for (const t of filteredForKanban) {
      const info = getGroupInfo(t, columnLevel)
      const key = String(info.id ?? 'none')
      if (!colMap.has(key)) colMap.set(key, { ...info, tasks: [] })
      colMap.get(key)!.tasks.push(t)
    }

    const columns = Array.from(colMap.values())
    return { navTabs, columns, columnLevel, filteredCount: filteredForKanban.length }
  }, [sortedFilteredTasks, viewConfig.groupBy, stages, projects, workspaces, folders, getGroupInfo, kanbanNav])

  // Gantt timeline data
  const ganttData = useMemo(() => {
    const now = new Date()
    const tasksWithDates = sortedFilteredTasks.filter(t => t.start_date || t.due_date)
    const allDates = sortedFilteredTasks.flatMap(t => {
      const dates: number[] = []
      if (t.start_date) dates.push(parseDate(t.start_date).getTime())
      if (t.due_date) dates.push(parseDate(t.due_date).getTime())
      return dates
    })

    // Default to 3 months centered on today
    const minDate = allDates.length ? new Date(Math.min(...allDates)) : new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const maxDate = allDates.length ? new Date(Math.max(...allDates)) : new Date(now.getFullYear(), now.getMonth() + 2, 1)

    // Expand range by 2 weeks on each side
    const rangeStart = new Date(minDate)
    rangeStart.setDate(rangeStart.getDate() - 14)
    const rangeEnd = new Date(maxDate)
    rangeEnd.setDate(rangeEnd.getDate() + 14)

    // Generate week markers
    const weeks: Date[] = []
    const cursor = new Date(rangeStart)
    cursor.setDate(cursor.getDate() - cursor.getDay()) // Start on Sunday
    while (cursor <= rangeEnd) {
      weeks.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 7)
    }

    // Group by workspace > project
    const groups: { type: 'workspace' | 'project'; id: number; name: string; color: string; count: number; tasks: EnrichedTask[] }[] = []
    const wsMap = new Map<number, EnrichedTask[]>()
    for (const t of sortedFilteredTasks) {
      const wsId = t.workspace_id || 0
      if (!wsMap.has(wsId)) wsMap.set(wsId, [])
      wsMap.get(wsId)!.push(t)
    }
    for (const [wsId, wsTasks] of wsMap) {
      const ws = workspaces.find(w => w.id === wsId)
      groups.push({ type: 'workspace', id: wsId, name: ws?.name || 'No Workspace', color: ws?.color || '#6b7280', count: wsTasks.length, tasks: [] })
      const projMap = new Map<number, EnrichedTask[]>()
      const noProj: EnrichedTask[] = []
      for (const t of wsTasks) {
        if (t.project_id) {
          if (!projMap.has(t.project_id)) projMap.set(t.project_id, [])
          projMap.get(t.project_id)!.push(t)
        } else {
          noProj.push(t)
        }
      }
      for (const [projId, pTasks] of projMap) {
        const proj = projects.find(p => p.id === projId)
        groups.push({ type: 'project', id: projId, name: proj?.name || 'Unknown', color: proj?.color || '#6b7280', count: pTasks.length, tasks: pTasks })
      }
      if (noProj.length) {
        groups.push({ type: 'project', id: 0, name: 'No Project', color: '#6b7280', count: noProj.length, tasks: noProj })
      }
    }

    return { rangeStart, rangeEnd, weeks, groups, now, tasksWithDates }
  }, [sortedFilteredTasks, workspaces, projects])

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col relative">
      {/* Refresh indicator */}
      {isRefreshing && (
        <div className="absolute top-0 left-0 right-0 z-20 h-0.5 bg-accent/30 overflow-hidden">
          <div className="h-full w-1/3 bg-accent animate-[shimmer_1s_ease-in-out_infinite]" style={{ animation: 'shimmer 1s ease-in-out infinite', transform: 'translateX(-100%)' }} />
        </div>
      )}
      {/* Page Title Header - Motion Lite style */}
      <div className="flex items-center justify-between px-5 py-2.5 shrink-0 border-b border-border">
        <div className="flex items-center gap-2.5">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-accent">
            <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          <h1 className="text-[18px] font-semibold text-text">Projects &amp; Tasks</h1>
          {/* Page-level options button (placeholder) */}
        </div>
        <div className="flex items-center gap-2">
          <NewItemMenu workspaces={workspaces} />
        </div>
      </div>

      {/* View Tabs Bar - Motion Lite style with overflow "X more" dropdown */}
      <div className="flex items-center border-b border-border px-4 shrink-0 overflow-hidden">
        {/* Navigate tab - always visible */}
        <button
          onClick={() => setNavigateView(!navigateView)}
          className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors shrink-0 ${
            navigateView
              ? 'text-accent'
              : 'text-text-dim hover:text-text-secondary'
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L3 6l2 8 3-3 3 3 2-8L8 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={navigateView ? 'currentColor' : 'none'} fillOpacity="0.15" />
          </svg>
          <span>Navigate</span>
          {navigateView && <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-full" />}
        </button>

        <div className="w-px h-4 bg-border mx-0.5 shrink-0" />

        {/* View tabs area with overflow measurement */}
        <div ref={viewTabsContainerRef} className="flex-1 min-w-0 flex items-center gap-0.5 relative">
          {/* Hidden measurement row - renders all tabs for width calculation */}
          <div
            ref={viewTabsMeasureRef}
            className="absolute top-0 left-0 flex items-center gap-0.5 invisible pointer-events-none"
            aria-hidden="true"
            style={{ width: '99999px' }}
          >
            {views.map(v => (
              <span key={v.id} data-mtab="" className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium shrink-0 whitespace-nowrap">
                <span>{VIEW_TYPE_ICONS[v.view_type] || VIEW_TYPE_ICONS.list}</span>
                <span>{v.name}</span>
              </span>
            ))}
          </div>

          {/* Visible view tabs */}
          {visibleViews.map(v => (
            <div key={v.id} className="relative group flex items-center">
              {renamingViewId === v.id ? (
                <input
                  autoFocus
                  defaultValue={v.name}
                  className="h-8 px-2 bg-elevated border border-accent rounded text-[14px] text-text outline-none min-w-[80px]"
                  onBlur={(e) => { const n = e.target.value.trim(); if (n) renameView(v.id, n); else setRenamingViewId(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenamingViewId(null) }}
                />
              ) : (
                <button
                  onClick={() => { setNavigateView(false); switchView(v.id) }}
                  onDoubleClick={() => setRenamingViewId(v.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors shrink-0 ${
                    activeViewId === v.id && !navigateView
                      ? 'text-text'
                      : 'text-text-dim hover:text-text-secondary'
                  }`}
                >
                  <span className="opacity-60">{VIEW_TYPE_ICONS[v.view_type] || VIEW_TYPE_ICONS.list}</span>
                  <span>{v.name}</span>
                  {activeViewId === v.id && !navigateView && (
                    <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-full" />
                  )}
                </button>
              )}
              {activeViewId === v.id && views.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteView(v.id) }}
                  className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-card border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <IconX size={6} className="text-text-dim" strokeWidth={1.2} />
                </button>
              )}
            </div>
          ))}

          {/* "X more" overflow dropdown */}
          {overflowViews.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setMoreViewsOpen(!moreViewsOpen)}
                className="flex items-center gap-1 px-2.5 py-2.5 text-[13px] font-medium text-text-dim hover:text-text-secondary transition-colors whitespace-nowrap"
              >
                <span>{overflowViews.length} more</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform ${moreViewsOpen ? 'rotate-180' : ''}`}>
                  <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {moreViewsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreViewsOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] bg-card border border-border rounded-lg shadow-xl py-1">
                    {overflowViews.map(v => (
                      <button
                        key={v.id}
                        onClick={() => { setNavigateView(false); switchView(v.id); setMoreViewsOpen(false) }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors ${
                          activeViewId === v.id && !navigateView
                            ? 'text-text bg-hover/50'
                            : 'text-text-dim hover:text-text hover:bg-hover/30'
                        }`}
                      >
                        <span className="opacity-60 shrink-0">{VIEW_TYPE_ICONS[v.view_type] || VIEW_TYPE_ICONS.list}</span>
                        <span className="truncate">{v.name}</span>
                        {activeViewId === v.id && !navigateView && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Add view button */}
        <button
          onClick={() => setShowNewViewModal(true)}
          className="flex items-center gap-1 px-2.5 py-2.5 text-[14px] text-text-dim hover:text-text-secondary transition-colors shrink-0"
        >
          <IconPlus size={14} />
        </button>

        {/* View manager */}
        <div className="shrink-0 flex items-center gap-1 ml-1">
          <button
            onClick={() => setShowViewManager(!showViewManager)}
            className="flex items-center gap-1 px-2 py-2 rounded-md text-[14px] text-text-dim hover:text-text-secondary hover:bg-hover/30 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      {/* Controls Bar - Motion Lite style with dividers, wraps when narrow */}
      <div className="flex flex-wrap items-center gap-y-1.5 border-b border-border px-4 py-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {/* Group by badge (clickable - opens config panel) */}
          <div className="relative">
            <button
              onClick={() => { setShowGroupByPanel(!showGroupByPanel); setShowSortPanel(false) }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-semibold transition-colors cursor-pointer ${
                showGroupByPanel
                  ? 'bg-accent text-white border border-accent/30'
                  : 'bg-accent text-white border border-accent/20 hover:bg-accent/90'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Group by: {viewConfig.groupBy.length > 0 ? viewConfig.groupBy.map(l => GROUP_LEVEL_LABELS[l]).join(' > ') + ' > Task' : 'None'}
            </button>
            {showGroupByPanel && (
              <GroupByPanel
                groupBy={viewConfig.groupBy}
                hideEmptyGroups={viewConfig.hideEmptyGroups}
                onChange={(groupBy) => updateViewConfig({ groupBy })}
                onToggleHideEmpty={() => updateViewConfig({ hideEmptyGroups: !viewConfig.hideEmptyGroups })}
                onClose={() => setShowGroupByPanel(false)}
              />
            )}
          </div>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Sort Groups */}
          <div className="relative">
            <button
              onClick={() => { setShowSortGroupsPanel(!showSortGroupsPanel); setShowGroupByPanel(false); setShowSortPanel(false) }}
              className={`flex items-center gap-1 h-[25px] px-1.5 py-0.5 rounded-[6px] border text-[13px] font-medium transition-colors ${
                showSortGroupsPanel
                  ? 'border-[var(--filter-btn-border)] bg-accent/10 text-accent'
                  : 'border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] text-text-secondary hover:text-text'
              }`}
            >
              Sort Groups
            </button>
            {showSortGroupsPanel && (
              <SortGroupsPanel
                groupBy={viewConfig.groupBy}
                workspaces={workspaces}
                projects={projects}
                stages={stages}
                folders={folders}
                onClose={() => setShowSortGroupsPanel(false)}
              />
            )}
          </div>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Quick view type toggle */}
          <div className="flex items-center rounded overflow-hidden border border-border">
            {(['list', 'kanban', 'gantt', 'dashboard', 'workload'] as const).map(vt => (
              <button
                key={vt}
                onClick={async () => {
                  if (activeViewId && activeViewType !== vt) {
                    setViews(prev => prev.map(v => v.id === activeViewId ? { ...v, view_type: vt } : v))
                    await fetch('/api/views', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: activeViewId, view_type: vt }) })
                  }
                }}
                className={`h-[25px] px-1.5 py-0.5 text-[13px] font-medium transition-colors ${
                  activeViewType === vt ? 'bg-[var(--filter-btn-bg)] text-text' : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                {vt.charAt(0).toUpperCase() + vt.slice(1)}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-border mx-0.5" />

          {/* Sort Tasks */}
          <div className="relative">
            <button
              onClick={() => { setShowSortPanel(!showSortPanel); setShowGroupByPanel(false) }}
              className={`flex items-center gap-1 h-[25px] px-1.5 py-0.5 rounded-[6px] border text-[13px] font-medium transition-colors ${
                showSortPanel
                  ? 'border-[var(--filter-btn-border)] bg-accent/10 text-accent'
                  : 'border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] text-text-secondary hover:text-text'
              }`}
            >
              Sort Tasks
            </button>
            {showSortPanel && (
              <SortPanel
                sortBy={viewConfig.sortBy}
                sortDir={viewConfig.sortDir}
                onChange={(sortBy, sortDir) => updateViewConfig({ sortBy, sortDir })}
                onClose={() => setShowSortPanel(false)}
              />
            )}
          </div>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input placeholder="Search..." value={filters.search} onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
              className="h-[25px] w-36 rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-1.5 text-[13px] font-medium text-text outline-none placeholder:text-text-dim focus:border-accent" />
            <Dropdown value={filters.status} onChange={(v) => setFilters(f => ({ ...f, status: v }))} placeholder="Status" options={[{ value: '', label: 'Status' }, ...Object.entries(statusConfig).map(([k, v]) => ({ value: k, label: v.label }))]} renderOption={renderStatusOption} triggerClassName="h-[25px] rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-2 text-[13px] font-medium text-text inline-flex items-center gap-1.5 cursor-pointer" minWidth={150} />
            <Dropdown value={filters.priority} onChange={(v) => setFilters(f => ({ ...f, priority: v }))} placeholder="Priority" options={[{ value: '', label: 'Priority' }, ...SHARED_PRIORITY.map(p => ({ value: p.value, label: p.label, icon: <PriorityIcon priority={p.value} size={12} /> }))]} triggerClassName="h-[25px] rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-2 text-[13px] font-medium text-text inline-flex items-center gap-1.5 cursor-pointer" minWidth={140} />
            <Dropdown value={filters.assignee} onChange={(v) => setFilters(f => ({ ...f, assignee: v }))} placeholder="Assignee" options={[{ value: '', label: 'Assignee' }, ...assigneeList.map(a => ({ value: a, label: a === 'operator' ? 'Operator' : a.charAt(0).toUpperCase() + a.slice(1) }))]} triggerClassName="h-[25px] rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-2 text-[13px] font-medium text-text inline-flex items-center gap-1.5 cursor-pointer" minWidth={170} />
            <Dropdown value={filters.project} onChange={(v) => setFilters(f => ({ ...f, project: v }))} placeholder="Project" options={[{ value: '', label: 'Project' }, ...projects.map(p => ({ value: String(p.id), label: p.name, color: p.color }))]} triggerClassName="h-[25px] rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-2 text-[13px] font-medium text-text inline-flex items-center gap-1.5 cursor-pointer" minWidth={160} />
            <LabelFilterDropdown
              allLabels={allLabels}
              selected={filters.labels}
              onChange={(labels) => setFilters(f => ({ ...f, labels }))}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[13px] font-medium text-text-dim uppercase tracking-wide">Tasks: {filteredTasks.length}</span>
          <button
            onClick={() => setShowOptions(!showOptions)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[13px] text-text-dim hover:text-text hover:bg-hover/30 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d={showOptions ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {showOptions ? 'Hide' : 'Options'}
          </button>
        </div>
      </div>

      {/* Options Row - Motion Lite style toggles */}
      {showOptions && (
        <div className="flex items-center gap-4 border-b border-border px-5 py-1.5 shrink-0 bg-card/50">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              onClick={() => setShowResolvedTasks(!showResolvedTasks)}
              className={`relative w-8 h-[18px] rounded-full transition-colors ${showResolvedTasks ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${showResolvedTasks ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
            </button>
            <span className="text-[13px] text-text-secondary">Show resolved tasks</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              onClick={() => setShowPastDeadlineOnly(!showPastDeadlineOnly)}
              className={`relative w-8 h-[18px] rounded-full transition-colors ${showPastDeadlineOnly ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${showPastDeadlineOnly ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
            </button>
            <span className="text-[13px] text-text-secondary">Only show scheduled past deadline</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              onClick={() => updateViewConfig({ hideEmptyGroups: !viewConfig.hideEmptyGroups })}
              className={`relative w-8 h-[18px] rounded-full transition-colors ${viewConfig.hideEmptyGroups ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${viewConfig.hideEmptyGroups ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
            </button>
            <span className="text-[13px] text-text-secondary">Hide empty groups</span>
          </label>
        </div>
      )}

      {/* View Manager Panel */}
      {showViewManager && (
        <ViewManagerPanel
          views={views}
          activeViewId={activeViewId}
          onSwitch={switchView}
          onDelete={deleteView}
          onRename={(id) => { setRenamingViewId(id); setShowViewManager(false) }}
          onNewView={() => { setShowNewViewModal(true); setShowViewManager(false) }}
          onClose={() => setShowViewManager(false)}
        />
      )}

      {/* New View Modal */}
      {showNewViewModal && (
        <NewViewModal
          onClose={() => setShowNewViewModal(false)}
          onCreate={createNewView}
        />
      )}

      {/* ─── NAVIGATE VIEW ─── */}
      {navigateView && (
        <NavigateView workspaces={workspaces} tasks={tasks} collapsed={collapsed} toggleCollapse={toggleCollapse} onOpenProject={openProjectPopup} />
      )}

      {/* ─── LIST VIEW ─── */}
      {!navigateView && activeViewType === 'list' && <div className="flex-1 min-h-0 overflow-auto relative">
        {/* Bulk action bar - floats at top of task list */}
        {(selectedIds.size > 0 || selectedGroupKeys.size > 0) && (
          <div className="sticky top-0 z-30">
            <BulkActionBar count={selectedIds.size + selectedGroupKeys.size} onClear={() => { setSelectedIds(new Set()); setSelectedGroupKeys(new Set()) }} onUpdate={bulkUpdate} onDelete={bulkDelete} projects={projects} bulkField={bulkField} setBulkField={setBulkField} />
          </div>
        )}
        <table className="w-full border-collapse" style={{ minWidth: 2600 }}>
          <thead className="sticky top-0 z-10 bg-[var(--bg)]" style={(selectedIds.size > 0 || selectedGroupKeys.size > 0) ? { top: 44 } : undefined}>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <th className="w-[650px] min-w-[650px] border-r border-[var(--border)]" style={{ height: 24 }}>
                <div className="flex items-center gap-2" style={{ padding: '0 12px', height: 24 }}>
                  <Checkbox checked={allSelected} indeterminate={selectedIds.size > 0 && !allSelected} onChange={toggleAll} />
                  <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', color: '#6b7280' }}>Name</span>
                </div>
              </th>
              {orderedCols.map(col => (
                <th
                  key={col.key}
                  draggable
                  onDragStart={(e) => { setDragColKey(col.key); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverColKey(col.key) }}
                  onDragEnter={(e) => { e.preventDefault(); setDragOverColKey(col.key) }}
                  onDragEnd={() => { setDragColKey(null); setDragOverColKey(null) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragColKey && dragColKey !== col.key) {
                      const keys = orderedCols.map(c => c.key)
                      const fromIdx = keys.indexOf(dragColKey)
                      const toIdx = keys.indexOf(col.key)
                      if (fromIdx !== -1 && toIdx !== -1) {
                        keys.splice(fromIdx, 1)
                        keys.splice(toIdx, 0, dragColKey)
                        updateViewConfig({ columnOrder: keys })
                      }
                    }
                    setDragColKey(null)
                    setDragOverColKey(null)
                  }}
                  className={`${col.w} px-3 text-center whitespace-nowrap cursor-grab active:cursor-grabbing select-none transition-colors border-r border-[var(--border)] ${
                    dragOverColKey === col.key && dragColKey !== col.key ? 'bg-accent/10 border-l-2 border-accent' : ''
                  } ${dragColKey === col.key ? 'opacity-40' : ''}`}
                  style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', color: '#6b7280' }}
                >
                  {col.label}
                </th>
              ))}
              <th className="w-[36px] px-1 py-[3px]">
                <button onClick={() => setShowColumnConfig(!showColumnConfig)} className="text-text-dim hover:text-text transition-colors p-1 rounded hover:bg-hover relative" title="Configure columns">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M6.5 2h3v3h-3zM6.5 6.5h3v3h-3zM6.5 11h3v3h-3z" fill="currentColor" fillOpacity="0.6" /></svg>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // ─── Group header ───
              if (row.type === 'group') {
                const isOpen = !collapsed.has(row.key)
                const indent = 12 + row.depth * 24
                const isTopLevel = row.depth === 0
                const borderColor = row.depth === 0 ? '#323839' : row.depth === 1 ? '#2e3334' : '#2a2f30'
                const fontSize = 'text-[14px]'
                const fontWeight = 'font-semibold'
                const pyClass = isTopLevel ? 'py-2.5' : row.depth === 1 ? 'py-2' : 'py-1.5'

                const bgColor = 'var(--bg-surface)'
                const barIndent = row.depth === 0 ? 0 : row.depth === 1 ? 24 : 48

                // Check if group has selected tasks for highlight
                const groupTaskIds = row.groupTasks?.map((t: { id: number }) => t.id) || []
                const isGroupHighlighted = selectedGroupKeys.has(row.key) || groupTaskIds.some((id: number) => selectedIds.has(id))

                return (
                  <tr key={row.key} className="border-b cursor-pointer" style={{ borderColor, height: 36, background: isGroupHighlighted ? 'rgba(255,255,255,0.035)' : bgColor }}>
                    <td colSpan={colCount} className="relative"
                      style={{ height: 36 }}
                      onClick={() => toggleCollapse(row.key)}>
                      <div className="absolute inset-y-0 right-0 pointer-events-none" style={{ left: barIndent }} />
                      <div className="flex items-center gap-2 relative" style={{ paddingLeft: 12 }}>
                        <span onClick={(e) => {
                          e.stopPropagation()
                          const isGroupSelected = selectedGroupKeys.has(row.key)
                          // Find child groups by walking sequential rows deeper than this one
                          const myIdx = rows.indexOf(row as typeof rows[number])
                          const childKeys: string[] = []
                          const allChildTaskIds: number[] = [...groupTaskIds]
                          if (myIdx >= 0) {
                            for (let i = myIdx + 1; i < rows.length; i++) {
                              const r = rows[i]
                              if (r.type === 'group' && (r as { depth: number }).depth > row.depth) {
                                childKeys.push((r as { key: string }).key)
                                // Also collect tasks from child groups
                                const childGroupTasks = (r as { groupTasks?: { id: number }[] }).groupTasks || []
                                childGroupTasks.forEach(t => allChildTaskIds.push(t.id))
                              } else if (r.type === 'group' && (r as { depth: number }).depth <= row.depth) {
                                break
                              }
                            }
                          }
                          setSelectedGroupKeys(prev => {
                            const next = new Set(prev)
                            const keys = [row.key, ...childKeys]
                            keys.forEach(k => isGroupSelected ? next.delete(k) : next.add(k))
                            return next
                          })
                          // Also select/deselect all tasks in this group + child groups
                          if (allChildTaskIds.length > 0) {
                            setSelectedIds(prev => {
                              const next = new Set(prev)
                              allChildTaskIds.forEach((id: number) => isGroupSelected ? next.delete(id) : next.add(id))
                              return next
                            })
                          }
                        }}>
                          <Checkbox checked={selectedGroupKeys.has(row.key)} indeterminate={!selectedGroupKeys.has(row.key) && groupTaskIds.length > 0 && groupTaskIds.some((id: number) => selectedIds.has(id))} onChange={() => {}} />
                        </span>
                        <div style={{ width: row.depth * 24 }} className="shrink-0" />
                        <button onClick={(e) => { e.stopPropagation(); toggleCollapse(row.key) }} className="text-text-dim"><Chevron expanded={isOpen} /></button>
                        {row.level === 'workspace' ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: row.color }} className="shrink-0">
                            <path d="M12 2L2 8.5l10 6.5 10-6.5L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                            <path d="M2 12l10 6.5L22 12" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                            <path d="M2 15.5l10 6.5 10-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          </svg>
                        ) : row.level === 'project' ? (
                          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: row.color }} className="shrink-0">
                            <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                            <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                          </svg>
                        ) : row.level === 'status' ? (
                          <StatusIcon status={String(row.id)} size={16} />
                        ) : row.level === 'stage' ? (
                          null
                        ) : (
                          <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                        )}
                        {row.level === 'stage' ? (
                          <StagePill name={row.name} color={row.color} size="sm" />
                        ) : row.level === 'project' && row.id ? (
                          <button onClick={(e) => { e.stopPropagation(); openProjectPopup(Number(row.id)) }} className={`${fontSize} ${fontWeight} text-white hover:underline cursor-pointer text-left`}>
                            {row.name}
                          </button>
                        ) : (
                          <span className={`${fontSize} ${fontWeight} text-white`}>
                            {row.name}
                          </span>
                        )}
                        <span className="text-[11px] text-text-dim uppercase tracking-wide">({GROUP_LEVEL_LABELS[row.level]})</span>
                        <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '1px 5px', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', marginLeft: 4 }}>{row.count}</span>
                      </div>
                    </td>
                  </tr>
                )
              }

              // ─── Add task row (combined summary + add) ───
              if (row.type === 'addtask') {
                const groupIndent = viewConfig.groupBy.length * 24
                const isAdding = addingTaskKeys.has(row.parentKey)
                // Look up project defaults for auto-population
                const addProject = row.projId ? projects.find(p => p.id === row.projId) : null
                const addStage = row.stageId ? stages.find(s => s.id === row.stageId) : null
                const addWorkspace = workspaces.find(w => w.id === row.wsId)
                const currentUser = teamMembers.find(m => m.type === 'human' && m.role === 'Owner') || teamMembers.find(m => m.type === 'human')
                const defaultAssignee = (addProject ? (addProject as unknown as Record<string, unknown>).default_assignee as string | undefined : undefined) || currentUser?.id || null
                const defaultPriority = (addProject ? (addProject as unknown as Record<string, unknown>).default_priority as string : null) || 'medium'
                const today = new Date().toISOString().split('T')[0]
                const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

                return (
                  <tr key={`add-${row.parentKey}`} className="border-b border-[var(--border)]" style={{ height: 36 }}>
                    <td className="w-[650px] min-w-[650px] p-0" style={{ height: 36 }}>
                      <AddTaskInline
                        groupIndent={groupIndent}
                        projectId={row.projId}
                        stageId={row.stageId}
                        workspaceId={row.wsId}
                        adding={isAdding}
                        setAdding={(v) => {
                          setAddingTaskKeys(prev => {
                            const next = new Set(prev)
                            if (v) next.add(row.parentKey); else next.delete(row.parentKey)
                            return next
                          })
                        }}
                        onCreated={(newTask) => {
                          setAllTasks(prev => [...prev, newTask])
                        }}
                      />
                    </td>
                    {orderedCols.map(col => {
                      const k = col.key

                      // ── Active state: show inherited defaults styled like real task rows ──
                      if (isAdding) {
                        let cellContent: React.ReactNode = null
                        if (k === 'status') {
                          cellContent = (
                            <span className="inline-flex items-center gap-1 rounded px-2 py-[3px] text-[11px] font-semibold tracking-wide uppercase" style={{ color: '#9ca3af', backgroundColor: '#9ca3af18', border: '1px solid #9ca3af28' }}>
                              <StatusIcon status="todo" size={11} />Todo
                            </span>
                          )
                        } else if (k === 'priority') {
                          const pc = priorityConfig[defaultPriority] || priorityConfig.medium
                          cellContent = (
                            <span className="inline-flex items-center gap-1.5 text-[14px]">
                              <span style={{ color: pc.color }}><PriorityIcon priority={defaultPriority} size={18} /></span><span className="text-text">{pc.label}</span>
                            </span>
                          )
                        } else if (k === 'assignee') {
                          if (!defaultAssignee) {
                            cellContent = <span className="inline-flex items-center gap-1.5 text-[14px] text-text"><span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-border text-text-dim shrink-0"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>Unassigned</span>
                          } else {
                            const mm = findAssignee(defaultAssignee, teamMembers)
                            const displayName = mm?.name || defaultAssignee.charAt(0).toUpperCase() + defaultAssignee.slice(1)
                            cellContent = (
                              <span className="inline-flex items-center gap-1.5">
                                <Avatar name={displayName} size={18} src={mm?.avatar} color={mm?.color || assigneeColors[defaultAssignee]} />
                                <span className="text-[14px] text-text truncate">{displayName}</span>
                              </span>
                            )
                          }
                        } else if (k === 'project') {
                          cellContent = addProject ? (
                            <span className="inline-flex items-center gap-1.5">
                              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: addProject.color }}>
                                <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                                <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                              </svg>
                              <span className="text-[14px] text-text truncate">{addProject.name}</span>
                            </span>
                          ) : <span className="inline-flex items-center gap-1.5"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: '#6b7280' }}><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg><span className="text-[14px] text-text">No project</span></span>
                        } else if (k === 'stage') {
                          cellContent = addStage ? (
                            <StagePill name={addStage.name} color={addStage.color} size="sm" />
                          ) : <StagePill name="No stage" color="#6b7280" size="sm" />
                        } else if (k === 'workspace' && addWorkspace) {
                          cellContent = <span className="text-[14px] text-text">{addWorkspace.name}</span>
                        } else if (k === 'due_date') {
                          cellContent = <span className="text-[14px] text-text">{fmtDate(today)}</span>
                        } else if (k === 'start_date') {
                          cellContent = <span className="text-[14px] text-text">{fmtDate(tomorrow)}</span>
                        } else if (k === 'duration') {
                          cellContent = <span className="text-[14px] text-text">30m</span>
                        } else {
                          cellContent = <span className="text-[13px] text-text-dim">-</span>
                        }
                        return <td key={k} className={`${col.w} text-center px-2`} style={{ whiteSpace: 'nowrap', height: 36 }}>{cellContent}</td>
                      }

                      // ── Idle state: show summary aggregates ──
                      return <td key={k} className={`${col.w} text-center px-2`} style={{ whiteSpace: 'nowrap', height: 36 }}>{computeSummary(row.groupTasks, k)}</td>
                    })}
                    <td className="w-[36px]" />
                  </tr>
                )
              }

              // ─── Task row ───
              const task = row.task
              const priority = priorityConfig[task.priority] || priorityConfig.medium
              const status = statusConfig[task.status] || statusConfig.todo
              const isDone = task.status === 'done'
              const isOverdue = task.due_date && !isDone && parseDate(task.due_date) < new Date()
              const isSelected = selectedIds.has(task.id)
              const isEditing = (field: string) => editingCell?.taskId === task.id && editingCell?.field === field
              const edit = (field: string) => setEditingCell({ taskId: task.id, field })
              const taskStages = stagesForProject(task.project_id)

              return (
                <tr key={task.id} className={`task-row border-b border-[var(--border)] text-[14px] transition-colors ${isSelected ? '' : 'hover:bg-hover/30'}`}
                  style={{ height: 36, background: isSelected ? 'rgba(255,255,255,0.035)' : undefined }}
                  onContextMenu={(e) => { e.preventDefault(); setTaskContextMenu({ x: e.clientX, y: e.clientY, task }) }}>
                  {/* Sticky name */}
                  <td className={`w-[650px] min-w-[650px] cursor-pointer hover:bg-hover/30`}
                    style={{ height: 36 }}
                    onClick={() => setSelectedTaskId(task.id)}>
                    <div className="task-row-inner flex items-center gap-2.5" style={{ paddingLeft: 12, height: 36 }}>
                      <span onClick={(e) => { e.stopPropagation(); toggleOne(task.id, e) }}>
                        <Checkbox checked={isSelected} onChange={() => {}} />
                      </span>
                      <div style={{ width: viewConfig.groupBy.length * 24 }} className="shrink-0" />
                      {/* Row number */}
                      <span className="w-6 text-right text-[13px] text-text-dim shrink-0">{row.idx}</span>
                      <div className="relative shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); edit('circle_status') }}
                          className="flex items-center justify-center hover:scale-110 transition-transform"
                        >
                          <StatusIcon status={task.status} size={16} />
                        </button>
                        {isEditing('circle_status') && (
                          <StatusPickerDropdown
                            current={task.status}
                            onSelect={(s) => updateTask(task.id, 'status', s)}
                            onClose={() => setEditingCell(null)}
                          />
                        )}
                      </div>
                      {isEditing('title') ? (
                        <EditableText value={task.title} onSave={(v) => updateTask(task.id, 'title', v)} onCancel={() => setEditingCell(null)} />
                      ) : (
                        <span className={`truncate cursor-pointer text-[14px] font-normal ${isDone ? 'text-text-dim' : 'text-white'}`}
                          onDoubleClick={() => edit('title')} onClick={() => setSelectedTaskId(task.id)}>
                          {task.title}
                        </span>
                      )}
                    </div>
                  </td>

                  {orderedCols.map(col => {
                    const k = col.key
                    if (k === 'status') return (
                      <EditableCell key={k} isEditing={isEditing('col_status')} onStartEdit={() => edit('col_status')} className={col.w}>
                        {isEditing('col_status') ? (
                          <Dropdown
                            defaultOpen
                            value={task.status}
                            onChange={(v) => { updateTask(task.id, 'status', v); setEditingCell(null) }}
                            onClose={() => setEditingCell(null)}
                            options={Object.entries(statusConfig).map(([k, v]) => ({ value: k, label: v.label }))}
                            renderOption={renderStatusOption}
                            minWidth={150}
                            renderTrigger={() => (
                              <span className="inline-flex items-center gap-1 rounded px-2 py-[3px] text-[11px] font-semibold tracking-wide uppercase" style={{ color: status.color, backgroundColor: status.color + '18', border: `1px solid ${status.color}28` }}>
                                <StatusIcon status={task.status} size={11} />{status.label}
                              </span>
                            )}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-[3px] text-[11px] font-semibold tracking-wide uppercase" style={{ color: status.color, backgroundColor: status.color + '18', border: `1px solid ${status.color}28` }}>
                            <StatusIcon status={task.status} size={11} />{status.label}
                          </span>
                        )}
                      </EditableCell>
                    )
                    if (k === 'priority') return (
                      <EditableCell key={k} isEditing={isEditing('col_priority')} onStartEdit={() => edit('col_priority')} className={col.w}>
                        {isEditing('col_priority') ? (
                          <Dropdown
                            defaultOpen
                            value={task.priority}
                            onChange={(v) => { updateTask(task.id, 'priority', v); setEditingCell(null) }}
                            onClose={() => setEditingCell(null)}
                            options={SHARED_PRIORITY.map(p => ({ value: p.value, label: p.label }))}
                            renderOption={renderPriorityOption}
                            minWidth={140}
                            renderTrigger={() => (
                              <span className="inline-flex items-center gap-1.5 text-[14px]">
                                <span style={{ color: priority.color }}><PriorityIcon priority={task.priority} size={18} /></span><span className="text-text">{priority.label}</span>
                              </span>
                            )}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[14px]">
                            <span style={{ color: priority.color }}><PriorityIcon priority={task.priority} size={18} /></span><span className="text-text">{priority.label}</span>
                          </span>
                        )}
                      </EditableCell>
                    )
                    if (k === 'assignee') return (
                      <EditableCell isEditing={isEditing('col_assignee')} onStartEdit={() => edit('col_assignee')} className={col.w} field="assignee">
                        {isEditing('col_assignee') ? (
                          <Dropdown
                            defaultOpen
                            value={task.assignee || ''}
                            onChange={(v) => { updateTask(task.id, 'assignee', v || null); setEditingCell(null) }}
                            onClose={() => setEditingCell(null)}
                            options={[{ value: '', label: 'Unassigned' }, ...teamMembers.map(a => ({ value: a.id, label: a.name }))]}
                            minWidth={170}
                            renderOption={(opt, isSelected) => {
                              const m = teamMembers.find(a => a.id === opt.value)
                              return (
                                <div className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] transition-colors ${isSelected ? '' : 'hover:bg-[rgba(255,255,255,0.06)]'}`} style={{ borderRadius: 'var(--radius-sm)', backgroundColor: isSelected ? 'rgba(255,255,255,0.06)' : undefined }}>
                                  {m ? (
                                    <Avatar name={m.name} size={18} src={m.avatar} color={m.color} />
                                  ) : (
                                    <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-border text-text-dim shrink-0">
                                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                                    </div>
                                  )}
                                  <span className="flex-1 text-text">{opt.label}</span>
                                  {isSelected && <IconCheck size={12} className="shrink-0 text-blue" />}
                                </div>
                              )
                            }}
                            renderTrigger={() => {
                              if (!task.assignee) return <span className="inline-flex items-center gap-1.5 text-[14px] text-text"><span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-border text-text-dim shrink-0"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>Unassigned</span>
                              const m = findAssignee(task.assignee, teamMembers)
                              return (
                                <span className="inline-flex items-center gap-1.5">
                                  <Avatar name={m?.name || task.assignee} size={18} src={m?.avatar} color={m?.color || assigneeColors[task.assignee]} />
                                  <span className="text-[14px] text-text truncate">{m?.name || task.assignee.charAt(0).toUpperCase() + task.assignee.slice(1)}</span>
                                </span>
                              )
                            }}
                          />
                        ) : (
                          (() => {
                            if (!task.assignee) return <span className="inline-flex items-center gap-1.5 text-[14px] text-text"><span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-border text-text-dim shrink-0"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM3 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></span>Unassigned</span>
                            const m = findAssignee(task.assignee, teamMembers)
                            return (
                              <span className="inline-flex items-center gap-1.5">
                                <Avatar name={m?.name || task.assignee} size={18} src={m?.avatar} color={m?.color || assigneeColors[task.assignee]} />
                                <span className="text-[14px] text-text truncate">{m?.name || task.assignee.charAt(0).toUpperCase() + task.assignee.slice(1)}</span>
                              </span>
                            )
                          })()
                        )}
                      </EditableCell>
                    )
                    if (k === 'project') return (
                      <EditableCell key={k} isEditing={isEditing('col_project')} onStartEdit={() => edit('col_project')} className={col.w} field="project">
                        {isEditing('col_project') ? (
                          <Dropdown
                            defaultOpen
                            value={String(task.project_id || '')}
                            onChange={(v) => { updateTask(task.id, 'project_id', v ? Number(v) : null); setEditingCell(null) }}
                            onClose={() => setEditingCell(null)}
                            options={[{ value: '', label: 'No Project', icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: '#6b7280' }}><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg> }, ...projects.map(p => ({ value: String(p.id), label: p.name, icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: p.color || '#6b7280' }}><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg> }))]}
                            minWidth={160}
                            renderTrigger={() => task.project_name ? (
                              <span className="inline-flex items-center gap-1.5">
                                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: task.project_color || '#6b7280' }}>
                                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                                  <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                                </svg>
                                <span className="text-[14px] text-text" title={task.project_name}>{task.project_name && task.project_name.length > 20 ? task.project_name.slice(0, 20) + '...' : task.project_name}</span>
                              </span>
                            ) : <span className="inline-flex items-center gap-1.5"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: '#6b7280' }}><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg><span className="text-[14px] text-text">No project</span></span>}
                          />
                        ) : (
                          task.project_name ? (
                            <span className="inline-flex items-center gap-1.5">
                              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: task.project_color || '#6b7280' }}>
                                <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                                <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                              </svg>
                              <span className="text-[14px] text-text" title={task.project_name}>{task.project_name && task.project_name.length > 20 ? task.project_name.slice(0, 20) + '...' : task.project_name}</span>
                            </span>
                          ) : <span className="inline-flex items-center gap-1.5"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: '#6b7280' }}><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg><span className="text-[14px] text-text">No project</span></span>
                        )}
                      </EditableCell>
                    )
                    if (k === 'stage') return (
                      <EditableCell key={k} isEditing={isEditing('col_stage')} onStartEdit={() => edit('col_stage')} className={col.w}>
                        {isEditing('col_stage') ? (
                          <Dropdown
                            defaultOpen
                            value={String(task.stage_id || '')}
                            onChange={(v) => { updateTask(task.id, 'stage_id', v ? Number(v) : null); setEditingCell(null) }}
                            onClose={() => setEditingCell(null)}
                            options={[{ value: '', label: 'No Stage' }, ...taskStages.map(s => ({ value: String(s.id), label: s.name, color: s.color }))]}
                            minWidth={140}
                            renderTrigger={() => task.stage_name ? (
                              <StagePill name={task.stage_name} color={task.stage_color || '#ffd740'} size="sm" />
                            ) : <StagePill name="No stage" color="#6b7280" size="sm" />}
                          />
                        ) : (
                          task.stage_name ? (
                            <StagePill name={task.stage_name} color={task.stage_color || '#ffd740'} size="sm" />
                          ) : <StagePill name="No stage" color="#6b7280" size="sm" />
                        )}
                      </EditableCell>
                    )
                    if (k === 'due_date') return (
                      <EditableCell key={k} isEditing={isEditing('due_date')} onStartEdit={() => edit('due_date')} className={col.w}>
                        {isEditing('due_date') ? (
                          <DatePicker
                            value={task.due_date || ''}
                            onChange={(d) => { updateTask(task.id, 'due_date', d); setEditingCell(null) }}
                          />
                        ) : task.due_date ? (
                          <span className={`text-[14px] ${isOverdue ? 'text-red-400' : 'text-text'}`}>{fmtDate(task.due_date)}</span>
                        ) : <span className="text-[14px] text-text">--</span>}
                      </EditableCell>
                    )
                    if (k === 'start_date') return (
                      <EditableCell key={k} isEditing={isEditing('start_date')} onStartEdit={() => edit('start_date')} className={col.w}>
                        {isEditing('start_date') ? (
                          <DatePicker
                            value={task.start_date || ''}
                            onChange={(d) => { updateTask(task.id, 'start_date', d); setEditingCell(null) }}
                          />
                        ) : <span className="text-[14px] text-text">{task.start_date ? fmtDate(task.start_date) : '--'}</span>}
                      </EditableCell>
                    )
                    if (k === 'created_at') return <td key={k} className={`${col.w} text-center px-2 py-2 text-[14px] text-text`} style={{ whiteSpace: 'nowrap', height: 36 }}>{fmtTs(task.created_at)}</td>
                    if (k === 'duration') return (
                      <EditableCell key={k} isEditing={isEditing('col_duration')} onStartEdit={() => edit('col_duration')} className={col.w}>
                        {isEditing('col_duration') ? (
                          <Dropdown
                            defaultOpen
                            value={String(task.duration_minutes || '')}
                            onChange={(v) => { updateTask(task.id, 'duration_minutes', Number(v)); setEditingCell(null) }}
                            onClose={() => setEditingCell(null)}
                            options={DURATION_OPTIONS}
                            minWidth={100}
                            renderTrigger={() => <span className="text-[14px] text-text">{task.duration_minutes ? (task.duration_minutes >= 60 ? `${Math.floor(task.duration_minutes / 60)}h${task.duration_minutes % 60 ? ` ${task.duration_minutes % 60}m` : ''}` : `${task.duration_minutes}m`) : '--'}</span>}
                          />
                        ) : (
                          <span className="text-[14px] text-text">{task.duration_minutes ? (task.duration_minutes >= 60 ? `${Math.floor(task.duration_minutes / 60)}h${task.duration_minutes % 60 ? ` ${task.duration_minutes % 60}m` : ''}` : `${task.duration_minutes}m`) : '--'}</span>
                        )}
                      </EditableCell>
                    )
                    if (k === 'completed_time') return (
                      <EditableCell key={k} isEditing={isEditing('completed_time')} onStartEdit={() => edit('completed_time')} className={col.w}>
                        {isEditing('completed_time') ? (
                          <input type="number" autoFocus defaultValue={task.completed_time_minutes || ''} placeholder="mins"
                            className="bg-elevated border border-accent rounded px-1 py-0.5 text-[14px] text-text outline-none w-16 text-center"
                            onBlur={(e) => { updateTask(task.id, 'completed_time_minutes', Number(e.target.value) || 0); setEditingCell(null) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null) }} />
                        ) : <span className="text-[14px] text-text">{task.completed_time_minutes ? `${task.completed_time_minutes}m` : '--'}</span>}
                      </EditableCell>
                    )
                    if (k === 'completed_at') return <td key={k} className={`${col.w} text-center px-2 py-2 text-[14px] text-text`} style={{ whiteSpace: 'nowrap', height: 36 }}>{task.completed_at ? fmtTs(task.completed_at) : '--'}</td>
                    if (k === 'workspace') return <td key={k} className={`${col.w} text-center px-2 py-2 text-[14px] text-text`} style={{ whiteSpace: 'nowrap', height: 36 }}>{task.workspace_name || <span className="text-text-dim">No workspace</span>}</td>
                    if (k === 'folder') return (
                      <EditableCell key={k} isEditing={isEditing('col_folder')} onStartEdit={() => edit('col_folder')} className={col.w} field="folder">
                        {isEditing('col_folder') ? (
                          <Dropdown
                            defaultOpen
                            value={String(task.folder_id || '')}
                            onChange={(v) => { updateTask(task.id, 'folder_id', v ? Number(v) : null); setEditingCell(null) }}
                            onClose={() => setEditingCell(null)}
                            options={[{ value: '', label: 'No Folder', icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: '#6b7280' }}><path d="M2 4.5h4.5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg> }, ...folders.map(f => ({ value: String(f.id), label: f.name, icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: f.color || '#6b7280' }}><path d="M2 4.5h4.5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={f.color ? f.color + '30' : 'none'} /></svg> }))]}
                            minWidth={170}
                            renderTrigger={() => task.folder_name ? (
                              <span className="inline-flex items-center gap-1.5">
                                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: (task as any).folder_color || '#6b7280' }}><path d="M2 4.5h4.5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={(task as any).folder_color ? (task as any).folder_color + '30' : 'none'} /></svg>
                                <span className="text-[14px] text-text">{task.folder_name && task.folder_name.length > 20 ? task.folder_name.slice(0, 20) + '...' : task.folder_name}</span>
                              </span>
                            ) : <span className="inline-flex items-center gap-1.5"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: '#6b7280' }}><path d="M2 4.5h4.5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg><span className="text-[14px] text-text">No folder</span></span>}
                          />
                        ) : (
                          task.folder_name ? (
                            <span className="inline-flex items-center gap-1.5">
                              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: (task as any).folder_color || '#6b7280' }}><path d="M2 4.5h4.5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill={(task as any).folder_color ? (task as any).folder_color + '30' : 'none'} /></svg>
                              <span className="text-[14px] text-text">{task.folder_name && task.folder_name.length > 20 ? task.folder_name.slice(0, 20) + '...' : task.folder_name}</span>
                            </span>
                          ) : <span className="inline-flex items-center gap-1.5"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: '#6b7280' }}><path d="M2 4.5h4.5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg><span className="text-[14px] text-text">No folder</span></span>
                        )}
                      </EditableCell>
                    )
                    if (k === 'labels') {
                      const taskLabelArr: string[] = safeParseLabels(task.labels)
                      return (
                        <EditableCell key={k} isEditing={isEditing('labels')} onStartEdit={() => edit('labels')} className={col.w}>
                          {isEditing('labels') ? (
                            <LabelPickerDropdown
                              taskLabels={taskLabelArr}
                              allLabels={allLabels}
                              onToggle={(name, add) => {
                                const updated = add ? [...taskLabelArr, name] : taskLabelArr.filter(l => l !== name)
                                updateTask(task.id, 'labels', updated.length ? JSON.stringify(updated) : null)
                              }}
                              onCreate={async (name, color) => {
                                const res = await fetch('/api/labels', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ name, color }),
                                })
                                if (res.ok) {
                                  const label = await res.json()
                                  setAllLabels(prev => [...prev, label])
                                  // Auto-assign the new label to the task
                                  const updated = [...taskLabelArr, name]
                                  updateTask(task.id, 'labels', JSON.stringify(updated))
                                }
                              }}
                              onClose={() => setEditingCell(null)}
                            />
                          ) : taskLabelArr.length > 0 ? (
                            <div className="flex gap-1 items-center" style={{ whiteSpace: 'nowrap' }}>
                              {(() => {
                                const first = taskLabelArr[0]
                                const labelDef = allLabels.find(lb => lb.name === first)
                                const c = labelDef?.color || '#8c8c8c'
                                return <LabelChip key={first} name={first} color={c} size="md" />
                              })()}
                              {taskLabelArr.length > 1 && <span className="text-[11px] text-text-dim">+{taskLabelArr.length - 1}</span>}
                            </div>
                          ) : <span className="text-[14px] text-text">--</span>}
                        </EditableCell>
                      )
                    }
                    if (k === 'blocked_by') {
                      const blockedCount = task.blocked_by ? task.blocked_by.split(',').filter(Boolean).length : 0
                      return (
                        <td key={k} className={`${col.w} text-center px-2 py-2 text-[14px] cursor-pointer hover:bg-hover/30`} style={{ whiteSpace: 'nowrap', height: 36 }} onClick={() => setSelectedTaskId(task.id)}>
                          {blockedCount > 0 ? <span className="text-red-400">{blockedCount} task{blockedCount > 1 ? 's' : ''}</span> : <span className="text-text-dim">None</span>}
                        </td>
                      )
                    }
                    if (k === 'blocking') {
                      const blockingCount = task.blocking ? task.blocking.split(',').filter(Boolean).length : 0
                      return (
                        <td key={k} className={`${col.w} text-center px-2 py-2 text-[14px] cursor-pointer hover:bg-hover/30`} style={{ whiteSpace: 'nowrap', height: 36 }} onClick={() => setSelectedTaskId(task.id)}>
                          {blockingCount > 0 ? <span className="text-orange-400">{blockingCount} task{blockingCount > 1 ? 's' : ''}</span> : <span className="text-text-dim">None</span>}
                        </td>
                      )
                    }
                    if (k === 'schedule') return (
                      <EditableCell key={k} isEditing={false} onStartEdit={() => {}} className={col.w}>
                        <AutoScheduleToggle
                          active={!!task.auto_schedule}
                          onChange={() => updateTask(task.id, 'auto_schedule', task.auto_schedule ? 0 : 1)}
                          scheduledDate={task.scheduled_start}
                        />
                      </EditableCell>
                    )
                    if (k === 'hard_deadline') return (
                      <EditableCell key={k} isEditing={false} onStartEdit={() => updateTask(task.id, 'hard_deadline', task.hard_deadline ? 0 : 1)} className={col.w}>
                        <span className={`text-[14px] ${task.hard_deadline ? 'text-red-400' : 'text-text-dim'}`}>{task.hard_deadline ? 'Hard' : 'Soft'}</span>
                      </EditableCell>
                    )
                    if (k === 'updated_at') return <td key={k} className={`${col.w} text-center px-2 py-2 text-[14px] text-text`} style={{ whiteSpace: 'nowrap', height: 36 }}>{fmtTs(task.updated_at)}</td>
                    return null
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredTasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-text-dim">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mb-3">
              <rect x="5" y="5" width="30" height="30" rx="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
              <path d="M20 13v14M13 20h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className="text-[16px] mb-4">No tasks match your filters</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const wsId = workspaces[0]?.id
                  if (!wsId) return
                  const name = prompt('Task name:')
                  if (!name?.trim()) return
                  fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: name.trim(), workspace_id: wsId, status: 'todo' }),
                  }).then(() => window.location.reload())
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent/80"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Add Task
              </button>
              <button
                onClick={() => {
                  const wsId = workspaces[0]?.id
                  if (!wsId) return
                  const name = prompt('Project name:')
                  if (!name?.trim()) return
                  fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workspaceId: wsId, name: name.trim() }),
                  }).then(() => window.location.reload())
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-text text-[13px] font-medium hover:bg-hover"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.2"/></svg>
                Add Project
              </button>
            </div>
          </div>
        )}
        {showColumnConfig && (
          <ColumnConfigPanel
            columns={orderedCols}
            onReorder={(newOrder) => updateViewConfig({ columnOrder: newOrder })}
            onClose={() => setShowColumnConfig(false)}
          />
        )}
      </div>}

      {/* ─── KANBAN VIEW ─── */}
      {!navigateView && activeViewType === 'kanban' && (
        <KanbanBoard
          kanbanData={kanbanData}
          kanbanNav={kanbanNav}
          setKanbanNav={setKanbanNav}
          workspaces={workspaces}
          allLabels={allLabels}
          updateTask={updateTask}
          setTasks={setAllTasks}
          setSelectedTaskId={setSelectedTaskId}
          editingCell={editingCell}
          setEditingCell={setEditingCell}
          onTaskContextMenu={(e, task) => { e.preventDefault(); setTaskContextMenu({ x: e.clientX, y: e.clientY, task }) }}
        />
      )}

      {/* ─── GANTT VIEW ─── */}
      {!navigateView && activeViewType === 'gantt' && (
        <GanttView
          ganttData={ganttData}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          onTaskClick={(id) => setSelectedTaskId(id)}
        />
      )}

      {/* ─── WORKLOAD VIEW ─── */}
      {!navigateView && activeViewType === 'workload' && (
        <WorkloadView
          tasks={sortedFilteredTasks}
        />
      )}

      {/* ─── DASHBOARD VIEW ─── */}
      {!navigateView && activeViewType === 'dashboard' && (
        <DashboardView
          tasks={sortedFilteredTasks}
          projects={projects}
          setSelectedTaskId={setSelectedTaskId}
          updateTask={updateTask}
          refreshTasks={refreshTasks}
        />
      )}

      {/* Bulk action bar for non-list views */}
      {(selectedIds.size > 0 || selectedGroupKeys.size > 0) && activeViewType !== 'list' && (
        <BulkActionBar count={selectedIds.size + selectedGroupKeys.size} onClear={() => { setSelectedIds(new Set()); setSelectedGroupKeys(new Set()) }} onUpdate={bulkUpdate} onDelete={bulkDelete} projects={projects} bulkField={bulkField} setBulkField={setBulkField} />
      )}

      {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} onClose={() => { setSelectedTaskId(null); refreshTasks() }} />}

      {taskContextMenu && (
        <ContextMenu
          x={taskContextMenu.x}
          y={taskContextMenu.y}
          onClose={() => setTaskContextMenu(null)}
          items={(() => {
            const t = taskContextMenu.task
            const items: ContextMenuItem[] = [
              {
                label: 'Open',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M6 3H3v10h10v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M9 2h5v5M14 2L7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
                onClick: () => setSelectedTaskId(t.id),
              },
              {
                label: 'Copy task name',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
                onClick: () => navigator.clipboard.writeText(t.title),
              },
              {
                label: t.is_favorite ? 'Unfavorite' : 'Favorite',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 1l2.2 4.5 5 .7-3.6 3.5.8 5L8 12.4 3.6 14.7l.8-5L.8 6.2l5-.7L8 1z" fill={t.is_favorite ? '#facc15' : 'none'} stroke={t.is_favorite ? '#facc15' : 'currentColor'} strokeWidth="1.2" /></svg>,
                onClick: () => updateTask(t.id, 'is_favorite', t.is_favorite ? 0 : 1),
              },
              {
                label: 'Duplicate',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
                onClick: async () => {
                  const res = await fetch('/api/tasks/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id }) })
                  const data = await res.json()
                  if (data?.task) {
                    setAllTasks(prev => [...prev, data.task as EnrichedTask])
                  }
                },
              },
              { label: '', onClick: () => {}, divider: true },
              ...(['urgent', 'high', 'medium', 'low'] as const).map(p => ({
                label: PRIORITY_CONFIG[p].label,
                icon: <PriorityIcon priority={p} size={14} />,
                onClick: () => updateTask(t.id, 'priority', p),
              })),
              { label: '', onClick: () => {}, divider: true },
              {
                label: 'Todo',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="#9ca3af" strokeWidth="1.3" /></svg>,
                onClick: () => updateTask(t.id, 'status', 'todo'),
              },
              {
                label: 'In Progress',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="#ff9100" strokeWidth="1.3" /><path d="M8 2.5A5.5 5.5 0 0113.5 8H8V2.5z" fill="#ff9100" /></svg>,
                onClick: () => updateTask(t.id, 'status', 'in_progress'),
              },
              {
                label: 'Done',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#00e676" /><path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
                onClick: () => updateTask(t.id, 'status', 'done'),
              },
              {
                label: 'Blocked',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="#ef5350" strokeWidth="1.3" /><path d="M4.5 11.5l7-7" stroke="#ef5350" strokeWidth="1.3" /></svg>,
                onClick: () => updateTask(t.id, 'status', 'blocked'),
              },
              { label: '', onClick: () => {}, divider: true },
              {
                label: 'Delete',
                icon: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5M4 4l1 9a1 1 0 001 1h4a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
                danger: true,
                onClick: () => {
                  setAllTasks(prev => prev.filter(tk => tk.id !== t.id))
                  fetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id }) })
                },
              },
            ]
            return items
          })()}
        />
      )}

      {projectPopup && (
        <ProjectDetailPopup
          project={projectPopup.project}
          stages={stages.filter(s => s.project_id === projectPopup.project.id)}
          tasks={tasks.filter(t => t.project_id === projectPopup.project.id)}
          workspace={workspaces.find(w => w.id === projectPopup.project.workspace_id) || null}
          docs={projectPopup.docs}
          folder={folders.find(f => f.id === projectPopup.project.folder_id) || null}
          onClose={() => setProjectPopup(null)}
          onProjectUpdate={(p) => setProjectPopup(prev => prev ? { ...prev, project: p } : null)}
          onDocsUpdate={(d) => setProjectPopup(prev => prev ? { ...prev, docs: d } : null)}
        />
      )}
    </div>
  )
}

// ─── Status Picker (circle click) ───

function StatusPickerDropdown({ current, onSelect, onClose }: {
  current: string; onSelect: (status: string) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 min-w-[200px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl py-1 z-50"
      onClick={(e) => e.stopPropagation()}>
      <div className="px-2.5 py-1 text-[12px] text-text-dim">Choose status...</div>
      {Object.entries(statusConfig).map(([k, v]) => (
        <button
          key={k}
          onClick={() => onSelect(k)}
          className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text transition-colors ${k === current ? '' : 'hover:bg-[rgba(255,255,255,0.06)]'}`}
        >
          <StatusIcon status={k} size={14} />
          <span className="flex-1 text-left">{v.label}</span>
          {k === current && (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M3 8l3.5 3.5L13 5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── Summary Aggregate Helper ───

function computeSummary(tasks: EnrichedTask[], colKey: string): React.ReactNode {
  if (tasks.length === 0) return null

  const fmtShort = (d: string) => {
    const dt = new Date(d)
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  switch (colKey) {
    case 'assignee': {
      const unique = new Set(tasks.map(t => t.assignee).filter(Boolean))
      return <span className="text-[12px] text-text-dim">{unique.size} assignee{unique.size !== 1 ? 's' : ''}</span>
    }
    case 'duration': {
      const total = tasks.reduce((sum, t) => sum + (t.duration_minutes || 0), 0)
      if (!total) return null
      const h = Math.floor(total / 60)
      const m = total % 60
      return <span className="text-[12px] text-text-dim">{h ? `${h}h ` : ''}{m}m</span>
    }
    case 'due_date': {
      const dates = tasks.map(t => t.due_date).filter(Boolean) as string[]
      if (!dates.length) return null
      const sorted = dates.sort()
      if (sorted.length === 1) return <span className="text-[12px] text-text-dim">{fmtShort(sorted[0])}</span>
      return <span className="text-[12px] text-text-dim">{fmtShort(sorted[0])} - {fmtShort(sorted[sorted.length - 1])}</span>
    }
    case 'start_date': {
      const dates = tasks.map(t => t.start_date).filter(Boolean) as string[]
      if (!dates.length) return null
      const sorted = dates.sort()
      if (sorted.length === 1) return <span className="text-[12px] text-text-dim">{fmtShort(sorted[0])}</span>
      return <span className="text-[12px] text-text-dim">{fmtShort(sorted[0])} - {fmtShort(sorted[sorted.length - 1])}</span>
    }
    case 'priority': {
      const counts: Record<string, number> = {}
      for (const t of tasks) {
        counts[t.priority] = (counts[t.priority] || 0) + 1
      }
      const pOrder = ['urgent', 'high', 'medium', 'low']
      const items = pOrder.filter(p => counts[p]).map(p => (
        <span key={p} className="inline-flex items-center gap-0.5">
          <PriorityIcon priority={p} size={10} />
          <span style={{ color: priorityColor(p) }}>{counts[p]}</span>
        </span>
      ))
      return <span className="inline-flex items-center gap-1.5 text-[12px]">{items}</span>
    }
    case 'stage': {
      const unique = new Set(tasks.map(t => t.stage_name).filter(Boolean))
      return <span className="text-[12px] text-text-dim">{unique.size} stage{unique.size !== 1 ? 's' : ''}</span>
    }
    case 'status': {
      const unique = new Set(tasks.map(t => t.status).filter(Boolean))
      return <span className="text-[12px] text-text-dim">{unique.size} status{unique.size !== 1 ? 'es' : ''}</span>
    }
    case 'labels': {
      const allLabels = new Set<string>()
      for (const t of tasks) {
        if (t.labels) {
          safeParseLabels(t.labels).forEach(l => allLabels.add(l))
        }
      }
      return <span className="text-[12px] text-text-dim">{allLabels.size} label{allLabels.size !== 1 ? 's' : ''}</span>
    }
    case 'project': {
      const unique = new Set(tasks.map(t => t.project_name).filter(Boolean))
      if (unique.size === 1) return <span className="text-[12px] text-text-dim truncate">{[...unique][0]}</span>
      return <span className="text-[12px] text-text-dim">{unique.size} project{unique.size !== 1 ? 's' : ''}</span>
    }
    case 'workspace': {
      const unique = new Set(tasks.map(t => t.workspace_id).filter(Boolean))
      return <span className="text-[12px] text-text-dim">{unique.size} workspace{unique.size !== 1 ? 's' : ''}</span>
    }
    default:
      return null
  }
}

// ─── Inline Add Task ───

function AddTaskInline({ groupIndent, projectId, stageId, workspaceId, onCreated, adding, setAdding }: {
  groupIndent: number; projectId: number | null; stageId: number | null; workspaceId: number
  onCreated: (task: EnrichedTask) => void; adding: boolean; setAdding: (v: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  if (!adding) {
    return (
      <button onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 50) }}
        className="add-task-ghost w-full flex items-center gap-1.5 transition-colors"
        style={{ paddingLeft: 12 + 14 + 4 + groupIndent + 4, height: 36 }}>
        <span className="add-task-ghost-icon shrink-0"><IconPlus size={12} /></span>
        Add task
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1" style={{ paddingLeft: 12, height: 36 }}>
      {/* Checkbox spacer */}
      <span className="w-[14px] shrink-0" />
      {/* Group indent spacer */}
      <div style={{ width: groupIndent }} className="shrink-0" />
      {/* Row number spacer */}
      <span className="w-6 shrink-0" />
      {/* Status icon matching task row */}
      <StatusIcon status="todo" size={18} />
      <input ref={inputRef} autoFocus placeholder="Task name..."
        className="flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-dim"
        onKeyDown={async (e) => {
          if (e.key === 'Enter') {
            const title = e.currentTarget.value.trim()
            if (!title) { setAdding(false); return }
            const res = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, workspace_id: workspaceId, project_id: projectId, stage_id: stageId, auto_schedule: 1 }),
            })
            const data = await res.json()
            if (data.task) onCreated(data.task)
            setAdding(false)
          }
          if (e.key === 'Escape') setAdding(false)
        }}
        onBlur={() => setAdding(false)}
      />
      {/* Submit arrow + Cancel X */}
      <button onMouseDown={(e) => { e.preventDefault() }} onClick={() => {
        const inp = inputRef.current
        if (inp) {
          const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
          inp.dispatchEvent(ev)
        }
      }} className="text-text-dim hover:text-text transition-colors shrink-0">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button onMouseDown={(e) => { e.preventDefault(); setAdding(false) }} className="text-text-dim hover:text-text transition-colors shrink-0">
        <IconX size={14} strokeWidth={1.3} />
      </button>
    </div>
  )
}

// ─── Editable cells ───

function EditableCell({ isEditing, onStartEdit, className, children, field }: {
  isEditing: boolean; onStartEdit: () => void; className: string; children: React.ReactNode; field?: string
}) {
  return (
    <td className={`${className} text-center px-2 py-2 cursor-pointer transition-colors ${isEditing ? 'bg-elevated/50' : 'hover:bg-hover/30'} relative`}
      style={{ whiteSpace: 'nowrap', height: 36 }}
      onClick={() => { if (!isEditing) onStartEdit() }}>
      {children}
    </td>
  )
}

function EditableText({ value, onSave, onCancel }: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.select() }, [])
  return (
    <input ref={ref} autoFocus defaultValue={value}
      className="flex-1 bg-elevated border border-accent rounded px-1 py-0.5 text-[13px] text-text outline-none min-w-0"
      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== value) onSave(v); else onCancel() }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') onCancel() }} />
  )
}


// ─── Date Picker ───

// ─── Label Picker ───

function LabelPickerDropdown({ taskLabels, allLabels, onToggle, onCreate, onClose }: {
  taskLabels: string[]
  allLabels: Label[]
  onToggle: (labelName: string, add: boolean) => void
  onCreate: (name: string, color: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)])

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const filtered = allLabels.filter(l => l.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div ref={ref} className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 w-[260px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
      {/* Filter input */}
      <div className="px-3 py-2 border-b border-border">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
          className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim"
        />
      </div>

      {/* Labels list */}
      <div className="max-h-[280px] overflow-y-auto py-1">
        {filtered.map(label => {
          const isActive = taskLabels.includes(label.name)
          return (
            <button
              key={label.id}
              onClick={() => onToggle(label.name, !isActive)}
              className="flex items-center gap-2 w-full px-2.5 py-1 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              {/* Checkbox */}
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border-[1.5px] shrink-0 transition-colors ${isActive ? 'border-white bg-white/20' : 'border-text-dim/40'}`}>
                {isActive && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              {/* Label pill */}
              <LabelChip name={label.name} color={label.color} size="md" />
            </button>
          )
        })}
        {filtered.length === 0 && !adding && (
          <div className="px-3 py-3 text-[12px] text-text-dim text-center">No labels found</div>
        )}
      </div>

      {/* Add label */}
      <div className="border-t border-border">
        {adding ? (
          <div className="px-3 py-2 space-y-2">
            <input
              type="text"
              placeholder="Label name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              className="w-full bg-card border border-border rounded px-2 py-1 text-[13px] text-text outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  onCreate(newName.trim(), newColor)
                  setNewName('')
                  setAdding(false)
                }
                if (e.key === 'Escape') setAdding(false)
              }}
            />
            <div className="flex gap-1.5 flex-wrap">
              {LABEL_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`h-5 w-5 rounded-full transition-all ${newColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-card scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { if (newName.trim()) { onCreate(newName.trim(), newColor); setNewName(''); setAdding(false) } }}
                className="flex-1 px-2 py-1 rounded bg-accent text-white text-[12px] font-medium hover:bg-accent/80"
              >
                Create
              </button>
              <button onClick={() => setAdding(false)} className="px-2 py-1 rounded text-[12px] text-text-dim hover:bg-hover">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 w-full px-2.5 py-1 text-[12px] text-text-dim hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <IconPlus size={12} />
            Add label
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Label Filter Dropdown (multi-select) ───

function LabelFilterDropdown({ allLabels, selected, onChange }: {
  allLabels: { id: number; name: string; color: string }[]
  selected: string[]
  onChange: (labels: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggle(name: string) {
    if (selected.includes(name)) onChange(selected.filter(l => l !== name))
    else onChange([...selected, name])
  }

  const hasSelection = selected.length > 0

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`h-7 rounded-md border px-2 text-[13px] outline-none flex items-center gap-1.5 ${
          hasSelection ? 'border-text-dim bg-[rgba(255,255,255,0.06)] text-text font-medium' : 'border-border bg-elevated text-text'
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" /><circle cx="11" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" /></svg>
        {hasSelection ? `${selected.length} label${selected.length > 1 ? 's' : ''}` : 'Labels'}
        {hasSelection && (
          <button
            onClick={(e) => { e.stopPropagation(); onChange([]) }}
            className="ml-0.5 hover:text-text"
          >
            <IconX size={10} strokeWidth={1.3} />
          </button>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 rounded-lg border border-border glass-elevated animate-glass-in shadow-xl py-1 z-50 max-h-60 overflow-y-auto">
          {allLabels.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-text-dim">No labels yet</div>
          )}
          {allLabels.map(l => (
            <button
              key={l.id}
              onClick={() => toggle(l.name)}
              className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              <span className="h-3 w-3 rounded border flex items-center justify-center shrink-0" style={{ borderColor: l.color, background: selected.includes(l.name) ? l.color : 'transparent' }}>
                {selected.includes(l.name) && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4l2 2L6.5 2" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </span>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: l.color }} />
              <span className="truncate">{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Other components ───

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  const active = checked || indeterminate
  return (
    <button type="button" onClick={onChange} className="w-[14px] h-[14px] rounded-[3px] flex items-center justify-center shrink-0 border transition-colors cursor-pointer" style={{ borderColor: active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)', background: active ? 'rgba(255,255,255,0.12)' : 'transparent' }}>
      {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>}
      {indeterminate && !checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="3" strokeLinecap="round"><path d="M5 12h14"/></svg>}
    </button>
  )
}


function BulkActionBar({ count, onClear, onUpdate, onDelete, projects, bulkField, setBulkField }: {
  count: number; onClear: () => void; onUpdate: (f: string, v: unknown) => void; onDelete: () => void
  projects: Project[]; bulkField: string | null; setBulkField: (f: string | null) => void
}) {
  const teamMembers = useTeamMembers()
  return (
    <div className="border-b border-border bg-card px-4 py-2 flex items-center gap-3 z-50 shadow-lg">
      <button onClick={onClear} className="text-text-dim hover:text-text transition-colors p-0.5 rounded hover:bg-hover" title="Deselect all">
        <IconX size={14} />
      </button>
      <span className="text-[14px] font-medium text-text">{count} selected</span>
      <div className="h-4 w-px bg-border mx-1" />
      <Dropdown value="" onChange={(v) => { onUpdate('status', v); setBulkField(null) }} placeholder="Status" options={Object.entries(statusConfig).map(([k, v]) => ({ value: k, label: v.label }))} renderOption={renderStatusOption} triggerClassName="text-[13px] px-2.5 py-1 rounded border border-border text-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-text cursor-pointer transition-colors" minWidth={150} />
      <Dropdown value="" onChange={(v) => { onUpdate('priority', v); setBulkField(null) }} placeholder="Priority" options={SHARED_PRIORITY.map(p => ({ value: p.value, label: p.label, icon: <PriorityIcon priority={p.value} size={12} /> }))} triggerClassName="text-[13px] px-2.5 py-1 rounded border border-border text-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-text cursor-pointer transition-colors" minWidth={140} />
      <Dropdown value="" onChange={(v) => { onUpdate('assignee', v || null); setBulkField(null) }} placeholder="Assignee" options={[{ value: '', label: 'Unassigned' }, ...teamMembers.map(m => ({ value: m.id, label: m.name }))]} triggerClassName="text-[13px] px-2.5 py-1 rounded border border-border text-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-text cursor-pointer transition-colors" minWidth={160} />
      <Dropdown value="" onChange={(v) => { onUpdate('project_id', v ? Number(v) : null); setBulkField(null) }} placeholder="Project" options={[{ value: '', label: 'No Project' }, ...projects.map(p => ({ value: String(p.id), label: p.name, color: p.color }))]} triggerClassName="text-[13px] px-2.5 py-1 rounded border border-border text-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-text cursor-pointer transition-colors" minWidth={160} />
      <Dropdown value="" onChange={(v) => { onUpdate('duration_minutes', Number(v)); setBulkField(null) }} placeholder="Duration" options={DURATION_OPTIONS} triggerClassName="text-[13px] px-2.5 py-1 rounded border border-border text-text-secondary hover:bg-[rgba(255,255,255,0.06)] hover:text-text cursor-pointer transition-colors" minWidth={100} />
      <div className="h-4 w-px bg-border mx-1" />
      <button onClick={() => onUpdate('status', 'archived')} className="text-[14px] text-text-dim hover:text-text-secondary px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.06)]">Archive</button>
      <button onClick={onDelete} className="text-[14px] text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10">Delete</button>
    </div>
  )
}


// ─── Column Config Panel ───
function ColumnConfigPanel({ columns, onReorder, onClose }: {
  columns: { key: string; label: string; w: string }[]
  onReorder: (newOrder: string[]) => void
  onClose: () => void
}) {
  const [items, setItems] = useState(columns.map(c => c.key))
  const dragItem = useRef<number | null>(null)
  const dragOver = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const colMap = new Map(COLS.map(c => [c.key, c]))

  const handleDragStart = (idx: number) => { dragItem.current = idx }
  const handleDragEnter = (idx: number) => { dragOver.current = idx }
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOver.current === null) return
    const copy = [...items]
    const [removed] = copy.splice(dragItem.current, 1)
    copy.splice(dragOver.current, 0, removed)
    setItems(copy)
    onReorder(copy)
    dragItem.current = null
    dragOver.current = null
  }

  const moveItem = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= items.length) return
    const copy = [...items]
    ;[copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]]
    setItems(copy)
    onReorder(copy)
  }

  return (
    <div ref={panelRef} className="absolute right-0 top-10 z-50 w-[240px] glass-elevated animate-glass-in border border-border rounded-lg shadow-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[12px] font-medium text-text-secondary uppercase tracking-wider">Column Order</span>
        <button onClick={onClose} className="text-text-dim hover:text-text"><IconX size={12} /></button>
      </div>
      <div className="max-h-[400px] overflow-y-auto py-1">
        {items.map((key, idx) => {
          const col = colMap.get(key)
          if (!col) return null
          return (
            <div
              key={key}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-hover cursor-grab active:cursor-grabbing group"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-text-dim shrink-0">
                <circle cx="3" cy="2" r="1" fill="currentColor" /><circle cx="7" cy="2" r="1" fill="currentColor" />
                <circle cx="3" cy="5" r="1" fill="currentColor" /><circle cx="7" cy="5" r="1" fill="currentColor" />
                <circle cx="3" cy="8" r="1" fill="currentColor" /><circle cx="7" cy="8" r="1" fill="currentColor" />
              </svg>
              <span className="text-[13px] text-text-secondary flex-1">{col.label}</span>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                  className="p-0.5 text-text-dim hover:text-text disabled:opacity-20">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 6l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </button>
                <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1}
                  className="p-0.5 text-text-dim hover:text-text disabled:opacity-20">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Group By Panel ───

function GroupByPanel({ groupBy, hideEmptyGroups, onChange, onToggleHideEmpty, onClose }: {
  groupBy: GroupLevel[]; hideEmptyGroups: boolean
  onChange: (g: GroupLevel[]) => void; onToggleHideEmpty: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const [dropFilter, setDropFilter] = useState('')

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const allLevels: GroupLevel[] = ['workspace', 'project', 'stage', 'folder', 'assignee', 'status', 'priority', 'label', 'due_date', 'start_date', 'created_at', 'updated_at', 'completed_at']
  const available = allLevels.filter(l => !groupBy.includes(l))

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 w-[300px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[13px] font-medium text-text">Groups</span>
        <button onClick={() => onChange(['workspace', 'project', 'stage'])} className="text-[13px] text-text-dim hover:text-text-secondary">Reset</button>
      </div>

      {/* Group level dropdowns */}
      <div className="px-4 space-y-2 pb-3">
        {groupBy.map((level, idx) => (
          <div key={idx} className="relative">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <button
                  onClick={() => setOpenDropdown(openDropdown === idx ? null : idx)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-card border border-border text-[13px] text-text hover:border-border-strong transition-colors"
                >
                  <span>{GROUP_LEVEL_LABELS[level]}</span>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-text-dim"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {openDropdown === idx && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl z-50 max-h-[320px] overflow-hidden flex flex-col">
                    <input
                      autoFocus
                      placeholder="Filter..."
                      value={dropFilter}
                      onChange={(e) => setDropFilter(e.target.value)}
                      className="mx-2 mt-2 mb-1 px-2 py-1.5 rounded bg-card border border-border text-[13px] text-text outline-none placeholder:text-text-dim focus:border-accent"
                    />
                    <div className="px-3 py-1 text-[10px] text-text-dim font-medium uppercase tracking-wider">Fields</div>
                    <div className="overflow-y-auto flex-1 pb-1">
                      {allLevels.filter(l => l === level || !groupBy.includes(l)).filter(l => !dropFilter || GROUP_LEVEL_LABELS[l].toLowerCase().includes(dropFilter.toLowerCase())).map(l => (
                        <button
                          key={l}
                          onClick={() => {
                            const next = [...groupBy]
                            next[idx] = l
                            onChange(next)
                            setOpenDropdown(null)
                            setDropFilter('')
                          }}
                          className={`flex items-center justify-between w-full px-3 py-2 text-[14px] ${l === level ? 'text-text font-medium' : 'text-text-secondary hover:bg-[rgba(255,255,255,0.06)]'}`}
                        >
                          <span>{GROUP_LEVEL_LABELS[l]}</span>
                          {l === level && <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3L12 4" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {groupBy.length > 1 && (
                <button onClick={() => onChange(groupBy.filter((_, i) => i !== idx))} className="text-text-dim hover:text-red-400 shrink-0 p-1">
                  <IconX size={12} strokeWidth={1.3} />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Add nested row */}
        {available.length > 0 && (
          <button
            onClick={() => onChange([...groupBy, available[0]])}
            className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-text-dim hover:text-text-secondary transition-colors"
          >
            <IconPlus size={12} strokeWidth={1.3} />
            Add nested row
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Data section */}
      <div className="px-4 py-3">
        <span className="text-[13px] font-medium text-text-dim block mb-2">Data</span>
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-card border border-border text-[13px] text-text">
          <span>Task</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-text-dim"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Hide empty groups */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[13px] text-text">Hide empty groups</span>
        <button
          onClick={onToggleHideEmpty}
          className={`w-10 h-5 rounded-full transition-colors relative ${hideEmptyGroups ? 'bg-accent' : 'bg-border-strong'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${hideEmptyGroups ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
        </button>
      </div>
    </div>
  )
}

// ─── Sort Panel ───

function SortPanel({ sortBy, sortDir, onChange, onClose }: {
  sortBy: SortField; sortDir: 'asc' | 'desc'; onChange: (s: SortField, d: 'asc' | 'desc') => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 w-[200px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl z-50 py-1">
      {SORT_OPTIONS.map(opt => (
        <button key={opt.value} onClick={() => {
          if (sortBy === opt.value) onChange(opt.value, sortDir === 'asc' ? 'desc' : 'asc')
          else onChange(opt.value, 'asc')
        }} className={`flex items-center gap-2 w-full px-2.5 py-1 text-[13px] ${sortBy === opt.value ? 'text-text font-medium' : 'text-text-secondary hover:bg-[rgba(255,255,255,0.06)]'}`}>
          <span className="flex-1 text-left">{opt.label}</span>
          {sortBy === opt.value && (
            <span className="text-text-dim text-[10px]">{sortDir === 'asc' ? 'ASC' : 'DESC'}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── New View Modal ───

function NewViewModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, type: string) => void }) {
  const [name, setName] = useState('')
  const [viewType, setViewType] = useState('list')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const viewTypes = [
    { value: 'list', label: 'List', desc: 'Table view with sortable columns' },
    { value: 'kanban', label: 'Kanban', desc: 'Board with draggable cards' },
    { value: 'gantt', label: 'Gantt', desc: 'Timeline with task bars' },
    { value: 'dashboard', label: 'Dashboard', desc: 'Stats cards and charts' },
    { value: 'workload', label: 'Workload', desc: 'Weekly capacity by assignee' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div ref={ref} className="w-[400px] rounded-xl border border-border-strong glass-elevated animate-glass-in shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[14px] font-semibold text-text">New View</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text"><IconX size={14} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[12px] text-text-dim font-medium uppercase tracking-wider block mb-1.5">View name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Tasks, Sprint Board..."
              className="w-full h-8 rounded-md border border-border bg-elevated px-3 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[12px] text-text-dim font-medium uppercase tracking-wider block mb-2">View type</label>
            <div className="grid grid-cols-2 gap-2">
              {viewTypes.map(vt => (
                <button
                  key={vt.value}
                  onClick={() => setViewType(vt.value)}
                  className={`flex flex-col items-start gap-1 p-3 rounded-lg border transition-colors ${
                    viewType === vt.value
                      ? 'border-accent bg-accent/10 text-text'
                      : 'border-border hover:border-border-strong text-text-secondary hover:bg-hover/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {VIEW_TYPE_ICONS[vt.value]}
                    <span className="text-[13px] font-medium">{vt.label}</span>
                  </div>
                  <span className="text-[10px] text-text-dim">{vt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-[13px] text-text-dim hover:text-text-secondary border border-border hover:bg-hover/30">Cancel</button>
          <button
            onClick={() => { if (name.trim()) onCreate(name.trim(), viewType) }}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
            disabled={!name.trim()}
          >Create</button>
        </div>
      </div>
    </div>
  )
}

// ─── View Manager Panel ───

function ViewManagerPanel({ views, activeViewId, onSwitch, onDelete, onRename, onNewView, onClose }: {
  views: View[]; activeViewId: number | null
  onSwitch: (id: number) => void; onDelete: (id: number) => void
  onRename: (id: number) => void; onNewView: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="absolute right-4 top-[90px] w-[280px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl z-50">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-[13px] font-medium text-text">Manage Views</span>
        <button onClick={onClose} className="text-text-dim hover:text-text">
          <IconX size={12} strokeWidth={1.3} />
        </button>
      </div>
      <div className="py-1 max-h-[300px] overflow-y-auto">
        {views.map(v => (
          <div key={v.id} className={`flex items-center gap-2 px-3 py-2 group hover:bg-hover/30 cursor-pointer ${activeViewId === v.id ? 'bg-accent/5' : ''}`}
            onClick={() => { onSwitch(v.id); onClose() }}>
            <span className="text-text-dim">{VIEW_TYPE_ICONS[v.view_type] || VIEW_TYPE_ICONS.list}</span>
            <span className="text-[13px] text-text flex-1 truncate">{v.name}</span>
            {activeViewId === v.id && <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />}
            <button onClick={(e) => { e.stopPropagation(); onRename(v.id) }} className="text-text-dim hover:text-text opacity-0 group-hover:opacity-100" title="Rename">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2v-2l6.5-6.5z" stroke="currentColor" strokeWidth="1.2" /></svg>
            </button>
            {views.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(v.id) }} className="text-text-dim hover:text-red-400 opacity-0 group-hover:opacity-100" title="Delete">
                <IconX size={10} strokeWidth={1.2} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border px-3 py-2">
        <button onClick={onNewView} className="flex items-center gap-1.5 text-[13px] text-accent-text hover:text-accent-text/80">
          <IconPlus size={10} />
          New View
        </button>
      </div>
    </div>
  )
}

// ─── Auto-schedule toggle icon (rocket) ───

function AutoScheduleIcon({ active, size = 16 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={active ? 'text-accent-text' : 'text-text-dim'}>
      <path d="M12.5 2.5c-1.5 0-4 1-5.5 3L5 6.5 2.5 8l2 1L3 10.5l2.5 2.5L7 11.5l1 2L9.5 11l1-2c2-1.5 3-4 3-5.5l-1-1z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.2 : 0} />
      <circle cx="10" cy="6" r="1" fill="currentColor" />
    </svg>
  )
}

// ─── Kanban Board ───

function KanbanBoard({ kanbanData, kanbanNav, setKanbanNav, workspaces, allLabels, updateTask, setTasks, setSelectedTaskId, editingCell, setEditingCell, onTaskContextMenu }: {
  kanbanData: {
    navTabs: { level: GroupLevel; items: { id: string; name: string; color: string; count: number }[]; selected: string | null }[]
    columns: { id: string | number | null; name: string; color: string; tasks: EnrichedTask[] }[]
    columnLevel: GroupLevel
    filteredCount: number
  }
  kanbanNav: Record<string, string | null>
  setKanbanNav: React.Dispatch<React.SetStateAction<Record<string, string | null>>>
  workspaces: Workspace[]
  allLabels: Label[]
  updateTask: (id: number, field: string, value: unknown) => Promise<void>
  setTasks: React.Dispatch<React.SetStateAction<EnrichedTask[]>>
  setSelectedTaskId: (id: number | null) => void
  editingCell: { taskId: number; field: string } | null
  setEditingCell: (c: { taskId: number; field: string } | null) => void
  onTaskContextMenu?: (e: React.MouseEvent, task: EnrichedTask) => void
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  const { navTabs, columns, columnLevel } = kanbanData

  function fieldForLevel(level: GroupLevel): string {
    switch (level) {
      case 'stage': return 'stage_id'
      case 'status': return 'status'
      case 'priority': return 'priority'
      case 'assignee': return 'assignee'
      case 'project': return 'project_id'
      case 'workspace': return 'workspace_id'
      case 'folder': return 'folder_id'
      case 'label': return 'labels'
      case 'due_date': return 'due_date'
      case 'start_date': return 'start_date'
      case 'created_at': return 'created_at'
      case 'updated_at': return 'updated_at'
      case 'completed_at': return 'completed_at'
    }
  }

  function handleDragStart(e: React.DragEvent, taskId: number) {
    setDraggedTaskId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(taskId))
    // Position ghost at cursor instead of top-left corner
    if (e.currentTarget instanceof HTMLElement) {
      const rect = e.currentTarget.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const offsetY = e.clientY - rect.top
      e.dataTransfer.setDragImage(e.currentTarget, offsetX, offsetY)
      e.currentTarget.style.opacity = '0.5'
    }
  }

  function handleDragEnd(e: React.DragEvent) {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1'
    setDraggedTaskId(null)
    setDragOverCol(null)
  }

  function handleDrop(e: React.DragEvent, colId: string | number | null) {
    e.preventDefault()
    if (draggedTaskId === null) return

    const field = fieldForLevel(columnLevel)
    let value: unknown = colId
    if ((field === 'assignee' && colId === 'unassigned') || colId === 'none') value = null

    updateTask(draggedTaskId, field, value)
    setDraggedTaskId(null)
    setDragOverCol(null)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Navigation tab rows - one row per hierarchy level above columns */}
      {navTabs.map(nav => (
        <div key={nav.level} className="flex items-center gap-1.5 px-4 py-2 border-b border-border/30 overflow-x-auto scrollbar-none shrink-0">
          {nav.items.map(item => {
            const isSelected = nav.selected === item.id
            return (
              <button
                key={item.id}
                onClick={() => {
                  setKanbanNav(prev => ({
                    ...prev,
                    [nav.level]: prev[nav.level] === item.id ? null : item.id,
                  }))
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors shrink-0 ${
                  isSelected
                    ? 'bg-hover/60 text-text border border-border-strong'
                    : 'text-text-dim hover:text-text-secondary hover:bg-hover/30 border border-transparent'
                }`}
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="truncate max-w-[160px]">{item.name}</span>
                <span className="text-[10px] text-text-dim">{item.count}</span>
              </button>
            )
          })}
        </div>
      ))}

      {/* Kanban columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-4 h-full min-w-max">
          {columns.map(col => {
            const colKey = String(col.id ?? 'none')
            const isOver = dragOverCol === colKey && draggedTaskId !== null
            return (
              <div
                key={colKey}
                className={`flex flex-col w-[320px] shrink-0 rounded-lg transition-colors ${isOver ? 'bg-accent/5' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCol(colKey) }}
                onDragLeave={() => { if (dragOverCol === colKey) setDragOverCol(null) }}
                onDrop={(e) => handleDrop(e, col.id)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                    <span className="text-[13px] font-medium text-text">{col.name}</span>
                    <span className="text-[12px] text-text-dim">{col.tasks.length}</span>
                  </div>
                  <button
                    onClick={async () => {
                      const title = 'New Task'
                      const body: Record<string, unknown> = { title, workspace_id: workspaces[0]?.id }
                      const field = fieldForLevel(columnLevel)
                      if (col.id !== null && colKey !== 'none' && colKey !== 'unassigned') body[field] = col.id
                      // Also set values from the nav selections
                      for (const nav of navTabs) {
                        if (nav.selected) {
                          const navField = fieldForLevel(nav.level)
                          body[navField] = nav.selected === 'none' || nav.selected === 'unassigned' ? null : (isNaN(Number(nav.selected)) ? nav.selected : Number(nav.selected))
                        }
                      }
                      const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                      const data = await res.json()
                      if (data.task) setTasks(prev => [...prev, data.task])
                    }}
                    className="text-text-dim hover:text-text-secondary transition-colors"
                  >
                    <IconPlus size={14} />
                  </button>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto space-y-2 px-1 pb-4 scrollbar-thin">
                  {col.tasks.map(task => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      allLabels={allLabels}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      isDragging={draggedTaskId === task.id}
                      updateTask={updateTask}
                      setSelectedTaskId={setSelectedTaskId}
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      onContextMenu={onTaskContextMenu ? (e) => onTaskContextMenu(e, task) : undefined}
                    />
                  ))}
                  {col.tasks.length === 0 && (
                    <div className={`text-center py-8 text-[12px] text-text-dim rounded-lg border-2 border-dashed transition-colors ${isOver ? 'border-accent/40 text-accent-text' : 'border-transparent'}`}>
                      {isOver ? 'Drop here' : 'No tasks'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Kanban Card ───

function KanbanCard({ task, allLabels, onDragStart, onDragEnd, isDragging, updateTask, setSelectedTaskId, editingCell, setEditingCell, onContextMenu }: {
  task: EnrichedTask
  allLabels: Label[]
  onDragStart: (e: React.DragEvent, id: number) => void
  onDragEnd: (e: React.DragEvent) => void
  isDragging: boolean
  updateTask: (id: number, field: string, value: unknown) => Promise<void>
  setSelectedTaskId: (id: number | null) => void
  editingCell: { taskId: number; field: string } | null
  setEditingCell: (c: { taskId: number; field: string } | null) => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const priority = priorityConfig[task.priority] || priorityConfig.medium
  const teamMembers = useTeamMembers()
  const assigneeColors = useMemo(() => Object.fromEntries(teamMembers.map(m => [m.id, m.color])), [teamMembers])
  const status = statusConfig[task.status] || statusConfig.todo
  const isEditingStatus = editingCell?.taskId === task.id && editingCell?.field === 'kanban_status'
  const isAddingLabel = editingCell?.taskId === task.id && editingCell?.field === 'kanban_label'
  const labels: string[] = safeParseLabels(task.labels)

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={onDragEnd}
      onContextMenu={onContextMenu}
      className={`glass border border-border rounded-lg cursor-grab active:cursor-grabbing transition-all ${isDragging ? 'opacity-40 scale-95' : 'hover:border-border-strong'}`}
    >
      {/* Row 1: Project breadcrumb + priority flag */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: task.project_color || '#7a6b55' }}>
            <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] text-text-dim truncate">
            {task.project_name ? `${task.project_name} | ${task.workspace_name || ''}` : task.workspace_name || ''}
          </span>
        </div>
        <PriorityIcon priority={task.priority} size={10} />
      </div>

      {/* Row 2: Priority flag + Status circle + Status label ... Auto-schedule toggle */}
      <div className="flex items-center justify-between px-3 py-1">
        <div className="flex items-center gap-1.5">
          <PriorityIcon priority={task.priority} size={12} />
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, field: 'kanban_status' }) }}
              className="flex items-center justify-center hover:scale-110 transition-transform"
            >
              <StatusIcon status={task.status} size={16} />
            </button>
            {isEditingStatus && (
              <StatusPickerDropdown
                current={task.status}
                onSelect={(s) => updateTask(task.id, 'status', s)}
                onClose={() => setEditingCell(null)}
              />
            )}
          </div>
          <span className="text-[12px]" style={{ color: status.color }}>{status.label}</span>
        </div>
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <AutoScheduleToggle
            active={!!task.auto_schedule}
            onChange={() => updateTask(task.id, 'auto_schedule', task.auto_schedule ? 0 : 1)}
            scheduledDate={task.scheduled_start}
          />
        </div>
      </div>

      {/* Row 3: Title */}
      <div
        className={`px-3 py-1.5 text-[14px] font-semibold leading-snug ${task.status === 'done' ? 'text-text-dim' : 'text-text'}`}
        onClick={() => setSelectedTaskId(task.id)}
      >
        {task.title}
      </div>

      {/* Row 4: Duration + Deadline + Assignee */}
      <div className="flex items-center gap-3 px-3 py-1.5 text-[12px] text-text-dim">
        <span>{task.completed_time_minutes || 0}m of {task.duration_minutes || 0}m</span>
        <span>{task.due_date ? fmtDate(task.due_date) : 'None'}</span>
        {task.assignee && (
          <span className="ml-auto flex items-center gap-1.5">
            {(() => { const m = findAssignee(task.assignee, teamMembers); return <Avatar name={m?.name || task.assignee} size={18} src={m?.avatar} color={m?.color || assigneeColors[task.assignee]} /> })()}
            <span className="text-text-secondary">
              {findAssignee(task.assignee, teamMembers)?.name || task.assignee.charAt(0).toUpperCase() + task.assignee.slice(1)}
            </span>
          </span>
        )}
      </div>

      {/* Row 5: Labels + Add label */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2.5">
        {labels.map(l => {
          const def = allLabels.find(al => al.name === l)
          return <LabelChip key={l} name={l} color={def?.color || '#8c8c8c'} size="sm" />
        })}
        {isAddingLabel ? (
          <input
            autoFocus
            placeholder="Label..."
            className="bg-elevated border border-accent rounded px-1.5 py-0.5 text-[10px] text-text outline-none w-20"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v) {
                const next = [...labels, v]
                updateTask(task.id, 'labels', JSON.stringify(next))
              }
              setEditingCell(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditingCell(null)
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, field: 'kanban_label' }) }}
            className="flex items-center gap-0.5 text-[10px] text-text-dim hover:text-text-secondary transition-colors"
          >
            <IconPlus size={8} strokeWidth={1.2} />
            Add label
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Navigate View (mirrors sidebar tree in main content) ───

interface NavTreeNode {
  id: string
  public_id?: string
  type: 'workspace' | 'folder' | 'project' | 'doc' | 'database'
  name: string
  color: string
  itemCount: number
  children: NavTreeNode[]
  data: Record<string, unknown>
}

function NavTreeItem({ node, depth, collapsed, toggleCollapse, onOpenProject }: {
  node: NavTreeNode; depth: number; collapsed: Set<string>; toggleCollapse: (k: string) => void; onOpenProject: (id: number) => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const isOpen = !collapsed.has(`nav-${node.id}`)
  const hasChildren = node.children.length > 0
  const isFolder = node.type === 'folder'
  const isProject = node.type === 'project'
  const isDoc = node.type === 'doc'
  const isDatabase = node.type === 'database'
  const indent = 12 + depth * 20

  function handleClick() {
    if (isFolder || isProject || (hasChildren)) {
      toggleCollapse(`nav-${node.id}`)
    }
    if (isProject) {
      const numId = parseInt(node.id.replace('project-', ''))
      if (!isNaN(numId)) onOpenProject(numId)
    }
    if (isDoc) {
      if (node.public_id) window.location.href = `/doc/${node.public_id}`
      else {
        const numId = parseInt(node.id.replace('doc-', ''))
        if (!isNaN(numId)) window.location.href = `/doc/${numId}`
      }
    }
    if (isDatabase) {
      if (node.public_id) window.location.href = `/database/${node.public_id}`
      else {
        const numId = parseInt(node.id.replace('database-', ''))
        if (!isNaN(numId)) window.location.href = `/database/${numId}`
      }
    }
  }

  return (
    <div>
      <div
        className="group flex items-center rounded-md hover:bg-hover/40 transition-colors cursor-pointer"
        style={{ paddingLeft: indent }}
        onClick={handleClick}
      >
        {/* Drag dots (visible on hover) */}
        <span className="shrink-0 w-5 flex items-center justify-center text-transparent group-hover:text-text-dim">
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
          </svg>
        </span>

        <button className="flex flex-1 items-center gap-2 py-2 pr-2 text-left min-w-0">
          {/* Chevron */}
          {hasChildren || isFolder || isProject ? (
            <svg width="10" height="10" viewBox="0 0 8 10" className={`shrink-0 transition-transform text-text-dim ${isOpen ? 'rotate-90' : ''}`}>
              <path d="M1.5 0.5l5 4.5-5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          ) : (
            <span className="w-[10px] shrink-0" />
          )}

          {/* Icon */}
          <span className="shrink-0" style={{ color: node.color || '#6b7280' }}>
            {isFolder ? (
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" /></svg>
            ) : isProject ? (
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
            ) : isDatabase ? (
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="0.8" opacity="0.5" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" /><path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" /></svg>
            )}
          </span>

          {/* Name */}
          <span className="text-[15px] text-text truncate">{node.name || (isDoc ? 'Untitled Doc' : node.name)}</span>

          {/* Count */}
          {node.itemCount > 0 && <span className="text-[12px] text-text-dim shrink-0 ml-1">{node.itemCount}</span>}
        </button>

        {/* Hover menu */}
        <span className="hidden group-hover:flex items-center gap-0.5 shrink-0 mr-2 relative">
          <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }} className="flex h-6 w-6 items-center justify-center rounded text-text-dim hover:text-text hover:bg-border/50">
            <IconMoreHorizontal size={18} />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-[100]" onClick={(e) => { e.stopPropagation(); setShowMenu(false) }} />
              <div className="absolute right-0 top-7 z-[101] bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
                {isProject && (
                  <button onClick={(e) => { e.stopPropagation(); setShowMenu(false); onOpenProject(Number(node.id)) }}
                    className="w-full text-left px-2.5 py-1 text-[13px] text-text hover:bg-hover">
                    Open project
                  </button>
                )}
                <button onClick={async (e) => {
                  e.stopPropagation(); setShowMenu(false)
                  const newName = prompt('Rename:', node.name)
                  if (newName && newName !== node.name) {
                    const type = isProject ? 'projects' : isDoc ? 'docs' : isFolder ? 'folders' : null
                    if (type) {
                      await fetch(`/api/${type}/${node.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, title: newName }) })
                      window.location.reload()
                    }
                  }
                }} className="w-full text-left px-2.5 py-1 text-[13px] text-text hover:bg-hover">
                  Rename
                </button>
                <button onClick={async (e) => {
                  e.stopPropagation(); setShowMenu(false)
                  if (confirm(`Delete "${node.name}"?`)) {
                    const type = isProject ? 'projects' : isDoc ? 'docs' : isFolder ? 'folders' : null
                    if (type) {
                      await fetch(`/api/${type}/${node.id}`, { method: 'DELETE' })
                      window.location.reload()
                    }
                  }
                }} className="w-full text-left px-2.5 py-1 text-[13px] text-red-400 hover:bg-hover">
                  Delete
                </button>
              </div>
            </>
          )}
        </span>
      </div>

      {/* Children */}
      {isOpen && hasChildren && (
        <div>
          {node.children.map(child => (
            <NavTreeItem key={child.id} node={child} depth={depth + 1} collapsed={collapsed} toggleCollapse={toggleCollapse} onOpenProject={onOpenProject} />
          ))}
          {/* "+ New doc or database" for projects */}
          {isProject && (
            <div
              className="flex items-center gap-2 py-1.5 text-text-dim hover:text-text-secondary cursor-pointer transition-colors"
              style={{ paddingLeft: 12 + (depth + 1) * 20 + 15 }}
              onClick={(e) => {
                e.stopPropagation()
                const numId = parseInt(node.id.replace('project-', ''))
                if (!isNaN(numId)) {
                  fetch('/api/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: numId, title: 'Untitled Doc' }) })
                    .then(r => r.json())
                    .then(d => { if (d.public_id) window.location.href = `/doc/${d.public_id}`; else if (d.id) window.location.href = `/doc/${d.id}` })
                }
              }}
            >
              <IconPlus size={12} />
              <span className="text-[13px]">New doc or database</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NavigateView({ workspaces, tasks, collapsed, toggleCollapse, onOpenProject }: {
  workspaces: Workspace[]; tasks: EnrichedTask[]; collapsed: Set<string>; toggleCollapse: (k: string) => void; onOpenProject: (id: number) => void
}) {
  const [treesData, setTreesData] = useState<Record<number, NavTreeNode[]>>({})

  useEffect(() => {
    workspaces.forEach(ws => {
      fetch(`/api/sidebar?workspaceId=${ws.public_id || ws.id}`)
        .then(r => r.json())
        .then(tree => setTreesData(prev => ({ ...prev, [ws.id]: tree })))
    })
  }, [workspaces])

  return (
    <div className="flex-1 min-h-0 overflow-auto py-2 px-2">
      {workspaces.map(ws => {
        const wsTaskCount = tasks.filter(t => t.workspace_id === ws.id).length
        const isOpen = !collapsed.has(`nav-ws-${ws.id}`)
        const tree = treesData[ws.id] || []
        return (
          <div key={ws.id} className="mb-1">
            {/* Workspace header */}
            <div
              className="group flex items-center gap-2 px-3 py-2 rounded-md hover:bg-hover/30 transition-colors cursor-pointer"
              onClick={() => toggleCollapse(`nav-ws-${ws.id}`)}
            >
              <svg width="10" height="10" viewBox="0 0 8 10" className={`shrink-0 transition-transform text-text-dim ${isOpen ? 'rotate-90' : ''}`}>
                <path d="M1.5 0.5l5 4.5-5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              <span className="h-5 w-5 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: ws.color || '#7a6b55' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 8.5l10 6.5 10-6.5L12 2z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M2 12l10 6.5L22 12" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M2 15.5l10 6.5 10-6.5" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-[16px] font-semibold text-text flex-1">{ws.name}</span>
              <span className="text-[13px] text-text-dim">{wsTaskCount}</span>
            </div>

            {/* Tree items */}
            {isOpen && (
              <div className="ml-3">
                {tree.map(node => (
                  <NavTreeItem key={node.id} node={node} depth={0} collapsed={collapsed} toggleCollapse={toggleCollapse} onOpenProject={onOpenProject} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Gantt View ───

function GanttView({ ganttData, collapsed, toggleCollapse, onTaskClick }: {
  ganttData: { rangeStart: Date; rangeEnd: Date; weeks: Date[]; groups: { type: 'workspace' | 'project'; id: number; name: string; color: string; count: number; tasks: EnrichedTask[] }[]; now: Date }
  collapsed: Set<string>
  toggleCollapse: (key: string) => void
  onTaskClick: (id: number) => void
}) {
  const { weeks, groups, now, rangeStart, rangeEnd } = ganttData
  const totalDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24))
  const dayWidth = 40
  const totalWidth = totalDays * dayWidth
  const rowHeight = 36
  const headerHeight = 56
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll to today on mount
  useEffect(() => {
    if (scrollRef.current) {
      const todayOffset = Math.floor((now.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth
      scrollRef.current.scrollLeft = Math.max(0, todayOffset - 400)
    }
  }, [now, rangeStart, dayWidth])

  const todayOffset = Math.floor((now.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth

  // Build visible rows
  const visibleRows: { type: 'workspace' | 'project' | 'task'; item: { id: number; name: string; color: string; count?: number }; task?: EnrichedTask; key: string }[] = []
  for (const g of groups) {
    const gKey = `gantt-${g.type}-${g.id}`
    visibleRows.push({ type: g.type, item: { id: g.id, name: g.name, color: g.color, count: g.count }, key: gKey })
    if (g.type === 'project' && !collapsed.has(gKey)) {
      for (const t of g.tasks) {
        visibleRows.push({ type: 'task', item: { id: t.id, name: t.title, color: t.project_color || g.color }, task: t, key: `gantt-task-${t.id}` })
      }
    }
  }

  // Generate month headers
  const months: { label: string; left: number; width: number }[] = []
  let mCursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  while (mCursor < rangeEnd) {
    const mStart = Math.max(0, Math.floor((mCursor.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)))
    const mEnd = new Date(mCursor.getFullYear(), mCursor.getMonth() + 1, 0)
    const mEndDay = Math.min(totalDays, Math.ceil((mEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)))
    months.push({
      label: mCursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      left: mStart * dayWidth,
      width: (mEndDay - mStart) * dayWidth,
    })
    mCursor = new Date(mCursor.getFullYear(), mCursor.getMonth() + 1, 1)
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar - row labels */}
      <div className="w-[240px] shrink-0 border-r border-border overflow-y-auto bg-card">
        <div className="h-[56px] border-b border-border flex items-end px-3 pb-2">
          <span className="text-[12px] text-text-dim font-medium uppercase tracking-wider">Projects</span>
        </div>
        {visibleRows.map(row => (
          <div key={row.key} className="border-b border-border/20" style={{ height: rowHeight }}>
            <div className="flex items-center gap-2 h-full" style={{ paddingLeft: row.type === 'workspace' ? 12 : row.type === 'project' ? 24 : 44 }}>
              {row.type !== 'task' && (
                <button onClick={() => toggleCollapse(row.key)} className="text-text-dim">
                  <Chevron expanded={!collapsed.has(row.key)} />
                </button>
              )}
              {row.type === 'task' ? (
                <span className="text-[12px] text-text-secondary truncate cursor-pointer hover:text-text" onClick={() => onTaskClick(row.item.id)}>
                  {row.item.name}
                </span>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: row.item.color }} />
                  <span className={`${row.type === 'workspace' ? 'text-[13px] font-semibold text-text' : 'text-[12px] font-medium text-text-secondary'} truncate`}>
                    {row.item.name}
                  </span>
                  <span className="text-[10px] text-text-dim">{row.item.count}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Right - timeline */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ width: totalWidth, position: 'relative' }}>
          {/* Month headers */}
          <div className="sticky top-0 z-10 bg-card border-b border-border" style={{ height: 28 }}>
            {months.map((m, i) => (
              <div key={i} className="absolute top-0 flex items-center px-2 text-[12px] text-text-dim font-medium border-r border-border/30" style={{ left: m.left, width: m.width, height: 28 }}>
                {m.label}
              </div>
            ))}
          </div>
          {/* Week day headers */}
          <div className="sticky top-[28px] z-10 bg-card border-b border-border" style={{ height: 28 }}>
            {weeks.map((w, i) => {
              const left = Math.floor((w.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth
              return (
                <div key={i} className="absolute flex items-center justify-center text-[10px] text-text-dim border-r border-border/20" style={{ left, width: dayWidth * 7, height: 28 }}>
                  {w.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              )
            })}
          </div>

          {/* Today line */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-accent/60 z-[5]" style={{ left: todayOffset }}>
            <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-accent text-white text-[9px] font-bold px-1.5 py-0.5 rounded-b">
              {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
          </div>

          {/* Grid lines (weekly) */}
          {weeks.map((w, i) => {
            const left = Math.floor((w.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth
            return <div key={i} className="absolute top-[56px] bottom-0 border-r border-border/10" style={{ left }} />
          })}

          {/* Rows */}
          <div style={{ paddingTop: headerHeight }}>
            {visibleRows.map(row => {
              if (row.type === 'task' && row.task) {
                const t = row.task
                const startDate = t.start_date ? parseDate(t.start_date) : t.due_date ? parseDate(t.due_date) : null
                const endDate = t.due_date ? parseDate(t.due_date) : startDate ? new Date(startDate.getTime() + (t.duration_minutes || 30) * 60000) : null
                if (!startDate || !endDate) {
                  return <div key={row.key} className="border-b border-border/10" style={{ height: rowHeight }} />
                }
                const left = Math.max(0, Math.floor((startDate.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth)
                const width = Math.max(dayWidth, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth)
                const isOverdue = endDate < now && t.status !== 'done'

                return (
                  <div key={row.key} className="relative border-b border-border/10" style={{ height: rowHeight }}>
                    <div
                      className="absolute top-1.5 rounded cursor-pointer hover:brightness-110 transition-all flex items-center gap-1.5 px-2 overflow-hidden"
                      style={{ left, width: Math.max(60, width), height: rowHeight - 12, backgroundColor: row.item.color + '30', borderLeft: `3px solid ${row.item.color}` }}
                      onClick={() => onTaskClick(t.id)}
                    >
                      <StatusIcon status={t.status} size={12} />
                      <span className={`text-[12px] truncate ${t.status === 'done' ? 'text-text-dim' : 'text-text'}`}>{t.title}</span>
                      {isOverdue && <span className="text-[9px] text-red-400 shrink-0">overdue</span>}
                    </div>
                  </div>
                )
              }
              // Workspace/Project header row
              return <div key={row.key} className="border-b border-border/20" style={{ height: rowHeight }} />
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Workload View ───

function WorkloadView({ tasks }: { tasks: EnrichedTask[] }) {
  const teamMembers = useTeamMembers()
  const ASSIGNEES = useMemo(() => teamMembers.map(m => m.id), [teamMembers])
  const assigneeColors = useMemo(() => Object.fromEntries(teamMembers.map(m => [m.id, m.color])), [teamMembers])
  const [weekOffset, setWeekOffset] = useState(0)

  const weekData = useMemo(() => {
    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1 + weekOffset * 7) // Monday
    startOfWeek.setHours(0, 0, 0, 0)

    const days: { date: Date; label: string; dayLabel: string }[] = []
    for (let i = 0; i < 5; i++) {
      const d = new Date(startOfWeek)
      d.setDate(d.getDate() + i)
      days.push({
        date: d,
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
    }

    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(endOfWeek.getDate() + 6)

    const weekLabel = `${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en-US', { day: 'numeric', year: 'numeric' })}`

    // Group tasks by assignee
    const assigneeMap = new Map<string, { name: string; color: string; totalMinutes: number; capacityMinutes: number; dayMinutes: number[]; dayTaskCounts: number[]; attentionCount: number }>()

    const allAssignees = ASSIGNEES.includes('operator') ? ASSIGNEES : ['operator', ...ASSIGNEES]
    for (const a of allAssignees) {
      const m = teamMembers.find(t => t.id === a)
      assigneeMap.set(a, {
        name: m?.name || a.charAt(0).toUpperCase() + a.slice(1),
        color: m?.color || assigneeColors[a] || '#6b7280',
        totalMinutes: 0,
        capacityMinutes: 40 * 60, // 40h/week
        dayMinutes: [0, 0, 0, 0, 0],
        dayTaskCounts: [0, 0, 0, 0, 0],
        attentionCount: 0,
      })
    }

    for (const t of tasks) {
      if (!t.assignee || !assigneeMap.has(t.assignee)) continue
      const entry = assigneeMap.get(t.assignee)!

      // Check if task falls within this week (by due_date or start_date)
      const taskDate = t.due_date ? parseDate(t.due_date) : t.start_date ? parseDate(t.start_date) : null
      if (!taskDate) continue
      if (taskDate < startOfWeek || taskDate > endOfWeek) continue

      const dayIdx = Math.min(4, Math.max(0, Math.floor((taskDate.getTime() - startOfWeek.getTime()) / (1000 * 60 * 60 * 24))))
      const mins = t.duration_minutes || 30
      entry.dayMinutes[dayIdx] += mins
      entry.dayTaskCounts[dayIdx]++
      entry.totalMinutes += mins

      // Tasks needing attention: overdue or blocked
      if ((t.due_date && parseDate(t.due_date) < new Date() && t.status !== 'done') || t.status === 'blocked') {
        entry.attentionCount++
      }
    }

    return { days, weekLabel, assignees: Array.from(assigneeMap.values()), startOfWeek }
  }, [tasks, weekOffset])

  function fmtMins(m: number): string {
    if (m === 0) return '0m'
    const h = Math.floor(m / 60)
    const mins = m % 60
    if (h === 0) return `${mins}m`
    if (mins === 0) return `${h}h`
    return `${h}h ${mins}m`
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Week navigation */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
        <span className="text-[14px] font-semibold text-text">{weekData.weekLabel}</span>
        <button onClick={() => setWeekOffset(o => o - 1)} className="text-text-dim hover:text-text p-1 rounded hover:bg-hover">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button onClick={() => setWeekOffset(o => o + 1)} className="text-text-dim hover:text-text p-1 rounded hover:bg-hover">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button onClick={() => setWeekOffset(0)} className="text-[13px] text-accent-text hover:text-accent-text/80 px-2 py-1 rounded border border-accent/30 hover:bg-accent/10">Today</button>
      </div>

      {/* Workload grid */}
      <div className="flex-1 overflow-auto">
        <div className="flex h-full min-h-[300px]">
          {/* Assignee sidebar */}
          <div className="w-[180px] shrink-0 border-r border-border">
            <div className="h-[44px] border-b border-border flex items-center px-3">
              <span className="text-[12px] text-text-dim font-medium uppercase tracking-wider">Assignee</span>
            </div>
            {weekData.assignees.map(a => (
              <div key={a.name} className="border-b border-border/30 px-3 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-black" style={{ backgroundColor: a.color }}>
                    {a.name[0].toUpperCase()}
                  </span>
                  <span className="text-[13px] font-medium text-text truncate">{a.name}</span>
                </div>
                {/* Capacity bar */}
                <div className="h-1.5 rounded-full bg-border overflow-hidden mb-1">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(100, (a.totalMinutes / a.capacityMinutes) * 100)}%`,
                    backgroundColor: a.totalMinutes > a.capacityMinutes ? '#ef5350' : a.totalMinutes > a.capacityMinutes * 0.8 ? '#ff9100' : '#7a6b55',
                  }} />
                </div>
                <div className="text-[10px] text-text-dim">{fmtMins(a.totalMinutes)} / 40h</div>
                {a.attentionCount > 0 && (
                  <div className="text-[10px] text-red-400 mt-0.5">{a.attentionCount} task{a.attentionCount > 1 ? 's' : ''} need attention</div>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="flex-1 flex">
            {weekData.days.map((day, dayIdx) => {
              const isToday = day.date.toDateString() === new Date().toDateString()
              return (
                <div key={dayIdx} className={`flex-1 border-r border-border/30 min-w-[160px] ${isToday ? 'bg-accent/3' : ''}`}>
                  {/* Day header */}
                  <div className={`h-[44px] border-b border-border flex items-center justify-center gap-1.5 ${isToday ? 'bg-accent/5' : ''}`}>
                    <span className="text-[12px] text-text-dim">{day.label}</span>
                    <span className={`text-[12px] ${isToday ? 'text-accent-text font-medium' : 'text-text-dim'}`}>{day.dayLabel}</span>
                    {isToday && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </div>
                  {/* Assignee rows for this day */}
                  {weekData.assignees.map(a => {
                    const mins = a.dayMinutes[dayIdx]
                    const count = a.dayTaskCounts[dayIdx]
                    const overCapacity = mins > 8 * 60
                    return (
                      <div key={a.name} className="border-b border-border/30 px-3 py-3 flex flex-col items-center justify-center min-h-[80px]">
                        {mins > 0 ? (
                          <>
                            <span className={`text-[20px] font-bold ${overCapacity ? 'text-red-400' : 'text-text'}`}>{fmtMins(mins)}</span>
                            <span className="text-[10px] text-text-dim mt-0.5">{fmtMins(mins)} tasks</span>
                            {count > 0 && (
                              <span className="text-[10px] text-text-dim">{count} task{count > 1 ? 's' : ''}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-[12px] text-text-dim">--</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard View ───

// ─── Hover tooltip: styled popup shown on hover ───
function HoverTip({ tip, children, side = 'top', style }: {
  tip: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom'
  style?: React.CSSProperties
}) {
  const [show, setShow] = useState(false)
  return (
    <div
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: 'relative', ...style }}
    >
      {children}
      {show && tip && (
        <div style={{
          position: 'absolute',
          [side === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(20, 21, 20, 0.98)',
          border: '1px solid rgba(255, 245, 225, 0.12)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--text)',
          boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
          zIndex: 1000,
          pointerEvents: 'none',
          maxWidth: 320,
          minWidth: 160,
          backdropFilter: 'blur(8px)',
          fontFamily: 'var(--font-sans)',
          whiteSpace: 'normal',
        }}>
          {tip}
        </div>
      )}
    </div>
  )
}

// Inline date picker button for rich task rows.
function DashInlineDate({ value, onChange, overdue }: {
  value: string | null
  onChange: (v: string) => void
  overdue?: boolean
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dateValue = value ? new Date(value + 'T00:00:00') : new Date()
  const label = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
    : 'NO DATE'
  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.04em',
          color: overdue ? 'var(--status-overdue)' : 'var(--text-secondary)',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px',
          borderRadius: 2, fontFeatureSettings: '"tnum"',
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in oklch, var(--text) 6%, transparent)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
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

// Rich task row for dashboard — clickable, with inline editable metadata + action buttons.
function OverdueTaskRow({
  task, daysOver, isLast, teamMembers,
  onOpenDetail, onUpdate, onDelete,
}: {
  task: EnrichedTask
  daysOver: number
  isLast: boolean
  teamMembers: ReturnType<typeof useTeamMembers>
  onOpenDetail: (id: number) => void
  onUpdate: (id: number, field: string, value: unknown) => void | Promise<void>
  onDelete: (id: number) => void | Promise<void>
}) {
  const [hover, setHover] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const assignee = teamMembers.find(m => m.id === task.assignee)
  const isAvatarUrl = assignee?.avatar?.startsWith('http') || assignee?.avatar?.startsWith('/')
  const pri = priorityConfig[task.priority] || { color: 'var(--text-muted)', label: task.priority }
  const assigneeOpts = [{ value: '', label: 'Unassigned' }, ...teamMembers.map(m => ({ value: m.id, label: m.name }))]
  const priorityOpts = SHARED_PRIORITY
  const durationOpts = DURATION_OPTIONS

  const stop = (e: React.MouseEvent | React.KeyboardEvent) => { e.stopPropagation() }

  const durationLabel = task.duration_minutes
    ? (task.duration_minutes >= 60
      ? `${Math.round(task.duration_minutes / 60 * 10) / 10}H`
      : `${task.duration_minutes}M`)
    : '—'

  return (
    <div
      onClick={() => onOpenDetail(task.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setConfirmDelete(false) }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(task.id) } }}
      style={{
        display: 'grid',
        gridTemplateColumns: '22px 1fr auto auto auto auto auto 68px',
        alignItems: 'center', gap: 12,
        padding: '10px 16px 10px 18px',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        cursor: 'pointer',
        background: hover ? 'color-mix(in oklch, var(--text) 3%, transparent)' : 'transparent',
        transition: 'background 120ms',
        position: 'relative',
      }}
    >
      {/* Assignee avatar */}
      <div
        onClick={stop}
        style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', background: assignee?.color || 'var(--bg-field)', border: '1px solid var(--border)', position: 'relative' }}
      >
        <Dropdown
          value={task.assignee || ''}
          onChange={(v) => onUpdate(task.id, 'assignee', v || null)}
          options={assigneeOpts}
          searchable
          minWidth={190}
          renderTrigger={() => (
            <button
              onClick={stop}
              style={{
                width: '100%', height: '100%',
                padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={assignee?.name || 'Unassigned'}
            >
              {assignee && isAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assignee.avatar} alt={assignee.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, color: '#fff', fontFamily: 'var(--font-sans)',
                }}>{((assignee?.avatar || assignee?.name?.[0] || '?').toUpperCase()).slice(0, 1)}</span>
              )}
            </button>
          )}
          renderOption={(opt, isSel) => {
            const m = findAssignee(opt.value, teamMembers)
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                {m ? <Avatar name={m.name} size={16} src={m.avatar} color={m.color} /> : <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--bg-field)' }} />}
                <span>{opt.label}</span>
                {isSel && <IconCheck size={10} className="ml-auto text-accent-text" strokeWidth={2.5} />}
              </div>
            )
          }}
        />
      </div>

      {/* Title + project */}
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: task.project_color || 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </span>
        {task.project_name && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
            letterSpacing: '0.04em', flexShrink: 0,
          }}>· {task.project_name.toUpperCase()}</span>
        )}
      </div>

      {/* Priority chip (clickable) */}
      <div onClick={stop} style={{ display: 'flex' }}>
        <Dropdown
          value={task.priority}
          onChange={(v) => onUpdate(task.id, 'priority', v)}
          options={priorityOpts}
          minWidth={140}
          renderTrigger={() => (
            <button
              onClick={stop}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: pri.color,
                padding: '2px 6px',
                border: `1px solid ${pri.color}`,
                borderRadius: 2,
                background: 'transparent',
                opacity: 0.88,
                cursor: 'pointer',
                transition: 'opacity 120ms, background 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = `color-mix(in oklch, ${pri.color} 8%, transparent)` }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.background = 'transparent' }}
              title="Change priority"
            >
              {(pri.label || task.priority).toUpperCase()}
            </button>
          )}
          renderOption={renderPriorityOption as (opt: { value: string; label: string }, isSel: boolean) => React.ReactNode}
        />
      </div>

      {/* Due date (clickable) */}
      <div onClick={stop} style={{ display: 'flex' }}>
        <DashInlineDate
          value={task.due_date || null}
          onChange={(d) => onUpdate(task.id, 'due_date', d)}
          overdue
        />
      </div>

      {/* Duration */}
      <div onClick={stop} style={{ display: 'flex' }}>
        <Dropdown
          value={String(task.duration_minutes || 30)}
          onChange={(v) => onUpdate(task.id, 'duration_minutes', Number(v))}
          options={durationOpts}
          minWidth={120}
          renderTrigger={() => (
            <button
              onClick={stop}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.04em',
                color: 'var(--text-dim)', background: 'transparent', border: 'none',
                padding: '2px 4px', cursor: 'pointer', borderRadius: 2,
                fontFeatureSettings: '"tnum"',
                transition: 'background 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in oklch, var(--text) 6%, transparent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              title="Change duration estimate"
            >
              {durationLabel}
            </button>
          )}
        />
      </div>

      {/* Days late pill */}
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
        color: 'var(--status-overdue)', fontFeatureSettings: '"tnum"',
        letterSpacing: '0.04em',
        padding: '2px 6px',
        border: '1px solid color-mix(in oklch, var(--status-overdue) 40%, transparent)',
        borderRadius: 2,
        background: 'color-mix(in oklch, var(--status-overdue) 10%, transparent)',
      }}>
        {daysOver}D LATE
      </span>

      {/* Edit link */}
      <button
        onClick={(e) => { stop(e); onOpenDetail(task.id) }}
        title="Open task details"
        style={{
          width: 24, height: 24, borderRadius: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
          border: '1px solid transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          transition: 'background 120ms, color 120ms, border-color 120ms',
          opacity: hover ? 1 : 0.55,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in oklch, var(--text) 7%, transparent)'; e.currentTarget.style.color = 'var(--text)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {/* Action buttons: complete + delete */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button
          onClick={(e) => { stop(e); onUpdate(task.id, 'status', 'done') }}
          title="Mark done"
          style={{
            width: 26, height: 26, borderRadius: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in oklch, var(--status-completed) 14%, transparent)',
            border: '1px solid color-mix(in oklch, var(--status-completed) 28%, transparent)',
            color: 'var(--status-completed)',
            cursor: 'pointer',
            transition: 'background 120ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in oklch, var(--status-completed) 24%, transparent)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'color-mix(in oklch, var(--status-completed) 14%, transparent)' }}
        >
          <IconCheck size={14} strokeWidth={2.5} />
        </button>
        <button
          onClick={(e) => {
            stop(e)
            if (!confirmDelete) { setConfirmDelete(true); return }
            onDelete(task.id)
          }}
          title={confirmDelete ? 'Click again to confirm delete' : 'Delete task'}
          style={{
            width: 26, height: 26, borderRadius: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: confirmDelete
              ? 'color-mix(in oklch, var(--status-overdue) 30%, transparent)'
              : 'color-mix(in oklch, var(--status-overdue) 12%, transparent)',
            border: `1px solid color-mix(in oklch, var(--status-overdue) ${confirmDelete ? 55 : 28}%, transparent)`,
            color: 'var(--status-overdue)',
            cursor: 'pointer',
            transition: 'background 120ms',
          }}
        >
          <IconX size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

// Focal donut: one chart, hover slice shows count + %, legend to the right.
function DashboardDonut({ rows, size = 148, thickness = 18 }: {
  rows: Array<{ key: string; label: string; value: number; color: string }>
  size?: number
  thickness?: number
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const total = rows.reduce((s, r) => s + r.value, 0)
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const active = hoverIdx != null ? rows[hoverIdx] : null
  const activePct = active && total > 0 ? Math.round((active.value / total) * 100) : 0
  let offset = 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-field)" strokeWidth={thickness} />
          {total > 0 && rows.map((row, i) => {
            if (row.value === 0) return null
            const frac = row.value / total
            const dash = circumference * frac
            const isHover = hoverIdx === i
            const el = (
              <circle
                key={row.key}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={row.color}
                strokeWidth={isHover ? thickness + 3 : thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                opacity={hoverIdx == null || isHover ? 1 : 0.3}
                style={{ transition: 'opacity 120ms, stroke-width 120ms', cursor: 'pointer' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            )
            offset += dash
            return el
          })}
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        }}>
          {active ? (
            <>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 500, color: active.color, letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"', lineHeight: 1 }}>{active.value}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 5 }}>{activePct}%</div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"', lineHeight: 1 }}>{total}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 5 }}>TOTAL</div>
            </>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map((row, i) => {
          if (row.value === 0) return null
          const pct = total > 0 ? Math.round((row.value / total) * 100) : 0
          const isHover = hoverIdx === i
          return (
            <div
              key={row.key}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, cursor: 'default',
                padding: '2px 4px', borderRadius: 2,
                background: isHover ? 'color-mix(in oklch, var(--text) 4%, transparent)' : 'transparent',
                transition: 'background 120ms',
                opacity: hoverIdx == null || isHover ? 1 : 0.55,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 1, background: row.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', fontFeatureSettings: '"tnum"' }}>{row.value}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', fontFeatureSettings: '"tnum"', minWidth: 26, textAlign: 'right' }}>{pct}%</span>
            </div>
          )
        })}
        {total === 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.14em' }}>NO DATA</span>}
      </div>
    </div>
  )
}

function DashboardView({ tasks, projects, setSelectedTaskId, updateTask, refreshTasks }: {
  tasks: EnrichedTask[]
  projects: Project[]
  setSelectedTaskId: (id: number | null) => void
  updateTask: (id: number, field: string, value: unknown) => void | Promise<void>
  refreshTasks: () => void
}) {
  const teamMembers = useTeamMembers()
  void projects

  const now = Date.now()

  const deleteTaskById = useCallback(async (id: number) => {
    await fetch('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    refreshTasks()
  }, [refreshTasks])

  const stats = useMemo(() => {
    const total = tasks.length
    const done = tasks.filter(t => t.status === 'done').length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    const open = total - done
    const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && parseDate(t.due_date).getTime() < now).length
    const blocked = tasks.filter(t => t.status === 'blocked').length
    const todo = tasks.filter(t => t.status === 'todo').length
    const totalMinutes = tasks.reduce((s, t) => s + (t.duration_minutes || 0), 0)
    const completedMinutes = tasks.reduce((s, t) => s + (t.completed_time_minutes || 0), 0)

    const byStatus: Record<string, number> = {}
    tasks.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1 })

    const byPriority: Record<string, number> = {}
    tasks.forEach(t => { byPriority[t.priority] = (byPriority[t.priority] || 0) + 1 })

    const byProject: Record<string, { name: string; color: string; count: number; done: number }> = {}
    tasks.forEach(t => {
      const key = String(t.project_id || 'none')
      if (!byProject[key]) byProject[key] = { name: t.project_name || 'No Project', color: t.project_color || 'var(--text-dim)', count: 0, done: 0 }
      byProject[key].count++
      if (t.status === 'done') byProject[key].done++
    })

    return { total, done, open, inProgress, todo, overdue, blocked, totalMinutes, completedMinutes, byStatus, byPriority, byProject }
  }, [tasks, now])

  const completionRate = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0

  // Last-14-days dual pulse: done count + minutes logged
  const pulse = useMemo(() => {
    const buckets: Record<string, { count: number; minutes: number }> = {}
    const today = new Date()
    const days: Array<{ key: string; label: string; date: Date }> = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days.push({ key, label: d.toLocaleDateString('en-US', { weekday: 'narrow' }), date: d })
      buckets[key] = { count: 0, minutes: 0 }
    }
    for (const t of tasks) {
      if (!t.completed_at) continue
      const d = new Date(t.completed_at * 1000).toISOString().slice(0, 10)
      if (buckets[d]) {
        buckets[d].count++
        buckets[d].minutes += t.completed_time_minutes || t.duration_minutes || 0
      }
    }
    return days.map(({ key, label, date }) => ({
      key, label, date,
      count: buckets[key].count,
      minutes: buckets[key].minutes,
    }))
  }, [tasks])

  const pulseMaxCount = Math.max(1, ...pulse.map(p => p.count))
  const pulseMaxMinutes = Math.max(1, ...pulse.map(p => p.minutes))
  const pulseDone = pulse.reduce((s, p) => s + p.count, 0)
  const pulseHours = Math.round(pulse.reduce((s, p) => s + p.minutes, 0) / 60 * 10) / 10

  // Per-person rows with 7-day sparkline
  const byPerson = useMemo(() => {
    const rows = new Map<string, {
      id: string; name: string; color: string; avatar: string; role: string
      open: number; done: number; overdue: number; minutesLogged: number; minutesOpen: number
      spark: number[]
    }>()
    const mkSpark = () => new Array(7).fill(0)
    for (const m of teamMembers) {
      rows.set(m.id, { id: m.id, name: m.name, color: m.color, avatar: m.avatar, role: m.role, open: 0, done: 0, overdue: 0, minutesLogged: 0, minutesOpen: 0, spark: mkSpark() })
    }
    rows.set('unassigned', { id: 'unassigned', name: 'Unassigned', color: 'var(--text-dim)', avatar: '?', role: '', open: 0, done: 0, overdue: 0, minutesLogged: 0, minutesOpen: 0, spark: mkSpark() })
    const startSpark = new Date()
    startSpark.setHours(0, 0, 0, 0)
    startSpark.setDate(startSpark.getDate() - 6)
    for (const t of tasks) {
      const key = t.assignee || 'unassigned'
      if (!rows.has(key)) rows.set(key, { id: key, name: key, color: 'var(--text-dim)', avatar: key[0]?.toUpperCase() || '?', role: '', open: 0, done: 0, overdue: 0, minutesLogged: 0, minutesOpen: 0, spark: mkSpark() })
      const r = rows.get(key)!
      if (t.status === 'done') {
        r.done++
        r.minutesLogged += t.completed_time_minutes || t.duration_minutes || 0
        if (t.completed_at) {
          const diff = Math.floor((t.completed_at * 1000 - startSpark.getTime()) / 86400000)
          if (diff >= 0 && diff < 7) r.spark[diff]++
        }
      } else {
        r.open++
        r.minutesOpen += t.duration_minutes || 0
        if (t.due_date && parseDate(t.due_date).getTime() < now) r.overdue++
      }
    }
    return Array.from(rows.values())
      .filter(r => r.open + r.done > 0)
      .sort((a, b) => (b.open + b.done) - (a.open + a.done))
  }, [tasks, teamMembers, now])

  const maxPersonTotal = Math.max(1, ...byPerson.map(r => r.open + r.done))

  // Overdue grouped by age bucket
  const overdueGrouped = useMemo(() => {
    const buckets: { label: string; items: EnrichedTask[] }[] = [
      { label: '> 1 week late', items: [] },
      { label: 'this week', items: [] },
      { label: 'today / yesterday', items: [] },
    ]
    tasks.forEach(t => {
      if (!t.due_date || t.status === 'done') return
      const due = parseDate(t.due_date).getTime()
      if (due >= now) return
      const days = Math.floor((now - due) / 86400000)
      if (days >= 7) buckets[0].items.push(t)
      else if (days >= 2) buckets[1].items.push(t)
      else buckets[2].items.push(t)
    })
    buckets.forEach(b => b.items.sort((a, b) => parseDate(a.due_date!).getTime() - parseDate(b.due_date!).getTime()))
    return buckets
  }, [tasks, now])

  // Distribution rows
  const statusRows = Object.entries(stats.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => ({ key: s, label: statusConfig[s]?.label || s, value: c, color: statusConfig[s]?.color || 'var(--text-dim)' }))
  const priorityRows = Object.entries(stats.byPriority)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => ({ key: p, label: priorityConfig[p]?.label || p, value: c, color: priorityConfig[p]?.color || 'var(--text-dim)' }))
  const projectRows = Object.entries(stats.byProject)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([k, p]) => ({ key: k, label: p.name, value: p.count, color: p.color, done: p.done }))

  const statBarItems = [
    { key: 'open', label: 'Open', value: stats.open, tone: undefined as string | undefined,
      tip: `${stats.open} tasks not yet done. ${stats.todo} todo · ${stats.inProgress} in progress${stats.blocked ? ` · ${stats.blocked} blocked` : ''}.` },
    { key: 'overdue', label: 'Overdue', value: stats.overdue, tone: stats.overdue > 0 ? 'var(--status-overdue)' : undefined,
      tip: `Past due date, not done. Excludes blocked+cancelled.` },
    { key: 'active', label: 'Active', value: stats.inProgress, tone: stats.inProgress > 0 ? 'var(--status-active)' : undefined,
      tip: `Status = in_progress. Someone is actively working on these.` },
    { key: 'done', label: 'Done', value: stats.done, tone: undefined,
      tip: `${stats.done} / ${stats.total} total complete.` },
    { key: 'logged', label: 'Logged', value: `${Math.round(stats.completedMinutes / 60)}h`, tone: undefined,
      tip: `Hours logged on completed tasks. Estimated total: ${Math.round(stats.totalMinutes / 60)}h.` },
    { key: 'completion', label: 'Completion', value: `${completionRate}%`, tone: undefined,
      tip: `${stats.done} done / ${stats.total} total = ${completionRate}%.` },
  ]

  const lastUpdated = useMemo(() => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }), [tasks])

  // Styles
  const monoLabel: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
    letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-dim)',
  }
  const monoLabelStrong: React.CSSProperties = {
    ...monoLabel, color: 'var(--text-secondary)',
  }
  const monoMeta: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
    fontFeatureSettings: '"tnum"', letterSpacing: '0.04em',
  }
  const panel: React.CSSProperties = {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    boxShadow: 'inset 0 1px 0 rgba(255,245,225,0.025)',
    borderRadius: 3,
  }

  const SectionHeader = ({ label, meta, right }: { label: string; meta?: string; right?: React.ReactNode }) => (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 14,
      padding: '0 2px 10px', marginBottom: 14,
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={monoLabelStrong}>{label}</span>
      {meta && <span style={monoMeta}>{meta}</span>}
      <div style={{ marginLeft: 'auto' }}>{right}</div>
    </div>
  )

  return (
    <div className="flex-1 overflow-auto" style={{ background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '20px 28px 80px' }}>

        {/* ─── Overview header ─── */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 18 }}>
          <span style={{ ...monoLabelStrong, fontSize: 11 }}>OVERVIEW</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--status-completed)',
              boxShadow: '0 0 0 3px color-mix(in oklch, var(--status-completed) 18%, transparent)',
            }} />
            <span style={monoMeta}>LIVE</span>
          </span>
          <span style={{ marginLeft: 'auto', ...monoMeta }}>
            UPDATED {lastUpdated} · {tasks.length} TASKS TRACKED
          </span>
        </div>

        {/* ─── Stat bar (inline, 1px separators, no cards) ─── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${statBarItems.length}, 1fr)`,
          ...panel,
          marginBottom: 36,
        }}>
          {statBarItems.map((s, i) => (
            <HoverTip
              key={s.key}
              tip={s.tip}
              side="bottom"
              style={{
                padding: '14px 18px',
                borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                cursor: 'default',
              }}
            >
              <div style={{ ...monoLabel, marginBottom: 8 }}>{s.label}</div>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: s.tone || 'var(--text)',
                fontFeatureSettings: '"tnum"',
                lineHeight: 1,
              }}>{s.value}</div>
            </HoverTip>
          ))}
        </div>

        {/* ─── Pulse · last 14 days ─── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeader
            label="PULSE · LAST 14 DAYS"
            meta={`${pulseDone} done · ${pulseHours}h`}
            right={<span style={monoMeta}>{pulse[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {pulse[pulse.length - 1].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          />
          <div style={{ ...panel, padding: '18px 20px 12px' }}>
            {/* DONE row: opacity-scaled accent squares */}
            <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr', gap: 14, alignItems: 'center', marginBottom: 10 }}>
              <span style={monoLabel}>DONE</span>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(14, 1fr)`, gap: 4 }}>
                {pulse.map((p) => {
                  const intensity = p.count > 0 ? 0.22 + (p.count / pulseMaxCount) * 0.78 : 0
                  return (
                    <HoverTip
                      key={'d' + p.key}
                      side="top"
                      tip={
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
                            {p.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>
                            {p.count} {p.count === 1 ? 'task done' : 'tasks done'}
                          </div>
                        </div>
                      }
                      style={{ display: 'block' }}
                    >
                      <div style={{
                        height: 22, borderRadius: 2,
                        background: intensity > 0
                          ? `color-mix(in oklch, var(--accent) ${Math.round(intensity * 100)}%, transparent)`
                          : 'var(--bg-field)',
                        border: intensity > 0 ? '1px solid color-mix(in oklch, var(--accent) 35%, transparent)' : '1px solid var(--border)',
                        cursor: 'default',
                      }} />
                    </HoverTip>
                  )
                })}
              </div>
            </div>
            {/* HRS row: height-scaled olive bars */}
            <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr', gap: 14, alignItems: 'end', marginBottom: 6 }}>
              <span style={monoLabel}>HRS</span>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(14, 1fr)`, gap: 4, height: 52, alignItems: 'end' }}>
                {pulse.map((p) => {
                  const h = p.minutes > 0 ? Math.max(3, (p.minutes / pulseMaxMinutes) * 48) : 2
                  const hrs = Math.round(p.minutes / 60 * 10) / 10
                  return (
                    <HoverTip
                      key={'h' + p.key}
                      side="top"
                      tip={
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>
                            {p.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>
                            {hrs}h logged
                          </div>
                        </div>
                      }
                      style={{ display: 'flex', alignItems: 'end', justifyContent: 'center', height: '100%' }}
                    >
                      <div style={{
                        width: '100%',
                        height: h,
                        background: p.minutes > 0 ? 'var(--status-completed)' : 'var(--bg-field)',
                        opacity: p.minutes > 0 ? 0.78 : 1,
                        borderRadius: 1,
                        cursor: 'default',
                      }} />
                    </HoverTip>
                  )
                })}
              </div>
            </div>
            {/* Day labels */}
            <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr', gap: 14, marginTop: 4 }}>
              <span />
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(14, 1fr)`, gap: 4 }}>
                {pulse.map(p => (
                  <span key={'l' + p.key} style={{
                    ...monoMeta, fontSize: 9, textAlign: 'center',
                    color: p.date.getDay() === 0 || p.date.getDay() === 6 ? 'var(--text-muted)' : 'var(--text-dim)',
                  }}>{p.label}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Capacity · by person ─── */}
        {byPerson.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <SectionHeader
              label="CAPACITY · BY PERSON"
              meta={`${byPerson.length} ${byPerson.length === 1 ? 'member' : 'members'}`}
            />
            <div style={panel}>
              {/* Column header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '28px 1.6fr 48px 48px 48px 120px 1fr 60px',
                gap: 12,
                padding: '9px 18px',
                borderBottom: '1px solid var(--border)',
                ...monoLabel,
                fontSize: 9,
              }}>
                <span />
                <span>PERSON</span>
                <span style={{ textAlign: 'right' }}>OPEN</span>
                <span style={{ textAlign: 'right' }}>DONE</span>
                <span style={{ textAlign: 'right' }}>O/D</span>
                <span>7-DAY</span>
                <span>LOAD</span>
                <span style={{ textAlign: 'right' }}>HRS</span>
              </div>
              {byPerson.map((p, idx) => {
                const total = p.open + p.done
                const donePct = total > 0 ? (p.done / total) * 100 : 0
                const widthPct = (total / maxPersonTotal) * 100
                const hours = Math.round(p.minutesLogged / 60 * 10) / 10
                const openHours = Math.round(p.minutesOpen / 60 * 10) / 10
                const completionPct = total > 0 ? Math.round(donePct) : 0
                const sparkMax = Math.max(1, ...p.spark)
                const isAvatarUrl = p.avatar?.startsWith('http') || p.avatar?.startsWith('/')
                return (
                  <HoverTip
                    key={p.id}
                    side={idx > byPerson.length - 3 ? 'top' : 'bottom'}
                    tip={
                      <div style={{ minWidth: 230 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                          {p.name}{p.role ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {p.role}</span> : null}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Open</span><span>{p.open} · {openHours}h est.</span>
                          <span style={{ color: 'var(--text-muted)' }}>Done</span><span>{p.done} · {hours}h logged</span>
                          <span style={{ color: 'var(--text-muted)' }}>Overdue</span><span style={{ color: p.overdue > 0 ? 'var(--status-overdue)' : undefined }}>{p.overdue}</span>
                          <span style={{ color: 'var(--text-muted)' }}>Completion</span><span>{completionPct}%</span>
                          <span style={{ color: 'var(--text-muted)' }}>Total</span><span>{total}</span>
                        </div>
                      </div>
                    }
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1.6fr 48px 48px 48px 120px 1fr 60px',
                      gap: 12,
                      alignItems: 'center',
                      padding: '11px 18px',
                      borderBottom: idx < byPerson.length - 1 ? '1px solid var(--border)' : 'none',
                      cursor: 'default',
                    }}
                  >
                    {/* Avatar */}
                    <div style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: p.color }}>
                      {isAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatar} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{
                          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 600, color: '#fff', fontFamily: 'var(--font-sans)',
                        }}>{(p.avatar || p.name[0] || '?').toUpperCase().slice(0, 1)}</span>
                      )}
                    </div>
                    {/* Name + role */}
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {p.role && <span style={{ ...monoMeta, fontSize: 9 }}>{p.role.toUpperCase()}</span>}
                    </div>
                    {/* Open */}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{p.open}</span>
                    {/* Done */}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{p.done}</span>
                    {/* Overdue */}
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: p.overdue > 0 ? 'var(--status-overdue)' : 'var(--text-muted)',
                      fontWeight: p.overdue > 0 ? 500 : 400,
                      textAlign: 'right', fontFeatureSettings: '"tnum"',
                    }}>{p.overdue > 0 ? p.overdue : '·'}</span>
                    {/* 7-day sparkline */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, height: 18, alignItems: 'end' }}>
                      {p.spark.map((v, i) => (
                        <div key={i} style={{
                          height: v > 0 ? Math.max(4, (v / sparkMax) * 16) : 2,
                          background: v > 0 ? 'var(--accent)' : 'var(--bg-field)',
                          opacity: v > 0 ? 0.65 + (v / sparkMax) * 0.35 : 1,
                          borderRadius: 1,
                        }} />
                      ))}
                    </div>
                    {/* Load bar: done + open stacked */}
                    <div>
                      <div style={{
                        width: `${Math.max(6, widthPct)}%`,
                        height: 5,
                        background: 'var(--bg-field)',
                        border: '1px solid var(--border)',
                        display: 'flex', overflow: 'hidden',
                        borderRadius: 1,
                      }}>
                        <div style={{ width: `${donePct}%`, background: 'var(--status-completed)' }} />
                        <div style={{ flex: 1, background: 'var(--accent)', opacity: 0.9 }} />
                      </div>
                    </div>
                    {/* Hours */}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                      {hours > 0 ? `${hours}h` : '·'}
                    </span>
                  </HoverTip>
                )
              })}
            </div>
          </section>
        )}

        {/* ─── Distribution: focal donut (status) + ranked bars (priority, project) ─── */}
        <section style={{ marginBottom: 40 }}>
          <SectionHeader
            label="DISTRIBUTION"
            meta={`${stats.total} tasks`}
          />
          <div style={{ ...panel, display: 'grid', gridTemplateColumns: '1.35fr 1fr 1fr' }}>
            {/* Focal column: donut */}
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <span style={{ ...monoLabel, fontSize: 9 }}>BY STATUS</span>
                <span style={monoMeta}>{stats.total}</span>
              </div>
              <DashboardDonut rows={statusRows} />
            </div>
            {/* Ranked bars: priority + project */}
            {[
              { title: 'BY PRIORITY', rows: priorityRows },
              { title: 'BY PROJECT', rows: projectRows },
            ].map((col) => {
              const colMax = Math.max(1, ...col.rows.map(r => r.value))
              const colTotal = col.rows.reduce((s, r) => s + r.value, 0)
              return (
                <div key={col.title} style={{
                  padding: '16px 20px',
                  borderLeft: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                    <span style={{ ...monoLabel, fontSize: 9 }}>{col.title}</span>
                    <span style={monoMeta}>{colTotal}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {col.rows.length === 0 && <span style={{ ...monoMeta, color: 'var(--text-dim)' }}>NO DATA</span>}
                    {col.rows.map(r => {
                      const pct = colTotal > 0 ? Math.round((r.value / colTotal) * 100) : 0
                      const widthPct = (r.value / colMax) * 100
                      return (
                        <HoverTip
                          key={r.key}
                          side="top"
                          tip={
                            <div style={{ minWidth: 160 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6, verticalAlign: 'middle' }} />
                                {r.label}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"' }}>
                                {r.value} {r.value === 1 ? 'task' : 'tasks'} · {pct}% of {colTotal}
                              </div>
                            </div>
                          }
                          style={{ display: 'block', cursor: 'default' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 1, background: r.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{r.label}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', fontFeatureSettings: '"tnum"' }}>{r.value}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', fontFeatureSettings: '"tnum"', minWidth: 26, textAlign: 'right' }}>{pct}%</span>
                          </div>
                          <div style={{ height: 3, background: 'var(--bg-field)', borderRadius: 1, overflow: 'hidden' }}>
                            <div style={{ width: `${widthPct}%`, height: '100%', background: r.color, opacity: 0.85 }} />
                          </div>
                        </HoverTip>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ─── Overdue grouped by age ─── */}
        {stats.overdue > 0 && (
          <section>
            <SectionHeader
              label="OVERDUE"
              meta={`${stats.overdue} ${stats.overdue === 1 ? 'task' : 'tasks'}`}
              right={<span style={{ ...monoMeta, color: 'var(--status-overdue)' }}>ACTION REQUIRED</span>}
            />
            <div style={panel}>
              {overdueGrouped.map((bucket, bi) => {
                if (bucket.items.length === 0) return null
                return (
                  <div key={bucket.label} style={{ borderBottom: bi < overdueGrouped.length - 1 && overdueGrouped.slice(bi + 1).some(b => b.items.length > 0) ? '1px solid var(--border)' : 'none' }}>
                    <div style={{
                      background: 'var(--bg-chrome)',
                      padding: '7px 18px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ ...monoLabel, fontSize: 9, color: 'var(--text-muted)' }}>{bucket.label.toUpperCase()}</span>
                      <span style={monoMeta}>{bucket.items.length}</span>
                    </div>
                    {bucket.items.map((t, i) => {
                      const due = parseDate(t.due_date!)
                      const daysOver = Math.floor((now - due.getTime()) / 86400000)
                      return (
                        <OverdueTaskRow
                          key={t.id}
                          task={t}
                          daysOver={daysOver}
                          isLast={i === bucket.items.length - 1}
                          teamMembers={teamMembers}
                          onOpenDetail={setSelectedTaskId}
                          onUpdate={updateTask}
                          onDelete={deleteTaskById}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

// ─── Sort Groups Panel (multi-column reorder) ───

function SortGroupsPanel({ groupBy, workspaces, projects, stages, folders, onClose }: {
  groupBy: GroupLevel[]; workspaces: Workspace[]; projects: Project[]; stages: Stage[]; folders: Folder[]; onClose: () => void
}) {
  const teamMembers = useTeamMembers()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  function getColumnItems(level: GroupLevel): { id: string; name: string; color: string }[] {
    switch (level) {
      case 'workspace': return workspaces.map(w => ({ id: String(w.id), name: w.name, color: w.color }))
      case 'project': return projects.map(p => ({ id: String(p.id), name: p.name, color: p.color }))
      case 'stage': return stages.map(s => ({ id: String(s.id), name: s.name, color: s.color }))
      case 'folder': return folders.map(f => ({ id: String(f.id), name: f.name, color: f.color }))
      case 'status': return Object.entries(statusConfig).map(([k, v]) => ({ id: k, name: v.label, color: v.color }))
      case 'priority': return Object.entries(priorityConfig).map(([k, v]) => ({ id: k, name: v.label, color: v.color }))
      case 'assignee': return teamMembers.map(m => ({ id: m.id, name: m.name, color: m.color }))
      default: return []
    }
  }

  // Only show columns for non-date groupBy levels
  const visibleLevels = groupBy.filter(l => !['due_date', 'start_date', 'created_at', 'updated_at', 'completed_at', 'label'].includes(l))

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl z-50 max-h-[500px] overflow-hidden">
      <div className="flex min-w-max">
        {visibleLevels.map(level => {
          const items = getColumnItems(level)
          return (
            <div key={level} className="w-[220px] border-r border-border/30 last:border-r-0">
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card sticky top-0">
                <span className="text-[13px] font-semibold text-text">{GROUP_LEVEL_LABELS[level]}</span>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-text-dim"><path d="M4 2v10M4 12l-3-3M4 12l3-3M10 12V2M10 2l-3 3M10 2l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              {/* Items */}
              <div className="overflow-y-auto max-h-[400px] py-1">
                {items.map(item => (
                  <div key={item.id} className="flex items-center gap-2 px-3 py-2 hover:bg-hover/30 cursor-grab group">
                    <svg width="8" height="10" viewBox="0 0 8 10" fill="none" className="text-text-dim opacity-0 group-hover:opacity-100 shrink-0">
                      <circle cx="2" cy="2" r="1" fill="currentColor" /><circle cx="6" cy="2" r="1" fill="currentColor" />
                      <circle cx="2" cy="5" r="1" fill="currentColor" /><circle cx="6" cy="5" r="1" fill="currentColor" />
                      <circle cx="2" cy="8" r="1" fill="currentColor" /><circle cx="6" cy="8" r="1" fill="currentColor" />
                    </svg>
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-[13px] text-text-secondary truncate">{item.name}</span>
                  </div>
                ))}
                {items.length === 0 && <div className="px-3 py-4 text-[12px] text-text-dim text-center">No items</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function parseDate(s: string): Date { return new Date(s.includes('T') ? s : s + 'T00:00:00') }
function fmtDate(s: string): string { return parseDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function fmtTs(ts: number): string { if (!ts) return '--'; return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

// ─── New Item (Task/Project) Menu ───

interface TaskTemplateItem {
  id: number
  name: string
  description: string | null
  default_title: string | null
  default_priority: string
  default_duration_minutes: number
  subtasks: string | null
}

function NewItemMenu({ workspaces }: { workspaces: { id: number; name: string; slug: string }[] }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'task' | null>(null)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [title, setTitle] = useState('')
  const [wsId, setWsId] = useState(workspaces[0]?.id || 0)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setMode(null) }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function openProjectModal() {
    setOpen(false)
    setMode(null)
    setShowCreateProject(true)
  }

  async function handleCreateTask() {
    if (!title.trim()) return
    setSaving(true)
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), workspace_id: wsId, status: 'todo' }),
    })
    setSaving(false)
    setTitle('')
    setMode(null)
    setOpen(false)
    window.location.reload()
  }

  return (
    <>
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); setMode(open ? null : 'menu') }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent/80 transition-colors"
      >
        <IconPlus size={12} strokeWidth={1.8} />
        New
      </button>
      {open && mode === 'menu' && (
        <div className="absolute top-9 right-0 z-50 w-[180px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl py-1">
          <button
            onClick={() => setMode('task')}
            className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)]"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            New Task
          </button>
          <div className="border-t border-border/30 my-0.5" />
          <button
            onClick={openProjectModal}
            className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)]"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.2"/></svg>
            New Project
          </button>
        </div>
      )}
      {open && mode === 'task' && (
        <div className="absolute top-9 right-0 z-50 w-[280px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl p-3 space-y-3">
          <div className="text-[13px] font-medium text-text-dim uppercase tracking-wide">New Task</div>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Task name..."
            className="w-full bg-hover border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-text-dim/50 focus:border-accent/50"
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateTask()
              if (e.key === 'Escape') { setOpen(false); setMode(null) }
            }}
          />
          {workspaces.length > 1 && (
            <Dropdown
              value={String(wsId)}
              onChange={(v) => setWsId(Number(v))}
              options={workspaces.map(w => ({ value: String(w.id), label: w.name }))}
              triggerClassName="w-full bg-hover border border-border rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
              minWidth={160}
            />
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setOpen(false); setMode(null) }} className="px-3 py-1 rounded-md text-[12px] text-text-dim hover:bg-hover">Cancel</button>
            <button onClick={handleCreateTask} disabled={saving || !title.trim()} className="px-3 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent/80 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Create Project Modal - unified with sidebar */}
    {showCreateProject && (
      <CreateProjectModal
        workspaces={workspaces as any}
        activeWorkspaceId={wsId}
        onClose={() => setShowCreateProject(false)}
      />
    )}
    </>
  )
}
