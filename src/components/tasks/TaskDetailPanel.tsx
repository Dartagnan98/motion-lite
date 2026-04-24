'use client'

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { StagePill } from '@/components/ui/StagePill'
import type { Task, TaskActivity } from '@/lib/types'
import { updateTaskAction, deleteTaskAction } from '@/lib/actions'
import { showUndoToast } from '@/components/ui/UndoToast'
import { AutoScheduleToggle } from '@/components/ui/AutoScheduleToggle'
import { getTaskState } from '@/lib/task-states'
import { CalendarDropdown } from '@/components/ui/DateTimePickers'
import CustomDatePicker from '@/components/ui/DatePicker'
import { Dropdown } from '@/components/ui/Dropdown'
import { getAvailableWorkMinutes, formatCapacityWarning } from '@/lib/capacity-validation'
import type { ScheduleBlock } from '@/lib/scheduler'
import { StatusIcon, renderStatusOption, StatusTrigger } from '@/components/ui/StatusIcon'
import { STATUS_OPTIONS as TASK_STATUS_OPTIONS } from '@/lib/task-constants'
import { useTeamMembers } from '@/lib/use-team-members'
import { Avatar } from '@/components/ui/Avatar'
import { PriorityIcon, PRIORITY_OPTIONS as priorityOptions, PRIORITY_CONFIG, renderPriorityOption } from '@/components/ui/PriorityIcon'
import { IconWorkspace } from '@/components/ui/Icons'
import { DURATION_OPTIONS, CHUNK_OPTIONS, formatDuration } from '@/lib/task-constants'
import { findAssignee } from '@/lib/assignee-utils'
import { IconX, IconCopy, IconMoreHorizontal, IconCheck, IconTrash, IconEdit, IconArrowRight, IconClaude } from '@/components/ui/Icons'
import { LabelPicker } from '@/components/ui/LabelPicker'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

interface TaskMeta {
  workspaceName?: string
  workspaceColor?: string
  folderName?: string
  folderColor?: string
  projectName?: string
  projectColor?: string
  stages?: Array<{ id: number; name: string; color: string }>
  contactId?: number
  contactName?: string
  contactPublicId?: string
}

interface Attachment {
  id: number
  task_id: number
  filename: string
  filepath: string
  mimetype: string
  size: number
  created_at: number
}

const DISPATCH_AGENT_OPTIONS = [
  { value: 'team', label: 'Orchestrator Team (Parallel)' },
  { value: 'orchestrator', label: 'Orchestrator (Single)' },
  { value: 'claude', label: 'Claude Generalist' },
  { value: 'jimmy', label: 'Jimmy (Ops)' },
  { value: 'gary', label: 'Gary (Ads)' },
  { value: 'ricky', label: 'Ricky (Copy)' },
  { value: 'sofia', label: 'Sofia (Social)' },
]

const ASSIGNEE_DISPATCH_MAP: Record<string, string> = {
  claude: 'claude',
  orchestrator: 'team',
  jimmy: 'jimmy',
  gary: 'gary',
  ricky: 'ricky',
  sofia: 'sofia',
}

function inferDispatchAgent(task: Task | null): string {
  if (!task?.assignee) return 'team'
  const mapped = ASSIGNEE_DISPATCH_MAP[task.assignee.trim().toLowerCase()]
  return mapped || 'team'
}

