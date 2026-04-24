'use client'

import { useEffect, useState } from 'react'
import type { Task } from '@/lib/types'
import type { ColumnId } from './TaskListView'
import { COLUMN_CONFIG, DEFAULT_COLUMNS } from './TaskListView'
import { Avatar } from '@/components/ui/Avatar'
import { findAssignee } from '@/lib/assignee-utils'
import type { AssigneeMember } from '@/lib/use-team-members'

import { PRIORITY_CONFIG as priorityConfig } from '@/lib/task-constants'

let cachedAssignees: AssigneeMember[] | null = null

export function TaskRow({
  task,
  index,
  isSelected,
  onSelect,
  projectName,
  projectColor,
  columns = DEFAULT_COLUMNS,
}: {
  task: Task
  index?: number
  isSelected: boolean
  onSelect: () => void
  projectName?: string
  projectColor?: string
  columns?: ColumnId[]
}) {
  const [assignees, setAssignees] = useState<AssigneeMember[]>(cachedAssignees || [])
  const priority = priorityConfig[task.priority] || priorityConfig.medium
  const isDone = task.status === 'done'
  const isOverdue = task.due_date && !isDone && new Date(task.due_date + 'T23:59:59') < new Date()

  useEffect(() => {
    if (cachedAssignees) return
    fetch('/api/team?format=assignees').then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        cachedAssignees = data
        setAssignees(data)
      }
    }).catch(() => {})
  }, [])

  const assignee = findAssignee(task.assignee, assignees)

  function renderCell(col: ColumnId) {
    const cfg = COLUMN_CONFIG[col]
    switch (col) {
      case 'name':
        return (
          <span key={col} className={`${cfg.width} truncate text-[13px] font-medium ${isDone ? 'text-text-dim line-through' : 'text-[#e8e8e8]'}`}>
            {task.title}
          </span>
        )
      case 'created_at':
        return (
          <span key={col} className={`${cfg.width} ${cfg.align} text-[13px] text-text-dim shrink-0`}>
            {task.due_date ? (
              <span className={isOverdue ? 'text-red-400' : ''}>
                {formatDate(task.due_date)}
              </span>
            ) : 'None'}
          </span>
        )
      case 'eta':
        return (
          <span key={col} className={`${cfg.width} ${cfg.align} shrink-0`}>
            <span className="text-[13px] text-text-dim">
              {formatDate(new Date(task.created_at * 1000).toISOString().split('T')[0])}
            </span>
          </span>
        )
      case 'assignee':
        return (
          <span key={col} className={`${cfg.width} flex items-center gap-1.5 shrink-0`}>
            {task.assignee ? (
              <>
                <Avatar
                  name={assignee?.name || task.assignee}
                  size={20}
                  src={assignee?.avatar}
                  color={assignee?.color}
                />
                <span className="text-[13px] text-text-secondary truncate">
                  {assignee?.name || task.assignee}
                </span>
              </>
            ) : (
              <span className="text-[13px] text-text-dim">--</span>
            )}
          </span>
        )
      case 'project':
        return (
          <span key={col} className={`${cfg.width} flex items-center gap-1.5 shrink-0`}>
            {projectName ? (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: projectColor || '#6b7280' }}>
                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <span className="text-[13px] text-text-secondary truncate">{projectName}</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#6b7280]">
                  <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <span className="text-[13px] text-text-dim">No project</span>
              </>
            )}
          </span>
        )
      case 'complete':
        return (
          <span key={col} className={`${cfg.width} flex justify-center shrink-0`}>
            {isDone ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" fill="#00e676" fillOpacity="0.2" stroke="#00e676" strokeWidth="1.5" />
                <path d="M5 8l2 2 4-4" stroke="#00e676" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span className="h-4 w-4 rounded-full border border-border-strong" />
            )}
          </span>
        )
    }
  }

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      className={`task-row-standalone flex w-full items-center border-b border-[var(--border)] text-left transition-colors group cursor-pointer ${
        isSelected ? '' : 'hover:bg-[rgba(255,255,255,0.04)]'
      }`}
      style={{ height: 36, padding: '0px 10px', gap: 4, background: isSelected ? 'rgba(255,255,255,0.035)' : undefined }}
    >
      {/* Row number */}
      <span className="w-6 text-right text-[11px] text-text-dim shrink-0">
        {index || ''}
      </span>

      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          fetch('/api/tasks', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: task.id,
              status: isDone ? 'todo' : 'done',
              completed_at: isDone ? null : Math.floor(Date.now() / 1000),
            }),
          }).then(() => window.location.reload())
        }}
        className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-sm border transition-colors ${
          isDone
            ? 'border-accent bg-accent'
            : 'border-[var(--border)] hover:border-text-dim'
        }`}
      >
        {isDone && (
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2.5 2.5L8 3" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Priority flag (always before columns) */}
      <span className="w-7 flex justify-center shrink-0" title={priority.label}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3 14V3l10 4-10 4" fill={priority.color} />
        </svg>
      </span>

      {/* Reorderable columns */}
      {columns.map(col => renderCell(col))}
    </div>
  )
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
