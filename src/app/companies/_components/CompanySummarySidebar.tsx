'use client'

// CompanySummarySidebar — sidebar for /companies detail view.
// Mirrors ClientSummarySidebar field-for-field. Saves via PATCH /api/crm/companies/[id].
// Replaces "Linked CRM Company" block with "Promote to Client" CTA.

import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { AVATAR_COLORS, STATUS_OPTIONS } from '@/lib/client-business-constants'
import { Dropdown } from '@/components/ui/Dropdown'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompanySidebarProfile {
  id: number
  public_id: string
  name: string
  avatar_color: string
  avatar_url: string | null
  status: string
  monthly_budget: number | null
  location: string | null
  website: string | null
  instagram_handle: string | null
  tiktok_handle: string | null
  facebook_page: string | null
  client_profile_slug: string | null
  // client name if already promoted (fetched by parent)
  client_profile_name?: string | null
}

interface Props {
  company: CompanySidebarProfile
  onBack: () => void
  onDeleted: () => void
  onUpdated: (updated: CompanySidebarProfile) => void
  onPromoted: (clientSlug: string) => void
}

// ─── Style tokens ─────────────────────────────────────────────────────────────

const LABEL: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)',
}

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  width: '100%', padding: '5px 0', background: 'none', border: 'none',
  cursor: 'pointer', textAlign: 'left',
}

const VALUE: React.CSSProperties = {
  fontSize: 12, color: 'var(--text)', textAlign: 'right',
  maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

function getStatusConfig(status: string) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]
}

// ─── Avatar color picker ──────────────────────────────────────────────────────

