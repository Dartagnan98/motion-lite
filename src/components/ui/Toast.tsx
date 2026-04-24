'use client'

import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// ── Types ──────────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
  exiting?: boolean
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

// ── Context ────────────────────────────────────────────────────────────
const ToastContext = createContext<ToastContextValue>({ toast: () => {} })
export const useToast = () => useContext(ToastContext)

// ── Icons ──────────────────────────────────────────────────────────────
const icons: Record<ToastType, React.ReactNode> = {
  success: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--green)" strokeWidth="1.5" opacity="0.8" />
      <path d="M5 8l2 2 4-4" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--red)" strokeWidth="1.5" opacity="0.8" />
      <path d="M6 6l4 4M10 6l-4 4" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2l6.5 11H1.5L8 2z" stroke="var(--gold)" strokeWidth="1.3" fill="none" />
      <path d="M8 7v2.5" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.6" fill="var(--gold)" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--blue)" strokeWidth="1.5" opacity="0.8" />
      <path d="M8 7v4" stroke="var(--blue)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.7" fill="var(--blue)" />
    </svg>
  ),
}

// ── Provider ───────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev.slice(-4), { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 200)
    }, 3500)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 200)
  }, [])

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 'var(--z-toast)' as unknown as number, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}
        >
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

// ── Single Toast ───────────────────────────────────────────────────────
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const borderColor: Record<ToastType, string> = {
    success: 'rgba(0, 230, 118, 0.25)',
    error: 'rgba(239, 83, 80, 0.25)',
    warning: 'rgba(255, 215, 64, 0.25)',
    info: 'rgba(66, 165, 245, 0.25)',
  }

  return (
    <div
      className={toast.exiting ? 'animate-toast-out' : 'animate-toast-in'}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--bg-elevated)',
        border: `1px solid ${borderColor[toast.type]}`,
        borderRadius: 'var(--radius-lg)',
        padding: '10px 14px',
        boxShadow: 'var(--glass-shadow-lg)',
        maxWidth: 360,
        fontSize: 14,
        color: 'var(--text)',
        cursor: 'pointer',
      }}
      onClick={() => onDismiss(toast.id)}
    >
      <span style={{ flexShrink: 0, display: 'flex' }}>{icons[toast.type]}</span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</span>
    </div>
  )
}
