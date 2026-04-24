'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import DatePicker from '@/components/ui/DatePicker'
import { BlockEditor, parseContent, serializeBlocks, type Block } from '@/components/docs/BlockEditor'
import { useCurrentUser } from '@/lib/use-current-user'

type ColType = 'text' | 'number' | 'select' | 'multi-select' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'status' | 'person' | 'files' | 'relation' | 'rollup' | 'formula' | 'button' | 'place' | 'created_time' | 'edited_time' | 'auto_id' | 'created_by' | 'edited_by'

interface TagOption {
  name: string
  color: string
}

interface Column {
  name: string
  type: string
  options?: string[]
}

interface RowDetailPanelProps {
  sheetId: number
  rowId: number
  rowData: Record<string, unknown>
  columns: Column[]
  colTypes: Record<string, ColType>
  colTags: Record<string, TagOption[]>
  onClose: () => void
  onUpdate: (colName: string, value: string) => void
  onDelete: () => void
}

const COL_TYPE_ICONS: Record<string, string> = {
  text: 'M3 5h14M3 9h8M3 13h10',
  number: 'M5 3v18M9 3v18M3 8h8M3 14h8',
  select: 'M12 8a4 4 0 100 8 4 4 0 000-8z',
  'multi-select': 'M3 6h2M3 12h2M3 18h2M8 6h13M8 12h13M8 18h13',
  status: 'M12 2a10 10 0 110 20 10 10 0 010-20zM8 12h4M12 8v4',
  date: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4',
  person: 'M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 110 8 4 4 0 010-8z',
  files: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49',
  checkbox: 'M3 3h18v18H3zM7 12l3 3 7-7',
  url: 'M10 14a3.5 3.5 0 005-5l-1-1M14 10a3.5 3.5 0 00-5 5l1 1M8 16l8-8',
  email: 'M3 5h18v14H3zM3 5l9 7 9-7',
  phone: 'M5 2h4l2 5-3 2a11 11 0 006 6l2-3 5 2v4a2 2 0 01-2 2A18 18 0 013 4a2 2 0 012-2',
  relation: 'M7 17L17 7M17 7H7M17 7v10',
  rollup: 'M11 4a2 2 0 114 0 2 2 0 01-4 0zM6 20a2 2 0 114 0 2 2 0 01-4 0zM14 20a2 2 0 114 0 2 2 0 01-4 0zM13 6v5.5M8 18v-5.5h8V18',
  formula: 'M5 4h4l-2 16M11 4h4l-2 16M4 10h14M4 14h14',
  button: 'M15 7h3a5 5 0 010 10h-3M9 17H6a5 5 0 010-10h3M8 12h8',
  auto_id: 'M4 7h6M4 12h8M4 17h10',
  place: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zM12 11.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z',
  created_time: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 6v6l4 2',
  edited_time: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 6v6l4 2',
  created_by: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 11a3 3 0 100-6 3 3 0 000 6zM6 18.5a6 6 0 0112 0',
  edited_by: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 11a3 3 0 100-6 3 3 0 000 6zM6 18.5a6 6 0 0112 0',
}

const COL_TYPE_LABELS: Record<string, string> = {
  text: 'Text', number: 'Number', select: 'Select', 'multi-select': 'Multi-select',
  status: 'Status', date: 'Date', person: 'Person', files: 'Files',
  checkbox: 'Checkbox', url: 'URL', email: 'Email', phone: 'Phone',
  relation: 'Relation', rollup: 'Rollup', formula: 'Formula', button: 'Button',
  auto_id: 'ID', place: 'Place', created_time: 'Created time', edited_time: 'Edited time',
  created_by: 'Created by', edited_by: 'Edited by',
}

function parseTags(raw: unknown): string[] {
  if (!raw) return []
  const str = String(raw)
  try { return JSON.parse(str) } catch { return str ? [str] : [] }
}

/* ─── Tag Picker Dropdown ─── */

