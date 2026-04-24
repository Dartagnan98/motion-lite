'use client'

import { createPortal } from 'react-dom'
import { useRef, useState, useEffect } from 'react'
import { APP_COLORS, getHeaderDarkBg } from '@/lib/colors'
import { PRIORITY_COLORS as priorityColors } from '@/lib/task-constants'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${m.toString().padStart(2, '0')} ${ampm}`
}

export function EventBlock({
  title,
  top,
  height,
  color,
  type,
  subtitle,
  startTime,
  endTime,
  isPast,
  conferenceType,
  onClick,
  onDragStart,
  onDragEnd,
  colIndex = 0,
  totalCols = 1,
  overdue = false,
  overdueFrom,
  badge,
  badgeColor,
  onStartTask,
  isTimerRunning,
  chunkLabel,
  isRecurring,
  onEdit,
  onCopy,
  onSetPriority,
  onMarkComplete,
  onDelete,
  eventId,
  calendarId,
  onColorChange,
  projectName,
  taskId,
  taskPublicId,
  onCancel,
  onDuplicate,
  onDoLater,
  onDoAsap,
  onUnschedule,
  onArchive,
  onChangeStartDate,
  onChangeDeadline,
  onAddTime,
  onSetBlockers,
  onViewProject,
  locked,
  onToggleLock,
  ghost,
  busyStatus: busyStatusProp,
  isInvited,
  responseStatus,
  recurringEventId,
  onResizeStart,
  calendarBg,
}: {
  title: string
  top: number
  height: number
  color: string
  type: 'event' | 'task' | 'appointment'
  subtitle?: string
  startTime?: string
  endTime?: string
  isPast?: boolean
  conferenceType?: string
  onClick?: () => void
  onDragStart?: (e: React.MouseEvent) => void
  onDragEnd?: (e: React.MouseEvent) => void
  colIndex?: number
  totalCols?: number
  overdue?: boolean
  overdueFrom?: string
  badge?: string
  badgeColor?: string
  onStartTask?: () => void
  isTimerRunning?: boolean
  chunkLabel?: string
  isRecurring?: boolean
  onEdit?: () => void
  onCopy?: () => void
  onSetPriority?: (priority: 'urgent' | 'high' | 'medium' | 'low') => void
  onMarkComplete?: () => void
  onDelete?: () => void
  eventId?: string
  calendarId?: string
  onColorChange?: (color: string) => void
  projectName?: string
  taskId?: number
  taskPublicId?: string
  onCancel?: () => void
  onDuplicate?: () => void
  onDoLater?: () => void
  onDoAsap?: () => void
  onUnschedule?: () => void
  onArchive?: () => void
  onChangeStartDate?: () => void
  onChangeDeadline?: () => void
  onAddTime?: () => void
  onSetBlockers?: () => void
  onViewProject?: () => void
  locked?: boolean
  onToggleLock?: () => void
  ghost?: boolean
  busyStatus?: string
  isInvited?: boolean
  responseStatus?: string | null
  recurringEventId?: string | null
  onResizeStart?: (e: React.MouseEvent) => void
  calendarBg?: string
}) {
  const isSmall = height < 40
  const isTiny = height < 24
  const timeRange = startTime && endTime ? `${formatTime(startTime)} - ${formatTime(endTime)}` : ''
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null)
  const dragStarted = useRef(false)
  // Leave a ~20px drag strip on the right side of each column for drag-to-create
  const widthPercent = totalCols > 1 ? `calc(${100 / totalCols}% - 22px)` : 'calc(100% - 24px)'
  const leftPercent = totalCols > 1 ? `calc(${(colIndex / totalCols) * 100}% + 1px)` : '4px'

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [prioritySub, setPrioritySub] = useState(false)
  const [colorSub, setColorSub] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dotsRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!ctxMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && !(dotsRef.current && dotsRef.current.contains(e.target as Node))) {
        setCtxMenu(null)
        setPrioritySub(false)
        setColorSub(false)
        setConfirmDelete(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu(null)
        setPrioritySub(false)
        setColorSub(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [ctxMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    if (type === 'appointment') return // read-only, no context menu
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
    setPrioritySub(false)
    setColorSub(false)
    setConfirmDelete(false)
  }

  const closeMenu = () => {
    setCtxMenu(null)
    setPrioritySub(false)
    setColorSub(false)
    setConfirmDelete(false)
  }

  const handleDotsClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (ctxMenu) {
      closeMenu()
      return
    }
    if (dotsRef.current) {
      const rect = dotsRef.current.getBoundingClientRect()
      setCtxMenu({ x: rect.left, y: rect.bottom + 4 })
      setPrioritySub(false)
      setColorSub(false)
      setConfirmDelete(false)
    }
  }

  const menuItem = (label: string, action?: () => void, extra?: React.ReactNode) => (
    <button
      key={label}
      className="w-full text-left px-3 py-1.5 text-[12px] text-text hover:bg-hover flex items-center justify-between gap-2 transition-colors"
      draggable={false}
      onMouseDown={stopPopupMouseDown}
      onClick={(e) => {
        e.stopPropagation()
        action?.()
        if (!extra) closeMenu()
      }}
      onMouseEnter={() => {
        if (label !== 'Set priority') setPrioritySub(false)
        if (label !== 'Set color') setColorSub(false)
      }}
    >
      <span>{label}</span>
      {extra}
    </button>
  )

  const [busyType, setBusyType] = useState<'busy' | 'free'>((busyStatusProp === 'free' ? 'free' : 'busy'))

  const menuItemIcon = (label: string, icon: string, action?: () => void) => (
    <button
      key={label}
      className="w-full text-left px-3 py-1.5 text-[12px] text-text hover:bg-hover flex items-center gap-2 transition-colors"
      draggable={false}
      onMouseDown={stopPopupMouseDown}
      onClick={(e) => {
        e.stopPropagation()
        action?.()
        closeMenu()
      }}
      onMouseEnter={() => { setPrioritySub(false); setColorSub(false) }}
    >
      <span className="w-4 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  )

  const handleCopyTaskLink = async () => {
    const url = taskId ? `${window.location.origin}/tasks?task=${taskPublicId || taskId}` : title
    try { await navigator.clipboard.writeText(url) } catch {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
    }
    closeMenu()
  }

  const handleCopyTitle = async () => {
    try {
      await navigator.clipboard.writeText(title)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = title
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    closeMenu()
  }

  const handleSetColor = async (hex: string) => {
    if (eventId) {
      await fetch('/api/calendar-events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, calendarId, color: hex }),
      })
    }
    onColorChange?.(hex)
    closeMenu()
  }

  const [recurringDeleteMode, setRecurringDeleteMode] = useState<'choose' | null>(null)

  const handleDeleteEvent = async (deleteAll?: boolean) => {
    // For recurring events, show choice first
    if ((isRecurring || recurringEventId) && !confirmDelete && !recurringDeleteMode) {
      setRecurringDeleteMode('choose')
      return
    }
    if (!confirmDelete && !recurringDeleteMode) {
      setConfirmDelete(true)
      return
    }
    if (eventId) {
      const params = new URLSearchParams({ id: eventId })
      if (calendarId) params.set('calendarId', calendarId)
      if (deleteAll) params.set('deleteAll', 'true')
      await fetch(`/api/calendar-events?${params.toString()}`, { method: 'DELETE' })
    }
    onDelete?.()
    closeMenu()
    setRecurringDeleteMode(null)
  }

  const handleDeleteTask = async (deleteAll?: boolean) => {
    if (!confirmDelete) {
      if (isRecurring && !recurringDeleteMode) {
        setRecurringDeleteMode('choose')
        return
      }
      setConfirmDelete(true)
      return
    }
    onDelete?.()
    closeMenu()
    setRecurringDeleteMode(null)
  }

  return (
    <>
    <div
      data-event-block
      className={`absolute rounded-sm overflow-hidden z-10 transition-shadow cursor-pointer hover:shadow-lg hover:z-20 group/block ${isPast ? 'opacity-50' : ''} ${ghost ? 'opacity-40 border-dashed' : ''}`}
      style={{
        top: `${top}px`,
        height: `${Math.max(height, 20)}px`,
        left: leftPercent,
        width: widthPercent,
        ...(type === 'event' && isInvited
          ? {
              background: calendarBg ? `${calendarBg}cc` : `${getHeaderDarkBg(color)}cc`,
              border: `1.5px dashed ${color}60`,
              borderLeft: `3px dashed ${color}`,
            }
          : type === 'event'
          ? {
              background: calendarBg || getHeaderDarkBg(color),
              borderLeft: `3px solid ${color}`,
            }
          : type === 'appointment'
          ? {
              background: 'rgba(217,119,87,0.10)',
              borderRadius: 4,
              border: '1px solid rgba(217,119,87,0.18)',
              borderLeft: `3px solid ${color}`,
            }
          : {
              background: 'rgba(241,237,229,0.10)',
              borderRadius: 4,
              border: '1px solid rgba(241,237,229,0.08)',
              borderLeft: overdue ? '3px dashed #ef5350' : `3px solid ${color}`,
              borderLeftWidth: '3px',
              borderLeftStyle: overdue ? 'dashed' : 'solid',
              borderLeftColor: overdue ? '#ef5350' : color,
            }),
      }}
      title={overdue && overdueFrom ? `Originally scheduled: ${new Date(overdueFrom).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : undefined}
      onContextMenu={handleContextMenu}
      onClick={(e) => {
        if (dragStarted.current) { dragStarted.current = false; return }
        onClick?.()
      }}
      onMouseDown={(e) => {
        // Skip if clicking on interactive children (dots menu, resize handle, start button)
        if ((e.target as HTMLElement).closest('button, [data-resize]')) return
        mouseDownPos.current = { x: e.clientX, y: e.clientY }
        dragStarted.current = false
      }}
      onMouseMove={(e) => {
        if (!mouseDownPos.current || dragStarted.current) return
        const dx = Math.abs(e.clientX - mouseDownPos.current.x)
        const dy = Math.abs(e.clientY - mouseDownPos.current.y)
        if (dx > 1 || dy > 1) {
          dragStarted.current = true
          onDragStart?.(e)
        }
      }}
      onMouseUp={() => {
        if (dragStarted.current) { onDragEnd?.({} as React.MouseEvent) }
        mouseDownPos.current = null
        dragStarted.current = false
      }}
      onMouseLeave={() => {
        // If drag already started, don't reset -- WeekView grid handles tracking
        if (!dragStarted.current) mouseDownPos.current = null
      }}
    >
      <div className={`px-1.5 ${isTiny ? 'py-0 flex items-center gap-1' : isSmall ? 'py-0.5' : 'py-1'}`}>
        {/* Dots menu button removed from here - now inline in title row */}

        {/* Bottom-right: badge/chunk + Start button */}
        {!isTiny && (badge || chunkLabel || onStartTask) && (
          <div className="absolute bottom-1 right-1 flex items-center gap-1 z-10">
            {onStartTask && (
              <button
                className={`${isTimerRunning ? 'opacity-100' : 'opacity-0 group-hover/block:opacity-100'} transition-opacity hover:opacity-80`}
                onClick={(e) => { e.stopPropagation(); onStartTask() }}
                title={isTimerRunning ? 'Stop timer' : 'Start timer'}
              >
                {isTimerRunning ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="white" fillOpacity="0.9"><rect x="2" y="2" width="12" height="12" rx="1"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="white" fillOpacity="0.7"><path d="M4 2.5v11l10-5.5L4 2.5z"/></svg>
                )}
              </button>
            )}
            {badge && (
              <span
                className="text-[11px] font-bold px-1 py-0 rounded leading-tight uppercase"
                style={{ color: badgeColor || '#ef5350', background: `${badgeColor || '#ef5350'}20` }}
              >
                {badge}
              </span>
            )}
            {chunkLabel && !badge && (
              <span className="text-[11px] font-medium text-white/70 bg-white/10 px-1 py-0 rounded leading-tight">
                {chunkLabel}
              </span>
            )}
          </div>
        )}

        {/* Title row */}
        <div className="flex items-center gap-0.5">
          {type === 'appointment' && !isTiny && (
            <span
              className="shrink-0 text-[9px] font-[var(--font-mono,ui-monospace)] font-semibold px-1 py-px rounded leading-none tracking-wide uppercase mr-1"
              style={{ color: 'var(--accent)', background: 'rgba(217,119,87,0.16)', fontFamily: 'var(--font-mono, ui-monospace)' }}
            >
              APPT
            </span>
          )}
          <span
            className={`font-medium truncate min-w-0 ${isTiny ? 'text-[11px]' : 'text-[12px]'} ${isInvited ? 'text-white/80' : 'text-white'} ${type === 'appointment' && (responseStatus === 'cancelled' || busyStatusProp === 'cancelled') ? 'line-through opacity-60' : ''}`}
          >
            {title}
          </span>
          <div className="shrink-0 flex items-center gap-0.5 ml-auto">
            {isRecurring && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-50">
                <path d="M21 2v6h-6M3 12a9 9 0 0115.36-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.36 6.36L3 16"/>
              </svg>
            )}
            {locked && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-60">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            )}
            {conferenceType && !isTiny && (
              conferenceType === 'zoom' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#2D8CFF" fillOpacity="0.6"/><path d="M5 8h9v6H5zM15 9.5l4-2.5v8l-4-2.5z" fill="white" fillOpacity="0.8"/></svg>
              ) : conferenceType === 'meet' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#00897B" fillOpacity="0.6"/><path d="M4 8h10v7H4zM15 10l5-3v9l-5-3z" fill="white" fillOpacity="0.8"/></svg>
              ) : null
            )}
            {!isTiny && type !== 'appointment' && (
              <button
                ref={dotsRef}
                className="w-4 h-4 flex items-center justify-center rounded text-[14px] leading-none font-black text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                onClick={handleDotsClick}
                onMouseDown={(e) => e.stopPropagation()}
              >
                &#8943;
              </button>
            )}
          </div>
        </div>
        {/* Time + subtitle */}
        {!isTiny && timeRange && (
          <div className="text-[11px] text-white/80 mt-0.5 truncate">
            {timeRange}
          </div>
        )}
        {!isSmall && !isTiny && subtitle && (
          <div className="text-[11px] text-white/60 mt-0.5 truncate">{subtitle}</div>
        )}
        {!isTiny && projectName && (
          <div className="text-[11px] text-white/70 mt-0.5 truncate flex items-center gap-1">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="shrink-0"><path d="M2 4a1 1 0 011-1h3.586a1 1 0 01.707.293L8.414 4.414A1 1 0 009.12 4.707H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.5"/></svg>
            {projectName}
          </div>
        )}
      </div>
      {/* Bottom resize handle */}
      {onResizeStart && !isTiny && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize opacity-0 group-hover/block:opacity-100 z-20"
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onResizeStart(e)
          }}
        >
          <div className="mx-auto w-8 h-1 rounded-full bg-white/50 mt-0.5" />
        </div>
      )}
    </div>

    {/* Context menu portal */}
    {ctxMenu && typeof document !== 'undefined' && createPortal(
      <div
        {...popupSurfaceDataProps}
        ref={menuRef}
        className={withPopupSurfaceClassName(`fixed z-[9999] py-1 rounded-lg border border-border glass-elevated animate-glass-in shadow-xl select-none ${type === 'event' ? 'w-[220px]' : 'min-w-[160px]'}`)}
        onMouseDown={stopPopupMouseDown}
        style={{ top: ctxMenu.y, left: ctxMenu.x }}
      >
        {type === 'task' ? (
          <>
            {/* Section 1: Complete / Cancel */}
            {menuItemIcon('Complete task', '✅', onMarkComplete)}
            {menuItemIcon('Cancel task', '❌', onCancel)}
            <div className="border-t border-border my-1" />

            {/* Section 2: Navigation */}
            {menuItemIcon('Copy link', '🔗', handleCopyTaskLink)}
            {menuItemIcon('Open task', '📝', onEdit)}
            {onViewProject && menuItemIcon('View project', '📁', onViewProject)}
            <div className="border-t border-border my-1" />

            {/* Section 3: Task actions */}
            {menuItemIcon('Start task now', '▶', onStartTask)}
            {menuItemIcon('Change start date', '📅', onChangeStartDate)}
            {menuItemIcon('Change deadline', '⏰', onChangeDeadline)}
            {menuItemIcon('Add time to task', '🕐', onAddTime)}
            {menuItemIcon('Do later', '🌙', onDoLater)}
            {menuItemIcon('Do ASAP', '⚠️', onDoAsap)}
            <div className="border-t border-border my-1" />

            {/* Section 4: Organize */}
            {menuItemIcon('Duplicate task', '📋', onDuplicate)}
            <div
              className="relative"
              onMouseEnter={() => setPrioritySub(true)}
              onMouseLeave={() => setPrioritySub(false)}
            >
              {menuItem('Set priority', () => setPrioritySub(!prioritySub), (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="opacity-40"><path d="M2 1l4 3-4 3z"/></svg>
              ))}
              {prioritySub && (
                <div
                  {...popupSurfaceDataProps}
                  className={withPopupSurfaceClassName('absolute left-full top-0 ml-0.5 min-w-[130px] py-1 rounded-lg border border-border glass-elevated animate-glass-in shadow-xl select-none')}
                  onMouseDown={stopPopupMouseDown}
                >
                  {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
                    <button
                      key={p}
                      className="w-full text-left px-3 py-1.5 text-[12px] text-text hover:bg-hover flex items-center gap-2 transition-colors"
                      draggable={false}
                      onMouseDown={stopPopupMouseDown}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSetPriority?.(p)
                        closeMenu()
                      }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: priorityColors[p] }} />
                      <span className="capitalize">{p}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {menuItemIcon('Set blockers', '🚫', onSetBlockers)}
            {menuItemIcon(locked ? 'Unlock task' : 'Lock to this time', locked ? '🔓' : '🔒', onToggleLock)}
            <div className="border-t border-border my-1" />

            {/* Section 5: Danger zone */}
            {menuItemIcon('Unschedule', '✖', onUnschedule)}
            {menuItemIcon('Archive', '📦', onArchive)}
            {isRecurring && recurringDeleteMode === 'choose' ? (
              <div className="px-2 py-1 space-y-0.5">
                <div className="text-[10px] text-text-dim font-medium px-1 mb-0.5">This is a recurring task</div>
                <button
                  className="w-full text-left px-2 py-1 text-[12px] text-[#ef5350] hover:bg-[#ef535010] rounded flex items-center gap-2 transition-colors"
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onDelete?.(); closeMenu(); setRecurringDeleteMode(null) }}
                  onMouseEnter={() => { setPrioritySub(false); setColorSub(false) }}
                >
                  <span className="w-4 text-center">🗑</span>
                  <span>This task only</span>
                </button>
                <button
                  className="w-full text-left px-2 py-1 text-[12px] text-[#ef5350] hover:bg-[#ef535010] rounded flex items-center gap-2 transition-colors"
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onDelete?.(); closeMenu(); setRecurringDeleteMode(null) }}
                  onMouseEnter={() => { setPrioritySub(false); setColorSub(false) }}
                >
                  <span className="w-4 text-center">🗑</span>
                  <span>All tasks in series</span>
                </button>
              </div>
            ) : (
            <button
              className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 transition-colors ${confirmDelete ? 'text-[#ef5350] font-semibold bg-[#ef535015]' : 'text-[#ef5350] hover:bg-hover'}`}
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleDeleteTask() }}
              onMouseEnter={() => { setPrioritySub(false); setColorSub(false) }}
            >
              <span className="w-4 text-center">🗑</span>
              <span>{confirmDelete ? 'Confirm delete?' : 'Delete task'}</span>
            </button>
            )}
          </>
        ) : (
          <>
            {/* Open event */}
            <button
              className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover flex items-center gap-2.5 transition-colors"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onClick?.(); closeMenu() }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2L13 2M13 2V9M13 2L6 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 9v4a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Open event
            </button>

            <div className="border-t border-border my-1" />

            {/* Color section */}
            <div className="px-3 py-2">
              <div className="text-[12px] text-text-dim font-medium mb-2">Color</div>
              <div className="grid grid-cols-6 gap-1.5 mb-1.5">
                {APP_COLORS.map((c) => (
                  <button
                    key={c.value}
                    className="w-7 h-7 rounded-md flex items-center justify-center hover:ring-2 hover:ring-white/30 transition-all"
                    draggable={false}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ background: c.value }}
                    onClick={(e) => { e.stopPropagation(); handleSetColor(c.value) }}
                    title={c.name}
                  >
                    {color === c.value && (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 8l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-accent-text font-medium mt-1">
                {APP_COLORS.find(c => c.value === color)?.name || 'Custom'}
              </div>
            </div>

            <div className="border-t border-border my-1" />

            {/* Type (Busy/Free) */}
            <div className="px-3 py-2">
              <div className="text-[12px] text-text-dim font-medium mb-1.5">Type</div>
              {(['busy', 'free'] as const).map(t => (
                <button
                  key={t}
                  className="w-full text-left px-2 py-1.5 text-[13px] text-text hover:bg-hover flex items-center gap-2 rounded transition-colors"
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setBusyType(t)
                    if (eventId) {
                      fetch('/api/calendar-events', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ eventId, calendarId, busy_status: t }),
                      })
                    }
                    closeMenu()
                  }}
                >
                  {busyType === t && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                  <span className={busyType === t ? '' : 'ml-[20px]'}>{t === 'busy' ? 'Busy' : 'Free'}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-border my-1" />

            {/* Delete event */}
            {recurringDeleteMode === 'choose' ? (
              <div className="px-2 py-1.5 space-y-1">
                <div className="text-[11px] text-text-dim font-medium px-1 mb-1">This is a recurring event</div>
                <button
                  className="w-full text-left px-2 py-1.5 text-[13px] text-[#ef5350] hover:bg-[#ef535010] rounded flex items-center gap-2 transition-colors"
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleDeleteEvent(false) }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>
                  This event only
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 text-[13px] text-[#ef5350] hover:bg-[#ef535010] rounded flex items-center gap-2 transition-colors"
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleDeleteEvent(true) }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v8.5a1.5 1.5 0 001.5 1.5h3a1.5 1.5 0 001.5-1.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  All events in series
                </button>
              </div>
            ) : (
              <button
                className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2.5 transition-colors ${confirmDelete ? 'text-[#ef5350] font-semibold bg-[#ef535015]' : 'text-[#ef5350] hover:bg-hover'}`}
                draggable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteEvent()
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v8.5a1.5 1.5 0 001.5 1.5h3a1.5 1.5 0 001.5-1.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                {confirmDelete ? 'Confirm delete?' : 'Delete event'}
              </button>
            )}
          </>
        )}
      </div>,
      document.body
    )}
    </>
  )
}
