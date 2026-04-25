'use client'

import type { CSSProperties, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from 'react'

export const monoLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const fieldBaseStyle: CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid var(--border-field)',
  background: 'var(--bg-field)',
  color: 'var(--text)',
  fontSize: 13,
  padding: '10px 12px',
  outline: 'none',
  transition: 'border-color 120ms ease, background 120ms ease',
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ ...monoLabelStyle, fontSize: 10, color: 'var(--text-dim)' }}>
      {children}
    </span>
  )
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>{children}</span>
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...fieldBaseStyle, ...(props.style || {}) }} />
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...fieldBaseStyle, ...(props.style || {}) }} />
}

export function TextAreaInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} style={{ ...fieldBaseStyle, resize: 'vertical', ...(props.style || {}) }} />
}

export function SidebarSection({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <FieldLabel>{label}</FieldLabel>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      </div>
      {children}
    </section>
  )
}

export function SaveBadge({ visible }: { visible: boolean }) {
  return (
    <span
      aria-hidden={!visible}
      style={{
        ...monoLabelStyle,
        fontSize: 10,
        color: 'var(--status-completed)',
        background: 'color-mix(in oklab, var(--status-completed) 12%, transparent)',
        border: '1px solid color-mix(in oklab, var(--status-completed) 20%, transparent)',
        borderRadius: 999,
        padding: '4px 10px',
        opacity: visible ? 1 : 0,
        transition: 'opacity 120ms ease',
      }}
    >
      Saved
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const tone = (() => {
    if (status === 'published') return { color: 'var(--status-completed)', bg: 'color-mix(in oklab, var(--status-completed) 13%, transparent)' }
    if (status === 'scheduled') return { color: 'var(--status-active)', bg: 'color-mix(in oklab, var(--status-active) 13%, transparent)' }
    if (status === 'archived') return { color: 'var(--text-dim)', bg: 'var(--bg-elevated)' }
    return { color: 'var(--text-dim)', bg: 'var(--bg-panel)' }
  })()
  return (
    <span
      style={{
        ...monoLabelStyle,
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 10,
        color: tone.color,
        background: tone.bg,
        border: '1px solid var(--border)',
      }}
    >
      {status}
    </span>
  )
}

export function TokenPill({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      style={{
        ...monoLabelStyle,
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        padding: '4px 9px',
        fontSize: 10,
        color: muted ? 'var(--text-dim)' : 'var(--text-secondary)',
        background: muted ? 'var(--bg-panel)' : 'var(--bg-elevated)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </span>
  )
}

export function MarkdownPreview({ html }: { html: string }) {
  return (
    <div
      className="content-markdown-preview"
      style={{
        minHeight: '100%',
        padding: 24,
        borderRadius: 16,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
      }}
    >
      <style>{`
        .content-markdown-preview h1,
        .content-markdown-preview h2,
        .content-markdown-preview h3 {
          color: var(--text);
          margin: 0 0 0.7em;
          letter-spacing: -0.02em;
        }
        .content-markdown-preview h1 { font-size: 2rem; line-height: 1.1; }
        .content-markdown-preview h2 { font-size: 1.45rem; line-height: 1.18; }
        .content-markdown-preview h3 { font-size: 1.12rem; line-height: 1.24; }
        .content-markdown-preview p,
        .content-markdown-preview li,
        .content-markdown-preview blockquote {
          font-size: 14px;
          line-height: 1.75;
        }
        .content-markdown-preview p,
        .content-markdown-preview ul,
        .content-markdown-preview ol,
        .content-markdown-preview blockquote,
        .content-markdown-preview pre,
        .content-markdown-preview figure,
        .content-markdown-preview hr {
          margin: 0 0 1rem;
        }
        .content-markdown-preview ul,
        .content-markdown-preview ol {
          padding-left: 1.15rem;
        }
        .content-markdown-preview blockquote {
          padding: 0.1rem 0 0.1rem 1rem;
          border-left: 1px solid var(--border-strong);
          color: var(--text-dim);
        }
        .content-markdown-preview a {
          color: var(--accent-text);
          text-decoration: underline;
          text-underline-offset: 0.16em;
        }
        .content-markdown-preview code {
          font-family: var(--font-mono);
          font-size: 0.92em;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.15rem 0.35rem;
        }
        .content-markdown-preview pre {
          background: var(--bg-field);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 14px;
          overflow-x: auto;
        }
        .content-markdown-preview pre code {
          background: transparent;
          border: 0;
          padding: 0;
        }
        .content-markdown-preview hr {
          border: 0;
          border-top: 1px solid var(--border);
        }
        .content-markdown-preview img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 12px;
          border: 1px solid var(--border);
        }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: html || '<p>Start writing to see a preview.</p>' }} />
    </div>
  )
}
