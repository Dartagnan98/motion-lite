'use client'

import { useEffect, useState } from 'react'
import type { CrmContactAutomationRecord, CrmCustomFieldDefinitionRecord, CrmPipelineStage, EmailAccount } from '@/lib/db'
import { crmFetch } from '@/lib/crm-browser'

const LIFECYCLE_STAGE_OPTIONS = ['Subscriber', 'Lead', 'MQL', 'SQL', 'Opportunity', 'Customer', 'Evangelist']

type AutomationForm = {
  name: string
  trigger_type: 'tag_added' | 'stage_changed'
  trigger_value: string
  action_type: 'add_tag' | 'remove_tag' | 'set_lifecycle_stage'
  action_value: string
  is_active: boolean
}

interface WorkspaceIntegrationRow {
  id: number; workspace_id: number; provider: string
  is_active: number; config: Record<string, string>; updated_at: number
}

const INTEGRATION_DEFS: Array<{
  provider: string; label: string; description: string
  fields: Array<{ key: string; label: string; placeholder?: string; sensitive?: boolean }>
  webhook_hint?: string
}> = [
  {
    provider: 'google_analytics',
    label: 'Google Analytics (GA4)',
    description: 'Fire GA4 events from workflows using the Measurement Protocol. Find these in Admin → Data Streams → your web stream → Measurement Protocol.',
    fields: [
      { key: 'measurement_id', label: 'Measurement ID', placeholder: 'G-XXXXXXXXXX' },
      { key: 'api_secret', label: 'API secret', placeholder: 'Long opaque string', sensitive: true },
    ],
  },
  {
    provider: 'facebook_pixel',
    label: 'Facebook / Meta Pixel',
    description: 'Fire server-side Conversions API events. Use a long-lived page access token with ads_management + business_management scopes.',
    fields: [
      { key: 'pixel_id', label: 'Pixel ID', placeholder: 'Numeric' },
      { key: 'access_token', label: 'Access token', placeholder: 'EAAG…', sensitive: true },
    ],
  },
  {
    provider: 'twilio',
    label: 'Twilio (SMS + RCS + voice)',
    description: 'Send SMS and RCS from workflows. Paste the inbound webhook URL below into Twilio → Phone Numbers → your number → Messaging → "A message comes in". For RCS: attach an RCS Agent to a Messaging Service and paste the Service SID below — Twilio auto-upgrades eligible recipients, falls back to SMS.',
    fields: [
      { key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxxx…' },
      { key: 'auth_token', label: 'Auth token', placeholder: 'Hidden', sensitive: true },
      { key: 'from_number', label: 'From number', placeholder: '+14155551234' },
      { key: 'messaging_service_sid', label: 'Messaging Service SID (enables RCS)', placeholder: 'MGxxxxxxxx…' },
    ],
    webhook_hint: '/api/webhooks/twilio/sms',
  },
]

function formatLastRun(lastRunAt: number | null): string {
  if (!lastRunAt) return 'never'
  const diff = Date.now() - lastRunAt
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatAutomationSummary(a: CrmContactAutomationRecord, stages: CrmPipelineStage[]): string {
  const trigger = a.trigger_type === 'tag_added'
    ? `when tag "${a.trigger_value}" is added`
    : `when stage → ${stages.find((s) => String(s.id) === a.trigger_value)?.name || `#${a.trigger_value}`}`
  const action = a.action_type === 'set_lifecycle_stage'
    ? `set lifecycle → "${a.action_value}"`
    : `${a.action_type.replace('_', ' ')} "${a.action_value}"`
  return `${trigger} → ${action}`
}

const mono = { fontFamily: 'var(--font-mono)' } as const

type EmailAccountForm = {
  label: string; email: string; provider: 'gmail' | 'smtp' | 'other'
  smtp_host: string; smtp_port: string; smtp_user: string; smtp_pass: string
  imap_host: string; imap_port: string
}
type SanitizedAccount = Omit<EmailAccount, 'smtp_pass_encrypted' | 'provider'> & { provider: string; has_smtp_password?: boolean }
type CustomFieldForm = { label: string; field_type: 'text' | 'number' | 'date' | 'select'; options: string }

function uiProviderToApi(p: EmailAccountForm['provider']) { return p === 'gmail' ? 'google' : p === 'other' ? 'outlook' : 'smtp' }
function apiProviderToLabel(p: string) { return p === 'google' ? 'Gmail' : p === 'outlook' ? 'Other' : 'SMTP' }
function blankForm(): EmailAccountForm { return { label: '', email: '', provider: 'smtp', smtp_host: '', smtp_port: '', smtp_user: '', smtp_pass: '', imap_host: '', imap_port: '' } }
function accountToForm(a?: SanitizedAccount): EmailAccountForm {
  if (!a) return blankForm()
  return { label: a.label, email: a.email, provider: a.provider === 'google' ? 'gmail' : a.provider === 'outlook' ? 'other' : 'smtp', smtp_host: a.smtp_host || '', smtp_port: a.smtp_port ? String(a.smtp_port) : '', smtp_user: a.smtp_user || '', smtp_pass: '', imap_host: a.imap_host || '', imap_port: a.imap_port ? String(a.imap_port) : '' }
}

const inputCls = 'w-full rounded border border-border bg-bg-chrome px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-[color:var(--accent)]/50 transition-colors'
const btnCls = 'rounded border border-border px-2.5 py-1.5 text-[11px] text-text-dim hover:text-text transition-colors'
const btnDangerCls = 'rounded border border-red/20 px-2.5 py-1.5 text-[11px] text-red/70 hover:text-red transition-colors'
const btnPrimaryCls = 'rounded px-3 py-1.5 text-[11px] text-[color:var(--accent-fg)] transition-opacity hover:opacity-90'

function SettingsSecretInput({
  settingKey,
  label,
  placeholder,
  inputType = 'password',
}: {
  settingKey: 'sendgrid_api_key' | 'twilio_account_sid' | 'twilio_auth_token' | 'twilio_phone_number' | 'twilio_messaging_service_sid'
  label: string
  placeholder?: string
  inputType?: 'password' | 'text'
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((response) => response.json() as Promise<Record<string, unknown>>)
      .then((settings) => setValue(typeof settings[settingKey] === 'string' ? settings[settingKey] as string : ''))
      .catch(() => {})
  }, [settingKey])

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [settingKey]: value }),
      })
      if (!response.ok) throw new Error('Failed to save setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim" style={mono}>{label}</span>
      <div className="flex gap-2">
        <input
          type={inputType}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className={inputCls}
        />
        <button
          onClick={() => save().catch(() => {})}
          disabled={saving}
          className={btnPrimaryCls}
          style={{ ...mono, background: 'var(--accent)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </label>
  )
}

function SmallAccountForm({ form, setForm, onSubmit, label }: { form: EmailAccountForm; setForm: React.Dispatch<React.SetStateAction<EmailAccountForm>>; onSubmit: () => Promise<void>; label: string }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {([
          { key: 'label', label: 'Label', type: 'text' },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'smtp_host', label: 'SMTP host', type: 'text' },
          { key: 'smtp_port', label: 'SMTP port', type: 'number' },
          { key: 'smtp_user', label: 'SMTP user', type: 'text' },
          { key: 'smtp_pass', label: 'SMTP pass', type: 'password' },
          { key: 'imap_host', label: 'IMAP host', type: 'text' },
          { key: 'imap_port', label: 'IMAP port', type: 'number' },
        ] as const).map((f) => (
          <label key={f.key} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim" style={mono}>{f.label}</span>
            <input type={f.type} value={form[f.key as keyof EmailAccountForm]} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} className={inputCls} />
          </label>
        ))}
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim" style={mono}>Provider</span>
          <select value={form.provider} onChange={(e) => setForm((p) => ({ ...p, provider: e.target.value as EmailAccountForm['provider'] }))} className={inputCls}>
            <option value="gmail">Gmail</option>
            <option value="smtp">SMTP</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <button onClick={() => onSubmit().catch(() => {})} className={btnPrimaryCls} style={{ ...mono, background: 'var(--accent)' }}>{label}</button>
    </div>
  )
}

