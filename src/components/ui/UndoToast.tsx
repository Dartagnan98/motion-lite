'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '@/lib/api-client'

export interface DeletedBatch {
  label: string
  projectIds: number[]
  stageIds: number[]
  taskIds: number[]
}

let showToastFn: ((batch: DeletedBatch) => void) | null = null

/** Call this from anywhere to show the undo toast after a delete */
export function showUndoToast(batch: DeletedBatch) {
  showToastFn?.(batch)
}

const UNDO_TIMEOUT = 8000

export function UndoToastProvider() {
  const [batch, setBatch] = useState<DeletedBatch | null>(null)
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(100)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(0)

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
    timerRef.current = null
    intervalRef.current = null
    setVisible(false)
    setTimeout(() => setBatch(null), 300) // fade out first
  }, [])

  const handleUndo = useCallback(async () => {
    if (!batch) return
    clear()
    await apiFetch('/api/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'restore_batch',
        projectIds: batch.projectIds,
        stageIds: batch.stageIds,
        taskIds: batch.taskIds,
      }),
    })
    // Refresh the UI
    window.dispatchEvent(new Event('sidebar-refresh'))
    window.dispatchEvent(new Event('undo-restore'))
  }, [batch, clear])

  useEffect(() => {
    showToastFn = (newBatch: DeletedBatch) => {
      // Clear any existing timer
      if (timerRef.current) clearTimeout(timerRef.current)
      if (intervalRef.current) clearInterval(intervalRef.current)
      setBatch(newBatch)
      setVisible(true)
      setProgress(100)
      startRef.current = Date.now()

      // Progress bar countdown
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startRef.current
        const pct = Math.max(0, 100 - (elapsed / UNDO_TIMEOUT) * 100)
        setProgress(pct)
      }, 50)

      // Auto-dismiss + hard-delete when undo window expires
      timerRef.current = setTimeout(() => {
        if (intervalRef.current) clearInterval(intervalRef.current)
        setVisible(false)
        setTimeout(() => setBatch(null), 300)
        // Permanently delete -- undo window has passed
        apiFetch('/api/trash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'purge_batch',
            projectIds: newBatch.projectIds,
            stageIds: newBatch.stageIds,
            taskIds: newBatch.taskIds,
          }),
        }).then(() => {
          // Pull deleted items off the calendar
          window.dispatchEvent(new Event('sidebar-refresh'))
          window.dispatchEvent(new Event('undo-restore'))
        }).catch(() => {})
      }, UNDO_TIMEOUT)
    }
    return () => { showToastFn = null }
  }, [])

  if (!batch || typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: `translateX(-50%) translateY(${visible ? 0 : 20}px)`,
        opacity: visible ? 1 : 0,
        transition: 'all 0.3s ease',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 320,
        maxWidth: 480,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(30, 33, 35, 0.98)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#fff' }}>
          {batch.label}
        </span>
        <button
          onClick={handleUndo}
          style={{
            padding: '5px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            color: '#000',
            background: '#fff',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#e5e5e5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
        >
          Undo
        </button>
        <button
          onClick={clear}
          style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {/* Progress bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)' }}>
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: '#f87171',
            transition: 'width 0.05s linear',
          }}
        />
      </div>
    </div>,
    document.body
  )
}
