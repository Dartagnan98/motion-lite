'use client'

import { useState, useRef } from 'react'
import { createStageAction } from '@/lib/actions'

export function AddStageRow({ projectId }: { projectId: number }) {
  const [isAdding, setIsAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (!isAdding) {
    return (
      <button
        onClick={() => {
          setIsAdding(true)
          setTimeout(() => inputRef.current?.focus(), 50)
        }}
        className="flex items-center gap-2 rounded-md ml-8 text-[14px] text-text-dim hover:bg-hover hover:text-text-secondary transition-colors"
        style={{ height: 36, padding: '0 10px' }}
      >
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Add stage
      </button>
    )
  }

  return (
    <form
      action={async (formData) => {
        await createStageAction(formData)
        setIsAdding(false)
      }}
      className="flex items-center gap-1 ml-8"
      style={{ height: 36, padding: '0 10px' }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input
        ref={inputRef}
        name="name"
        placeholder="Stage name..."
        className="flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-dim"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setIsAdding(false)
        }}
        onBlur={(e) => {
          if (!e.currentTarget.value.trim()) setIsAdding(false)
        }}
      />
      <button
        type="submit"
        className="rounded-md bg-accent px-2.5 py-1 text-[14px] font-medium text-white hover:bg-accent/80"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setIsAdding(false)}
        className="text-[14px] text-text-dim hover:text-text-secondary"
      >
        Cancel
      </button>
    </form>
  )
}
