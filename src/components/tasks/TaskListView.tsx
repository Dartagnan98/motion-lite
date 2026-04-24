'use client'

import { useState, useRef, useCallback } from 'react'
import type { Task, Project, Stage } from '@/lib/types'
import { StagePill } from '@/components/ui/StagePill'
import { TaskRow } from './TaskRow'
import { AddTaskRow } from './AddTaskRow'
import { AddStageRow } from './AddStageRow'

export type ColumnId = 'name' | 'created_at' | 'eta' | 'assignee' | 'project' | 'complete'

export const DEFAULT_COLUMNS: ColumnId[] = ['name', 'created_at', 'eta', 'assignee', 'project', 'complete']

export const COLUMN_CONFIG: Record<ColumnId, { label: string; width: string; align: string }> = {
  name: { label: 'Name', width: 'flex-1 pl-9', align: 'text-left' },
  created_at: { label: 'Created At', width: 'w-[130px]', align: 'text-center' },
  eta: { label: 'ETA', width: 'w-[115px]', align: 'text-center' },
  assignee: { label: 'Assignee', width: 'w-[175px]', align: 'text-center' },
  project: { label: 'Project', width: 'w-[150px]', align: 'text-center' },
  complete: { label: 'Complete', width: 'w-[110px]', align: 'text-center' },
}

interface StageGroup {
  stage: Stage
  tasks: Task[]
}

interface ProjectGroup {
  project: Project
  stageGroups: StageGroup[]
  unstagedTasks: Task[]
}

