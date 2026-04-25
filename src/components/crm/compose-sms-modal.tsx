'use client'

import { useEffect, useState } from 'react'
import { crmFetch, crmStream } from '@/lib/crm-browser'
import { AiDraftButton, AiDraftModal, type AiTone } from './EmailBlockBuilder'

const mono = { fontFamily: 'var(--font-mono)' } as const

interface SmsTemplate { id: number; name: string; body: string }
type SmsAiAction = 'shorten_160' | 'emoji' | 'friendlier'

const GSM7_BASIC = /^[\x20-\x7E\n\r€£¥èéùìòÇØøÅåΔΦΓΛΩΠΨΣΘΞÆæßÉ]*$/

function smsSegments(body: string): { length: number; segments: number; encoding: 'gsm7' | 'ucs2' } {
  const length = body.length
  if (length === 0) return { length: 0, segments: 0, encoding: 'gsm7' }
  const isGsm7 = GSM7_BASIC.test(body)
  const perSingle = isGsm7 ? 160 : 70
  const perMulti = isGsm7 ? 153 : 67
  const segments = length <= perSingle ? 1 : Math.ceil(length / perMulti)
  return { length, segments, encoding: isGsm7 ? 'gsm7' : 'ucs2' }
}

export function ComposeSmsModal({
  open,
  initialTo = '',
  onClose,
  onSend,
  onSent,
}: {
  open: boolean
  initialTo?: string
  onClose: () => void
  onSend: (payload: { to: string; message: string }) => Promise<unknown>
  onSent?: () => void | Promise<void>
}) {
  const [to, setTo] = useState(initialTo)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [aiActionLoading, setAiActionLoading] = useState<SmsAiAction | null>(null)
  const [, setA2pWarning] = useState<boolean>(false)

  useEffect(() => {
    if (!open) return
    setTo(initialTo)
    setMessage('')
    setSaving(false)
    setError(null)
    setSuccess(null)
    setAiActionLoading(null)
    crmFetch<SmsTemplate[]>('/api/crm/message-templates?channel=sms')
      .then(setTemplates)
      .catch(() => setTemplates([]))
    // A2P 10DLC status check — surface a soft warning when the workspace is
    // not yet approved so the user knows their SMS throughput will be throttled.
    Promise.all([
      crmFetch<{ status?: string } | null>('/api/crm/a2p/brand'),
      crmFetch<Array<{ status?: string }>>('/api/crm/a2p/campaigns'),
    ]).then(([brand, campaigns]) => {
      const brandApproved = brand?.status === 'approved'
      const anyCampaignApproved = Array.isArray(campaigns) && campaigns.some((c) => c.status === 'approved')
      setA2pWarning(!brandApproved || !anyCampaignApproved)
    }).catch(() => setA2pWarning(false))
  }, [initialTo, open])

  async function streamIntoMessage(endpoint: string, body: Record<string, unknown>) {
    let output = ''
    let failure: string | null = null
    await crmStream(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    }, (event) => {
      if (event.type === 'delta' && typeof event.text === 'string') {
        output += event.text
        setMessage(output)
      }
      if (event.type === 'done' && typeof event.text === 'string') {
        output = event.text
        setMessage(event.text)
      }
      if (event.type === 'error') {
        failure = typeof event.error === 'string' ? event.error : 'AI request failed'
      }
    })
    if (failure) throw new Error(failure)
  }

  async function draftWithAi(prompt: string, tone: AiTone) {
    setError(null)
    setSuccess(null)
    await streamIntoMessage('/api/crm/ai/generate', {
      category: 'sms',
      context: {
        goal: prompt,
        audience: to.trim() ? `Contact at ${to.trim()}` : 'Existing CRM contact',
        context_text: `Tone: ${tone}. Write one SMS only. Plain text only. Keep it under 320 characters.`,
      },
    })
  }

  async function runAiAction(action: SmsAiAction) {
    const source = message.trim()
    if (!source) {
      setError('Write a message first.')
      return
    }
    setError(null)
    setSuccess(null)
    setAiActionLoading(action)
    try {
      if (action === 'shorten_160') {
        await streamIntoMessage('/api/crm/ai/rewrite', {
          text: source,
          length: 'shorter',
          instructions: 'Rewrite this as a single SMS under 160 characters. Plain text only. Preserve the CTA if one exists.',
        })
      } else if (action === 'emoji') {
        await streamIntoMessage('/api/crm/ai/rewrite', {
          text: source,
          tone: 'friendly',
          length: 'same',
          instructions: 'Add one natural emoji if it fits. Keep this as a single SMS. Plain text only.',
        })
      } else {
        await streamIntoMessage('/api/crm/ai/rewrite', {
          text: source,
          tone: 'friendly',
          length: 'same',
          instructions: 'Rewrite this to sound warmer and more human while staying concise for SMS. Plain text only.',
        })
      }
    } catch (rewriteError) {
      setError(rewriteError instanceof Error ? rewriteError.message : 'Failed to rewrite SMS.')
    } finally {
      setAiActionLoading(null)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payload = { to: to.trim(), message: message.trim() }
    if (!payload.to || !payload.message) {
      setError('To and message are required.')
      return
    }

    setSaving(true)
    try {
      await onSend(payload)
      setSuccess('SMS sent.')
      if (onSent) await onSent()
      setTimeout(() => onClose(), 700)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to send SMS.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const meter = smsSegments(message)
  const overLimit = meter.length > 320
  const busy = saving || aiActionLoading !== null

  return (
    <div
      onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'color-mix(in oklab, var(--bg-chrome) 68%, transparent)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          borderRadius: 20,
          border: '1px solid var(--border)',
          background: 'var(--bg-panel)',
          padding: 20,
          display: 'grid',
          gap: 18,
        }}
      >
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', ...mono }}>SMS</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>Send text</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Send a one-off SMS from the workspace number, then tighten the copy inline before you send it.
          </p>
        </div>

        <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
          <label style={fieldLabelStyle}>
            <span style={fieldTitleStyle}>To</span>
            <input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="+16045550100"
              style={inputStyle}
            />
          </label>

          {templates.length > 0 && (
            <label style={fieldLabelStyle}>
              <span style={fieldTitleStyle}>Load from template</span>
              <select
                onChange={(event) => {
                  const tpl = templates.find((entry) => String(entry.id) === event.target.value)
                  if (tpl) setMessage(tpl.body)
                  event.target.value = ''
                }}
                defaultValue=""
                style={inputStyle}
              >
                <option value="">Choose a template</option>
                {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
          )}

          <label style={fieldLabelStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={fieldTitleStyle}>Message</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <AiDraftButton label="Draft with AI" onClick={() => setAiOpen(true)} />
                <ActionButton label={aiActionLoading === 'shorten_160' ? 'Working' : 'Shorten to 160'} disabled={busy} onClick={() => { runAiAction('shorten_160').catch(() => {}) }} />
                <ActionButton label={aiActionLoading === 'emoji' ? 'Working' : 'Add emoji'} disabled={busy} onClick={() => { runAiAction('emoji').catch(() => {}) }} />
                <ActionButton label={aiActionLoading === 'friendlier' ? 'Working' : 'Rewrite friendlier'} disabled={busy} onClick={() => { runAiAction('friendlier').catch(() => {}) }} />
              </div>
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={7}
              placeholder="Write the SMS..."
              style={{ ...inputStyle, minHeight: 164, resize: 'vertical', lineHeight: 1.6 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 11, color: overLimit ? 'var(--status-overdue)' : 'var(--text-dim)', ...mono }}>
              <span>{meter.length}/160 CHARS | {meter.segments} SMS</span>
              {meter.encoding === 'ucs2' && <span>UCS-2 | 70 chars per segment</span>}
            </div>
          </label>

          {error && (
            <div style={{ borderRadius: 12, border: '1px solid color-mix(in oklab, var(--status-overdue) 30%, var(--border))', background: 'color-mix(in oklab, var(--status-overdue) 10%, transparent)', padding: '10px 12px', fontSize: 13, color: 'var(--status-overdue)' }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{ borderRadius: 12, border: '1px solid color-mix(in oklab, var(--status-active) 30%, var(--border))', background: 'color-mix(in oklab, var(--status-active) 10%, transparent)', padding: '10px 12px', fontSize: 13, color: 'var(--text)' }}>
              {success}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={secondaryButtonStyle(saving)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={primaryButtonStyle(saving)}
            >
              {saving ? 'Sending...' : 'Send SMS'}
            </button>
          </div>
        </form>
      </div>

      <AiDraftModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        smsMode
        title="Draft SMS with AI"
        subtitle="Describe the text in plain English. AI Studio will draft a single SMS and stream it into the composer."
        onSubmit={async (prompt, tone) => { await draftWithAi(prompt, tone) }}
      />
    </div>
  )
}

function ActionButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'transparent',
        color: 'var(--text)',
        padding: '7px 10px',
        fontSize: 12,
        cursor: disabled ? 'wait' : 'pointer',
        transition: 'background-color 120ms ease, border-color 120ms ease',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

const fieldLabelStyle = { display: 'grid', gap: 8 } as const
const fieldTitleStyle = { fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', ...mono } as const
const inputStyle = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border-field)',
  background: 'var(--bg-field)',
  color: 'var(--text)',
  padding: '12px 14px',
  fontSize: 13,
  outline: 'none',
} as const

function primaryButtonStyle(disabled?: boolean) {
  return {
    border: '1px solid var(--accent)',
    borderRadius: 999,
    background: 'var(--accent)',
    color: 'var(--accent-fg)',
    padding: '9px 14px',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    transition: 'transform 120ms ease, opacity 120ms ease',
    ...mono,
  }
}

function secondaryButtonStyle(disabled?: boolean) {
  return {
    border: '1px solid var(--border)',
    borderRadius: 999,
    background: 'transparent',
    color: 'var(--text)',
    padding: '9px 14px',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    transition: 'transform 120ms ease, opacity 120ms ease',
    ...mono,
  }
}
