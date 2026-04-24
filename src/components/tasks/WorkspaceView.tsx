'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { Task, Project, Stage } from '@/lib/types'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { useTabContext } from '@/components/AppShell'
import { ViewToolbar, type ViewMode } from '@/components/toolbar/ViewToolbar'
import { TaskListView } from './TaskListView'
import { KanbanView } from './KanbanView'
import { GanttView } from './GanttView'
import { CalendarView } from './CalendarView'
import { TaskDetailPanel } from './TaskDetailPanel'
import { PRIORITY_ORDER } from '@/lib/task-constants'

interface StageGroup {
  stage: Stage
  tasks: Task[]
}

interface ProjectGroup {
  project: Project
  stageGroups: StageGroup[]
  unstagedTasks: Task[]
}

export function WorkspaceView({
  title,
  projectGroups,
  unassignedTasks,
  allTasks,
  workspaceId,
  workspaceName,
  projectColor,
  projectId,
  folderId,
}: {
  title: string
  projectGroups: ProjectGroup[]
  unassignedTasks: Task[]
  allTasks: Task[]
  workspaceId: number
  workspaceName?: string
  projectColor?: string
  projectId?: number
  folderId?: number
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [currentColor, setCurrentColor] = useState(projectColor)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorTriggerRef = useRef<HTMLButtonElement>(null)
  const [filters, setFilters] = useState({ status: '', priority: '', assignee: '', search: '' })
  const [sortBy, setSortBy] = useState('sort_order')
  const tabCtx = useTabContext()

  // Set tab info for project pages
  useEffect(() => {
    if (!tabCtx || !projectId) return
    const projectName = projectGroups[0]?.project?.name
    if (projectName) {
      tabCtx.setTabInfo(projectName, 'project')
    }
  }, [projectId])

  // Listen for "Create Task" from sidebar
  useEffect(() => {
    function handleOpenTask(e: Event) {
      const taskId = (e as CustomEvent).detail?.taskId
      if (taskId) setSelectedTaskId(taskId)
    }
    window.addEventListener('open-task-detail', handleOpenTask)
    return () => window.removeEventListener('open-task-detail', handleOpenTask)
  }, [])

  async function handlePageColorChange(color: string) {
    setCurrentColor(color)
    setShowColorPicker(false)
    if (folderId) {
      await fetch('/api/folders/cascade-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: folderId, color }),
      })
    } else if (projectId) {
      await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId, color }),
      })
    }
  }

  // Apply filters
  const filteredTasks = useMemo(() => {
    let tasks = allTasks
    if (filters.status) tasks = tasks.filter(t => t.status === filters.status)
    if (filters.priority) tasks = tasks.filter(t => t.priority === filters.priority)
    if (filters.assignee) tasks = tasks.filter(t => t.assignee === filters.assignee)
    if (filters.search) {
      const q = filters.search.toLowerCase()
      tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
    }
    return tasks
  }, [allTasks, filters])

  // Apply filters to project groups
  const filteredProjectGroups = useMemo(() => {
    if (!filters.status && !filters.priority && !filters.assignee && !filters.search) {
      return projectGroups
    }
    const taskIds = new Set(filteredTasks.map(t => t.id))
    return projectGroups.map(pg => ({
      ...pg,
      stageGroups: pg.stageGroups.map(sg => ({
        ...sg,
        tasks: sg.tasks.filter(t => taskIds.has(t.id)),
      })),
      unstagedTasks: pg.unstagedTasks.filter(t => taskIds.has(t.id)),
    }))
  }, [projectGroups, filteredTasks, filters])

  const filteredUnassigned = useMemo(() => {
    if (!filters.status && !filters.priority && !filters.assignee && !filters.search) {
      return unassignedTasks
    }
    const taskIds = new Set(filteredTasks.map(t => t.id))
    return unassignedTasks.filter(t => taskIds.has(t.id))
  }, [unassignedTasks, filteredTasks, filters])

  // Sort for kanban
  const sortedTasks = useMemo(() => {
    const tasks = [...filteredTasks]
    switch (sortBy) {
      case 'priority':
        return tasks.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2))
      case 'due_date':
        return tasks.sort((a, b) => (a.due_date || 'z').localeCompare(b.due_date || 'z'))
      case 'created_at':
        return tasks.sort((a, b) => b.created_at - a.created_at)
      case 'title':
        return tasks.sort((a, b) => a.title.localeCompare(b.title))
      default:
        return tasks
    }
  }, [filteredTasks, sortBy])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center gap-2 relative">
          {(projectId || folderId) && currentColor && (
            <button
              ref={colorTriggerRef}
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="h-4 w-4 rounded-[3px] hover:ring-2 hover:ring-white/30 transition-all shrink-0"
              style={{ backgroundColor: currentColor }}
              title="Change color"
            />
          )}
          {showColorPicker && (
            <ColorPicker
              currentColor={currentColor || '#ef5350'}
              onSelect={handlePageColorChange}
              onClose={() => setShowColorPicker(false)}
              anchorRef={colorTriggerRef}
            />
          )}
          <h1 className="text-[14px] font-semibold text-text">{title}</h1>
          <span className="text-[12px] text-text-dim">{allTasks.length} tasks</span>
        </div>
        <ViewToolbar
          viewMode={viewMode}
          onViewChange={setViewMode}
          filters={filters}
          onFilterChange={setFilters}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-auto ${viewMode === 'calendar' ? 'p-4' : 'p-6'}`}>
        {viewMode === 'list' && (
          <TaskListView
            projectGroups={filteredProjectGroups}
            unassignedTasks={filteredUnassigned}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        )}
        {viewMode === 'kanban' && (
          <KanbanView
            tasks={sortedTasks}
            onSelectTask={setSelectedTaskId}
          />
        )}
        {viewMode === 'gantt' && (
          <GanttView
            tasks={sortedTasks}
            onSelectTask={setSelectedTaskId}
          />
        )}
        {viewMode === 'calendar' && (
          <CalendarView
            tasks={sortedTasks}
            onSelectTask={setSelectedTaskId}
          />
        )}
      </div>

      {/* Detail panel */}
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  )
}

