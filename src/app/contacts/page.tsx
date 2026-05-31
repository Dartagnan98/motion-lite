'use client'

// /contacts — CRM Contacts (Sprint 3 — Contact Depth).
// Full 35-column contact detail card with six collapsible sections,
// pickers for company/client/owner/stage, custom-fields editor,
// DND toggles, lifecycle stage dropdown, and blur-save + optimistic updates.

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Contact {
  // Identity & system
  id: number
  public_id: string
  created_at: number
  updated_at: number | null
  // Editable identity
  name: string
  email: string | null
  phone: string | null
  company: string | null
  job_title: string | null
  website: string | null
  // Linkage
  company_id: number | null
  client_profile_id: number | null
  owner_id: number | null
  pipeline_stage_id: number | null
  lifecycle_stage: 'lead' | 'mql' | 'sql' | 'customer' | 'churned' | 'other' | null
  // Communication
  unsubscribed: 0 | 1
  dnd_sms: 0 | 1
  dnd_email: 0 | 1
  dnd_calls: 0 | 1
  tags: string | null
  source: string | null
  last_contacted_at: number | null
  // Profile
  birthday: string | null
  timezone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  // Power
  custom_fields: string | null
  // Notes
  notes: string | null
}

interface TimelineItem {
  subject?: string
  campaign_name?: string
  sent_at?: number
  status?: string
}

interface WorkspaceUser { id: number; name: string; email: string; role: string }
interface ClientProfile { id: number; name: string; slug: string | null }
interface CrmCompany { id: number; name: string }
interface PipelineStage { stage_id: number; stage_name: string; pipeline_name: string }

type FieldError = Partial<Record<keyof Contact, string>>

// ─── Constants ─────────────────────────────────────────────────────────────────

const LIFECYCLE_STAGES = [
  { value: 'lead', label: 'Lead', color: '#6ba3d6' },
  { value: 'mql', label: 'MQL', color: '#b388ff' },
  { value: 'sql', label: 'SQL', color: '#c9a45b' },
  { value: 'customer', label: 'Customer', color: '#4f9d69' },
  { value: 'churned', label: 'Churned', color: '#b46b6b' },
  { value: 'other', label: 'Other', color: '#9aa7b2' },
] as const

const COMMON_COUNTRIES = [
  'Canada', 'United States', 'United Kingdom', 'Australia', 'New Zealand',
  'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Norway',
  'Denmark', 'Finland', 'Switzerland', 'Austria', 'Belgium', 'Portugal',
  'Ireland', 'Japan', 'Singapore', 'India', 'Mexico', 'Brazil', 'Other',
]

const TIMEZONES = typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
  ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
  : ['America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
     'America/Vancouver', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney']

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (s: number | undefined | null) =>
  s ? new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const fmtRelative = (s: number | null | undefined): string => {
  if (!s) return ''
  const diffMs = Date.now() - s * 1000
  const days = Math.floor(diffMs / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? '1 month ago' : `${months} months ago`
}

const lifecycleConfig = (stage: string | null) =>
  LIFECYCLE_STAGES.find((s) => s.value === stage) ?? null

function parseCustomFields(raw: string | null): Array<{ key: string; value: string }> {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? '') }))
  } catch {
    return []
  }
}

