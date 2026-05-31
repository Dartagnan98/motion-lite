'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { IconChevronDown, IconChevronRight, IconX, IconPlus } from '@/components/ui/Icons'
import { PageHeader } from '@/components/ui/PageHeader'
import { AVATAR_COLORS, STATUS_OPTIONS } from '@/lib/client-business-constants'
import { PRIORITY_COLORS } from '@/lib/task-constants'
import { QboMappingRow } from './QboMappingRow'
import { AccountingTab } from './AccountingTab'
import { ClientSummarySidebar } from './_components/ClientSummarySidebar'
import type { ClientSidebarProfile } from './_components/ClientSummarySidebar'

interface ClientProfile {
  id: number
  name: string
  slug: string
  industry: string | null
  avatar_color: string
  avatar_url: string | null
  status: string
  contacts: string
  notes: string
  website: string | null
  location: string | null
  qbo_customer_id: string | null
  folder_id: number | null
  workspace_id: number | null
  created_at: number
  updated_at: number
  // AI Context / marketing fields (lifted from businesses)
  context: string
  brand_voice: string
  goals: string
  target_audience: string
  services: string
  offer: string
  offer_details: string
  // Ads fields
  ad_account_id: string | null
  page_id: string | null
  monthly_budget: number | null
  // Social
  instagram_handle: string | null
  tiktok_handle: string | null
  facebook_page: string | null
  // CRM bridge
  crm_company_id: number | null
}

interface FolderDoc { id: number; public_id?: string; title: string; updated_at: number }
interface FolderProject { id: number; public_id?: string; name: string; color: string; status: string }
interface FolderSheet { id: number; public_id?: string; name: string }
interface FolderTask { id: number; title: string; status: string; priority: string; project_id: number; project_name?: string; project_color?: string; due_date?: string }
interface AdAccountOption { id: string; name: string }
interface PageOption { id: string; name: string }

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

type HealthStatus = 'green' | 'amber' | 'red' | 'gray'

interface ClientEnrichment {
  clientProfileId: number
  connectedCount: number
  totalAvailable: number
  lastReportPeriodEnd: string | null
  health: HealthStatus
}

interface LinkedBusiness {
  id: number
  public_id?: string
  name: string
  industry: string | null
  avatar_color: string
  avatar_url: string | null
  status: string
  monthly_budget: number | null
  client_id: number
}

interface AllBusiness {
  id: number
  name: string
  client_id: number
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientProfile[]>([])
  const [selected, setSelected] = useState<ClientProfile | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(AVATAR_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>('businesses')
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [businesses, setBusinesses] = useState<LinkedBusiness[]>([])
  const [allBusinesses, setAllBusinesses] = useState<AllBusiness[]>([])
  const [showLinkDropdown, setShowLinkDropdown] = useState(false)
  // Platform enrichment: integrations count, last report, health dot
  const [enrichmentMap, setEnrichmentMap] = useState<Map<number, ClientEnrichment>>(new Map())
  const [enrichmentLoading, setEnrichmentLoading] = useState(true)

  // Portal
  const [portal, setPortal] = useState<{ id: number; enabled: number; magic_link_token: string | null } | null>(null)
  const [portalPassword, setPortalPassword] = useState('')
  const [portalLoaded, setPortalLoaded] = useState(false)

  const load = useCallback(() => {
    fetch('/api/clients').then(r => r.json()).then(d => setClients(d.profiles || [])).catch(() => {})
  }, [])

  const loadEnrichment = useCallback(() => {
    setEnrichmentLoading(true)
    fetch('/api/platform/client-enrichment')
      .then(r => r.json())
      .then((d: { enrichment?: ClientEnrichment[] }) => {
        const map = new Map<number, ClientEnrichment>()
        for (const e of d.enrichment || []) map.set(e.clientProfileId, e)
        setEnrichmentMap(map)
      })
      .catch(() => {})
      .finally(() => setEnrichmentLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadEnrichment() }, [loadEnrichment])

  // Auto-open from URL `?id=` (slug | public_id | numeric id). Fires once
  // after the list arrives. Used by `/clients/[slug]/page.tsx` deep-link
  // redirects so paths like `/clients/glenvalley-dental` open the right card.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current || clients.length === 0) return
    if (typeof window === 'undefined') return
    const param = new URLSearchParams(window.location.search).get('id')
    if (!param) { autoOpenedRef.current = true; return }
    const lc = param.toLowerCase()
    const numeric = /^\d+$/.test(param) ? Number(param) : null
    const match = clients.find(c =>
      (numeric !== null && c.id === numeric) ||
      c.slug?.toLowerCase() === lc
    )
    if (match) setSelected(match)
    autoOpenedRef.current = true
  }, [clients])

  // Load linked businesses + portal when client selected
  const loadClientDetails = useCallback((clientId: number, slug: string) => {
    fetch(`/api/businesses?client_id=${clientId}`)
      .then(r => r.json())
      .then(d => setBusinesses(d.businesses || []))
      .catch(() => {})
    // Load all businesses for the link dropdown
    fetch('/api/businesses')
      .then(r => r.json())
      .then(d => setAllBusinesses(d.businesses || []))
      .catch(() => {})
    // Load portal config
    setPortalLoaded(false)
    fetch(`/api/portal?all=1`)
      .then(r => r.json())
      .then((portals: { id: number; client_slug: string; enabled: number; magic_link_token: string | null }[]) => {
        const match = portals.find(p => p.client_slug === slug)
        setPortal(match || null)
        setPortalLoaded(true)
      })
      .catch(() => setPortalLoaded(true))
  }, [])

  useEffect(() => {
    if (selected) loadClientDetails(selected.id, selected.slug)
  }, [selected?.id, selected?.slug, loadClientDetails])

