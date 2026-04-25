'use client'

import { useEffect, useMemo, useState } from 'react'
import { crmFetch } from '@/lib/crm-browser'
import type { CrmLeadAdsIntegrationSettings, CrmWorkspaceSettings } from '@/lib/db'

const mono = { fontFamily: 'var(--font-mono)' } as const

const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'America/Vancouver', label: 'Vancouver (PT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'America/Denver', label: 'Denver (MT)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'America/New_York', label: 'New York (ET)' },
  { value: 'America/Toronto', label: 'Toronto (ET)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
]

const CURRENCIES: Array<{ value: string; label: string }> = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
]

const DAY_LABELS: Array<{ bit: number; label: string }> = [
  { bit: 1, label: 'Sun' },
  { bit: 2, label: 'Mon' },
  { bit: 4, label: 'Tue' },
  { bit: 8, label: 'Wed' },
  { bit: 16, label: 'Thu' },
  { bit: 32, label: 'Fri' },
  { bit: 64, label: 'Sat' },
]

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const sectionDividerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  paddingTop: 16,
  marginTop: 16,
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  ...mono,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  background: 'var(--bg-field)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
  outline: 'none',
  transition: 'border-color 120ms ease',
}

const ghostButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  fontSize: 11,
  ...mono,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
  fontSize: 11,
  ...mono,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition: 'opacity 120ms ease',
}

function useWorkspaceSettings() {
  const [settings, setSettings] = useState<CrmWorkspaceSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  async function load() {
    try {
      setSettings(await crmFetch<CrmWorkspaceSettings>('/api/crm/settings/workspace'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load workspace settings')
    }
  }
  useEffect(() => { load().catch(() => {}) }, [])

  async function save(patch: Record<string, unknown>) {
    try {
      const next = await crmFetch<CrmWorkspaceSettings>('/api/crm/settings/workspace', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      setSettings(next)
      setError(null)
      setFlash(true)
      setTimeout(() => setFlash(false), 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    }
  }

  return { settings, error, flash, save }
}

function SectionTitle({ label, title, description }: { label: string; title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...labelStyle, color: 'var(--accent-text)' }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {description && (
        <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{description}</div>
      )}
    </div>
  )
}

function SavedFlash({ flash }: { flash: boolean }) {
  return (
    <span
      aria-hidden={!flash}
      style={{
        fontSize: 11,
        ...mono,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '3px 10px',
        borderRadius: 20,
        color: 'var(--status-completed)',
        background: 'color-mix(in oklab, var(--status-completed) 14%, transparent)',
        opacity: flash ? 1 : 0,
        transition: 'opacity 120ms ease',
        pointerEvents: 'none',
        display: 'inline-block',
      }}
    >
      Saved
    </span>
  )
}

function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div style={{
      marginBottom: 16,
      padding: '8px 12px',
      fontSize: 13,
      background: 'color-mix(in oklab, var(--status-overdue) 12%, transparent)',
      color: 'var(--status-overdue)',
      borderRadius: 8,
    }}>
      {error}
    </div>
  )
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        cursor: 'pointer',
        transition: 'border-color 120ms ease, background 120ms ease',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{label}</span>
        {description && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{description}</span>}
      </div>
    </label>
  )
}

// ─── Brand + Locale + Business Hours + Notifications ───────────────────────

export function CrmWorkspaceSection() {
  const { settings, error, flash, save } = useWorkspaceSettings()

  if (!settings) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{error || 'Loading...'}</div>
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}><SavedFlash flash={flash} /></div>
      <ErrorBanner error={error} />
      <BrandBlock settings={settings} onSave={save} />
      <LocaleBlock settings={settings} onSave={save} />
      <BusinessHoursBlock settings={settings} onSave={save} />
      <NotificationsBlock settings={settings} onSave={save} />
    </div>
  )
}