function buildCustomFieldsObject(rows: Array<{ key: string; value: string }>): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const { key, value } of rows) {
    const k = key.trim()
    if (k) obj[k] = value
  }
  return obj
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Contact | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState<Partial<Contact>>({})
  const [addSaving, setAddSaving] = useState(false)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/crm/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      const d = await res.json() as { contacts?: Contact[] }
      setContacts(d.contacts ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search, load])

  async function openContact(c: Contact) {
    setSelected(c)
    setTimeline([])
    const res = await fetch(`/api/crm/contacts/${c.public_id}`)
    const d = await res.json() as { contact?: Contact; timeline?: TimelineItem[] }
    if (d.contact) setSelected(d.contact)
    setTimeline(d.timeline ?? [])
  }

  async function saveNew() {
    if (!addForm.name?.trim()) return
    setAddSaving(true)
    try {
      const res = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const d = await res.json() as { contact?: Contact }
      if (d.contact) {
        setContacts((p) => [d.contact!, ...p])
        setAdding(false)
        setAddForm({})
      }
    } finally {
      setAddSaving(false)
    }
  }

  async function handleDelete() {
    if (!selected || !confirm(`Delete ${selected.name}?`)) return
    await fetch(`/api/crm/contacts/${selected.public_id}`, { method: 'DELETE' })
    setContacts((p) => p.filter((c) => c.id !== selected.id))
    setSelected(null)
  }

  function handleContactSaved(updated: Contact) {
    setSelected(updated)
    setContacts((p) => p.map((c) => (c.id === updated.id ? updated : c)))
  }

  const lc = selected ? lifecycleConfig(selected.lifecycle_stage) : null

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Contacts</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => { setAddForm({}); setAdding(true) }}
            className="text-sm font-medium text-white px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--accent)' }}
          >
            + Add contact
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company..."
          className="glass-input w-full text-sm px-3 py-2 rounded-lg mb-4"
        />

        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider border-b" style={{ color: 'var(--text-dim)', borderColor: 'var(--border)' }}>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5 hidden sm:table-cell">Phone</th>
                <th className="text-left px-4 py-2.5 hidden sm:table-cell">Company</th>
                <th className="text-left px-4 py-2.5 hidden md:table-cell">Lifecycle</th>
                <th className="text-left px-4 py-2.5 hidden md:table-cell">Linked to</th>
                <th className="text-left px-4 py-2.5 hidden lg:table-cell">Source</th>
                <th className="text-left px-4 py-2.5 hidden lg:table-cell">Added</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center" style={{ color: 'var(--text-dim)' }}>
                    Loading...
                  </td>
                </tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center" style={{ color: 'var(--text-dim)' }}>
                    {search ? 'No matches.' : 'No contacts yet. Add one or connect lead-ads.'}
                  </td>
                </tr>
              ) : contacts.map((c) => {
                const lc = lifecycleConfig(c.lifecycle_stage)
                const linkedTo = c.company || (c.client_profile_id ? 'Client' : null)
                return (
                  <tr
                    key={c.id}
                    onClick={() => openContact(c)}
                    className="border-b cursor-pointer hover:bg-hover"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text)' }}>{c.name}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-dim)' }}>{c.email || '—'}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell" style={{ color: 'var(--text-dim)' }}>{c.phone || '—'}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell" style={{ color: 'var(--text-dim)' }}>{c.company || '—'}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      {lc ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium text-white" style={{ background: lc.color }}>
                          {lc.label}
                        </span>
                      ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-[12px]" style={{ color: 'var(--text-dim)' }}>
                      {linkedTo || '—'}
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell" style={{ color: 'var(--text-dim)' }}>{c.source || '—'}</td>
                    <td className="px-4 py-2.5 hidden lg:table-cell" style={{ color: 'var(--text-dim)' }}>{fmtDate(c.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add modal */}
      {adding && (
        <Drawer title="New contact" onClose={() => setAdding(false)}>
          <AddContactForm form={addForm} setForm={setAddForm} />
          <div className="flex gap-2 mt-5">
            <button
              onClick={saveNew}
              disabled={addSaving || !addForm.name?.trim()}
              className="flex-1 text-sm font-medium text-white px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {addSaving ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="text-sm px-3 py-2 rounded-lg"
              style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </Drawer>
      )}

      {/* Detail drawer */}
      {selected && !adding && (
        <Drawer
          title={selected.name}
          subtitle={lc ? lc.label : undefined}
          subtitleColor={lc ? lc.color : undefined}
          suppressed={selected.unsubscribed === 1}
          onClose={() => setSelected(null)}
          footer={
            <div className="flex gap-2 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={handleDelete}
                className="text-sm px-3 py-2 rounded-lg"
                style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
              >
                Delete
              </button>
              <div className="flex-1" />
              <p className="text-[11px] self-center" style={{ color: 'var(--text-muted)' }}>
                {selected.updated_at ? `Updated ${fmtRelative(selected.updated_at)}` : `Added ${fmtDate(selected.created_at)}`}
              </p>
            </div>
          }
        >
          <ContactDetailCard
            contact={selected}
            timeline={timeline}
            onSaved={handleContactSaved}
          />
        </Drawer>
      )}
    </main>
  )
}

