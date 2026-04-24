'use client'

import { useMemo } from 'react'
import type { Task } from '@/lib/types'
import { PRIORITY_COLORS as priorityColors } from '@/lib/task-constants'

const statusColors: Record<string, string> = {
  backlog: '#78909c',
  todo: '#4285f4',
  in_progress: '#f6bf26',
  review: '#7b68ee',
  done: '#2ecc71',
}

export function GanttView({
  tasks,
  onSelectTask,
}: {
  tasks: Task[]
  onSelectTask: (id: number) => void
}) {
  // Filter tasks that have dates
  const datedTasks = useMemo(() => {
    return tasks
      .filter(t => t.start_date || t.due_date)
      .sort((a, b) => {
        const aDate = a.start_date || a.due_date || ''
        const bDate = b.start_date || b.due_date || ''
        return aDate.localeCompare(bDate)
      })
  }, [tasks])

  const undatedTasks = useMemo(() => tasks.filter(t => !t.start_date && !t.due_date), [tasks])

  // Calculate date range
  const { startDate, endDate, totalDays, dayWidth } = useMemo(() => {
    if (datedTasks.length === 0) {
      const now = new Date()
      const start = new Date(now)
      start.setDate(start.getDate() - 7)
      const end = new Date(now)
      end.setDate(end.getDate() + 30)
      return { startDate: start, endDate: end, totalDays: 37, dayWidth: 40 }
    }

    const allDates = datedTasks.flatMap(t => {
      const dates: Date[] = []
      if (t.start_date) dates.push(new Date(t.start_date))
      if (t.due_date) dates.push(new Date(t.due_date))
      return dates
    })

    const min = new Date(Math.min(...allDates.map(d => d.getTime())))
    const max = new Date(Math.max(...allDates.map(d => d.getTime())))

    // Add padding
    min.setDate(min.getDate() - 3)
    max.setDate(max.getDate() + 7)

    const days = Math.max(Math.ceil((max.getTime() - min.getTime()) / 86400000), 14)
    return { startDate: min, endDate: max, totalDays: days, dayWidth: 40 }
  }, [datedTasks])

  // Generate date columns
  const dateColumns = useMemo(() => {
    const cols: { date: Date; label: string; isToday: boolean; isWeekend: boolean; monthLabel?: string }[] = []
    const today = new Date().toISOString().split('T')[0]

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate)
      d.setDate(d.getDate() + i)
      const iso = d.toISOString().split('T')[0]
      const day = d.getDay()

      cols.push({
        date: d,
        label: d.getDate().toString(),
        isToday: iso === today,
        isWeekend: day === 0 || day === 6,
        monthLabel: d.getDate() === 1 || i === 0
          ? d.toLocaleDateString('en-US', { month: 'short' })
          : undefined,
      })
    }
    return cols
  }, [startDate, totalDays])

  function getBarPosition(task: Task) {
    const start = task.start_date ? new Date(task.start_date) : task.due_date ? new Date(task.due_date) : null
    const end = task.due_date ? new Date(task.due_date) : start
    if (!start || !end) return null

    const startOffset = Math.max(0, (start.getTime() - startDate.getTime()) / 86400000)
    const duration = Math.max(1, (end.getTime() - start.getTime()) / 86400000 + 1)

    return {
      left: startOffset * dayWidth,
      width: duration * dayWidth,
    }
  }

  return (
    <div className="h-full flex flex-col">
      {datedTasks.length === 0 && undatedTasks.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-text-dim text-[13px]">
          No tasks with dates. Add start dates or deadlines to see the timeline.
        </div>
      )}

      {(datedTasks.length > 0 || undatedTasks.length > 0) && (
        <div className="flex-1 overflow-auto">
          <div style={{ minWidth: totalDays * dayWidth + 250 }}>
            {/* Header: month labels */}
            <div className="flex sticky top-0 z-10 bg-bg border-b border-border">
              <div className="w-[250px] shrink-0 border-r border-border px-3 text-[10px] font-semibold tracking-wider text-text-secondary uppercase flex items-center" style={{ height: 36 }}>
                Task
              </div>
              <div className="flex">
                {dateColumns.map((col, i) => (
                  <div
                    key={i}
                    className="flex flex-col items-center justify-end border-r border-border"
                    style={{ width: dayWidth }}
                  >
                    {col.monthLabel && (
                      <span className="text-[9px] text-text-dim font-medium">{col.monthLabel}</span>
                    )}
                    <span
                      className={`text-[10px] py-0.5 px-1 rounded ${
                        col.isToday
                          ? 'bg-accent text-white font-bold'
                          : col.isWeekend
                          ? 'text-text-dim/50'
                          : 'text-text-dim'
                      }`}
                    >
                      {col.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Task rows */}
            {datedTasks.map((task) => {
              const bar = getBarPosition(task)
              const color = statusColors[task.status] || '#42a5f5'

              return (
                <div
                  key={task.id}
                  className="flex border-b border-border hover:bg-hover/50 cursor-pointer group"
                  onClick={() => onSelectTask(task.id)}
                >
                  {/* Task name */}
                  <div className="w-[250px] shrink-0 border-r border-border px-3 flex items-center gap-2" style={{ height: 36, padding: '0 10px' }}>
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: priorityColors[task.priority] || '#7a6b55' }}
                    />
                    <span className={`text-[14px] font-medium truncate ${task.status === 'done' ? 'text-text-dim line-through' : 'text-text'}`}>
                      {task.title}
                    </span>
                  </div>

                  {/* Timeline */}
                  <div className="relative flex-1" style={{ height: 36 }}>
                    {/* Weekend shading */}
                    {dateColumns.map((col, i) => (
                      col.isWeekend && (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 bg-white/[0.02]"
                          style={{ left: i * dayWidth, width: dayWidth }}
                        />
                      )
                    ))}

                    {/* Today line */}
                    {dateColumns.map((col, i) => (
                      col.isToday && (
                        <div
                          key={`today-${i}`}
                          className="absolute top-0 bottom-0 w-px bg-accent/40"
                          style={{ left: i * dayWidth + dayWidth / 2 }}
                        />
                      )
                    ))}

                    {/* Bar */}
                    {bar && (
                      <div
                        className="absolute top-1.5 rounded-md transition-opacity group-hover:opacity-90"
                        style={{
                          left: bar.left,
                          width: Math.max(bar.width, dayWidth),
                          height: 20,
                          backgroundColor: color + '44',
                          borderLeft: `3px solid ${color}`,
                        }}
                      >
                        <span className="absolute inset-0 flex items-center px-2 text-[10px] text-text truncate">
                          {task.title}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Undated tasks */}
            {undatedTasks.length > 0 && (
              <>
                <div className="flex border-b border-border" style={{ backgroundColor: 'var(--table-header-bg)' }}>
                  <div className="w-[250px] shrink-0 border-r border-border px-3 text-[10px] text-text-secondary font-semibold tracking-wider uppercase flex items-center" style={{ height: 36, padding: '0 10px' }}>
                    No dates ({undatedTasks.length})
                  </div>
                  <div className="flex-1" />
                </div>
                {undatedTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex border-b border-border hover:bg-hover/50 cursor-pointer"
                    onClick={() => onSelectTask(task.id)}
                  >
                    <div className="w-[250px] shrink-0 border-r border-border flex items-center gap-2" style={{ height: 36, padding: '0 10px' }}>
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: priorityColors[task.priority] || '#7a6b55' }}
                      />
                      <span className="text-[14px] font-medium text-text-dim truncate">{task.title}</span>
                    </div>
                    <div className="flex-1 flex items-center px-3">
                      <span className="text-[10px] text-text-dim">Add dates to see on timeline</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