  const createClient = async () => {
    if (!newName.trim()) return
    setSaving(true)
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), avatar_color: newColor }),
    })
    const d = await res.json()
    if (d.profile) { setClients(prev => [...prev, d.profile]); setSelected(d.profile) }
    setCreating(false); setNewName(''); setNewColor(AVATAR_COLORS[0]); setSaving(false)
  }

  const saveField = async (field: string, value: string | number | null) => {
    if (!selected) return
    setSaving(true)
    const res = await fetch('/api/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, [field]: value }),
    })
    const d = await res.json()
    if (d.profile) { setSelected(d.profile); setClients(prev => prev.map(c => c.id === d.profile.id ? d.profile : c)) }
    setEditField(null); setSaving(false)
  }

  const deleteClient = async (id: number) => {
    await fetch(`/api/clients?id=${id}`, { method: 'DELETE' })
    setClients(prev => prev.filter(c => c.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  // Select a client in the card AND set it as the active platform account so the
  // PM Dashboard, Reports, and connect flows all follow the selection (#5).
  // Fire-and-forget: the activate route rejects CRM-only clients (no tenant),
  // which we safely ignore.
  const selectClient = (client: ClientProfile) => {
    setSelected(client)
    setExpandedSection('businesses')
    fetch(`/api/platform/accounts/${client.id}/activate`, { method: 'POST' }).catch(() => {})
  }

  const clientAvatarRef = useRef<HTMLInputElement>(null)
  const bizAvatarRef = useRef<HTMLInputElement>(null)
  const uploadingBizIdRef = useRef<number | null>(null)
  const [cropImage, setCropImage] = useState<{ src: string; type: 'client' | 'business'; id: number } | null>(null)
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 })
  const [cropScale, setCropScale] = useState(1)
  const cropCanvasRef = useRef<HTMLCanvasElement>(null)
  const cropImgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  const handleFileSelect = (file: File, type: 'client' | 'business', id: number) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setCropImage({ src: e.target?.result as string, type, id })
      setCropOffset({ x: 0, y: 0 })
      setCropScale(1)
    }
    reader.readAsDataURL(file)
  }

  const cropAndUpload = async () => {
    if (!cropImage || !cropImgRef.current) return
    const img = cropImgRef.current
    const canvas = document.createElement('canvas')
    const size = 400
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    const minDim = Math.min(img.naturalWidth, img.naturalHeight)
    const scale = cropScale
    const srcSize = minDim / scale
    const centerX = img.naturalWidth / 2 - (cropOffset.x / 200) * minDim
    const centerY = img.naturalHeight / 2 - (cropOffset.y / 200) * minDim
    const sx = centerX - srcSize / 2
    const sy = centerY - srcSize / 2

    ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size)

    canvas.toBlob(async (blob) => {
      if (!blob) return
      const fd = new FormData()
      fd.append('file', blob, 'avatar.jpg')
      const res = await fetch('/api/uploads/avatar', { method: 'POST', body: fd })
      if (!res.ok) { setCropImage(null); return }
      const { url } = await res.json()
      if (cropImage.type === 'client') {
        await fetch('/api/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cropImage.id, avatar_url: url }) })
        setSelected(prev => prev ? { ...prev, avatar_url: url } : prev)
        setClients(prev => prev.map(c => c.id === cropImage.id ? { ...c, avatar_url: url } : c))
      } else {
        await fetch('/api/businesses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cropImage.id, avatar_url: url }) })
        setBusinesses(prev => prev.map(b => b.id === cropImage.id ? { ...b, avatar_url: url } : b))
      }
      setCropImage(null)
    }, 'image/jpeg', 0.9)
  }

  const linkBusiness = async (bizId: number) => {
    if (!selected) return
    await fetch('/api/businesses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bizId, client_id: selected.id }),
    })
    setShowLinkDropdown(false)
    loadClientDetails(selected.id, selected.slug)
  }

  const unlinkBusiness = async (bizId: number) => {
    await fetch('/api/businesses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bizId, client_id: 0 }),
    })
    if (selected) loadClientDetails(selected.id, selected.slug)
  }

  const createPortal = async () => {
    if (!selected) return
    const res = await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        client_slug: selected.slug,
        password: portalPassword || undefined,
      }),
    })
    const d = await res.json()
    if (d.success) {
      setPortalPassword('')
      loadClientDetails(selected.id, selected.slug)
    }
  }

  const togglePortal = async (enabled: boolean) => {
    if (!portal) return
    await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id: portal.id, enabled }),
    })
    setPortal({ ...portal, enabled: enabled ? 1 : 0 })
  }

  const getStatusConfig = (status: string) => STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]

  const totalBudget = businesses.reduce((sum, b) => sum + (b.monthly_budget || 0), 0)

  // ─── Tab state for detail view ───
  type DetailTab = 'profile' | 'integrations' | 'reports' | 'comments' | 'accounting' | 'ai-context' | 'assets' | 'ads' | 'contacts'
  const [activeTab, setActiveTab] = useState<DetailTab>('profile')

  // ─── Folder / Assets state ───
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

  // ─── Ads state ───
  const [adAccounts, setAdAccounts] = useState<AdAccountOption[]>([])
  const [fbPages, setFbPages] = useState<PageOption[]>([])
  const [metaConnected, setMetaConnected] = useState(true)
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState('')

  // ─── Contacts tab state ───
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [addingContact, setAddingContact] = useState(false)
  const [contactForm, setContactForm] = useState<{ name: string; email: string; phone: string }>({ name: '', email: '', phone: '' })
  const [savingContact, setSavingContact] = useState(false)
  // Linked-contacts profile section (mirrors the Linked Businesses block).
  const [allCrmContacts, setAllCrmContacts] = useState<CrmContact[]>([])
  const [showLinkContactDropdown, setShowLinkContactDropdown] = useState(false)

  // ─── Platform data for detail tabs ───
  interface PlatformIntegration {
    id: number
    provider: string
    display_name: string | null
    status: string
    last_health_status: string | null
    last_synced_at: number | null
  }
  interface PlatformReport {
    id: number
    name: string
    period_start: string
    period_end: string
    status: string
  }
  interface PlatformComment {
    id: number
    body: string
    report_name: string
    section_title: string | null
    author_name: string | null
    created_at: number
  }
  const [tabIntegrations, setTabIntegrations] = useState<PlatformIntegration[]>([])
  const [tabReports, setTabReports] = useState<PlatformReport[]>([])
  const [tabComments, setTabComments] = useState<PlatformComment[]>([])
  const [tabLoading, setTabLoading] = useState(false)
  const [tabAccountId, setTabAccountId] = useState<number | null>(null)

  const loadTabData = useCallback((clientName: string) => {
    setTabLoading(true)
    fetch(`/api/platform/client-tabs?clientName=${encodeURIComponent(clientName)}`)
      .then(r => r.json())
      .then((d: {
        accountId?: number
        integrations?: PlatformIntegration[]
        reports?: PlatformReport[]
        comments?: PlatformComment[]
      }) => {
        setTabAccountId(d.accountId ?? null)
        setTabIntegrations(d.integrations || [])
        setTabReports(d.reports || [])
        setTabComments(d.comments || [])
      })
      .catch(() => {})
      .finally(() => setTabLoading(false))
  }, [])

  // ─── Load folder contents ───
  const loadFolderContents = useCallback((clientId: number, folderId: number | null) => {
    if (!folderId) {
      setFolderDocs([]); setFolderProjects([]); setFolderSheets([]); setFolderTasks([]); setMeetingDocs([])
      return
    }
    // Load meeting-note docs scoped to this client (mirrors the archived
    // /businesses behavior; the Meetings card in Assets reads from this).
    fetch(`/api/docs?client_id=${clientId}&doc_type=meeting-note`)
      .then(r => r.json())
      .then(docs => {
        if (Array.isArray(docs)) {
          setMeetingDocs(docs.map((d: { id: number; public_id?: string; title: string; created_at: number }) => ({
            id: d.id, public_id: d.public_id, title: d.title, created_at: d.created_at,
          })))
        } else {
          setMeetingDocs([])
        }
      })
      .catch(() => setMeetingDocs([]))
    fetch(`/api/clients?id=${clientId}&contents=1`).then(r => r.json()).then(d => {
      const c = d.contents
      if (c) {
        setFolderDocs(c.docs || [])
        setFolderProjects(c.projects || [])
        setFolderSheets(c.sheets || [])
        const projectIds = (c.projects || []).map((p: FolderProject) => p.id)
        if (projectIds.length > 0) {
          fetch('/api/tasks?all=1').then(r => r.json()).then(td => {
            const pidSet = new Set(projectIds)
            setFolderTasks((td.tasks || []).filter((t: Record<string, unknown>) => t.project_id && pidSet.has(t.project_id as number)).map((t: Record<string, unknown>) => ({
              id: t.id as number, title: t.title as string, status: t.status as string,
              priority: t.priority as string, project_id: t.project_id as number,
              project_name: t.project_name as string | undefined, project_color: t.project_color as string | undefined,
              due_date: t.due_date as string | undefined,
            })))
          }).catch(() => setFolderTasks([]))
        } else { setFolderTasks([]) }
      } else { setFolderDocs([]); setFolderProjects([]); setFolderSheets([]); setFolderTasks([]) }
    }).catch(() => {})
    fetch(`/api/docs?doc_type=meeting-note`).then(r => r.json()).then(docs => {
      if (Array.isArray(docs)) setMeetingDocs(docs.slice(0, 20).map((d: { id: number; public_id?: string; title: string; created_at: number }) => ({ id: d.id, public_id: d.public_id, title: d.title, created_at: d.created_at })))
    }).catch(() => setMeetingDocs([]))
  }, [])

  // ─── Load contacts for a client ───
  const loadContacts = useCallback((clientId: number) => {
    setContactsLoading(true)
    fetch(`/api/crm/contacts?client_id=${clientId}`).then(r => r.json()).then(d => {
      setContacts(d.contacts || [])
    }).catch(() => setContacts([])).finally(() => setContactsLoading(false))
  }, [])

  // Lazy-load the full CRM contacts list once when the Link Contact dropdown
  // is first opened — used to surface unlinked candidates for picking.
  const loadAllCrmContacts = useCallback(() => {
    fetch('/api/crm/contacts').then(r => r.json()).then(d => {
      setAllCrmContacts(d.contacts || [])
    }).catch(() => setAllCrmContacts([]))
  }, [])

  const linkCrmContact = useCallback(async (contactId: number) => {
    if (!selected) return
    const res = await fetch(`/api/crm/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_profile_id: selected.id }),
    })
    const d = await res.json().catch(() => ({}))
    if (d.contact) {
      setContacts(prev => [d.contact, ...prev])
      setAllCrmContacts(prev => prev.map(c => c.id === contactId ? d.contact : c))
    }
    setShowLinkContactDropdown(false)
  }, [selected])

  const unlinkCrmContact = useCallback(async (contactId: number) => {
    const res = await fetch(`/api/crm/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_profile_id: null }),
    })
    if (res.ok) {
      setContacts(prev => prev.filter(c => c.id !== contactId))
    }
  }, [])

  useEffect(() => {
    if (selected) {
      setActiveTab('profile')
      loadTabData(selected.name)
      loadFolderContents(selected.id, selected.folder_id)
      loadContacts(selected.id)
      setShowLinkContactDropdown(false)
    }
  }, [selected?.id, selected?.name, selected?.folder_id, loadTabData, loadFolderContents])

  // ─── Load Meta accounts + pages once ───
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

  // ─── Folder creation helpers ───
  const createDoc = async () => {
    if (!selected?.folder_id || !newItemName.trim()) return
    const res = await fetch('/api/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newItemName.trim(), folderId: selected.folder_id }) })
    const d = await res.json()
    setCreatingDoc(false); setNewItemName('')
    if (d.doc) { setFolderDocs(prev => [{ id: d.doc.id, public_id: d.doc.public_id, title: d.doc.title, updated_at: d.doc.updated_at }, ...prev]); window.open(`/doc/${d.doc.public_id || d.doc.id}`, '_blank') }
  }

  const createProject = async () => {
    if (!selected?.folder_id || !selected?.workspace_id || !newItemName.trim()) return
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newItemName.trim(), folderId: selected.folder_id, workspaceId: selected.workspace_id }) })
    const d = await res.json()
    setCreatingProject(false); setNewItemName('')
    if (d.project) setFolderProjects(prev => [...prev, { id: d.project.id, public_id: d.project.public_id, name: d.project.name, color: d.project.color, status: d.project.status }])
  }

  const createTask = async () => {
    if (!newItemName.trim() || !newTaskProjectId) return
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newItemName.trim(), project_id: newTaskProjectId, workspace_id: selected?.workspace_id, folder_id: selected?.folder_id, status: 'todo' }) })
    const d = await res.json()
    setCreatingTask(false); setNewItemName(''); setNewTaskProjectId(null)
    if (d.task) { const proj = folderProjects.find(p => p.id === newTaskProjectId); setFolderTasks(prev => [{ id: d.task.id, title: d.task.title, status: d.task.status || 'todo', priority: d.task.priority || 'medium', project_id: newTaskProjectId, project_name: proj?.name, project_color: proj?.color, due_date: d.task.due_date }, ...prev]) }
  }

  const createSheet = async () => {
    if (!selected?.folder_id || !newItemName.trim()) return
    const res = await fetch('/api/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_sheet', name: newItemName.trim(), folder_id: selected.folder_id, workspace_id: selected.workspace_id }) })
    const d = await res.json()
    setCreatingSheet(false); setNewItemName('')
    if (d.id) setFolderSheets(prev => [{ id: d.id, public_id: d.public_id, name: d.name || newItemName.trim() }, ...prev])
  }

  const saveContact = async () => {
    if (!contactForm.name.trim() || !selected) return
    setSavingContact(true)
    try {
      const res = await fetch('/api/crm/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...contactForm, client_profile_id: selected.id }) })
      const d = await res.json()
      if (d.contact) { setContacts(prev => [d.contact, ...prev]); setAddingContact(false); setContactForm({ name: '', email: '', phone: '' }) }
    } finally { setSavingContact(false) }
  }

  // ─── Detail View ───
  if (selected) {
    // Build the sidebar-compatible shape from the selected client
    const sidebarClient: ClientSidebarProfile = {
      id: selected.id,
      name: selected.name,
      slug: selected.slug,
      avatar_color: selected.avatar_color,
      avatar_url: selected.avatar_url,
      status: selected.status,
      monthly_budget: selected.monthly_budget,
      location: selected.location,
      website: selected.website,
      instagram_handle: selected.instagram_handle,
      tiktok_handle: selected.tiktok_handle,
      facebook_page: selected.facebook_page,
      crm_company_id: selected.crm_company_id ?? null,
    }

    const handleSidebarUpdated = (updated: ClientSidebarProfile) => {
      // Merge sidebar updates back into the full selected profile
      setSelected(prev => prev ? { ...prev, ...updated } : prev)
      setClients(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
    }

    const handleSidebarBack = () => {
      setSelected(null)
      setEditField(null)
      setBusinesses([])
      setShowLinkDropdown(false)
    }

    const handleSidebarDeleted = () => {
      setClients(prev => prev.filter(c => c.id !== selected.id))
      setSelected(null)
    }

    return (
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
        <input ref={bizAvatarRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f && uploadingBizIdRef.current) handleFileSelect(f, 'business', uploadingBizIdRef.current); e.target.value = '' }} />

        {/* ── LEFT SIDEBAR ── */}
        <ClientSummarySidebar
          client={sidebarClient}
          onBack={handleSidebarBack}
          onDeleted={handleSidebarDeleted}
          onUpdated={handleSidebarUpdated}
        />

        {/* ── RIGHT: TABS + CONTENT ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          <div style={{ overflowY: 'auto', flex: 1 }} className="no-scrollbar">
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 32px 48px' }}>

          {/* ─── Tab strip ─── */}
          <div style={{
            display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
            marginBottom: 28, marginTop: 0, overflowX: 'auto',
          }}>
            {([
              { id: 'profile', label: 'Profile' },
              { id: 'ai-context', label: 'AI Context' },
              { id: 'assets', label: 'Assets' },
              { id: 'ads', label: 'Ads' },
              { id: 'contacts', label: 'Contacts' },
              { id: 'integrations', label: 'Integrations' },
              { id: 'reports', label: 'Reports' },
              { id: 'comments', label: 'Comments' },
              ...(selected.qbo_customer_id ? [{ id: 'accounting', label: 'Accounting' }] : []),
            ] as { id: DetailTab; label: string }[]).map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  if (tab.id === 'contacts' && selected) loadContacts(selected.id)
                }}
                style={{
                  padding: '8px 16px', whiteSpace: 'nowrap',
                  background: 'transparent', border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                  color: activeTab === tab.id ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
                  cursor: 'pointer',
                  marginBottom: -1,
                  transition: 'color 120ms',
                }}
              >{tab.label}</button>
            ))}
          </div>

        {/* ─── Profile tab content ─── */}
        {activeTab === 'profile' && (
        <div>

        {/* ─── Website (reused when connecting tools) ─── */}
        <div className="editorial-section">
          <div className="editorial-section-inner px-4 py-3">
            <EditableField
              label="Website / primary domain"
              value={selected.website}
              placeholder="https://example.com"
              editing={editField === 'website'}
              editValue={editValue}
              onStartEdit={() => { setEditField('website'); setEditValue(selected.website || '') }}
              onEditChange={setEditValue}
              onSave={() => saveField('website', editValue)}
              onCancel={() => setEditField(null)}
              saving={saving}
            />
          </div>
        </div>

        {/* ─── Financial mapping (QBO) ─── */}
        <div className="editorial-section">
          <div className="editorial-section-inner">
            <QboMappingRow
              clientId={selected.id}
              clientName={selected.name}
              initialCustomerId={selected.qbo_customer_id}
            />
          </div>
        </div>

        {/* ─── Linked Businesses ─── */}
        <div className="editorial-section">
          <div className="editorial-section-inner">
            <button onClick={() => setExpandedSection(expandedSection === 'businesses' ? null : 'businesses')} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /></svg>
                <span className="text-[14px] font-semibold text-text">Businesses</span>
                {businesses.length > 0 && expandedSection !== 'businesses' && <span className="text-[11px] text-accent-text">{businesses.length}</span>}
              </div>
              <IconChevronDown size={16} className={`text-text-dim transition-transform ${expandedSection === 'businesses' ? 'rotate-180' : ''}`} />
            </button>
            {expandedSection === 'businesses' && (
              <div className="px-2 pb-3 border-t border-border pt-1 space-y-1">
                {businesses.map(biz => {
                  const bCfg = getStatusConfig(biz.status || 'active')
                  return (
                    <div key={biz.id} className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg hover:bg-hover group">
                      <span className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                        <div className="relative shrink-0 group/biz cursor-pointer" onClick={(e) => { e.preventDefault(); e.stopPropagation(); uploadingBizIdRef.current = biz.id; bizAvatarRef.current?.click() }}>
                          <Avatar name={biz.name} size={32} color={biz.avatar_color} src={biz.avatar_url || undefined} />
                          <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover/biz:opacity-100 transition-opacity flex items-center justify-center">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] text-text font-medium truncate block">{biz.name}</span>
                          <div className="flex items-center gap-2">
                            {biz.industry && <span className="text-[11px] text-text-dim">{biz.industry}</span>}
                            {biz.monthly_budget && <span className="text-[10px] text-accent-text">${biz.monthly_budget.toLocaleString()}/mo</span>}
                          </div>
                        </div>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: bCfg.color }} />
                        <IconChevronRight size={14} className="text-text-dim shrink-0" />
                      </span>
                      <button
                        onClick={() => { if (confirm(`Unlink ${biz.name}?`)) unlinkBusiness(biz.id) }}
                        className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 shrink-0 p-1 transition-opacity"
                        title="Unlink business"
                      >
                        <IconX size={14} />
                      </button>
                    </div>
                  )
                })}
                {businesses.length === 0 && (
                  <p className="px-3 py-3 text-[13px] text-text-dim">No businesses linked yet.</p>
                )}
                {/* Link Business button + dropdown */}
                <div className="relative px-1 pt-1">
                  <button
                    onClick={() => setShowLinkDropdown(!showLinkDropdown)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-border text-[13px] text-text-dim hover:text-accent-text hover:border-accent/40 transition-colors"
                  >
                    <IconPlus size={14} />
                    Link Business
                  </button>
                  {showLinkDropdown && (() => {
                    const linkedIds = new Set(businesses.map(b => b.id))
                    const unlinked = allBusinesses.filter(b => !linkedIds.has(b.id) && (b.client_id === 0 || !b.client_id))
                    return (
                      <div className="absolute left-1 right-1 top-full mt-1 glass-elevated rounded-lg p-1 max-h-[200px] overflow-y-auto z-50">
                        {unlinked.length === 0 ? (
                          <div className="px-2.5 py-1 text-[13px] text-text-dim">
                            No unlinked businesses available.
                          </div>
                        ) : (
                          unlinked.map(biz => (
                            <button key={biz.id} onClick={() => linkBusiness(biz.id)} className="w-full text-left px-2.5 py-1 rounded-md hover:bg-[rgba(255,255,255,0.06)] text-[13px] text-text truncate">
                              {biz.name}
                            </button>
                          ))
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Linked Contacts (CRM) ─── */}
        <div className="editorial-section">
          <div className="editorial-section-inner">
            <button onClick={() => setExpandedSection(expandedSection === 'linked-contacts' ? null : 'linked-contacts')} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
                <span className="text-[14px] font-semibold text-text">Contacts</span>
                {contacts.length > 0 && expandedSection !== 'linked-contacts' && <span className="text-[11px] text-accent-text">{contacts.length}</span>}
              </div>
              <IconChevronDown size={16} className={`text-text-dim transition-transform ${expandedSection === 'linked-contacts' ? 'rotate-180' : ''}`} />
            </button>
            {expandedSection === 'linked-contacts' && (
              <div className="px-2 pb-3 border-t border-border pt-1 space-y-1">
                {contacts.map(c => (
                  <div key={c.id} className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg hover:bg-hover group">
                    <a href={`/contacts?id=${c.public_id || c.id}`} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                      <Avatar name={c.name} size={32} color="#6b7280" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-text font-medium truncate block">{c.name}</span>
                        <div className="flex items-center gap-2">
                          {c.email && <span className="text-[11px] text-text-dim truncate">{c.email}</span>}
                          {!c.email && c.phone && <span className="text-[11px] text-text-dim">{c.phone}</span>}
                        </div>
                      </div>
                      <IconChevronRight size={14} className="text-text-dim shrink-0" />
                    </a>
                    <button
                      onClick={() => { if (confirm(`Unlink ${c.name}?`)) unlinkCrmContact(c.id) }}
                      className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 shrink-0 p-1 transition-opacity"
                      title="Unlink contact"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                ))}
                {contacts.length === 0 && (
                  <p className="px-3 py-3 text-[13px] text-text-dim">No contacts linked yet.</p>
                )}
                {/* Link Contact button + dropdown */}
                <div className="relative px-1 pt-1">
                  <button
                    onClick={() => {
                      if (!showLinkContactDropdown && allCrmContacts.length === 0) loadAllCrmContacts()
                      setShowLinkContactDropdown(!showLinkContactDropdown)
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-border text-[13px] text-text-dim hover:text-accent-text hover:border-accent/40 transition-colors"
                  >
                    <IconPlus size={14} />
                    Link Contact
                  </button>
                  {showLinkContactDropdown && (() => {
                    const linkedIds = new Set(contacts.map(c => c.id))
                    const unlinked = allCrmContacts.filter(c => !linkedIds.has(c.id))
                    return (
                      <div className="absolute left-1 right-1 top-full mt-1 glass-elevated rounded-lg p-1 max-h-[200px] overflow-y-auto z-50">
                        {unlinked.length === 0 ? (
                          <div className="px-2.5 py-1 text-[13px] text-text-dim">
                            No unlinked contacts available. <a href="/contacts" className="text-accent-text">Add one →</a>
                          </div>
                        ) : (
                          unlinked.map(c => (
                            <button key={c.id} onClick={() => linkCrmContact(c.id)} className="w-full text-left px-2.5 py-1 rounded-md hover:bg-[rgba(255,255,255,0.06)] text-[13px] text-text truncate">
                              {c.name}{c.email ? ` — ${c.email}` : ''}
                            </button>
                          ))
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Contact Info ─── */}
        <div className="editorial-section">
          <div className="editorial-section-inner">
            <button onClick={() => setExpandedSection(expandedSection === 'contacts' ? null : 'contacts')} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
                <span className="text-[14px] font-semibold text-text">Contacts & Notes</span>
                {(selected.contacts || selected.notes) && expandedSection !== 'contacts' && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
              </div>
              <IconChevronDown size={16} className={`text-text-dim transition-transform ${expandedSection === 'contacts' ? 'rotate-180' : ''}`} />
            </button>
            {expandedSection === 'contacts' && (
              <div className="px-4 pb-4 space-y-3 border-t border-border">
                <EditableField
                  label="Key Contacts"
                  value={selected.contacts}
                  placeholder="Owner: Name (phone), Manager: Name (email)..."
                  editing={editField === 'contacts'}
                  editValue={editValue}
                  onStartEdit={() => { setEditField('contacts'); setEditValue(selected.contacts || '') }}
                  onEditChange={setEditValue}
                  onSave={() => saveField('contacts', editValue)}
                  onCancel={() => setEditField(null)}
                  saving={saving}
                />
                <EditableField
                  label="Internal Notes"
                  value={selected.notes}
                  placeholder="Preferences, history, anything to remember..."
                  editing={editField === 'notes'}
                  editValue={editValue}
                  onStartEdit={() => { setEditField('notes'); setEditValue(selected.notes || '') }}
                  onEditChange={setEditValue}
                  onSave={() => saveField('notes', editValue)}
                  onCancel={() => setEditField(null)}
                  saving={saving}
                />
              </div>
            )}
          </div>
        </div>

        {/* ─── Status ─── */}
        <div className="editorial-section">
          <div className="editorial-section-inner">
            <button onClick={() => setExpandedSection(expandedSection === 'status' ? null : 'status')} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                <span className="text-[14px] font-semibold text-text">Status</span>
              </div>
              <IconChevronDown size={16} className={`text-text-dim transition-transform ${expandedSection === 'status' ? 'rotate-180' : ''}`} />
            </button>
            {expandedSection === 'status' && (
              <div className="px-4 pb-4 border-t border-border pt-3">
                <label className="text-[11px] text-text-dim uppercase tracking-wider">Client Status</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {STATUS_OPTIONS.map(s => (
                    <button
                      key={s.value}
                      onClick={() => saveField('status', s.value)}
                      className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${selected.status === s.value ? 'ring-2 ring-white/20' : 'opacity-60 hover:opacity-100'}`}
                      style={{ background: `${s.color}20`, color: s.color }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Client Portal ─── */}
        {portalLoaded && (
          <div className="editorial-section">
            <div className="editorial-section-inner">
              <button onClick={() => setExpandedSection(expandedSection === 'portal' ? null : 'portal')} className="w-full flex items-center justify-between px-4 py-3 text-left">
                <div className="flex items-center gap-2">
                  <svg className="w-[18px] h-[18px] text-accent-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
                  <span className="text-[14px] font-semibold text-text">Client Portal</span>
                  {portal && portal.enabled === 1 && expandedSection !== 'portal' && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                </div>
                <IconChevronDown size={16} className={`text-text-dim transition-transform ${expandedSection === 'portal' ? 'rotate-180' : ''}`} />
              </button>
              {expandedSection === 'portal' && (
                <div className="px-4 pb-4 border-t border-border">
                  {portal ? (
                    <div className="space-y-3 pt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-text">Portal active</span>
                        <button
                          onClick={() => togglePortal(portal.enabled !== 1)}
                          className={`relative w-10 rounded-full transition-colors ${portal.enabled === 1 ? 'bg-green-500' : 'bg-border'}`}
                          style={{ height: 22 }}
                        >
                          <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform ${portal.enabled === 1 ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      {portal.enabled === 1 && (
                        <>
                          <div>
                            <label className="text-[11px] text-text-dim uppercase tracking-wider">Portal Link</label>
                            <div className="flex items-center gap-2 mt-1">
                              <input type="text" readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/portal/${selected.slug}`} className="flex-1 glass-input px-2.5 py-2 rounded-lg text-[12px] text-text-dim" />
                              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/${selected.slug}`)} className="text-[11px] text-accent-text px-2 py-1.5 glass-btn rounded-lg">Copy</button>
                            </div>
                          </div>
                          {portal.magic_link_token && (
                            <div>
                              <label className="text-[11px] text-text-dim uppercase tracking-wider">Magic Link</label>
                              <div className="flex items-center gap-2 mt-1">
                                <input type="text" readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/portal/${selected.slug}?token=${portal.magic_link_token}`} className="flex-1 glass-input px-2.5 py-2 rounded-lg text-[12px] text-text-dim" />
                                <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/portal/${selected.slug}?token=${portal.magic_link_token}`)} className="text-[11px] text-accent-text px-2 py-1.5 glass-btn rounded-lg">Copy</button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 pt-3">
                      <p className="text-[13px] text-text-dim">Create a portal for this client. They&apos;ll see projects and docs from their linked businesses.</p>
                      <div>
                        <label className="text-[11px] text-text-dim uppercase tracking-wider">Password (optional)</label>
                        <input type="text" value={portalPassword} onChange={e => setPortalPassword(e.target.value)} className="w-full glass-input px-2.5 py-2 rounded-lg text-[13px] text-text mt-1" placeholder="Leave blank for open access" />
                      </div>
                      <button onClick={createPortal} className="w-full bg-accent text-white px-3 py-2 rounded-md text-[13px] font-medium active:scale-[0.98]">Create Portal</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        </div>
        )}{/* /profile tab */}

        {/* ─── Integrations tab ─── */}
        {activeTab === 'integrations' && (
          <div style={{ paddingBottom: 32 }}>
            {tabLoading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>Loading...</p>
            ) : tabAccountId === null ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
                  No platform account linked to this client yet.
                </p>
                <button
                  onClick={async () => {
                    if (!selected) return
                    const res = await fetch('/api/platform/accounts', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: selected.name }),
                    })
                    if (res.ok) loadTabData(selected.name)
                  }}
                  style={{
                    background: 'var(--accent)', color: 'var(--accent-fg)',
                    border: 'none', borderRadius: 8, padding: '8px 18px',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Set up platform reporting
                </button>
              </div>
            ) : tabIntegrations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>No integrations connected yet.</p>
                <a
                  href={`/platform/connect?accountId=${tabAccountId}`}
                  style={{
                    display: 'inline-block',
                    background: 'var(--accent)', color: 'var(--accent-fg)',
                    borderRadius: 8, padding: '8px 18px',
                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                  }}
                >
                  Connect integrations
                </a>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tabIntegrations.map(intg => {
                  const healthColor: Record<string, string> = {
                    green: '#22c55e', yellow: '#f59e0b', red: '#ef4444',
                  }
                  const dotColor = intg.last_health_status
                    ? (healthColor[intg.last_health_status] ?? '#9ca3af')
                    : intg.status === 'connected' ? '#22c55e' : '#9ca3af'
                  const syncedAgo = intg.last_synced_at
                    ? formatRelativeTime(intg.last_synced_at)
                    : 'Never synced'
                  return (
                    <div key={intg.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                          {intg.display_name || PROVIDER_LABELS[intg.provider] || intg.provider}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{syncedAgo}</div>
                      </div>
                      <a
                        href={`/platform/connect?accountId=${tabAccountId}&provider=${intg.provider}`}
                        style={{ fontSize: 11, color: 'var(--accent-text)', textDecoration: 'none' }}
                        title="Reconnect"
                      >
                        Refresh
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Reports tab ─── */}
        {activeTab === 'reports' && (
          <div style={{ paddingBottom: 32 }}>
            {tabLoading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>Loading...</p>
            ) : tabAccountId === null ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
                  No platform account linked yet. Set up reporting first.
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <a
                    href={`/platform/reports?accountId=${tabAccountId}`}
                    style={{
                      fontSize: 12, fontWeight: 600,
                      background: 'var(--accent)', color: 'var(--accent-fg)',
                      borderRadius: 6, padding: '6px 14px', textDecoration: 'none',
                    }}
                  >
                    Generate new report
                  </a>
                </div>
                {tabReports.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0' }}>
                    No reports yet.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tabReports.map(r => {
                      const statusColor: Record<string, string> = {
                        published: '#22c55e', draft: '#9ca3af', archived: '#6b7280',
                      }
                      const sColor = statusColor[r.status] ?? '#9ca3af'
                      return (
                        <div key={r.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 14px', borderRadius: 8,
                          border: '1px solid var(--border)', background: 'var(--bg-surface)',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{r.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.period_start} to {r.period_end}</div>
                          </div>
                          <span style={{
                            fontSize: 10, fontFamily: 'var(--font-mono)',
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                            padding: '2px 8px', borderRadius: 99,
                            background: `${sColor}20`, color: sColor,
                          }}>{r.status}</span>
                          <a
                            href={`/platform/reports/${r.id}`}
                            style={{ fontSize: 12, color: 'var(--accent-text)', textDecoration: 'none', fontWeight: 500 }}
                          >
                            Open
                          </a>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── Comments tab ─── */}
        {activeTab === 'comments' && (
          <div style={{ paddingBottom: 32 }}>
            {tabLoading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>Loading...</p>
            ) : tabComments.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', padding: '32px 0' }}>
                No comments yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tabComments.map(c => (
                  <div key={c.id} style={{
                    padding: '12px 14px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg-surface)',
                  }}>
                    <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, marginBottom: 6 }}>
                      {c.body.length > 200 ? `${c.body.slice(0, 200)}...` : c.body}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      <span>{c.report_name}</span>
                      {c.section_title && <><span>·</span><span>{c.section_title}</span></>}
                      {c.author_name && <><span>·</span><span>{c.author_name}</span></>}
                      <span>·</span>
                      <span>{formatRelativeTime(c.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'accounting' && (
          <div style={{ paddingBottom: 32 }}>
            <AccountingTab clientId={selected.id} />
          </div>
        )}

        {/* ─── AI Context tab ─── */}
        {activeTab === 'ai-context' && (() => {
          const aiFields = ['context', 'brand_voice', 'target_audience', 'goals', 'offer', 'offer_details'] as const
          const filled = aiFields.filter(f => selected[f as keyof ClientProfile]).length
          return (
            <div style={{ maxWidth: 720, paddingBottom: 40 }}>
              {/* Context Health strip */}
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
                const isFilled = !!(selected[key as keyof ClientProfile])
                return (
                  <div key={key} style={{ padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: isFilled ? 'var(--text-secondary)' : 'var(--text-dim)' }}>{label}</span>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: isFilled ? 'var(--accent)' : 'transparent', border: isFilled ? 'none' : '1px solid var(--border-strong)' }} />
                    </div>
                    <textarea
                      key={`${selected.id}-${key}`}
                      defaultValue={(selected[key as keyof ClientProfile] as string) || ''}
                      placeholder={placeholder}
                      onBlur={e => { if (e.target.value !== ((selected[key as keyof ClientProfile] as string) || '')) saveField(key, e.target.value || null) }}
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
            {!selected.folder_id && (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>No folder linked to this client yet. Folder is created automatically when a workspace is set.</p>
              </div>
            )}
            {selected.folder_id && (
              <>
                {/* Projects + Docs 2-col */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Projects</span>
                        {folderProjects.length > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>{folderProjects.length}</span>}
                      </div>
                      <button onClick={() => setCreatingProject(true)} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>
                    </div>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {folderProjects.length === 0 && !creatingProject && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No projects yet</div>}
                      {folderProjects.map(p => (
                        <a key={p.id} href={`/project/${p.public_id || p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
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
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Docs</span>
                        {folderDocs.length > 0 && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)' }}>{folderDocs.length}</span>}
                      </div>
                      <button onClick={() => setCreatingDoc(true)} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>+ New</button>
                    </div>
                    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {folderDocs.length === 0 && !creatingDoc && <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', opacity: 0.5 }}>No docs yet</div>}
                      {folderDocs.map(d => (
                        <a key={d.id} href={`/doc/${d.public_id || d.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', textDecoration: 'none', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
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
                        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: folderSheets.length > 0 ? '1px solid var(--border)' : undefined }}>
                          <input autoFocus type="text" placeholder="Database name" value={newItemName} onChange={e => setNewItemName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createSheet()} className="glass-input" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, color: 'var(--text)' }} />
                          <button onClick={createSheet} style={{ fontSize: 11, color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}>Add</button>
                          <button onClick={() => { setCreatingSheet(false); setNewItemName('') }} style={{ fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                        </div>
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
              {metaConnected && selected.ad_account_id && (
                <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${selected.ad_account_id.replace('act_', '')}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-text)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}>
                  Open Ads Manager <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              )}
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
                      style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 15, fontFamily: 'var(--font-mono)', color: 'var(--accent-text)', outline: 'none', fontWeight: 700, transition: 'border-color 0.15s' }}
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
                <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>No contacts linked to this client yet.</p>
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
                        <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{c.name}</td>
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

        </div>{/* /editorial container */}
        </div>{/* /scroll wrapper */}
        </div>{/* /right column */}

        {/* Crop Modal (detail view) */}
        {cropImage && (
          <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center" onClick={() => setCropImage(null)}>
            <div className="bg-elevated rounded-xl border border-border shadow-2xl p-5 w-[340px]" onClick={e => e.stopPropagation()}>
              <h3 className="text-[15px] font-semibold text-text mb-3">Adjust Photo</h3>
              <div
                className="relative w-[300px] h-[300px] rounded-lg overflow-hidden bg-black mx-auto border border-border"
                onMouseDown={e => {
                  dragRef.current = { startX: e.clientX, startY: e.clientY, origX: cropOffset.x, origY: cropOffset.y }
                  const onMove = (ev: MouseEvent) => { if (!dragRef.current) return; setCropOffset({ x: dragRef.current.origX + (ev.clientX - dragRef.current.startX), y: dragRef.current.origY + (ev.clientY - dragRef.current.startY) }) }
                  const onUp = () => { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
                }}
                style={{ cursor: 'grab' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={cropImgRef} src={cropImage.src} alt="" className="absolute select-none pointer-events-none" style={{ width: `${100 * cropScale}%`, height: `${100 * cropScale}%`, objectFit: 'cover', left: `calc(50% - ${50 * cropScale}% + ${cropOffset.x}px)`, top: `calc(50% - ${50 * cropScale}% + ${cropOffset.y}px)` }} draggable={false} />
                <div className="absolute inset-0 border-2 border-white/30 rounded-lg pointer-events-none" />
              </div>
              <div className="flex items-center gap-3 mt-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim shrink-0"><circle cx="11" cy="11" r="8" /><path d="M8 11h6" /></svg>
                <input type="range" min="1" max="3" step="0.05" value={cropScale} onChange={e => setCropScale(Number(e.target.value))} className="flex-1 accent-accent" />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim shrink-0"><circle cx="11" cy="11" r="8" /><path d="M8 11h6M11 8v6" /></svg>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setCropImage(null)} className="flex-1 glass-btn px-3 py-2 rounded-md text-[14px] text-text-dim">Cancel</button>
                <button onClick={cropAndUpload} className="flex-1 bg-accent text-white px-3 py-2 rounded-md text-[14px] font-medium active:scale-[0.98]">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Card Grid View ───
  return (
    <div className="h-full overflow-y-auto pb-28">
      <PageHeader
        title="Clients"
        count={clients.length}
        action={{
          label: 'New Client',
          icon: <IconPlus size={14} />,
          onClick: () => setCreating(true),
        }}
      />

      {creating && (
        <div className="mx-6 mb-6 animate-float-up" style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>New Client</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input type="text" placeholder="Client name" value={newName} onChange={e => setNewName(e.target.value)} className="glass-input" style={{ padding: '8px 12px', borderRadius: 8, fontSize: 14, color: 'var(--text)', width: '100%' }} autoFocus />
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
              <button onClick={() => { setCreating(false); setNewName('') }} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={createClient} disabled={!newName.trim() || saving} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                opacity: (!newName.trim() || saving) ? 0.5 : 1,
              }}>{saving ? 'Creating...' : 'Add Client'}</button>
            </div>
          </div>
        </div>
      )}

      {clients.length === 0 && !creating && (
        <div className="clients-empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4a5155" strokeWidth="1.3" className="mb-4">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <p className="clients-empty-title">No clients yet</p>
          <p className="clients-empty-sub">Add your first client to track businesses, contacts, and portal access.</p>
          <button onClick={() => setCreating(true)} className="clients-empty-cta">
            <IconPlus size={13} />
            Add Client
          </button>
        </div>
      )}

      {/* Editorial roster — list, not cards. Each client = one row. */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 32px 80px' }}>
        {/* Section chrome — search · count · add */}
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
              placeholder="Search clients"
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
                ? clients.filter(c => {
                    const q = search.toLowerCase()
                    return c.name.toLowerCase().includes(q)
                      || (c.industry || '').toLowerCase().includes(q)
                      || (c.contacts || '').toLowerCase().includes(q)
                  }).length
                : clients.length
              return `${filteredCount} ${filteredCount === 1 ? 'client' : 'clients'}`
            })()}
          </span>
          {clients.length > 0 && !creating && (
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

        {clients.filter(c => {
          if (!search.trim()) return true
          const q = search.toLowerCase()
          const linkedNames = allBusinesses.filter(b => b.client_id === c.id).map(b => b.name.toLowerCase())
          return c.name.toLowerCase().includes(q)
            || (c.industry || '').toLowerCase().includes(q)
            || (c.contacts || '').toLowerCase().includes(q)
            || linkedNames.some(n => n.includes(q))
        }).map(client => {
          const sCfg = getStatusConfig(client.status || 'active')
          const linkedBiz = allBusinesses.filter(b => b.client_id === client.id) as (AllBusiness & { avatar_color?: string; monthly_budget?: number | null })[]
          const contactLine = client.contacts ? client.contacts.split('\n')[0] : null
          const totalMRR = linkedBiz.reduce((s, b) => s + (b.monthly_budget || 0), 0)
          const enrich = enrichmentMap.get(client.id)
          const healthColors: Record<HealthStatus, string> = {
            green: '#22c55e', amber: '#f59e0b', red: '#ef4444', gray: 'var(--text-muted)',
          }
          const healthColor = enrichmentLoading ? 'var(--text-muted)' : healthColors[enrich?.health ?? 'gray']
          const lastReport = (() => {
            if (!enrich?.lastReportPeriodEnd) return null
            const d = new Date(enrich.lastReportPeriodEnd)
            if (isNaN(d.getTime())) return null
            return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
          })()
          return (
            <button
              key={client.id}
              onClick={() => selectClient(client)}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px minmax(0, 1.4fr) minmax(0, 1fr) auto auto auto auto',
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
              <div style={{ width: 40, height: 40, position: 'relative', flexShrink: 0 }}>
                {client.avatar_url ? (
                  <img src={client.avatar_url} alt=""
                    style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', objectPosition: 'center top' }} />
                ) : (
                  <Avatar name={client.name} size={40} color={client.avatar_color} />
                )}
              </div>

              {/* Name · industry */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 500, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '-0.005em',
                }}>{client.name}</div>
                {(client.industry || contactLine) && (
                  <div style={{
                    fontSize: 11, color: 'var(--text-dim)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}>
                    {client.industry || contactLine}
                  </div>
                )}
              </div>

              {/* Linked businesses — quiet list, no chips */}
              <div style={{
                minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: 'var(--text-dim)',
                whiteSpace: 'nowrap', overflow: 'hidden',
              }}>
                {linkedBiz.length > 0 ? (
                  <>
                    <div style={{ display: 'flex', marginRight: 2 }}>
                      {linkedBiz.slice(0, 3).map((b, i) => (
                        <span key={b.id} style={{
                          display: 'inline-block',
                          width: 16, height: 16, borderRadius: '50%',
                          background: b.avatar_color || 'var(--text-muted)',
                          border: '2px solid var(--bg)',
                          marginLeft: i === 0 ? 0 : -6,
                        }} />
                      ))}
                    </div>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {linkedBiz.slice(0, 2).map(b => b.name).join(', ')}
                      {linkedBiz.length > 2 && <span style={{ color: 'var(--text-muted)' }}> +{linkedBiz.length - 2}</span>}
                    </span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                )}
              </div>

              {/* MRR — right-aligned mono tight */}
              <div style={{
                fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"',
                textAlign: 'right', minWidth: 88,
              }}>
                {totalMRR > 0 ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                      ${totalMRR.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      /mo
                    </div>
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                )}
              </div>

              {/* Integrations — "6 / 10" */}
              <div style={{
                fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"',
                fontSize: 11, color: 'var(--text-dim)', textAlign: 'right', minWidth: 46,
              }}>
                {enrichmentLoading ? (
                  <span style={{ color: 'var(--text-muted)' }}>...</span>
                ) : (
                  <span>
                    <span style={{ color: enrich && enrich.connectedCount > 0 ? 'var(--text)' : 'var(--text-muted)' }}>
                      {enrich?.connectedCount ?? 0}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}> / {enrich?.totalAvailable ?? 10}</span>
                  </span>
                )}
              </div>

              {/* Last report */}
              <div style={{
                fontSize: 11, textAlign: 'right', minWidth: 62,
                whiteSpace: 'nowrap',
              }}>
                {enrichmentLoading ? (
                  <span style={{ color: 'var(--text-muted)' }}>...</span>
                ) : lastReport ? (
                  <span style={{ color: 'var(--text-dim)' }}>{lastReport}</span>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Never</span>
                )}
              </div>

              {/* Health dot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', minWidth: 90 }}>
                <span
                  title={enrich?.health ?? 'gray'}
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: healthColor, flexShrink: 0,
                    transition: 'background 300ms',
                  }}
                />
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
        {clients.length > 0 && !creating && (
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
            <span>Add client</span>
          </button>
        )}
      </div>

      {/* Crop Modal */}
      {cropImage && (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center" onClick={() => setCropImage(null)}>
          <div className="bg-elevated rounded-xl border border-border shadow-2xl p-5 w-[340px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-text mb-3">Adjust Photo</h3>
            <div
              className="relative w-[300px] h-[300px] rounded-lg overflow-hidden bg-black mx-auto border border-border"
              onMouseDown={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                dragRef.current = { startX: e.clientX, startY: e.clientY, origX: cropOffset.x, origY: cropOffset.y }
                const onMove = (ev: MouseEvent) => {
                  if (!dragRef.current) return
                  setCropOffset({
                    x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
                    y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
                  })
                }
                const onUp = () => { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
              style={{ cursor: 'grab' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={cropImgRef}
                src={cropImage.src}
                alt=""
                className="absolute select-none pointer-events-none"
                style={{
                  width: `${100 * cropScale}%`,
                  height: `${100 * cropScale}%`,
                  objectFit: 'cover',
                  left: `calc(50% - ${50 * cropScale}% + ${cropOffset.x}px)`,
                  top: `calc(50% - ${50 * cropScale}% + ${cropOffset.y}px)`,
                }}
                draggable={false}
              />
              {/* 1:1 crop guide overlay */}
              <div className="absolute inset-0 border-2 border-white/30 rounded-lg pointer-events-none" />
              <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' }} />
            </div>
            {/* Zoom slider */}
            <div className="flex items-center gap-3 mt-3">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim shrink-0"><circle cx="11" cy="11" r="8" /><path d="M8 11h6" /></svg>
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={cropScale}
                onChange={e => setCropScale(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim shrink-0"><circle cx="11" cy="11" r="8" /><path d="M8 11h6M11 8v6" /></svg>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCropImage(null)} className="flex-1 glass-btn px-3 py-2 rounded-md text-[14px] text-text-dim">Cancel</button>
              <button onClick={cropAndUpload} className="flex-1 bg-accent text-white px-3 py-2 rounded-md text-[14px] font-medium active:scale-[0.98]">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ───

const PROVIDER_LABELS: Record<string, string> = {
  gsc: 'Google Search Console',
  ga4: 'Google Analytics 4',
  pagespeed: 'PageSpeed Insights',
  se_ranking: 'SE Ranking',
  wordpress: 'WordPress',
  gravity_forms: 'Gravity Forms',
  asana: 'Asana',
  everhour: 'Everhour',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
}

function formatRelativeTime(unixSecs: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - unixSecs
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  const d = new Date(unixSecs * 1000)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

function EditableField({ label, value, placeholder, editing, editValue, onStartEdit, onEditChange, onSave, onCancel, saving }: {
  label: string; value: string | null; placeholder: string; editing: boolean; editValue: string
  onStartEdit: () => void; onEditChange: (v: string) => void; onSave: () => void; onCancel: () => void; saving: boolean
}) {
  if (editing) {
    return (
      <div className="space-y-2 pt-2 animate-float-up">
        <label className="text-[12px] font-medium text-text-dim uppercase tracking-wider">{label}</label>
        <textarea value={editValue} onChange={e => onEditChange(e.target.value)} className="w-full glass-input px-3 py-2 rounded-md text-[14px] text-text min-h-[100px] resize-none" placeholder={placeholder} autoFocus />
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 glass-btn px-3 py-2 rounded-md text-[13px] text-text-dim">Cancel</button>
          <button onClick={onSave} disabled={saving} className="flex-1 bg-accent text-white px-3 py-2 rounded-md text-[13px] font-medium disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    )
  }
  const displayVal = value && value.trim() ? value : null
  return (
    <button onClick={onStartEdit} className="w-full flex items-center justify-between py-2.5 text-left group">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-text-dim uppercase tracking-wider mb-0.5">{label}</div>
        {displayVal ? <p className="text-[14px] text-text leading-relaxed whitespace-pre-wrap line-clamp-3">{displayVal}</p> : <p className="text-[13px] text-text-dim/40 italic">{placeholder}</p>}
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim/30 group-hover:text-text-dim shrink-0 ml-2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
    </button>
  )
}
