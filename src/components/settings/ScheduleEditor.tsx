'use client'

import { useState, useEffect, useCallback } from 'react'

interface ScheduleBlock {
  day: number
  start: string
  end: string
}

interface Schedule {
  id: number
  name: string
  color: string
  is_default: number
  blocks: string
  created_at: number
  updated_at: number
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function timeToRow(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 2 + (m >= 30 ? 1 : 0)
}

function rowToTime(row: number): string {
  const h = Math.floor(row / 2)
  const m = (row % 2) * 30
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function ScheduleEditor() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ day: number; row: number } | null>(null)
  const [dragEnd, setDragEnd] = useState<{ day: number; row: number } | null>(null)

  const activeSchedule = schedules.find(s => s.id === activeId)

  useEffect(() => {
    fetch('/api/schedules').then(r => r.json()).then((data: Schedule[]) => {
      setSchedules(data)
      if (data.length > 0) {
        setActiveId(data[0].id)
        setBlocks(JSON.parse(data[0].blocks))
      }
    })
  }, [])

  const saveBlocks = useCallback(async (newBlocks: ScheduleBlock[]) => {
    if (!activeId) return
    setBlocks(newBlocks)
    await fetch('/api/schedules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeId, blocks: JSON.stringify(newBlocks) }),
    })
    setSchedules(prev => prev.map(s => s.id === activeId ? { ...s, blocks: JSON.stringify(newBlocks) } : s))
  }, [activeId])

  function selectSchedule(s: Schedule) {
    setActiveId(s.id)
    setBlocks(JSON.parse(s.blocks))
  }

  async function addSchedule() {
    const name = prompt('Schedule name:')
    if (!name) return
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, blocks: '[]' }),
    })
    const s = await res.json()
    setSchedules(prev => [...prev, s])
    setActiveId(s.id)
    setBlocks([])
  }

  async function deleteActive() {
    if (!activeId || !confirm('Delete this schedule?')) return
    await fetch('/api/schedules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeId }),
    })
    setSchedules(prev => prev.filter(s => s.id !== activeId))
    setActiveId(schedules.find(s => s.id !== activeId)?.id || null)
  }

  function isCellActive(day: number, row: number): boolean {
    const time = rowToTime(row)
    const nextTime = rowToTime(row + 1)
    return blocks.some(b => b.day === day && b.start <= time && b.end >= nextTime)
  }

  function isCellInDrag(day: number, row: number): boolean {
    if (!isDragging || !dragStart || !dragEnd || dragStart.day !== day) return false
    const minRow = Math.min(dragStart.row, dragEnd.row)
    const maxRow = Math.max(dragStart.row, dragEnd.row)
    return day === dragStart.day && row >= minRow && row <= maxRow
  }

  function handleMouseDown(day: number, row: number) {
    setIsDragging(true)
    setDragStart({ day, row })
    setDragEnd({ day, row })
  }

  function handleMouseEnter(day: number, row: number) {
    if (isDragging && dragStart && dragStart.day === day) {
      setDragEnd({ day, row })
    }
  }

  function handleMouseUp() {
    if (isDragging && dragStart && dragEnd && dragStart.day === dragEnd.day) {
      const day = dragStart.day
      const minRow = Math.min(dragStart.row, dragEnd.row)
      const maxRow = Math.max(dragStart.row, dragEnd.row)
      const start = rowToTime(minRow)
      const end = rowToTime(maxRow + 1)

      // Check if we're removing (all cells in range are active)
      const allActive = Array.from({ length: maxRow - minRow + 1 }, (_, i) => minRow + i).every(r => isCellActive(day, r))

      if (allActive) {
        // Remove blocks that overlap this range
        const newBlocks = blocks.filter(b => !(b.day === day && b.start < end && b.end > start))
        // Re-add parts outside the removal range
        for (const b of blocks) {
          if (b.day === day && b.start < end && b.end > start) {
            if (b.start < start) newBlocks.push({ day, start: b.start, end: start })
            if (b.end > end) newBlocks.push({ day, start: end, end: b.end })
          }
        }
        saveBlocks(newBlocks)
      } else {
        // Merge with existing blocks on this day
        let mergedStart = start
        let mergedEnd = end
        const otherBlocks = blocks.filter(b => {
          if (b.day !== day) return true
          if (b.end >= start && b.start <= end) {
            mergedStart = mergedStart < b.start ? mergedStart : b.start
            mergedEnd = mergedEnd > b.end ? mergedEnd : b.end
            return false
          }
          return true
        })
        saveBlocks([...otherBlocks, { day, start: mergedStart, end: mergedEnd }])
      }
    }
    setIsDragging(false)
    setDragStart(null)
    setDragEnd(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        {schedules.map(s => (
          <button
            key={s.id}
            onClick={() => selectSchedule(s)}
            className={`px-4 py-2 rounded-md text-[14px] font-medium transition-colors ${
              s.id === activeId ? 'bg-accent text-white' : 'bg-elevated text-text-secondary hover:bg-hover'
            }`}
          >
            {s.name}
            {s.is_default === 1 && <span className="ml-1.5 text-[12px] opacity-60">(default)</span>}
          </button>
        ))}
        <button onClick={addSchedule} className="px-3 py-2 text-[14px] text-accent-text hover:underline">+ New</button>
        {activeSchedule && activeSchedule.is_default !== 1 && (
          <button onClick={deleteActive} className="px-3 py-2 text-[14px] text-red hover:underline ml-auto">Delete</button>
        )}
      </div>

      {activeId && (
        <div
          className="select-none border border-border rounded-lg overflow-hidden glass"
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Header */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
            <div className="p-2 text-[12px] text-text-dim" />
            {DAYS.map((d, i) => (
              <div key={d} className="p-2 text-[13px] text-text-secondary font-medium text-center border-l border-border">{d}</div>
            ))}
          </div>

          {/* Grid */}
          <div className="max-h-[640px] overflow-y-auto">
            {HOURS.map(h => (
              <div key={h} className="grid grid-cols-[60px_repeat(7,1fr)]">
                {/* Hour blocks: 2 rows per hour (30 min each) */}
                {[0, 1].map(half => {
                  const row = h * 2 + half
                  return (
                    <div key={half} className="contents">
                      <div className="h-[24px] flex items-center justify-end pr-3 text-[12px] text-text-dim border-b border-border/50">
                        {half === 0 ? `${String(h).padStart(2, '0')}:00` : ''}
                      </div>
                      {DAYS.map((_, day) => {
                        const active = isCellActive(day, row)
                        const inDrag = isCellInDrag(day, row)
                        return (
                          <div
                            key={day}
                            onMouseDown={() => handleMouseDown(day, row)}
                            onMouseEnter={() => handleMouseEnter(day, row)}
                            className={`h-[24px] border-l border-b border-border/50 cursor-pointer transition-colors ${
                              active && !inDrag ? 'bg-accent/30' :
                              inDrag ? 'bg-accent/50' :
                              'hover:bg-hover'
                            }`}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeId && blocks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[12px] text-text-dim font-medium uppercase tracking-wider">Active blocks</h4>
          <div className="flex flex-wrap gap-2">
            {blocks
              .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
              .map((b, i) => (
                <span key={i} className="text-[13px] bg-accent text-white font-bold rounded-md px-3 py-1">
                  {DAYS[b.day]} {b.start}-{b.end}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