export function TaskDetailPanel({
  taskId,
  onClose,
}: {
  taskId: number
  onClose: () => void
}) {
  const [task, setTask] = useState<Task | null>(null)
  const [meta, setMeta] = useState<TaskMeta>({})
  const [title, setTitle] = useState('')
  const [activities, setActivities] = useState<TaskActivity[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [commentText, setCommentText] = useState('')
  const [showAttachments, setShowAttachments] = useState(false)
  const [schedules, setSchedules] = useState<{ id: number; name: string }[]>([])
  const [subtasks, setSubtasks] = useState<Task[]>([])
  const [showSubtaskInput, setShowSubtaskInput] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [copyToast, setCopyToast] = useState(false)
  const [statusUpdates, setStatusUpdates] = useState<{ id: number; content: string; author: string; created_at: number }[]>([])
  const [statusUpdateText, setStatusUpdateText] = useState('')
  const [showStatusUpdates, setShowStatusUpdates] = useState(false)
  const [showSubtasks, setShowSubtasks] = useState(true)
  const [customFields, setCustomFields] = useState<{ id: number; name: string; field_type: string; options: string | null }[]>([])
  const [customFieldValues, setCustomFieldValues] = useState<Record<number, string>>({})
  const [recurrenceDialog, setRecurrenceDialog] = useState<{
    mode: 'edit' | 'delete'
    field?: string
    value?: unknown
  } | null>(null)
  const assigneeOptions = useTeamMembers()
  const [showBlockerPicker, setShowBlockerPicker] = useState(false)
  const [workBlocks, setWorkBlocks] = useState<ScheduleBlock[]>([])
  const [dailyCapPercent, setDailyCapPercent] = useState(85)
  const [blockerSearch, setBlockerSearch] = useState('')
  const [projectTasks, setProjectTasks] = useState<any[]>([])
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null)
  const [dispatchAgent, setDispatchAgent] = useState<string>('team')
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineToast, setPipelineToast] = useState<string | null>(null)
  const [folderPopupOpen, setFolderPopupOpen] = useState(false)
  const [folderPopupPos, setFolderPopupPos] = useState<{ top: number; left: number } | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [sidebarData, setSidebarData] = useState<any[]>([])
  const [allLabels, setAllLabels] = useState<{ id: number; name: string; color: string }[]>([])
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const blockerPickerRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const descriptionLoaded = useRef(false)

  const loadActivities = useCallback(() => {
    fetch(`/api/activities?taskId=${taskId}`)
      .then(r => r.json())
      .then(data => setActivities(data.activities || []))
  }, [taskId])

  const loadAttachments = useCallback(() => {
    fetch(`/api/attachments?taskId=${taskId}`)
      .then(r => r.json())
      .then(data => setAttachments(data.attachments || []))
  }, [taskId])

  const loadStatusUpdates = useCallback(() => {
    fetch(`/api/status-updates?taskId=${taskId}`)
      .then(r => r.json())
      .then(data => setStatusUpdates(data.updates || []))
      .catch(() => {})
  }, [taskId])

  const parseBlockedBy = (val: string | null | undefined): number[] => {
    if (!val) return []
    return String(val).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  }
  const serializeBlockedBy = (ids: number[]): string | null => {
    return ids.length > 0 ? ids.join(',') : null
  }

  const fetchProjectTasks = useCallback(async () => {
    if (!task?.project_id) return
    const res = await fetch(`/api/tasks?projectId=${task.project_id}`)
    if (res.ok) {
      const data = await res.json()
      setProjectTasks(data.tasks || [])
    }
  }, [task?.project_id])

  // Fetch sidebar data for folder picker
  useEffect(() => {
    fetch('/api/sidebar').then(r => r.json()).then(data => setSidebarData(data)).catch(() => {})
  }, [])

  // Fetch all labels for picker
  useEffect(() => {
    fetch('/api/labels').then(r => r.json()).then(d => { if (Array.isArray(d)) setAllLabels(d) }).catch(() => {})
  }, [])

  const checkDispatchStatus = useCallback(() => {
    if (!taskId) return
    fetch('/api/dispatch')
      .then(r => r.json())
      .then(data => {
        const dispatches = data.dispatches || []
        const active = dispatches.find((d: any) => d.task_id === taskId && ['queued', 'working', 'needs_review'].includes(d.status))
        setDispatchStatus(active?.status || null)
      })
      .catch(() => {})
  }, [taskId])

  // Keep dispatch status in sync while panel is open
  useEffect(() => {
    checkDispatchStatus()
    const interval = setInterval(checkDispatchStatus, 3000)
    return () => clearInterval(interval)
  }, [checkDispatchStatus])

  // Close blocker picker on outside click
  useEffect(() => {
    if (!showBlockerPicker) return
    function handleClick(e: MouseEvent) {
      if (blockerPickerRef.current && !blockerPickerRef.current.contains(e.target as Node)) {
        setShowBlockerPicker(false)
        setBlockerSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showBlockerPicker])

  const updateBlockers = async (newBlockerIds: number[]) => {
    if (!task) return
    const serialized = serializeBlockedBy(newBlockerIds)
    // Use PATCH API which handles syncDependencies automatically
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, blocked_by: serialized })
    })
    // Refresh task data
    const updated = await fetch(`/api/tasks?id=${task.public_id || task.id}`).then(r => r.json())
    setTask(updated.task || updated)
    if (updated.meta) setMeta(updated.meta)
    // Refresh project tasks to get updated blocking fields
    fetchProjectTasks()
  }

  // Fan this task out into a pipeline: one dispatch per subtask, wired by
  // their blocked_by relationships. The bridge queue will only start each
  // downstream dispatch once its upstream finishes (status = done).
  const runPipeline = async () => {
    if (!task || pipelineRunning) return
    setPipelineRunning(true)
    setPipelineToast(null)
    try {
      const res = await fetch('/api/dispatch/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        created?: Array<{ dispatch_id: number; task_title: string; agent_id: string; depends_on_task_ids: number[] }>
        skipped?: Array<{ task_title: string; reason: string }>
      }
      if (!res.ok || !data.ok) {
        setPipelineToast(data.error || 'Pipeline failed to queue')
      } else {
        const n = data.created?.length || 0
        const deps = (data.created || []).reduce((acc, c) => acc + c.depends_on_task_ids.length, 0)
        const skip = data.skipped?.length || 0
        setPipelineToast(
          `Queued ${n} dispatch${n === 1 ? '' : 'es'}` +
          (deps > 0 ? `, ${deps} dep${deps === 1 ? '' : 's'} wired` : '') +
          (skip > 0 ? `, ${skip} skipped` : '')
        )
        // Also surface it in the existing dispatch-status poller
        checkDispatchStatus()
      }
    } catch (err) {
      setPipelineToast(err instanceof Error ? err.message : 'Pipeline request failed')
    } finally {
      setPipelineRunning(false)
      setTimeout(() => setPipelineToast(null), 5000)
    }
  }

  useEffect(() => {
    descriptionLoaded.current = false
    fetch(`/api/tasks?id=${taskId}`)
      .then((r) => r.json())
      .then((data: { task: Task; meta: TaskMeta; subtasks?: Task[] }) => {
        setTask(data.task)
        setMeta(data.meta || {})
        setSubtasks(data.subtasks || [])
        setTitle(data.task.title)
        setDispatchAgent(inferDispatchAgent(data.task))
        if (editorRef.current && !descriptionLoaded.current) {
          editorRef.current.innerHTML = data.task.description || ''
          descriptionLoaded.current = true
        }
      })
    loadActivities()
    loadAttachments()
    loadStatusUpdates()
    fetch('/api/schedules').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : (d.schedules || [])
      setSchedules(list.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name })))
      // Grab first schedule's blocks for capacity validation
      if (list.length > 0 && list[0].blocks) {
        try { setWorkBlocks(typeof list[0].blocks === 'string' ? JSON.parse(list[0].blocks) : list[0].blocks) } catch {}
      }
    }).catch(() => {})
    fetch('/api/settings').then(r => r.json()).then(d => {
      if (d.dailyCapPercent != null) setDailyCapPercent(Number(d.dailyCapPercent))
    }).catch(() => {})
    // Team members come from useTeamMembers hook (module-cached)
  }, [taskId, loadActivities, loadAttachments, loadStatusUpdates])

  // Load project tasks for blocker picker (resolve task titles for chips)
  useEffect(() => {
    if (task?.project_id) fetchProjectTasks()
  }, [task?.project_id, fetchProjectTasks])

  // Load custom fields for the task's workspace
  useEffect(() => {
    if (!task?.workspace_id) return
    fetch(`/api/workspaces/custom-fields?workspaceId=${task.workspace_id}`)
      .then(r => r.json())
      .then(data => {
        const fields = data.fields || data || []
        setCustomFields(fields)
        // Load values for this task
        if (fields.length > 0) {
          fetch(`/api/workspaces/custom-fields?taskId=${task.public_id || task.id}&values=true`)
            .then(r => r.json())
            .then(vals => {
              const valMap: Record<number, string> = {}
              for (const v of (vals.values || vals || [])) {
                valMap[v.field_id] = v.value
              }
              setCustomFieldValues(valMap)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [task?.workspace_id, task?.id])

  // Capacity warning: does the task duration fit in the start_date → due_date window?
  const capacityWarning = useMemo(() => {
    if (!task || !task.start_date || !task.due_date || !task.duration_minutes) return null
    if (workBlocks.length === 0) return null
    const available = getAvailableWorkMinutes(task.start_date, task.due_date, workBlocks, dailyCapPercent)
    if (task.duration_minutes <= available) return null
    return formatCapacityWarning(available, task.duration_minutes, 'task')
  }, [task?.start_date, task?.due_date, task?.duration_minutes, workBlocks, dailyCapPercent])

  // Set editor content after initial render
  useEffect(() => {
    if (task && editorRef.current && !descriptionLoaded.current) {
      editorRef.current.innerHTML = task.description || ''
      descriptionLoaded.current = true
    }
  }, [task])

  useEffect(() => {
    if (!moreMenuOpen) return
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (moreMenuRef.current?.contains(target as Node)) return
      if (target?.closest('[data-task-detail-more-menu]')) return
      setMoreMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [moreMenuOpen])

  if (!task) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
        <div className="w-[calc(100vw-120px)] max-w-[1100px] h-[min(740px,calc(100vh-100px))] rounded-xl border border-border-strong shadow-2xl overflow-hidden flex items-center justify-center" style={{ background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
          <div className="text-text-dim text-sm">Loading...</div>
        </div>
      </div>
    )
  }

  const isDone = task.status === 'done'
  const isCancelled = task.status === 'cancelled'
  const isArchived = task.status === 'archived'
  const currentPriority = priorityOptions.find(p => p.value === task.priority) || priorityOptions[2]
  const currentAssignee = findAssignee(task.assignee, assigneeOptions)
  const assigneeDropdownValue = currentAssignee?.id || ''

  const isRecurring = !!(task.recurrence_rule || task.recurrence_parent_id)
  const selectedDispatchAgent = DISPATCH_AGENT_OPTIONS.find(o => o.value === dispatchAgent) || DISPATCH_AGENT_OPTIONS[0]

  // Fields that should NOT trigger the recurrence dialog (meta/non-data fields)
  const SKIP_RECURRENCE_FIELDS = ['is_favorite', 'recurrence_rule']

  async function saveField(field: string, value: unknown) {
    // If this is a recurring task and the field is meaningful, show the recurrence dialog
    if (isRecurring && !SKIP_RECURRENCE_FIELDS.includes(field)) {
      setRecurrenceDialog({ mode: 'edit', field, value })
      return
    }
    await doSaveField(field, value)
  }

  async function doSaveField(field: string, value: unknown) {
    const formData = new FormData()
    formData.set('id', String(task!.id))
    formData.set(field, String(value ?? ''))
    if (field === 'status' && value === 'done') {
      formData.set('completed_at', String(Math.floor(Date.now() / 1000)))
    }
    // Enabling auto-schedule removes the manual lock so scheduler can freely place the task
    if (field === 'auto_schedule' && value === 1) {
      formData.set('locked_at', '')
    }
    await updateTaskAction(formData)
    const updated = await fetch(`/api/tasks?id=${task!.public_id || task!.id}`).then(r => r.json())
    setTask(updated.task || updated)
    if (updated.meta) setMeta(updated.meta)

    // Notify parent views (calendar, schedule, etc.) of task changes
    window.dispatchEvent(new CustomEvent('task-changed', { detail: { taskId: task!.id, field, value } }))

  }

  async function handleDeleteTask() {
    const currentTask = task
    if (!currentTask) return
    if (isRecurring) {
      setRecurrenceDialog({ mode: 'delete' })
      return
    }
    const formData = new FormData()
    formData.set('id', String(currentTask.id))
    await deleteTaskAction(formData)
    window.dispatchEvent(new CustomEvent('task-changed', { detail: { taskId: currentTask.id, deleted: true } }))
    showUndoToast({ label: `Deleted "${currentTask.title}"`, projectIds: [], stageIds: [], taskIds: [currentTask.id] })
    onClose()
  }

  async function handleRecurrenceEdit(scope: 'this' | 'all') {
    if (!recurrenceDialog || recurrenceDialog.mode !== 'edit' || !recurrenceDialog.field) return
    const { field, value } = recurrenceDialog

    if (scope === 'this') {
      // Detach this occurrence from the series and apply the change
      await fetch('/api/tasks/recurrence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'detach',
          taskId: task!.id,
          changes: { [field]: value ?? null },
        }),
      })
    } else {
      // Edit the master task (parent or self)
      await fetch('/api/tasks/recurrence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_all',
          taskId: task!.id,
          changes: { [field]: value ?? null },
        }),
      })
    }

    // Refresh task data
    const updated = await fetch(`/api/tasks?id=${task!.public_id || task!.id}`).then(r => r.json())
    setTask(updated.task || updated)
    if (updated.meta) setMeta(updated.meta)
    setRecurrenceDialog(null)
  }

  async function handleRecurrenceDelete(scope: 'this' | 'all') {
    await fetch('/api/tasks/recurrence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: scope === 'this' ? 'delete_one' : 'delete_all',
        taskId: task!.id,
      }),
    })
    setRecurrenceDialog(null)
    onClose()
  }

  function saveDescription() {
    if (!editorRef.current) return
    const html = editorRef.current.innerHTML
    if (html !== (task?.description || '')) {
      saveField('description', html)
    }
  }

  function execFormat(command: string, value?: string) {
    document.execCommand(command, false, value)
    editorRef.current?.focus()
  }

  async function submitComment() {
    if (!commentText.trim()) return
    await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task!.id,
        activityType: 'comment',
        message: commentText.trim(),
      }),
    })
    setCommentText('')
    loadActivities()
  }

  async function submitStatusUpdate() {
    if (!statusUpdateText.trim()) return
    await fetch('/api/status-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task!.id,
        content: statusUpdateText.trim(),
      }),
    })
    setStatusUpdateText('')
    loadStatusUpdates()
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.set('taskId', String(task!.id))
      formData.set('file', file)
      await fetch('/api/attachments', { method: 'POST', body: formData })
    }
    loadAttachments()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function removeAttachment(id: number) {
    await fetch('/api/attachments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    loadAttachments()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div className="w-[calc(100vw-120px)] max-w-[1100px] h-[min(740px,calc(100vh-100px))] rounded-xl border border-border-strong overflow-hidden animate-panel-in" style={{ background: 'var(--bg-surface)', boxShadow: '-8px 0 40px rgba(10,13,14,0.55), 0 8px 32px rgba(10,13,14,0.4)' }} onClick={e => e.stopPropagation()}>
      <div className="flex h-full overflow-hidden">
      {/* Left pane: Title, Description, Activity */}
      <div className="flex-1 flex flex-col min-w-0 rounded-l-lg overflow-hidden" style={{ background: 'var(--bg-modal)' }}>
        {/* Completed banner */}
        {isDone && (
          <div className="flex items-center gap-2 px-6 py-2.5 bg-[#00e67612] text-[#00e676] text-[13px] font-medium border-b border-[#00e67622]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Task completed
          </div>
        )}

        {/* Header with actions */}
        <div className="flex items-center justify-end gap-1 px-4 py-2">
          <button
            className="rounded-md p-1.5 text-text-dim hover:bg-hover hover:text-text-secondary"
            title="Copy"
            onClick={async () => {
              const res = await fetch('/api/tasks/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: taskId }),
              })
              if (res.ok) {
                setCopyToast(true)
                setTimeout(() => setCopyToast(false), 2000)
              }
            }}
          >
            <IconCopy size={14} />
          </button>
          <button
            onClick={() => saveField('is_favorite', task.is_favorite ? 0 : 1)}
            className={`rounded-md p-1.5 hover:bg-hover transition-colors ${task.is_favorite ? 'text-yellow-400' : 'text-text-dim hover:text-text-secondary'}`}
            title={task.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1l2.2 4.5 5 .7-3.6 3.5.8 5L8 12.4 3.6 14.7l.8-5L.8 6.2l5-.7L8 1z" fill={task.is_favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <div ref={moreMenuRef}>
            <button
              onClick={() => setMoreMenuOpen(v => !v)}
              className="rounded-md p-1.5 text-text-dim hover:bg-hover hover:text-text-secondary"
              title="More"
            >
              <IconMoreHorizontal size={14} />
            </button>
            <PortalDrop anchorRef={moreMenuRef} open={moreMenuOpen} width={220}>
              <div data-task-detail-more-menu>
                {!isDone && !isCancelled && (
                  <button
                    onClick={async () => { await saveField('status', 'done'); setMoreMenuOpen(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-text hover:bg-hover"
                  >
                    <IconCheck size={13} strokeWidth={1.5} />
                    Complete task
                  </button>
                )}
                {!isCancelled && !isArchived && (
                  <button
                    onClick={async () => { await saveField('status', 'cancelled'); setMoreMenuOpen(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-text hover:bg-hover"
                  >
                    <IconX size={13} strokeWidth={1.5} />
                    Cancel task
                  </button>
                )}
                {isArchived ? (
                  <button
                    onClick={async () => { await saveField('status', 'backlog'); setMoreMenuOpen(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-text hover:bg-hover"
                  >
                    <IconArrowRight size={13} strokeWidth={1.5} />
                    Unarchive task
                  </button>
                ) : (
                  <button
                    onClick={async () => { await saveField('status', 'archived'); setMoreMenuOpen(false) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-text hover:bg-hover"
                  >
                    <IconArrowRight size={13} strokeWidth={1.5} />
                    Archive task
                  </button>
                )}
                <div className="my-1 h-px bg-border" />
                <button
                  onClick={async () => { setMoreMenuOpen(false); await handleDeleteTask() }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-hover hover:text-red-300"
                >
                  <IconTrash size={13} strokeWidth={1.4} />
                  Delete task
                </button>
              </div>
            </PortalDrop>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-text-dim hover:bg-hover hover:text-text ml-1">
            <IconX size={14} />
          </button>
        </div>

        {/* Title */}
        <div className="px-6">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (task && title !== task.title) saveField('title', title) }}
            className="w-full bg-transparent text-[18px] font-semibold text-text outline-none placeholder:text-text-dim"
            placeholder="Task title"
          />
        </div>

        {/* Rich text toolbar */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-border">
          <ToolbarBtn label="B" className="font-bold" onClick={() => execFormat('bold')} />
          <ToolbarBtn label="I" className="italic" onClick={() => execFormat('italic')} />
          <ToolbarBtn label="U" className="underline" onClick={() => execFormat('underline')} />
          <ToolbarBtn label="S" className="line-through" onClick={() => execFormat('strikeThrough')} />
          <ToolbarBtn label="H1" onClick={() => execFormat('formatBlock', 'h1')} />
          <ToolbarBtn label="H2" onClick={() => execFormat('formatBlock', 'h2')} />
          <div className="w-px h-4 bg-border mx-1" />
          <ToolbarBtn
            label={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4 3h8M4 7h8M4 11h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="1.5" cy="3" r="1" fill="currentColor" />
                <circle cx="1.5" cy="7" r="1" fill="currentColor" />
                <circle cx="1.5" cy="11" r="1" fill="currentColor" />
              </svg>
            }
            onClick={() => execFormat('insertUnorderedList')}
          />
          <ToolbarBtn
            label={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 3h7M5 7h7M5 11h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <text x="0" y="5" fontSize="5" fill="currentColor" fontFamily="sans-serif">1</text>
                <text x="0" y="9" fontSize="5" fill="currentColor" fontFamily="sans-serif">2</text>
                <text x="0" y="13" fontSize="5" fill="currentColor" fontFamily="sans-serif">3</text>
              </svg>
            }
            onClick={() => execFormat('insertOrderedList')}
          />
          <ToolbarBtn
            label={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M6 3h6M6 7h6M6 11h6M2 3l2 0M2 7l2 0M2 11l2 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            }
            onClick={() => execFormat('indent')}
          />
        </div>

        {/* Description + Attachments + Activity */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Description */}
          <div className="px-6 py-4">
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onBlur={saveDescription}
              className="w-full min-h-[300px] text-[14px] leading-relaxed text-text outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-text-dim [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5"
              data-placeholder="Description"
            />
          </div>

          {/* Subtasks */}
          <div className="py-2 px-6">
            <button
              onClick={() => setShowSubtasks(!showSubtasks)}
              className="flex items-center gap-2 w-full mb-1"
            >
              <div className="flex-1 flex items-center gap-3">
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Subtasks ({subtasks.length})</span>
                <div className="h-px flex-1" style={{ background: '#2e3235' }} />
              </div>
              {subtasks.length > 0 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    if (pipelineRunning) return
                    runPipeline()
                  }}
                  className="ml-1 inline-flex items-center gap-1.5 hover:opacity-80 cursor-pointer transition-colors"
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--accent)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
                    opacity: pipelineRunning ? 0.5 : 1,
                  }}
                  title={`Queue one dispatch per subtask, wired by their blocked_by relationships`}
                >
                  <IconClaude size={11} />
                  {pipelineRunning ? 'Queuing…' : 'Run pipeline'}
                </span>
              )}
              <span
                onClick={(e) => { e.stopPropagation(); setShowSubtaskInput(true); setShowSubtasks(true) }}
                className="ml-1 hover:text-text/80 cursor-pointer transition-colors"
                style={{ fontSize: 12, color: 'var(--text-muted)' }}
              >
                + Add
              </span>
            </button>
            {pipelineToast && (
              <div
                style={{
                  marginTop: 6,
                  marginBottom: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
                  border: '1px solid color-mix(in oklab, var(--accent) 20%, transparent)',
                }}
              >
                {pipelineToast}
              </div>
            )}
            {showSubtasks && subtasks.map((st) => {
              const stPriority = priorityOptions.find(p => p.value === st.priority)
              return (
                <div key={st.id} className="flex items-center gap-2 py-1.5 group">
                  <button
                    onClick={async () => {
                      const newStatus = st.status === 'done' ? 'todo' : 'done'
                      await fetch('/api/tasks', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: st.id, status: newStatus, ...(newStatus === 'done' ? { completed_at: Math.floor(Date.now() / 1000) } : { completed_at: null }) }),
                      })
                      setSubtasks(prev => prev.map(s => s.id === st.id ? { ...s, status: newStatus as Task['status'] } : s))
                    }}
                    className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                      st.status === 'done' ? 'bg-accent border-accent' : 'border-border-strong hover:border-text-dim'
                    }`}
                  >
                    {st.status === 'done' && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6l2.5 2.5 4.5-5" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <span className={`text-[13px] flex-1 ${st.status === 'done' ? 'line-through' : ''}`} style={{ color: st.status === 'done' ? 'var(--text-muted)' : 'var(--text)' }}>{st.title}</span>
                  {stPriority && (
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stPriority.color }} />
                  )}
                </div>
              )
            })}
            {showSubtasks && showSubtaskInput && (
              <div className="flex items-center gap-2 py-1.5">
                <div className="flex h-4 w-4 items-center justify-center rounded border border-border-strong shrink-0" />
                <input
                  autoFocus
                  value={subtaskTitle}
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && subtaskTitle.trim()) {
                      const res = await fetch('/api/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          title: subtaskTitle.trim(),
                          parent_task_id: taskId,
                          project_id: task.project_id,
                          workspace_id: task.workspace_id,
                          assignee: task.assignee || undefined,
                        }),
                      })
                      const data = await res.json()
                      if (data.task) setSubtasks(prev => [...prev, data.task])
                      setSubtaskTitle('')
                    }
                    if (e.key === 'Escape') {
                      setShowSubtaskInput(false)
                      setSubtaskTitle('')
                    }
                  }}
                  onBlur={() => {
                    if (!subtaskTitle.trim()) {
                      setShowSubtaskInput(false)
                      setSubtaskTitle('')
                    }
                  }}
                  placeholder="Subtask title"
                  className="flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/40"
                />
              </div>
            )}
          </div>

          {/* Attachments */}
          <div className="py-2 px-6">
            <button
              onClick={() => setShowAttachments(!showAttachments)}
              className="flex items-center gap-2 w-full"
            >
              <div className="flex-1 flex items-center gap-3">
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Attachments ({attachments.length})</span>
                <div className="h-px flex-1" style={{ background: '#2e3235' }} />
              </div>
              <span
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                className="ml-1 hover:text-text/80 cursor-pointer transition-colors"
                style={{ fontSize: 12, color: 'var(--text-muted)' }}
              >
                + Add
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            {showAttachments && attachments.length > 0 && (
              <div className="mt-3 space-y-2">
                {attachments.map((att) => (
                  <div key={att.id} className="flex items-center gap-2 rounded-md bg-elevated px-3 py-2 text-[13px]">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-white shrink-0">
                      <path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6L9 2z" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                    <a
                      href={`/api/attachments/file?name=${encodeURIComponent(att.filepath)}`}
                      target="_blank"
                      rel="noopener"
                      className="flex-1 text-white hover:text-accent-text truncate"
                    >
                      {att.filename}
                    </a>
                    <span className="text-white shrink-0">{formatFileSize(att.size)}</span>
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="text-white hover:text-red-400 shrink-0"
                    >
                      <IconX size={12} strokeWidth={1.3} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity -- compact section */}
          <div className="py-2 px-6 shrink-0">
            <div className="flex items-center gap-3 mb-3">
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Activity</span>
              <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
            </div>

            {/* Comment input */}
            <div className="mb-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
                placeholder="Enter comment"
                className="w-full rounded-md px-2.5 py-1.5 text-[14px] outline-none transition-colors focus:border-[color:var(--accent)]"
                style={{ background: 'var(--bg-field)', color: 'var(--text)', border: '1px solid var(--border)' }}
              />
            </div>

            {/* Activity entries -- show max 4 recent */}
            <div className="space-y-2 max-h-[160px] overflow-y-auto">
              {activities.slice(0, 4).map((a, idx) => (
                <div key={a.id} className="stagger-item" style={{ animationDelay: `${idx * 30}ms` }}>
                  <ActivityEntry
                    avatar={a.agent_id ? a.agent_id[0].toUpperCase() : 'D'}
                    avatarColor={a.activity_type === 'comment' ? '#42a5f5' : 'var(--text-muted)'}
                    text={a.message}
                    time={formatTimestamp(a.created_at)}
                    type={a.activity_type}
                  />
                </div>
              ))}
              <ActivityEntry
                avatar="S"
                avatarColor="var(--text-muted)"
                text="Task created"
                time={formatTimestamp(task.created_at)}
              />
              {task.completed_at && (
                <ActivityEntry
                  avatar="✓"
                  avatarColor="#00e676"
                  text="Status changed to Completed"
                  time={formatTimestamp(task.completed_at)}
                />
              )}
            </div>
          </div>

          {/* Status Updates */}
          <div className="py-2 px-6 shrink-0">
            <button
              onClick={() => setShowStatusUpdates(!showStatusUpdates)}
              className="flex items-center gap-3 w-full mb-2"
            >
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                Status Updates{statusUpdates.length > 0 ? ` (${statusUpdates.length})` : ''}
              </span>
              <div className="h-px flex-1" style={{ background: '#2e3235' }} />
            </button>

            {showStatusUpdates && (
              <>
                {/* Add update input */}
                <div className="mb-2 flex gap-2">
                  <textarea
                    value={statusUpdateText}
                    onChange={(e) => setStatusUpdateText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && statusUpdateText.trim()) { e.preventDefault(); submitStatusUpdate() } }}
                    placeholder="Add a status update..."
                    rows={2}
                    className="flex-1 rounded-lg border border-border px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-border-strong resize-none"
                    style={{ background: 'var(--bg-chrome)' }}
                  />
                  <button
                    onClick={submitStatusUpdate}
                    disabled={!statusUpdateText.trim()}
                    className="self-end px-3 py-1.5 rounded-lg bg-accent text-white font-bold text-[13px] font-medium hover:bg-accent/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Post
                  </button>
                </div>

                {/* Update entries */}
                <div className="space-y-2.5 max-h-[200px] overflow-y-auto">
                  {statusUpdates.length === 0 && (
                    <p className="text-[13px] text-text-dim">No status updates yet</p>
                  )}
                  {statusUpdates.map((su) => (
                    <div key={su.id} className="rounded-lg bg-[#2a2a2e] border border-border/50 px-3 py-2">
                      <p className="text-[13px] whitespace-pre-wrap">{su.content}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] text-text-dim">{su.author || 'Operator'}</span>
                        <span className="text-[10px] text-text-dim">{formatTimestamp(su.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right pane: Properties */}
      <div className="w-[300px] shrink-0 overflow-y-auto rounded-r-lg border-l" style={{ background: 'var(--bg-chrome)', borderLeftColor: 'rgba(255,255,255,0.06)' }}>
        {isDone && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#00e67612] text-[#00e676] text-[13px] font-medium">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Task complete
          </div>
        )}
        {isArchived && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#4a4a4a18] text-[#9ca3af] text-[13px] font-medium">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3 7v5a1 1 0 001 1h8a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6.5 9.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Archived
          </div>
        )}

        {/* Task status banner */}
        {(() => {
          const isDone = task.status === 'done'
          const isCancelled = task.status === 'cancelled'
          const isArchived = task.status === 'archived'
          if (isDone) {
            return (
              <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium" style={{ background: 'rgba(0, 230, 118, 0.15)', color: '#00e676' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#00e676" fillOpacity="0.3" stroke="#00e676" strokeWidth="1.5"/><path d="M5 8l2 2 4-4" stroke="#00e676" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Completed
              </div>
            )
          }
          if (isCancelled) {
            return (
              <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium" style={{ background: 'rgba(107, 114, 128, 0.15)', color: 'var(--text-muted)' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--text-muted)" strokeWidth="1.5"/><path d="M5 5l6 6M11 5l-6 6" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                Cancelled
              </div>
            )
          }
          if (isArchived) return null // already shown above
          return (
            <>
              {task.locked_at && (
                <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium" style={{ background: 'rgba(96, 165, 250, 0.12)', color: '#60a5fa' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="#60a5fa" strokeWidth="1.3"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="#60a5fa" strokeWidth="1.3" strokeLinecap="round"/><circle cx="8" cy="10.5" r="1" fill="#60a5fa"/></svg>
                  Locked
                </div>
              )}
              {(() => {
                const ts = getTaskState(task)
          const bannerConfig: Record<string, { bg: string; fg: string; icon: React.ReactNode }> = {
            on_time: {
              bg: 'rgba(0, 230, 118, 0.12)',
              fg: '#00e676',
              icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#00e676" fillOpacity="0.3" stroke="#00e676" strokeWidth="1.5"/><path d="M5 8l2 2 4-4" stroke="#00e676" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
            },
            at_risk: {
              bg: 'rgba(255, 215, 64, 0.12)',
              fg: '#ffd740',
              icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 13H2L8 2z" fill="#ffd740" fillOpacity="0.3" stroke="#ffd740" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 6v3M8 11v.5" stroke="#ffd740" strokeWidth="1.5" strokeLinecap="round"/></svg>,
            },
            past_due: {
              bg: 'rgba(239, 83, 80, 0.12)',
              fg: '#ef5350',
              icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#ef5350" fillOpacity="0.3" stroke="#ef5350" strokeWidth="1.5"/><path d="M8 5v3M8 10v.5" stroke="#ef5350" strokeWidth="1.5" strokeLinecap="round"/></svg>,
            },
            could_not_fit: {
              bg: 'rgba(239, 83, 80, 0.12)',
              fg: '#ef5350',
              icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#ef5350" strokeWidth="1.5"/><path d="M5 5l6 6M11 5l-6 6" stroke="#ef5350" strokeWidth="1.5" strokeLinecap="round"/></svg>,
            },
            no_eta: {
              bg: 'rgba(107, 114, 128, 0.08)',
              fg: 'var(--text-muted)',
              icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--text-muted)" strokeWidth="1.5"/><path d="M8 5v3l2 2" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
            },
          }
          const cfg = bannerConfig[ts.state] || bannerConfig.no_eta
              return (
                <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium" style={{ background: cfg.bg, color: cfg.fg }}>
                  {cfg.icon}
                  {ts.state === 'on_time' ? 'On track' : ts.state === 'at_risk' ? 'At risk' : ts.state === 'past_due' ? 'Past due' : ts.state === 'could_not_fit' ? 'Could not fit' : 'When I can'}
                </div>
              )
              })()}
            </>
          )
        })()}

        <div className="px-4 pt-4 pb-2">
          {/* Hierarchy: Workspace / Folder / Project */}
          <div className="flex flex-col gap-3 text-[14px] text-white">
            {meta.workspaceName && (
              <div className="flex items-center gap-2">
                <IconWorkspace size={18} className="shrink-0" style={{ color: meta.workspaceColor || 'var(--text-secondary)' }} />
                <span>{meta.workspaceName}</span>
              </div>
            )}
            <div
              className="flex items-center gap-2 cursor-pointer hover:text-text transition-colors"
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                setFolderPopupPos({ top: rect.bottom + 4, left: rect.left })
                setFolderPopupOpen(true)
                setFolderFilter('')
              }}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: meta.folderName ? (meta.folderColor || 'var(--text-secondary)') : 'var(--text-dim)' }}>
                <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span>{meta.folderName || 'No folder'}</span>
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
                      className="w-full text-[13px] rounded-md px-2.5 py-1 outline-none text-text border border-transparent focus:border-white/15"
                      style={{ background: 'var(--bg-chrome)' }}
                    />
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                    {(() => {
                      const ws = sidebarData.find((w: any) => w.id === task?.workspace_id)
                      if (!ws) return <div className="px-3 py-2 text-sm text-text-dim">No workspace found</div>
                      const q = folderFilter.toLowerCase()
                      const folderMatches = (f: any): boolean =>
                        f.name.toLowerCase().includes(q) || (f.subFolders || []).some((sf: any) => folderMatches(sf))
                      const renderFolders = (folders: any[], depth: number): React.ReactNode =>
                        folders.filter((f: any) => !q || folderMatches(f)).map((f: any) => (
                          <div key={f.id}>
                            <button
                              className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-hover transition-colors"
                              style={{ paddingLeft: 12 + depth * 16 }}
                              onClick={async () => {
                                if (!task?.project_id) return
                                await fetch('/api/projects', {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ id: task.project_id, folder_id: f.id }),
                                })
                                setMeta(prev => ({ ...prev, folderName: f.name, folderColor: f.color }))
                                setFolderPopupOpen(false)
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: f.color || 'var(--text-secondary)' }}>
                                <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
                              </svg>
                              {f.name}
                            </button>
                            {f.subFolders && renderFolders(f.subFolders, depth + 1)}
                          </div>
                        ))
                      return (
                        <>
                          <button
                            className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text-dim hover:bg-hover transition-colors"
                            onClick={async () => {
                              if (!task?.project_id) return
                              await fetch('/api/projects', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: task.project_id, folder_id: null }),
                              })
                              setMeta(prev => ({ ...prev, folderName: undefined, folderColor: undefined }))
                              setFolderPopupOpen(false)
                            }}
                          >
                            <IconX size={14} className="text-text-dim" strokeWidth={1.3} />
                            No folder
                          </button>
                          {renderFolders(ws.folders || [], 0)}
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>,
              document.body
            )}
            {meta.projectName && (
              <div
                className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => window.location.href = `/project/${(task as any).project_public_id || task.project_id}`}
              >
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: meta.projectColor || '#ef5350' }}>
                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <span>{meta.projectName}</span>
                <span className="ml-auto text-[10px] text-text-dim border border-border rounded px-1.5 py-0.5 hover:bg-hover">
                  Open
                </span>
              </div>
            )}
          </div>

          <div style={{ height: 16 }} />

          {/* Auto-schedule */}
          <AutoScheduleToggle
            active={!!task.auto_schedule}
            onChange={() => saveField('auto_schedule', task.auto_schedule ? 0 : 1)}
            variant="banner"
            scheduledDate={task.scheduled_start}
          />

          {/* Lock indicator — shown when task is manually pinned to a time slot */}
          {!task.auto_schedule && (task as any).locked_at && (
            <div className="mx-0 mt-2 flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: 'rgba(241,237,229,0.1)', border: '1px solid rgba(241,237,229,0.2)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0" style={{ color: 'var(--accent)' }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <span className="text-[12px] font-medium" style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>LOCKED TO CALENDAR</span>
              <button
                onClick={() => saveField('auto_schedule', 1)}
                className="ml-auto text-[11px] text-text-dim hover:text-text transition-colors"
                title="Switch to auto-schedule"
              >
                Auto-schedule
              </button>
            </div>
          )}


          <div style={{ height: 16 }} />

          {/* ASAP toggle */}
          <PropertyRow label="ASAP:">
            <button
              onClick={() => saveField('is_asap', (task as unknown as { is_asap?: number }).is_asap ? 0 : 1)}
              className="flex items-center gap-1.5 text-[13px]"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className={(task as unknown as { is_asap?: number }).is_asap ? 'text-amber-400' : 'text-text-dim'}>
                <path d="M8 1l2 5h5l-4 3.5 1.5 5L8 11.5 3.5 14.5 5 9.5 1 6h5l2-5z" fill="currentColor"/>
              </svg>
              {(task as unknown as { is_asap?: number }).is_asap ? (
                <span className="text-amber-400 font-medium">ASAP - Scheduled first</span>
              ) : (
                <span className="text-text-dim">Normal priority</span>
              )}
            </button>
          </PropertyRow>

          {/* Task Type removed -- not in Motion */}

          {/* Recurrence */}
          <PropertyRow label="Repeat:">
            <Dropdown
              value={(() => {
                if (!task.recurrence_rule) return 'none'
                try { return JSON.parse(task.recurrence_rule).type || 'none' } catch { return 'none' }
              })()}
              onChange={(type) => {
                if (type === 'none') {
                  saveField('recurrence_rule', null)
                } else {
                  const rule: { type: string; interval: number; days?: number[] } = { type, interval: 1 }
                  if (type === 'weekly') rule.days = [new Date().getDay()]
                  saveField('recurrence_rule', JSON.stringify(rule))
                }
              }}
              options={[
                { value: 'none', label: 'None' },
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
              triggerClassName="flex items-center gap-1.5 text-[13px] text-text hover:opacity-80 transition-opacity cursor-pointer"
              minWidth={120}
            />
          </PropertyRow>
          {/* Recurrence details */}
          {task.recurrence_rule && (() => {
            let rule: { type: string; interval: number; days?: number[] } | null = null
            try { rule = JSON.parse(task.recurrence_rule) } catch { /* skip */ }
            if (!rule) return null
            const updateRule = (patch: Partial<typeof rule>) => {
              saveField('recurrence_rule', JSON.stringify({ ...rule, ...patch }))
            }
            return (
              <>
                <PropertyRow label="Every:">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={rule.interval}
                      onChange={(e) => updateRule({ interval: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-10 bg-transparent text-[13px] text-text border border-border rounded px-1 py-0.5 outline-none text-center"
                    />
                    <span className="text-[13px] text-text-dim">
                      {rule.type === 'daily' ? (rule.interval === 1 ? 'day' : 'days') :
                       rule.type === 'weekly' ? (rule.interval === 1 ? 'week' : 'weeks') :
                       rule.interval === 1 ? 'month' : 'months'}
                    </span>
                  </div>
                </PropertyRow>
                {rule.type === 'weekly' && (
                  <PropertyRow label="On:">
                    <div className="flex gap-1">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, dayIndex) => {
                        const isActive = (rule!.days || []).includes(dayIndex)
                        return (
                          <button
                            key={dayIndex}
                            onClick={() => {
                              const current = rule!.days || []
                              const next = isActive
                                ? current.filter(d => d !== dayIndex)
                                : [...current, dayIndex]
                              if (next.length > 0) updateRule({ days: next.sort((a, b) => a - b) })
                            }}
                            className={`w-6 h-6 rounded text-[10px] font-medium border transition-colors ${
                              isActive
                                ? 'bg-accent text-white border-accent'
                                : 'bg-transparent text-text-dim border-border hover:border-text-dim'
                            }`}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </PropertyRow>
                )}
              </>
            )
          })()}

          {/* Stage */}
          {meta.stages && meta.stages.length > 0 && (
            <PropertyRow label="Stage:">
              <Dropdown
                value={String(task.stage_id || '')}
                onChange={(v) => saveField('stage_id', v ? Number(v) : null)}
                placeholder="None"
                options={[
                  { value: '', label: 'None' },
                  ...meta.stages.map(s => ({ value: String(s.id), label: s.name, color: s.color })),
                ]}
                renderTrigger={() => {
                  const stage = meta.stages?.find(s => s.id === task.stage_id)
                  return (
                    <button type="button" className="flex items-center gap-1.5 text-[13px] hover:opacity-80 transition-opacity cursor-pointer">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-text-dim"><path d="M3 8h7M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {stage ? (
                        <StagePill name={stage.name} color={stage.color} size="md" />
                      ) : (
                        <span className="text-text-dim">None</span>
                      )}
                    </button>
                  )
                }}
                minWidth={120}
              />
            </PropertyRow>
          )}

          {/* Assignee */}
          <PropertyRow label="Assignee:">
            <Dropdown
              value={assigneeDropdownValue}
              onChange={(v) => saveField('assignee', v || null)}
              options={[
                { value: '', label: 'Unassigned' },
                ...assigneeOptions.map(a => ({ value: a.id, label: a.name })),
              ]}
              renderOption={(opt, isSelected) => {
                const m = assigneeOptions.find(a => a.id === opt.value)
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
                const a = assigneeOptions.find(x => x.id === selected?.value) || currentAssignee
                return (
                  <button type="button" className="flex items-center gap-2 text-[13px] hover:opacity-80 transition-opacity cursor-pointer">
                    {a ? (
                      <>
                        <Avatar name={a.name} size={18} src={a.avatar} color={a.color} />
                        <span className="text-text">{a.name}</span>
                      </>
                    ) : task.assignee ? (
                      <>
                        <Avatar name={task.assignee} size={18} />
                        <span className="text-text">{task.assignee}</span>
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
          </PropertyRow>

          {/* Dispatch */}
          {task.status !== 'done' && (
            <PropertyRow label="">
              {dispatchStatus ? (
                <button
                  onClick={() => window.location.href = '/dispatch'}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors hover:opacity-80"
                  style={{
                    background: dispatchStatus === 'working' ? '#3b82f620' : dispatchStatus === 'needs_review' ? '#f9731620' : dispatchStatus === 'done' ? '#22c55e20' : '#eab30820',
                    color: dispatchStatus === 'working' ? '#3b82f6' : dispatchStatus === 'needs_review' ? '#f97316' : dispatchStatus === 'done' ? '#22c55e' : '#eab308',
                  }}
                  title="View in Dispatch Board"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${dispatchStatus === 'working' ? 'animate-pulse' : ''}`} style={{
                    background: dispatchStatus === 'working' ? '#3b82f6' : dispatchStatus === 'needs_review' ? '#f97316' : dispatchStatus === 'done' ? '#22c55e' : '#eab308',
                  }} />
                  {dispatchStatus === 'working' ? 'Working...' : dispatchStatus === 'needs_review' ? 'Needs Review' : dispatchStatus === 'done' ? 'Done' : 'Queued'}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Dropdown
                    value={dispatchAgent}
                    onChange={setDispatchAgent}
                    options={DISPATCH_AGENT_OPTIONS}
                    minWidth={170}
                    renderTrigger={({ selected }) => (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border)] px-2 py-1 text-[11px] font-medium text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-elevated)] transition-colors"
                      >
                        {selected?.label || 'Orchestrator Team'}
                      </button>
                    )}
                  />
                  <button
                    onClick={async () => {
                      const res = await fetch('/api/dispatch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ taskId: task.id, agentId: dispatchAgent, teamMode: dispatchAgent === 'team' }),
                      })
                      const data = await res.json()
                      if (data.ok) {
                        const updated = await fetch(`/api/tasks?id=${task.public_id || task.id}`).then(r => r.json())
                        setTask(updated.task || updated)
                        setDispatchStatus(data.dispatch?.status || 'queued')
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-md bg-[#2a2d30] border border-[#3a3d40] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#35383b] transition-colors"
                    title={`Dispatch via ${selectedDispatchAgent.label}`}
                  >
                    <IconClaude size={13} style={{ color: '#DA7756' }} />
                    Dispatch
                  </button>
                </div>
              )}
            </PropertyRow>
          )}

          {/* Status */}
          <PropertyRow label="Status:">
            <Dropdown
              value={task.status}
              onChange={(v) => saveField('status', v)}
              options={TASK_STATUS_OPTIONS}
              renderOption={renderStatusOption}
              renderTrigger={({ selected }) => (
                <StatusTrigger status={selected?.value || task.status} />
              )}
              minWidth={120}
            />
          </PropertyRow>

          {/* Priority */}
          <PropertyRow label="Priority:">
            <Dropdown
              value={task.priority}
              onChange={(v) => saveField('priority', v)}
              options={priorityOptions.map(p => ({ value: p.value, label: p.label }))}
              renderOption={renderPriorityOption}
              renderTrigger={({ selected }) => (
                <button type="button" className="flex items-center gap-1.5 text-[13px] text-text hover:opacity-80 transition-opacity cursor-pointer">
                  <PriorityIcon priority={task.priority} size={14} />
                  <span style={{ color: PRIORITY_CONFIG[task.priority]?.color }}>{selected?.label || 'Medium'}</span>
                </button>
              )}
              minWidth={120}
            />
          </PropertyRow>

          <div className="h-1" />

          {/* Duration */}
          <PropertyRow label="Duration:">
            <DurationPicker
              value={task.duration_minutes}
              completed={task.completed_time_minutes}
              onChange={(v) => saveField('duration_minutes', v)}
            />
          </PropertyRow>

          {/* Effort removed -- not in Motion */}

          {/* Min chunk */}
          <div className="flex items-center gap-2 pl-6" style={{ height: 33, marginBottom: 7 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
              <path d="M2 2v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Min chunk:</span>
            <ChunkPicker
              value={task.min_chunk_minutes || 0}
              onChange={(v) => saveField('min_chunk_minutes', v)}
            />
          </div>

          {/* Start date */}
          <PropertyRow label="Start date:">
            <DatePicker
              value={task.start_date}
              onChange={(v) => saveField('start_date', v)}
              icon="start"
            />
          </PropertyRow>

          {/* Deadline */}
          <PropertyRow label="Deadline:">
            <DatePicker
              value={task.due_date}
              onChange={(v) => saveField('due_date', v)}
              icon="deadline"
            />
          </PropertyRow>

          {/* Hard deadline */}
          <div className="flex items-center gap-2 pl-6" style={{ height: 33, marginBottom: 7 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
              <path d="M2 2v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Hard deadline:</span>
            <button
              onClick={() => saveField('hard_deadline', task.hard_deadline ? 0 : 1)}
              className={`flex h-4 w-7 items-center rounded-full transition-colors ${
                task.hard_deadline ? 'bg-accent' : 'bg-border-strong'
              }`}
            >
              <div
                className={`h-3 w-3 rounded-full bg-white transition-transform ${
                  task.hard_deadline ? 'translate-x-[13px]' : 'translate-x-[2px]'
                }`}
              />
            </button>
          </div>

          {/* Capacity warning */}
          {capacityWarning && (
            <div className="mx-6 mb-2 px-2.5 py-1.5 rounded-md text-[11px] flex flex-col gap-0.5" style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.25)', color: '#eab308' }}>
              <span className="font-medium">{capacityWarning.message}</span>
              <span style={{ color: '#ca8a04' }}>{capacityWarning.suggestion}</span>
            </div>
          )}

          {/* Schedule (delivery block) */}
          <PropertyRow label="Schedule:">
            <Dropdown
              value={String(task.schedule_id || '')}
              onChange={(v) => saveField('schedule_id', v ? Number(v) : null)}
              placeholder="Default"
              options={[
                { value: '', label: 'Default' },
                ...schedules.map(s => ({ value: String(s.id), label: s.name })),
              ]}
              triggerClassName="flex items-center gap-1.5 text-[13px] text-text hover:opacity-80 transition-opacity cursor-pointer"
              minWidth={140}
            />
          </PropertyRow>

          <div className="h-1" />

          {/* Labels */}
          <PropertyRow label="Labels:">
            <LabelPicker
              currentLabels={task.labels || ''}
              allLabels={allLabels}
              onUpdate={(val) => saveField('labels', val || null)}
              onLabelsRefresh={() => fetch('/api/labels').then(r => r.json()).then(d => { if (Array.isArray(d)) setAllLabels(d) }).catch(() => {})}
            />
          </PropertyRow>

          {/* CRM contact link (shown when the task is tied to a contact) */}
          {meta.contactName && meta.contactId && (
            <PropertyRow label="Contact:">
              <a
                href={`/crm/contacts/${meta.contactId}`}
                className="text-[13px] text-text hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                {meta.contactName}
              </a>
            </PropertyRow>
          )}

          {/* Custom Fields */}
          {customFields.length > 0 && (
            <>
              <div className="h-1" />
              {customFields.map(cf => (
                <PropertyRow key={cf.id} label={`${cf.name}:`}>
                  <CustomFieldInput
                    field={cf}
                    value={customFieldValues[cf.id] || ''}
                    onChange={async (val) => {
                      setCustomFieldValues(prev => ({ ...prev, [cf.id]: val }))
                      await fetch('/api/workspaces/custom-fields', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ taskId: task.id, fieldId: cf.id, value: val }),
                      })
                    }}
                  />
                </PropertyRow>
              ))}
            </>
          )}

          <div className="h-3" />

          {/* Blocked By - Interactive Picker */}
          <div ref={blockerPickerRef}>
            <div className="flex items-center gap-1.5 relative" style={{ height: 28, marginBottom: 2 }}>
              <span className="shrink-0 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Blocked By:</span>
              <div className="min-w-0 flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-red-400 shrink-0">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {parseBlockedBy(task.blocked_by).length > 0 ? (
                  <span className="group relative cursor-default">
                    <span className="text-[13px] text-red-400 font-medium">{parseBlockedBy(task.blocked_by).length} task{parseBlockedBy(task.blocked_by).length !== 1 ? 's' : ''}</span>
                    <div className="hidden group-hover:block absolute left-0 top-full mt-1 z-[9999] rounded-lg shadow-xl py-2 px-3 whitespace-nowrap" style={{ background: '#fff', minWidth: 200 }}>
                      {parseBlockedBy(task.blocked_by).map(blockerId => {
                        const blockerTask = projectTasks.find(t => t.id === blockerId)
                        return (
                          <div key={blockerId} className="flex items-center gap-1.5 py-1 text-[12px] text-[var(--bg-chrome)] font-medium">
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="#ef4444" strokeWidth="1.5" /></svg>
                            {blockerTask?.title || `Task #${blockerId}`}
                          </div>
                        )
                      })}
                    </div>
                  </span>
                ) : (
                  <span className="text-[13px] text-text font-medium">None</span>
                )}
              </div>
              <button
                onClick={() => { setShowBlockerPicker(!showBlockerPicker); if (!showBlockerPicker) fetchProjectTasks() }}
                className="text-[11px] text-text-dim hover:text-text shrink-0"
              >
                + Add task
              </button>
            </div>

            {/* Picker dropdown */}
            {showBlockerPicker && (
              <div className="ml-[80px] mt-1 rounded-lg border border-border-strong glass-elevated overflow-hidden" style={{ marginBottom: 4 }}>
                <input
                  type="text"
                  value={blockerSearch}
                  onChange={e => setBlockerSearch(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-full px-2.5 py-1 text-[13px] border-b border-border text-text outline-none placeholder:text-text-dim"
                  style={{ background: 'var(--bg-chrome)' }}
                  autoFocus
                />
                  <div className="max-h-[200px] overflow-y-auto">
                    {(() => {
                      const currentBlockerIds = parseBlockedBy(task.blocked_by)
                      const available = projectTasks.filter(t =>
                        t.id !== task.id &&
                        !currentBlockerIds.includes(t.id) &&
                        t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'archived' &&
                        (!blockerSearch || t.title.toLowerCase().includes(blockerSearch.toLowerCase()))
                      )
                      const stages = new Map<string, typeof available>()
                      available.forEach(t => {
                        const key = t.stage_name || 'No Stage'
                        if (!stages.has(key)) stages.set(key, [])
                        stages.get(key)!.push(t)
                      })
                      if (stages.size === 0) return <div className="px-3 py-2 text-[11px] text-text-dim">No tasks available</div>
                      return Array.from(stages.entries()).map(([stageName, tasks]) => (
                        <div key={stageName}>
                          <div className="px-3 py-1 text-[10px] text-text-dim/60 uppercase tracking-wider bg-[rgba(255,255,255,0.03)]">{stageName}</div>
                          {tasks.map(t => (
                            <button
                              key={t.id}
                              onClick={() => {
                                updateBlockers([...currentBlockerIds, t.id])
                                setShowBlockerPicker(false)
                                setBlockerSearch('')
                              }}
                              className="w-full text-left px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors truncate"
                            >
                              {t.title}
                            </button>
                          ))}
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              )}
          </div>

          {/* Blocking - Read-only with hover */}
          <div className="flex items-center gap-1.5" style={{ height: 28, marginBottom: 2 }}>
            <span className="shrink-0 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Blocking:</span>
            <div className="min-w-0 flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-orange-400 shrink-0">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {parseBlockedBy(task.blocking).length > 0 ? (
                <span className="group relative cursor-default">
                  <span className="text-[13px] text-orange-400 font-medium">{parseBlockedBy(task.blocking).length} task{parseBlockedBy(task.blocking).length !== 1 ? 's' : ''}</span>
                  <div className="hidden group-hover:block absolute left-0 top-full mt-1 z-50 rounded-lg shadow-xl py-2 px-3 whitespace-nowrap" style={{ background: '#fff', minWidth: 200 }}>
                    {parseBlockedBy(task.blocking).map(blockedId => {
                      const blockedTask = projectTasks.find(t => t.id === blockedId)
                      return (
                        <div key={blockedId} className="flex items-center gap-1.5 py-1 text-[12px] text-[var(--bg-chrome)] font-medium">
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="#f97316" strokeWidth="1.5" /></svg>
                          {blockedTask?.title || `Task #${blockedId}`}
                        </div>
                      )
                    })}
                  </div>
                </span>
              ) : (
                <span className="text-[13px] text-text font-medium">None</span>
              )}
            </div>
          </div>

          {/* Pinned to calendar indicator */}
          {!task.auto_schedule && task.scheduled_start && task.locked_at && (
            <div className="pt-4 pb-1 border-t border-border mt-3">
              <div className="flex items-center gap-2">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-accent shrink-0">
                  <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M5 1v4M11 1v4M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span className="text-[13px] text-text flex-1">
                  {new Date(task.scheduled_start).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <button
                  onClick={async () => {
                    const formData = new FormData()
                    formData.set('id', String(task.id))
                    formData.set('scheduled_start', '')
                    formData.set('scheduled_end', '')
                    formData.set('locked_at', '')
                    await updateTaskAction(formData)
                    const updated = await fetch(`/api/tasks?id=${task.public_id || task.id}`).then(r => r.json())
                    setTask(updated.task || updated)
                    if (updated.meta) setMeta(updated.meta)
                    window.dispatchEvent(new CustomEvent('task-changed', { detail: { taskId: task.id } }))
                  }}
                  className="px-3 py-1.5 rounded-md text-[13px] text-text-dim bg-hover hover:bg-border transition-colors shrink-0"
                >
                  Unpin
                </button>
              </div>
            </div>
          )}

          {/* Archive / Unarchive */}
          <div className="pt-3">
            {isArchived ? (
              <button
                onClick={() => saveField('status', 'backlog')}
                className="flex items-center gap-2 text-[13px] text-text-dim hover:text-text-secondary"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M3 7v5a1 1 0 001 1h8a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8 12V9M6 11l2-2 2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Unarchive task
              </button>
            ) : (
              <button
                onClick={() => saveField('status', 'archived')}
                className="flex items-center gap-2 text-[13px] text-text-dim hover:text-text-secondary"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M3 7v5a1 1 0 001 1h8a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M6.5 9.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Archive task
              </button>
            )}
          </div>

          {/* Delete */}
          <div className="pt-2">
            <button
              onClick={handleDeleteTask}
              className="flex items-center gap-2 text-[13px] text-red-400 hover:text-red-300"
            >
              <IconTrash size={13} strokeWidth={1.3} />
              Delete task
            </button>
          </div>
        </div>
      </div>
      </div>
      </div>
      {copyToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-elevated border border-border rounded-lg px-4 py-2 text-[13px] text-text shadow-xl">
          Task copied
        </div>
      )}

      {/* Recurrence edit/delete dialog */}
      {recurrenceDialog && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
          onClick={() => setRecurrenceDialog(null)}
        >
          <div
            className="w-[360px] animate-glass-in rounded-xl border border-border-strong overflow-hidden"
            style={{ background: 'var(--bg-modal)', boxShadow: 'var(--glass-shadow-lg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                  {recurrenceDialog.mode === 'edit' ? (
                    <IconEdit size={16} className="text-accent-text" strokeWidth={1.3} />
                  ) : (
                    <IconTrash size={16} className="text-red-400" strokeWidth={1.3} />
                  )}
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-text">
                    {recurrenceDialog.mode === 'edit' ? 'Edit Recurring Task' : 'Delete Recurring Task'}
                  </h3>
                  <p className="text-[13px] text-text-dim">This task is part of a recurring series</p>
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="px-4 pb-2 space-y-1.5">
              <button
                onClick={() =>
                  recurrenceDialog.mode === 'edit'
                    ? handleRecurrenceEdit('this')
                    : handleRecurrenceDelete('this')
                }
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-hover transition-colors group"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#333] group-hover:bg-[#3a3a3e] shrink-0">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-secondary">
                    <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </div>
                <div>
                  <span className="text-[13px] font-medium text-text">
                    {recurrenceDialog.mode === 'edit' ? 'Edit this occurrence' : 'Delete this occurrence'}
                  </span>
                  <p className="text-[12px] text-text-dim">
                    {recurrenceDialog.mode === 'edit'
                      ? 'Detach from series and apply changes to this task only'
                      : 'Only remove this single occurrence'}
                  </p>
                </div>
              </button>

              <button
                onClick={() =>
                  recurrenceDialog.mode === 'edit'
                    ? handleRecurrenceEdit('all')
                    : handleRecurrenceDelete('all')
                }
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-hover transition-colors group"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#333] group-hover:bg-[#3a3a3e] shrink-0">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-secondary">
                    <rect x="2" y="2" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </div>
                <div>
                  <span className="text-[13px] font-medium text-text">
                    {recurrenceDialog.mode === 'edit' ? 'All future occurrences' : 'Delete all occurrences'}
                  </span>
                  <p className="text-[12px] text-text-dim">
                    {recurrenceDialog.mode === 'edit'
                      ? 'Apply changes to the master task and all future instances'
                      : 'Remove the entire recurring series'}
                  </p>
                </div>
              </button>
            </div>

            {/* Cancel */}
            <div className="px-4 pb-4 pt-1">
              <button
                onClick={() => setRecurrenceDialog(null)}
                className="w-full py-2 rounded-lg border border-border text-[13px] text-text-dim hover:bg-hover hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// DURATION_OPTIONS, CHUNK_OPTIONS, formatDuration imported from @/lib/task-constants

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

/** Portal-rendered dropdown anchored to a trigger ref. Avoids overflow clipping. */
function PortalDrop({ anchorRef, open, children, width = 220 }: { anchorRef: React.RefObject<HTMLElement | null>; open: boolean; children: ReactNode; width?: number }) {
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!open || !anchorRef.current) return
    const update = () => {
      const r = anchorRef.current!.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const top = spaceBelow > 280 ? r.bottom + 4 : r.top - 280
      setPos({ top: Math.max(8, top), left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [open, anchorRef, width])
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      {...popupSurfaceDataProps}
      className={withPopupSurfaceClassName('glass-elevated animate-glass-in border border-border-strong rounded-lg shadow-xl py-1')}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 9999, background: 'var(--dropdown-bg)' }}
      onMouseDown={stopPopupMouseDown}
    >
      {children}
    </div>,
    document.body
  )
}

function DurationPicker({ value, completed, onChange }: { value: number; completed: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-[13px]">
        <DurationCircle completed={completed} total={value} />
        <span className="text-text font-medium">{formatDuration(completed)}</span>
        <span className="text-text-dim">of</span>
        <span className="text-text font-medium">{formatDuration(value)}</span>
      </button>
      <PortalDrop anchorRef={ref} open={open} width={220}>
        <div className="px-2 pb-1.5 pt-1">
          <input
            autoFocus
            value={customInput}
            onChange={e => setCustomInput(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={e => {
              if (e.key === 'Enter' && customInput) {
                onChange(Number(customInput))
                setCustomInput('')
                setOpen(false)
              }
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Choose or type a duration"
            className="w-full rounded px-2 py-1 text-[13px] text-text outline-none placeholder:text-text-dim/50 border border-border/50"
            style={{ background: 'var(--bg-chrome)' }}
          />
        </div>
        <div className="max-h-[250px] overflow-y-auto">
          {DURATION_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(Number(opt.value)); setOpen(false) }}
              className={`flex items-center justify-between w-full px-2.5 py-1 text-[13px] text-white transition-colors ${String(value) === opt.value ? '' : 'hover:bg-[rgba(255,255,255,0.06)]'}`}
              style={{ borderRadius: 'var(--radius-sm)' }}
            >
              <span className="truncate">{opt.label}</span>
              {String(value) === opt.value && (
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5.5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
          ))}
        </div>
      </PortalDrop>
    </div>
  )
}

function ChunkPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    // Use 'click' not 'mousedown' — mousedown fires before the item's onClick,
    // causing the portal to unmount before the selection can register
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [open])

  const label = value === 0 ? 'No Chunks' : `${value} min`

  return (
    <div ref={ref}>
      <button onClick={() => setOpen(!open)} className="text-[13px] text-white font-medium hover:text-text-secondary transition-colors">
        {label}
      </button>
      <PortalDrop anchorRef={ref} open={open} width={180}>
        {CHUNK_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => { onChange(Number(opt.value)); setOpen(false) }}
            className={`flex items-center justify-between w-full px-2.5 py-1 text-[13px] text-white transition-colors ${String(value) === opt.value ? '' : 'hover:bg-[rgba(255,255,255,0.06)]'}`}
            style={{ borderRadius: 'var(--radius-sm)' }}
          >
            <span className="truncate">{opt.label}</span>
            {String(value) === opt.value && (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5.5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </button>
        ))}
      </PortalDrop>
    </div>
  )
}

function DatePicker({ value, onChange, icon }: { value: string | null; onChange: (v: string | null) => void; icon: 'start' | 'deadline' }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const isToday = value && formatDateFriendly(value) === 'Today'
  const isPast = value && new Date(value + 'T00:00:00') < new Date(new Date().toDateString())

  return (
    <div className="flex items-center gap-1.5" ref={anchorRef}>
      <button onClick={() => setOpen(!open)} className="text-text-dim hover:text-text transition-colors">
        {icon === 'start' ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="8" cy="10" r="1" fill="currentColor" /></svg>
        )}
      </button>
      <button
        onClick={() => setOpen(!open)}
        className={`text-[13px] font-medium transition-colors ${
          isToday ? 'text-purple-400' : isPast && icon === 'deadline' ? 'text-red-400' : value ? 'text-text' : 'text-text-dim'
        }`}
      >
        {formatDateFriendly(value)}
      </button>
      {value && (
        <button onClick={() => onChange(null)} className="text-text-dim hover:text-text-secondary ml-1">
          <IconX size={10} strokeWidth={1.3} />
        </button>
      )}
      {open && (
        <CalendarDropdown
          value={value ? new Date(value + 'T00:00:00') : new Date()}
          onChange={(d) => {
            if (d.getFullYear() < 2000) {
              onChange(null)
            } else {
              const pad = (n: number) => n.toString().padStart(2, '0')
              onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
            }
          }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </div>
  )
}

function ToolbarBtn({ label, onClick, className }: { label: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={`flex h-7 w-7 items-center justify-center rounded text-[12px] text-text-dim hover:bg-hover hover:text-text-secondary ${className || ''}`}
    >
      {label}
    </button>
  )
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2" style={{ minHeight: 28, marginBottom: 1, paddingTop: 1, paddingBottom: 1 }}>
      <span className="shrink-0" style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>{label}</span>
      <div className="min-w-0 flex items-center gap-2" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{children}</div>
    </div>
  )
}

function DurationCircle({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.min(completed / total, 1) : 0
  const r = 6
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference * (1 - pct)

  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r={r} fill="none" stroke="#3a3a3e" strokeWidth="2" />
      {pct > 0 && (
        <circle
          cx="8" cy="8" r={r}
          fill="none" stroke="#42a5f5" strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 8 8)"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

function ActivityEntry({ avatar, avatarColor, text, time, type }: { avatar: string; avatarColor: string; text: string; time: string; type?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold shrink-0 mt-0.5"
        style={{ backgroundColor: avatarColor + '22', color: avatarColor, border: `1px solid ${avatarColor}33` }}
      >
        {avatar}
      </div>
      <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
        <span className="text-[13px] text-text leading-snug">
          {type === 'comment' && <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>comment</span>}
          {text}
        </span>
        <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>{time}</span>
      </div>
    </div>
  )
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// LabelEditor removed -- now uses shared LabelPicker component

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: { id: number; name: string; field_type: string; options: string | null }
  value: string
  onChange: (val: string) => void
}) {
  const base = "bg-transparent text-[13px] text-text-dim outline-none w-full"

  if (field.field_type === 'checkbox') {
    return (
      <button
        onClick={() => onChange(value === '1' ? '0' : '1')}
        className={`flex h-4 w-7 items-center rounded-full transition-colors ${value === '1' ? 'bg-accent' : 'bg-border-strong'}`}
      >
        <div className={`h-3 w-3 rounded-full bg-white transition-transform ${value === '1' ? 'translate-x-[13px]' : 'translate-x-[2px]'}`} />
      </button>
    )
  }

  if (field.field_type === 'select' || field.field_type === 'multi_select') {
    let options: string[] = []
    try { options = field.options ? JSON.parse(field.options) : [] } catch { /* */ }
    return (
      <Dropdown
        value={value}
        onChange={onChange}
        placeholder="None"
        options={[{ value: '', label: 'None' }, ...options.map(opt => ({ value: opt, label: opt }))]}
        triggerClassName={`${base} cursor-pointer inline-flex items-center gap-1.5`}
        minWidth={140}
      />
    )
  }

  if (field.field_type === 'date') {
    return <CustomDatePicker value={value} onChange={v => onChange(v)} size="sm" />
  }

  if (field.field_type === 'number') {
    return <input type="number" className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={e => onChange(e.target.value)} />
  }

  if (field.field_type === 'url') {
    return (
      <input type="url" placeholder="https://..." className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={e => onChange(e.target.value)} />
    )
  }

  if (field.field_type === 'email') {
    return <input type="email" placeholder="email@..." className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={e => onChange(e.target.value)} />
  }

  if (field.field_type === 'phone') {
    return <input type="tel" placeholder="Phone..." className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={e => onChange(e.target.value)} />
  }

  // Default: text, person, multi_person, related_to
  return <input type="text" placeholder={`${field.name}...`} className={base} value={value} onChange={e => onChange(e.target.value)} onBlur={e => onChange(e.target.value)} />
}
