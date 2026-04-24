'use client'

import { useMemo } from 'react'

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isSameWeek(a: Date, b: Date, weekStartDay: string): boolean {
  const startDay = weekStartDay === 'monday' ? 1 : 0
  const getWeekStart = (d: Date) => {
    const date = new Date(d)
    const day = date.getDay()
    const diff = (day - startDay + 7) % 7
    date.setDate(date.getDate() - diff)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  return getWeekStart(a) === getWeekStart(b)
}

export function MiniCalendar({
  currentDate,
  onSelectDate,
  weekStartDay = 'sunday',
  eventDates,
}: {
  currentDate: Date
  onSelectDate: (d: Date) => void
  weekStartDay?: string
  eventDates?: Set<string>
}) {
  const today = new Date()
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const weeks = useMemo(() => {
    const startDay = weekStartDay === 'monday' ? 1 : 0
    const firstDay = new Date(year, month, 1)
    let dayOfWeek = firstDay.getDay() - startDay
    if (dayOfWeek < 0) dayOfWeek += 7

    const allDays: (Date | null)[] = []
    // Fill in previous month days
    for (let i = dayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month, -i)
      allDays.push(d)
    }
    // Current month
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      allDays.push(new Date(year, month, d))
    }
    // Fill to complete last week
    while (allDays.length % 7 !== 0) {
      const last = allDays[allDays.length - 1]!
      const next = new Date(last)
      next.setDate(next.getDate() + 1)
      allDays.push(next)
    }

    // Group into weeks
    const result: Date[][] = []
    for (let i = 0; i < allDays.length; i += 7) {
      result.push(allDays.slice(i, i + 7) as Date[])
    }
    return result
  }, [year, month, weekStartDay])

  const dayLabels = weekStartDay === 'monday'
    ? ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  function prevMonth() {
    const d = new Date(currentDate)
    d.setMonth(d.getMonth() - 1)
    onSelectDate(d)
  }
  function nextMonth() {
    const d = new Date(currentDate)
    d.setMonth(d.getMonth() + 1)
    onSelectDate(d)
  }

  function dateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    <div>
      {/* Header: Month Year | Today < > */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[15px] font-bold text-text">
          {currentDate.toLocaleDateString('en-US', { month: 'long' })}{' '}
          <span className="font-normal text-text-secondary">{year}</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSelectDate(new Date())}
            className="px-2 py-0.5 text-[11px] font-medium text-text border border-border rounded-md hover:bg-hover transition-colors"
          >
            Today
          </button>
          <button onClick={prevMonth} className="p-1 rounded hover:bg-hover text-text-dim">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-hover text-text-dim">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-0 mb-0.5">
        {dayLabels.map((l, i) => (
          <div key={i} className="text-center text-[11px] font-medium text-text-dim py-0.5">{l}</div>
        ))}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => {
        const isCurrentWeek = week.some(d => isSameWeek(d, currentDate, weekStartDay)) && week.some(d => d.getMonth() === month)
        return (
          <div
            key={wi}
            className={`grid grid-cols-7 gap-0 ${isCurrentWeek ? 'bg-[rgba(255,255,255,0.04)] rounded-md' : ''}`}
          >
            {week.map((d, di) => {
              const isCurrentDay = isSameDay(d, today)
              const isOtherMonth = d.getMonth() !== month
              const hasEvent = eventDates?.has(dateKey(d)) || false
              return (
                <button
                  key={di}
                  onClick={() => onSelectDate(d)}
                  className={`relative text-center text-[12px] font-medium py-1 transition-colors ${
                    isCurrentDay
                      ? 'text-white'
                      : isOtherMonth
                      ? 'text-text-dim/40 hover:text-text-dim'
                      : 'text-text hover:bg-hover'
                  }`}
                >
                  {isCurrentDay ? (
                    <span className="bg-accent text-white rounded-md px-1.5 py-0.5 text-[12px] font-semibold">{d.getDate()}</span>
                  ) : (
                    d.getDate()
                  )}
                  {hasEvent && !isCurrentDay && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent/70" />
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
