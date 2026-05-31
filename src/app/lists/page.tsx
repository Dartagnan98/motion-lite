'use client'

// /lists — CRM Lists (segments).
// Lists index with name / kind / member count.
// Click → detail drawer: edit name/description, members table.
// Smart lists: filter_rules JSON textarea for power users.
// Create list: name + kind toggle + (if smart) filter JSON.

import { useState, useEffect, useCallback } from 'react'

interface CrmList {
  id: number
  public_id: string
  name: string
  description: string | null
  kind: 'static' | 'smart'
  filter_rules: string | null
  filter: string | null
  member_count?: number
  created_at: number
}

interface ListMember {
  id: number
  public_id: string
  name: string
  email: string | null
  phone: string | null
  source: string | null
}

const fmtDate = (s: number | undefined) =>
  s ? new Date(s * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default function ListsPage() {
  const [lists, setLists] = useState<CrmList[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CrmList | null>(null)
  const [members, setMembers] = useState<ListMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)

  // Create state
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<{
    name: string
    description: string
    kind: 'static' | 'smart'
    filter_rules: string
  }>({ name: '', description: '', kind: 'static', filter_rules: '' })
  const [saving, setSaving] = useState(false)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<CrmList>>({})
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/crm/lists')
      const d = await res.json() as { lists?: CrmList[] }
      setLists(d.lists ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openList = useCallback(async (list: CrmList) => {
    setSelected(list)
    setEditing(false)
    setMembers([])
    setMembersLoading(true)
    try {
      const res = await fetch(`/api/crm/lists/${list.public_id}`)
      const d = await res.json() as { list?: CrmList; contacts?: ListMember[] }
      if (d.list) setSelected(d.list)
      setMembers(d.contacts ?? [])
    } finally {
      setMembersLoading(false)
    }
  }, [])

  async function createList() {
    if (!createForm.name.trim()) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: createForm.name.trim(),
        kind: createForm.kind,
      }
      if (createForm.description.trim()) payload.description = createForm.description.trim()
      if (createForm.kind === 'smart' && createForm.filter_rules.trim()) {
        try {
          payload.filter_rules = JSON.parse(createForm.filter_rules)
        } catch {
          payload.filter = createForm.filter_rules.trim()
        }
      }
      const res = await fetch('/api/crm/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json() as { list?: CrmList }
      if (d.list) {
        setLists(prev => [d.list!, ...prev])
        setCreating(false)
        setCreateForm({ name: '', description: '', kind: 'static', filter_rules: '' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    if (!selected || !editForm.name?.trim()) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/crm/lists/${selected.public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      const d = await res.json() as { list?: CrmList }
      if (d.list) {
        setSelected(d.list)
        setEditing(false)
        setLists(prev => prev.map(l => l.id === d.list!.id ? d.list! : l))
      }
    } finally {
      setSavingEdit(false)
    }
  }

  async function deleteList() {
    if (!selected || !confirm(`Delete list "${selected.name}"?`)) return
    await fetch(`/api/crm/lists/${selected.public_id}`, { method: 'DELETE' })
    setLists(prev => prev.filter(l => l.id !== selected.id))
    setSelected(null)
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>Lists</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {lists.length} list{lists.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="text-sm font-medium text-white px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--accent)' }}
          >
            + New list
          </button>
        </div>

        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider border-b" style={{ color: 'var(--text-dim)', borderColor: 'var(--border)' }}>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-left px-4 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center" style={{ color: 'var(--text-dim)' }}>Loading…</td>
                </tr>
              ) : lists.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center" style={{ color: 'var(--text-dim)' }}>
                    No lists yet. Create a static list to manually segment contacts, or a smart list filtered by rules.
                  </td>
                </tr>
              ) : lists.map(l => (
                <tr
                  key={l.id}
                  onClick={() => openList(l)}
                  className="border-b cursor-pointer hover:bg-hover"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text)' }}>{l.name}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: l.kind === 'smart' ? 'rgba(139,92,246,0.15)' : 'var(--accent-dim)',
                        color: l.kind === 'smart' ? '#a78bfa' : 'var(--accent-text)',
                      }}
                    >
                      {l.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-dim)' }}>{l.description || '—'}</td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-dim)' }}>{fmtDate(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      {creating && (
        <Modal title="New list" onClose={() => setCreating(false)}>
          <div className="space-y-3">
            <FormField label="Name *">
              <input
                autoFocus
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                className="glass-input w-full text-sm px-3 py-2 rounded-md"
                placeholder="e.g. Q1 Leads"
              />
            </FormField>
            <FormField label="Description">
              <input
                value={createForm.description}
                onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                className="glass-input w-full text-sm px-3 py-2 rounded-md"
                placeholder="Optional description"
              />
            </FormField>
            <FormField label="Type">
              <div className="flex gap-2">
                {(['static', 'smart'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setCreateForm(f => ({ ...f, kind: k }))}
                    className="flex-1 text-sm py-1.5 rounded-md transition-colors capitalize"
                    style={{
                      background: createForm.kind === k ? 'var(--accent)' : 'var(--border)',
                      color: createForm.kind === k ? 'white' : 'var(--text-dim)',
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>
                {createForm.kind === 'smart'
                  ? 'Smart lists auto-populate based on filter rules.'
                  : 'Static lists are manually managed.'}
              </p>
            </FormField>
            {createForm.kind === 'smart' && (
              <FormField label="Filter Rules (JSON)">
                <textarea
                  value={createForm.filter_rules}
                  onChange={e => setCreateForm(f => ({ ...f, filter_rules: e.target.value }))}
                  rows={4}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md resize-y font-mono text-[12px]"
                  placeholder='{"source": "facebook", "tags": ["warm"]}'
                />
              </FormField>
            )}
          </div>
          <div className="flex gap-2 mt-5">
            <button
              onClick={createList}
              disabled={saving || !createForm.name.trim()}
              className="flex-1 text-sm font-medium text-white px-3 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {saving ? 'Creating…' : 'Create list'}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="text-sm px-3 py-2 rounded-lg"
              style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Detail drawer */}
      {selected && !creating && (
        <Drawer
          title={editing ? 'Edit list' : selected.name}
          onClose={() => setSelected(null)}
        >
          {editing ? (
            <div className="space-y-3">
              <FormField label="Name *">
                <input
                  autoFocus
                  value={editForm.name || ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md"
                />
              </FormField>
              <FormField label="Description">
                <input
                  value={editForm.description || ''}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="glass-input w-full text-sm px-3 py-2 rounded-md"
                />
              </FormField>
              {selected.kind === 'smart' && (
                <FormField label="Filter Rules (JSON)">
                  <textarea
                    value={typeof editForm.filter_rules === 'string'
                      ? editForm.filter_rules
                      : editForm.filter_rules
                        ? JSON.stringify(editForm.filter_rules, null, 2)
                        : ''}
                    onChange={e => setEditForm(f => ({ ...f, filter_rules: e.target.value }))}
                    rows={5}
                    className="glass-input w-full text-sm px-3 py-2 rounded-md resize-y font-mono text-[12px]"
                  />
                </FormField>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={saveEdit}
                  disabled={savingEdit || !editForm.name?.trim()}
                  className="flex-1 text-sm font-medium text-white px-3 py-2 rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-sm px-3 py-2 rounded-lg"
                  style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* List metadata */}
              <div className="flex items-center gap-2 mb-4">
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: selected.kind === 'smart' ? 'rgba(139,92,246,0.15)' : 'var(--accent-dim)',
                    color: selected.kind === 'smart' ? '#a78bfa' : 'var(--accent-text)',
                  }}
                >
                  {selected.kind}
                </span>
                {!membersLoading && (
                  <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{members.length} members</span>
                )}
              </div>

              {selected.description && (
                <p className="text-sm mb-4" style={{ color: 'var(--text-dim)' }}>{selected.description}</p>
              )}

              {/* Smart list filter display */}
              {selected.kind === 'smart' && selected.filter_rules && (
                <div className="mb-4">
                  <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Filter Rules</p>
                  <pre className="text-[12px] p-3 rounded-md overflow-x-auto" style={{ background: 'var(--border)', color: 'var(--text-dim)' }}>
                    {typeof selected.filter_rules === 'string'
                      ? selected.filter_rules
                      : JSON.stringify(selected.filter_rules, null, 2)}
                  </pre>
                </div>
              )}

              {/* Members table */}
              <div className="mb-5">
                <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--text-dim)' }}>Members</p>
                {membersLoading ? (
                  <p className="text-sm text-center py-4" style={{ color: 'var(--text-dim)' }}>Loading…</p>
                ) : members.length === 0 ? (
                  <p className="text-sm text-center py-4" style={{ color: 'var(--text-dim)' }}>No members yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wider border-b" style={{ color: 'var(--text-dim)', borderColor: 'var(--border)' }}>
                        <th className="text-left py-2">Name</th>
                        <th className="text-left py-2">Email</th>
                        <th className="text-left py-2">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(m => (
                        <tr key={m.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                          <td className="py-2 font-medium" style={{ color: 'var(--text)' }}>{m.name}</td>
                          <td className="py-2" style={{ color: 'var(--text-dim)' }}>{m.email || '—'}</td>
                          <td className="py-2" style={{ color: 'var(--text-dim)' }}>{m.source || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    setEditForm({
                      name: selected.name,
                      description: selected.description,
                      filter_rules: selected.filter_rules,
                    })
                    setEditing(true)
                  }}
                  className="flex-1 text-sm font-medium text-white px-3 py-2 rounded-lg"
                  style={{ background: 'var(--accent)' }}
                >
                  Edit
                </button>
                <button
                  onClick={deleteList}
                  className="text-sm px-3 py-2 rounded-lg"
                  style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </Drawer>
      )}
    </main>
  )
}

function Drawer({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-md h-full overflow-y-auto p-6"
        style={{ background: 'var(--bg-elevated, var(--bg))', borderLeft: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
          <button onClick={onClose} style={{ color: 'var(--text-dim)' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative rounded-xl p-6 w-full max-w-md overflow-y-auto max-h-[90vh]"
        style={{ background: 'var(--bg-elevated, var(--bg))', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
          <button onClick={onClose} style={{ color: 'var(--text-dim)' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>{label}</label>
      {children}
    </div>
  )
}
