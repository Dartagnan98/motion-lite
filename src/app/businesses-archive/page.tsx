'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { Avatar } from '@/components/ui/Avatar'
import { PRIORITY_COLORS } from '@/lib/task-constants'
import { IconChevronDown, IconPlus } from '@/components/ui/Icons'
import { PageHeader } from '@/components/ui/PageHeader'
import { AVATAR_COLORS, STATUS_OPTIONS } from '@/lib/client-business-constants'

interface Business {
  id: number
  client_id: number
  name: string
  slug: string | null
  industry: string | null
  avatar_color: string
  status: string
  context: string
  brand_voice: string
  goals: string
  target_audience: string
  services: string
  offer: string
  offer_details: string
  ad_account_id: string | null
  page_id: string | null
  monthly_budget: number | null
  location: string | null
  website: string | null
  instagram_handle: string | null
  tiktok_handle: string | null
  facebook_page: string | null
  folder_id: number | null
  workspace_id: number | null
  sort_order: number
  created_at: number
  updated_at: number | null
}

interface FolderDoc { id: number; public_id?: string; title: string; updated_at: number }
interface FolderProject { id: number; public_id?: string; name: string; color: string; status: string }
interface FolderSheet { id: number; name: string }
interface FolderTask { id: number; title: string; status: string; priority: string; project_id: number; project_name?: string; project_color?: string; due_date?: string }
interface AdAccountOption { id: string; name: string }
interface PageOption { id: string; name: string }
interface ClientOption { id: number; name: string; slug: string }

const INDUSTRIES = [
  'Barbershop', 'Tattoo Shop', 'Real Estate', 'Spa & Wellness',
  'Restaurant', 'Fitness', 'Salon', 'Auto', 'Medical', 'E-commerce',
  'Coaching', 'Construction', 'Legal', 'Dental', 'Other',
]

interface SectionField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number' | 'url'
  placeholder: string
  options?: string[]
}

