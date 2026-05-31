'use client'

// /companies — card grid list + rich detail (sidebar + 7 tabs).
// Mirrors /clients page UX. No Platform tabs (Integrations/Reports/Accounting).
// Those unlock post-promote via /clients/[slug].

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { PageHeader } from '@/components/ui/PageHeader'
import { IconPlus } from '@/components/ui/Icons'
import { AVATAR_COLORS, STATUS_OPTIONS } from '@/lib/client-business-constants'
import { PRIORITY_COLORS } from '@/lib/task-constants'
import { ActivityTimeline } from '@/components/crm/ActivityTimeline'
import { CompanySummarySidebar, type CompanySidebarProfile } from './_components/CompanySummarySidebar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: number
  public_id: string
  name: string
  website: string | null
  phone: string | null
  industry: string | null
  company_size: string | null
  notes: string | null
  status: string
  avatar_color: string
  avatar_url: string | null
  monthly_budget: number | null
  location: string | null
  brand_voice: string
  goals: string
  target_audience: string
  services: string
  offer: string
  offer_details: string
  context: string
  instagram_handle: string | null
  tiktok_handle: string | null
  facebook_page: string | null
  ad_account_id: string | null
  page_id: string | null
  folder_id: number | null
  contact_count: number
  opportunity_count: number
  open_opportunity_value: number
  client_profile_id: number | null
  client_profile_slug: string | null
  created_at: number
}

interface CrmContact {
  id: number
  public_id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  tags: string | null
  source: string | null
  notes: string | null
  created_at: number
}

interface Opportunity {
  id: number
  public_id: string
  name: string
  value: number | null
  stage: string | null
  status: string
  close_date: string | null
}

interface FolderDoc { id: number; public_id?: string; title: string; updated_at: number }
interface FolderProject { id: number; public_id?: string; name: string; color: string; status: string }
interface FolderSheet { id: number; public_id?: string; name: string }
interface FolderTask { id: number; title: string; status: string; priority: string; project_id: number; project_name?: string; project_color?: string }

type DetailTab = 'profile' | 'ai-context' | 'assets' | 'ads' | 'contacts' | 'notes' | 'activity'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (s: number | undefined) =>
  s ? new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

