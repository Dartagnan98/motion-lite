'use client'

import { useState, useMemo } from 'react'
import type { Task } from '@/lib/types'
import { PRIORITY_COLORS as priorityColors } from '@/lib/task-constants'

export function CalendarView({
  tasks,
  onSelectTask,
}: {
  tasks: Task[]
  onSelectTask: (id: number) => void
}) {
  const [currentDate, setCurrentDate] = useState(new Date())

  const { weeks, monthLabel } = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    // Start from Monday of the week containing the 1st
    const start = new Date(firstDay)
    const dayOfWeek = start.getDay()
    start.setDate(start.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))

    const weeks: Date[][] = []
    const current = new Date(start)

    while (current <= lastDay || weeks.length < 5) {
      const week: Date[] = []
      for (let i = 0; i < 7; i++) {
        week.push(new Date(current))
        current.setDate(current.getDate() + 1)
      }
      weeks.push(week)
      if (weeks.length >= 6) break
    }

    return {
      weeks,
      monthLabel: firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    }
  }, [currentDate])

  const today = new Date().toISOString().split('T')[0]
  const currentMonth = currentDate.getMonth()

  function getTasksForDate(date: Date): Task[] {
    const iso = date.toISOString().split('T')[0]
    return tasks.filter(t => t.due_date === iso || t.start_date === iso)
  }

  function prevMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
  }

  function nextMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  }

  function goToday() {
    setCurrentDate(new Date())
  }

  return (
    <div className="h-full flex flex-col">
      {/* Calendar header */}
      <div className="flex items-center gap-3 pb-4">
        <h2 className="text-[16px] font-semibold text-text">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="rounded-md p-1 text-text-dim hover:bg-hover hover:text-text">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <path d="M8 3L4 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={goToday} className="rounded-md px-2.5 py-1 text-[13px] text-text-dim hover:bg-hover hover:text-text">
            Today
          </button>
          <button onClick={nextMonth} className="rounded-md p-1 text-text-dim hover:bg-hover hover:text-text">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <path d="M6 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary text-center">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 grid grid-cols-7 auto-rows-fr">
        {weeks.map((week, wi) =>
          week.map((day, di) => {
            const iso = day.toISOString().split('T')[0]
            const isCurrentMonth = day.getMonth() === currentMonth
            const isToday = iso === today
            const dayTasks = getTasksForDate(day)

            return (
              <div
                key={`${wi}-${di}`}
                className={`border-b border-r border-border p-1 min-h-[80px] ${
                  !isCurrentMonth ? 'opacity-40' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-[13px] leading-none w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday
                        ? 'bg-accent text-white font-bold'
                        : 'text-text-dim'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {dayTasks.length > 2 && (
                    <span className="text-[11px] text-text-dim">+{dayTasks.length - 2}</span>
                  )}
                </div>

                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map((task) => (
                    <button
                      key={task.id}
                      onClick={() => onSelectTask(task.id)}
                      className="w-full text-left rounded px-1.5 py-1 text-[12px] truncate hover:opacity-80 transition-opacity"
                      style={{
                        backgroundColor: (priorityColors[task.priority] || '#7a6b55') + '22',
                        color: priorityColors[task.priority] || '#7a6b55',
                      }}
                    >
                      {task.title}
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