// ─── Email Accounts ────────────────────────────────────────────────────────────

export function CrmEmailSection() {
  const [accounts, setAccounts] = useState<SanitizedAccount[]>([])
  const [createForm, setCreateForm] = useState<EmailAccountForm>(blankForm())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EmailAccountForm>(blankForm())
  const [testStatus, setTestStatus] = useState<Record<number, string>>({})
  const [dailyLimitDrafts, setDailyLimitDrafts] = useState<Record<number, string>>({})

  async function load() {
    const data = await crmFetch<SanitizedAccount[]>('/api/crm/email-accounts')
    setAccounts(data)
    setDailyLimitDrafts(Object.fromEntries(data.map((a) => [a.id, String(a.daily_limit ?? 50)])))
  }

  async function create() {
    await crmFetch('/api/crm/email-accounts', { method: 'POST', body: JSON.stringify({ ...createForm, provider: uiProviderToApi(createForm.provider), smtp_port: createForm.smtp_port ? Number(createForm.smtp_port) : null, imap_port: createForm.imap_port ? Number(createForm.imap_port) : null }) })
    setCreateForm(blankForm())
    await load()
  }

  async function update() {
    if (!editingId) return
    await crmFetch(`/api/crm/email-accounts/${editingId}`, { method: 'PUT', body: JSON.stringify({ ...editForm, provider: uiProviderToApi(editForm.provider), smtp_port: editForm.smtp_port ? Number(editForm.smtp_port) : null, imap_port: editForm.imap_port ? Number(editForm.imap_port) : null }) })
    setEditingId(null)
    await load()
  }

  async function updateLimit(id: number) {
    const a = accounts.find((x) => x.id === id)
    if (!a) return
    await crmFetch(`/api/crm/email-accounts/${id}`, { method: 'PUT', body: JSON.stringify({ label: a.label, email: a.email, smtp_host: a.smtp_host, smtp_port: a.smtp_port, smtp_user: a.smtp_user, imap_host: a.imap_host, imap_port: a.imap_port, provider: a.provider, daily_limit: Number(dailyLimitDrafts[id] || '0'), is_active: a.is_active }) })
    await load()
  }

  useEffect(() => { load().catch(() => {}) }, [])

  return (
    <div className="space-y-4">
      {accounts.length === 0 ? (
        <div className="text-[13px] text-text-dim">No accounts connected yet.</div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-bg-chrome p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-text">{a.label}</div>
                  <div className="text-[11px] text-text-dim">{a.email} · {apiProviderToLabel(a.provider)}</div>
                  {a.smtp_host && <div className="text-[10px] text-text-dim/60" style={mono}>{a.smtp_host}:{a.smtp_port}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <label className="flex items-center gap-1">
                    <span className="text-[10px] text-text-dim" style={mono}>Limit/day</span>
                    <input type="number" min="0" value={dailyLimitDrafts[a.id] ?? ''} onChange={(e) => setDailyLimitDrafts((p) => ({ ...p, [a.id]: e.target.value }))} onBlur={() => updateLimit(a.id).catch(() => {})} className="w-14 rounded border border-border bg-bg-chrome px-2 py-1 text-[12px] text-text outline-none" />
                  </label>
                  <button onClick={() => { setEditingId(a.id); setEditForm(accountToForm(a)) }} className={btnCls} style={mono}>Edit</button>
                  <button onClick={() => { setTestStatus((p) => ({ ...p, [a.id]: 'Testing…' })); crmFetch<{ ok: boolean; error?: string }>(`/api/crm/email-accounts/${a.id}/test`, { method: 'POST' }).then((r) => setTestStatus((p) => ({ ...p, [a.id]: r.ok ? 'OK' : r.error || 'Failed' }))).catch((err: Error) => setTestStatus((p) => ({ ...p, [a.id]: err.message }))) }} className={btnCls} style={{ ...mono, color: 'var(--accent)' }}>Test</button>
                  <button onClick={() => crmFetch(`/api/crm/email-accounts/${a.id}`, { method: 'DELETE' }).then(() => load()).catch(() => {})} className={btnDangerCls} style={mono}>Delete</button>
                </div>
              </div>
              {testStatus[a.id] && <div className="text-[11px] text-text-dim">{testStatus[a.id]}</div>}
              {editingId === a.id && (
                <div className="border-t border-border pt-3">
                  <SmallAccountForm form={editForm} setForm={setEditForm} onSubmit={update} label="Save changes" />
                  <button onClick={() => setEditingId(null)} className="mt-2 text-[11px] text-text-dim hover:text-text">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-border pt-4">
        <div className="mb-3 text-[11px] font-medium text-text">Add account</div>
        <SmallAccountForm form={createForm} setForm={setCreateForm} onSubmit={create} label="Create account" />
      </div>
      <div className="border-t border-border pt-4">
        <div className="mb-3 text-[11px] font-medium text-text">SendGrid API key</div>
        <SettingsSecretInput settingKey="sendgrid_api_key" label="SendGrid API key" placeholder="SG..." />
      </div>
    </div>
  )
}

// ─── Pipeline Stages ──────────────────────────────────────────────────────────

export function CrmPipelineSection() {
  const [stages, setStages] = useState<CrmPipelineStage[]>([])
  const [newStage, setNewStage] = useState({ name: '', color: 'var(--accent)' })

  async function load() { setStages(await crmFetch<CrmPipelineStage[]>('/api/crm/pipeline-stages')) }
  async function create() {
    if (!newStage.name.trim()) return
    await crmFetch('/api/crm/pipeline-stages', { method: 'POST', body: JSON.stringify({ name: newStage.name.trim(), color: newStage.color }) })
    setNewStage({ name: '', color: 'var(--accent)' })
    await load()
  }
  async function update(id: number, patch: Partial<Pick<CrmPipelineStage, 'name' | 'color' | 'position'>>) {
    await crmFetch(`/api/crm/pipeline-stages/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
    await load()
  }
  async function reorder(stage: CrmPipelineStage, dir: -1 | 1) {
    const ordered = [...stages].sort((a, b) => a.position - b.position)
    const i = ordered.findIndex((s) => s.id === stage.id)
    const target = ordered[i + dir]
    if (!target) return
    await Promise.all([
      crmFetch(`/api/crm/pipeline-stages/${stage.id}`, { method: 'PUT', body: JSON.stringify({ position: target.position }) }),
      crmFetch(`/api/crm/pipeline-stages/${target.id}`, { method: 'PUT', body: JSON.stringify({ position: stage.position }) }),
    ])
    await load()
  }

  useEffect(() => { load().catch(() => {}) }, [])

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={newStage.name} onChange={(e) => setNewStage((p) => ({ ...p, name: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') create().catch(() => {}) }} placeholder="Stage name" className={`flex-1 ${inputCls}`} />
        <input type="color" value={newStage.color} onChange={(e) => setNewStage((p) => ({ ...p, color: e.target.value }))} className="h-8 w-10 cursor-pointer rounded border border-border bg-bg-chrome px-0.5" />
        <button onClick={() => create().catch(() => {})} className={btnPrimaryCls} style={{ ...mono, background: 'var(--accent)' }}>Add</button>
      </div>
      {stages.length === 0 ? (
        <div className="text-[13px] text-text-dim">No stages yet.</div>
      ) : (
        <div className="space-y-1">
          {[...stages].sort((a, b) => a.position - b.position).map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded border border-border bg-bg-chrome px-3 py-2">
              <input type="color" value={s.color} onChange={(e) => update(s.id, { color: e.target.value }).catch(() => {})} className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent p-0" />
              <input defaultValue={s.name} onBlur={(e) => update(s.id, { name: e.target.value }).catch(() => {})} className="flex-1 bg-transparent text-[13px] text-text outline-none" />
              <button onClick={() => reorder(s, -1).catch(() => {})} className={btnCls} style={mono}>↑</button>
              <button onClick={() => reorder(s, 1).catch(() => {})} className={btnCls} style={mono}>↓</button>
              <button onClick={() => crmFetch(`/api/crm/pipeline-stages/${s.id}`, { method: 'DELETE' }).then(() => load()).catch(() => {})} className={btnDangerCls} style={mono}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Custom Fields ────────────────────────────────────────────────────────────

export function CrmCustomFieldsSection() {
  const [entity, setEntity] = useState<'contact' | 'opportunity' | 'company'>('contact')
  const [fields, setFields] = useState<CrmCustomFieldDefinitionRecord[]>([])
  const [form, setForm] = useState<CustomFieldForm>({ label: '', field_type: 'text', options: '' })

  async function load() { setFields(await crmFetch<CrmCustomFieldDefinitionRecord[]>(`/api/crm/custom-fields?entity=${entity}`)) }
  async function create() {
    if (!form.label.trim()) return
    await crmFetch('/api/crm/custom-fields', { method: 'POST', body: JSON.stringify({ entity, label: form.label.trim(), field_type: form.field_type, options: form.field_type === 'select' ? form.options.split(',').map((o) => o.trim()).filter(Boolean) : [] }) })
    setForm({ label: '', field_type: 'text', options: '' })
    await load()
  }

  useEffect(() => { load().catch(() => {}) }, [entity])

  return (
    <div className="space-y-3">
      <div className="flex gap-1 text-[11px]" style={mono}>
        {(['contact', 'opportunity', 'company'] as const).map((e) => (
          <button key={e} onClick={() => setEntity(e)} className={`px-3 py-1 rounded uppercase tracking-[0.15em] transition-colors ${entity === e ? 'bg-[color:var(--accent)] text-[color:var(--accent-fg)]' : 'border border-border text-text-dim hover:text-text'}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="Field label" className={`flex-1 min-w-[120px] ${inputCls}`} />
        <select value={form.field_type} onChange={(e) => setForm((p) => ({ ...p, field_type: e.target.value as CustomFieldForm['field_type'] }))} className={inputCls} style={{ width: 'auto' }}>
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="select">Select</option>
        </select>
        {form.field_type === 'select' && (
          <input value={form.options} onChange={(e) => setForm((p) => ({ ...p, options: e.target.value }))} placeholder="Option 1, Option 2" className={`flex-1 min-w-[140px] ${inputCls}`} />
        )}
        <button onClick={() => create().catch(() => {})} className={btnPrimaryCls} style={{ ...mono, background: 'var(--accent)' }}>Add field</button>
      </div>
      {fields.length === 0 ? (
        <div className="text-[13px] text-text-dim">No custom {entity} fields defined yet.</div>
      ) : (
        <div className="space-y-1">
          {fields.map((f) => (
            <div key={f.field_key} className="flex items-center justify-between gap-3 rounded border border-border bg-bg-chrome px-3 py-2">
              <div>
                <span className="text-[13px] text-text">{f.label}</span>
                <span className="ml-2 text-[10px] uppercase tracking-[0.15em] text-text-dim" style={mono}>{f.field_type}</span>
                {f.options_list.length > 0 && <span className="ml-1 text-[11px] text-text-dim/70">{f.options_list.join(', ')}</span>}
              </div>
              <button onClick={() => crmFetch(`/api/crm/custom-fields/${encodeURIComponent(f.field_key)}?entity=${entity}`, { method: 'DELETE' }).then(() => load()).catch(() => {})} className={btnDangerCls} style={mono}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Twilio / SMS ─────────────────────────────────────────────────────────────

export function CrmSmsSection() {
  return (
    <div className="space-y-3">
      <SettingsSecretInput settingKey="twilio_account_sid" label="Twilio account SID" placeholder="AC..." />
      <SettingsSecretInput settingKey="twilio_auth_token" label="Twilio auth token" />
      <SettingsSecretInput settingKey="twilio_phone_number" label="Twilio phone number" placeholder="+16045550100" inputType="text" />
      <SettingsSecretInput settingKey="twilio_messaging_service_sid" label="Messaging Service SID (enables RCS)" placeholder="MG..." inputType="text" />
      <div className="rounded-lg border border-border bg-bg-chrome p-3 text-[12px] leading-snug text-text-dim">
        <div className="mb-1 font-medium text-text-secondary">RCS delivery</div>
        To send RCS (rich messages with read receipts, typing indicators, richer formatting on supported devices), create a Messaging Service in Twilio → attach an RCS Agent (requires Google Business Messaging brand registration through Twilio) → add your SMS number to the same service. Paste the service SID above. Twilio auto-routes to RCS when the recipient&apos;s device supports it and falls back to SMS otherwise. Leave blank to send plain SMS from the number above.
      </div>
    </div>
  )
}

// ─── Contact Automations ──────────────────────────────────────────────────────

export function CrmAutomationsSection() {
  const [stages, setStages] = useState<CrmPipelineStage[]>([])
  const [automations, setAutomations] = useState<CrmContactAutomationRecord[]>([])
  const [form, setForm] = useState<AutomationForm>({
    name: '', trigger_type: 'tag_added', trigger_value: '',
    action_type: 'add_tag', action_value: '', is_active: true,
  })

  async function load() {
    const [s, a] = await Promise.all([
      crmFetch<CrmPipelineStage[]>('/api/crm/pipeline-stages'),
      crmFetch<CrmContactAutomationRecord[]>('/api/crm/automations'),
    ])
    setStages(s)
    setAutomations(a)
  }
  useEffect(() => { load().catch(() => {}) }, [])

  async function create() {
    if (!form.name.trim() || !form.trigger_value.trim() || !form.action_value.trim()) return
    await crmFetch('/api/crm/automations', { method: 'POST', body: JSON.stringify({ ...form, name: form.name.trim(), trigger_value: form.trigger_value.trim(), action_value: form.action_value.trim() }) })
    setForm({ name: '', trigger_type: 'tag_added', trigger_value: '', action_type: 'add_tag', action_value: '', is_active: true })
    await load()
  }
  async function toggle(a: CrmContactAutomationRecord) {
    await crmFetch(`/api/crm/automations/${a.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !a.is_active_bool }) })
    await load()
  }
  async function remove(id: number) {
    await crmFetch(`/api/crm/automations/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-bg-chrome p-3 space-y-2">
        <div className="text-[12px] text-text-dim">Simple contact rules. Tag added or stage changed fires an action (add tag, remove tag, set lifecycle). For multi-step logic, use Workflows.</div>
        <div className="grid gap-2 md:grid-cols-2">
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Rule name" className={inputCls} />
          <select value={form.trigger_type} onChange={(e) => setForm((p) => ({ ...p, trigger_type: e.target.value as AutomationForm['trigger_type'], trigger_value: '' }))} className={inputCls}>
            <option value="tag_added">Trigger: Tag added</option>
            <option value="stage_changed">Trigger: Stage changed</option>
          </select>
          {form.trigger_type === 'tag_added' ? (
            <input value={form.trigger_value} onChange={(e) => setForm((p) => ({ ...p, trigger_value: e.target.value }))} placeholder="Trigger tag" className={inputCls} />
          ) : (
            <select value={form.trigger_value} onChange={(e) => setForm((p) => ({ ...p, trigger_value: e.target.value }))} className={inputCls}>
              <option value="">Select stage…</option>
              {stages.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </select>
          )}
          <select value={form.action_type} onChange={(e) => {
            const at = e.target.value as AutomationForm['action_type']
            setForm((p) => ({ ...p, action_type: at, action_value: at === 'set_lifecycle_stage' ? LIFECYCLE_STAGE_OPTIONS[0] : '' }))
          }} className={inputCls}>
            <option value="add_tag">Action: Add tag</option>
            <option value="remove_tag">Action: Remove tag</option>
            <option value="set_lifecycle_stage">Action: Set lifecycle stage</option>
          </select>
          {form.action_type === 'set_lifecycle_stage' ? (
            <select value={form.action_value} onChange={(e) => setForm((p) => ({ ...p, action_value: e.target.value }))} className={inputCls}>
              {LIFECYCLE_STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input value={form.action_value} onChange={(e) => setForm((p) => ({ ...p, action_value: e.target.value }))} placeholder={form.action_type === 'add_tag' ? 'Tag to add' : 'Tag to remove'} className={inputCls} />
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-text-dim">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} /> Enabled
          </label>
          <button onClick={() => create().catch(() => {})} className={`ml-auto ${btnPrimaryCls}`} style={{ ...mono, background: 'var(--accent)' }}>Create rule</button>
        </div>
      </div>

      {automations.length === 0 ? (
        <div className="text-[13px] text-text-dim">No automations yet.</div>
      ) : (
        <div className="space-y-1">
          {automations.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded border border-border bg-bg-chrome px-3 py-2">
              <div className="min-w-0">
                <div className="text-[13px] text-text truncate">{a.name}</div>
                <div className="text-[11px] text-text-dim truncate">{formatAutomationSummary(a, stages)}</div>
                <div className="text-[10px] text-text-dim/70" style={mono}>Runs: {a.run_count} · Last: {formatLastRun(a.last_run_at)}</div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => toggle(a).catch(() => {})} className={btnCls} style={mono}>{a.is_active_bool ? 'Disable' : 'Enable'}</button>
                <button onClick={() => remove(a.id).catch(() => {})} className={btnDangerCls} style={mono}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Workflow Integrations (GA4, FB Pixel, Twilio creds) ──────────────────────

export function CrmWorkflowIntegrationsSection() {
  const [integrations, setIntegrations] = useState<WorkspaceIntegrationRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    const data = await crmFetch<WorkspaceIntegrationRow[]>('/api/crm/integrations').catch(() => [] as WorkspaceIntegrationRow[])
    setIntegrations(data)
    const next: Record<string, Record<string, string>> = {}
    for (const def of INTEGRATION_DEFS) {
      const existing = data.find((i) => i.provider === def.provider)
      next[def.provider] = { ...(existing?.config || {}) }
    }
    setDrafts(next)
  }
  useEffect(() => { load().catch(() => {}) }, [])

  async function save(provider: string) {
    setSaving(provider)
    try {
      await crmFetch('/api/crm/integrations', { method: 'POST', body: JSON.stringify({ provider, config: drafts[provider] || {}, is_active: true }) })
      await load()
    } finally { setSaving(null) }
  }
  async function disconnect(provider: string) {
    await crmFetch(`/api/crm/integrations?provider=${encodeURIComponent(provider)}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] text-text-dim">API credentials stored at the workspace level. Workflow actions check these before firing.</div>
      {INTEGRATION_DEFS.map((def) => {
        const existing = integrations.find((i) => i.provider === def.provider)
        const connected = Boolean(existing?.is_active)
        return (
          <div key={def.provider} className="rounded border border-border bg-bg-chrome p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-[13px] text-text font-medium">{def.label}</div>
              <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-[0.15em]`} style={{ ...mono, color: connected ? 'var(--status-completed)' : 'var(--text-muted)', background: connected ? 'color-mix(in oklab, var(--status-completed) 14%, transparent)' : 'var(--bg-hover)' }}>
                {connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <div className="text-[12px] text-text-dim leading-relaxed">{def.description}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {def.fields.map((field) => (
                <label key={field.key} className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim" style={mono}>{field.label}</span>
                  <input
                    type={field.sensitive ? 'password' : 'text'}
                    value={drafts[def.provider]?.[field.key] ?? ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [def.provider]: { ...(prev[def.provider] || {}), [field.key]: e.target.value } }))}
                    placeholder={field.placeholder}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>
            {def.webhook_hint && connected && <WebhookHintRow path={def.webhook_hint} />}
            <div className="flex gap-2">
              <button onClick={() => save(def.provider).catch(() => {})} disabled={saving === def.provider} className={btnPrimaryCls} style={{ ...mono, background: 'var(--accent)', opacity: saving === def.provider ? 0.5 : 1 }}>
                {saving === def.provider ? 'Saving…' : connected ? 'Update credentials' : 'Connect'}
              </button>
              {connected && <button onClick={() => disconnect(def.provider).catch(() => {})} className={btnCls} style={mono}>Disconnect</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WebhookHintRow({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const absolute = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
  return (
    <div className="flex items-center gap-2 rounded border border-dashed border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 px-3 py-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--accent-text)]" style={mono}>Inbound URL</span>
      <code className="flex-1 text-[11px] text-text overflow-x-auto" style={mono}>{absolute}</code>
      <button
        onClick={() => { navigator.clipboard.writeText(absolute).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
        className="text-[10px] uppercase tracking-[0.06em] px-2 py-0.5 rounded border border-border text-[color:var(--accent-text)]"
        style={mono}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