// ─── Drawer ────────────────────────────────────────────────────────────────────

function Drawer({
  title,
  subtitle,
  subtitleColor,
  suppressed,
  children,
  onClose,
  footer,
}: {
  title: string
  subtitle?: string
  subtitleColor?: string
  suppressed?: boolean
  children: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-md h-full flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-elevated, var(--bg))', borderLeft: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text)' }}>{title}</h2>
            {subtitle && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-white shrink-0"
                style={{ background: subtitleColor }}
              >
                {subtitle}
              </span>
            )}
            {suppressed && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-white shrink-0" style={{ background: 'var(--red)' }}>
                Suppressed
              </span>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 ml-2" style={{ color: 'var(--text-dim)' }}>✕</button>
        </div>
        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>
        {footer && (
          <div className="px-6 pb-4 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Add contact form (thin, existing UX) ──────────────────────────────────────

function AddContactForm({ form, setForm }: { form: Partial<Contact>; setForm: (f: Partial<Contact>) => void }) {
  const field = (key: keyof Contact, label: string, type = 'text') => (
    <div className="mb-3" key={key}>
      <label className="block text-[12px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>{label}</label>
      <input
        type={type}
        value={(form[key] as string) || ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="glass-input w-full text-sm px-3 py-2 rounded-md"
      />
    </div>
  )
  return (
    <div>
      {field('name', 'Name *')}
      {field('email', 'Email', 'email')}
      {field('phone', 'Phone', 'tel')}
      {field('company', 'Company')}
      {field('tags', 'Tags (comma-separated)')}
      <div className="mb-3">
        <label className="block text-[12px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Notes</label>
        <textarea
          value={form.notes || ''}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={3}
          className="glass-input w-full text-sm px-3 py-2 rounded-md resize-y"
        />
      </div>
    </div>
  )
}

// ─── Contact detail card (six sections) ────────────────────────────────────────

function ContactDetailCard({
  contact,
  timeline,
  onSaved,
}: {
  contact: Contact
  timeline: TimelineItem[]
  onSaved: (c: Contact) => void
}) {
  const [fieldErrors, setFieldErrors] = useState<FieldError>({})
  const [saving, setSaving] = useState<string | null>(null)

  async function patch(fields: Partial<Contact>): Promise<Contact | null> {
    setSaving(Object.keys(fields)[0] ?? 'field')
    setFieldErrors((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(fields) as Array<keyof Contact>) delete next[k]
      return next
    })
    try {
      const res = await fetch(`/api/crm/contacts/${contact.public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const d = await res.json() as { contact?: Contact; error?: string }
      if (!res.ok || !d.contact) {
        const errorMsg = d.error ?? 'Save failed'
        const key = Object.keys(fields)[0] as keyof Contact
        if (key) setFieldErrors((prev) => ({ ...prev, [key]: errorMsg }))
        return null
      }
      onSaved(d.contact)
      return d.contact
    } catch {
      const key = Object.keys(fields)[0] as keyof Contact
      if (key) setFieldErrors((prev) => ({ ...prev, [key]: 'Network error' }))
      return null
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-1">
      <IdentitySection contact={contact} fieldErrors={fieldErrors} saving={saving} patch={patch} />
      <LinkageSection contact={contact} fieldErrors={fieldErrors} saving={saving} patch={patch} />
      <CommunicationSection contact={contact} fieldErrors={fieldErrors} saving={saving} patch={patch} />
      <AddressSection contact={contact} fieldErrors={fieldErrors} saving={saving} patch={patch} />
      <CustomFieldsSection contact={contact} patch={patch} />
      <NotesSection contact={contact} fieldErrors={fieldErrors} saving={saving} patch={patch} />
      <TimelineSection timeline={timeline} />
    </div>
  )
}

// ─── Section shell ─────────────────────────────────────────────────────────────

function Section({
  title,
  defaultOpen = false,
  redBorder = false,
  badge,
  children,
}: {
  title: string
  defaultOpen?: boolean
  redBorder?: boolean
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: redBorder
          ? '1px solid rgba(239,83,80,0.5)'
          : '1px solid var(--border)',
        marginBottom: '6px',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
        style={{ background: 'var(--bg-panel)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-medium tracking-widest uppercase"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}
          >
            {title}
          </span>
          {badge}
        </div>
        <span
          className="text-[12px] transition-transform"
          style={{
            color: 'var(--accent)',
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3" style={{ background: 'var(--bg)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Shared field primitives ───────────────────────────────────────────────────

function FieldRow({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-3">
      <label className="block text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </label>
      {children}
      {error && <p className="text-[11px] mt-1" style={{ color: 'var(--red)' }}>{error}</p>}
    </div>
  )
}

function BlurInput({
  value,
  type = 'text',
  placeholder,
  onCommit,
  error,
  saving,
}: {
  value: string
  type?: string
  placeholder?: string
  onCommit: (v: string) => void
  error?: string
  saving?: boolean
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <input
      type={type}
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local) }}
      disabled={saving}
      className="glass-input w-full text-sm px-3 py-2 rounded-md disabled:opacity-60"
      style={error ? { borderColor: 'var(--red)' } : {}}
    />
  )
}

function BlurTextarea({
  value,
  placeholder,
  rows = 4,
  onCommit,
}: {
  value: string
  placeholder?: string
  rows?: number
  onCommit: (v: string) => void
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <textarea
      value={local}
      placeholder={placeholder}
      rows={rows}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local) }}
      className="glass-input w-full text-sm px-3 py-2 rounded-md resize-y"
    />
  )
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  tooltip,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
  tooltip?: string
}) {
  return (
    <div
      className="flex items-center justify-between py-2"
      title={tooltip}
    >
      <span className="text-[13px]" style={{ color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-accent' : ''} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
        style={!checked ? { background: 'var(--border-strong)' } : {}}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </button>
    </div>
  )
}

// ─── Picker ─────────────────────────────────────────────────────────────────────

interface PickerOption { id: number; label: string; sublabel?: string }

function Picker({
  value,
  placeholder,
  onFetch,
  onSelect,
}: {
  value: string | null
  placeholder?: string
  onFetch: () => Promise<PickerOption[]>
  onSelect: (id: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<PickerOption[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  async function handleOpen() {
    setOpen(true)
    if (options.length > 0) return
    setLoading(true)
    try {
      const opts = await onFetch()
      setOptions(opts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const filtered = options.filter((o) =>
    !query || o.label.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="glass-input w-full text-sm px-3 py-2 rounded-md text-left flex items-center justify-between"
      >
        <span style={{ color: value ? 'var(--text)' : 'var(--text-muted)' }}>
          {value ?? (placeholder || '— None —')}
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-lg shadow-xl overflow-hidden"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="glass-input w-full text-sm px-2 py-1.5 rounded-md"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {loading ? (
              <p className="px-3 py-3 text-[13px]" style={{ color: 'var(--text-dim)' }}>Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-3 text-[13px]" style={{ color: 'var(--text-dim)' }}>No results</p>
            ) : filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onSelect(o.id); setOpen(false); setQuery('') }}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-hover"
                style={{ color: 'var(--text)' }}
              >
                {o.label}
                {o.sublabel && <span className="ml-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>{o.sublabel}</span>}
              </button>
            ))}
          </div>
          <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false); setQuery('') }}
              className="text-[12px]"
              style={{ color: 'var(--text-dim)' }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Section 1 — Identity ───────────────────────────────────────────────────────

function IdentitySection({
  contact,
  fieldErrors,
  saving,
  patch,
}: {
  contact: Contact
  fieldErrors: FieldError
  saving: string | null
  patch: (f: Partial<Contact>) => Promise<Contact | null>
}) {
  return (
    <Section title="Identity" defaultOpen>
      <FieldRow label="Name" error={fieldErrors.name}>
        <BlurInput
          value={contact.name}
          onCommit={(v) => patch({ name: v })}
          saving={saving === 'name'}
          error={fieldErrors.name}
        />
      </FieldRow>
      <FieldRow label="Email" error={fieldErrors.email}>
        <BlurInput
          value={contact.email ?? ''}
          type="email"
          placeholder="name@example.com"
          onCommit={(v) => patch({ email: v || null })}
          saving={saving === 'email'}
          error={fieldErrors.email}
        />
      </FieldRow>
      <FieldRow label="Phone" error={fieldErrors.phone}>
        <BlurInput
          value={contact.phone ?? ''}
          type="tel"
          onCommit={(v) => patch({ phone: v || null })}
          saving={saving === 'phone'}
          error={fieldErrors.phone}
        />
      </FieldRow>
      <FieldRow label="Job Title" error={fieldErrors.job_title}>
        <BlurInput
          value={contact.job_title ?? ''}
          onCommit={(v) => patch({ job_title: v || null })}
          saving={saving === 'job_title'}
          error={fieldErrors.job_title}
        />
      </FieldRow>
      <FieldRow label="Website" error={fieldErrors.website}>
        <BlurInput
          value={contact.website ?? ''}
          type="url"
          placeholder="example.com"
          onCommit={(v) => patch({ website: v || null })}
          saving={saving === 'website'}
          error={fieldErrors.website}
        />
      </FieldRow>
    </Section>
  )
}

// ─── Section 2 — Linkage ───────────────────────────────────────────────────────

function LinkageSection({
  contact,
  fieldErrors,
  saving,
  patch,
}: {
  contact: Contact
  fieldErrors: FieldError
  saving: string | null
  patch: (f: Partial<Contact>) => Promise<Contact | null>
}) {
  // Store resolved display labels so picker shows them without re-fetch
  const [companyLabel, setCompanyLabel] = useState<string | null>(
    contact.company_id ? (contact.company ?? null) : null
  )
  const [clientLabel, setClientLabel] = useState<string | null>(null)
  const [ownerLabel, setOwnerLabel] = useState<string | null>(null)
  const [stageLabel, setStageLabel] = useState<string | null>(null)

  return (
    <Section title="Linkage">
      <FieldRow label="Company" error={fieldErrors.company_id}>
        <Picker
          value={companyLabel}
          placeholder="— None —"
          onFetch={async () => {
            const res = await fetch('/api/crm/companies?show_promoted=1')
            const d = await res.json() as { companies?: CrmCompany[] }
            return (d.companies ?? []).map((c) => ({ id: c.id, label: c.name }))
          }}
          onSelect={(id) => {
            patch({ company_id: id })
            if (!id) setCompanyLabel(null)
          }}
        />
        {contact.company_id && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>id: {contact.company_id}</p>
        )}
      </FieldRow>

      <FieldRow label="Client" error={fieldErrors.client_profile_id}>
        <Picker
          value={clientLabel ?? (contact.client_profile_id ? `Client #${contact.client_profile_id}` : null)}
          placeholder="— None —"
          onFetch={async () => {
            const res = await fetch('/api/clients')
            const d = await res.json() as { profiles?: ClientProfile[] }
            return (d.profiles ?? []).map((c) => ({ id: c.id, label: c.name }))
          }}
          onSelect={(id) => {
            patch({ client_profile_id: id })
            setClientLabel(null)
          }}
        />
      </FieldRow>

      <FieldRow label="Owner" error={fieldErrors.owner_id}>
        <Picker
          value={ownerLabel ?? (contact.owner_id ? `User #${contact.owner_id}` : null)}
          placeholder="— Unassigned —"
          onFetch={async () => {
            const res = await fetch('/api/crm/workspace-users')
            const d = await res.json() as { users?: WorkspaceUser[] }
            return (d.users ?? []).map((u) => ({ id: u.id, label: u.name, sublabel: u.email }))
          }}
          onSelect={(id) => {
            patch({ owner_id: id })
            setOwnerLabel(null)
          }}
        />
      </FieldRow>

      <FieldRow label="Pipeline Stage" error={fieldErrors.pipeline_stage_id}>
        <Picker
          value={stageLabel ?? (contact.pipeline_stage_id ? `Stage #${contact.pipeline_stage_id}` : null)}
          placeholder="— No stage —"
          onFetch={async () => {
            const res = await fetch('/api/crm/pipelines')
            const d = await res.json() as { pipelines?: Array<{ id: number; name: string; stages: Array<{ id: number; name: string }> }> }
            const flat: PipelineStage[] = []
            for (const p of d.pipelines ?? []) {
              for (const s of p.stages ?? []) {
                flat.push({ stage_id: s.id, stage_name: s.name, pipeline_name: p.name })
              }
            }
            return flat.map((s) => ({ id: s.stage_id, label: s.stage_name, sublabel: s.pipeline_name }))
          }}
          onSelect={(id) => {
            patch({ pipeline_stage_id: id })
            setStageLabel(null)
          }}
        />
      </FieldRow>

      <FieldRow label="Lifecycle Stage" error={fieldErrors.lifecycle_stage}>
        <select
          value={contact.lifecycle_stage ?? ''}
          onChange={(e) => patch({ lifecycle_stage: (e.target.value || null) as Contact['lifecycle_stage'] })}
          className="glass-input w-full text-sm px-3 py-2 rounded-md"
          disabled={saving === 'lifecycle_stage'}
        >
          <option value="">— None —</option>
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {fieldErrors.lifecycle_stage && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--red)' }}>{fieldErrors.lifecycle_stage}</p>
        )}
      </FieldRow>

      <FieldRow label="Company (text)" error={fieldErrors.company}>
        <BlurInput
          value={contact.company ?? ''}
          placeholder="Acme Inc."
          onCommit={(v) => patch({ company: v || null })}
          saving={saving === 'company'}
          error={fieldErrors.company}
        />
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Free-text fallback when no company record is linked</p>
      </FieldRow>
    </Section>
  )
}

// ─── Section 3 — Communication ─────────────────────────────────────────────────

function CommunicationSection({
  contact,
  fieldErrors,
  saving,
  patch,
}: {
  contact: Contact
  fieldErrors: FieldError
  saving: string | null
  patch: (f: Partial<Contact>) => Promise<Contact | null>
}) {
  const suppressed = contact.unsubscribed === 1

  return (
    <Section
      title="Communication"
      redBorder={suppressed}
      badge={
        suppressed ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ background: 'var(--red)' }}>
            Suppressed
          </span>
        ) : undefined
      }
    >
      <div className="border rounded-lg px-3 mb-3" style={{ borderColor: 'var(--border)' }}>
        <Toggle
          checked={suppressed}
          onChange={(v) => patch({ unsubscribed: v ? 1 : 0 })}
          label="Unsubscribed from all outbound"
        />
        <div className="border-t" style={{ borderColor: 'var(--border)' }} />
        <Toggle
          checked={contact.dnd_email === 1 || suppressed}
          disabled={suppressed}
          onChange={(v) => patch({ dnd_email: v ? 1 : 0 })}
          label="Do not email"
          tooltip={suppressed ? 'Implied on — contact is unsubscribed' : undefined}
        />
        <Toggle
          checked={contact.dnd_sms === 1 || suppressed}
          disabled={suppressed}
          onChange={(v) => patch({ dnd_sms: v ? 1 : 0 })}
          label="Do not SMS"
          tooltip={suppressed ? 'Implied on — contact is unsubscribed' : undefined}
        />
        <Toggle
          checked={contact.dnd_calls === 1 || suppressed}
          disabled={suppressed}
          onChange={(v) => patch({ dnd_calls: v ? 1 : 0 })}
          label="Do not call"
          tooltip={suppressed ? 'Implied on — contact is unsubscribed' : undefined}
        />
      </div>

      <FieldRow label="Source" error={fieldErrors.source}>
        <BlurInput
          value={contact.source ?? ''}
          placeholder="e.g. Facebook Lead Ad"
          onCommit={(v) => patch({ source: v || null })}
          saving={saving === 'source'}
          error={fieldErrors.source}
        />
      </FieldRow>

      <FieldRow label="Tags" error={fieldErrors.tags}>
        <BlurInput
          value={contact.tags ?? ''}
          placeholder="comma-separated"
          onCommit={(v) => patch({ tags: v || null })}
          saving={saving === 'tags'}
          error={fieldErrors.tags}
        />
      </FieldRow>

      {contact.last_contacted_at && (
        <div className="mt-1">
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            Last contacted
          </span>
          <span
            className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px]"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)' }}
          >
            {fmtRelative(contact.last_contacted_at)}
          </span>
        </div>
      )}
    </Section>
  )
}

