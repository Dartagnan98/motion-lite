'use client'

import { useEffect, useRef, useState } from 'react'

type DialogTone = 'neutral' | 'danger'

interface BaseProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  tone?: DialogTone
}

/**
 * Shared confirm dialog. Replaces window.confirm() so the surface matches the
 * rest of the warm-tinted CRM chrome instead of a native browser box.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  tone = 'neutral',
  loading,
}: BaseProps & {
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
}) {
  return (
    <DialogShell open={open} onClose={onClose} title={title} description={description}>
      <DialogFooter>
        <button onClick={onClose} disabled={loading} style={ghostStyle}>
          {cancelLabel}
        </button>
        <button
          onClick={() => { void onConfirm() }}
          disabled={loading}
          style={tone === 'danger' ? dangerStyle(loading) : primaryStyle(loading)}
          autoFocus
        >
          {loading ? 'Working…' : confirmLabel}
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

/**
 * Shared text prompt. Replaces window.prompt() for rename/create flows.
 * Empty submissions are rejected; Enter submits, Escape cancels.
 */
export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onSubmit,
  onClose,
  required = true,
  loading,
  multiline,
}: BaseProps & {
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  required?: boolean
  multiline?: boolean
  onSubmit: (value: string) => void | Promise<void>
  loading?: boolean
}) {
  const [value, setValue] = useState(defaultValue)
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) { setValue(defaultValue); queueMicrotask(() => ref.current?.focus()) }
  }, [open, defaultValue])

  function submit() {
    const trimmed = value.trim()
    if (required && !trimmed) return
    void onSubmit(trimmed)
  }

  return (
    <DialogShell open={open} onClose={onClose} title={title} description={description}>
      <div style={{ padding: '4px 22px 2px' }}>
        {multiline ? (
          <textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={4}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            style={fieldStyle}
          />
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit() }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            style={fieldStyle}
          />
        )}
      </div>
      <DialogFooter>
        <button onClick={onClose} disabled={loading} style={ghostStyle}>{cancelLabel}</button>
        <button onClick={submit} disabled={loading || (required && !value.trim())} style={primaryStyle(loading)}>
          {loading ? 'Saving…' : confirmLabel}
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────

function DialogShell({
  open, onClose, title, description, children,
}: BaseProps & { children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'color-mix(in oklab, black 55%, transparent)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          borderRadius: 14,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.45)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ padding: '18px 22px 10px' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.005em' }}>
            {title}
          </div>
          {description && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.55 }}>
              {description}
            </div>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '14px 22px 16px',
      display: 'flex', justifyContent: 'flex-end', gap: 8,
    }}>
      {children}
    </div>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 8,
  background: 'var(--bg-field)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'inherit',
  resize: 'vertical',
}

const ghostStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  fontSize: 13,
  cursor: 'pointer',
}

function primaryStyle(loading?: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 8,
    background: 'var(--accent)', color: 'var(--accent-fg)',
    border: 'none', fontSize: 13, fontWeight: 500,
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
  }
}

function dangerStyle(loading?: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 8,
    background: 'var(--status-overdue)', color: '#1a1b1a',
    border: 'none', fontSize: 13, fontWeight: 500,
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
  }
}

// ─── Small hook to declaratively manage dialog state ──────────────────────

export function useDialog<T = void>() {
  const [state, setState] = useState<{ open: boolean; payload?: T }>({ open: false })
  return {
    open: state.open,
    payload: state.payload,
    show: (payload?: T) => setState({ open: true, payload }),
    close: () => setState({ open: false }),
  }
}
