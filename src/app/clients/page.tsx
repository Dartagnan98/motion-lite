'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { IconChevronDown, IconChevronRight, IconX, IconPlus } from '@/components/ui/Icons'
import { PageHeader } from '@/components/ui/PageHeader'
import { AVATAR_COLORS, STATUS_OPTIONS } from '@/lib/client-business-constants'

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
  folder_id: number | null
  workspace_id: number | null
  created_at: number
  updated_at: number
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

  // Portal
  const [portal, setPortal] = useState<{ id: number; enabled: number; magic_link_token: string | null } | null>(null)
  const [portalPassword, setPortalPassword] = useState('')
  const [portalLoaded, setPortalLoaded] = useState(false)

  const load = useCallback(() => {
    fetch('/api/clients').then(r => r.json()).then(d => setClients(d.profiles || [])).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

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

  // ─── Detail View ───
  if (selected) {
    const statusCfg = getStatusConfig(selected.status || 'active')

    return (
      <div className="h-full overflow-y-auto pb-28">
        <input ref={bizAvatarRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f && uploadingBizIdRef.current) handleFileSelect(f, 'business', uploadingBizIdRef.current); e.target.value = '' }} />

        <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 32px 48px' }}>
          {/* Crumb row — back · context · delete */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <button
              onClick={() => { setSelected(null); setEditField(null); setBusinesses([]); setShowLinkDropdown(false) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: 'none', padding: '4px 2px',
                color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              Clients
            </button>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => { if (confirm('Delete this client?')) deleteClient(selected.id) }}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--status-overdue)', fontSize: 12,
                padding: '4px 8px', cursor: 'pointer', borderRadius: 4,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklab, var(--status-overdue) 10%, transparent)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              Delete
            </button>
          </div>

          {/* Editorial header — left-aligned avatar + bio */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '72px 1fr',
            gap: 20, alignItems: 'center',
            paddingBottom: 24,
            borderBottom: '1px solid var(--border)',
            marginBottom: 32,
          }}>
            <button
              onClick={() => clientAvatarRef.current?.click()}
              style={{
                width: 72, height: 72, borderRadius: '50%', position: 'relative',
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                overflow: 'hidden',
              }}
              title="Change photo"
            >
              <Avatar name={selected.name} size={72} color={selected.avatar_color} src={selected.avatar_url || undefined} />
              <input ref={clientAvatarRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f && selected) handleFileSelect(f, 'client', selected.id); e.target.value = '' }} />
            </button>

            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)',
                marginBottom: 4,
              }}>
                Client
              </div>
              <h1 style={{
                fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em',
                color: 'var(--text)', lineHeight: 1.15, margin: 0,
              }}>{selected.name}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.color }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{statusCfg.label}</span>
                </div>
                {businesses.length > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {businesses.length} {businesses.length === 1 ? 'business' : 'businesses'}
                  </span>
                )}
                {totalBudget > 0 && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', fontFeatureSettings: '"tnum"' }}>
                    ${totalBudget.toLocaleString()}<span style={{ color: 'var(--text-muted)' }}>/mo</span>
                  </span>
                )}
              </div>
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
                      <a href={`/businesses?id=${biz.public_id || biz.id}`} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
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
                      </a>
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
                            No unlinked businesses available. <a href="/businesses" className="text-accent-text underline">Create one</a>
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
        </div>{/* /editorial container */}
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
          return (
            <button
              key={client.id}
              onClick={() => { setSelected(client); setExpandedSection('businesses') }}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px minmax(0, 1.4fr) minmax(0, 1fr) auto auto',
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

              {/* Status — dot + mono label */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                minWidth: 90, justifyContent: 'flex-end',
              }}>
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
