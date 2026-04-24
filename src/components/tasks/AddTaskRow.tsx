'use client'

import { useState, useRef } from 'react'
import { createTaskAction } from '@/lib/actions'
import { IconPlus } from '@/components/ui/Icons'

export function AddTaskRow({
  projectId,
  stageId,
  workspaceId,
}: {
  projectId?: number
  stageId?: number
  workspaceId?: number
}) {
  const [isAdding, setIsAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (!isAdding) {
    return (
      <button
        onClick={() => {
          setIsAdding(true)
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
        className="flex w-full items-center text-[14px] text-[var(--text-dim)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-secondary)] transition-colors border-b border-[var(--border)]"
        style={{ height: 36, padding: '0 10px', gap: 4 }}
      >
        {/* Plus icon in row number position */}
        <span className="w-6 shrink-0 flex justify-center">
          <IconPlus size={14} />
        </span>
        Add task
      </button>
    )
  }

  return (
    <form
      action={async (formData) => {
        await createTaskAction(formData)
        setIsAdding(false)
      }}
      className="flex items-center border-b border-[var(--border)]"
      style={{ height: 36, padding: '0 10px', gap: 4 }}
    >
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      {stageId && <input type="hidden" name="stageId" value={stageId} />}
      {workspaceId && <input type="hidden" name="workspaceId" value={workspaceId} />}
      {/* Checkbox in row number position */}
      <span className="w-6 shrink-0 flex justify-center">
        <div className="h-[14px] w-[14px] rounded-sm border border-[var(--border)]" />
      </span>
      <input
        ref={inputRef}
        name="title"
        placeholder="Task name..."
        className="flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-[var(--text-dim)]"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setIsAdding(false)
        }}
        onBlur={(e) => {
          if (!e.currentTarget.value.trim()) setIsAdding(false)
        }}
      />
      <button
        type="submit"
        className="rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-white hover:bg-accent/80"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setIsAdding(false)
        }
        className="text-[13px] text-text-dim hover:text-text-secondary"
      >
        Cancel
      </button>
    </form>
  )
}
