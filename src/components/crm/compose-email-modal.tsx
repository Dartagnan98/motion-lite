'use client'

import { useEffect, useState } from 'react'
import { crmFetch } from '@/lib/crm-browser'

const mono = { fontFamily: 'var(--font-mono)' } as const
const tight = {} as const

interface EmailTemplate { id: number; name: string; subject: string | null; body: string }

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toHtml(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

export interface ComposeEmailPayload {
  to: string
  subject: string
  body_html: string
}

export function ComposeEmailModal({
  open,
  title = 'Compose email',
  description = 'Send a one-off message and record it in the CRM.',
  initialTo = '',
  initialSubject = '',
  sendLabel = 'Send email',
  onClose,
  onSend,
  onSent,
}: {
  open: boolean
  title?: string
  description?: string
  initialTo?: string
  initialSubject?: string
  sendLabel?: string
  onClose: () => void
  onSend: (payload: ComposeEmailPayload) => Promise<unknown>
  onSent?: () => void | Promise<void>
}) {
  const [to, setTo] = useState(initialTo)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])

  useEffect(() => {
    if (!open) return
    setTo(initialTo)
    setSubject(initialSubject)
    setBody('')
    setError(null)
    setSuccess(null)
    setSaving(false)
    crmFetch<EmailTemplate[]>('/api/crm/message-templates?channel=email')
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [initialSubject, initialTo, open])

  if (!open) return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payload = {
      to: to.trim(),
      subject: subject.trim(),
      body_html: toHtml(body),
    }

    if (!payload.to || !payload.subject || !payload.body_html) {
      setError('To, subject, and message are required.')
      return
    }

    setSaving(true)
    try {
      await onSend(payload)
      setSuccess('Email sent.')
      if (onSent) await onSent()
      setTimeout(() => onClose(), 700)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to send email.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}
    >
      <div
        className="h-full w-full max-w-xl border-l border-white/10 bg-[var(--bg-chrome)] p-6 shadow-2xl transition-all duration-200 ease-out"
        style={{ ...tight, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[9px] uppercase tracking-[0.28em] text-[color:var(--accent-text)]" style={mono}>Email</div>
              <div className="mt-2 text-[26px] font-semibold text-white">{title}</div>
              <p className="mt-2 max-w-md text-[13px] text-white/45">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/5 text-white/45 transition-colors hover:bg-white/10 hover:text-white/70 active:scale-[0.96] disabled:opacity-60"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>

          <form onSubmit={submit} className="mt-8 flex flex-1 flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-[9px] uppercase tracking-[0.28em] text-[color:var(--accent-text)]" style={mono}>To</span>
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="name@company.com"
                className="rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none placeholder:text-white/35"
              />
            </label>

            {templates.length > 0 && (
              <label className="flex flex-col gap-2">
                <span className="text-[9px] uppercase tracking-[0.28em] text-[color:var(--accent-text)]" style={mono}>Load from template</span>
                <select
                  onChange={(event) => {
                    const tpl = templates.find((t) => String(t.id) === event.target.value)
                    if (tpl) {
                      setBody(tpl.body)
                      if (tpl.subject) setSubject(tpl.subject)
                    }
                    event.target.value = ''
                  }}
                  defaultValue=""
                  className="rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none"
                >
                  <option value="">Choose a template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}

            <label className="flex flex-col gap-2">
              <span className="text-[9px] uppercase tracking-[0.28em] text-[color:var(--accent-text)]" style={mono}>Subject</span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Subject"
                className="rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none placeholder:text-white/35"
              />
            </label>

            <label className="flex flex-1 flex-col gap-2">
              <span className="text-[9px] uppercase tracking-[0.28em] text-[color:var(--accent-text)]" style={mono}>Message</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={14}
                placeholder="Write the email body..."
                className="min-h-[260px] flex-1 resize-none rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none placeholder:text-white/35"
              />
            </label>

            {error && (
              <div className="rounded-[18px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-[18px] border border-[color:var(--accent)]/25 bg-[color:var(--accent)]/10 px-4 py-3 text-[13px] text-[color:var(--accent-text)]">
                {success}
              </div>
            )}

            <div className="flex items-center justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-[color:var(--accent)] px-5 py-2.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--accent-fg)] transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
                style={mono}
              >
                {saving ? 'Sending...' : sendLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
