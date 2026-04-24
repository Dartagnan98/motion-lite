'use client'

import { useState, useCallback } from 'react'
import type { ProjectTemplate, TemplateStage, TemplateTaskDef, TemplateRole } from '@/lib/types'
import { StagePill } from '@/components/ui/StagePill'
import { TemplateEditor } from '@/components/project/TemplateEditor'

function safeParse<T>(json: string | undefined | null, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) } catch { return fallback }
}

const STAGE_COLORS = [
  '#4285f4', '#7b68ee', '#f06292', '#ef5350', '#ff9100',
  '#ffd740', '#66bb6a', '#00e676', '#26c6da', '#78909c',
]

const ROLE_COLORS = [
  '#4caf50', '#9c27b0', '#2196f3', '#ffc107', '#f44336',
  '#ff9800', '#00bcd4', '#e91e63',
]

export function TemplatesPage({ templates: initialTemplates }: { templates: ProjectTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingTemplate, setEditingTemplate] = useState<ProjectTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(search.toLowerCase())
      )
    : templates

  const handleCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled Template',
          stages: JSON.stringify([
            { name: 'To Do', color: '#4285f4', sort_order: 0 },
            { name: 'In Progress', color: '#ffd740', sort_order: 1 },
            { name: 'Done', color: '#66bb6a', sort_order: 2 },
          ]),
          default_tasks: '[]',
          roles: '[]',
        }),
      })
      const data = await res.json()
      setTemplates(prev => [...prev, data])
      setEditingTemplate(data)
    } finally {
      setCreating(false)
    }
  }, [creating])

  const handleAiGenerate = useCallback(async () => {
    if (aiGenerating || !aiDescription.trim()) return
    setAiGenerating(true)
    try {
      const res = await fetch('/api/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiDescription.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setTemplates(prev => [...prev, data])
      setShowAiModal(false)
      setAiDescription('')
      setEditingTemplate(data)
    } finally {
      setAiGenerating(false)
    }
  }, [aiGenerating, aiDescription])

  const handleDelete = useCallback(async (id: number) => {
    setDeleting(id)
    try {
      await fetch('/api/templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setTemplates(prev => prev.filter(t => t.id !== id))
    } finally {
      setDeleting(null)
    }
  }, [])

  const handleDuplicate = useCallback(async (t: ProjectTemplate) => {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${t.name} (copy)`,
        description: t.description,
        stages: t.stages,
        default_tasks: t.default_tasks,
        roles: t.roles,
      }),
    })
    const data = await res.json()
    setTemplates(prev => [...prev, data])
  }, [])

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div
        className="flex-shrink-0"
        style={{
          padding: '20px 32px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.3 }}>
              Project Templates
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '4px 0 0', opacity: 0.7 }}>
              Create reusable project structures with stages, tasks, roles, and variables
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAiModal(true)}
              className="flex items-center gap-2 transition-all"
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                color: '#c4b5fd',
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.18)'; e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.35)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.2)' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              AI Generate
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 transition-all"
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                color: '#fff',
                background: 'var(--green)',
                border: 'none',
                borderRadius: 8,
                cursor: creating ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: creating ? 0.6 : 1,
              }}
              onMouseEnter={e => { if (!creating) e.currentTarget.style.background = '#2fb82f' }}
              onMouseLeave={e => { if (!creating) e.currentTarget.style.background = 'var(--green)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {creating ? 'Creating...' : 'New Template'}
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: 360 }}>
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            style={{
              width: '100%',
              fontSize: 13,
              color: 'var(--text)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px 8px 32px',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>
      </div>

      {/* Template Grid */}
      <div
        className="flex-1 overflow-auto"
        style={{ padding: '24px 32px' }}
      >
        {filtered.length === 0 ? (
          <EmptyState
            hasTemplates={templates.length > 0}
            onCreate={handleCreate}
            onAiGenerate={() => setShowAiModal(true)}
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: 16,
            }}
          >
            {filtered.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={() => setEditingTemplate(t)}
                onDelete={() => handleDelete(t.id)}
                onDuplicate={() => handleDuplicate(t)}
                isDeleting={deleting === t.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Template Editor Modal */}
      {editingTemplate && (
        <div onClick={e => e.stopPropagation()} className="fixed inset-0 z-[210]">
          <TemplateEditor
            template={editingTemplate}
            onSave={(updated) => {
              setTemplates(prev => prev.map(t => t.id === (updated as ProjectTemplate).id ? (updated as ProjectTemplate) : t))
              setEditingTemplate(null)
            }}
            onClose={() => setEditingTemplate(null)}
          />
        </div>
      )}

      {/* AI Generate Modal */}
      {showAiModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 220,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={() => { setShowAiModal(false); setAiDescription('') }}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
            }}
          />
          <div
            style={{
              position: 'relative',
              width: 480,
              background: 'var(--bg-modal)',
              borderRadius: 8,
              border: '1px solid var(--border-strong)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
              padding: 24,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>
              Generate Template with AI
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 16px', opacity: 0.7 }}>
              Describe your project and AI will create stages, tasks, and roles
            </p>
            <textarea
              autoFocus
              value={aiDescription}
              onChange={e => setAiDescription(e.target.value)}
              placeholder="e.g. A marketing campaign launch with creative, copy, media buying, and analytics stages..."
              rows={4}
              style={{
                width: '100%',
                fontSize: 13,
                color: 'var(--text)',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                marginBottom: 16,
              }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAiGenerate() }}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowAiModal(false); setAiDescription('') }}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  color: 'var(--text-dim)',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAiGenerate}
                disabled={aiGenerating || !aiDescription.trim()}
                style={{
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#fff',
                  background: aiGenerating || !aiDescription.trim() ? 'rgba(139, 92, 246, 0.3)' : '#8b5cf6',
                  border: 'none',
                  borderRadius: 8,
                  cursor: aiGenerating || !aiDescription.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {aiGenerating ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="8" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                    Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Template Card ──────────────────────────────────────────────────────

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onDuplicate,
  isDeleting,
}: {
  template: ProjectTemplate
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  isDeleting: boolean
}) {
  const [showMenu, setShowMenu] = useState(false)
  const stages: TemplateStage[] = safeParse(template.stages, [])
  const tasks: TemplateTaskDef[] = safeParse(template.default_tasks, [])
  const roles: TemplateRole[] = safeParse(template.roles, [])

  const totalDuration = tasks.reduce((sum, t) => sum + (t.duration_minutes || 0), 0)
  const durationLabel = totalDuration >= 60
    ? `${Math.round(totalDuration / 60)}h`
    : `${totalDuration}m`

  return (
    <div
      onClick={onEdit}
      className="group"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all 150ms',
        overflow: 'hidden',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--border-strong)'
        e.currentTarget.style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-surface)'
        setShowMenu(false)
      }}
    >
      {/* Stage color bar */}
      <div className="flex" style={{ height: 4 }}>
        {stages.length > 0 ? (
          stages.map((s, i) => (
            <div key={i} style={{ flex: 1, background: s.color }} />
          ))
        ) : (
          <div style={{ flex: 1, background: 'var(--border)' }} />
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px 16px' }}>
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text)',
              margin: 0,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {template.name}
            </h3>
            {template.description && (
              <p style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                margin: '4px 0 0',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                opacity: 0.7,
              }}>
                {template.description}
              </p>
            )}
          </div>

          {/* 3-dot menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={e => { e.stopPropagation(); setShowMenu(!showMenu) }}
              className="group-hover:!opacity-100"
              style={{
                padding: 4,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                borderRadius: 4,
                opacity: 0,
                transition: 'opacity 150ms',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="3" r="1.2" fill="currentColor" />
                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                <circle cx="8" cy="13" r="1.2" fill="currentColor" />
              </svg>
            </button>
            {showMenu && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 28,
                  right: 0,
                  zIndex: 50,
                  width: 160,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => { setShowMenu(false); onEdit() }}
                  style={menuItemStyle}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M11.5 2.5l2 2M3 11l-1 3 3-1 8.5-8.5-2-2L3 11z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Edit
                </button>
                <button
                  onClick={() => { setShowMenu(false); onDuplicate() }}
                  style={menuItemStyle}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M3 11V3h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  Duplicate
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
                <button
                  onClick={() => { setShowMenu(false); onDelete() }}
                  style={{ ...menuItemStyle, color: 'var(--red)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,83,80,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5M4.5 4l.5 9a1.5 1.5 0 001.5 1.5h3a1.5 1.5 0 001.5-1.5l.5-9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stage pills */}
        {stages.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3" style={{ marginTop: 8 }}>
            {stages.map((s, i) => (
              <StagePill key={i} name={s.name} color={s.color} size="sm" />
            ))}
          </div>
        )}

        {/* Stats row */}
        <div
          className="flex items-center gap-3 flex-wrap"
          style={{
            fontSize: 12,
            color: 'var(--text-dim)',
            opacity: 0.6,
            marginTop: stages.length > 0 ? 0 : 8,
          }}
        >
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
              <path d="M6 3V1M10 3V1M2 7h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {stages.length} stage{stages.length !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 6l3 3 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
          {roles.length > 0 && (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {roles.length} role{roles.length !== 1 ? 's' : ''}
            </span>
          )}
          {totalDuration > 0 && (
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {durationLabel} total
            </span>
          )}
        </div>

        {/* Role badges */}
        {roles.length > 0 && (
          <div className="flex flex-wrap gap-1" style={{ marginTop: 8 }}>
            {roles.slice(0, 4).map((r, i) => (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: ROLE_COLORS[i % ROLE_COLORS.length],
                  background: hexToAlpha(ROLE_COLORS[i % ROLE_COLORS.length], 0.1),
                  borderRadius: 10,
                  padding: '2px 8px',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.name || 'Unnamed'}
              </span>
            ))}
            {roles.length > 4 && (
              <span style={{ fontSize: 10, color: 'var(--text-dim)', padding: '2px 4px' }}>
                +{roles.length - 4} more
              </span>
            )}
          </div>
        )}

        {/* Built-in badge */}
        {template.is_builtin === 1 && (
          <span
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--green)',
              background: 'rgba(0,230,118,0.08)',
              borderRadius: 4,
              padding: '2px 6px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Built-in
          </span>
        )}
      </div>
    </div>
  )
}

// ── Empty State ────────────────────────────────────────────────────────

function EmptyState({
  hasTemplates,
  onCreate,
  onAiGenerate,
}: {
  hasTemplates: boolean
  onCreate: () => void
  onAiGenerate: () => void
}) {
  if (hasTemplates) {
    return (
      <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--text-dim)' }}>
        <svg width="40" height="40" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.3, marginBottom: 12 }}>
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <p style={{ fontSize: 14 }}>No templates match your search</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--text-dim)' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <svg width="28" height="28" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.4 }}>
          <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5h6M5 8h4M5 11h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' }}>
        No templates yet
      </h3>
      <p style={{ fontSize: 13, opacity: 0.6, margin: '0 0 20px', maxWidth: 360, textAlign: 'center' }}>
        Templates let you create projects with pre-configured stages, tasks, roles, and schedules
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onAiGenerate}
          className="flex items-center gap-2"
          style={{
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 500,
            color: '#c4b5fd',
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Generate with AI
        </button>
        <button
          onClick={onCreate}
          className="flex items-center gap-2"
          style={{
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 500,
            color: '#fff',
            background: 'var(--green)',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Create blank template
        </button>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  color: 'var(--text)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
}

function hexToAlpha(hex: string, alpha: number): string {
  // Handle var() colors - return a default
  if (hex.startsWith('var(')) return `rgba(128, 128, 128, ${alpha})`
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