function TagPicker({
  selected,
  options,
  multiple,
  onChange,
  onClose,
}: {
  selected: string[]
  options: TagOption[]
  multiple: boolean
  onChange: (tags: string[]) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const filtered = options.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase())
  )
  const exactMatch = options.some(o => o.name.toLowerCase() === search.toLowerCase())

  function toggle(name: string) {
    if (multiple) {
      const next = selected.includes(name)
        ? selected.filter(s => s !== name)
        : [...selected, name]
      onChange(next)
    } else {
      onChange(selected.includes(name) ? [] : [name])
      onClose()
    }
  }

  function create() {
    if (!search.trim()) return
    if (multiple) {
      onChange([...selected, search.trim()])
    } else {
      onChange([search.trim()])
      onClose()
    }
    setSearch('')
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 mt-1 w-[260px] rounded-lg z-50 overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 p-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          {selected.map(tag => {
            const opt = options.find(o => o.name === tag)
            return (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-medium" style={{ background: opt?.color || '#555', color: '#fff' }}>
                {tag}
                <button onClick={() => onChange(selected.filter(s => s !== tag))} className="ml-0.5 opacity-70 hover:opacity-100">&times;</button>
              </span>
            )
          })}
        </div>
      )}
      <div className="p-2">
        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full bg-transparent text-text text-[13px] outline-none placeholder:text-text-dim" />
      </div>
      <div className="border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />
      <div className="max-h-[200px] overflow-y-auto py-1">
        {filtered.map(opt => {
          const isSelected = selected.includes(opt.name)
          return (
            <button key={opt.name} onClick={() => toggle(opt.name)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-hover text-[13px]">
              <span className="w-3.5 h-3.5 rounded flex items-center justify-center text-[12px]" style={{ background: isSelected ? opt.color : 'transparent', border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.2)', color: '#fff' }}>
                {isSelected ? '\u2713' : ''}
              </span>
              <span className="px-2 py-0.5 rounded text-[12px] font-medium" style={{ background: opt.color, color: '#fff' }}>{opt.name}</span>
            </button>
          )
        })}
        {search.trim() && !exactMatch && (
          <>
            <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />
            <button onClick={create} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-hover text-[13px] text-text-dim">
              <span className="text-[14px]">+</span>
              Create <span className="text-text font-medium">{search.trim()}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── Property Row (Notion-style: icon + label + inline value) ─── */

function PropertyRow({
  col,
  colType,
  value,
  tags,
  onUpdate,
}: {
  col: Column
  colType: ColType
  value: unknown
  tags: TagOption[]
  onUpdate: (colName: string, value: string) => void
}) {
  const [localVal, setLocalVal] = useState(String(value ?? ''))
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setLocalVal(String(value ?? ''))
  }, [value])

  const commit = useCallback(() => {
    onUpdate(col.name, localVal)
  }, [col.name, localVal, onUpdate])

  const iconPath = COL_TYPE_ICONS[colType] || COL_TYPE_ICONS.text

  function renderValue() {
    switch (colType) {
      case 'number':
        return (
          <input type="number" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={commit}
            className="flex-1 bg-transparent text-text text-[14px] outline-none hover:bg-white/[0.03] rounded px-2 py-1" />
        )

      case 'date':
        return (
          <DatePicker value={localVal}
            onChange={v => { setLocalVal(v); onUpdate(col.name, v) }}
            size="sm" />
        )

      case 'checkbox':
        return (
          <button onClick={() => { const next = localVal === 'true' ? 'false' : 'true'; setLocalVal(next); onUpdate(col.name, next) }}>
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${localVal === 'true' ? 'bg-accent border-accent' : 'border-text-dim/40 hover:border-text-dim'}`}>
              {localVal === 'true' && <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8l3 3 5-5" /></svg>}
            </div>
          </button>
        )

      case 'select':
      case 'multi-select':
      case 'status': {
        const selected = parseTags(value)
        const isMulti = colType === 'multi-select'
        return (
          <div className="relative flex-1">
            <button onClick={() => setPickerOpen(!pickerOpen)} className="flex flex-wrap gap-1 min-h-[28px] items-center w-full px-2 py-1 rounded hover:bg-white/[0.03]">
              {selected.length === 0 && <span className="text-text-dim/40 text-[14px]">Empty</span>}
              {selected.map(tag => {
                const opt = tags.find(t => t.name === tag)
                return <span key={tag} className="px-2 py-0.5 rounded text-[12px] font-medium" style={{ background: opt?.color || '#555', color: '#fff' }}>{tag}</span>
              })}
            </button>
            {pickerOpen && (
              <TagPicker selected={selected} options={tags} multiple={isMulti}
                onChange={next => onUpdate(col.name, JSON.stringify(next))}
                onClose={() => setPickerOpen(false)} />
            )}
          </div>
        )
      }

      case 'url':
        return (
          <div className="flex items-center gap-1 flex-1">
            <input type="url" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={commit}
              className="flex-1 bg-transparent text-blue-400 text-[14px] outline-none hover:bg-white/[0.03] rounded px-2 py-1 underline decoration-blue-400/30" placeholder="https://" />
            {localVal && (
              <a href={localVal} target="_blank" rel="noopener noreferrer" className="text-text-dim hover:text-text shrink-0 p-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
              </a>
            )}
          </div>
        )

      case 'email':
        return (
          <div className="flex items-center gap-1 flex-1">
            <input type="email" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={commit}
              className="flex-1 bg-transparent text-text text-[14px] outline-none hover:bg-white/[0.03] rounded px-2 py-1" placeholder="email@example.com" />
            {localVal && (
              <a href={`mailto:${localVal}`} className="text-text-dim hover:text-text shrink-0 p-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" /></svg>
              </a>
            )}
          </div>
        )

      case 'phone':
        return (
          <div className="flex items-center gap-1 flex-1">
            <input type="tel" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={commit}
              className="flex-1 bg-transparent text-text text-[14px] outline-none hover:bg-white/[0.03] rounded px-2 py-1" placeholder="+1 (555) 000-0000" />
            {localVal && (
              <a href={`tel:${localVal}`} className="text-text-dim hover:text-text shrink-0 p-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" /></svg>
              </a>
            )}
          </div>
        )

      case 'created_time':
      case 'edited_time':
        return <span className="text-text-dim text-[14px] px-2 py-1">{localVal || 'N/A'}</span>

      case 'created_by':
      case 'edited_by':
        return <span className="text-text-dim text-[14px] px-2 py-1">{localVal || 'N/A'}</span>

      case 'person':
        return (
          <input type="text" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={commit}
            className="flex-1 bg-transparent text-text text-[14px] outline-none hover:bg-white/[0.03] rounded px-2 py-1" placeholder="Add person..." />
        )

      case 'place':
        return (
          <input type="text" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={commit}
            className="flex-1 bg-transparent text-text text-[14px] outline-none hover:bg-white/[0.03] rounded px-2 py-1" placeholder="Add location..." />
        )

      default:
        return (
          <input type="text" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={commit}
            className="flex-1 bg-transparent text-text text-[14px] outline-none hover:bg-white/[0.03] rounded px-2 py-1" />
        )
    }
  }

  return (
    <div className="flex items-center gap-0 py-0.5 min-h-[34px] group/prop hover:bg-white/[0.02] rounded">
      <div className="flex items-center gap-2 text-[14px] text-text-dim shrink-0 px-2 py-1" style={{ minWidth: 180 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-dim/60 shrink-0">
          <path d={iconPath} />
        </svg>
        {COL_TYPE_LABELS[colType] || 'Text'}
      </div>
      {renderValue()}
    </div>
  )
}

/* ─── Main Panel (Full-page Notion-style overlay) ─── */

export default function RowDetailPanel({
  rowData,
  columns,
  colTypes,
  colTags,
  onClose,
  onUpdate,
  onDelete,
}: RowDetailPanelProps) {
  const { user } = useCurrentUser()
  const [visible, setVisible] = useState(false)
  const [titleVal, setTitleVal] = useState('')
  const [blocks, setBlocks] = useState<Block[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const blocksInitRef = useRef(false)

  const firstCol = columns[0]
  const restCols = columns.slice(1)

  useEffect(() => {
    setTitleVal(String(rowData[firstCol?.name] ?? ''))
    const notesRaw = String(rowData._notes ?? '')
    // Parse notes as block content (supports both legacy plain text and block JSON)
    if (notesRaw && notesRaw.trim()) {
      setBlocks(parseContent(notesRaw))
    } else {
      setBlocks(parseContent(''))
    }
    blocksInitRef.current = true
  }, [rowData, firstCol?.name])

  const handleBlocksChange = useCallback((newBlocks: Block[]) => {
    setBlocks(newBlocks)
    // Debounce save
    const serialized = serializeBlocks(newBlocks)
    onUpdate('_notes', serialized)
  }, [onUpdate])

  // Fade-in on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 200)
  }

  // ESC to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center"
      style={{
        background: visible ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0)',
        transition: 'background 200ms ease',
      }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        className="w-full max-w-[900px] mt-12 mb-12 flex flex-col rounded-lg overflow-hidden"
        style={{
          background: 'var(--bg-chrome)',
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          maxHeight: 'calc(100vh - 96px)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 200ms ease, transform 200ms ease',
        }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 text-text-dim text-[13px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            <span className="opacity-50">Page</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              className="text-text-dim hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded transition-colors"
              title="Delete"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </button>
            <button
              onClick={handleClose}
              className="text-text-dim hover:text-text p-1.5 rounded hover:bg-hover transition-colors"
              title="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto" ref={contentRef}>
          <div className="max-w-[720px] mx-auto px-12 py-10">
            {/* Title */}
            {firstCol && (
              <input
                value={titleVal}
                onChange={e => setTitleVal(e.target.value)}
                onBlur={() => onUpdate(firstCol.name, titleVal)}
                className="w-full bg-transparent text-text text-[40px] font-bold outline-none placeholder:text-text-dim/30 mb-2"
                placeholder="Untitled"
              />
            )}

            {/* Properties */}
            <div className="mb-2">
              {restCols.map(col => {
                const colIndex = columns.indexOf(col)
                const ct = colTypes[String(colIndex)] || 'text'
                const tagKey = String(colIndex)
                return (
                  <PropertyRow
                    key={col.name}
                    col={col}
                    colType={ct}
                    value={rowData[col.name]}
                    tags={colTags[tagKey] || []}
                    onUpdate={onUpdate}
                  />
                )
              })}
            </div>

            {/* Add a property button */}
            <button className="flex items-center gap-2 text-text-dim/50 hover:text-text-dim text-[14px] px-2 py-1.5 rounded hover:bg-white/[0.03] transition-colors mb-6">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add a property
            </button>

            {/* Divider */}
            <div className="border-t mb-6" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

            {/* Comments section */}
            <div className="mb-6">
              <div className="text-[13px] text-text-dim font-medium mb-3">Comments</div>
              <div className="flex items-start gap-2.5">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-bold text-white">{(user?.name || 'U')[0].toUpperCase()}</span>
                  </div>
                )}
                <input
                  className="flex-1 bg-transparent text-text text-[14px] outline-none placeholder:text-text-dim/30 py-1"
                  placeholder="Add a comment..."
                />
              </div>
            </div>

            {/* Divider */}
            <div className="border-t mb-6" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

            {/* Body / Notes area - full block editor like docs */}
            <div className="min-h-[200px]">
              <BlockEditor
                blocks={blocks}
                onChange={handleBlocksChange}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
