'use client'

import { useState, useRef } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import type { Stage } from '@/lib/types'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { IconChevronRight, IconTrash, IconPlus } from '@/components/ui/Icons'

interface StageManagerProps {
  stages: Stage[]
  projectId: number
  taskCountByStage: Record<number, number>
  onStagesChange: () => void
}

export function StageManager({ stages, projectId, taskCountByStage, onStagesChange }: StageManagerProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingName, setEditingName] = useState<number | null>(null)
  const [deletingStage, setDeletingStage] = useState<number | null>(null)
  const [reassignTo, setReassignTo] = useState<number | null>(null)
  const [addingStage, setAddingStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null)
  const colorBtnRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const addInputRef = useRef<HTMLInputElement>(null)

  async function handleRename(stageId: number, name: string) {
    if (!name.trim()) return
    await fetch('/api/stages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: stageId, name: name.trim() }),
    })
    setEditingName(null)
    onStagesChange()
  }

  async function handleColorChange(stageId: number, color: string) {
    await fetch('/api/stages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: stageId, color }),
    })
    setShowColorPicker(null)
    onStagesChange()
  }

  async function handleDelete(stageId: number) {
    const taskCount = taskCountByStage[stageId] || 0
    await fetch('/api/stages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: stageId, reassignTo: taskCount > 0 ? reassignTo : null }),
    })
    setDeletingStage(null)
    setReassignTo(null)
    onStagesChange()
  }

  async function handleAddStage() {
    if (!newStageName.trim()) return
    await fetch('/api/stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, name: newStageName.trim() }),
    })
    setNewStageName('')
    setAddingStage(false)
    onStagesChange()
  }

  async function handleDrop(targetId: number) {
    if (dragId === null || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    const ordered = [...stages]
    const fromIdx = ordered.findIndex(s => s.id === dragId)
    const toIdx = ordered.findIndex(s => s.id === targetId)
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    await fetch('/api/stages', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, stageIds: ordered.map(s => s.id) }),
    })
    setDragId(null)
    setDragOverId(null)
    onStagesChange()
  }

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-6 py-2.5 text-[12px] font-normal text-text-dim hover:text-text transition-colors"
      >
        <IconChevronRight size={10} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        Stages ({stages.length})
      </button>

      {expanded && (
        <div className="px-6 pb-3 space-y-1">
          {stages.map(stage => (
            <div
              key={stage.id}
              draggable
              onDragStart={() => setDragId(stage.id)}
              onDragOver={e => { e.preventDefault(); setDragOverId(stage.id) }}
              onDrop={() => handleDrop(stage.id)}
              onDragEnd={() => { setDragId(null); setDragOverId(null) }}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 group transition-colors ${
                dragOverId === stage.id ? 'bg-accent/10 border border-accent/30' : 'hover:bg-hover border border-transparent'
              }`}
            >
              {/* Drag handle */}
              <span className="cursor-grab text-text-dim/40 group-hover:text-text-dim">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="4" cy="3" r="1" fill="currentColor"/><circle cx="8" cy="3" r="1" fill="currentColor"/>
                  <circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="8" cy="6" r="1" fill="currentColor"/>
                  <circle cx="4" cy="9" r="1" fill="currentColor"/><circle cx="8" cy="9" r="1" fill="currentColor"/>
                </svg>
              </span>

              {/* Color dot */}
              <div>
                <button
                  ref={el => { colorBtnRefs.current[stage.id] = el }}
                  onClick={() => setShowColorPicker(showColorPicker === stage.id ? null : stage.id)}
                  className="w-3 h-3 rounded-full shrink-0 hover:ring-2 hover:ring-white/20"
                  style={{ background: stage.color }}
                />
                {showColorPicker === stage.id && (
                  <ColorPicker
                    currentColor={stage.color}
                    onSelect={(c) => handleColorChange(stage.id, c)}
                    onClose={() => setShowColorPicker(null)}
                    anchorRef={{ current: colorBtnRefs.current[stage.id] || null }}
                  />
                )}
              </div>

              {/* Name */}
              {editingName === stage.id ? (
                <input
                  autoFocus
                  defaultValue={stage.name}
                  className="flex-1 bg-transparent text-[13px] text-text outline-none"
                  onBlur={e => handleRename(stage.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(stage.id, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setEditingName(null)
                  }}
                />
              ) : (
                <span
                  className="flex-1 text-[13px] text-text cursor-pointer"
                  style={{ fontWeight: 500 }}
                  onClick={() => setEditingName(stage.id)}
                >
                  {stage.name}
                </span>
              )}

              {/* Task count */}
              <span className="text-[12px] text-text-dim px-1.5 py-0.5 rounded bg-hover">
                {taskCountByStage[stage.id] || 0}
              </span>

              {/* Delete */}
              {deletingStage === stage.id ? (
                <div className="flex items-center gap-1.5">
                  {(taskCountByStage[stage.id] || 0) > 0 && (
                    <Dropdown
                      value={reassignTo ? String(reassignTo) : ''}
                      onChange={(v) => setReassignTo(v ? Number(v) : null)}
                      placeholder="No stage"
                      options={[
                        { label: 'No stage', value: '' },
                        ...stages.filter(s => s.id !== stage.id).map(s => ({ label: s.name, value: String(s.id) })),
                      ]}
                      triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[12px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                      minWidth={140}
                    />
                  )}
                  <button onClick={() => handleDelete(stage.id)} className="text-[12px] text-[#ef5350] hover:underline">Delete</button>
                  <button onClick={() => setDeletingStage(null)} className="text-[12px] text-text-dim hover:underline">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setDeletingStage(stage.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-text-dim hover:text-[#ef5350] transition-all"
                >
                  <IconTrash size={12} />
                </button>
              )}
            </div>
          ))}

          {/* Add stage */}
          {addingStage ? (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ffd740] shrink-0" />
              <input
                ref={addInputRef}
                autoFocus
                value={newStageName}
                onChange={e => setNewStageName(e.target.value)}
                placeholder="Stage name..."
                className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim/40"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddStage()
                  if (e.key === 'Escape') { setAddingStage(false); setNewStageName('') }
                }}
              />
              <button onClick={handleAddStage} className="text-[12px] bg-accent text-white px-2 py-0.5 rounded hover:bg-accent/80 font-medium">Add</button>
              <button onClick={() => { setAddingStage(false); setNewStageName('') }} className="text-[12px] text-text-dim hover:text-text">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setAddingStage(true); setTimeout(() => addInputRef.current?.focus(), 50) }}
              className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-text-dim hover:text-text hover:bg-hover rounded-md transition-colors w-full"
            >
              <IconPlus size={12} />
              Add stage
            </button>
          )}
        </div>
      )}
    </div>
  )
}