function AvatarColorPicker({ current, onChange }: { current: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Change avatar color"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'block' }}
      >
        <span style={{
          display: 'block', width: 8, height: 8, borderRadius: '50%',
          background: current,
          boxShadow: `0 0 0 2px var(--bg-chrome), 0 0 0 3px ${current}55`,
          position: 'absolute', bottom: 0, right: 0,
          transition: 'transform 120ms',
        }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 80,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 10,
          display: 'grid', gridTemplateColumns: 'repeat(5, 22px)', gap: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}>
          {AVATAR_COLORS.map(c => (
            <button key={c} onClick={() => { onChange(c); setOpen(false) }} style={{
              width: 22, height: 22, borderRadius: '50%', background: c, border: 'none',
              cursor: 'pointer',
              outline: c === current ? `2px solid ${c}` : 'none',
              outlineOffset: 2,
              transform: c === current ? 'scale(1.18)' : 'scale(1)',
              transition: 'transform 120ms',
            }} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Delete confirm modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  companyName, onConfirm, onCancel, deleting,
}: {
  companyName: string
  onConfirm: () => void
  onCancel: () => void
  deleting: boolean
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '24px 24px 20px', width: 340,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
          Delete {companyName}?
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 20 }}>
          All contacts, opportunities, and activity for this company will be permanently removed.
          This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
              background: 'var(--status-overdue, #ef4444)',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Promote to Client CTA block ──────────────────────────────────────────────

function PromoteBlock({
  company,
  onPromoted,
}: {
  company: CompanySidebarProfile
  onPromoted: (clientSlug: string) => void
}) {
  const [promoting, setPromoting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (company.client_profile_slug) {
    return (
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ ...LABEL, marginBottom: 8 }}>Graduation</div>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
          Already promoted to a client.
        </p>
        <a
          href={`/clients/${company.client_profile_slug}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 12, color: 'var(--accent-text)', textDecoration: 'none',
            fontWeight: 500,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none' }}
        >
          {company.client_profile_name ? `View ${company.client_profile_name}` : 'View as Client'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    )
  }

  const handlePromote = async () => {
    setPromoting(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/companies/${company.public_id}/promote`, { method: 'POST' })
      const d = await res.json() as { client?: { slug: string }; error?: string }
      if (d.client?.slug) {
        onPromoted(d.client.slug)
      } else {
        setError(d.error ?? 'Promotion failed.')
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ ...LABEL, marginBottom: 8 }}>Graduation</div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
        When this company becomes a paying client, promote it to unlock Platform tabs (Integrations, Reports, Accounting).
      </p>
      <button
        onClick={handlePromote}
        disabled={promoting}
        style={{
          width: '100%', padding: '8px 0', borderRadius: 8,
          background: 'var(--accent)', border: 'none',
          color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          opacity: promoting ? 0.6 : 1,
          transition: 'opacity 120ms',
        }}
      >
        {promoting ? 'Promoting…' : 'Promote to Client'}
      </button>
      {error && (
        <p style={{ fontSize: 11, color: 'var(--status-overdue, #ef4444)', marginTop: 8 }}>{error}</p>
      )}
    </div>
  )
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function CompanySummarySidebar({ company, onBack, onDeleted, onUpdated, onPromoted }: Props) {
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const statusCfg = getStatusConfig(company.status || 'active')

  // ─── Persist a single field via PATCH /api/crm/companies/[id] ────────────

  const saveField = async (field: string, value: string | number | null) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/crm/companies/${company.public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      const d = await res.json() as { company?: CompanySidebarProfile }
      if (d.company) onUpdated(d.company as CompanySidebarProfile)
    } finally {
      setEditField(null)
      setSaving(false)
    }
  }

  // ─── Delete flow ─────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await fetch(`/api/crm/companies/${company.public_id}`, { method: 'DELETE' })
      onDeleted()
    } finally {
      setDeleting(false)
      setShowDeleteModal(false)
    }
  }

  // ─── Shared row renderer ─────────────────────────────────────────────────

  const SidebarRow = ({
    field, labelText, displayNode, inputType = 'text',
  }: {
    field: string
    labelText: string
    displayNode: React.ReactNode
    inputType?: 'text' | 'number' | 'url'
  }) => {
    if (editField === field) {
      return (
        <input
          type={inputType}
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => {
            const v = inputType === 'number'
              ? (editValue ? Number(editValue) : null)
              : (editValue.trim() || null)
            saveField(field, v)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const v = inputType === 'number'
                ? (editValue ? Number(editValue) : null)
                : (editValue.trim() || null)
              saveField(field, v)
            }
            if (e.key === 'Escape') setEditField(null)
          }}
          className="glass-input"
          style={{
            width: '100%', padding: '5px 8px', borderRadius: 6,
            fontSize: 12, color: 'var(--text)', marginBottom: 4,
          }}
          placeholder={labelText}
          disabled={saving}
        />
      )
    }
    return (
      <button
        style={ROW}
        onClick={() => {
          setEditField(field)
          setEditValue(String((company as unknown as Record<string, unknown>)[field] ?? ''))
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
      >
        <span style={LABEL}>{labelText}</span>
        {displayNode}
      </button>
    )
  }

  return (
    <>
      {showDeleteModal && (
        <DeleteConfirmModal
          companyName={company.name}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteModal(false)}
          deleting={deleting}
        />
      )}

      <div style={{
        width: 264, minWidth: 264, maxWidth: 264,
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-chrome)', overflow: 'hidden',
        flexShrink: 0,
      }}>

        {/* ── Crumb row: < Companies · Delete ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 16px 8px', flexShrink: 0,
        }}>
          <button
            onClick={onBack}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none', padding: '4px 2px',
              color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Companies
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setShowDeleteModal(true)}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', fontSize: 11,
              padding: '4px 6px', cursor: 'pointer', borderRadius: 4,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--status-overdue, #ef4444)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
            title="Delete company"
          >
            Delete
          </button>
        </div>

        {/* ── Identity block ── */}
        <div style={{
          padding: '8px 20px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {/* Avatar — wraps color picker */}
          <div style={{ marginBottom: 12, position: 'relative', display: 'inline-block' }}>
            <Avatar
              name={company.name}
              size={56}
              color={company.avatar_color}
              src={company.avatar_url || undefined}
            />
            <AvatarColorPicker
              current={company.avatar_color}
              onChange={c => saveField('avatar_color', c)}
            />
          </div>

          {/* Eyebrow */}
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--text-muted)', marginBottom: 4,
          }}>
            Company
          </div>

          {/* Name */}
          <div style={{
            fontSize: 20, fontWeight: 600, color: 'var(--text)',
            letterSpacing: '-0.015em', lineHeight: 1.2, marginBottom: 10,
          }}>
            {company.name}
          </div>

          {/* Status pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: company.monthly_budget ? 12 : 0,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: statusCfg.color, flexShrink: 0,
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--text-dim)',
            }}>
              {statusCfg.label}
            </span>
          </div>

          {/* Budget headline */}
          {company.monthly_budget ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{
                fontSize: 18, fontWeight: 500, fontFamily: 'var(--font-mono)',
                color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1,
                fontFeatureSettings: '"tnum"',
              }}>
                ${company.monthly_budget.toLocaleString()}
              </span>
              <span style={{
                fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>
                /mo
              </span>
            </div>
          ) : null}
        </div>

        {/* ── Scrollable facts ── */}
        <div style={{ flex: 1, overflowY: 'auto' }} className="no-scrollbar">

          {/* ACCOUNT section */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ ...LABEL, marginBottom: 8 }}>Account</div>

            {/* Budget */}
            <SidebarRow
              field="monthly_budget"
              labelText="Budget"
              inputType="number"
              displayNode={
                company.monthly_budget ? (
                  <span style={{
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: 'var(--accent-text)',
                  }}>
                    ${company.monthly_budget.toLocaleString()}
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-dim)' }}>/mo</span>
                  </span>
                ) : (
                  <span style={{ ...VALUE, color: 'var(--text-dim)', opacity: 0.4 }}>—</span>
                )
              }
            />

            {/* Status — inline dropdown */}
            {editField === 'status' ? (
              <div style={{ marginBottom: 4 }}>
                <Dropdown
                  value={editValue}
                  onChange={v => { setEditValue(v); saveField('status', v) }}
                  options={STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label }))}
                  triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded px-2 py-1.5 text-[12px] text-text inline-flex items-center gap-1.5 cursor-pointer w-full mt-1"
                  minWidth={140}
                />
              </div>
            ) : (
              <button
                style={ROW}
                onClick={() => { setEditField('status'); setEditValue(company.status || 'active') }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.7' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                <span style={LABEL}>Status</span>
                <span style={{ ...VALUE, color: statusCfg.color }}>{statusCfg.label}</span>
              </button>
            )}

            {/* Location */}
            <SidebarRow
              field="location"
              labelText="Location"
              displayNode={
                <span style={{
                  ...VALUE,
                  color: company.location ? 'var(--text)' : 'var(--text-dim)',
                  opacity: company.location ? 1 : 0.4,
                }}>
                  {company.location || '—'}
                </span>
              }
            />

            {/* Website */}
            <SidebarRow
              field="website"
              labelText="Website"
              inputType="url"
              displayNode={
                <span style={{
                  ...VALUE,
                  color: company.website ? 'var(--accent-text)' : 'var(--text-dim)',
                  opacity: company.website ? 1 : 0.4,
                }}>
                  {company.website ? company.website.replace(/^https?:\/\//, '') : '—'}
                </span>
              }
            />
          </div>

          {/* SOCIAL section */}
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ ...LABEL, marginBottom: 10 }}>Social</div>
            {([
              {
                key: 'instagram_handle',
                placeholder: '@handle',
                icon: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                ),
                url: (h: string) => `https://instagram.com/${h.replace('@', '')}`,
              },
              {
                key: 'tiktok_handle',
                placeholder: '@handle',
                icon: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.93a8.22 8.22 0 004.79 1.52V7.01a4.85 4.85 0 01-1.02-.32z" />
                  </svg>
                ),
                url: (h: string) => `https://tiktok.com/@${h.replace('@', '')}`,
              },
              {
                key: 'facebook_page',
                placeholder: 'Page name',
                icon: (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                ),
                url: (h: string) => `https://facebook.com/${h}`,
              },
            ] as { key: string; placeholder: string; icon: React.ReactNode; url: (h: string) => string }[]).map(
              ({ key, placeholder, icon, url }) => {
                const socialMap: Record<string, string | null> = {
                  instagram_handle: company.instagram_handle,
                  tiktok_handle: company.tiktok_handle,
                  facebook_page: company.facebook_page,
                }
                const val = socialMap[key] ?? null
                return editField === key ? (
                  <input
                    key={key}
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => saveField(key, editValue.trim() || null)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveField(key, editValue.trim() || null)
                      if (e.key === 'Escape') setEditField(null)
                    }}
                    className="glass-input"
                    style={{
                      width: '100%', padding: '5px 8px', borderRadius: 6,
                      fontSize: 12, color: 'var(--text)', marginBottom: 6,
                    }}
                    placeholder={placeholder}
                    disabled={saving}
                  />
                ) : (
                  <div
                    key={key}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', marginBottom: 2 }}
                  >
                    <span style={{
                      color: val ? 'var(--text-secondary)' : 'var(--text-muted)',
                      flexShrink: 0, display: 'flex',
                    }}>
                      {icon}
                    </span>
                    <button
                      style={{
                        flex: 1, background: 'none', border: 'none',
                        cursor: 'pointer', textAlign: 'left', padding: 0,
                      }}
                      onClick={() => { setEditField(key); setEditValue(val || '') }}
                    >
                      <span style={{ fontSize: 12, color: val ? 'var(--text)' : 'var(--text-muted)' }}>
                        {val || placeholder}
                      </span>
                    </button>
                    {val && (
                      <a
                        href={url(val)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: 'var(--text-muted)', display: 'flex',
                          flexShrink: 0, textDecoration: 'none', transition: 'color 120ms',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)' }}
                        onClick={e => e.stopPropagation()}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    )}
                  </div>
                )
              }
            )}
          </div>

          {/* PROMOTE TO CLIENT block */}
          <PromoteBlock company={company} onPromoted={onPromoted} />

        </div>
      </div>
    </>
  )
}