// ─── Section 4 — Address & Profile ─────────────────────────────────────────────

function AddressSection({
  contact,
  fieldErrors,
  saving,
  patch,
}: {
  contact: Contact
  fieldErrors: FieldError
  saving: string | null
  patch: (f: Partial<Contact>) => Promise<Contact | null>
}) {
  return (
    <Section title="Address & Profile">
      <FieldRow label="Address" error={fieldErrors.address_line1}>
        <BlurInput
          value={contact.address_line1 ?? ''}
          placeholder="123 Main St"
          onCommit={(v) => patch({ address_line1: v || null })}
          saving={saving === 'address_line1'}
          error={fieldErrors.address_line1}
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="City" error={fieldErrors.city}>
          <BlurInput
            value={contact.city ?? ''}
            onCommit={(v) => patch({ city: v || null })}
            saving={saving === 'city'}
            error={fieldErrors.city}
          />
        </FieldRow>
        <FieldRow label="State / Province" error={fieldErrors.state}>
          <BlurInput
            value={contact.state ?? ''}
            onCommit={(v) => patch({ state: v || null })}
            saving={saving === 'state'}
            error={fieldErrors.state}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Postal Code" error={fieldErrors.zip}>
          <BlurInput
            value={contact.zip ?? ''}
            onCommit={(v) => patch({ zip: v || null })}
            saving={saving === 'zip'}
            error={fieldErrors.zip}
          />
        </FieldRow>
        <FieldRow label="Country" error={fieldErrors.country}>
          <select
            value={contact.country ?? ''}
            onChange={(e) => patch({ country: e.target.value || null })}
            className="glass-input w-full text-sm px-3 py-2 rounded-md"
            disabled={saving === 'country'}
          >
            <option value="">— Select —</option>
            {COMMON_COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FieldRow>
      </div>

      <FieldRow label="Birthday" error={fieldErrors.birthday}>
        <BlurInput
          value={contact.birthday ?? ''}
          placeholder="YYYY-MM-DD or MM-DD"
          onCommit={(v) => patch({ birthday: v || null })}
          saving={saving === 'birthday'}
          error={fieldErrors.birthday}
        />
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Year optional — use MM-DD to omit</p>
      </FieldRow>

      <FieldRow label="Timezone" error={fieldErrors.timezone}>
        <select
          value={contact.timezone ?? ''}
          onChange={(e) => patch({ timezone: e.target.value || null })}
          className="glass-input w-full text-sm px-3 py-2 rounded-md"
          disabled={saving === 'timezone'}
        >
          <option value="">— Select —</option>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </FieldRow>
    </Section>
  )
}

// ─── Section 5 — Custom Fields ─────────────────────────────────────────────────

function CustomFieldsSection({
  contact,
  patch,
}: {
  contact: Contact
  patch: (f: Partial<Contact>) => Promise<Contact | null>
}) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(() =>
    parseCustomFields(contact.custom_fields)
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRows(parseCustomFields(contact.custom_fields))
  }, [contact.custom_fields])

  async function save(newRows: Array<{ key: string; value: string }>) {
    setSaving(true)
    const obj = buildCustomFieldsObject(newRows)
    const json: Contact['custom_fields'] = JSON.stringify(obj)
    await patch({ custom_fields: json })
    setSaving(false)
  }

  function updateRow(idx: number, field: 'key' | 'value', v: string) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: v } : r))
  }

  function removeRow(idx: number) {
    const next = rows.filter((_, i) => i !== idx)
    setRows(next)
    save(next)
  }

  function addRow() {
    setRows((prev) => [...prev, { key: '', value: '' }])
  }

  return (
    <Section title="Custom Fields">
      <div className="space-y-2 mb-3">
        {rows.length === 0 && (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No custom fields yet.</p>
        )}
        {rows.map((row, idx) => (
          <div key={idx} className="flex gap-2 items-center">
            <input
              value={row.key}
              onChange={(e) => updateRow(idx, 'key', e.target.value)}
              onBlur={() => save(rows)}
              placeholder="field name"
              className="glass-input flex-1 text-sm px-2 py-1.5 rounded-md"
            />
            <input
              value={row.value}
              onChange={(e) => updateRow(idx, 'value', e.target.value)}
              onBlur={() => save(rows)}
              placeholder="value"
              className="glass-input flex-1 text-sm px-2 py-1.5 rounded-md"
            />
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="text-[13px] px-1.5"
              style={{ color: 'var(--text-dim)' }}
              aria-label="Remove field"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addRow}
          className="text-[12px] font-medium"
          style={{ color: 'var(--accent)' }}
        >
          + Add field
        </button>
        {saving && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Saving...</span>
        )}
      </div>
    </Section>
  )
}

