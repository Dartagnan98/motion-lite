'use client'

// Organize Sections — toolbar button + slide-over panel.
//
// Drag a compact list of section titles to reorder; toggle each row's eye to
// show/hide. Save PATCHes /api/platform/reports/[id]/sections, which persists
// the order + visibility on the report AND saves it as the client's default
// layout (so future reports for this client open the same way).
//
// Reordering compact title rows (not the tall rendered sections) keeps the drag
// smooth. Uses framer-motion's Reorder (already a dependency — no new package).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Reorder, useDragControls } from 'framer-motion'

export interface OrganizeSectionItem {
  id: number
  title: string
  sectionType: string | null
  isHidden: boolean
}

export function OrganizeSectionsPanel({
  reportId,
  sections,
}: {
  reportId: number
  sections: OrganizeSectionItem[]
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<OrganizeSectionItem[]>(sections)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  function openPanel() {
    setItems(sections) // re-sync to latest server state each open
    setOpen(true)
  }

  function toggleHidden(id: number) {
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, isHidden: !s.isHidden } : s)))
  }

  async function save() {
    setSaving(true)
    const layout = items.map((s, i) => ({ sectionId: s.id, position: i, isHidden: s.isHidden }))
    try {
      const res = await fetch(`/api/platform/reports/${reportId}/sections`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout }),
      })
      if (res.ok) {
        setOpen(false)
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={openPanel}
        className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5"
        title="Reorder or hide report sections"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        Organize
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <div className="relative w-full max-w-sm h-full bg-white shadow-xl flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Organize sections</h2>
                <p className="text-xs text-gray-400 mt-0.5">Drag to reorder · eye to show/hide</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <Reorder.Group
              axis="y"
              values={items}
              onReorder={setItems}
              className="flex-1 overflow-y-auto p-3 space-y-1.5"
            >
              {items.map((item) => (
                <OrganizeRow key={item.id} item={item} onToggle={() => toggleHidden(item.id)} />
              ))}
            </Reorder.Group>

            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="text-xs font-medium text-white px-3 py-1.5 rounded-md disabled:opacity-50"
                style={{ background: 'var(--platform-accent, #0891b2)' }}
              >
                {saving ? 'Saving…' : 'Save layout'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function OrganizeRow({
  item,
  onToggle,
}: {
  item: OrganizeSectionItem
  onToggle: () => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className={`flex items-center gap-2 rounded-md border border-gray-100 bg-white px-2.5 py-2 ${
        item.isHidden ? 'opacity-50' : ''
      }`}
    >
      {/* Drag handle */}
      <button
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none"
        aria-label="Drag to reorder"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="7" cy="5" r="1.4" /><circle cx="13" cy="5" r="1.4" />
          <circle cx="7" cy="10" r="1.4" /><circle cx="13" cy="10" r="1.4" />
          <circle cx="7" cy="15" r="1.4" /><circle cx="13" cy="15" r="1.4" />
        </svg>
      </button>

      <span className="flex-1 text-sm text-gray-700 truncate">{item.title}</span>

      {/* Visibility toggle */}
      <button
        onClick={onToggle}
        className="text-gray-400 hover:text-gray-700 p-1 rounded"
        title={item.isHidden ? 'Hidden — click to show' : 'Visible — click to hide'}
        aria-label={item.isHidden ? 'Show section' : 'Hide section'}
      >
        {item.isHidden ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029M6.228 6.228A9.956 9.956 0 0112 5c4.478 0 8.268 2.943 9.543 7a9.97 9.97 0 01-1.563 3.029M3 3l18 18" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </Reorder.Item>
  )
}
