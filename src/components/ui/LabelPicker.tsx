'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { LabelChip, safeParseLabels, LABEL_COLORS } from './LabelChip'
import { IconPlus } from '@/components/ui/Icons'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

interface LabelPickerProps {
  taskId?: number
  currentLabels: string
  allLabels: { id: number; name: string; color: string }[]
  onUpdate: (newLabels: string) => void
  onLabelsRefresh?: () => void
  compact?: boolean
}

/**
 * Full label picker with portal dropdown: shows current labels as chips,
 * dropdown to add/remove labels, option to create new labels.
 */
export function LabelPicker({ taskId, currentLabels, allLabels, onUpdate, onLabelsRefresh, compact }: LabelPickerProps) {
  const labels = safeParseLabels(currentLabels)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)])
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropdownHeight = dropdownRef.current?.offsetHeight ?? 300
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow < dropdownHeight + 8
      ? rect.top - dropdownHeight - 4
      : rect.bottom + 4
    setPos({
      top: Math.max(8, top),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePosition()
    requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  // Close when another picker/popover opens
  const instanceId = useRef(Math.random().toString(36).slice(2))
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('popover-open', { detail: instanceId.current }))
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== instanceId.current) { setOpen(false); setAdding(false) }
    }
    window.addEventListener('popover-open', handler)
    return () => window.removeEventListener('popover-open', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setAdding(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setAdding(false) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  function toggleLabel(name: string, add: boolean) {
    const updated = add ? [...labels, name] : labels.filter(l => l !== name)
    onUpdate(updated.length ? JSON.stringify(updated) : '')
  }

  async function createLabel(name: string, color: string) {
    const res = await fetch('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    })
    if (res.ok) {
      onLabelsRefresh?.()
      const updated = [...labels, name]
      onUpdate(JSON.stringify(updated))
    }
  }

  const filtered = allLabels.filter(l => l.name.toLowerCase().includes(filter.toLowerCase()))
  const chipSize = compact ? 'sm' : 'md'

  return (
    <>
      <div ref={triggerRef}>
        {/* Current labels display */}
        <div
          className="flex items-center gap-1 flex-wrap cursor-pointer min-h-[24px]"
          onClick={() => setOpen(!open)}
        >
          {labels.length > 0 ? (
            labels.map(l => {
              const def = allLabels.find(al => al.name === l)
              return (
                <LabelChip
                  key={l}
                  name={l}
                  color={def?.color || '#8c8c8c'}
                  size={chipSize}
                  onRemove={() => toggleLabel(l, false)}
                />
              )
            })
          ) : (
            <span className="text-[13px] text-text-dim">None</span>
          )}
          <button
            className="flex items-center gap-0.5 text-[11px] text-text-dim hover:text-text transition-colors ml-0.5"
            onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
          >
            <IconPlus size={10} strokeWidth={1.3} />
          </button>
        </div>
      </div>

      {/* Portal dropdown */}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          {...popupSurfaceDataProps}
          ref={dropdownRef}
          className={withPopupSurfaceClassName('animate-glass-in')}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 260,
            zIndex: 9999,
            background: 'var(--dropdown-bg)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--glass-shadow-lg)',
          }}
          onMouseDown={stopPopupMouseDown}
          onClick={e => e.stopPropagation()}
        >
          {/* Filter input */}
          <div className="px-2.5 py-1.5 border-b border-border">
            <input
              type="text"
              placeholder="Filter..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
              className="w-full bg-transparent text-[12px] text-text outline-none placeholder:text-text-dim"
            />
          </div>

          {/* Labels list */}
          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.map(label => {
              const isActive = labels.includes(label.name)
              return (
                <button
                  key={label.id}
                  onClick={() => toggleLabel(label.name, !isActive)}
                  className="flex items-center gap-2 w-full px-2.5 py-1 hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                >
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border-[1.5px] shrink-0 transition-colors ${isActive ? 'border-white bg-white/20' : 'border-text-dim/40'}`}>
                    {isActive && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                  <LabelChip name={label.name} color={label.color} size="md" />
                </button>
              )
            })}
            {filtered.length === 0 && !adding && (
              <div className="px-2.5 py-2 text-[12px] text-text-dim text-center">No labels found</div>
            )}
          </div>

          {/* Add label */}
          <div className="border-t border-border">
            {adding ? (
              <div className="px-2.5 py-2 space-y-2">
                <input
                  type="text"
                  placeholder="Label name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  className="w-full bg-card border border-border rounded px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) {
                      createLabel(newName.trim(), newColor)
                      setNewName('')
                      setAdding(false)
                    }
                    if (e.key === 'Escape') setAdding(false)
                  }}
                />
                <div className="flex gap-1.5 flex-wrap">
                  {LABEL_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className={`h-5 w-5 rounded-full transition-all ${newColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-card scale-110' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (newName.trim()) { createLabel(newName.trim(), newColor); setNewName(''); setAdding(false) } }}
                    className="flex-1 px-2 py-1 rounded bg-accent text-white text-[12px] font-medium hover:bg-accent/80"
                  >
                    Create
                  </button>
                  <button onClick={() => setAdding(false)} className="px-2 py-1 rounded text-[12px] text-text-dim hover:bg-hover">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-2 w-full px-2.5 py-1 text-[12px] text-text-dim hover:text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors"
              >
                <IconPlus size={12} />
                Add label
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