// ─── Section 6 — Notes ─────────────────────────────────────────────────────────

function NotesSection({
  contact,
  fieldErrors,
  saving,
  patch,
}: {
  contact: Contact
  fieldErrors: FieldError
  saving: string | null
  patch: (f: Partial<Contact>) => Promise<Contact | null>
}) {
  return (
    <Section title="Notes">
      <BlurTextarea
        value={contact.notes ?? ''}
        placeholder="Internal notes about this contact..."
        rows={5}
        onCommit={(v) => patch({ notes: v || null })}
      />
      {fieldErrors.notes && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--red)' }}>{fieldErrors.notes}</p>
      )}
      {saving === 'notes' && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Saving...</p>
      )}
    </Section>
  )
}

// ─── Email timeline ─────────────────────────────────────────────────────────────

function TimelineSection({ timeline }: { timeline: TimelineItem[] }) {
  if (timeline.length === 0) return null
  return (
    <Section title={`Email Timeline (${timeline.length})`}>
      <ul className="space-y-1.5">
        {timeline.slice(0, 20).map((t, i) => (
          <li key={i} className="text-[13px] flex justify-between gap-2">
            <span style={{ color: 'var(--text)' }}>{t.subject || t.campaign_name || 'Email'}</span>
            <span style={{ color: 'var(--text-dim)' }}>{t.status} · {fmtDate(t.sent_at)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
