'use client'

import { useState, useEffect, useCallback } from 'react'
import { PRIORITY_COLORS, STATUS_ORDER, STATUS_LABELS, TERMINAL_STATUSES } from '@/lib/task-constants'

interface MobileTask {
  id: number
  title: string
  status: string
  priority: string
  due_date: string | null
  project_name: string | null
  project_color: string | null
  workspace_name: string | null
  updated_at: number
}

function formatDueDate(due: string | null): { text: string; overdue: boolean } | null {
  if (!due) return null
  const d = new Date(due)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, overdue: true }
  if (diffDays === 0) return { text: 'Today', overdue: false }
  if (diffDays === 1) return { text: 'Tomorrow', overdue: false }
  if (diffDays <= 7) return { text: `${diffDays}d`, overdue: false }
  return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: false }
}

export function MobileHome() {
  const [tasks, setTasks] = useState<MobileTask[]>([])
  const [filter, setFilter] = useState<'active' | 'done'>('active')
  const [completing, setCompleting] = useState<Set<number>>(new Set())

  const loadTasks = useCallback(() => {
    fetch('/api/tasks?all=1')
      .then(r => r.json())
      .then(d => setTasks(d.tasks || []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  const toggleDone = useCallback((taskId: number) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const newStatus = task.status === 'done' ? 'todo' : 'done'

    // Animate completion
    if (newStatus === 'done') {
      setCompleting(prev => new Set(prev).add(taskId))
      setTimeout(() => {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'done' } : t))
        setCompleting(prev => { const next = new Set(prev); next.delete(taskId); return next })
      }, 300)
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'todo' } : t))
    }

    fetch(`/api/tasks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, status: newStatus }),
    }).catch(() => {})
  }, [tasks])

  const activeTasks = tasks
    .filter(t => !TERMINAL_STATUSES.includes(t.status))
    .sort((a, b) => {
      // Sort by status order, then priority, then due date
      const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
      if (statusDiff !== 0) return statusDiff
      const priOrder = ['urgent', 'high', 'medium', 'low']
      const priDiff = priOrder.indexOf(a.priority) - priOrder.indexOf(b.priority)
      if (priDiff !== 0) return priDiff
      if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      if (a.due_date) return -1
      if (b.due_date) return 1
      return b.updated_at - a.updated_at
    })

  const doneTasks = tasks
    .filter(t => t.status === 'done')
    .sort((a, b) => b.updated_at - a.updated_at)

  const displayed = filter === 'active' ? activeTasks : doneTasks

  // Group active tasks by status
  const grouped = filter === 'active'
    ? Object.entries(
        displayed.reduce((acc, t) => {
          const key = t.status
          if (!acc[key]) acc[key] = []
          acc[key].push(t)
          return acc
        }, {} as Record<string, MobileTask[]>)
      ).sort(([a], [b]) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99))
    : [['done', displayed] as [string, MobileTask[]]]

  return (
    <div className="h-full overflow-auto pb-28">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-[22px] font-bold text-text">Tasks</h1>
        <div className="flex items-center gap-1 glass-pill px-1 py-1">
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              filter === 'active' ? 'bg-accent/20 text-accent-text' : 'text-text-dim'
            }`}
          >
            Active ({activeTasks.length})
          </button>
          <button
            onClick={() => setFilter('done')}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              filter === 'done' ? 'bg-accent/20 text-accent-text' : 'text-text-dim'
            }`}
          >
            Done ({doneTasks.length})
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="px-4 stagger-children">
        {grouped.map(([status, groupTasks]) => (
          <div key={status} className="mb-4">
            {filter === 'active' && (
              <div className="flex items-center gap-2 px-1 mb-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: status === 'in_progress' ? 'var(--accent)' :
                      status === 'blocked' ? 'var(--priority-urgent)' :
                      status === 'review' ? '#ab47bc' : 'var(--text-dim)'
                  }}
                />
                <span className="text-[12px] font-semibold uppercase tracking-wider text-text-dim">
                  {STATUS_LABELS[status] || status} ({groupTasks.length})
                </span>
              </div>
            )}

            <div className="space-y-1.5">
              {groupTasks.map(task => {
                const due = formatDueDate(task.due_date)
                const isCompleting = completing.has(task.id)

                return (
                  <div
                    key={task.id}
                    className={`glass-card !rounded-md px-4 py-3.5 flex items-start gap-3 active:scale-[0.99] transition-all ${
                      isCompleting ? 'opacity-50 scale-95' : ''
                    }`}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: task.id } }))
                    }}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleDone(task.id) }}
                      className="mt-0.5 shrink-0"
                    >
                      {task.status === 'done' ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="3" width="18" height="18" rx="6" fill="var(--accent)" />
                          <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="3" width="18" height="18" rx="6" stroke="var(--border-strong)" strokeWidth="1.5" />
                        </svg>
                      )}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] font-medium leading-snug ${task.status === 'done' ? 'line-through text-text-dim' : 'text-text'}`}>
                        {task.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {/* Priority dot */}
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.low }}
                        />
                        {/* Project */}
                        {task.project_name && (
                          <span className="text-[12px] text-text-dim truncate max-w-[120px]">
                            {task.project_name}
                          </span>
                        )}
                        {/* Due date */}
                        {due && (
                          <>
                            <span className="text-[12px] text-text-dim">·</span>
                            <span className={`text-[12px] font-medium ${due.overdue ? 'text-red' : 'text-text-dim'}`}>
                              {due.text}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status indicator for in_progress */}
                    {task.status === 'in_progress' && (
                      <div className="w-2 h-2 rounded-full bg-accent mt-2 shrink-0 animate-pulse" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {displayed.length === 0 && (
          <div className="text-center py-16 text-text-dim text-[14px]">
            {filter === 'active' ? 'No active tasks' : 'No completed tasks'}
          </div>
        )}
      </div>
    </div>
  )
}
