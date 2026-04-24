'use client'

import { useState, useMemo } from 'react'
import type { Task } from '@/lib/types'
import { TaskDetailPanel } from './TaskDetailPanel'
import { PRIORITY_COLORS as priorityColors, STATUS_LABELS as statusLabels } from '@/lib/task-constants'

export function ScheduleView({ tasks, onTasksChanged }: { tasks: Task[]; onTasksChanged?: () => void }) {
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayISO = today.toISOString().split('T')[0]

  const groups = useMemo(() => {
    const overdue: Task[] = []
    const todayTasks: Task[] = []
    const tomorrow: Task[] = []
    const thisWeek: Task[] = []
    const nextWeek: Task[] = []
    const later: Task[] = []
    const noDue: Task[] = []

    const tomorrowDate = new Date(today)
    tomorrowDate.setDate(tomorrowDate.getDate() + 1)
    const tomorrowISO = tomorrowDate.toISOString().split('T')[0]

    const endOfWeek = new Date(today)
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()))
    const endOfWeekISO = endOfWeek.toISOString().split('T')[0]

    const endOfNextWeek = new Date(endOfWeek)
    endOfNextWeek.setDate(endOfNextWeek.getDate() + 7)
    const endOfNextWeekISO = endOfNextWeek.toISOString().split('T')[0]

    for (const task of tasks) {
      if (task.status === 'done') continue

      if (!task.due_date) {
        noDue.push(task)
      } else if (task.due_date < todayISO) {
        overdue.push(task)
      } else if (task.due_date === todayISO) {
        todayTasks.push(task)
      } else if (task.due_date === tomorrowISO) {
        tomorrow.push(task)
      } else if (task.due_date <= endOfWeekISO) {
        thisWeek.push(task)
      } else if (task.due_date <= endOfNextWeekISO) {
        nextWeek.push(task)
      } else {
        later.push(task)
      }
    }

    return [
      { label: 'Overdue', tasks: overdue, color: '#ef5350' },
      { label: 'Today', tasks: todayTasks, color: '#42a5f5' },
      { label: 'Tomorrow', tasks: tomorrow, color: '#ffd740' },
      { label: 'This Week', tasks: thisWeek, color: '#7a6b55' },
      { label: 'Next Week', tasks: nextWeek, color: '#b388ff' },
      { label: 'Later', tasks: later, color: '#6b7280' },
      { label: 'No Due Date', tasks: noDue, color: '#4a4a4a' },
    ].filter(g => g.tasks.length > 0)
  }, [tasks, todayISO])

  const totalOpen = tasks.filter(t => t.status !== 'done').length
  const totalMinutes = tasks.filter(t => t.status !== 'done').reduce((acc, t) => acc + (t.duration_minutes || 0), 0)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold text-text">Schedule</h1>
          <span className="text-[12px] text-text-dim">{totalOpen} open tasks</span>
          {totalMinutes > 0 && (
            <span className="text-[12px] text-text-dim">
              {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m total
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {groups.length === 0 && (
          <div className="flex items-center justify-center py-20 text-text-dim text-[13px]">
            No open tasks. You're all caught up!
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />
              <span className="text-[13px] font-semibold text-text">{group.label}</span>
              <span className="text-[12px] text-text-dim">{group.tasks.length}</span>
            </div>

            <div className="space-y-1">
              {group.tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`flex w-full items-center gap-3 rounded-md border px-4 py-2.5 text-left transition-colors ${
                    selectedTaskId === task.id
                      ? 'border-accent bg-accent-dim'
                      : 'border-border hover:border-border-strong hover:bg-hover'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: priorityColors[task.priority] || '#7a6b55' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-text truncate">{task.title}</div>
                    <div className="flex items-center gap-3 mt-0.5 text-[12px] text-text-dim">
                      <span>{statusLabels[task.status] || task.status}</span>
                      {task.assignee && <span>{task.assignee}</span>}
                      {task.duration_minutes > 0 && <span>{task.duration_minutes}m</span>}
                    </div>
                  </div>
                  {task.due_date && (
                    <span className={`text-[12px] shrink-0 ${
                      task.due_date < todayISO ? 'text-red-400' : 'text-text-dim'
                    }`}>
                      {formatDate(task.due_date)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          onClose={() => {
            setSelectedTaskId(null)
            onTasksChanged?.()
          }}
        />
      )}
    </div>
  )
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays < -1) return `${Math.abs(diffDays)} days ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
