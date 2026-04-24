'use client'

import { useState, useEffect } from 'react'

const shortcuts = [
  { keys: ['g', 'c'], description: 'Go to Calendar' },
  { keys: ['g', 't'], description: 'Go to Tasks' },
  { keys: ['g', 'a'], description: 'Go to Agenda' },
  { keys: ['g', 'i'], description: 'Go to Inbox' },
  { keys: ['g', 's'], description: 'Go to Settings' },
  { keys: ['g', 'd'], description: 'Go to Dashboard' },
  { keys: ['Esc'], description: 'Close panel' },
  { keys: ['?'], description: 'Show shortcuts' },
]

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function toggle() { setOpen(v => !v) }
    window.addEventListener('toggle-shortcuts-help', toggle)
    return () => window.removeEventListener('toggle-shortcuts-help', toggle)
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
      <div
        className="rounded-md border border-border-strong p-5 w-[340px] max-h-[80vh] overflow-y-auto shadow-lg"
        style={{ background: 'var(--bg-modal)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold text-text">Keyboard Shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="space-y-1">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <span className="text-[13px] text-text-secondary">{s.description}</span>
              <div className="flex gap-1 items-center">
                {s.keys.map((k, j) => (
                  <span key={j} className="flex items-center gap-1">
                    <kbd className="rounded-md border border-border px-2 py-0.5 text-[11px] text-text-dim font-mono" style={{ background: 'var(--bg-elevated)' }}>{k}</kbd>
                    {j < s.keys.length - 1 && <span className="text-[11px] text-text-dim mx-0.5">then</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