function getStatusConfig(status: string) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showPromoted, setShowPromoted] = useState(false)
  const [selected, setSelected] = useState<Company | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIndustry, setNewIndustry] = useState('')
  const [newColor, setNewColor] = useState(AVATAR_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // ─── Detail state ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<DetailTab>('profile')
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [addingContact, setAddingContact] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '' })
  const [savingContact, setSavingContact] = useState(false)

  // Assets
  const [folderDocs, setFolderDocs] = useState<FolderDoc[]>([])
  const [folderProjects, setFolderProjects] = useState<FolderProject[]>([])
  const [folderSheets, setFolderSheets] = useState<FolderSheet[]>([])
  const [folderTasks, setFolderTasks] = useState<FolderTask[]>([])
  const [meetingDocs, setMeetingDocs] = useState<{ id: number; public_id?: string; title: string; created_at: number }[]>([])
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [creatingSheet, setCreatingSheet] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [newTaskProjectId, setNewTaskProjectId] = useState<number | null>(null)
  const [newItemName, setNewItemName] = useState('')

  // Ads
  const [adAccounts, setAdAccounts] = useState<{ id: string; name: string }[]>([])
  const [fbPages, setFbPages] = useState<{ id: string; name: string }[]>([])
  const [metaConnected, setMetaConnected] = useState(true)
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState('')

  // Notes tab
  const [notesDraft, setNotesDraft] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)

  // AI Context editing
  const [aiSaving, setAiSaving] = useState<string | null>(null)

  // Auto-open from URL ?id=
  const autoOpenedRef = useRef(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // ─── Load list ─────────────────────────────────────────────────────────────

  const load = useCallback(async (q: string, promoted: boolean) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (promoted) params.set('show_promoted', '1')
      const res = await fetch(`/api/crm/companies?${params}`)
      const d = await res.json() as { companies?: Company[] }
      setCompanies(d.companies ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search.trim(), showPromoted), 250)
    return () => clearTimeout(t)
  }, [search, showPromoted, load])

  // ─── Auto-open from ?id= ───────────────────────────────────────────────────
  // If id refers to a promoted company (filtered out by default), flip the
  // show_promoted toggle and retry — the company will appear in the next load.

  useEffect(() => {
    if (autoOpenedRef.current || companies.length === 0) return
    if (typeof window === 'undefined') return
    const param = new URLSearchParams(window.location.search).get('id')
    if (!param) { autoOpenedRef.current = true; return }
    const lc = param.toLowerCase()
    const numeric = /^\d+$/.test(param) ? Number(param) : null
    const match = companies.find(c =>
      (numeric !== null && c.id === numeric) ||
      c.public_id?.toLowerCase() === lc
    )
    if (match) {
      openCompany(match)
      autoOpenedRef.current = true
    } else if (!showPromoted) {
      // Company may be promoted and filtered out — enable promoted view to find it
      setShowPromoted(true)
      // autoOpenedRef stays false so the effect re-runs after the promoted list loads
    } else {
      autoOpenedRef.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies])

  // ─── Load contacts for selected company ───────────────────────────────────

  const loadContacts = useCallback((companyId: number) => {
    setContactsLoading(true)
    fetch(`/api/crm/contacts?company_id=${companyId}`)
      .then(r => r.json())
      .then(d => setContacts(d.contacts || []))
      .catch(() => setContacts([]))
      .finally(() => setContactsLoading(false))
  }, [])

  // ─── Load folder assets ───────────────────────────────────────────────────

  const loadFolderContents = useCallback((publicId: string) => {
    setMeetingDocs([]) // companies have no docs.company_id yet — always empty for v1
    fetch(`/api/crm/companies/${publicId}?contents=1`)
      .then(r => r.json())
      .then(d => {
        // Backend may return a bootstrapped folder_id; update selected state so
        // the Assets tab can show the grid even on first visit.
        if (d.company) {
          setSelected(prev => prev && prev.public_id === publicId ? { ...prev, folder_id: d.company.folder_id } : prev)
          setCompanies(prev => prev.map(c => c.public_id === publicId ? { ...c, folder_id: d.company.folder_id } : c))
        }
        const c = d.contents
        if (c) {
          setFolderDocs(c.docs || [])
          setFolderProjects(c.projects || [])
          setFolderSheets(c.sheets || [])
          const pidSet = new Set((c.projects || []).map((p: FolderProject) => p.id))
          if (pidSet.size > 0) {
            fetch('/api/tasks?all=1')
              .then(r => r.json())
              .then(td => {
                setFolderTasks(
                  (td.tasks || [])
                    .filter((t: Record<string, unknown>) => t.project_id && pidSet.has(t.project_id as number))
                    .map((t: Record<string, unknown>) => ({
                      id: t.id as number, title: t.title as string,
                      status: t.status as string, priority: t.priority as string,
                      project_id: t.project_id as number,
                      project_name: t.project_name as string | undefined,
                      project_color: t.project_color as string | undefined,
                    }))
                )
              })
              .catch(() => setFolderTasks([]))
          } else { setFolderTasks([]) }
        } else {
          setFolderDocs([]); setFolderProjects([]); setFolderSheets([]); setFolderTasks([])
        }
      })
      .catch(() => {})
  }, [])

  // ─── Open company detail ──────────────────────────────────────────────────

  const openCompany = useCallback((c: Company) => {
    setSelected(c)
    setActiveTab('profile')
    setNotesDraft(c.notes || '')
    loadContacts(c.id)
    // Always call with contents=1 — backend bootstraps folder_id on first access.
    loadFolderContents(c.public_id)
  }, [loadContacts, loadFolderContents])

  // ─── Load Meta accounts once ───────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/meta/accounts').then(r => r.json()).then(d => {
      if (d.error === 'not_connected') { setMetaConnected(false); return }
      setMetaConnected(true)
      setAdAccounts((d.available || []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))
    }).catch(() => setMetaConnected(false))
    fetch('/api/meta/pages').then(r => r.json()).then(d => {
      if (d.error === 'not_connected') return
      setFbPages((d.available || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
    }).catch(() => {})
  }, [])

  // ─── Save a field via PATCH ───────────────────────────────────────────────

  const saveField = async (field: string, value: string | number | null) => {
    if (!selected) return
    const res = await fetch(`/api/crm/companies/${selected.public_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    const d = await res.json() as { company?: Company }
    if (d.company) {
      setSelected(d.company)
      setCompanies(prev => prev.map(c => c.id === d.company!.id ? d.company! : c))
    }
  }

  // ─── Create company ───────────────────────────────────────────────────────

  const createCompany = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/crm/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), industry: newIndustry.trim() || undefined, avatar_color: newColor }),
      })
      const d = await res.json() as { company?: Company }
      if (d.company) {
        setCompanies(prev => [d.company!, ...prev])
        setCreating(false)
        setNewName(''); setNewIndustry(''); setNewColor(AVATAR_COLORS[0])
        openCompany(d.company)
      }
    } finally {
      setSaving(false)
    }
  }

  // ─── Save contact ─────────────────────────────────────────────────────────

  const saveContact = async () => {
    if (!contactForm.name.trim() || !selected) return
    setSavingContact(true)
    try {
      const res = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...contactForm, company_id: selected.id }),
      })
      const d = await res.json()
      if (d.contact) {
        setContacts(prev => [d.contact, ...prev])
        setAddingContact(false)
        setContactForm({ name: '', email: '', phone: '' })
      }
    } finally { setSavingContact(false) }
  }

  // ─── Save notes on blur ───────────────────────────────────────────────────

  const saveNotes = async () => {
    if (!selected) return
    const current = selected.notes || ''
    if (notesDraft === current) return
    setNotesSaving(true)
    await saveField('notes', notesDraft || null)
    setNotesSaving(false)
  }

  // ─── Folder creation helpers (only when folder_id exists) ─────────────────

  const createDoc = async () => {
    if (!selected?.folder_id || !newItemName.trim()) return
    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newItemName.trim(), folderId: selected.folder_id }),
    })
    const d = await res.json()
    setCreatingDoc(false); setNewItemName('')
    if (d.doc) {
      setFolderDocs(prev => [{ id: d.doc.id, public_id: d.doc.public_id, title: d.doc.title, updated_at: d.doc.updated_at }, ...prev])
      window.open(`/doc/${d.doc.public_id || d.doc.id}`, '_blank')
    }
  }

  const createProject = async () => {
    if (!selected?.folder_id || !newItemName.trim()) return
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newItemName.trim(), folderId: selected.folder_id }),
    })
    const d = await res.json()
    setCreatingProject(false); setNewItemName('')
    if (d.project) setFolderProjects(prev => [...prev, { id: d.project.id, public_id: d.project.public_id, name: d.project.name, color: d.project.color, status: d.project.status }])
  }

  const createSheet = async () => {
    if (!selected?.folder_id || !newItemName.trim()) return
    const res = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_sheet', name: newItemName.trim(), folder_id: selected.folder_id }),
    })
    const d = await res.json()
    setCreatingSheet(false); setNewItemName('')
    if (d.id) setFolderSheets(prev => [{ id: d.id, public_id: d.public_id, name: d.name || newItemName.trim() }, ...prev])
  }

  const createTask = async () => {
    if (!newItemName.trim() || !newTaskProjectId) return
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newItemName.trim(), project_id: newTaskProjectId, status: 'todo' }),
    })
    const d = await res.json()
    setCreatingTask(false); setNewItemName(''); setNewTaskProjectId(null)
    if (d.task) {
      const proj = folderProjects.find(p => p.id === newTaskProjectId)
      setFolderTasks(prev => [{
        id: d.task.id, title: d.task.title, status: d.task.status || 'todo',
        priority: d.task.priority || 'medium', project_id: newTaskProjectId,
        project_name: proj?.name, project_color: proj?.color,
      }, ...prev])
    }
  }

  // ─── Sidebar callbacks ─────────────────────────────────────────────────────

  const handleSidebarUpdated = (updated: CompanySidebarProfile) => {
    setSelected(prev => prev ? { ...prev, ...updated } : prev)
    setCompanies(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
  }

  const handleSidebarBack = () => {
    setSelected(null)
    setContacts([])
    setFolderDocs([]); setFolderProjects([]); setFolderSheets([]); setFolderTasks([]); setMeetingDocs([])
  }

  const handleSidebarDeleted = () => {
    setCompanies(prev => prev.filter(c => c.id !== selected!.id))
    setSelected(null)
  }

  const handlePromoted = (clientSlug: string) => {
    showToast('Promoted! Opening client record…')
    setTimeout(() => router.push(`/clients/${clientSlug}`), 800)
  }

  // ─── Detail view ──────────────────────────────────────────────────────────

  if (selected) {
    const sidebarCompany: CompanySidebarProfile = {
      id: selected.id,
      public_id: selected.public_id,
      name: selected.name,
      avatar_color: selected.avatar_color || AVATAR_COLORS[0],
      avatar_url: selected.avatar_url,
      status: selected.status || 'active',
      monthly_budget: selected.monthly_budget,
      location: selected.location,
      website: selected.website,
      instagram_handle: selected.instagram_handle,
      tiktok_handle: selected.tiktok_handle,
      facebook_page: selected.facebook_page,
      client_profile_slug: selected.client_profile_slug,
    }

    const tabs: { id: DetailTab; label: string }[] = [
      { id: 'profile', label: 'Profile' },
      { id: 'ai-context', label: 'AI Context' },
      { id: 'assets', label: 'Assets' },
      { id: 'ads', label: 'Ads' },
      { id: 'contacts', label: 'Contacts' },
      { id: 'notes', label: 'Notes' },
      { id: 'activity', label: 'Activity' },
    ]

    const aiFields = ['context', 'brand_voice', 'target_audience', 'goals', 'offer', 'offer_details'] as const

    return (
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] text-sm font-medium text-white px-4 py-2 rounded-lg shadow-lg" style={{ background: 'var(--accent)' }}>
            {toast}
          </div>
        )}

        {/* ── LEFT SIDEBAR ── */}
        <CompanySummarySidebar
          company={sidebarCompany}
          onBack={handleSidebarBack}
          onDeleted={handleSidebarDeleted}
          onUpdated={handleSidebarUpdated}
          onPromoted={handlePromoted}
        />

        {/* ── RIGHT: TABS + CONTENT ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          <div style={{ overflowY: 'auto', flex: 1 }} className="no-scrollbar">
            <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 32px 48px' }}>

              {/* Tab strip */}
              <div style={{
                display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
                marginBottom: 28, marginTop: 0, overflowX: 'auto',
              }}>
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id)
                      if (tab.id === 'contacts') loadContacts(selected.id)
                    }}
                    style={{
                      padding: '8px 16px', whiteSpace: 'nowrap',
                      background: 'transparent', border: 'none',
                      borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                      color: activeTab === tab.id ? 'var(--text)' : 'var(--text-dim)',
                      fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
                      cursor: 'pointer', marginBottom: -1,
                      transition: 'color 120ms',
                    }}
                  >{tab.label}</button>
                ))}
              </div>

              {/* ─── Profile tab ─── */}
              {activeTab === 'profile' && (
                <div>
                  {/* Core info */}
                  <div className="editorial-section">
                    <div className="editorial-section-inner px-4 py-3">
                      <ProfileField label="Name" value={selected.name} placeholder="Company name" onSave={v => saveField('name', v)} />
                      <ProfileField label="Industry" value={selected.industry} placeholder="e.g. Dental, E-commerce…" onSave={v => saveField('industry', v)} />
                      <ProfileField label="Website" value={selected.website} placeholder="https://example.com" onSave={v => saveField('website', v)} />
                      <ProfileField label="Phone" value={selected.phone} placeholder="+1 (555) 000-0000" onSave={v => saveField('phone', v)} />
                      <ProfileField label="Location" value={selected.location} placeholder="City, Country" onSave={v => saveField('location', v)} />
                    </div>
                  </div>

                  {/* Stats strip */}
                  <div className="editorial-section mt-4">
                    <div className="editorial-section-inner px-4 py-3">
                      <div style={{ display: 'flex', gap: 24 }}>
                        <Stat label="Contacts" value={String(selected.contact_count ?? 0)} />
                        <Stat label="Deals" value={String(selected.opportunity_count ?? 0)} />
                        {(selected.open_opportunity_value ?? 0) > 0 && (
                          <Stat label="Open Value" value={`$${(selected.open_opportunity_value).toLocaleString()}`} />
                        )}
                        <Stat label="Added" value={fmtDate(selected.created_at)} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── AI Context tab ─── */}
              {activeTab === 'ai-context' && (() => {
                const filled = aiFields.filter(f => selected[f as keyof Company]).length
                return (
                  <div style={{ maxWidth: 720, paddingBottom: 40 }}>
                    {/* Context Health */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Context Health</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {aiFields.map((_, i) => (
                          <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < filled ? 'var(--accent)' : 'var(--border-strong)', flexShrink: 0 }} />
                        ))}
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: filled === aiFields.length ? 'var(--text)' : 'var(--text-muted)', fontFeatureSettings: '"tnum"' }}>{filled}/{aiFields.length}</span>
                      <span style={{ flex: 1 }} />
                      {filled < aiFields.length && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Fill for sharper AI output</span>}
                    </div>
                    {([
                      { key: 'context', label: 'Background', placeholder: 'Business background, history, unique selling points…', rows: 5 },
                      { key: 'brand_voice', label: 'Brand Voice', placeholder: 'e.g. Casual, confident. Uses slang. Never say "pamper"…', rows: 3 },
                      { key: 'target_audience', label: 'Target Audience', placeholder: 'e.g. Men 18-45, urban, care about style…', rows: 3 },
                      { key: 'goals', label: 'Goals & KPIs', placeholder: 'e.g. 50 leads/month at $30 CPL, increase walk-ins by 20%…', rows: 3 },
                      { key: 'offer', label: 'Current Offer', placeholder: 'e.g. First-time client: Free beard trim with any haircut…', rows: 3 },
                      { key: 'offer_details', label: 'Offer Details / Funnel', placeholder: 'Landing page flow, follow-up sequence…', rows: 4 },
                    ] as { key: string; label: string; placeholder: string; rows: number }[]).map(({ key, label, placeholder, rows }) => {
                      const isFilled = !!(selected[key as keyof Company])
                      return (
                        <div key={key} style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: isFilled ? 'var(--text-secondary)' : 'var(--text-dim)' }}>{label}</span>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: isFilled ? 'var(--accent)' : 'transparent', border: isFilled ? 'none' : '1px solid var(--border-strong)' }} />
                            {aiSaving === key && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Saving…</span>}
                          </div>
                          <textarea
                            key={`${selected.id}-${key}`}
                            defaultValue={(selected[key as keyof Company] as string) || ''}
                            placeholder={placeholder}
                            onBlur={async e => {
                              const prev = (selected[key as keyof Company] as string) || ''
                              if (e.target.value !== prev) {
                                setAiSaving(key)
                                await saveField(key, e.target.value || null)
                                setAiSaving(null)
                              }
                            }}
                            rows={rows}
                            style={{ width: '100%', background: 'transparent', border: 'none', padding: 0, fontSize: 13, color: 'var(--text)', resize: 'vertical', lineHeight: 1.6, outline: 'none', fontFamily: 'inherit' }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* ─── Assets tab ─── */}
              {activeTab === 'assets' && (
                <div style={{ maxWidth: 900, paddingBottom: 40 }}>
                  {!selected.folder_id ? (
                    <div style={{ textAlign: 'center', padding: '48px 0' }}>
                      <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Setting up folder…</p>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                        {/* Projects */}
                        <AssetCard
                          title="Projects" count={folderProjects.length}
                          onCreate={() => setCreatingProject(true)}
                        >
                          {folderProjects.map(p => (
                            <a key={p.id} href={`/project/${p.public_id || p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                              <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{p.status}</span>
                            </a>
                          ))}
                          {creatingProject && (
                            <InlineCreate
                              placeholder="Project name"
                              value={newItemName}
                              onChange={setNewItemName}
                              onSubmit={createProject}
                              onCancel={() => { setCreatingProject(false); setNewItemName('') }}
                            />
                          )}
                        </AssetCard>

                        {/* Docs */}
                        <AssetCard
                          title="Docs" count={folderDocs.length}
                          onCreate={() => setCreatingDoc(true)}
                        >
                          {folderDocs.map(d => (
                            <a key={d.id} href={`/doc/${d.public_id || d.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                              <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                            </a>
                          ))}
                          {creatingDoc && (
                            <InlineCreate
                              placeholder="Doc title"
                              value={newItemName}
                              onChange={setNewItemName}
                              onSubmit={createDoc}
                              onCancel={() => { setCreatingDoc(false); setNewItemName('') }}
                            />
                          )}
                        </AssetCard>
                      </div>

                      {/* Tasks */}
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Tasks</span>
                            {folderTasks.filter(t => t.status !== 'done' && t.status !== 'completed').length > 0 && (
                              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>{folderTasks.filter(t => t.status !== 'done' && t.status !== 'completed').length} open</span>
                            )}
                          </div>
                          {folderProjects.length > 0 && <button onClick={() => setCreatingTask(true)} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>}
                        </div>
                        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                          {folderTasks.length === 0 && !creatingTask && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>{folderProjects.length === 0 ? 'Create a project first' : 'No tasks yet'}</div>}
                          {folderTasks.sort((a, b) => { const ord: Record<string, number> = { todo: 0, 'in-progress': 1, blocked: 2, done: 3, completed: 3 }; return (ord[a.status] ?? 0) - (ord[b.status] ?? 0) }).map(t => {
                            const isDone = t.status === 'done' || t.status === 'completed'
                            return (
                              <a key={t.id} href={`/schedule?task=${t.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', opacity: isDone ? 0.5 : 1, transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLORS[t.priority] || '#6b7280', flexShrink: 0 }} />
                                <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>{t.title}</span>
                                {t.project_name && <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{t.project_name}</span>}
                              </a>
                            )
                          })}
                          {creatingTask && (
                            <div style={{ padding: '8px 12px', borderTop: folderTasks.length > 0 ? '1px solid var(--border)' : undefined }}>
                              <select value={newTaskProjectId || ''} onChange={e => setNewTaskProjectId(Number(e.target.value))} style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 12, color: 'var(--text)', marginBottom: 6 }}>
                                <option value="">Select project</option>
                                {folderProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              <InlineCreate
                                placeholder="Task title"
                                value={newItemName}
                                onChange={setNewItemName}
                                onSubmit={createTask}
                                onCancel={() => { setCreatingTask(false); setNewItemName(''); setNewTaskProjectId(null) }}
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Meetings + Database 2-col */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                        <div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>Meetings</div>
                          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                            {meetingDocs.length === 0 && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No meetings yet</div>}
                            {meetingDocs.map(m => (
                              <a key={m.id} href={`/doc/${m.public_id || m.id}`} target="_blank" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" /></svg>
                                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{new Date(m.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Database</span>
                            <button onClick={() => setCreatingSheet(true)} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>
                          </div>
                          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                            {folderSheets.length === 0 && !creatingSheet && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No databases yet</div>}
                            {folderSheets.map(s => (
                              <a key={s.id} href={`/database?open=${s.public_id || s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="var(--text-dim)" strokeWidth="1.2"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="var(--text-dim)" strokeWidth="1" /></svg>
                                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                              </a>
                            ))}
                            {creatingSheet && (
                              <InlineCreate
                                placeholder="Database name"
                                value={newItemName}
                                onChange={setNewItemName}
                                onSubmit={createSheet}
                                onCancel={() => { setCreatingSheet(false); setNewItemName('') }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ─── Ads tab ─── */}
              {activeTab === 'ads' && (
                <div style={{ maxWidth: 520, paddingBottom: 40 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 4, marginBottom: 24,
                    background: metaConnected ? 'color-mix(in oklab, var(--status-completed) 10%, transparent)' : 'var(--bg-surface)',
                    border: `1px solid ${metaConnected ? 'color-mix(in oklab, var(--status-completed) 30%, transparent)' : 'var(--border)'}`,
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: metaConnected ? 'var(--status-completed)' : 'var(--text-dim)', boxShadow: metaConnected ? '0 0 0 2px color-mix(in oklab, var(--status-completed) 30%, transparent)' : 'none' }} />
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: metaConnected ? 'var(--accent-text)' : 'var(--text-dim)', flex: 1 }}>
                      {metaConnected ? 'Meta connected' : 'Meta not connected'}
                    </span>
                    {!metaConnected && <a href="/settings" style={{ fontSize: 11, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', textDecoration: 'none' }}>Connect →</a>}
                  </div>
                  {metaConnected && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>Ad Account</div>
                        <select value={selected.ad_account_id || ''} onChange={e => saveField('ad_account_id', e.target.value || null)} style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text)', outline: 'none' }}>
                          <option value="">Select ad account</option>
                          {adAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>Facebook Page</div>
                        <select value={selected.page_id || ''} onChange={e => saveField('page_id', e.target.value || null)} style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text)', outline: 'none' }}>
                          <option value="">Select page</option>
                          {fbPages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>Monthly Budget</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>$</span>
                          <input
                            type="number"
                            value={editingBudget ? budgetDraft : (selected.monthly_budget || '')}
                            onFocus={() => { setEditingBudget(true); setBudgetDraft(String(selected.monthly_budget || '')) }}
                            onChange={e => setBudgetDraft(e.target.value)}
                            onBlur={() => { setEditingBudget(false); saveField('monthly_budget', budgetDraft ? Number(budgetDraft) : null) }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 15, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)', outline: 'none', fontWeight: 700 }}
                            placeholder="0"
                          />
                          <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>/mo</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Contacts tab ─── */}
              {activeTab === 'contacts' && (
                <div style={{ maxWidth: 860, paddingBottom: 40 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{contacts.length} contact{contacts.length !== 1 ? 's' : ''}</span>
                    <button onClick={() => { setContactForm({ name: '', email: '', phone: '' }); setAddingContact(true) }} style={{ fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}>+ Add contact</button>
                  </div>
                  {addingContact && (
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12 }}>New Contact</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <input autoFocus placeholder="Name *" value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} className="glass-input" style={{ padding: '7px 10px', borderRadius: 6, fontSize: 13, color: 'var(--text)' }} />
                        <input placeholder="Email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} className="glass-input" style={{ padding: '7px 10px', borderRadius: 6, fontSize: 13, color: 'var(--text)' }} />
                        <input placeholder="Phone" value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} className="glass-input" style={{ padding: '7px 10px', borderRadius: 6, fontSize: 13, color: 'var(--text)' }} onKeyDown={e => e.key === 'Enter' && saveContact()} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <button onClick={() => setAddingContact(false)} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                          <button onClick={saveContact} disabled={!contactForm.name.trim() || savingContact} style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (!contactForm.name.trim() || savingContact) ? 0.5 : 1 }}>{savingContact ? 'Saving…' : 'Create'}</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {contactsLoading ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>Loading…</p>
                  ) : contacts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0' }}>
                      <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>No contacts linked to this company yet.</p>
                    </div>
                  ) : (
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['Name', 'Email', 'Phone', 'Added'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {contacts.map(c => (
                            <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }} onMouseEnter={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'var(--bg-elevated)')} onMouseLeave={e => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}>
                              <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                                <a href={`/contacts?id=${c.public_id || c.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{c.name}</a>
                              </td>
                              <td style={{ padding: '9px 12px', fontSize: 13, color: 'var(--text-dim)' }}>{c.email || '—'}</td>
                              <td style={{ padding: '9px 12px', fontSize: 13, color: 'var(--text-dim)' }}>{c.phone || '—'}</td>
                              <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{c.created_at ? new Date(c.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Notes tab ─── */}
              {activeTab === 'notes' && (
                <div style={{ maxWidth: 720, paddingBottom: 40 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Internal Notes</span>
                    {notesSaving && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Saving…</span>}
                  </div>
                  <textarea
                    key={`notes-${selected.id}`}
                    value={notesDraft}
                    onChange={e => setNotesDraft(e.target.value)}
                    onBlur={saveNotes}
                    placeholder="Internal notes, preferences, history — anything to remember about this company…"
                    style={{
                      width: '100%', minHeight: 220, background: 'var(--bg-surface)',
                      border: '1px solid var(--border)', borderRadius: 8,
                      padding: '12px 14px', fontSize: 13, color: 'var(--text)',
                      resize: 'vertical', lineHeight: 1.6, outline: 'none', fontFamily: 'inherit',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                  />
                </div>
              )}

              {/* ─── Activity tab ─── */}
              {activeTab === 'activity' && (
                <div style={{ maxWidth: 720, paddingBottom: 40 }}>
                  <ActivityTimeline contactId={contacts[0]?.id} />
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Card Grid View (list) ─────────────────────────────────────────────────

  const filteredCompanies = companies.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) ||
      (c.industry || '').toLowerCase().includes(q) ||
      (c.location || '').toLowerCase().includes(q)
  })

  return (
    <div className="h-full overflow-y-auto pb-28" style={{ background: 'var(--bg)' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] text-sm font-medium text-white px-4 py-2 rounded-lg shadow-lg" style={{ background: 'var(--accent)' }}>
          {toast}
        </div>
      )}

      <PageHeader
        title="Companies"
        count={filteredCompanies.length}
        action={{
          label: 'New Company',
          icon: <IconPlus size={14} />,
          onClick: () => setCreating(true),
        }}
      />

      {/* New Company form */}
      {creating && (
        <div className="mx-6 mb-6 animate-float-up" style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>New Company</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="text"
              placeholder="Company name *"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="glass-input"
              style={{ padding: '8px 12px', borderRadius: 8, fontSize: 14, color: 'var(--text)', width: '100%' }}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && createCompany()}
            />
            <input
              type="text"
              placeholder="Industry (optional)"
              value={newIndustry}
              onChange={e => setNewIndustry(e.target.value)}
              className="glass-input"
              style={{ padding: '8px 12px', borderRadius: 8, fontSize: 14, color: 'var(--text)', width: '100%' }}
              onKeyDown={e => e.key === 'Enter' && createCompany()}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Color</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {AVATAR_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)} style={{
                    width: 22, height: 22, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                    outline: newColor === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2,
                    transform: newColor === c ? 'scale(1.15)' : 'scale(1)',
                    transition: 'transform 0.12s',
                  }} />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => { setCreating(false); setNewName(''); setNewIndustry('') }} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={createCompany} disabled={!newName.trim() || saving} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: (!newName.trim() || saving) ? 0.5 : 1,
              }}>{saving ? 'Creating…' : 'Add Company'}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 32px 80px' }}>

        {/* Search + show promoted toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '4px 2px 10px', borderBottom: '1px solid var(--border)', marginBottom: 16,
        }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search companies…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', height: 30, padding: '0 12px 0 32px',
                background: 'var(--bg-field)', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text)', fontSize: 13, outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
            />
          </div>

          {/* Show promoted toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
            <button
              role="switch"
              aria-checked={showPromoted}
              onClick={() => setShowPromoted(p => !p)}
              style={{
                position: 'relative', width: 32, height: 18, borderRadius: 9,
                background: showPromoted ? 'var(--accent)' : 'var(--border)',
                border: 'none', cursor: 'pointer', transition: 'background 150ms', flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 2, left: showPromoted ? 16 : 2,
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                transition: 'left 150ms',
              }} />
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Show promoted</span>
          </label>

          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginLeft: 'auto' }}>
            {loading ? '…' : `${filteredCompanies.length} ${filteredCompanies.length === 1 ? 'company' : 'companies'}`}
          </span>
        </div>

        {/* Loading shimmer */}
        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: 20, minHeight: 140 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--border)', marginBottom: 12 }} className="animate-pulse" />
                <div style={{ height: 14, background: 'var(--border)', borderRadius: 4, marginBottom: 8, width: '60%' }} className="animate-pulse" />
                <div style={{ height: 11, background: 'var(--border)', borderRadius: 4, width: '40%' }} className="animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Empty states */}
        {!loading && filteredCompanies.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            {search ? (
              <>
                <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>No companies match &ldquo;{search}&rdquo;</p>
                <button onClick={() => setSearch('')} style={{ fontSize: 12, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear search</button>
              </>
            ) : companies.length === 0 ? (
              <>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.3" style={{ margin: '0 auto 16px' }}>
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
                </svg>
                <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>No companies yet</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Add pre-revenue accounts here. Promote them to Clients when they sign.</p>
                <button onClick={() => setCreating(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <IconPlus size={13} /> Add Company
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>No unpromoted companies.</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>All companies have been promoted to clients. Toggle &ldquo;Show promoted&rdquo; to see them.</p>
              </>
            )}
          </div>
        )}

        {/* Card grid */}
        {!loading && filteredCompanies.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {filteredCompanies.map(c => {
              const sCfg = getStatusConfig(c.status || 'active')
              return (
                <button
                  key={c.id}
                  onClick={() => openCompany(c)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: 20, textAlign: 'left', cursor: 'pointer',
                    transition: 'border-color 120ms, background 120ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-surface)' }}
                >
                  {/* Avatar */}
                  <div style={{ marginBottom: 12 }}>
                    <Avatar name={c.name} size={56} color={c.avatar_color || AVATAR_COLORS[0]} src={c.avatar_url || undefined} />
                  </div>

                  {/* Name */}
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                    {c.name}
                  </div>

                  {/* Status + Industry pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 500,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      padding: '2px 7px', borderRadius: 99,
                      background: `${sCfg.color}18`, color: sCfg.color,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: sCfg.color, flexShrink: 0 }} />
                      {sCfg.label}
                    </span>
                    {c.industry && (
                      <span style={{
                        fontSize: 10, fontFamily: 'var(--font-mono)',
                        padding: '2px 7px', borderRadius: 99,
                        background: 'var(--border)', color: 'var(--text-dim)',
                      }}>
                        {c.industry}
                      </span>
                    )}
                  </div>

                  {/* Budget chip */}
                  {c.monthly_budget ? (
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)', marginBottom: 10, fontWeight: 600 }}>
                      ${c.monthly_budget.toLocaleString()}/mo
                    </div>
                  ) : null}

                  {/* Footer */}
                  <div style={{
                    marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--border)',
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8,
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {c.contact_count ?? 0} contact{(c.contact_count ?? 0) !== 1 ? 's' : ''}
                      {' · '}
                      {c.opportunity_count ?? 0} deal{(c.opportunity_count ?? 0) !== 1 ? 's' : ''}
                    </span>
                    {c.client_profile_slug && (
                      <span
                        onClick={e => { e.stopPropagation(); router.push(`/clients/${c.client_profile_slug}`) }}
                        style={{
                          fontSize: 11, color: 'var(--accent-text)', cursor: 'pointer',
                          whiteSpace: 'nowrap', fontWeight: 500,
                        }}
                      >
                        View as Client →
                      </span>
                    )}
                  </div>
                </button>
              )
            })}

            {/* Quiet add card */}
            {!creating && (
              <button
                onClick={() => setCreating(true)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                  border: '1px dashed var(--border)',
                  borderRadius: 12, padding: 20, cursor: 'pointer', minHeight: 140,
                  color: 'var(--text-muted)', transition: 'border-color 120ms, color 120ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-dim)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                <span style={{
                  width: 40, height: 40, borderRadius: '50%',
                  border: '1px dashed currentColor',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 8,
                }}>
                  <IconPlus size={14} />
                </span>
                <span style={{ fontSize: 13 }}>Add company</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProfileField({
  label, value, placeholder, onSave,
}: {
  label: string
  value: string | null | undefined
  placeholder: string
  onSave: (v: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (editing) {
    return (
      <div style={{ padding: '6px 0' }}>
        <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>{label}</label>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="glass-input"
          style={{ width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 13, color: 'var(--text)' }}
          placeholder={placeholder}
          onBlur={() => { onSave(draft.trim() || null); setEditing(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onSave(draft.trim() || null); setEditing(false) }
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <button
      onClick={() => { setEditing(true); setDraft(value || '') }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '6px 0', background: 'none', border: 'none',
        cursor: 'pointer', textAlign: 'left',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontSize: 12, color: value ? 'var(--text)' : 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value || '—'}
      </span>
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function AssetCard({
  title, count, onCreate, children,
}: {
  title: string
  count: number
  onCreate: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{title}</span>
          {count > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>{count}</span>}
        </div>
        <button onClick={onCreate} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {count === 0 && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No {title.toLowerCase()} yet</div>}
        {children}
      </div>
    </div>
  )
}

function InlineCreate({
  placeholder, value, onChange, onSubmit, onCancel,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '8px 12px' }}>
      <input
        autoFocus
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel() }}
        className="glass-input"
        style={{ flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)' }}
      />
      <button onClick={onSubmit} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}>Add</button>
      <button onClick={onCancel} style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
    </div>
  )
}