export function TaskListView({
  projectGroups,
  unassignedTasks,
  workspaceId,
  workspaceName,
  selectedTaskId,
  onSelectTask,
}: {
  projectGroups: ProjectGroup[]
  unassignedTasks: Task[]
  workspaceId: number
  workspaceName?: string
  selectedTaskId?: number | null
  onSelectTask?: (id: number) => void
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS)
  const dragCol = useRef<ColumnId | null>(null)
  const dragOverCol = useRef<ColumnId | null>(null)

  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleDragStart = useCallback((col: ColumnId) => {
    dragCol.current = col
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, col: ColumnId) => {
    e.preventDefault()
    dragOverCol.current = col
  }, [])

  const handleDrop = useCallback((col: ColumnId) => {
    if (!dragCol.current || dragCol.current === col) return
    setColumns(prev => {
      const from = prev.indexOf(dragCol.current!)
      const to = prev.indexOf(col)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, dragCol.current!)
      return next
    })
    dragCol.current = null
    dragOverCol.current = null
  }, [])

  const handleSelect = onSelectTask || (() => {})
  const totalTasks = projectGroups.reduce(
    (acc, pg) => acc + pg.stageGroups.reduce((a, sg) => a + sg.tasks.length, 0) + pg.unstagedTasks.length,
    0
  ) + unassignedTasks.length

  return (
    <div>
      {/* Table header with draggable columns */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]" style={{ height: 28, padding: '0 12px', backgroundColor: 'transparent' }}>
        {columns.map(col => {
          const cfg = COLUMN_CONFIG[col]
          return (
            <span
              key={col}
              draggable
              onDragStart={() => handleDragStart(col)}
              onDragOver={(e) => handleDragOver(e, col)}
              onDrop={() => handleDrop(col)}
              className={`${cfg.width} ${cfg.align} cursor-grab active:cursor-grabbing select-none hover:text-text transition-colors`}
              title="Drag to reorder"
            >
              {cfg.label}
            </span>
          )
        })}
      </div>

      {/* Workspace header */}
      {workspaceName && (projectGroups.length > 0 || unassignedTasks.length > 0) && (
        <div className="flex items-center gap-2 mt-2 cursor-pointer" onClick={() => toggleSection('ws')} style={{ height: 36, padding: '0 8px', backgroundColor: 'var(--bg-surface)' }}>
          <button onClick={(e) => { e.stopPropagation(); toggleSection('ws') }} className="text-text-dim">
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
              className={`transition-transform ${collapsedSections.has('ws') ? '' : 'rotate-90'}`}>
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="text-[13px] font-semibold text-white">{workspaceName}</span>
          <span className="text-[12px] text-text-dim ml-1">{totalTasks}</span>
        </div>
      )}

      {!collapsedSections.has('ws') && (
        <>
          {/* Project groups */}
          {projectGroups.map(({ project, stageGroups, unstagedTasks: unstaged }) => {
            const projectKey = `proj-${project.id}`
            const isProjectCollapsed = collapsedSections.has(projectKey)
            const projectTaskCount = stageGroups.reduce((a, sg) => a + sg.tasks.length, 0) + unstaged.length

            return (
              <div key={project.id} className="mb-2">
                {/* Project header */}
                <div className="flex items-center gap-2 ml-4 cursor-pointer" onClick={() => toggleSection(projectKey)} style={{ height: 36, padding: '0 8px', backgroundColor: 'var(--bg-surface)' }}>
                  <button onClick={(e) => { e.stopPropagation(); toggleSection(projectKey) }} className="text-text-dim">
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
                      className={`transition-transform ${isProjectCollapsed ? '' : 'rotate-90'}`}>
                      <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: project.color }}>
                    <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                  <a href={`/project/${project.public_id || project.id}`} className="text-[13px] font-semibold text-white hover:text-accent-text transition-colors">
                    {project.name}
                  </a>
                  <span className="text-[12px] text-text-dim">{projectTaskCount}</span>
                </div>

                {!isProjectCollapsed && (
                  <>
                    {/* Stage groups */}
                    {stageGroups.map(({ stage, tasks }) => {
                      const stageKey = `stage-${stage.id}`
                      const isStageCollapsed = collapsedSections.has(stageKey)

                      return (
                        <div key={stage.id} className="mb-1">
                          {/* Stage header */}
                          <div className="flex items-center gap-2 ml-8 cursor-pointer" onClick={() => toggleSection(stageKey)} style={{ height: 36, padding: '0 8px', backgroundColor: 'var(--bg-surface)' }}>
                            <button onClick={(e) => { e.stopPropagation(); toggleSection(stageKey) }} className="text-text-dim">
                              <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
                                className={`transition-transform ${isStageCollapsed ? '' : 'rotate-90'}`}>
                                <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <StagePill name={stage.name} color={stage.color} size="sm" />
                            <span className="text-[12px] text-text-dim">{tasks.length}</span>
                          </div>

                          {!isStageCollapsed && (
                            <div className="ml-10">
                              {tasks.map((task, idx) => (
                                <TaskRow
                                  key={task.id}
                                  task={task}
                                  index={idx + 1}
                                  isSelected={selectedTaskId === task.id}
                                  onSelect={() => handleSelect(task.id)}
                                  projectName={project.name}
                                  projectColor={project.color}
                                  columns={columns}
                                />
                              ))}
                              <AddTaskRow
                                projectId={project.id}
                                stageId={stage.id}
                                workspaceId={workspaceId}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Unstaged tasks under "No Stage" */}
                    {unstaged.length > 0 && (
                      <div className="mb-1">
                        <div className="flex items-center gap-2 ml-8 cursor-pointer" onClick={() => toggleSection(`nostage-${project.id}`)} style={{ height: 36, padding: '0 8px', backgroundColor: 'var(--bg-surface)' }}>
                          <button onClick={(e) => { e.stopPropagation(); toggleSection(`nostage-${project.id}`) }} className="text-text-dim">
                            <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
                              className={`transition-transform ${collapsedSections.has(`nostage-${project.id}`) ? '' : 'rotate-90'}`}>
                              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <span className="h-2.5 w-2.5 rounded-full bg-text-dim shrink-0" />
                          <span className="text-[13px] font-semibold text-white">No Stage</span>
                          <span className="text-[12px] text-text-dim">{unstaged.length}</span>
                        </div>
                        {!collapsedSections.has(`nostage-${project.id}`) && (
                          <div className="ml-10">
                            {unstaged.map((task, idx) => (
                              <TaskRow
                                key={task.id}
                                task={task}
                                index={idx + 1}
                                isSelected={selectedTaskId === task.id}
                                onSelect={() => handleSelect(task.id)}
                                projectName={project.name}
                                projectColor={project.color}
                                columns={columns}
                              />
                            ))}
                            <AddTaskRow
                              projectId={project.id}
                              workspaceId={workspaceId}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* If project has no stages and no unstaged tasks, show add task */}
                    {stageGroups.length === 0 && unstaged.length === 0 && (
                      <div className="ml-10">
                        <AddTaskRow
                          projectId={project.id}
                          workspaceId={workspaceId}
                        />
                      </div>
                    )}

                    {/* Add stage button */}
                    <AddStageRow projectId={project.id} />
                  </>
                )}
              </div>
            )
          })}

          {/* No project tasks */}
          {unassignedTasks.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-2 ml-4 cursor-pointer" onClick={() => toggleSection('no-project')} style={{ height: 36, padding: '0 8px', backgroundColor: 'var(--bg-surface)' }}>
                <button onClick={(e) => { e.stopPropagation(); toggleSection('no-project') }} className="text-text-dim">
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
                    className={`transition-transform ${collapsedSections.has('no-project') ? '' : 'rotate-90'}`}>
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#6b7280]">
                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <span className="text-[13px] font-semibold text-white">No project</span>
                <span className="text-[12px] text-text-dim">{unassignedTasks.length}</span>
              </div>

              {!collapsedSections.has('no-project') && (
                <>
                  {/* No Stage sub-header */}
                  <div className="flex items-center gap-2 ml-8 cursor-pointer" onClick={() => toggleSection('no-project-no-stage')} style={{ height: 36, padding: '0 8px', backgroundColor: 'var(--bg-surface)' }}>
                    <button onClick={(e) => { e.stopPropagation(); toggleSection('no-project-no-stage') }} className="text-text-dim">
                      <svg width="12" height="12" viewBox="0 0 10 10" fill="none"
                        className={`transition-transform ${collapsedSections.has('no-project-no-stage') ? '' : 'rotate-90'}`}>
                        <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <span className="h-2.5 w-2.5 rounded-full bg-text-dim shrink-0" />
                    <span className="text-[13px] font-semibold text-white">No Stage</span>
                    <span className="text-[12px] text-text-dim">{unassignedTasks.length}</span>
                  </div>

                  {!collapsedSections.has('no-project-no-stage') && (
                    <div className="ml-10">
                      {unassignedTasks.map((task, idx) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          index={idx + 1}
                          isSelected={selectedTaskId === task.id}
                          onSelect={() => handleSelect(task.id)}
                          columns={columns}
                        />
                      ))}
                      <AddTaskRow workspaceId={workspaceId} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {projectGroups.length === 0 && unassignedTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-text-dim">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mb-3">
            <rect x="5" y="5" width="30" height="30" rx="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
            <path d="M20 13v14M13 20h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p className="text-[16px]">No tasks yet</p>
          <p className="text-[14px] mt-1">Create a project from the sidebar, then add tasks</p>
        </div>
      )}
    </div>
  )
}