const SECTIONS: { title: string; icon: string; fields: SectionField[] }[] = [
  {
    title: 'Business Info',
    icon: 'briefcase',
    fields: [
      { key: 'industry', label: 'Industry', type: 'select', placeholder: 'Select industry', options: INDUSTRIES },
      { key: 'status', label: 'Status', type: 'select', placeholder: 'Select status', options: STATUS_OPTIONS.map(s => s.value) },
      { key: 'location', label: 'Location', type: 'text', placeholder: 'e.g. Miami, FL' },
      { key: 'website', label: 'Website', type: 'url', placeholder: 'https://...' },
      { key: 'services', label: 'Services / Products', type: 'textarea', placeholder: 'e.g. Haircuts, beard trims, hot towel shaves...' },
    ],
  },
  {
    title: 'Offer & Strategy',
    icon: 'offer',
    fields: [
      { key: 'offer', label: 'Current Offer', type: 'textarea', placeholder: 'e.g. First-time client: Free beard trim with any haircut ($45 value)' },
      { key: 'offer_details', label: 'Offer Details / Funnel', type: 'textarea', placeholder: 'Landing page flow, follow-up sequence, what happens after they book...' },
    ],
  },
  {
    title: 'AI Context',
    icon: 'brain',
    fields: [
      { key: 'context', label: 'Background', type: 'textarea', placeholder: 'Business background, history, unique selling points...' },
      { key: 'brand_voice', label: 'Brand Voice', type: 'textarea', placeholder: 'e.g. Casual, masculine, confident. Uses slang. Never say "pamper"...' },
      { key: 'target_audience', label: 'Target Audience', type: 'textarea', placeholder: 'e.g. Men 18-45, urban, care about style...' },
      { key: 'goals', label: 'Goals & KPIs', type: 'textarea', placeholder: 'e.g. 50 leads/month at $30 CPL, increase walk-ins by 20%...' },
    ],
  },
  {
    title: 'Social Media',
    icon: 'social',
    fields: [
      { key: 'instagram_handle', label: 'Instagram', type: 'text', placeholder: '@handle' },
      { key: 'tiktok_handle', label: 'TikTok', type: 'text', placeholder: '@handle' },
      { key: 'facebook_page', label: 'Facebook Page', type: 'text', placeholder: 'Page name or URL' },
    ],
  },
]

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [selected, setSelected] = useState<Business | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIndustry, setNewIndustry] = useState('')
  const [newColor, setNewColor] = useState(AVATAR_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>('AI Context')
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [adAccounts, setAdAccounts] = useState<AdAccountOption[]>([])
  const [fbPages, setFbPages] = useState<PageOption[]>([])
  const [metaConnected, setMetaConnected] = useState(true)
  const [clients, setClients] = useState<ClientOption[]>([])

  // Folder contents
  const [folderDocs, setFolderDocs] = useState<FolderDoc[]>([])
  const [folderProjects, setFolderProjects] = useState<FolderProject[]>([])
  const [folderSheets, setFolderSheets] = useState<FolderSheet[]>([])
  const [folderTasks, setFolderTasks] = useState<FolderTask[]>([])
  const [meetingDocs, setMeetingDocs] = useState<{ id: number; public_id?: string; title: string; created_at: number; summary: string | null }[]>([])

  // Inline create states
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [creatingSheet, setCreatingSheet] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [newTaskProjectId, setNewTaskProjectId] = useState<number | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [budgetDraft, setBudgetDraft] = useState<string>('')
  const [editingBudget, setEditingBudget] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'ai-context' | 'assets' | 'ads'>('ai-context')

  const load = useCallback(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.businesses || [])).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Load Meta accounts + pages + client list for dropdowns
  useEffect(() => {
    fetch('/api/meta/accounts')
      .then(r => r.json())
      .then(d => {
        if (d.error === 'not_connected') { setMetaConnected(false); return }
        setMetaConnected(true)
        setAdAccounts((d.available || []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))
      })
      .catch(() => setMetaConnected(false))
    fetch('/api/meta/pages')
      .then(r => r.json())
      .then(d => {
        if (d.error === 'not_connected') return
        setFbPages((d.available || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
      })
      .catch(() => {})
    fetch('/api/clients')
      .then(r => r.json())
      .then(d => setClients((d?.profiles || []).map((c: { id: number; name: string; slug: string }) => ({ id: c.id, name: c.name, slug: c.slug }))))
      .catch(() => {})
  }, [])

  // Load folder contents when business selected (accepts numeric id or public_id string)
  const loadDetails = useCallback((bizId: number | string) => {
    fetch(`/api/businesses?id=${bizId}`)
      .then(r => r.json())
      .then(d => {
        if (d.business) setSelected(d.business)
        if (d.contents) {
          setFolderDocs(d.contents.docs || [])
          setFolderProjects(d.contents.projects || [])
          setFolderSheets(d.contents.sheets || [])
          // Fetch tasks for all projects in this folder
          const projectIds = (d.contents.projects || []).map((p: FolderProject) => p.id)
          if (projectIds.length > 0) {
            fetch('/api/tasks?all=1')
              .then(r => r.json())
              .then(td => {
                const projectIdSet = new Set(projectIds)
                const tasks = (td.tasks || [])
                  .filter((t: Record<string, unknown>) => t.project_id && projectIdSet.has(t.project_id as number))
                  .map((t: Record<string, unknown>) => ({
                    id: t.id as number,
                    title: t.title as string,
                    status: t.status as string,
                    priority: t.priority as string,
                    project_id: t.project_id as number,
                    project_name: t.project_name as string | undefined,
                    project_color: t.project_color as string | undefined,
                    due_date: t.due_date as string | undefined,
                  }))
                setFolderTasks(tasks)
              })
              .catch(() => setFolderTasks([]))
          } else {
            setFolderTasks([])
          }
        } else {
          setFolderDocs([]); setFolderProjects([]); setFolderSheets([]); setFolderTasks([])
        }
      })
      .catch(() => {})
    // Load meeting docs for this business
    fetch(`/api/docs?business_id=${bizId}&doc_type=meeting-note`)
      .then(r => r.json())
      .then(docs => {
        if (Array.isArray(docs)) {
          setMeetingDocs(docs.map((d: { id: number; title: string; created_at: number; content: string }) => {
            let summary: string | null = null
            try {
              const blocks = JSON.parse(d.content || '[]')
              const summaryBlock = blocks.find((b: { type: string; content: string }) => b.type === 'bulleted_list')
              summary = summaryBlock?.content || null
            } catch { /* ignore */ }
            return { id: d.id, title: d.title, created_at: d.created_at, summary }
          }))
        }
      })
      .catch(() => setMeetingDocs([]))
  }, [])

  // Auto-open from URL param ?id=X
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const openId = params.get('id')
    if (openId) loadDetails(/^\d+$/.test(openId) ? Number(openId) : openId)
  }, [loadDetails])

  const createBusiness = async () => {
    if (!newName.trim()) return
    setSaving(true)
    const res = await fetch('/api/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), industry: newIndustry || null, avatar_color: newColor }),
    })
    const d = await res.json()
    if (d.business) {
      setBusinesses(prev => [...prev, d.business])
      setSelected(d.business)
      loadDetails(d.business.id)
    }
    setCreating(false); setNewName(''); setNewIndustry(''); setNewColor(AVATAR_COLORS[0]); setSaving(false)
  }

  const saveField = async (field: string, value: string | number | null) => {
    if (!selected) return
    setSaving(true)
    const res = await fetch('/api/businesses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, [field]: value }),
    })
    const d = await res.json()
    if (d.business) { setSelected(d.business); setBusinesses(prev => prev.map(b => b.id === d.business.id ? d.business : b)) }
    setEditField(null); setSaving(false)
  }

  const deleteBusiness = async (id: number) => {
    await fetch(`/api/businesses?id=${id}`, { method: 'DELETE' })
    setBusinesses(prev => prev.filter(b => b.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  // Folder content creation
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
    if (!selected?.folder_id || !selected?.workspace_id || !newItemName.trim()) return
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newItemName.trim(), folderId: selected.folder_id, workspaceId: selected.workspace_id }),
    })
    const d = await res.json()
    setCreatingProject(false); setNewItemName('')
    if (d.project) setFolderProjects(prev => [...prev, { id: d.project.id, name: d.project.name, color: d.project.color, status: d.project.status }])
  }

  const createTask = async () => {
    if (!newItemName.trim() || !newTaskProjectId) return
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newItemName.trim(),
        project_id: newTaskProjectId,
        workspace_id: selected?.workspace_id,
        folder_id: selected?.folder_id,
        status: 'todo',
      }),
    })
    const d = await res.json()
    setCreatingTask(false); setNewItemName(''); setNewTaskProjectId(null)
    if (d.task) {
      const proj = folderProjects.find(p => p.id === newTaskProjectId)
      setFolderTasks(prev => [{
        id: d.task.id,
        title: d.task.title,
        status: d.task.status || 'todo',
        priority: d.task.priority || 'medium',
        project_id: newTaskProjectId,
        project_name: proj?.name,
        project_color: proj?.color,
        due_date: d.task.due_date,
      }, ...prev])
    }
  }

  const createSheet = async () => {
    if (!selected?.folder_id || !newItemName.trim()) return
    const res = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_sheet', name: newItemName.trim(), folder_id: selected.folder_id, workspace_id: selected.workspace_id }),
    })
    const d = await res.json()
    setCreatingSheet(false); setNewItemName('')
    if (d.id) setFolderSheets(prev => [{ id: d.id, name: d.name || newItemName.trim() }, ...prev])
  }

  const getStatusConfig = (status: string) => STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]

  // ─── Detail View ───
  if (selected) {
    const statusCfg = getStatusConfig(selected.status || 'active')
    const aiFields = ['context', 'brand_voice', 'target_audience', 'goals', 'offer', 'offer_details']
    const aiFieldsFilled = aiFields.filter(f => selected[f as keyof Business]).length

    const TABS = [
      { id: 'ai-context' as const, label: 'AI Context' },
      { id: 'overview' as const, label: 'Overview' },
      { id: 'assets' as const, label: 'Assets' },
      { id: 'ads' as const, label: 'Ads' },
    ]

    // Unified typography scale — used everywhere in the detail view
    const sidebarLabelStyle: React.CSSProperties = {
      fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
      letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)',
    }
    const sidebarRowStyle: React.CSSProperties = {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%', padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer',
      textAlign: 'left',
    }
    const sidebarValueStyle: React.CSSProperties = {
      fontSize: 12, color: 'var(--text)', textAlign: 'right', maxWidth: 130,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }

    return (
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* ── LEFT SIDEBAR ── */}
        <div style={{
          width: 260, minWidth: 260, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg-chrome)', overflow: 'hidden',
        }}>
          {/* Crumb row — back · delete */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 8px', flexShrink: 0 }}>
            <button
              onClick={() => { setSelected(null); setEditField(null); setFolderDocs([]); setFolderProjects([]); setFolderSheets([]); setFolderTasks([]) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: 'none', padding: '4px 2px',
                color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              Businesses
            </button>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => { if (confirm('Delete this business?')) deleteBusiness(selected.id) }}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)', fontSize: 11,
                padding: '4px 6px', cursor: 'pointer', borderRadius: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--status-overdue)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
              title="Delete business"
            >
              Delete
            </button>
          </div>

          {/* Identity — left-aligned editorial (no band, no floating avatar) */}
          <div style={{ padding: '8px 20px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ marginBottom: 12 }}>
              <Avatar name={selected.name} size={56} color={selected.avatar_color} />
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500,
              letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)',
              marginBottom: 4,
            }}>
              Business
            </div>
            <div style={{
              fontSize: 20, fontWeight: 600, color: 'var(--text)',
              letterSpacing: '-0.015em', lineHeight: 1.2, marginBottom: 10,
            }}>
              {selected.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: selected.monthly_budget ? 12 : 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.color }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                {statusCfg.label}
              </span>
              {selected.industry && (
                <>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, margin: '0 4px' }}>·</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{selected.industry}</span>
                </>
              )}
            </div>
            {selected.monthly_budget && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1, fontFeatureSettings: '"tnum"' }}>
                  ${selected.monthly_budget.toLocaleString()}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>/mo</span>
              </div>
            )}
          </div>

          {/* Scrollable facts */}
          <div style={{ flex: 1, overflowY: 'auto' }} className="no-scrollbar">

            {/* Account section */}
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ ...sidebarLabelStyle, marginBottom: 8 }}>Account</div>

              {/* Budget */}
              {editField === 'monthly_budget' ? (
                <input type="number" autoFocus value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => saveField('monthly_budget', editValue ? Number(editValue) : null)}
                  onKeyDown={e => { if (e.key === 'Enter') saveField('monthly_budget', editValue ? Number(editValue) : null); if (e.key === 'Escape') setEditField(null) }}
                  className="glass-input" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}
                  placeholder="Monthly budget" />
              ) : (
                <button style={sidebarRowStyle} onClick={() => { setEditField('monthly_budget'); setEditValue(String(selected.monthly_budget || '')) }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                  <span style={sidebarLabelStyle}>Budget</span>
                  {selected.monthly_budget ? (
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>
                      ${selected.monthly_budget.toLocaleString()}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>/mo</span>
                    </span>
                  ) : <span style={{ ...sidebarValueStyle, color: 'var(--text-dim)', opacity: 0.4 }}>—</span>}
                </button>
              )}

              {/* Status */}
              {editField === 'status' ? (
                <div style={{ marginBottom: 4 }}>
                  <Dropdown value={editValue} onChange={v => { setEditValue(v); saveField('status', v) }}
                    options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
                    triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-text inline-flex items-center gap-1.5 cursor-pointer w-full mt-1" minWidth={140} />
                </div>
              ) : (
                <button style={sidebarRowStyle} onClick={() => { setEditField('status'); setEditValue(selected.status || 'active') }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                  <span style={sidebarLabelStyle}>Status</span>
                  <span style={{ ...sidebarValueStyle, color: statusCfg.color }}>{statusCfg.label}</span>
                </button>
              )}

              {/* Location */}
              {editField === 'location' ? (
                <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                  onBlur={() => saveField('location', editValue || null)}
                  onKeyDown={e => { if (e.key === 'Enter') saveField('location', editValue || null); if (e.key === 'Escape') setEditField(null) }}
                  className="glass-input" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)', marginBottom: 4 }} placeholder="City, State" />
              ) : (
                <button style={sidebarRowStyle} onClick={() => { setEditField('location'); setEditValue(selected.location || '') }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                  <span style={sidebarLabelStyle}>Location</span>
                  <span style={{ ...sidebarValueStyle, color: selected.location ? 'var(--text)' : 'var(--text-dim)', opacity: selected.location ? 1 : 0.4 }}>{selected.location || '—'}</span>
                </button>
              )}

              {/* Website */}
              {editField === 'website' ? (
                <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                  onBlur={() => saveField('website', editValue || null)}
                  onKeyDown={e => { if (e.key === 'Enter') saveField('website', editValue || null); if (e.key === 'Escape') setEditField(null) }}
                  className="glass-input" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)', marginBottom: 4 }} placeholder="https://..." />
              ) : (
                <button style={sidebarRowStyle} onClick={() => { setEditField('website'); setEditValue(selected.website || '') }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                  <span style={sidebarLabelStyle}>Website</span>
                  <span style={{ ...sidebarValueStyle, color: selected.website ? 'var(--accent-text)' : 'var(--text-dim)', opacity: selected.website ? 1 : 0.4 }}>
                    {selected.website ? selected.website.replace(/^https?:\/\//, '') : '—'}
                  </span>
                </button>
              )}
            </div>

            {/* Social section — platform icons */}
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ ...sidebarLabelStyle, marginBottom: 10 }}>Social</div>
              {[
                {
                  key: 'instagram_handle', label: 'Instagram', placeholder: '@handle',
                                    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>,
                  url: (h: string) => `https://instagram.com/${h.replace('@', '')}`,
                },
                {
                  key: 'tiktok_handle', label: 'TikTok', placeholder: '@handle',
                                    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.93a8.22 8.22 0 004.79 1.52V7.01a4.85 4.85 0 01-1.02-.32z"/></svg>,
                  url: (h: string) => `https://tiktok.com/@${h.replace('@', '')}`,
                },
                {
                  key: 'facebook_page', label: 'Facebook', placeholder: 'Page name',
                                    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>,
                  url: (h: string) => `https://facebook.com/${h}`,
                },
              ].map(({ key, placeholder, icon, url }) => {
                const val = selected[key as keyof Business] as string | null
                return editField === key ? (
                  <input key={key} autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                    onBlur={() => saveField(key, editValue || null)}
                    onKeyDown={e => { if (e.key === 'Enter') saveField(key, editValue || null); if (e.key === 'Escape') setEditField(null) }}
                    className="glass-input" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)', marginBottom: 6 }} placeholder={placeholder} />
                ) : (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', marginBottom: 2 }}>
                    <span style={{ color: val ? 'var(--text-secondary)' : 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>{icon}</span>
                    <button
                      style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                      onClick={() => { setEditField(key); setEditValue(val || '') }}
                    >
                      <span style={{ fontSize: 12, color: val ? 'var(--text)' : 'var(--text-muted)' }}>
                        {val || placeholder}
                      </span>
                    </button>
                    {val && (
                      <a href={url(val)} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--text-muted)', display: 'flex', flexShrink: 0, textDecoration: 'none', transition: 'color 120ms' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                        onClick={e => e.stopPropagation()}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Linked Client */}
            <div style={{ padding: '18px 20px' }}>
              <div style={{ ...sidebarLabelStyle, marginBottom: 8 }}>Linked Client</div>
              <Dropdown
                value={String(selected.client_id || 0)}
                onChange={(v) => saveField('client_id', Number(v))}
                options={[{ value: '0', label: 'None' }, ...clients.map(c => ({ value: String(c.id), label: c.name }))]}
                triggerClassName="bg-transparent border-none px-0 py-1 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer w-full"
                minWidth={140}
              />
              {selected.client_id > 0 && (
                <a href="/clients" className="text-[11px] text-accent-text mt-2 inline-block hover:underline" style={{ fontFamily: 'var(--font-mono)' }}>Open client →</a>
              )}
            </div>
          </div>

        </div>

        {/* ── RIGHT: TABS + CONTENT ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px', flexShrink: 0 }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '14px 0', marginRight: 28, background: 'none', border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                  color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--text-dim)',
                  fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  cursor: 'pointer', transition: 'color 0.15s, border-color 0.15s',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {tab.label}
                {tab.id === 'ai-context' && aiFieldsFilled > 0 && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.05em',
                    color: activeTab === 'ai-context' ? 'var(--text)' : 'var(--text-muted)',
                    fontFeatureSettings: '"tnum"',
                  }}>{aiFieldsFilled}/{aiFields.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 28px 60px' }} className="no-scrollbar">

        {/* ══ AI CONTEXT TAB ══ */}
            {activeTab === 'ai-context' && (
              <div style={{ maxWidth: 720 }}>
                {/* ── Context Health — 6-pip strip matching the roster ── */}
                <div style={{ marginBottom: 32, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Context Health</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {Array.from({ length: aiFields.length }).map((_, i) => (
                      <span key={i} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: i < aiFieldsFilled ? 'var(--accent)' : 'var(--border-strong)',
                        flexShrink: 0,
                      }} />
                    ))}
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: aiFieldsFilled === aiFields.length ? 'var(--text)' : 'var(--text-muted)', fontFeatureSettings: '"tnum"' }}>
                    {aiFieldsFilled}/{aiFields.length}
                  </span>
                  <span style={{ flex: 1 }} />
                  {aiFieldsFilled < aiFields.length && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Fill for sharper AI output</span>
                  )}
                </div>

                {/* ── AI context fields — flat editorial, no card chrome ── */}
                {[
                  { key: 'context', label: 'Background', placeholder: 'Business background, history, unique selling points…', rows: 5 },
                  { key: 'brand_voice', label: 'Brand Voice', placeholder: 'e.g. Casual, masculine, confident. Uses slang. Never say "pamper"…', rows: 3 },
                  { key: 'target_audience', label: 'Target Audience', placeholder: 'e.g. Men 18-45, urban, care about style…', rows: 3 },
                  { key: 'goals', label: 'Goals & KPIs', placeholder: 'e.g. 50 leads/month at $30 CPL, increase walk-ins by 20%…', rows: 3 },
                  { key: 'offer', label: 'Current Offer', placeholder: 'e.g. First-time client: Free beard trim with any haircut ($45 value)', rows: 3 },
                  { key: 'offer_details', label: 'Offer Details / Funnel', placeholder: 'Landing page flow, follow-up sequence, what happens after they book…', rows: 4 },
                ].map(({ key, label, placeholder, rows }) => {
                  const isFilled = !!selected[key as keyof Business]
                  return (
                    <div key={key} style={{
                      padding: '16px 0',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: isFilled ? 'var(--text-secondary)' : 'var(--text-dim)' }}>{label}</span>
                        <span style={{
                          width: 5, height: 5, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                          background: isFilled ? 'var(--accent)' : 'transparent',
                          border: isFilled ? 'none' : '1px solid var(--border-strong)',
                        }} />
                      </div>
                      <textarea
                        defaultValue={(selected[key as keyof Business] as string) || ''}
                        placeholder={placeholder}
                        onBlur={e => { if (e.target.value !== (selected[key as keyof Business] || '')) saveField(key, e.target.value || null) }}
                        rows={rows}
                        style={{
                          width: '100%', background: 'transparent',
                          border: 'none', padding: 0,
                          fontSize: 13, color: 'var(--text)',
                          resize: 'vertical', lineHeight: 1.6, outline: 'none', fontFamily: 'inherit',
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            )}

            {/* ══ OVERVIEW TAB ══ */}
            {activeTab === 'overview' && (
              <div style={{ maxWidth: 720 }}>
                {/* ── Business Info — flat editorial rows ── */}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12 }}>Business Info</div>
                <div style={{ marginBottom: 40 }}>
                  {[
                    { key: 'industry', label: 'Industry', type: 'select', options: INDUSTRIES, placeholder: 'Select industry' },
                    { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS.map(s => s.value), placeholder: 'Select status' },
                    { key: 'location', label: 'Location', type: 'text', placeholder: 'e.g. Miami, FL' },
                    { key: 'website', label: 'Website', type: 'url', placeholder: 'https://...' },
                    { key: 'services', label: 'Services', type: 'textarea', placeholder: 'Haircuts, beard trims…' },
                  ].map(field => {
                    const val = selected[field.key as keyof Business]
                    const active = editField === field.key
                    return (
                      <div key={field.key} style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 1fr',
                        alignItems: field.type === 'textarea' ? 'flex-start' : 'center',
                        padding: '14px 0',
                        borderBottom: '1px solid var(--border)',
                        gap: 16,
                      }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                          letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)',
                          paddingTop: field.type === 'textarea' ? 8 : 0,
                        }}>{field.label}</div>
                        <div style={{ minWidth: 0 }}>
                          {active ? (
                            field.type === 'select' ? (
                              <Dropdown
                                value={editValue}
                                onChange={v => { setEditValue(v); saveField(field.key, v) }}
                                options={[{ value: '', label: field.placeholder }, ...(field.options || []).map(o => ({ value: o, label: o.charAt(0).toUpperCase() + o.slice(1) }))]}
                                triggerClassName="bg-transparent border-none px-0 py-0 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer w-full"
                                minWidth={160}
                              />
                            ) : field.type === 'textarea' ? (
                              <textarea autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                                onBlur={() => saveField(field.key, editValue || null)}
                                onKeyDown={e => { if (e.key === 'Escape') setEditField(null) }}
                                rows={3}
                                style={{
                                  width: '100%', background: 'transparent', border: 'none',
                                  padding: 0, fontSize: 13, color: 'var(--text)',
                                  resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                                }} />
                            ) : (
                              <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                                onBlur={() => saveField(field.key, editValue || null)}
                                onKeyDown={e => { if (e.key === 'Enter') saveField(field.key, editValue || null); if (e.key === 'Escape') setEditField(null) }}
                                style={{
                                  width: '100%', background: 'transparent', border: 'none',
                                  padding: 0, fontSize: 13, color: 'var(--text)', outline: 'none',
                                }} />
                            )
                          ) : (
                            <button onClick={() => { setEditField(field.key); setEditValue(String(val ?? '')) }}
                              style={{
                                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                                padding: 0, fontSize: 13, cursor: 'pointer',
                                color: val ? 'var(--text)' : 'var(--text-muted)',
                                whiteSpace: field.type === 'textarea' ? 'pre-wrap' : 'nowrap',
                                overflow: field.type === 'textarea' ? undefined : 'hidden',
                                textOverflow: field.type === 'textarea' ? undefined : 'ellipsis',
                              }}>
                              {String(val || field.placeholder)}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* ── Social Media — inline rows with monochrome icons ── */}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12 }}>Social Media</div>
                <div>
                  {[
                    { key: 'instagram_handle', label: 'Instagram', placeholder: '@handle' },
                    { key: 'tiktok_handle', label: 'TikTok', placeholder: '@handle' },
                    { key: 'facebook_page', label: 'Facebook', placeholder: 'Page name' },
                  ].map(({ key, label, placeholder }) => {
                    const val = selected[key as keyof Business] as string | null
                    const active = editField === key
                    return (
                      <div key={key} style={{
                        display: 'grid',
                        gridTemplateColumns: '140px 1fr',
                        alignItems: 'center',
                        padding: '14px 0',
                        borderBottom: '1px solid var(--border)',
                        gap: 16,
                      }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                          letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)',
                        }}>{label}</div>
                        <div style={{ minWidth: 0 }}>
                          {active ? (
                            <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                              onBlur={() => saveField(key, editValue || null)}
                              onKeyDown={e => { if (e.key === 'Enter') saveField(key, editValue || null); if (e.key === 'Escape') setEditField(null) }}
                              style={{
                                width: '100%', background: 'transparent', border: 'none',
                                padding: 0, fontSize: 13, color: 'var(--text)', outline: 'none',
                              }} />
                          ) : (
                            <button onClick={() => { setEditField(key); setEditValue(val || '') }}
                              style={{
                                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                                padding: 0, fontSize: 13, cursor: 'pointer',
                                color: val ? 'var(--text)' : 'var(--text-muted)',
                              }}>
                              {val || placeholder}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ══ ASSETS TAB ══ */}
            {activeTab === 'assets' && (
              <div style={{ maxWidth: 900 }}>
                {/* Projects + Docs 2-col */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                  {/* Projects */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Projects</span>
                        {folderProjects.length > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>{folderProjects.length}</span>}
                      </div>
                      <button onClick={() => setCreatingProject(true)} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>
                    </div>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {folderProjects.length === 0 && !creatingProject && (
                        <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No projects yet</div>
                      )}
                      {folderProjects.map(p => (
                        <a key={p.id} href={`/project/${p.public_id || p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{p.status}</span>
                        </a>
                      ))}
                      {creatingProject && (
                        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: folderProjects.length > 0 ? '1px solid var(--border)' : undefined }}>
                          <input autoFocus type="text" placeholder="Project name" value={newItemName} onChange={e => setNewItemName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createProject()} className="glass-input" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)' }} />
                          <button onClick={createProject} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}>Add</button>
                          <button onClick={() => { setCreatingProject(false); setNewItemName('') }} style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Docs */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Docs</span>
                        {folderDocs.length > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>{folderDocs.length}</span>}
                      </div>
                      <button onClick={() => setCreatingDoc(true)} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>
                    </div>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {folderDocs.length === 0 && !creatingDoc && (
                        <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No docs yet</div>
                      )}
                      {folderDocs.map(d => (
                        <a key={d.id} href={`/doc/${d.public_id || d.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                        </a>
                      ))}
                      {creatingDoc && (
                        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: folderDocs.length > 0 ? '1px solid var(--border)' : undefined }}>
                          <input autoFocus type="text" placeholder="Doc title" value={newItemName} onChange={e => setNewItemName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createDoc()} className="glass-input" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)' }} />
                          <button onClick={createDoc} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}>Add</button>
                          <button onClick={() => { setCreatingDoc(false); setNewItemName('') }} style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>
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
                    {folderTasks.length === 0 && !creatingTask && (
                      <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>
                        {folderProjects.length === 0 ? 'Create a project first' : 'No tasks yet'}
                      </div>
                    )}
                    {folderTasks.sort((a, b) => { const ord: Record<string, number> = { todo: 0, 'in-progress': 1, blocked: 2, done: 3, completed: 3 }; return (ord[a.status] ?? 0) - (ord[b.status] ?? 0) }).map(t => {
                      const isDone = t.status === 'done' || t.status === 'completed'
                      return (
                        <a key={t.id} href={`/schedule?task=${(t as any).public_id || t.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', opacity: isDone ? 0.5 : 1, transition: 'background 0.1s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
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
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input autoFocus type="text" placeholder="Task title" value={newItemName} onChange={e => setNewItemName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createTask()} className="glass-input" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)' }} />
                          <button onClick={createTask} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}>Add</button>
                          <button onClick={() => { setCreatingTask(false); setNewItemName('') }} style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Meetings + Database 2-col */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Meetings */}
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>Meetings</div>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {meetingDocs.length === 0 && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No meetings yet</div>}
                      {meetingDocs.map(m => (
                        <a key={m.id} href={`/doc/${m.public_id || m.id}`} target="_blank" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" /></svg>
                          <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{new Date(m.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </a>
                      ))}
                    </div>
                  </div>

                  {/* Database */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Database</span>
                      <button onClick={() => setCreatingSheet(true)} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>
                    </div>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {folderSheets.length === 0 && !creatingSheet && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No databases yet</div>}
                      {folderSheets.map(s => (
                        <a key={s.id} href={`/database?open=${(s as any).public_id || s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="var(--text-dim)" strokeWidth="1.2"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="var(--text-dim)" strokeWidth="1" /></svg>
                          <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        </a>
                      ))}
                      {creatingSheet && (
                        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: folderSheets.length > 0 ? '1px solid var(--border)' : undefined }}>
                          <input autoFocus type="text" placeholder="Database name" value={newItemName} onChange={e => setNewItemName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createSheet()} className="glass-input" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)' }} />
                          <button onClick={createSheet} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}>Add</button>
                          <button onClick={() => { setCreatingSheet(false); setNewItemName('') }} style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══ ADS TAB ══ */}
            {activeTab === 'ads' && (
              <div style={{ maxWidth: 520 }}>
                {/* Connection status banner */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 4, marginBottom: 24,
                  background: metaConnected ? 'color-mix(in oklab, var(--status-completed) 10%, transparent)' : 'var(--bg-surface)',
                  border: `1px solid ${metaConnected ? 'color-mix(in oklab, var(--status-completed) 30%, transparent)' : 'var(--border)'}`,
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: metaConnected ? 'var(--status-completed)' : 'var(--text-dim)',
                    boxShadow: metaConnected ? '0 0 0 2px color-mix(in oklab, var(--status-completed) 30%, transparent)' : 'none',
                  }} />
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: metaConnected ? 'var(--accent-text)' : 'var(--text-dim)', flex: 1 }}>
                    {metaConnected ? 'Meta connected' : 'Meta not connected'}
                  </span>
                  {!metaConnected && (
                    <a href="/settings" style={{ fontSize: 11, color: 'var(--accent-text)', fontFamily: 'var(--font-mono)', textDecoration: 'none' }}>
                      Connect →
                    </a>
                  )}
                  {metaConnected && selected.ad_account_id && (
                    <a
                      href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${selected.ad_account_id.replace('act_', '')}`}
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-text)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                    >
                      Open Ads Manager
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  )}
                </div>

                {metaConnected && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>Ad Account</div>
                      <Dropdown
                        value={selected.ad_account_id || ''}
                        onChange={(v) => saveField('ad_account_id', v || null)}
                        options={[{ value: '', label: 'Select ad account' }, ...adAccounts.map(a => ({ value: a.id, label: `${a.name} (${a.id})` }))]}
                        triggerClassName="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[13px] text-text inline-flex items-center gap-2 cursor-pointer hover:border-[var(--border-strong)] transition-colors w-full"
                        minWidth={200}
                      />
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>Facebook Page</div>
                      <Dropdown
                        value={selected.page_id || ''}
                        onChange={(v) => saveField('page_id', v || null)}
                        options={[{ value: '', label: 'Select page' }, ...fbPages.map(p => ({ value: p.id, label: p.name }))]}
                        triggerClassName="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[13px] text-text inline-flex items-center gap-2 cursor-pointer hover:border-[var(--border-strong)] transition-colors w-full"
                        minWidth={200}
                      />
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
                          style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 15, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)', outline: 'none', fontWeight: 700, transition: 'border-color 0.15s' }}
                          placeholder="0"
                          onFocusCapture={e => (e.target.style.borderColor = 'var(--accent)')}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>/mo</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    )
  }


  // ─── Card Grid View ───
  const totalMRR = businesses.reduce((s, b) => s + (b.monthly_budget || 0), 0)

  return (
    <div className="h-full overflow-y-auto pb-28">
      <PageHeader
        title="Businesses"
        count={businesses.length}
        rightSlot={totalMRR > 0 ? (
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-mono)',
            color: 'var(--accent-text)', fontWeight: 600, marginRight: 4,
          }}>${totalMRR.toLocaleString()}/mo</span>
        ) : undefined}
        action={{
          label: 'New Business',
          icon: <IconPlus size={14} />,
          onClick: () => setCreating(true),
        }}
      />

      {creating && (
        <div className="mx-6 mb-6 animate-float-up" style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>New Business</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input type="text" placeholder="Business name" value={newName} onChange={e => setNewName(e.target.value)} className="glass-input" style={{ padding: '8px 12px', borderRadius: 8, fontSize: 14, color: 'var(--text)', width: '100%' }} autoFocus />
            <Dropdown
              value={newIndustry}
              onChange={(v) => setNewIndustry(v)}
              options={[{ value: '', label: 'Industry (optional)' }, ...INDUSTRIES.map(i => ({ value: i, label: i }))]}
              triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors w-full"
              minWidth={160}
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
              <button onClick={createBusiness} disabled={!newName.trim() || saving} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: (!newName.trim() || saving) ? 0.5 : 1,
              }}>{saving ? 'Creating...' : 'Add Business'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Editorial list — one row per business */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 32px 80px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '4px 2px 10px', borderBottom: '1px solid var(--border)', marginBottom: 4,
        }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search businesses"
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
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
            letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)',
            marginLeft: 'auto',
          }}>
            {(() => {
              const filteredCount = search.trim()
                ? businesses.filter(b => {
                    const q = search.toLowerCase()
                    return b.name.toLowerCase().includes(q)
                      || (b.industry || '').toLowerCase().includes(q)
                      || (b.location || '').toLowerCase().includes(q)
                  }).length
                : businesses.length
              return `${filteredCount} ${filteredCount === 1 ? 'business' : 'businesses'}`
            })()}
          </span>
          {businesses.length > 0 && !creating && (
            <button onClick={() => setCreating(true)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none',
              color: 'var(--text-dim)', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', padding: 4,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)' }}>
              <IconPlus size={12} /> Add
            </button>
          )}
        </div>

        {businesses.filter(b => {
          if (!search.trim()) return true
          const q = search.toLowerCase()
          return b.name.toLowerCase().includes(q)
            || (b.industry || '').toLowerCase().includes(q)
            || (b.location || '').toLowerCase().includes(q)
        }).map(biz => {
          const sCfg = getStatusConfig(biz.status || 'active')
          const aiContextFields = ['context', 'brand_voice', 'target_audience', 'goals', 'offer', 'offer_details'] as const
          const contextFilled = aiContextFields.filter(f => biz[f]).length
          const hasAds = !!biz.ad_account_id
          return (
            <button
              key={biz.id}
              onClick={() => { setSelected(biz); loadDetails(biz.id); setExpandedSection('AI Context') }}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px minmax(0, 1.3fr) minmax(0, 1fr) auto auto auto',
                gap: 16, alignItems: 'center',
                width: '100%', padding: '12px 8px',
                background: 'transparent',
                border: 'none', borderBottom: '1px solid var(--border)',
                textAlign: 'left', cursor: 'pointer',
                transition: 'background 120ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {/* Avatar */}
              <div style={{ width: 40, height: 40, flexShrink: 0 }}>
                <Avatar
                  name={biz.name}
                  size={40}
                  color={biz.avatar_color}
                  src={(biz as Business & { avatar_url?: string }).avatar_url || undefined}
                />
              </div>

              {/* Name · industry/location */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 500, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '-0.005em',
                }}>{biz.name}</div>
                {(biz.industry || biz.location) && (
                  <div style={{
                    fontSize: 11, color: 'var(--text-dim)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}>
                    {biz.industry}
                    {biz.industry && biz.location && <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>}
                    {biz.location}
                  </div>
                )}
              </div>

              {/* AI context health — 6 pip dots */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 3 }} title={`${contextFilled}/6 AI context fields filled`}>
                  {[0,1,2,3,4,5].map(i => (
                    <span key={i} style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: i < contextFilled ? 'var(--accent)' : 'var(--border-strong)',
                      flexShrink: 0,
                    }} />
                  ))}
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  letterSpacing: '0.05em', color: 'var(--text-muted)',
                }}>
                  {contextFilled}/6
                </span>
              </div>

              {/* Meta badge */}
              <div style={{ minWidth: 48, textAlign: 'right' }}>
                {hasAds && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: 'var(--text-dim)',
                  }}>META</span>
                )}
              </div>

              {/* Budget — right-aligned mono */}
              <div style={{
                fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"',
                textAlign: 'right', minWidth: 88,
              }}>
                {biz.monthly_budget ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                      ${biz.monthly_budget.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      /mo
                    </div>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                )}
              </div>

              {/* Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 90, justifyContent: 'flex-end' }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: sCfg.color, flexShrink: 0,
                }} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                }}>{sCfg.label}</span>
              </div>
            </button>
          )
        })}

        {/* Quiet add row */}
        {businesses.length > 0 && !creating && (
          <button
            onClick={() => setCreating(true)}
            style={{
              width: '100%', padding: '14px 8px',
              background: 'transparent', border: 'none',
              display: 'flex', alignItems: 'center', gap: 12,
              color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: 13,
              transition: 'color 120ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-dim)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <span style={{
              width: 40, height: 40, borderRadius: '50%',
              border: '1px dashed currentColor',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <IconPlus size={14} />
            </span>
            <span>Add business</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card !rounded-lg px-2.5 py-1.5 text-center">
      <div className="text-[10px] text-text-dim">{label}</div>
      <div className="text-[11px] font-medium text-text truncate max-w-[120px]">{value}</div>
    </div>
  )
}

function FolderSection({ icon, title, count, expanded, onToggle, children }: { icon: string; title: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  const icons: Record<string, React.ReactNode> = {
    folder: <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>,
    doc: <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
    database: <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>,
    task: <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>,
  }
  return (
    <div className="px-4 mb-2">
      <div className="glass-card !rounded-md overflow-hidden">
        <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <div className="flex items-center gap-2">
            {icons[icon]}
            <span className="text-[14px] font-semibold text-text">{title}</span>
            {count > 0 && <span className="text-[11px] text-accent-text">{count}</span>}
          </div>
          <IconChevronDown size={16} className={`text-text-dim transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && (
          <div className="px-2 pb-3 border-t border-border pt-1 space-y-0.5">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

function FieldRow({ field, value, editing, editValue, onStartEdit, onEditChange, onSave, onCancel, saving }: {
  field: SectionField; value: string | number | null; editing: boolean; editValue: string
  onStartEdit: (val: string | number | null) => void; onEditChange: (v: string) => void; onSave: () => void; onCancel: () => void; saving: boolean
}) {
  if (editing) {
    return (
      <div className="space-y-2 pt-2 animate-float-up">
        <label className="text-[12px] font-medium text-text-dim uppercase tracking-wider">{field.label}</label>
        {field.type === 'select' ? (
          <Dropdown
            value={editValue}
            onChange={(v) => onEditChange(v)}
            options={[{ value: '', label: field.placeholder }, ...(field.options || []).map(o => ({ value: o, label: o.charAt(0).toUpperCase() + o.slice(1) }))]}
            triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors w-full"
            minWidth={160}
          />
        ) : field.type === 'textarea' ? (
          <textarea value={editValue} onChange={e => onEditChange(e.target.value)} className="w-full glass-input px-3 py-2 rounded-md text-[14px] text-text min-h-[100px] resize-none" placeholder={field.placeholder} autoFocus />
        ) : (
          <input type={field.type === 'number' ? 'number' : 'text'} value={editValue} onChange={e => onEditChange(e.target.value)} className="w-full glass-input px-3 py-2 rounded-md text-[14px] text-text" placeholder={field.placeholder} autoFocus />
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 glass-btn px-3 py-2 rounded-md text-[13px] text-text-dim">Cancel</button>
          <button onClick={onSave} disabled={saving} className="flex-1 bg-accent text-white px-3 py-2 rounded-md text-[13px] font-medium disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    )
  }
  const displayVal = value !== null && value !== undefined && value !== '' ? String(value) : null
  return (
    <button onClick={() => onStartEdit(value)} className="w-full flex items-center justify-between py-2.5 text-left group">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-text-dim uppercase tracking-wider mb-0.5">{field.label}</div>
        {displayVal ? <p className="text-[14px] text-text leading-relaxed whitespace-pre-wrap line-clamp-2">{displayVal}</p> : <p className="text-[13px] text-text-dim/40 italic">{field.placeholder}</p>}
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim/30 group-hover:text-text-dim shrink-0 ml-2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
    </button>
  )
}

function SectionIcon({ name }: { name: string }) {
  const cls = "w-[18px] h-[18px] text-accent-text"
  switch (name) {
    case 'briefcase': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /></svg>
    case 'offer': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
    case 'brain': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
    case 'chart': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
    case 'social': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
    case 'people': return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
    default: return null
  }
}