function BrandBlock({ settings, onSave }: { settings: CrmWorkspaceSettings; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(settings.name)
  const [color, setColor] = useState(settings.primary_color)

  useEffect(() => setName(settings.name), [settings.name])
  useEffect(() => setColor(settings.primary_color), [settings.primary_color])

  const colorValid = HEX_COLOR.test(color)

  return (
    <section>
      <SectionTitle label="Brand" title="Identity" description="The name that shows up in emails and the accent colour that tints calls-to-action." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>Workspace name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim()
              if (trimmed && trimmed !== settings.name) onSave({ name: trimmed }).catch(() => {})
              else setName(settings.name)
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>Primary color</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={colorValid ? color : settings.primary_color}
              onChange={(e) => {
                setColor(e.target.value)
                onSave({ primary_color: e.target.value }).catch(() => {})
              }}
              style={{
                width: 36,
                height: 36,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            />
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              onBlur={() => {
                if (!HEX_COLOR.test(color)) { setColor(settings.primary_color); return }
                if (color !== settings.primary_color) onSave({ primary_color: color }).catch(() => {})
              }}
              placeholder="#D97757"
              style={{ ...inputStyle, maxWidth: 160, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
        </label>
      </div>
    </section>
  )
}

function LocaleBlock({ settings, onSave }: { settings: CrmWorkspaceSettings; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const timezoneKnown = TIMEZONES.some((t) => t.value === settings.timezone)
  return (
    <section style={sectionDividerStyle}>
      <SectionTitle label="Locale" title="Timezone & currency" description="Defaults for scheduling, reminders, and money formatting." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>Timezone</span>
          <select value={settings.timezone} onChange={(e) => onSave({ timezone: e.target.value }).catch(() => {})} style={inputStyle}>
            {!timezoneKnown && <option value={settings.timezone}>{settings.timezone}</option>}
            {TIMEZONES.map((tz) => (<option key={tz.value} value={tz.value}>{tz.label}</option>))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>Currency</span>
          <select value={settings.currency} onChange={(e) => onSave({ currency: e.target.value }).catch(() => {})} style={inputStyle}>
            {CURRENCIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
          </select>
        </label>
      </div>
    </section>
  )
}

function BusinessHoursBlock({ settings, onSave }: { settings: CrmWorkspaceSettings; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [start, setStart] = useState(String(settings.business_hours_start))
  const [end, setEnd] = useState(String(settings.business_hours_end))

  useEffect(() => setStart(String(settings.business_hours_start)), [settings.business_hours_start])
  useEffect(() => setEnd(String(settings.business_hours_end)), [settings.business_hours_end])

  function commitStart() {
    const n = Number(start)
    if (!Number.isInteger(n) || n < 0 || n > 23) { setStart(String(settings.business_hours_start)); return }
    if (n !== settings.business_hours_start) onSave({ business_hours_start: n }).catch(() => {})
  }
  function commitEnd() {
    const n = Number(end)
    if (!Number.isInteger(n) || n < 1 || n > 24) { setEnd(String(settings.business_hours_end)); return }
    if (n !== settings.business_hours_end) onSave({ business_hours_end: n }).catch(() => {})
  }
  function toggleDay(bit: number) {
    const next = (settings.business_days_mask & bit) ? settings.business_days_mask & ~bit : settings.business_days_mask | bit
    onSave({ business_days_mask: next }).catch(() => {})
  }

  return (
    <section style={sectionDividerStyle}>
      <SectionTitle label="Business hours" title="When you're open" description="Workflows, reminders, and booking windows respect these. 0–23 start, 1–24 end." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>Start hour</span>
          <input type="number" min={0} max={23} value={start} onChange={(e) => setStart(e.target.value)} onBlur={commitStart} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>End hour</span>
          <input type="number" min={1} max={24} value={end} onChange={(e) => setEnd(e.target.value)} onBlur={commitEnd} style={inputStyle} />
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Open days</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DAY_LABELS.map(({ bit, label }) => {
            const active = (settings.business_days_mask & bit) !== 0
            return (
              <label key={bit} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 8,
                border: '1px solid ' + (active ? 'color-mix(in oklab, var(--accent) 30%, var(--border))' : 'var(--border)'),
                background: active ? 'color-mix(in oklab, var(--accent) 14%, var(--bg-elevated))' : 'var(--bg-elevated)',
                color: active ? 'var(--accent-text)' : 'var(--text-dim)',
                cursor: 'pointer',
                transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
              }}>
                <input type="checkbox" checked={active} onChange={() => toggleDay(bit)} style={{ margin: 0 }} />
                <span style={{ fontSize: 11, ...mono, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
              </label>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function NotificationsBlock({ settings, onSave }: { settings: CrmWorkspaceSettings; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  return (
    <section style={sectionDividerStyle}>
      <SectionTitle label="Lead notifications" title="Email alerts" description="Alerts for CRM activity. Distinct from general app notifications." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ToggleRow
          label="Email me when a new lead is created"
          description="Fires once per contact, not per inbound message."
          checked={settings.notify_new_lead_email === 1}
          onChange={(next) => onSave({ notify_new_lead_email: next }).catch(() => {})}
        />
        <ToggleRow
          label="Notify the contact owner on every inbound message"
          description="Owner gets a ping when the lead replies via any channel."
          checked={settings.notify_owner_on_inbound === 1}
          onChange={(next) => onSave({ notify_owner_on_inbound: next }).catch(() => {})}
        />
        <ToggleRow
          label="Auto-append unsubscribe footer to campaign emails"
          description="Adds a compliant unsubscribe link when the email body doesn't already include {unsubscribe_url}."
          checked={settings.auto_unsubscribe_footer === 1}
          onChange={(next) => onSave({ auto_unsubscribe_footer: next }).catch(() => {})}
        />
      </div>
      <div style={{ marginTop: 18 }}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Appointment reminder defaults</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
          Pre-check these on every new booking page. Existing booking pages are untouched.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ToggleRow
            label="Pre-enable the 24-hour reminder"
            description="New booking pages start with the day-before reminder on."
            checked={settings.default_reminder_24h === 1}
            onChange={(next) => onSave({ default_reminder_24h: next }).catch(() => {})}
          />
          <ToggleRow
            label="Pre-enable the 1-hour reminder"
            description="New booking pages start with the last-mile reminder on."
            checked={settings.default_reminder_1h === 1}
            onChange={(next) => onSave({ default_reminder_1h: next }).catch(() => {})}
          />
        </div>
      </div>
    </section>
  )
}

// ─── Conversation AI ───────────────────────────────────────────────────────

const CHANNEL_CHOICES: Array<{ value: 'sms' | 'email' | 'chat'; label: string }> = [
  { value: 'sms',   label: 'SMS' },
  { value: 'chat',  label: 'Web chat' },
  { value: 'email', label: 'Email' },
]

export function CrmConversationAiSection() {
  const { settings, error, flash, save } = useWorkspaceSettings()

  if (!settings) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{error || 'Loading...'}</div>
  }

  const enabled = settings.ai_autoreply_enabled === 1
  const channels = new Set(
    (settings.ai_autoreply_channels || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
  )

  return (
    <div>
      <div style={{ marginBottom: 12 }}><SavedFlash flash={flash} /></div>
      <ErrorBanner error={error} />
      <ConversationAiBlock settings={settings} enabled={enabled} channels={channels} onSave={save} />
    </div>
  )
}

function ConversationAiBlock({
  settings, enabled, channels, onSave,
}: {
  settings: CrmWorkspaceSettings
  enabled: boolean
  channels: Set<string>
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [threshold, setThreshold] = useState(settings.ai_autoreply_confidence_threshold)
  useEffect(() => setThreshold(settings.ai_autoreply_confidence_threshold), [settings.ai_autoreply_confidence_threshold])

  const [cap, setCap] = useState(String(settings.ai_autoreply_max_per_contact_per_day))
  useEffect(() => setCap(String(settings.ai_autoreply_max_per_contact_per_day)), [settings.ai_autoreply_max_per_contact_per_day])

  const [keywords, setKeywords] = useState(settings.ai_autoreply_handoff_keywords || '')
  useEffect(() => setKeywords(settings.ai_autoreply_handoff_keywords || ''), [settings.ai_autoreply_handoff_keywords])

  const [prompt, setPrompt] = useState(settings.ai_autoreply_system_prompt || '')
  useEffect(() => setPrompt(settings.ai_autoreply_system_prompt || ''), [settings.ai_autoreply_system_prompt])

  function toggleChannel(value: 'sms' | 'email' | 'chat') {
    const next = new Set(channels)
    if (next.has(value)) next.delete(value); else next.add(value)
    onSave({ ai_autoreply_channels: Array.from(next).join(',') }).catch(() => {})
  }

  return (
    <section>
      <SectionTitle
        label="Conversation AI"
        title="Auto-reply"
        description="Let Claude Haiku handle inbound messages when it's confident. Everything is logged."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ToggleRow
          label="Enable auto-reply"
          description="Master switch. When off, nothing fires — inbound webhooks keep logging normally."
          checked={enabled}
          onChange={(next) => onSave({ ai_autoreply_enabled: next }).catch(() => {})}
        />

        <div style={{
          padding: '12px 14px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--bg-elevated)',
          opacity: enabled ? 1 : 0.6, pointerEvents: enabled ? 'auto' : 'none',
          transition: 'opacity 120ms ease',
        }}>
          <div style={{ ...labelStyle, marginBottom: 10 }}>Channels</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHANNEL_CHOICES.map(({ value, label }) => {
              const active = channels.has(value)
              return (
                <button key={value} type="button" onClick={() => toggleChannel(value)} style={{
                  padding: '6px 12px', borderRadius: 8,
                  border: '1px solid ' + (active ? 'color-mix(in oklab, var(--accent) 30%, var(--border))' : 'var(--border)'),
                  background: active ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'transparent',
                  color: active ? 'var(--accent-text)' : 'var(--text-dim)',
                  fontSize: 11, ...mono, letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
                }}>{label}</button>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
            Channels the bot is allowed to send on.
          </div>
        </div>

        <div style={{
          padding: '12px 14px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--bg-elevated)',
          opacity: enabled ? 1 : 0.6, pointerEvents: enabled ? 'auto' : 'none',
          transition: 'opacity 120ms ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={labelStyle}>Confidence threshold</span>
            <span style={{ ...mono, fontSize: 12, color: 'var(--accent-text)' }}>{threshold}</span>
          </div>
          <input type="range" min={0} max={100} step={1} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            onMouseUp={() => { if (threshold !== settings.ai_autoreply_confidence_threshold) onSave({ ai_autoreply_confidence_threshold: threshold }).catch(() => {}) }}
            onTouchEnd={() => { if (threshold !== settings.ai_autoreply_confidence_threshold) onSave({ ai_autoreply_confidence_threshold: threshold }).catch(() => {}) }}
            style={{ width: '100%', accentColor: 'var(--accent)' }} />
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
            Only send when the model reports at least this much confidence.
          </div>
        </div>

        <ToggleRow
          label="Only auto-reply outside business hours"
          description="When on, the bot sits out during your open window so teammates handle live inbound."
          checked={settings.ai_autoreply_business_hours_only === 1}
          onChange={(next) => onSave({ ai_autoreply_business_hours_only: next }).catch(() => {})}
        />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, opacity: enabled ? 1 : 0.6 }}>
          <span style={labelStyle}>Max auto-replies per contact per day</span>
          <input type="number" min={0} max={1000} value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => {
              const n = Number(cap)
              if (!Number.isInteger(n) || n < 0 || n > 1000) { setCap(String(settings.ai_autoreply_max_per_contact_per_day)); return }
              if (n !== settings.ai_autoreply_max_per_contact_per_day) onSave({ ai_autoreply_max_per_contact_per_day: n }).catch(() => {})
            }}
            disabled={!enabled} style={inputStyle} />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Hard cap per contact per rolling 24h window. 0 disables the cap.</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, opacity: enabled ? 1 : 0.6 }}>
          <span style={labelStyle}>Handoff keywords</span>
          <textarea value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            onBlur={() => { if (keywords !== (settings.ai_autoreply_handoff_keywords || '')) onSave({ ai_autoreply_handoff_keywords: keywords }).catch(() => {}) }}
            disabled={!enabled} rows={2} placeholder="human,agent,person,speak to someone"
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: 54 }} />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Comma-separated. If an inbound message matches any keyword, the bot stops and fires the handoff trigger.
          </span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, opacity: enabled ? 1 : 0.6 }}>
          <span style={labelStyle}>System prompt</span>
          <textarea value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => {
              const next = prompt.trim() === '' ? null : prompt
              if (next !== (settings.ai_autoreply_system_prompt ?? null)) onSave({ ai_autoreply_system_prompt: next }).catch(() => {})
            }}
            disabled={!enabled} rows={6}
            placeholder="You are the Conversation AI for this workspace. Be warm, direct, professional."
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: 130, lineHeight: 1.5 }} />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            The model sees this plus CRM context on every inbound message. Leave blank for the default.
          </span>
        </label>
      </div>
    </section>
  )
}

// ─── Tracking pixel ────────────────────────────────────────────────────────

export function CrmTrackingPixelSection() {
  const { settings, error } = useWorkspaceSettings()
  const [copied, setCopied] = useState(false)

  if (!settings) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{error || 'Loading...'}</div>
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.example.com'
  const snippet = `<script src="${origin}/pixel/ctrl.js" data-workspace="${settings.public_id}" async></script>`

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* ignore */ }
  }

  return (
    <section>
      <SectionTitle
        label="Tracking"
        title="Install pixel"
        description="Paste this snippet into the <head> of any site you want to track. Pageviews bind to contacts via window.ctrl.identify(email)."
      />
      <div style={{
        padding: '12px 14px', borderRadius: 10,
        border: '1px solid var(--border)', background: 'var(--bg-elevated)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <pre style={{
          ...mono, margin: 0, padding: '10px 12px', borderRadius: 8,
          background: 'var(--bg-field)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text)', overflowX: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5,
        }}>{snippet}</pre>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Fires pageviews automatically. Call <code style={{ ...mono, fontSize: 11 }}>window.ctrl.identify(email)</code> after signup.
          </span>
          <button type="button" onClick={() => copy().catch(() => {})} style={{
            padding: '6px 12px', borderRadius: 8, background: 'transparent',
            border: '1px solid var(--border)',
            color: copied ? 'var(--status-completed)' : 'var(--text-secondary)',
            fontSize: 12, ...mono, letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
    </section>
  )
}

// ─── Lead ads webhook setup ────────────────────────────────────────────────

interface PageTokenDraft {
  page_id: string
  access_token: string
}

export function CrmLeadAdsSection() {
  const [settings, setSettings] = useState<CrmLeadAdsIntegrationSettings | null>(null)
  const [verifyDraft, setVerifyDraft] = useState('')
  const [googleDraft, setGoogleDraft] = useState('')
  const [pageDrafts, setPageDrafts] = useState<PageTokenDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  function hydrate(next: CrmLeadAdsIntegrationSettings) {
    setSettings(next)
    setVerifyDraft(next.facebook_webhook_verify_token || '')
    setGoogleDraft(next.google_ads_api_token || '')
    setPageDrafts(
      next.facebook_page_access_tokens.length > 0
        ? next.facebook_page_access_tokens.map((t) => ({ page_id: t.page_id, access_token: t.access_token }))
        : [{ page_id: '', access_token: '' }]
    )
  }

  async function load() {
    try {
      const next = await crmFetch<CrmLeadAdsIntegrationSettings>('/api/crm/settings/integrations/lead-ads')
      hydrate(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load lead-ad integrations')
    }
  }
  useEffect(() => { load().catch(() => {}) }, [])

  const origin = useMemo(() => {
    if (typeof window === 'undefined') return 'https://app.example.com'
    return window.location.origin
  }, [])

  const facebookUrl = settings ? `${origin}/api/webhooks/lead-ads/facebook/${settings.workspace_public_id}` : ''
  const googleUrl = settings ? `${origin}/api/webhooks/lead-ads/google/${settings.workspace_public_id}` : ''

  async function save(patch: Record<string, unknown>) {
    try {
      const next = await crmFetch<CrmLeadAdsIntegrationSettings>('/api/crm/settings/integrations/lead-ads', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      hydrate(next)
      setError(null)
      setFlash(true)
      setTimeout(() => setFlash(false), 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    }
  }

  async function copyToClipboard(value: string) {
    if (!value) return
    try { await navigator.clipboard.writeText(value) } catch { /* silent */ }
  }

  function updatePageDraft(index: number, patch: Partial<PageTokenDraft>) {
    setPageDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function addPageDraft() { setPageDrafts((prev) => [...prev, { page_id: '', access_token: '' }]) }
  function removePageDraft(index: number) { setPageDrafts((prev) => prev.filter((_, i) => i !== index)) }

  async function savePageTokens() {
    await save({
      facebook_page_access_tokens: pageDrafts
        .map((d) => ({ page_id: d.page_id.trim(), access_token: d.access_token.trim() }))
        .filter((d) => d.page_id && d.access_token),
    })
  }

  if (!settings) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{error || 'Loading...'}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div><SavedFlash flash={flash} /></div>
      <ErrorBanner error={error} />

      <LeadAdsSection title="Facebook Lead Ads" subtitle="Receive leads from Facebook / Instagram Lead Ads. Configure in Meta Business Suite → App → Webhooks → Page → leadgen.">
        <LeadAdsField label="Webhook URL">
          <CopyRow value={facebookUrl} onCopy={() => copyToClipboard(facebookUrl)} />
        </LeadAdsField>
        <LeadAdsField label="Verify token" hint="Paste the same value into Meta's verify token field during webhook setup.">
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={inputStyle} value={verifyDraft} onChange={(e) => setVerifyDraft(e.target.value)} placeholder="e.g. a long random string" />
            <button style={primaryButtonStyle} onClick={() => save({ facebook_webhook_verify_token: verifyDraft.trim() || null }).catch(() => {})}>Save</button>
          </div>
        </LeadAdsField>
        <LeadAdsField label="Page access tokens" hint="One row per Facebook page. Token must have leads_retrieval + pages_show_list + pages_read_engagement.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pageDrafts.map((draft, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 8 }}>
                <input style={inputStyle} value={draft.page_id} onChange={(e) => updatePageDraft(index, { page_id: e.target.value })} placeholder="Page ID" />
                <input style={inputStyle} value={draft.access_token} onChange={(e) => updatePageDraft(index, { access_token: e.target.value })} placeholder="Access token" type="password" />
                <button style={ghostButtonStyle} onClick={() => removePageDraft(index)} aria-label="Remove">Remove</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button style={ghostButtonStyle} onClick={addPageDraft}>+ Add page</button>
              <button style={primaryButtonStyle} onClick={() => savePageTokens().catch(() => {})}>Save pages</button>
            </div>
          </div>
        </LeadAdsField>
      </LeadAdsSection>

      <LeadAdsSection title="Google Lead Form Ads" subtitle="Receive leads from Google Ads Lead Form extensions.">
        <LeadAdsField label="Webhook URL">
          <CopyRow value={googleUrl} onCopy={() => copyToClipboard(googleUrl)} />
        </LeadAdsField>
        <LeadAdsField label="API bearer token" hint="Google sends this as Authorization: Bearer <token>. Rotate periodically.">
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={inputStyle} value={googleDraft} onChange={(e) => setGoogleDraft(e.target.value)} placeholder="shared secret" type="password" />
            <button style={primaryButtonStyle} onClick={() => save({ google_ads_api_token: googleDraft.trim() || null }).catch(() => {})}>Save</button>
          </div>
        </LeadAdsField>
      </LeadAdsSection>
    </div>
  )
}

function LeadAdsSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{
      padding: '18px 20px 20px', borderRadius: 12,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.005em' }}>{title}</div>
        {subtitle && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>{subtitle}</div>}
      </div>
      {children}
    </section>
  )
}

function LeadAdsField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{hint}</span>}
    </div>
  )
}

function CopyRow({ value, onCopy }: { value: string; onCopy: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <code style={{
        flex: 1, padding: '7px 10px', borderRadius: 8,
        background: 'var(--bg-field)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', fontSize: 12, ...mono,
        overflow: 'auto', whiteSpace: 'nowrap',
      }}>{value || '—'}</code>
      <button style={ghostButtonStyle} onClick={onCopy}>Copy</button>
    </div>
  )
}
