'use client'

import type { Task } from '@/lib/types'
import { PriorityIcon } from '@/components/ui/PriorityIcon'
import { STATUS_OPTIONS as statusColumns } from '@/lib/task-constants'
import { LabelChip, safeParseLabels } from '@/components/ui/LabelChip'
import { KanbanBoard, type KanbanColumn } from '@/components/ui/KanbanBoard'

export function KanbanView({
  tasks,
  onSelectTask,
}: {
  tasks: Task[]
  onSelectTask: (id: number) => void
}) {
  const columns: KanbanColumn[] = statusColumns.map((c) => ({
    key: c.value,
    label: c.label,
    color: c.color,
  }))

  async function handleMove(itemId: string | number, toKey: string) {
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: Number(itemId),
        status: toKey,
        ...(toKey === 'done' ? { completed_at: Math.floor(Date.now() / 1000) } : {}),
      }),
    })
    window.location.reload()
  }

  return (
    <KanbanBoard
      columns={columns}
      items={tasks}
      getItemId={(t) => t.id}
      getItemColumn={(t) => t.status}
      onMove={handleMove}
      dragMimeType="text/task-id"
      columnWidth={280}
      renderCard={(task, { isDragging }) => (
        <KanbanCard
          task={task}
          onClick={() => onSelectTask(task.id)}
          isDragging={isDragging}
        />
      )}
    />
  )
}

function KanbanCard({
  task,
  onClick,
  isDragging,
}: {
  task: Task
  onClick: () => void
  isDragging: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={`glass cursor-grab rounded-lg border border-[var(--border)] p-3 transition-all hover:border-[var(--border-strong,var(--border))] active:cursor-grabbing ${
        isDragging ? 'scale-[0.97] opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-[14px] font-medium text-[var(--text)] leading-tight">{task.title}</span>
        <span className="shrink-0" title={task.priority}><PriorityIcon priority={task.priority} size={12} /></span>
      </div>

      <div className="flex items-center gap-3 text-[12px] text-[var(--text-dim)]">
        {task.assignee && (
          <div className="flex items-center gap-1">
            <div className="h-4 w-4 rounded-full bg-[color:var(--accent)]/20 flex items-center justify-center text-[8px] text-[var(--accent-text)] font-bold">
              {task.assignee[0]?.toUpperCase()}
            </div>
            <span>{task.assignee}</span>
          </div>
        )}
        {task.due_date && (
          <span>{formatDate(task.due_date)}</span>
        )}
        {task.duration_minutes > 0 && (
          <span>{task.duration_minutes}m</span>
        )}
      </div>

      {task.labels && safeParseLabels(task.labels).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {safeParseLabels(task.labels).map((l) => (
            <LabelChip key={l} name={l} color="#8c8c8c" size="sm" />
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
