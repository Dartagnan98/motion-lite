'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import RowDetailPanel from '@/components/database/RowDetailPanel'
import { InlineDatePicker } from '@/components/ui/DatePicker'
import { Dropdown } from '@/components/ui/Dropdown'
import { useCurrentUser } from '@/lib/use-current-user'
import { Avatar } from '@/components/ui/Avatar'
import { IconX, IconPlus, IconChevronDown, IconChevronRight, IconCheck, IconMoreHorizontal, IconMoreVertical, IconTrash, IconCopy, IconCalendar } from '@/components/ui/Icons'

// ─── Label Editor Component ───
function LabelEditor({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [allLabels, setAllLabels] = useState<{ id: number; name: string; color: string }[]>([])
  const wrapperRef = useRef<HTMLDivElement>(null)

  let labels: string[] = []
  try { labels = value ? JSON.parse(value) : [] } catch { labels = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [] }

  useEffect(() => {
    fetch('/api/labels').then(r => r.json()).then(d => { if (Array.isArray(d)) setAllLabels(d) }).catch(() => {})
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function addLabel(name: string) {
    const trimmed = name.trim()
    if (!trimmed || labels.includes(trimmed)) return
    const next = [...labels, trimmed]
    onChange(JSON.stringify(next))
    setInput('')
  }

  function removeLabel(name: string) {
    const next = labels.filter(l => l !== name)
    onChange(next.length > 0 ? JSON.stringify(next) : '')
  }

  async function createAndAddLabel(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    await fetch('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, color: '#7a6b55' }),
    })
    addLabel(trimmed)
    fetch('/api/labels').then(r => r.json()).then(d => { if (Array.isArray(d)) setAllLabels(d) }).catch(() => {})
  }

  const suggestions = allLabels.filter(l => !labels.includes(l.name) && (!input || l.name.toLowerCase().includes(input.toLowerCase())))
  const showCreate = input.trim() && !allLabels.some(l => l.name.toLowerCase() === input.trim().toLowerCase())

  return (
    <div className="flex items-center gap-1.5 flex-wrap" ref={wrapperRef}>
      {labels.map(l => {
        const labelData = allLabels.find(al => al.name === l)
        return (
          <span key={l} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]" style={{ background: (labelData?.color || '#7a6b55') + '22', color: labelData?.color || '#7a6b55' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: labelData?.color || '#7a6b55' }} />
            {l}
            <button onClick={() => removeLabel(l)} className="hover:brightness-150 ml-0.5">
              <IconX size={8} />
            </button>
          </span>
        )
      })}
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text transition-colors px-1.5 py-0.5 rounded hover:bg-hover"
        >
          <IconPlus size={10} />
          {labels.length === 0 ? 'Labels' : ''}
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 w-[200px] rounded-lg z-50 py-1" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }}>
            <div className="px-2 pb-1.5 pt-1">
              <input
                autoFocus
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (input.trim() && showCreate) createAndAddLabel(input)
                    else if (suggestions.length > 0) addLabel(suggestions[0].name)
                  }
                  if (e.key === 'Escape') { setOpen(false); setInput('') }
                }}
                placeholder="Search labels..."
                className="w-full rounded px-2 py-1.5 text-[14px] text-text outline-none placeholder:text-text-dim/50 border border-border/50 bg-bg"
              />
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {showCreate && (
                <button onClick={() => createAndAddLabel(input)} className="flex items-center gap-2 w-full px-3 py-2 text-[14px] text-text-dim hover:bg-hover transition-colors">
                  <IconPlus size={12} />
                  Create &quot;{input.trim()}&quot;
                </button>
              )}
              {showCreate && suggestions.length > 0 && <div className="h-px bg-border mx-2 my-1" />}
              {suggestions.map(l => (
                <button key={l.id} onClick={() => addLabel(l.name)} className="flex items-center gap-2.5 w-full px-3 py-2 text-[14px] text-text hover:bg-hover transition-colors">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                  {l.name}
                </button>
              ))}
              {suggestions.length === 0 && !showCreate && (
                <div className="px-3 py-2 text-[13px] text-text-dim">No labels found</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Types ───

interface SheetMeta {
  id: number
  name: string
  column_count: number
  row_count: number
  created_at: string
  labels?: string
}

interface Column {
  name: string
  type: string
  options?: string[]
}

interface CellFormat {
  b?: boolean    // bold
  i?: boolean    // italic
  s?: boolean    // strikethrough
  cur?: boolean  // currency
  wrap?: boolean // text wrap
  rot?: number   // rotation: 0, 45, 90, 270
  bdr?: string   // border: 'all' | 'top' | 'bottom' | 'left' | 'right' | 'none'
  date?: boolean // date picker mode
}

interface TagOption {
  name: string
  color: string
}

type ViewType = 'table' | 'board' | 'list'

type ColType = 'text' | 'number' | 'select' | 'multi-select' | 'date' | 'checkbox' | 'url' | 'email' | 'phone' | 'status' | 'person' | 'files' | 'relation' | 'rollup' | 'formula' | 'button' | 'place' | 'created_time' | 'edited_time' | 'auto_id' | 'created_by' | 'edited_by'

// Sort & Filter types
interface SortRule { column: number; direction: 'asc' | 'desc' }

type FilterOperator = 'contains' | 'does_not_contain' | 'equals' | 'does_not_equal'
  | 'is_empty' | 'is_not_empty' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'is' | 'is_not' | 'before' | 'after' | 'is_checked' | 'is_not_checked'

interface FilterRule { id: string; column: number; operator: FilterOperator; value: string }

const FILTER_OPS_BY_TYPE: Record<ColType, { value: FilterOperator; label: string }[]> = {
  text: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'equals', label: 'Is' }, { value: 'does_not_equal', label: 'Is not' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  number: [
    { value: 'equals', label: '=' }, { value: 'does_not_equal', label: '!=' },
    { value: 'gt', label: '>' }, { value: 'lt', label: '<' },
    { value: 'gte', label: '>=' }, { value: 'lte', label: '<=' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  select: [
    { value: 'is', label: 'Is' }, { value: 'is_not', label: 'Is not' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  'multi-select': [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  status: [
    { value: 'is', label: 'Is' }, { value: 'is_not', label: 'Is not' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  date: [
    { value: 'equals', label: 'Is' }, { value: 'before', label: 'Before' }, { value: 'after', label: 'After' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  checkbox: [
    { value: 'is_checked', label: 'Is checked' }, { value: 'is_not_checked', label: 'Is not checked' },
  ],
  url: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  email: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  phone: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  created_time: [
    { value: 'before', label: 'Before' }, { value: 'after', label: 'After' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  edited_time: [
    { value: 'before', label: 'Before' }, { value: 'after', label: 'After' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  auto_id: [
    { value: 'equals', label: '=' }, { value: 'does_not_equal', label: '!=' },
    { value: 'gt', label: '>' }, { value: 'lt', label: '<' },
  ],
  person: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  files: [
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  relation: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  rollup: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  formula: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'equals', label: 'Is' }, { value: 'does_not_equal', label: 'Is not' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  button: [
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  place: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
    { value: 'is_empty', label: 'Is empty' }, { value: 'is_not_empty', label: 'Is not empty' },
  ],
  created_by: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
  ],
  edited_by: [
    { value: 'contains', label: 'Contains' }, { value: 'does_not_contain', label: 'Does not contain' },
  ],
}

// Grouped like Notion: basic types | advanced types | timestamp types
const COL_TYPE_INFO: { type: ColType; label: string; icon: string; group?: 'basic' | 'advanced' | 'timestamp' }[] = [
  // Basic types (top section in Notion)
  { type: 'text', label: 'Text', icon: 'M3 5h14M3 9h8M3 13h10', group: 'basic' },
  { type: 'number', label: 'Number', icon: 'M5 3v18M9 3v18M3 8h8M3 14h8', group: 'basic' },
  { type: 'select', label: 'Select', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8z', group: 'basic' },
  { type: 'multi-select', label: 'Multi-select', icon: 'M3 6h2M3 12h2M3 18h2M8 6h13M8 12h13M8 18h13', group: 'basic' },
  { type: 'status', label: 'Status', icon: 'M12 2a10 10 0 110 20 10 10 0 010-20zM8 12h4M12 8v4', group: 'basic' },
  { type: 'date', label: 'Date', icon: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4', group: 'basic' },
  { type: 'person', label: 'Person', icon: 'M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 110 8 4 4 0 010-8z', group: 'basic' },
  { type: 'files', label: 'Files & media', icon: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49', group: 'basic' },
  { type: 'checkbox', label: 'Checkbox', icon: 'M3 3h18v18H3zM7 12l3 3 7-7', group: 'basic' },
  { type: 'url', label: 'URL', icon: 'M10 14a3.5 3.5 0 005-5l-1-1M14 10a3.5 3.5 0 00-5 5l1 1M8 16l8-8', group: 'basic' },
  { type: 'phone', label: 'Phone', icon: 'M5 2h4l2 5-3 2a11 11 0 006 6l2-3 5 2v4a2 2 0 01-2 2A18 18 0 013 4a2 2 0 012-2', group: 'basic' },
  { type: 'email', label: 'Email', icon: 'M3 5h18v14H3zM3 5l9 7 9-7', group: 'basic' },
  // Advanced types (middle section in Notion)
  { type: 'relation', label: 'Relation', icon: 'M7 17L17 7M17 7H7M17 7v10', group: 'advanced' },
  { type: 'rollup', label: 'Rollup', icon: 'M11 4a2 2 0 114 0 2 2 0 01-4 0zM6 20a2 2 0 114 0 2 2 0 01-4 0zM14 20a2 2 0 114 0 2 2 0 01-4 0zM13 6v5.5M8 18v-5.5h8V18', group: 'advanced' },
  { type: 'formula', label: 'Formula', icon: 'M5 4h4l-2 16M11 4h4l-2 16M4 10h14M4 14h14', group: 'advanced' },
  { type: 'button', label: 'Button', icon: 'M15 7h3a5 5 0 010 10h-3M9 17H6a5 5 0 010-10h3M8 12h8', group: 'advanced' },
  { type: 'auto_id', label: 'ID', icon: 'M4 7h6M4 12h8M4 17h10', group: 'advanced' },
  { type: 'place', label: 'Place', icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zM12 11.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z', group: 'advanced' },
  // Timestamp types (bottom section in Notion)
  { type: 'created_time', label: 'Created time', icon: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 6v6l4 2', group: 'timestamp' },
  { type: 'edited_time', label: 'Last edited time', icon: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 6v6l4 2', group: 'timestamp' },
  { type: 'created_by', label: 'Created by', icon: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 11a3 3 0 100-6 3 3 0 000 6zM6 18.5a6 6 0 0112 0', group: 'timestamp' },
  { type: 'edited_by', label: 'Last edited by', icon: 'M12 2a10 10 0 110 20 10 10 0 010-20zM12 11a3 3 0 100-6 3 3 0 000 6zM6 18.5a6 6 0 0112 0', group: 'timestamp' },
]

const STATUS_OPTIONS = [
  { name: 'Not started', color: '#6b7280' },
  { name: 'In progress', color: '#3b82f6' },
  { name: 'Done', color: '#22c55e' },
  { name: 'Blocked', color: '#ef4444' },
]

interface SheetSettings {
  frozenRows?: number
  formats?: Record<string, CellFormat>
  merges?: { r1: number; c1: number; r2: number; c2: number }[]
  dropdowns?: Record<string, string[]> // colIndex -> options (legacy)
  colTags?: Record<string, TagOption[]> // colIndex -> available tags with colors
  colTypes?: Record<string, ColType> // colIndex -> column type
  sortRules?: SortRule[]
  filterRules?: FilterRule[]
  viewType?: ViewType
  hiddenColumns?: number[]
  boardGroupBy?: number
}

interface SheetDetail {
  id: number
  public_id?: string
  name: string
  columns: Column[]
  rows: Record<string, unknown>[]
  labels?: string
  settings?: SheetSettings
}

// ─── Formula Engine ───

type CellGetter = (colName: string, rowIndex: number) => string | number | null

function colNameToIndex(colName: string, columns: Column[]): number {
  return columns.findIndex(c => c.name.toUpperCase() === colName.toUpperCase())
}

function parseCellRef(ref: string, columns: Column[]): { col: number; row: number } | null {
  const simple = ref.match(/^([A-Z]+)(\d+)$/i)
  if (simple) {
    const colIdx = colNameToIndex(simple[1], columns)
    if (colIdx >= 0) return { col: colIdx, row: parseInt(simple[2]) - 1 }
    let idx = 0
    const letters = simple[1].toUpperCase()
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64)
    }
    idx -= 1
    if (idx >= 0 && idx < columns.length) return { col: idx, row: parseInt(simple[2]) - 1 }
  }
  for (let i = columns.length - 1; i >= 0; i--) {
    const name = columns[i].name
    if (ref.toUpperCase().startsWith(name.toUpperCase())) {
      const rest = ref.slice(name.length)
      const rowNum = parseInt(rest)
      if (!isNaN(rowNum) && rowNum > 0) return { col: i, row: rowNum - 1 }
    }
  }
  return null
}

function parseRange(range: string, columns: Column[]): { col: number; row: number }[] {
  const parts = range.split(':')
  if (parts.length !== 2) return []
  const start = parseCellRef(parts[0].trim(), columns)
  const end = parseCellRef(parts[1].trim(), columns)
  if (!start || !end) return []
  const cells: { col: number; row: number }[] = []
  for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
    for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
      cells.push({ col: c, row: r })
    }
  }
  return cells
}

function resolveValues(arg: string, columns: Column[], getCellValue: CellGetter): number[] {
  arg = arg.trim()
  if (arg.includes(':')) {
    const cells = parseRange(arg, columns)
    return cells.map(c => {
      const v = getCellValue(columns[c.col]?.name, c.row)
      return typeof v === 'number' ? v : parseFloat(String(v)) || 0
    })
  }
  const ref = parseCellRef(arg, columns)
  if (ref) {
    const v = getCellValue(columns[ref.col]?.name, ref.row)
    return [typeof v === 'number' ? v : parseFloat(String(v)) || 0]
  }
  const n = parseFloat(arg)
  return isNaN(n) ? [0] : [n]
}

function evaluateFormula(formula: string, columns: Column[], rows: Record<string, unknown>[], currentRow: number, currentCol: number, visited?: Set<string>): string | number {
  if (!formula.startsWith('=')) return formula

  const cellKey = `${currentCol},${currentRow}`
  if (!visited) visited = new Set()
  if (visited.has(cellKey)) return '#REF!'
  visited.add(cellKey)

  const expr = formula.slice(1).trim()

  const getCellValue: CellGetter = (colName: string, rowIndex: number) => {
    if (rowIndex < 0 || rowIndex >= rows.length) return 0
    const raw = rows[rowIndex]?.[colName]
    if (raw == null || raw === '') return 0
    const str = String(raw)
    if (str.startsWith('=')) {
      const ci = columns.findIndex(c => c.name === colName)
      const result = evaluateFormula(str, columns, rows, rowIndex, ci, new Set(visited))
      return typeof result === 'number' ? result : parseFloat(String(result)) || 0
    }
    const n = parseFloat(str)
    return isNaN(n) ? str : n
  }

  try {
    const funcMatch = expr.match(/^(\w+)\(([\s\S]+)\)$/)
    if (funcMatch) {
      const fn = funcMatch[1].toUpperCase()
      const argsStr = funcMatch[2]
      const args: string[] = []
      let depth = 0
      let current = ''
      for (const ch of argsStr) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ',' && depth === 0) { args.push(current); current = '' }
        else current += ch
      }
      args.push(current)

      switch (fn) {
        case 'SUM': {
          const vals = args.flatMap(a => resolveValues(a, columns, getCellValue))
          return vals.reduce((s, v) => s + v, 0)
        }
        case 'AVERAGE': case 'AVG': {
          const vals = args.flatMap(a => resolveValues(a, columns, getCellValue))
          return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
        }
        case 'COUNT': {
          const vals = args.flatMap(a => resolveValues(a, columns, getCellValue))
          return vals.length
        }
        case 'COUNTA': {
          let count = 0
          for (const a of args) {
            const trimmed = a.trim()
            if (trimmed.includes(':')) {
              const cells = parseRange(trimmed, columns)
              for (const c of cells) {
                const v = getCellValue(columns[c.col]?.name, c.row)
                if (v != null && v !== '' && v !== 0) count++
              }
            } else {
              const ref = parseCellRef(trimmed, columns)
              if (ref) {
                const v = getCellValue(columns[ref.col]?.name, ref.row)
                if (v != null && v !== '' && v !== 0) count++
              }
            }
          }
          return count
        }
        case 'MIN': {
          const vals = args.flatMap(a => resolveValues(a, columns, getCellValue))
          return vals.length ? Math.min(...vals) : 0
        }
        case 'MAX': {
          const vals = args.flatMap(a => resolveValues(a, columns, getCellValue))
          return vals.length ? Math.max(...vals) : 0
        }
        case 'ABS': {
          const vals = resolveValues(args[0], columns, getCellValue)
          return Math.abs(vals[0] || 0)
        }
        case 'ROUND': {
          const vals = resolveValues(args[0], columns, getCellValue)
          const places = args[1] ? resolveValues(args[1], columns, getCellValue)[0] : 0
          return Math.round(vals[0] * Math.pow(10, places)) / Math.pow(10, places)
        }
        case 'IF': {
          const cond = evaluateCondition(args[0]?.trim() || '', columns, getCellValue)
          const trueVal = args[1]?.trim() || ''
          const falseVal = args[2]?.trim() || ''
          const resultExpr = cond ? trueVal : falseVal
          if (resultExpr.startsWith('"') && resultExpr.endsWith('"')) return resultExpr.slice(1, -1)
          const n = parseFloat(resultExpr)
          if (!isNaN(n)) return n
          const ref = parseCellRef(resultExpr, columns)
          if (ref) {
            const v = getCellValue(columns[ref.col]?.name, ref.row)
            return v ?? 0
          }
          return resultExpr
        }
        case 'SUMIF': {
          // =SUMIF(criteriaRange, criteria, sumRange)
          if (args.length >= 2) {
            const criteriaRange = parseRange(args[0].trim(), columns)
            const criteria = args[1].trim().replace(/^"|"$/g, '')
            const sumRange = args.length >= 3 ? parseRange(args[2].trim(), columns) : criteriaRange
            let total = 0
            for (let idx = 0; idx < criteriaRange.length; idx++) {
              const cell = criteriaRange[idx]
              const val = getCellValue(columns[cell.col]?.name, cell.row)
              const matches = String(val) === criteria || (typeof val === 'number' && val === parseFloat(criteria))
              if (matches && sumRange[idx]) {
                const sv = getCellValue(columns[sumRange[idx].col]?.name, sumRange[idx].row)
                total += typeof sv === 'number' ? sv : parseFloat(String(sv)) || 0
              }
            }
            return total
          }
          return 0
        }
        case 'COUNTIF': {
          if (args.length >= 2) {
            const range = parseRange(args[0].trim(), columns)
            const criteria = args[1].trim().replace(/^"|"$/g, '')
            let count = 0
            for (const cell of range) {
              const val = getCellValue(columns[cell.col]?.name, cell.row)
              if (String(val) === criteria || (typeof val === 'number' && val === parseFloat(criteria))) count++
            }
            return count
          }
          return 0
        }
        case 'CONCAT': case 'CONCATENATE': {
          return args.map(a => {
            const trimmed = a.trim()
            if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1)
            const ref = parseCellRef(trimmed, columns)
            if (ref) return String(getCellValue(columns[ref.col]?.name, ref.row) || '')
            return trimmed
          }).join('')
        }
        case 'LEN': {
          const trimmed = args[0]?.trim() || ''
          const ref = parseCellRef(trimmed, columns)
          if (ref) return String(getCellValue(columns[ref.col]?.name, ref.row) || '').length
          return trimmed.length
        }
        case 'UPPER': {
          const trimmed = args[0]?.trim() || ''
          if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).toUpperCase()
          const ref = parseCellRef(trimmed, columns)
          if (ref) return String(getCellValue(columns[ref.col]?.name, ref.row) || '').toUpperCase()
          return trimmed.toUpperCase()
        }
        case 'LOWER': {
          const trimmed = args[0]?.trim() || ''
          if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).toLowerCase()
          const ref = parseCellRef(trimmed, columns)
          if (ref) return String(getCellValue(columns[ref.col]?.name, ref.row) || '').toLowerCase()
          return trimmed.toLowerCase()
        }
        case 'NOW': return new Date().toLocaleDateString()
        case 'TODAY': return new Date().toLocaleDateString()
        default: return '#NAME?'
      }
    }

    // Math expression with cell refs
    let mathExpr = expr
    const sortedCols = [...columns].sort((a, b) => b.name.length - a.name.length)
    for (const col of sortedCols) {
      const regex = new RegExp(`${escapeRegex(col.name)}(\\d+)`, 'gi')
      mathExpr = mathExpr.replace(regex, (_match, rowNum) => {
        const v = getCellValue(col.name, parseInt(rowNum) - 1)
        return String(typeof v === 'number' ? v : parseFloat(String(v)) || 0)
      })
    }
    mathExpr = mathExpr.replace(/\b([A-Z])(\d+)\b/gi, (_match, letter, rowNum) => {
      const idx = letter.toUpperCase().charCodeAt(0) - 65
      if (idx >= 0 && idx < columns.length) {
        const v = getCellValue(columns[idx].name, parseInt(rowNum) - 1)
        return String(typeof v === 'number' ? v : parseFloat(String(v)) || 0)
      }
      return '0'
    })

    if (/^[\d\s+\-*/%().]+$/.test(mathExpr)) {
      const result = Function(`"use strict"; return (${mathExpr})`)()
      if (typeof result === 'number' && isFinite(result)) {
        return Math.round(result * 1000000) / 1000000
      }
    }
    return '#ERROR!'
  } catch {
    return '#ERROR!'
  }
}

function evaluateCondition(cond: string, columns: Column[], getCellValue: CellGetter): boolean {
  const ops = ['>=', '<=', '<>', '!=', '=', '>', '<']
  for (const op of ops) {
    const idx = cond.indexOf(op)
    if (idx > 0) {
      const left = resolveCondValue(cond.slice(0, idx).trim(), columns, getCellValue)
      const right = resolveCondValue(cond.slice(idx + op.length).trim(), columns, getCellValue)
      const ln = typeof left === 'number' ? left : parseFloat(String(left)) || 0
      const rn = typeof right === 'number' ? right : parseFloat(String(right)) || 0
      switch (op) {
        case '>': return ln > rn
        case '<': return ln < rn
        case '>=': return ln >= rn
        case '<=': return ln <= rn
        case '=': return String(left) === String(right)
        case '<>': case '!=': return String(left) !== String(right)
      }
    }
  }
  return false
}

function resolveCondValue(val: string, columns: Column[], getCellValue: CellGetter): string | number {
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1)
  const n = parseFloat(val)
  if (!isNaN(n)) return n
  const ref = parseCellRef(val, columns)
  if (ref) {
    const v = getCellValue(columns[ref.col]?.name, ref.row)
    return v ?? 0
  }
  return val
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatCellDisplay(value: string | number, fmt?: CellFormat): string {
  if (typeof value === 'number') {
    if (fmt?.cur) {
      return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    if (Math.abs(value) >= 1000 && Number.isInteger(value)) {
      return value.toLocaleString()
    }
    return String(value)
  }
  return value
}

// Detect URLs in text
function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

// ─── Main Component ───

export default function DatabasePage() {
  const { user } = useCurrentUser()
  const [sheets, setSheets] = useState<SheetMeta[]>([])
  const [activeSheet, setActiveSheet] = useState<SheetDetail | null>(null)
  const [pendingOpenId, setPendingOpenId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [newSheetName, setNewSheetName] = useState('')
  const [showNewSheet, setShowNewSheet] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [sheetName, setSheetName] = useState('')
  const [sheetLabels, setSheetLabels] = useState('')
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [colWidths, setColWidths] = useState<Record<number, number>>({})
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({})
  const [resizingCol, setResizingCol] = useState<number | null>(null)
  const [resizingRow, setResizingRow] = useState<number | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: number; col?: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [formulaSuggestions, setFormulaSuggestions] = useState<string[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const addColumnRef = useRef<HTMLInputElement>(null)
  const [dragCol, setDragCol] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  // Multi-cell selection
  const [selectionRange, setSelectionRange] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const selectionAnchor = useRef<{ row: number; col: number } | null>(null)

  // Formatting state
  const [cellFormats, setCellFormats] = useState<Record<string, CellFormat>>({})
  const [frozenRows, setFrozenRows] = useState(0)
  const [merges, setMerges] = useState<{ r1: number; c1: number; r2: number; c2: number }[]>([])
  const [colDropdowns, setColDropdowns] = useState<Record<string, string[]>>({})
  const [showDropdownEditor, setShowDropdownEditor] = useState(false)
  const [dropdownEditCol, setDropdownEditCol] = useState<number | null>(null)
  const [dropdownEditValue, setDropdownEditValue] = useState('')
  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Column types (Notion-style)
  const [colTypes, setColTypes] = useState<Record<string, ColType>>({})
  const [colTags, setColTags] = useState<Record<string, TagOption[]>>({})
  const [colHeaderMenu, setColHeaderMenu] = useState<{ x: number; y: number; col: number } | null>(null)
  const [showTypePicker, setShowTypePicker] = useState(false)

  // Multi-select tags
  const [tagEditorCell, setTagEditorCell] = useState<{ row: number; col: number } | null>(null)
  const [tagSearch, setTagSearch] = useState('')
  const tagEditorRef = useRef<HTMLDivElement>(null)
  const tagSearchRef = useRef<HTMLInputElement>(null)

  // View state
  const [viewType, setViewType] = useState<ViewType>('table')
  const [hiddenColumns, setHiddenColumns] = useState<number[]>([])
  const [boardGroupBy, setBoardGroupBy] = useState<number | null>(null)
  const [showViewSwitcher, setShowViewSwitcher] = useState(false)
  const viewSwitcherRef = useRef<HTMLDivElement>(null)
  const [groupBy, setGroupBy] = useState<number | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Search, Sort, Filter, More menu state
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortRules, setSortRules] = useState<SortRule[]>([])
  const [showSortBuilder, setShowSortBuilder] = useState(false)
  const [filterRules, setFilterRules] = useState<FilterRule[]>([])
  const [showFilterBuilder, setShowFilterBuilder] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [detailRowId, setDetailRowId] = useState<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sortBuilderRef = useRef<HTMLDivElement>(null)
  const filterBuilderRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  // Undo/redo history (stores snapshots of rows)
  const undoStack = useRef<Record<string, unknown>[][]>([])
  const redoStack = useRef<Record<string, unknown>[][]>([])
  const MAX_UNDO = 50

  function pushUndo() {
    if (!activeSheet) return
    undoStack.current.push(JSON.parse(JSON.stringify(activeSheet.rows)))
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
    redoStack.current = []
  }

  function handleUndo() {
    if (!activeSheet || undoStack.current.length === 0) return
    const prev = undoStack.current.pop()!
    redoStack.current.push(JSON.parse(JSON.stringify(activeSheet.rows)))
    const newSheet = { ...activeSheet }
    newSheet.rows = prev
    setActiveSheet(newSheet)
    // Persist all rows back to server
    for (let i = 0; i < prev.length; i++) {
      const row = prev[i]
      const id = row._id as number
      if (id) apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: id, data: row })
    }
  }

  function handleRedo() {
    if (!activeSheet || redoStack.current.length === 0) return
    const next = redoStack.current.pop()!
    undoStack.current.push(JSON.parse(JSON.stringify(activeSheet.rows)))
    const newSheet = { ...activeSheet }
    newSheet.rows = next
    setActiveSheet(newSheet)
    for (let i = 0; i < next.length; i++) {
      const row = next[i]
      const id = row._id as number
      if (id) apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: id, data: row })
    }
  }

  // Clipboard for copy/paste
  const clipboard = useRef<{ data: (string | unknown)[][]; cols: number; rows: number } | null>(null)

  function handleCopy() {
    if (!activeSheet || !selectedCell) return
    const range = getNormalizedRange() || { r1: selectedCell.row, c1: selectedCell.col, r2: selectedCell.row, c2: selectedCell.col }
    const cols = activeSheet.columns
    const data: (string | unknown)[][] = []
    for (let r = range.r1; r <= range.r2; r++) {
      const rowData: (string | unknown)[] = []
      for (let c = range.c1; c <= range.c2; c++) {
        rowData.push(activeSheet.rows[r]?.[cols[c]?.name] ?? '')
      }
      data.push(rowData)
    }
    clipboard.current = { data, cols: range.c2 - range.c1 + 1, rows: range.r2 - range.r1 + 1 }
    // Also copy as plain text to system clipboard
    const text = data.map(row => row.map(v => String(v ?? '')).join('\t')).join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  function handlePaste() {
    if (!activeSheet || !selectedCell) return
    pushUndo()
    const cols = activeSheet.columns
    const newSheet = { ...activeSheet, rows: [...activeSheet.rows] }

    if (clipboard.current) {
      // Paste from internal clipboard
      const { data } = clipboard.current
      for (let dr = 0; dr < data.length; dr++) {
        const targetRow = selectedCell.row + dr
        if (targetRow >= newSheet.rows.length) break
        for (let dc = 0; dc < data[dr].length; dc++) {
          const targetCol = selectedCell.col + dc
          if (targetCol >= cols.length) break
          const colName = cols[targetCol].name
          const rowId = newSheet.rows[targetRow]?._id || newSheet.rows[targetRow]?.id
          const val = data[dr][dc]
          newSheet.rows[targetRow] = { ...newSheet.rows[targetRow], [colName]: val }
          if (rowId) apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: val } })
        }
      }
      setActiveSheet(newSheet)
    } else {
      // Fallback: read from system clipboard
      navigator.clipboard?.readText().then(text => {
        if (!text) return
        const rows = text.split('\n').map(line => line.split('\t'))
        const ns = { ...activeSheet, rows: [...activeSheet.rows] }
        for (let dr = 0; dr < rows.length; dr++) {
          const targetRow = selectedCell.row + dr
          if (targetRow >= ns.rows.length) break
          for (let dc = 0; dc < rows[dr].length; dc++) {
            const targetCol = selectedCell.col + dc
            if (targetCol >= cols.length) break
            const colName = cols[targetCol].name
            const rowId = ns.rows[targetRow]?._id || ns.rows[targetRow]?.id
            ns.rows[targetRow] = { ...ns.rows[targetRow], [colName]: rows[dr][dc] }
            if (rowId) apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: rows[dr][dc] } })
          }
        }
        setActiveSheet(ns)
      }).catch(() => {})
    }
  }

  function handleCut() {
    if (!activeSheet || !selectedCell) return
    handleCopy()
    pushUndo()
    const range = getNormalizedRange() || { r1: selectedCell.row, c1: selectedCell.col, r2: selectedCell.row, c2: selectedCell.col }
    const cols = activeSheet.columns
    const newSheet = { ...activeSheet, rows: [...activeSheet.rows] }
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const colName = cols[c]?.name
        const rowId = newSheet.rows[r]?._id || newSheet.rows[r]?.id
        if (colName && rowId) {
          newSheet.rows[r] = { ...newSheet.rows[r], [colName]: '' }
          apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: '' } })
        }
      }
    }
    setActiveSheet(newSheet)
  }

  const TAG_COLORS = [
    '#4a4a4a', '#8b7355', '#6b8e7b', '#7b6b8e', '#8e6b7b',
    '#6b7b8e', '#8e8b6b', '#6b8e8e', '#8e6b6b', '#7b8e6b',
  ]

  const FORMULAS = [
    { name: 'SUM', desc: 'Add values', syntax: 'SUM(range)' },
    { name: 'AVERAGE', desc: 'Calculate average', syntax: 'AVERAGE(range)' },
    { name: 'COUNT', desc: 'Count numbers', syntax: 'COUNT(range)' },
    { name: 'COUNTA', desc: 'Count non-empty', syntax: 'COUNTA(range)' },
    { name: 'MIN', desc: 'Minimum value', syntax: 'MIN(range)' },
    { name: 'MAX', desc: 'Maximum value', syntax: 'MAX(range)' },
    { name: 'IF', desc: 'Conditional', syntax: 'IF(condition, true, false)' },
    { name: 'ABS', desc: 'Absolute value', syntax: 'ABS(number)' },
    { name: 'ROUND', desc: 'Round number', syntax: 'ROUND(number, places)' },
    { name: 'SUMIF', desc: 'Conditional sum', syntax: 'SUMIF(range, criteria, sum_range)' },
    { name: 'COUNTIF', desc: 'Conditional count', syntax: 'COUNTIF(range, criteria)' },
    { name: 'CONCAT', desc: 'Join text', syntax: 'CONCAT(text1, text2, ...)' },
    { name: 'LEN', desc: 'Text length', syntax: 'LEN(text)' },
    { name: 'UPPER', desc: 'Uppercase', syntax: 'UPPER(text)' },
    { name: 'LOWER', desc: 'Lowercase', syntax: 'LOWER(text)' },
    { name: 'NOW', desc: 'Current date/time', syntax: 'NOW()' },
    { name: 'TODAY', desc: 'Current date', syntax: 'TODAY()' },
  ]

  const COL_WIDTH = 120

  // ─── Data Loading ───

  const fetchSheets = useCallback(async () => {
    try {
      const res = await fetch('/api/sheets')
      const data = await res.json()
      setSheets(data.sheets || [])
    } catch { /* */ }
    setLoading(false)
  }, [])

  const fetchSheet = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/sheets?id=${id}`)
      const data = await res.json()
      setActiveSheet(data)
      setSheetName(data.name)
      setSheetLabels(data.labels || '')
      // Load settings
      const settings: SheetSettings = data.settings || {}
      setCellFormats(settings.formats || {})
      setFrozenRows(settings.frozenRows || 0)
      setMerges(settings.merges || [])
      setColDropdowns(settings.dropdowns || {})
      setColTypes(settings.colTypes || {})
      setColTags(settings.colTags || {})
      setSortRules(settings.sortRules || [])
      setFilterRules(settings.filterRules || [])
      setViewType(settings.viewType || 'table')
      setHiddenColumns(settings.hiddenColumns || [])
      setBoardGroupBy(settings.boardGroupBy ?? null)
    } catch { /* */ }
  }, [])

  useEffect(() => { fetchSheets() }, [fetchSheets])

  // Read ?open= from URL on mount and open that sheet directly
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const openId = params.get('open') || params.get('id')
    const isNew = params.get('new') === '1'
    if (openId) {
      const id = Number(openId)
      if (id) {
        setPendingOpenId(id)
        fetchSheet(id).then(() => {
          // Auto-focus first cell if this is a new database
          if (isNew) {
            setTimeout(() => {
              setSelectedCell({ row: 0, col: 0 })
              setEditingCell({ row: 0, col: 0 })
              setEditValue('')
            }, 100)
          }
        })
      }
    }
  }, [fetchSheet])

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus()
  }, [editingCell])

  useEffect(() => {
    if (editingName && nameRef.current) {
      nameRef.current.focus()
      nameRef.current.select()
    }
  }, [editingName])

  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  // Close column header menu on click outside
  useEffect(() => {
    if (!colHeaderMenu) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-col-menu]')) { setColHeaderMenu(null); setShowTypePicker(false) }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [colHeaderMenu])

  // Close tag editor on click outside
  useEffect(() => {
    if (!tagEditorCell) return
    const handler = (e: MouseEvent) => {
      if (tagEditorRef.current && !tagEditorRef.current.contains(e.target as Node)) {
        setTagEditorCell(null)
        setTagSearch('')
      }
    }
    setTimeout(() => window.addEventListener('mousedown', handler), 0)
    return () => window.removeEventListener('mousedown', handler)
  }, [tagEditorCell])

  useEffect(() => {
    if (tagEditorCell && tagSearchRef.current) tagSearchRef.current.focus()
  }, [tagEditorCell])

  // Stop multi-cell selection on mouseup anywhere
  useEffect(() => {
    const handleMouseUp = () => {
      if (isSelecting) {
        setIsSelecting(false)
        selectionAnchor.current = null
      }
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [isSelecting])

  // Close sort/filter/more dropdowns on click outside
  useEffect(() => {
    if (!showSortBuilder && !showFilterBuilder && !showMoreMenu) return
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (showSortBuilder && sortBuilderRef.current && !sortBuilderRef.current.contains(t) && !t.closest('[data-sort-trigger]')) setShowSortBuilder(false)
      if (showFilterBuilder && filterBuilderRef.current && !filterBuilderRef.current.contains(t) && !t.closest('[data-filter-trigger]')) setShowFilterBuilder(false)
      if (showMoreMenu && moreMenuRef.current && !moreMenuRef.current.contains(t) && !t.closest('[data-more-trigger]')) setShowMoreMenu(false)
      if (showViewSwitcher && viewSwitcherRef.current && !viewSwitcherRef.current.contains(t) && !t.closest('[data-view-trigger]')) setShowViewSwitcher(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showSortBuilder, showFilterBuilder, showMoreMenu, showViewSwitcher])

  // Focus search input when opened
  useEffect(() => {
    if (showSearch && searchInputRef.current) searchInputRef.current.focus()
  }, [showSearch])

  // Global undo/redo (works even when container loses focus)
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (!activeSheet) return
      // Don't intercept if focus is in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); handleRedo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); handleRedo() }
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  })

  // Native paste event listener (works when navigator.clipboard.readText is blocked)
  useEffect(() => {
    function handleNativePaste(e: ClipboardEvent) {
      if (!activeSheet || !selectedCell || editingCell) return
      // Don't intercept if focus is on an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      pushUndo()
      const cols = activeSheet.columns
      const ns = { ...activeSheet, rows: [...activeSheet.rows] }
      const pasteRows = text.split('\n').map(line => line.split('\t'))
      for (let dr = 0; dr < pasteRows.length; dr++) {
        const targetRow = selectedCell.row + dr
        if (targetRow >= ns.rows.length) break
        for (let dc = 0; dc < pasteRows[dr].length; dc++) {
          const targetCol = selectedCell.col + dc
          if (targetCol >= cols.length) break
          const colName = cols[targetCol].name
          const rowId = ns.rows[targetRow]?._id || ns.rows[targetRow]?.id
          ns.rows[targetRow] = { ...ns.rows[targetRow], [colName]: pasteRows[dr][dc] }
          if (rowId) apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId as number, data: { [colName]: pasteRows[dr][dc] } })
        }
      }
      setActiveSheet(ns)
    }
    document.addEventListener('paste', handleNativePaste)
    return () => document.removeEventListener('paste', handleNativePaste)
  })

  // ─── processedRows Pipeline ───

  const processedRows = useMemo(() => {
    if (!activeSheet) return []
    let result: (Record<string, unknown> & { _originalIndex: number })[] = activeSheet.rows.map((row, originalIndex) => ({ ...row, _originalIndex: originalIndex }))

    // 1. Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(row =>
        activeSheet.columns.some(col => {
          const val = row[col.name]
          return val != null && String(val).toLowerCase().includes(q)
        })
      )
    }

    // 2. Filter rules
    for (const rule of filterRules) {
      const colName = activeSheet.columns[rule.column]?.name
      if (!colName) continue
      const ct = colTypes[String(rule.column)] || 'text'

      result = result.filter(row => {
        const raw = row[colName]
        const str = raw != null ? String(raw) : ''
        const isEmpty = !raw || str === '' || str === '[]'

        switch (rule.operator) {
          case 'is_empty': return isEmpty
          case 'is_not_empty': return !isEmpty
          case 'contains': return str.toLowerCase().includes(rule.value.toLowerCase())
          case 'does_not_contain': return !str.toLowerCase().includes(rule.value.toLowerCase())
          case 'equals': return str === rule.value
          case 'does_not_equal': return str !== rule.value
          case 'gt': return parseFloat(str) > parseFloat(rule.value)
          case 'lt': return parseFloat(str) < parseFloat(rule.value)
          case 'gte': return parseFloat(str) >= parseFloat(rule.value)
          case 'lte': return parseFloat(str) <= parseFloat(rule.value)
          case 'is': {
            // For select/status: check if tag array contains value
            let tags: string[] = []
            try { tags = JSON.parse(str) } catch { tags = str ? [str] : [] }
            return tags.includes(rule.value)
          }
          case 'is_not': {
            let tags: string[] = []
            try { tags = JSON.parse(str) } catch { tags = str ? [str] : [] }
            return !tags.includes(rule.value)
          }
          case 'before': return str < rule.value
          case 'after': return str > rule.value
          case 'is_checked': return raw === 'true' || raw === true
          case 'is_not_checked': return raw !== 'true' && raw !== true
          default: return true
        }
      })
    }

    // 3. Sort rules
    if (sortRules.length > 0) {
      result.sort((a, b) => {
        for (const rule of sortRules) {
          const colName = activeSheet.columns[rule.column]?.name
          if (!colName) continue
          const ct = colTypes[String(rule.column)] || 'text'
          const aVal = a[colName]
          const bVal = b[colName]
          const aStr = aVal != null ? String(aVal) : ''
          const bStr = bVal != null ? String(bVal) : ''
          let cmp = 0

          if (ct === 'number') {
            cmp = (parseFloat(aStr) || 0) - (parseFloat(bStr) || 0)
          } else if (ct === 'date') {
            cmp = aStr.localeCompare(bStr)
          } else if (ct === 'checkbox') {
            cmp = (aStr === 'true' ? 1 : 0) - (bStr === 'true' ? 1 : 0)
          } else {
            cmp = aStr.localeCompare(bStr)
          }

          if (cmp !== 0) return rule.direction === 'asc' ? cmp : -cmp
        }
        return 0
      })
    }

    return result
  }, [activeSheet, searchQuery, filterRules, sortRules, colTypes])

  // Helper: find original row index by _id (for mutations on filtered/sorted data)
  function findRowIndexById(rowId: number | unknown): number {
    if (!activeSheet) return -1
    return activeSheet.rows.findIndex(r => (r._id || r.id) === rowId)
  }

  // ─── Settings Persistence ───

  function saveSettings(
    newFormats?: Record<string, CellFormat>,
    newFrozen?: number,
    newMerges?: typeof merges,
    newDropdowns?: Record<string, string[]>,
    newColTypes?: Record<string, ColType>,
    newColTags?: Record<string, TagOption[]>,
    newSortRules?: SortRule[],
    newFilterRules?: FilterRule[],
    newViewType?: ViewType,
    newHiddenCols?: number[],
    newBoardGroupBy?: number | null
  ) {
    if (!activeSheet) return
    const settings: SheetSettings = {
      formats: newFormats ?? cellFormats,
      frozenRows: newFrozen ?? frozenRows,
      merges: newMerges ?? merges,
      dropdowns: newDropdowns ?? colDropdowns,
      colTypes: newColTypes ?? colTypes,
      colTags: newColTags ?? colTags,
      sortRules: newSortRules ?? sortRules,
      filterRules: newFilterRules ?? filterRules,
      viewType: newViewType ?? viewType,
      hiddenColumns: newHiddenCols ?? hiddenColumns,
      boardGroupBy: (newBoardGroupBy !== undefined ? newBoardGroupBy : boardGroupBy) ?? undefined,
    }
    // Debounce saves
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = setTimeout(() => {
      fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_settings', sheet_id: activeSheet.id, settings }),
      })
    }, 500)
  }

  // ─── API Action ───

  async function apiAction(body: Record<string, unknown>) {
    const res = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  // ─── Formatting Functions ───

  function getCellFormat(row: number, col: number): CellFormat {
    return cellFormats[`${row}:${col}`] || {}
  }

  function setCellFormat(row: number, col: number, updates: Partial<CellFormat>) {
    const key = `${row}:${col}`
    const current = cellFormats[key] || {}
    const next = { ...current, ...updates }
    // Remove false/undefined values to keep it clean
    for (const k of Object.keys(next) as (keyof CellFormat)[]) {
      if (next[k] === false || next[k] === undefined || next[k] === 0) delete next[k]
    }
    const newFormats = { ...cellFormats }
    if (Object.keys(next).length === 0) {
      delete newFormats[key]
    } else {
      newFormats[key] = next
    }
    setCellFormats(newFormats)
    saveSettings(newFormats)
  }

  // Get normalized selection range (r1<=r2, c1<=c2)
  function getNormalizedRange() {
    if (!selectionRange) return null
    return {
      r1: Math.min(selectionRange.r1, selectionRange.r2),
      c1: Math.min(selectionRange.c1, selectionRange.c2),
      r2: Math.max(selectionRange.r1, selectionRange.r2),
      c2: Math.max(selectionRange.c1, selectionRange.c2),
    }
  }

  function isInSelectionRange(ri: number, ci: number): boolean {
    const range = getNormalizedRange()
    if (!range) return false
    return ri >= range.r1 && ri <= range.r2 && ci >= range.c1 && ci <= range.c2
  }

  function forEachSelectedCell(fn: (row: number, col: number) => void) {
    const range = getNormalizedRange()
    if (range) {
      for (let r = range.r1; r <= range.r2; r++) {
        for (let c = range.c1; c <= range.c2; c++) fn(r, c)
      }
    } else if (selectedCell) {
      fn(selectedCell.row, selectedCell.col)
    }
  }

  function toggleFormat(key: keyof CellFormat) {
    if (!selectedCell && !selectionRange) return
    // Use the anchor cell to determine the toggle state
    const anchor = selectedCell || (selectionRange ? { row: Math.min(selectionRange.r1, selectionRange.r2), col: Math.min(selectionRange.c1, selectionRange.c2) } : null)
    if (!anchor) return
    const anchorFmt = getCellFormat(anchor.row, anchor.col)
    const newVal = !anchorFmt[key]
    const newFormats = { ...cellFormats }
    forEachSelectedCell((r, c) => {
      const k = `${r}:${c}`
      const current = newFormats[k] || {}
      const next = { ...current, [key]: newVal }
      for (const prop of Object.keys(next) as (keyof CellFormat)[]) {
        if (next[prop] === false || next[prop] === undefined || next[prop] === 0) delete next[prop]
      }
      if (Object.keys(next).length === 0) delete newFormats[k]
      else newFormats[k] = next
    })
    setCellFormats(newFormats)
    saveSettings(newFormats)
  }

  function setRotation(deg: number) {
    if (!selectedCell && !selectionRange) return
    const anchor = selectedCell || (selectionRange ? { row: Math.min(selectionRange.r1, selectionRange.r2), col: Math.min(selectionRange.c1, selectionRange.c2) } : null)
    if (!anchor) return
    const anchorFmt = getCellFormat(anchor.row, anchor.col)
    const newRot = anchorFmt.rot === deg ? 0 : deg
    const newFormats = { ...cellFormats }
    forEachSelectedCell((r, c) => {
      const k = `${r}:${c}`
      const current = newFormats[k] || {}
      const next = { ...current, rot: newRot }
      for (const prop of Object.keys(next) as (keyof CellFormat)[]) {
        if (next[prop] === false || next[prop] === undefined || next[prop] === 0) delete next[prop]
      }
      if (Object.keys(next).length === 0) delete newFormats[k]
      else newFormats[k] = next
    })
    setCellFormats(newFormats)
    saveSettings(newFormats)
  }

  function setBorder(style: string) {
    if (!selectedCell && !selectionRange) return
    const anchor = selectedCell || (selectionRange ? { row: Math.min(selectionRange.r1, selectionRange.r2), col: Math.min(selectionRange.c1, selectionRange.c2) } : null)
    if (!anchor) return
    const anchorFmt = getCellFormat(anchor.row, anchor.col)
    const newBdr = anchorFmt.bdr === style ? undefined : style
    const newFormats = { ...cellFormats }
    forEachSelectedCell((r, c) => {
      const k = `${r}:${c}`
      const current = newFormats[k] || {}
      const next = { ...current, bdr: newBdr }
      for (const prop of Object.keys(next) as (keyof CellFormat)[]) {
        if (next[prop] === false || next[prop] === undefined || next[prop] === 0) delete next[prop]
      }
      if (Object.keys(next).length === 0) delete newFormats[k]
      else newFormats[k] = next
    })
    setCellFormats(newFormats)
    saveSettings(newFormats)
  }

  function toggleFreezeRow() {
    const next = frozenRows > 0 ? 0 : 1
    setFrozenRows(next)
    saveSettings(undefined, next)
  }

  // ─── Cell Editing ───

  function startEdit(row: number, col: number) {
    if (!activeSheet) return
    const colName = activeSheet.columns[col]?.name
    if (!colName) return
    const value = activeSheet.rows[row]?.[colName]
    setEditingCell({ row, col })
    setEditValue(value != null ? String(value) : '')
    setSelectedCell({ row, col })
    setFormulaSuggestions([])
    setSelectedSuggestion(0)
  }

  function updateEditValue(newValue: string) {
    setEditValue(newValue)
    if (newValue.startsWith('=')) {
      const typed = newValue.slice(1).toUpperCase()
      if (typed.length === 0) {
        setFormulaSuggestions(FORMULAS.map(f => f.name))
      } else if (!typed.includes('(')) {
        setFormulaSuggestions(FORMULAS.filter(f => f.name.startsWith(typed)).map(f => f.name))
      } else {
        setFormulaSuggestions([])
      }
      setSelectedSuggestion(0)
    } else {
      setFormulaSuggestions([])
    }
  }

  function insertFormula(formulaName: string) {
    const formula = FORMULAS.find(f => f.name === formulaName)
    if (formula) {
      setEditValue('=' + formula.name + '(')
      setFormulaSuggestions([])
      inputRef.current?.focus()
    }
  }

  async function commitEdit() {
    if (!editingCell || !activeSheet) return
    pushUndo()
    const colName = activeSheet.columns[editingCell.col]?.name
    const rowData = activeSheet.rows[editingCell.row]
    const rowId = rowData?._id || rowData?.id
    if (rowId && colName) {
      await apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: editValue } })
      const newSheet = { ...activeSheet }
      newSheet.rows = [...newSheet.rows]
      newSheet.rows[editingCell.row] = { ...newSheet.rows[editingCell.row], [colName]: editValue }
      setActiveSheet(newSheet)
    }
    setEditingCell(null)
  }

  // ─── Sheet CRUD ───

  async function createSheet() {
    const name = newSheetName.trim() || 'Untitled Database'
    const data = await apiAction({ action: 'create_sheet', name })
    setNewSheetName('')
    setShowNewSheet(false)
    if (data.id) {
      await apiAction({ action: 'add_column', sheet_id: data.id, name: 'Name', type: 'text' })
      await apiAction({ action: 'add_row', sheet_id: data.id, data: {} })
      await fetchSheet(data.id)
      // Auto-focus first cell for immediate editing
      setTimeout(() => {
        setSelectedCell({ row: 0, col: 0 })
        setEditingCell({ row: 0, col: 0 })
        setEditValue('')
      }, 100)
      fetchSheets() // refresh list in background
    }
  }

  async function deleteSheet() {
    if (!activeSheet) return
    if (!confirm('Delete this database?')) return
    await apiAction({ action: 'delete_sheet', sheet_id: activeSheet.id })
    setActiveSheet(null)
    fetchSheets()
  }

  // ─── Column Operations ───

  function addColumn() {
    if (!activeSheet) return
    setShowAddColumn(true)
    setNewColumnName('Text')
    setTimeout(() => { addColumnRef.current?.focus(); addColumnRef.current?.select() }, 50)
  }

  async function confirmAddColumn() {
    if (!activeSheet || !newColumnName.trim()) return
    await apiAction({ action: 'add_column', sheet_id: activeSheet.id, name: newColumnName.trim(), type: 'text' })
    setShowAddColumn(false)
    setNewColumnName('')
    fetchSheet(activeSheet.id)
  }

  async function reorderColumns(fromIndex: number, toIndex: number) {
    if (!activeSheet || fromIndex === toIndex) return
    const cols = [...activeSheet.columns]
    const [moved] = cols.splice(fromIndex, 1)
    // After removing from fromIndex, if we're moving right, the target shifts left by 1
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex
    cols.splice(insertAt, 0, moved)

    // Remap colTypes and colTags from old indices to new indices
    const oldCols = activeSheet.columns
    const newTypes: Record<string, ColType> = {}
    const newTags: Record<string, { name: string; color: string }[]> = {}
    cols.forEach((col, newIdx) => {
      const oldIdx = oldCols.findIndex(c => c.name === col.name)
      if (colTypes[String(oldIdx)]) newTypes[String(newIdx)] = colTypes[String(oldIdx)]
      if (colTags[String(oldIdx)]) newTags[String(newIdx)] = colTags[String(oldIdx)]
    })
    setColTypes(newTypes)
    setColTags(newTags)

    // Reorder columns on server
    await apiAction({ action: 'reorder_columns', sheet_id: activeSheet.id, column_order: cols.map(c => c.name) })

    // Save remapped settings synchronously (bypass debounce)
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current)
    const settings: SheetSettings = {
      formats: cellFormats, frozenRows, merges, dropdowns: colDropdowns,
      colTypes: newTypes, colTags: newTags, sortRules, filterRules,
      viewType, hiddenColumns, boardGroupBy: boardGroupBy ?? undefined,
    }
    await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_settings', sheet_id: activeSheet.id, settings }),
    })

    // Now fetch the updated sheet
    fetchSheet(activeSheet.id)
  }

  async function deleteColumn(colIndex: number) {
    if (!activeSheet) return
    const colName = activeSheet.columns[colIndex]?.name
    if (!colName) return
    await apiAction({ action: 'delete_column', sheet_id: activeSheet.id, column_name: colName })
    fetchSheet(activeSheet.id)
  }

  // ─── Row Operations ───

  async function addRows(count: number, autoFocusName = false) {
    if (!activeSheet) return
    for (let i = 0; i < count; i++) {
      await apiAction({ action: 'add_row', sheet_id: activeSheet.id, data: {} })
    }
    const currentRowCount = activeSheet.rows.length
    await fetchSheet(activeSheet.id)
    if (autoFocusName) {
      // Focus the Name cell (col 0) of the first new row
      setTimeout(() => {
        setSelectedCell({ row: currentRowCount, col: 0 })
        setEditingCell({ row: currentRowCount, col: 0 })
        setEditValue('')
      }, 50)
    }
  }

  async function deleteRow(rowIndex: number) {
    if (!activeSheet) return
    const row = activeSheet.rows[rowIndex]
    const rowId = row?._id || row?.id
    if (!rowId) return
    await apiAction({ action: 'delete_row', sheet_id: activeSheet.id, row_id: rowId })
    fetchSheet(activeSheet.id)
  }

  function handleRowClick(rowIndex: number, e: React.MouseEvent) {
    if (e.shiftKey && selectedRows.size > 0) {
      const existing = Array.from(selectedRows)
      const anchor = existing[existing.length - 1]
      const newSet = new Set(selectedRows)
      for (let i = Math.min(anchor, rowIndex); i <= Math.max(anchor, rowIndex); i++) newSet.add(i)
      setSelectedRows(newSet)
    } else if (e.metaKey || e.ctrlKey) {
      const newSet = new Set(selectedRows)
      if (newSet.has(rowIndex)) newSet.delete(rowIndex)
      else newSet.add(rowIndex)
      setSelectedRows(newSet)
    } else {
      setSelectedRows(new Set([rowIndex]))
    }
  }

  function handleRowContext(e: React.MouseEvent, rowIndex: number, colIndex?: number) {
    e.preventDefault()
    if (!selectedRows.has(rowIndex)) setSelectedRows(new Set([rowIndex]))
    setContextMenu({ x: e.clientX, y: e.clientY, row: rowIndex, col: colIndex })
  }

  function openRowMenu(e: React.MouseEvent, rowIndex: number) {
    e.stopPropagation()
    setSelectedRows(new Set([rowIndex]))
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({ x: rect.left, y: rect.bottom + 2, row: rowIndex })
  }

  async function duplicateSelectedRows() {
    if (!activeSheet) return
    for (const ri of Array.from(selectedRows).sort((a, b) => a - b)) {
      const row = activeSheet.rows[ri]
      if (!row) continue
      const data: Record<string, unknown> = {}
      for (const col of activeSheet.columns) {
        if (row[col.name] != null) data[col.name] = row[col.name]
      }
      await apiAction({ action: 'add_row', sheet_id: activeSheet.id, data })
    }
    fetchSheet(activeSheet.id)
    setContextMenu(null)
    setSelectedRows(new Set())
  }

  async function deleteSelectedRows() {
    if (!activeSheet) return
    for (const ri of Array.from(selectedRows).sort((a, b) => b - a)) {
      const row = activeSheet.rows[ri]
      const rowId = row?._id || row?.id
      if (rowId) await apiAction({ action: 'delete_row', sheet_id: activeSheet.id, row_id: rowId })
    }
    fetchSheet(activeSheet.id)
    setContextMenu(null)
    setSelectedRows(new Set())
  }

  async function insertRowAbove() {
    if (!activeSheet) return
    await apiAction({ action: 'add_row', sheet_id: activeSheet.id, data: {} })
    fetchSheet(activeSheet.id)
    setContextMenu(null)
  }

  async function importCsv() {
    if (!activeSheet || !csvText.trim()) return
    await apiAction({ action: 'import_csv', sheet_id: activeSheet.id, csv: csvText })
    setCsvText('')
    setShowImport(false)
    fetchSheet(activeSheet.id)
  }

  // ─── Column Drag & Drop ───

  const colDragRef = useRef<{ from: number; current: number | null } | null>(null)

  function startColDrag(colIndex: number) {
    setDragCol(colIndex)
    setDropTarget(null)
    colDragRef.current = { from: colIndex, current: null }

    function onMouseMove(e: MouseEvent) {
      // Find which th we're over
      const els = document.querySelectorAll('[data-col-idx]')
      let found: number | null = null
      els.forEach(el => {
        const rect = el.getBoundingClientRect()
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          found = parseInt(el.getAttribute('data-col-idx') || '-1')
        }
      })
      if (found !== null && colDragRef.current) {
        colDragRef.current.current = found
        setDropTarget(found)
      }
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      const ref = colDragRef.current
      if (ref && ref.current !== null && ref.from !== ref.current) {
        reorderColumns(ref.from, ref.current)
      }
      setDragCol(null)
      setDropTarget(null)
      colDragRef.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // ─── Resize Handlers ───

  function startColResize(e: React.MouseEvent, colIndex: number) {
    e.preventDefault()
    e.stopPropagation()
    setResizingCol(colIndex)
    const startX = e.clientX
    const startWidth = colWidths[colIndex] || COL_WIDTH
    function onMove(ev: MouseEvent) {
      setColWidths(prev => ({ ...prev, [colIndex]: Math.max(60, startWidth + ev.clientX - startX) }))
    }
    function onUp() {
      setResizingCol(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startRowResize(e: React.MouseEvent, rowIndex: number) {
    e.preventDefault()
    e.stopPropagation()
    setResizingRow(rowIndex)
    const startY = e.clientY
    const startHeight = rowHeights[rowIndex] || 30
    function onMove(ev: MouseEvent) {
      setRowHeights(prev => ({ ...prev, [rowIndex]: Math.max(24, startHeight + ev.clientY - startY) }))
    }
    function onUp() {
      setResizingRow(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ─── Keyboard Handler ───

  function handleKeyDown(e: React.KeyboardEvent) {
    // Always prevent Backspace from navigating back
    if (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
    }

    if (!activeSheet) return
    const maxRow = activeSheet.rows.length - 1
    const maxCol = activeSheet.columns.length - 1

    // Undo/Redo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); handleRedo(); return }
    if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); handleRedo(); return }

    if (editingCell) {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); if (editingCell.row < maxRow) setSelectedCell({ row: editingCell.row + 1, col: editingCell.col }) }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); if (e.shiftKey) { if (editingCell.col > 0) setSelectedCell({ row: editingCell.row, col: editingCell.col - 1 }) } else { if (editingCell.col < maxCol) setSelectedCell({ row: editingCell.row, col: editingCell.col + 1 }) } }
      else if (e.key === 'Escape') { setEditingCell(null) }
      return
    }

    if (selectedCell) {
      const { row, col } = selectedCell
      // Copy/Paste/Cut
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key === 'c') { e.preventDefault(); handleCopy(); return }
        if (e.key === 'v') { e.preventDefault(); handlePaste(); return }
        if (e.key === 'x') { e.preventDefault(); handleCut(); return }
      }
      // Format shortcuts
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key === 'b') { e.preventDefault(); toggleFormat('b'); return }
        if (e.key === 'i') { e.preventDefault(); toggleFormat('i'); return }
      }
      // Shift+Arrow: extend selection range
      if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const range = selectionRange || { r1: row, c1: col, r2: row, c2: col }
        const nr = { ...range }
        if (e.key === 'ArrowUp' && nr.r2 > 0) nr.r2--
        else if (e.key === 'ArrowDown' && nr.r2 < maxRow) nr.r2++
        else if (e.key === 'ArrowLeft' && nr.c2 > 0) nr.c2--
        else if (e.key === 'ArrowRight' && nr.c2 < maxCol) nr.c2++
        setSelectionRange(nr)
        return
      }
      if (e.key === 'ArrowUp' && row > 0) { setSelectedCell({ row: row - 1, col }); setSelectionRange(null); e.preventDefault() }
      else if (e.key === 'ArrowDown' && row < maxRow) { setSelectedCell({ row: row + 1, col }); setSelectionRange(null); e.preventDefault() }
      else if (e.key === 'ArrowLeft' && col > 0) { setSelectedCell({ row, col: col - 1 }); setSelectionRange(null); e.preventDefault() }
      else if (e.key === 'ArrowRight' && col < maxCol) { setSelectedCell({ row, col: col + 1 }); setSelectionRange(null); e.preventDefault() }
      else if (e.key === 'Tab') { e.preventDefault(); setSelectionRange(null); if (e.shiftKey) { if (col > 0) setSelectedCell({ row, col: col - 1 }) } else { if (col < maxCol) setSelectedCell({ row, col: col + 1 }) } }
      else if (e.key === 'Enter') { e.preventDefault(); startEdit(row, col) }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        pushUndo()
        // Delete all cells in selection range
        const range = getNormalizedRange()
        if (range && (range.r1 !== range.r2 || range.c1 !== range.c2)) {
          const newSheet = { ...activeSheet, rows: [...activeSheet.rows] }
          forEachSelectedCell((r, c) => {
            const cn = activeSheet.columns[c]?.name
            const rd = activeSheet.rows[r]
            const rid = rd?._id || rd?.id
            if (rid && cn) {
              apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rid, data: { [cn]: '' } })
              newSheet.rows[r] = { ...newSheet.rows[r], [cn]: '' }
            }
          })
          setActiveSheet(newSheet)
          return
        }
        const colName = activeSheet.columns[col]?.name
        const rowData = activeSheet.rows[row]
        const rowId = rowData?._id || rowData?.id
        if (rowId && colName) {
          apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: '' } })
          const newSheet = { ...activeSheet, rows: [...activeSheet.rows] }
          newSheet.rows[row] = { ...newSheet.rows[row], [colName]: '' }
          setActiveSheet(newSheet)
        }
      }
      else if (e.key === 'Escape') {
        setSelectionRange(null)
        setSelectedCell(null)
      }
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        setSelectionRange(null)
        startEdit(row, col)
        setEditValue(e.key)
        e.preventDefault()
      }
    }
  }

  // ─── Tag Options Management ───

  function openTagOptionsEditor(colIndex: number) {
    setDropdownEditCol(colIndex)
    setShowDropdownEditor(true)
    setDropdownEditValue('')
  }

  function addTagOption(ci: number, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = colTags[String(ci)] || []
    if (existing.find(t => t.name.toLowerCase() === trimmed.toLowerCase())) return
    const color = TAG_COLORS[existing.length % TAG_COLORS.length]
    const nextTags = { ...colTags, [String(ci)]: [...existing, { name: trimmed, color }] }
    setColTags(nextTags)
    saveSettings(undefined, undefined, undefined, undefined, undefined, nextTags)
  }

  function deleteTagOption(ci: number, tagName: string) {
    const existing = colTags[String(ci)] || []
    const nextTags = { ...colTags, [String(ci)]: existing.filter(t => t.name !== tagName) }
    setColTags(nextTags)
    saveSettings(undefined, undefined, undefined, undefined, undefined, nextTags)
  }

  function updateTagColor(ci: number, tagName: string, color: string) {
    const existing = colTags[String(ci)] || []
    const nextTags = { ...colTags, [String(ci)]: existing.map(t => t.name === tagName ? { ...t, color } : t) }
    setColTags(nextTags)
    saveSettings(undefined, undefined, undefined, undefined, undefined, nextTags)
  }

  function renameTagOption(ci: number, oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    const existing = colTags[String(ci)] || []
    if (existing.find(t => t.name.toLowerCase() === trimmed.toLowerCase() && t.name !== oldName)) return
    const nextTags = { ...colTags, [String(ci)]: existing.map(t => t.name === oldName ? { ...t, name: trimmed } : t) }
    setColTags(nextTags)
    saveSettings(undefined, undefined, undefined, undefined, undefined, nextTags)
    // Also update any cells that have this tag
    if (activeSheet) {
      const colName = activeSheet.columns[ci]?.name
      if (colName) {
        for (let ri = 0; ri < activeSheet.rows.length; ri++) {
          const tags = getTagsForCell(ri, ci)
          if (tags.includes(oldName)) {
            const next = tags.map(t => t === oldName ? trimmed : t)
            const rowData = activeSheet.rows[ri]
            const rowId = rowData?._id || rowData?.id
            if (rowId) {
              apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: JSON.stringify(next) } })
            }
          }
        }
      }
    }
  }

  // ─── Column Type Management ───

  function getColType(ci: number): ColType {
    return colTypes[String(ci)] || 'text'
  }

  function setColumnType(ci: number, type: ColType) {
    if (!activeSheet) return
    const next = { ...colTypes, [String(ci)]: type }
    if (type === 'text') delete next[String(ci)]
    setColTypes(next)

    // Auto-rename column if it has a generic name (col_N, single letter, or a previous type label)
    const currentName = activeSheet.columns[ci]?.name || ''
    const typeLabels = COL_TYPE_INFO.map(t => t.label)
    const isGeneric = /^col_\d+$/i.test(currentName) || /^[A-Z]$/i.test(currentName) || typeLabels.includes(currentName)
    if (isGeneric && ci > 0) {
      const newLabel = COL_TYPE_INFO.find(t => t.type === type)?.label || 'Text'
      apiAction({ action: 'rename_column', sheet_id: activeSheet.id, old_name: currentName, new_name: newLabel }).then(() => fetchSheet(activeSheet.id))
    }

    // If switching to select/multi-select, ensure tags exist
    if ((type === 'select' || type === 'multi-select') && !colTags[String(ci)]) {
      const nextTags = { ...colTags, [String(ci)]: [] }
      setColTags(nextTags)
      saveSettings(undefined, undefined, undefined, undefined, next, nextTags)
    } else if (type === 'status') {
      // Auto-add status options
      const nextTags = { ...colTags, [String(ci)]: STATUS_OPTIONS }
      setColTags(nextTags)
      saveSettings(undefined, undefined, undefined, undefined, next, nextTags)
    } else {
      saveSettings(undefined, undefined, undefined, undefined, next)
    }
    setColHeaderMenu(null)
    setShowTypePicker(false)
  }

  function handleColHeaderContext(e: React.MouseEvent, ci: number) {
    e.preventDefault()
    setColHeaderMenu({ x: e.clientX, y: e.clientY, col: ci })
    setShowTypePicker(false)
  }

  // ─── Tag Functions ───

  function getTagsForCell(row: number, col: number): string[] {
    if (!activeSheet) return []
    const colName = activeSheet.columns[col]?.name
    const raw = activeSheet.rows[row]?.[colName]
    if (!raw) return []
    const str = String(raw)
    try { return JSON.parse(str) } catch { return str ? [str] : [] }
  }

  function getTagColor(ci: number, tagName: string): string {
    const tags = colTags[String(ci)] || []
    const found = tags.find(t => t.name === tagName)
    return found?.color || TAG_COLORS[0]
  }

  async function toggleTag(row: number, col: number, tagName: string) {
    if (!activeSheet) return
    pushUndo()
    const current = getTagsForCell(row, col)
    const colType = getColType(col)
    let next: string[]
    if (colType === 'select' || colType === 'status') {
      // Single select: toggle off or replace
      next = current.includes(tagName) ? [] : [tagName]
    } else {
      // Multi-select: toggle in array
      next = current.includes(tagName) ? current.filter(t => t !== tagName) : [...current, tagName]
    }
    const value = next.length === 0 ? '' : JSON.stringify(next)
    const colName = activeSheet.columns[col]?.name
    const rowData = activeSheet.rows[row]
    const rowId = rowData?._id || rowData?.id
    if (rowId && colName) {
      await apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: value } })
      const newSheet = { ...activeSheet, rows: [...activeSheet.rows] }
      newSheet.rows[row] = { ...newSheet.rows[row], [colName]: value }
      setActiveSheet(newSheet)
    }
  }

  function addNewTag(ci: number, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = colTags[String(ci)] || []
    if (existing.find(t => t.name === trimmed)) return
    const color = TAG_COLORS[existing.length % TAG_COLORS.length]
    const nextTags = { ...colTags, [String(ci)]: [...existing, { name: trimmed, color }] }
    setColTags(nextTags)
    saveSettings(undefined, undefined, undefined, undefined, undefined, nextTags)
    return trimmed
  }

  function removeTag(ci: number, tagName: string) {
    const existing = colTags[String(ci)] || []
    const nextTags = { ...colTags, [String(ci)]: existing.filter(t => t.name !== tagName) }
    setColTags(nextTags)
    saveSettings(undefined, undefined, undefined, undefined, undefined, nextTags)
  }

  async function toggleCheckbox(row: number, col: number) {
    if (!activeSheet) return
    pushUndo()
    const colName = activeSheet.columns[col]?.name
    const raw = activeSheet.rows[row]?.[colName]
    const checked = raw === 'true' || raw === true
    const value = checked ? '' : 'true'
    const rowData = activeSheet.rows[row]
    const rowId = rowData?._id || rowData?.id
    if (rowId && colName) {
      await apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: value } })
      const newSheet = { ...activeSheet, rows: [...activeSheet.rows] }
      newSheet.rows[row] = { ...newSheet.rows[row], [colName]: value }
      setActiveSheet(newSheet)
    }
  }

  // ─── Sort & Filter Management ───

  function addSortRule(column: number, direction: 'asc' | 'desc') {
    // Replace existing rule for same column, or add new
    const existing = sortRules.findIndex(r => r.column === column)
    let next: SortRule[]
    if (existing >= 0) {
      next = [...sortRules]
      next[existing] = { column, direction }
    } else {
      next = [...sortRules, { column, direction }]
    }
    setSortRules(next)
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, next)
  }

  function removeSortRule(index: number) {
    const next = sortRules.filter((_, i) => i !== index)
    setSortRules(next)
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, next)
  }

  function clearAllSorts() {
    setSortRules([])
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, [])
  }

  function addFilterRule(column?: number) {
    const col = column ?? 0
    const ct = colTypes[String(col)] || 'text'
    const ops = FILTER_OPS_BY_TYPE[ct]
    const rule: FilterRule = { id: String(Date.now()), column: col, operator: ops[0].value, value: '' }
    const next = [...filterRules, rule]
    setFilterRules(next)
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, next)
    setShowFilterBuilder(true)
  }

  function updateFilterRule(id: string, updates: Partial<FilterRule>) {
    const next = filterRules.map(r => r.id === id ? { ...r, ...updates } : r)
    setFilterRules(next)
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, next)
  }

  function removeFilterRule(id: string) {
    const next = filterRules.filter(r => r.id !== id)
    setFilterRules(next)
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, next)
  }

  function clearAllFilters() {
    setFilterRules([])
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, [])
  }

  // ─── View Management ───

  function switchView(v: ViewType) {
    setViewType(v)
    setShowViewSwitcher(false)
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, v)
    // Auto-find board group-by column if switching to board
    if (v === 'board' && boardGroupBy === null && activeSheet) {
      const statusCol = activeSheet.columns.findIndex((_, ci) => {
        const ct = colTypes[String(ci)]
        return ct === 'status' || ct === 'select'
      })
      if (statusCol >= 0) {
        setBoardGroupBy(statusCol)
        saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, v, undefined, statusCol)
      }
    }
  }

  function toggleColumnVisibility(ci: number) {
    const next = hiddenColumns.includes(ci) ? hiddenColumns.filter(c => c !== ci) : [...hiddenColumns, ci]
    setHiddenColumns(next)
    saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, next)
  }

  // ─── Merge Cells ───

  function isMerged(ri: number, ci: number): { r1: number; c1: number; r2: number; c2: number } | null {
    return merges.find(m => ri >= m.r1 && ri <= m.r2 && ci >= m.c1 && ci <= m.c2) || null
  }

  function isMergeOrigin(ri: number, ci: number): boolean {
    return merges.some(m => m.r1 === ri && m.c1 === ci)
  }

  function isMergedHidden(ri: number, ci: number): boolean {
    const m = isMerged(ri, ci)
    return m !== null && !(m.r1 === ri && m.c1 === ci)
  }

  function toggleMerge() {
    if (!selectedCell) return
    const existing = isMerged(selectedCell.row, selectedCell.col)
    if (existing) {
      const next = merges.filter(m => m !== existing)
      setMerges(next)
      saveSettings(undefined, undefined, next)
    } else {
      const range = getNormalizedRange()
      if (range && (range.r1 !== range.r2 || range.c1 !== range.c2)) {
        // Merge from selection range
        const newMerge = { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 }
        const next = [...merges, newMerge]
        setMerges(next)
        saveSettings(undefined, undefined, next)
      } else if (selectedRows.size >= 2) {
        const sorted = Array.from(selectedRows).sort((a, b) => a - b)
        const newMerge = { r1: sorted[0], c1: selectedCell.col, r2: sorted[sorted.length - 1], c2: selectedCell.col }
        const next = [...merges, newMerge]
        setMerges(next)
        saveSettings(undefined, undefined, next)
      }
    }
  }

  // ─── Render ───

  if (loading || (pendingOpenId && !activeSheet)) {
    return <div className="h-full flex items-center justify-center text-text-dim text-[14px]">Loading...</div>
  }

  if (activeSheet) {
    const cols = activeSheet.columns
    const rows = activeSheet.rows

    return (
      <div ref={containerRef} className="h-full flex flex-col overflow-hidden outline-none" onKeyDown={handleKeyDown} tabIndex={0}>
        {/* Title Area */}
        <div className="px-12 pt-10 pb-1 flex-shrink-0">
          {editingName ? (
            <input
              ref={nameRef}
              className="text-[32px] font-bold text-text bg-transparent outline-none w-full placeholder:text-text-dim/30"
              placeholder="Untitled"
              value={sheetName}
              onChange={e => setSheetName(e.target.value)}
              onBlur={() => {
                setEditingName(false)
                if (sheetName.trim() && sheetName !== activeSheet.name) {
                  apiAction({ action: 'rename_sheet', sheet_id: activeSheet.id, name: sheetName.trim() }).then(() => fetchSheet(activeSheet.id))
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setEditingName(false); setSheetName(activeSheet.name) } }}
            />
          ) : (
            <h1 className="text-[32px] font-bold text-text/80 cursor-pointer hover:text-text transition-colors" onClick={() => setEditingName(true)}>
              {activeSheet.name}
            </h1>
          )}
        </div>

        {/* View Bar */}
        <div className="flex items-center gap-2 px-12 py-2 flex-shrink-0">
          {/* View switcher */}
          <div className="relative">
            <button data-view-trigger onClick={() => setShowViewSwitcher(!showViewSwitcher)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] font-medium text-text hover:bg-hover transition-colors" style={{ background: 'rgba(255,255,255,0.07)' }}>
              {viewType === 'table' && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="12" height="12" rx="1.5" /><line x1="2" y1="6" x2="14" y2="6" /><line x1="2" y1="10" x2="14" y2="10" /><line x1="6" y1="2" x2="6" y2="14" /></svg>}
              {viewType === 'board' && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="2" width="4" height="12" rx="1" /><rect x="6" y="2" width="4" height="8" rx="1" /><rect x="11" y="2" width="4" height="10" rx="1" /></svg>}
              {viewType === 'list' && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="12" x2="10" y2="12" /></svg>}
              {viewType === 'table' ? 'Table' : viewType === 'board' ? 'Board' : 'List'}
              <IconChevronDown size={8} strokeWidth={1.2} />
            </button>
            {showViewSwitcher && (
              <div ref={viewSwitcherRef} className="absolute left-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[180px]" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }}>
                <div className="px-3 py-1.5 text-[10px] text-text-dim font-medium uppercase tracking-wider">Views</div>
                <button onClick={() => switchView('table')} className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors hover:bg-hover ${viewType === 'table' ? 'text-accent-text' : 'text-text'}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="12" height="12" rx="1.5" /><line x1="2" y1="6" x2="14" y2="6" /><line x1="2" y1="10" x2="14" y2="10" /><line x1="6" y1="2" x2="6" y2="14" /></svg>
                  Table
                </button>
                <button onClick={() => switchView('board')} className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors hover:bg-hover ${viewType === 'board' ? 'text-accent-text' : 'text-text'}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="2" width="4" height="12" rx="1" /><rect x="6" y="2" width="4" height="8" rx="1" /><rect x="11" y="2" width="4" height="10" rx="1" /></svg>
                  Board
                </button>
                <button onClick={() => switchView('list')} className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors hover:bg-hover ${viewType === 'list' ? 'text-accent-text' : 'text-text'}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><line x1="2" y1="4" x2="14" y2="4" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="12" x2="10" y2="12" /></svg>
                  List
                </button>
                {viewType === 'board' && (
                  <>
                    <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="px-3 py-1.5 text-[10px] text-text-dim font-medium uppercase tracking-wider">Group by</div>
                    {cols.map((c, ci) => {
                      const ct = colTypes[String(ci)]
                      if (ct !== 'select' && ct !== 'status' && ct !== 'multi-select') return null
                      return (
                        <button key={ci} onClick={() => { setBoardGroupBy(ci); saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ci); setShowViewSwitcher(false) }} className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover ${boardGroupBy === ci ? 'text-accent-text' : 'text-text'}`}>
                          {boardGroupBy === ci && <IconCheck size={10} strokeWidth={2.5} />}
                          {boardGroupBy !== ci && <span className="w-[10px]" />}
                          {ci === 0 ? 'Name' : (COL_TYPE_INFO.find(t => t.type === ct)?.label || 'Text')}
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex-1" />
          {/* Filter button */}
          <div className="relative">
            <button data-filter-trigger onClick={() => setShowFilterBuilder(!showFilterBuilder)} className={`flex items-center gap-1.5 p-1.5 rounded hover:bg-hover transition-colors ${filterRules.length > 0 ? 'text-accent-text' : 'text-text-dim hover:text-text'}`} title="Filter">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 3h12l-4.5 5.3v4.2L8.5 14V8.3z" /></svg>
              {filterRules.length > 0 && <span className="text-[10px] font-medium">{filterRules.length}</span>}
            </button>
            {showFilterBuilder && (
              <div ref={filterBuilderRef} className="absolute right-0 top-full mt-1 z-50 rounded-lg py-2 min-w-[480px]" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
                <div className="px-3 pb-2 text-[10px] text-text-dim font-medium uppercase tracking-wider flex items-center justify-between">
                  <span>Filters</span>
                  {filterRules.length > 0 && <button onClick={clearAllFilters} className="text-[10px] text-text-dim hover:text-red-400 normal-case tracking-normal">Clear all</button>}
                </div>
                {filterRules.map(rule => {
                  const ct = colTypes[String(rule.column)] || 'text'
                  const ops = FILTER_OPS_BY_TYPE[ct]
                  const needsValue = !['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'].includes(rule.operator)
                  const isTagType = ct === 'select' || ct === 'multi-select' || ct === 'status'
                  return (
                    <div key={rule.id} className="flex items-center gap-2 px-3 py-1.5">
                      <Dropdown value={String(rule.column)} onChange={v => { const newCol = Number(v); const newCt = colTypes[String(newCol)] || 'text'; const newOps = FILTER_OPS_BY_TYPE[newCt]; updateFilterRule(rule.id, { column: newCol, operator: newOps[0].value, value: '' }) }} options={cols.map((c, ci) => ({ value: String(ci), label: ci === 0 ? 'Name' : (COL_TYPE_INFO.find(t => t.type === (colTypes[String(ci)] || 'text'))?.label || 'Text') }))} triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors" minWidth={160} />
                      <Dropdown value={rule.operator} onChange={v => updateFilterRule(rule.id, { operator: v as FilterOperator })} options={ops.map(op => ({ value: op.value, label: op.label }))} triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors" minWidth={160} />
                      {needsValue && (
                        isTagType ? (
                          <Dropdown value={rule.value} onChange={v => updateFilterRule(rule.id, { value: v })} placeholder="Select..." options={[{ value: '', label: 'Select...' }, ...(colTags[String(rule.column)] || []).map(t => ({ value: t.name, label: t.name }))]} triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors" minWidth={160} />
                        ) : ct === 'date' ? (
                          <div className="relative"><InlineDatePicker value={rule.value} onChange={v => updateFilterRule(rule.id, { value: v })} onClose={() => {}} /></div>
                        ) : (
                          <input value={rule.value} onChange={e => updateFilterRule(rule.id, { value: e.target.value })} placeholder="Value..." className="bg-bg text-text text-[13px] border border-border rounded px-2 py-1.5 outline-none flex-1 min-w-[100px]" />
                        )
                      )}
                      <button onClick={() => removeFilterRule(rule.id)} className="text-text-dim hover:text-red-400 shrink-0">
                        <IconX size={12} />
                      </button>
                    </div>
                  )
                })}
                <button onClick={() => addFilterRule()} className="mx-3 mt-1 text-[13px] text-accent-text hover:text-accent-text/80 flex items-center gap-1">
                  <IconPlus size={10} />
                  Add a filter
                </button>
              </div>
            )}
          </div>
          {/* Sort button */}
          <div className="relative">
            <button data-sort-trigger onClick={() => setShowSortBuilder(!showSortBuilder)} className={`flex items-center gap-1.5 p-1.5 rounded hover:bg-hover transition-colors ${sortRules.length > 0 ? 'text-accent-text' : 'text-text-dim hover:text-text'}`} title="Sort">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M4 3v10M4 3L2 5.5M4 3l2 2.5M12 13V3M12 13l-2-2.5M12 13l2-2.5" /></svg>
              {sortRules.length > 0 && <span className="text-[10px] font-medium">{sortRules.length}</span>}
            </button>
            {showSortBuilder && (
              <div ref={sortBuilderRef} className="absolute right-0 top-full mt-1 z-50 rounded-lg py-2 min-w-[320px]" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
                <div className="px-3 pb-2 text-[10px] text-text-dim font-medium uppercase tracking-wider flex items-center justify-between">
                  <span>Sort</span>
                  {sortRules.length > 0 && <button onClick={clearAllSorts} className="text-[10px] text-text-dim hover:text-red-400 normal-case tracking-normal">Clear all</button>}
                </div>
                {sortRules.map((rule, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-1.5">
                    <Dropdown value={String(rule.column)} onChange={v => { const next = [...sortRules]; next[idx] = { ...next[idx], column: Number(v) }; setSortRules(next); saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, next) }} options={cols.map((c, ci) => ({ value: String(ci), label: ci === 0 ? 'Name' : (COL_TYPE_INFO.find(t => t.type === (colTypes[String(ci)] || 'text'))?.label || 'Text') }))} triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors" minWidth={160} />
                    <Dropdown value={rule.direction} onChange={v => { const next = [...sortRules]; next[idx] = { ...next[idx], direction: v as 'asc' | 'desc' }; setSortRules(next); saveSettings(undefined, undefined, undefined, undefined, undefined, undefined, next) }} options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]} triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors" minWidth={160} />
                    <button onClick={() => removeSortRule(idx)} className="text-text-dim hover:text-red-400 shrink-0">
                      <IconX size={12} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addSortRule(0, 'asc')} className="mx-3 mt-1 text-[13px] text-accent-text hover:text-accent-text/80 flex items-center gap-1">
                  <IconPlus size={10} />
                  Add a sort
                </button>
              </div>
            )}
          </div>
          <button onClick={() => setShowImport(true)} className="p-1.5 rounded hover:bg-hover text-text-dim hover:text-text transition-colors" title="Import CSV">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M8 3v10M4 7l4-4 4 4" /><path d="M2 13h12" /></svg>
          </button>
          <button onClick={() => { setShowSearch(!showSearch); if (!showSearch) setSearchQuery('') }} className={`p-1.5 rounded hover:bg-hover transition-colors ${showSearch || searchQuery ? 'text-accent-text' : 'text-text-dim hover:text-text'}`} title="Search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
          </button>
          {/* More menu */}
          <div className="relative">
            <button data-more-trigger onClick={() => setShowMoreMenu(!showMoreMenu)} className="p-1.5 rounded hover:bg-hover text-text-dim hover:text-text transition-colors" title="More options">
              <IconMoreHorizontal size={16} />
            </button>
            {showMoreMenu && (
              <div ref={moreMenuRef} className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[180px]" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
                <button onClick={() => { toggleFreezeRow(); setShowMoreMenu(false) }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3h18v18H3z" /><path d="M3 9h18" /></svg>
                  {frozenRows > 0 ? 'Unfreeze header row' : 'Freeze header row'}
                </button>
                {/* Group by */}
                <div className="px-3 py-1.5 text-[10px] text-text-dim font-medium uppercase tracking-wider mt-1">Group by</div>
                <button onClick={() => { setGroupBy(null); setShowMoreMenu(false) }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-hover ${groupBy === null ? 'text-accent-text' : 'text-text'}`}>
                  None
                </button>
                {cols.map((c, ci) => {
                  const ct = colTypes[String(ci)]
                  if (ct !== 'select' && ct !== 'status' && ct !== 'multi-select') return null
                  return (
                    <button key={ci} onClick={() => { setGroupBy(ci); setCollapsedGroups(new Set()); setShowMoreMenu(false) }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-hover ${groupBy === ci ? 'text-accent-text' : 'text-text'}`}>
                      {ci === 0 ? 'Name' : (COL_TYPE_INFO.find(t => t.type === ct)?.label || 'Text')}
                    </button>
                  )
                })}
                <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <button onClick={() => { setShowMoreMenu(false); deleteSheet() }} className="w-full text-left px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2">
                  <IconTrash size={14} />
                  Delete database
                </button>
              </div>
            )}
          </div>
          {/* User avatar */}
          <a href="/settings" className="shrink-0" title={user?.name || 'Profile'}>
            <div className="hover:ring-2 hover:ring-accent/50 transition-all rounded-full">
              <Avatar name={user?.name || 'User'} size={28} src={user?.avatar_url} />
            </div>
          </a>
          <button onClick={() => addRows(1)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[14px] font-medium text-white bg-accent hover:bg-accent/90 transition-colors">
            New
            <IconChevronDown size={10} strokeWidth={1.3} />
          </button>
        </div>

        {/* Search Bar */}
        {showSearch && (
          <div className="flex items-center gap-2 px-12 py-1.5 flex-shrink-0">
            <div className="flex items-center gap-2 flex-1 max-w-[400px] px-3 py-1.5 rounded-lg border border-border bg-bg">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" className="text-text-dim shrink-0"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
              <input ref={searchInputRef} className="flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-dim/40" placeholder="Search in database..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery('') } }} />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="text-text-dim hover:text-text"><IconX size={12} /></button>}
            </div>
            {searchQuery && <span className="text-[10px] text-text-dim">{processedRows.length} result{processedRows.length !== 1 ? 's' : ''}</span>}
          </div>
        )}

        {/* Active filter indicator */}
        {filterRules.length > 0 && !showFilterBuilder && (
          <div className="flex items-center gap-2 px-12 py-1 flex-shrink-0">
            <span className="text-[10px] text-accent-text flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h12l-4.5 5.3v4.2L8.5 14V8.3z" /></svg>
              {filterRules.length} filter{filterRules.length !== 1 ? 's' : ''} active
            </span>
            <button onClick={clearAllFilters} className="text-[10px] text-text-dim hover:text-red-400">Clear all</button>
          </div>
        )}

        {/* Table View */}
        {viewType === 'table' && (
        <div className="flex-1 overflow-auto px-12 select-none" ref={tableRef} style={isSelecting ? { userSelect: 'none', WebkitUserSelect: 'none' } : {}}>
          <table className="w-full border-collapse" style={{ minWidth: cols.length * 180 + 80 }}>
            <thead>
              <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <th className="w-[32px] min-w-[32px] text-center">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 accent-[#7a6b55] cursor-pointer opacity-40 hover:opacity-100 transition-opacity"
                    checked={selectedRows.size > 0 && selectedRows.size === processedRows.length}
                    onChange={() => {
                      if (selectedRows.size === processedRows.length) setSelectedRows(new Set())
                      else setSelectedRows(new Set(processedRows.map(r => r._originalIndex as number)))
                    }}
                    title="Select all"
                  />
                </th>
                {cols.map((col, ci) => {
                  const ct = getColType(ci)
                  const typeInfo = COL_TYPE_INFO.find(t => t.type === ct) || COL_TYPE_INFO[0]
                  return (
                    <th
                      key={ci}
                      data-col-idx={ci}
                      className={`relative text-left text-[14px] text-text-dim font-medium select-none group/col`}
                      style={{ width: colWidths[ci] || 180, minWidth: 100 }}
                    >
                      {/* Drop indicator line */}
                      {dropTarget === ci && dragCol !== null && dragCol !== ci && (
                        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent z-10" />
                      )}
                      {dragCol === ci && (
                        <div className="absolute inset-0 bg-accent/10 z-10 pointer-events-none" />
                      )}
                      <div
                        className={`w-full px-2 py-2 flex items-center gap-1.5 hover:bg-hover transition-colors ${dragCol !== null ? 'cursor-grabbing' : 'cursor-grab'}`}
                        onMouseDown={e => {
                          if (e.button !== 0) return
                          const startX = e.clientX
                          const startY = e.clientY
                          let moved = false
                          const onMove = (me: MouseEvent) => {
                            if (!moved && (Math.abs(me.clientX - startX) > 5 || Math.abs(me.clientY - startY) > 5)) {
                              moved = true
                              startColDrag(ci)
                            }
                          }
                          const onUp = () => {
                            document.removeEventListener('mousemove', onMove)
                            document.removeEventListener('mouseup', onUp)
                            if (!moved) {
                              // It was a click, not a drag
                              const el = e.currentTarget as HTMLElement
                              const rect = el.getBoundingClientRect()
                              setColHeaderMenu({ x: rect.left, y: rect.bottom + 2, col: ci })
                              setShowTypePicker(false)
                            }
                          }
                          document.addEventListener('mousemove', onMove)
                          document.addEventListener('mouseup', onUp)
                        }}
                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setColHeaderMenu({ x: rect.left, y: rect.bottom + 2, col: ci }); setShowTypePicker(false) }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-dim/60 shrink-0">
                          <path d={typeInfo.icon} />
                        </svg>
                        <span className="truncate">{ci === 0 ? 'Name' : typeInfo.label}</span>
                        {sortRules.find(s => s.column === ci) && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-accent-text shrink-0 ml-auto">
                            {sortRules.find(s => s.column === ci)!.direction === 'asc'
                              ? <path d="M5 2v6M2.5 4.5L5 2l2.5 2.5" />
                              : <path d="M5 8V2M2.5 5.5L5 8l2.5-2.5" />
                            }
                          </svg>
                        )}
                      </div>
                      <div className={`absolute right-0 top-0 bottom-0 w-[3px] cursor-col-resize hover:bg-accent/50 ${resizingCol === ci ? 'bg-accent' : ''}`} onMouseDown={e => startColResize(e, ci)} />
                    </th>
                  )
                })}
                {/* Add column + */}
                <th className="w-[40px] min-w-[40px] border-l" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <button onClick={addColumn} className="w-full py-2 text-text-dim/40 hover:text-text-dim transition-colors text-[16px]" title="Add column">+</button>
                </th>
                {/* More (...) */}
                <th className="w-[40px] min-w-[40px]">
                  <button className="w-full py-2 text-text-dim/40 hover:text-text-dim transition-colors" title="Properties">
                    <IconMoreHorizontal size={14} className="mx-auto" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Group rows if groupBy is set
                const groupedData: { groupName: string; groupColor?: string; rows: typeof processedRows }[] = []
                if (groupBy !== null && activeSheet) {
                  const groupColName = cols[groupBy]?.name
                  const groups: Map<string, typeof processedRows> = new Map()
                  const order: string[] = []
                  const groupOptions = colTags[String(groupBy)] || []
                  for (const opt of groupOptions) { groups.set(opt.name, []); order.push(opt.name) }
                  groups.set('', [])

                  for (const row of processedRows) {
                    const raw = row[groupColName]
                    let tags: string[] = []
                    if (raw) { try { tags = JSON.parse(String(raw)) } catch { tags = String(raw) ? [String(raw)] : [] } }
                    if (tags.length === 0) { groups.get('')!.push(row) }
                    else { for (const t of tags) { if (!groups.has(t)) { groups.set(t, []); order.push(t) } groups.get(t)!.push(row) } }
                  }
                  if ((groups.get('') || []).length > 0) order.push('')
                  for (const name of order) {
                    const opt = groupOptions.find(o => o.name === name)
                    groupedData.push({ groupName: name, groupColor: opt?.color, rows: groups.get(name) || [] })
                  }
                } else {
                  groupedData.push({ groupName: '', rows: processedRows })
                }

                return groupedData.map(group => (
                  <React.Fragment key={group.groupName || '_all'}>
                    {groupBy !== null && (
                      <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                        <td colSpan={cols.length + 2} className="px-2 py-2">
                          <button className="flex items-center gap-2 text-[14px] font-medium text-text hover:text-accent-text transition-colors" onClick={() => {
                            const next = new Set(collapsedGroups)
                            if (next.has(group.groupName)) next.delete(group.groupName)
                            else next.add(group.groupName)
                            setCollapsedGroups(next)
                          }}>
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ transform: collapsedGroups.has(group.groupName) ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                              <path d="M3 2l4 3-4 3" />
                            </svg>
                            {group.groupColor && <span className="w-2.5 h-2.5 rounded-full" style={{ background: group.groupColor }} />}
                            {group.groupName || 'No value'}
                            <span className="text-text-dim text-[10px] font-normal ml-1">{group.rows.length}</span>
                          </button>
                        </td>
                      </tr>
                    )}
                    {!collapsedGroups.has(group.groupName) && group.rows.map((row) => {
                const ri = row._originalIndex as number
                return (
                  <tr
                    key={row._id as number || ri}
                    className={`group/row border-b hover:bg-white/[0.02] transition-colors ${selectedRows.has(ri) ? 'bg-accent/5' : ''}`}
                    style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                    onContextMenu={e => {
                      const td = (e.target as HTMLElement).closest('td')
                      const tr = td?.parentElement
                      const colIdx = td && tr ? Array.from(tr.children).indexOf(td) - 1 : undefined
                      handleRowContext(e, ri, colIdx !== undefined && colIdx >= 0 ? colIdx : undefined)
                    }}
                  >
                    <td className="w-[32px] min-w-[32px] text-center p-0" style={{ height: 34 }}>
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 accent-[#7a6b55] cursor-pointer opacity-0 group-hover/row:opacity-40 checked:!opacity-100 transition-opacity"
                        checked={selectedRows.has(ri)}
                        onChange={e => {
                          const newSet = new Set(selectedRows)
                          if (e.target.checked) newSet.add(ri)
                          else newSet.delete(ri)
                          setSelectedRows(newSet)
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    </td>
                    {cols.map((col, ci) => {
                      if (isMergedHidden(ri, ci)) return null
                      const isSelected = selectedCell?.row === ri && selectedCell?.col === ci
                      const isEditing = editingCell?.row === ri && editingCell?.col === ci
                      const cellValue = row[col.name]
                      const fmt = getCellFormat(ri, ci)
                      const merge = isMergeOrigin(ri, ci) ? isMerged(ri, ci) : null
                      const ct = getColType(ci)
                      const isTagType = ct === 'select' || ct === 'multi-select' || ct === 'status'
                      const isCheckbox = ct === 'checkbox'
                      const isDate = ct === 'date' || fmt.date
                      const isTagEditing = tagEditorCell?.row === ri && tagEditorCell?.col === ci

                      return (
                        <td
                          key={ci}
                          className={`relative p-0 ${isSelected ? 'outline outline-2 outline-accent z-[2] outline-offset-[-1px]' : ''} ${!isSelected && isInSelectionRange(ri, ci) ? 'bg-accent/10' : ''}`}
                          style={{ width: colWidths[ci] || 180, minWidth: 100, height: 34 }}
                          colSpan={merge ? merge.c2 - merge.c1 + 1 : undefined}
                          rowSpan={merge ? merge.r2 - merge.r1 + 1 : undefined}
                          onMouseDown={e => {
                            if (e.button !== 0 || isEditing || isTagEditing) return
                            // Cmd/Ctrl+Click = toggle row selection
                            if (e.metaKey || e.ctrlKey) { handleRowClick(ri, e); e.preventDefault(); return }
                            // Shift+Click with selected cell = extend cell range
                            if (e.shiftKey && selectedCell) { setSelectionRange({ r1: selectedCell.row, c1: selectedCell.col, r2: ri, c2: ci }); setIsSelecting(false); e.preventDefault(); return }
                            // Shift+Click with selected rows = extend row range
                            if (e.shiftKey && selectedRows.size > 0) { handleRowClick(ri, e); e.preventDefault(); return }
                            setSelectedCell({ row: ri, col: ci }); setSelectionRange({ r1: ri, c1: ci, r2: ri, c2: ci }); selectionAnchor.current = { row: ri, col: ci }; setIsSelecting(true); setEditingCell(null); setFormulaSuggestions([]); setSelectedRows(new Set()); containerRef.current?.focus()
                          }}
                          onMouseEnter={() => { if (isSelecting && selectionAnchor.current) setSelectionRange({ r1: selectionAnchor.current.row, c1: selectionAnchor.current.col, r2: ri, c2: ci }) }}
                          onDoubleClick={() => {
                            if (isCheckbox) { toggleCheckbox(ri, ci) }
                            else if (isTagType) { setTagEditorCell({ row: ri, col: ci }); setTagSearch('') }
                            else startEdit(ri, ci)
                          }}
                          onClick={() => {
                            if (isCheckbox) { toggleCheckbox(ri, ci); return }
                            if (isTagType && isSelected && !isTagEditing) { setTagEditorCell({ row: ri, col: ci }); setTagSearch('') }
                          }}
                        >
                          {/* Tag editor popup */}
                          {isTagEditing && (
                            <div ref={tagEditorRef} className="absolute left-0 top-full z-50 rounded-lg py-1 min-w-[240px] max-h-[320px] flex flex-col" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                              {getTagsForCell(ri, ci).length > 0 && (
                                <div className="flex flex-wrap gap-1 px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                                  {getTagsForCell(ri, ci).map(tag => (
                                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/90" style={{ background: getTagColor(ci, tag) }}>
                                      {tag}
                                      <button onClick={e => { e.stopPropagation(); toggleTag(ri, ci, tag) }} className="hover:text-white ml-0.5">&times;</button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                                <input
                                  ref={tagSearchRef}
                                  className="w-full bg-transparent text-[14px] text-text outline-none placeholder:text-text-dim/40"
                                  placeholder="Search for an option..."
                                  value={tagSearch}
                                  onChange={e => setTagSearch(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && tagSearch.trim()) {
                                      const existing = (colTags[String(ci)] || []).find(t => t.name.toLowerCase() === tagSearch.trim().toLowerCase())
                                      if (existing) { toggleTag(ri, ci, existing.name) }
                                      else { const name = addNewTag(ci, tagSearch.trim()); if (name) toggleTag(ri, ci, name) }
                                      setTagSearch('')
                                      e.preventDefault()
                                    }
                                    if (e.key === 'Escape') { setTagEditorCell(null); setTagSearch('') }
                                    e.stopPropagation()
                                  }}
                                />
                              </div>
                              <div className="overflow-auto flex-1 py-1">
                                <div className="px-3 py-1 text-[10px] text-text-dim/60 font-medium">Select an option or create one</div>
                                {(colTags[String(ci)] || [])
                                  .filter(t => !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase()))
                                  .map(tag => {
                                    const selected = getTagsForCell(ri, ci).includes(tag.name)
                                    return (
                                      <button key={tag.name} className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors hover:bg-hover ${selected ? 'bg-white/5' : ''}`} onClick={() => toggleTag(ri, ci, tag.name)}>
                                        <span className="w-4 h-4 rounded flex items-center justify-center" style={{ background: tag.color }}>
                                          {selected && <IconCheck size={10} strokeWidth={2.5} className="text-white" />}
                                        </span>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[13px] text-white/90" style={{ background: tag.color }}>{tag.name}</span>
                                      </button>
                                    )
                                  })}
                                {tagSearch.trim() && !(colTags[String(ci)] || []).find(t => t.name.toLowerCase() === tagSearch.trim().toLowerCase()) && (
                                  <button className="w-full text-left px-3 py-2 flex items-center gap-2 text-[13px] text-text-dim hover:bg-hover transition-colors" onClick={() => { const name = addNewTag(ci, tagSearch.trim()); if (name) toggleTag(ri, ci, name); setTagSearch('') }}>
                                    <span className="text-accent-text">Create</span> <span className="px-2 py-0.5 rounded text-white/90" style={{ background: TAG_COLORS[(colTags[String(ci)]?.length || 0) % TAG_COLORS.length] }}>{tagSearch.trim()}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Cell content */}
                          {isEditing && !isTagType && !isCheckbox ? (
                            <div className="absolute inset-0 z-10">
                              {isDate ? (
                                <InlineDatePicker value={editValue || ''} onChange={v => { setEditValue(v); setTimeout(() => commitEdit(), 0) }} onClose={() => { commitEdit() }} />
                              ) : ct === 'number' ? (
                                <input type="number" autoFocus className="w-full h-full bg-bg text-[14px] px-2 py-1.5 outline-none text-text tabular-nums" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); if (ri < rows.length - 1) setSelectedCell({ row: ri + 1, col: ci }) } if (e.key === 'Tab') { e.preventDefault(); commitEdit(); if (e.shiftKey) { if (ci > 0) setSelectedCell({ row: ri, col: ci - 1 }) } else { if (ci < cols.length - 1) setSelectedCell({ row: ri, col: ci + 1 }) } } if (e.key === 'Escape') setEditingCell(null); e.stopPropagation() }} step="any" />
                              ) : (
                                <>
                                  <input ref={inputRef} className={`w-full h-full bg-bg text-[14px] px-2 py-1.5 outline-none select-text ${editValue.startsWith('=') ? 'text-green-500' : 'text-text'}`} value={editValue} onChange={e => updateEditValue(e.target.value)} onBlur={() => { setTimeout(() => { if (formulaSuggestions.length === 0) commitEdit() }, 100) }} onKeyDown={e => {
                                    if (formulaSuggestions.length > 0) { if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSuggestion(s => Math.min(s + 1, formulaSuggestions.length - 1)); return } if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedSuggestion(s => Math.max(s - 1, 0)); return } if (e.key === 'Tab' || (e.key === 'Enter' && formulaSuggestions.length > 0)) { e.preventDefault(); insertFormula(formulaSuggestions[selectedSuggestion]); return } }
                                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); if (ri < rows.length - 1) setSelectedCell({ row: ri + 1, col: ci }) } if (e.key === 'Tab') { e.preventDefault(); commitEdit(); if (e.shiftKey) { if (ci > 0) setSelectedCell({ row: ri, col: ci - 1 }) } else { if (ci < cols.length - 1) setSelectedCell({ row: ri, col: ci + 1 }) } } if (e.key === 'Escape') { setEditingCell(null); setFormulaSuggestions([]) } e.stopPropagation()
                                  }} />
                                  {formulaSuggestions.length > 0 && (
                                    <div className="absolute left-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[220px] max-h-[200px] overflow-auto" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }}>
                                      {formulaSuggestions.map((name, i) => { const formula = FORMULAS.find(f => f.name === name); return (
                                        <button key={name} className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${i === selectedSuggestion ? 'bg-accent/20 text-accent-text' : 'hover:bg-hover text-text'}`} onMouseDown={e => { e.preventDefault(); insertFormula(name) }} onMouseEnter={() => setSelectedSuggestion(i)}>
                                          <span className="text-[13px] font-mono font-semibold text-green-500">{name}</span>
                                          <span className="text-[10px] text-text-dim">{formula?.desc}</span>
                                        </button>
                                      )})}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          ) : (
                            <div className={`px-2 py-1.5 text-[14px] h-full flex items-center truncate ${fmt.b ? 'font-bold' : ''} ${fmt.i ? 'italic' : ''} ${fmt.s ? 'line-through' : ''}`} style={{ minHeight: 34 }}>
                              {/* Row action buttons (first column) - open + menu */}
                              {ci === 0 && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center gap-0">
                                  <button
                                    className="p-1 text-text-dim hover:text-text rounded hover:bg-hover"
                                    title="Menu"
                                    onClick={e => openRowMenu(e, ri)}
                                  >
                                    <IconMoreVertical size={14} />
                                  </button>
                                  <button
                                    className="p-1 text-text-dim hover:text-accent-text rounded hover:bg-hover"
                                    title="Open as page"
                                    onClick={e => { e.stopPropagation(); setDetailRowId((row._id || row.id) as number) }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h6v6M14 10l7-7M10 3H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-6" /></svg>
                                  </button>
                                </div>
                              )}
                              {(() => {
                                // First column is always "Name" - plain text title, never rendered as link/tag/etc
                                if (ci === 0) {
                                  const str = cellValue == null || cellValue === '' ? '' : String(cellValue)
                                  return <span className="text-text font-medium select-text cursor-text" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>{str}</span>
                                }
                                if (isCheckbox) {
                                  const checked = cellValue === 'true' || cellValue === true
                                  return (
                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${checked ? 'bg-accent border-accent' : 'border-text-dim/40 hover:border-text-dim'}`}>
                                      {checked && <IconCheck size={10} strokeWidth={3} className="text-white" />}
                                    </div>
                                  )
                                }
                                if (isTagType) {
                                  const tags = getTagsForCell(ri, ci)
                                  if (tags.length === 0) return <span className="text-text-dim/20 text-[13px]">&nbsp;</span>
                                  return (
                                    <div className="flex flex-wrap gap-1">
                                      {tags.map(tag => (
                                        <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] text-white/90" style={{ background: getTagColor(ci, tag) }}>{tag}</span>
                                      ))}
                                    </div>
                                  )
                                }
                                if (ct === 'created_time') {
                                  // Show row creation timestamp (use _id as proxy, or stored value)
                                  const ts = cellValue ? String(cellValue) : ''
                                  if (ts) {
                                    const d = new Date(ts)
                                    return <span className="text-text-dim text-[13px]">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                  }
                                  return <span className="text-text-dim/30 text-[13px]">--</span>
                                }
                                if (ct === 'edited_time') {
                                  const ts = cellValue ? String(cellValue) : ''
                                  if (ts) {
                                    const d = new Date(ts)
                                    return <span className="text-text-dim text-[13px]">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                  }
                                  return <span className="text-text-dim/30 text-[13px]">--</span>
                                }
                                if (ct === 'auto_id') {
                                  return <span className="text-text-dim tabular-nums text-[13px]">#{ri + 1}</span>
                                }
                                if (cellValue == null || cellValue === '') {
                                  if (isDate) return <span className="text-text-dim/20 text-[13px]">&nbsp;</span>
                                  return ''
                                }
                                const str = String(cellValue)
                                if (isDate && str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                  const d = new Date(str + 'T00:00:00')
                                  return (
                                    <span className="flex items-center gap-1.5 text-text text-[14px]">
                                      <IconCalendar size={12} className="text-text-dim shrink-0" strokeWidth={1.2} />
                                      {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                  )
                                }
                                if (str.startsWith('=')) {
                                  const result = evaluateFormula(str, cols, rows, ri, ci)
                                  const display = formatCellDisplay(result, fmt)
                                  const isError = typeof result === 'string' && result.startsWith('#')
                                  return <span className={isError ? 'text-red-400' : typeof result === 'number' ? 'tabular-nums' : ''}>{display}</span>
                                }
                                if ((ct === 'url' || isUrl(str))) {
                                  const href = str.startsWith('http') ? str : `https://${str}`
                                  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer" onClick={e => e.stopPropagation()}>{str.replace(/^https?:\/\//, '').slice(0, 40)}</a>
                                }
                                if (ct === 'email') return <a href={`mailto:${str}`} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 cursor-pointer" onClick={e => e.stopPropagation()}>{str}</a>
                                if (ct === 'phone') return <a href={`tel:${str}`} className="text-blue-400 hover:text-blue-300 cursor-pointer" onClick={e => e.stopPropagation()}>{str}</a>
                                const n = parseFloat(str)
                                if (!isNaN(n) && str === String(n)) return <span className="tabular-nums">{formatCellDisplay(n, fmt)}</span>
                                return str
                              })()}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="w-[40px]" />
                    <td className="w-[40px]" />
                  </tr>
                )
              })}
                  </React.Fragment>
                ))
              })()}
            </tbody>
          </table>

          {/* Add row - Notion style */}
          <button onClick={() => addRows(1, true)} className="w-full text-left px-2 py-2 text-[14px] text-text-dim/40 hover:text-text-dim hover:bg-white/[0.02] transition-colors border-b" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            + New page
          </button>
        </div>
        )}

        {/* Board View (Kanban) */}
        {viewType === 'board' && (() => {
          const groupCol = boardGroupBy ?? -1
          const groupColName = cols[groupCol]?.name
          const groupType = colTypes[String(groupCol)]
          if (groupCol < 0 || !groupColName || (groupType !== 'select' && groupType !== 'status' && groupType !== 'multi-select')) {
            return (
              <div className="flex-1 flex items-center justify-center text-text-dim text-[14px]">
                <div className="text-center">
                  <p>Select a Select or Status column to group by</p>
                  <button onClick={() => setShowViewSwitcher(true)} className="mt-2 text-accent-text text-[14px] hover:underline">Choose column</button>
                </div>
              </div>
            )
          }
          const groupOptions = colTags[String(groupCol)] || []
          const groups: Record<string, typeof processedRows> = { '': [] }
          for (const opt of groupOptions) groups[opt.name] = []
          for (const row of processedRows) {
            const raw = row[groupColName]
            let tags: string[] = []
            if (raw) { try { tags = JSON.parse(String(raw)) } catch { tags = String(raw) ? [String(raw)] : [] } }
            if (tags.length === 0) { groups[''].push(row) }
            else { for (const t of tags) { if (!groups[t]) groups[t] = []; groups[t].push(row) } }
          }
          const allGroups = [...groupOptions.map(o => o.name), ...(groups[''].length > 0 ? [''] : [])]

          return (
            <div className="flex-1 overflow-x-auto px-6 py-4">
              <div className="flex gap-4 min-h-full" style={{ minWidth: allGroups.length * 280 }}>
                {allGroups.map(groupName => {
                  const opt = groupOptions.find(o => o.name === groupName)
                  const groupRows = groups[groupName] || []
                  return (
                    <div key={groupName || '_none'} className="w-[260px] shrink-0 flex flex-col">
                      <div className="flex items-center gap-2 px-2 py-2 mb-2">
                        {opt && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: opt.color }} />}
                        <span className="text-[14px] font-medium text-text truncate">{groupName || 'No status'}</span>
                        <span className="text-[10px] text-text-dim ml-auto">{groupRows.length}</span>
                      </div>
                      <div className="flex-1 space-y-2 overflow-y-auto">
                        {groupRows.map(row => {
                          const rowId = (row._id || row.id) as number
                          const title = String(row[cols[0]?.name] || '') || 'Untitled'
                          return (
                            <div
                              key={rowId}
                              className="rounded-lg p-3 cursor-pointer hover:bg-white/[0.04] transition-colors border"
                              style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
                              onClick={() => setDetailRowId(rowId)}
                              draggable
                              onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ rowId, fromGroup: groupName }))}
                              onDragOver={e => e.preventDefault()}
                              onDrop={async e => {
                                e.preventDefault()
                                try {
                                  const data = JSON.parse(e.dataTransfer.getData('text/plain'))
                                  if (data.rowId && data.fromGroup !== groupName) {
                                    const value = groupName ? JSON.stringify([groupName]) : ''
                                    await apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: data.rowId, data: { [groupColName]: value } })
                                    fetchSheet(activeSheet.id)
                                  }
                                } catch {}
                              }}
                            >
                              <div className="text-[14px] font-medium text-text truncate">{title}</div>
                              {cols.slice(1, 4).map((c, ci) => {
                                const realCi = ci + 1
                                if (realCi === groupCol || hiddenColumns.includes(realCi)) return null
                                const val = row[c.name]
                                if (!val || String(val) === '' || String(val) === '[]') return null
                                const ct = colTypes[String(realCi)]
                                if (ct === 'select' || ct === 'status' || ct === 'multi-select') {
                                  let tags: string[] = []
                                  try { tags = JSON.parse(String(val)) } catch { tags = [String(val)] }
                                  return (
                                    <div key={realCi} className="flex flex-wrap gap-1 mt-1.5">
                                      {tags.map(t => {
                                        const tagOpt = (colTags[String(realCi)] || []).find(o => o.name === t)
                                        return <span key={t} className="px-1.5 py-0.5 rounded text-[10px] text-white/80" style={{ background: tagOpt?.color || '#4a4a4a' }}>{t}</span>
                                      })}
                                    </div>
                                  )
                                }
                                if (ct === 'checkbox') {
                                  return val === 'true' ? <div key={realCi} className="mt-1 text-[10px] text-green-400">✓ {c.name}</div> : null
                                }
                                return <div key={realCi} className="mt-1.5 text-[10px] text-text-dim truncate">{String(val).slice(0, 50)}</div>
                              })}
                            </div>
                          )
                        })}
                      </div>
                      {/* Drop zone for empty columns */}
                      <div
                        className="min-h-[60px] rounded-lg mt-2 flex items-center justify-center text-text-dim/30 text-[13px] border border-dashed transition-colors hover:border-accent/30"
                        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'rgba(55,202,55,0.3)' }}
                        onDragLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}
                        onDrop={async e => {
                          e.preventDefault()
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                          try {
                            const data = JSON.parse(e.dataTransfer.getData('text/plain'))
                            if (data.rowId && data.fromGroup !== groupName) {
                              const value = groupName ? JSON.stringify([groupName]) : ''
                              await apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: data.rowId, data: { [groupColName]: value } })
                              fetchSheet(activeSheet.id)
                            }
                          } catch {}
                        }}
                      >
                        Drop here
                      </div>
                      <button onClick={async () => {
                        const data: Record<string, string> = {}
                        if (groupName) data[groupColName] = JSON.stringify([groupName])
                        await apiAction({ action: 'add_row', sheet_id: activeSheet.id, data })
                        fetchSheet(activeSheet.id)
                      }} className="mt-2 w-full text-left px-2 py-2 text-[13px] text-text-dim/40 hover:text-text-dim hover:bg-white/[0.02] transition-colors rounded">
                        + New
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* List View */}
        {viewType === 'list' && (
          <div className="flex-1 overflow-auto px-12 py-2">
            {processedRows.map(row => {
              const rowId = (row._id || row.id) as number
              const title = String(row[cols[0]?.name] || '') || 'Untitled'
              return (
                <div
                  key={rowId}
                  className="flex items-center gap-3 px-3 py-2.5 border-b hover:bg-white/[0.02] transition-colors cursor-pointer group/listrow"
                  style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                  onClick={() => setDetailRowId(rowId)}
                >
                  {/* Checkbox if first col is checkbox */}
                  {getColType(0) === 'checkbox' ? (
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${row[cols[0]?.name] === 'true' ? 'bg-accent border-accent' : 'border-text-dim/40 hover:border-text-dim'}`}
                      onClick={e => { e.stopPropagation(); toggleCheckbox(row._originalIndex as number, 0) }}>
                      {row[cols[0]?.name] === 'true' && <IconCheck size={10} strokeWidth={3} className="text-white" />}
                    </div>
                  ) : null}
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-text truncate">{title}</div>
                  </div>
                  {/* Show 2-3 visible properties */}
                  {cols.slice(1, 5).map((c, ci) => {
                    const realCi = ci + 1
                    if (hiddenColumns.includes(realCi)) return null
                    const val = row[c.name]
                    if (!val || String(val) === '' || String(val) === '[]') return null
                    const ct = colTypes[String(realCi)]
                    if (ct === 'select' || ct === 'status' || ct === 'multi-select') {
                      let tags: string[] = []
                      try { tags = JSON.parse(String(val)) } catch { tags = [String(val)] }
                      return (
                        <div key={realCi} className="flex gap-1 shrink-0">
                          {tags.slice(0, 2).map(t => {
                            const tagOpt = (colTags[String(realCi)] || []).find(o => o.name === t)
                            return <span key={t} className="px-2 py-0.5 rounded text-[10px] text-white/80" style={{ background: tagOpt?.color || '#4a4a4a' }}>{t}</span>
                          })}
                        </div>
                      )
                    }
                    if (ct === 'date' && String(val).match(/^\d{4}-\d{2}-\d{2}$/)) {
                      const d = new Date(String(val) + 'T00:00:00')
                      return <span key={realCi} className="text-[13px] text-text-dim shrink-0">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    }
                    if (ct === 'checkbox') {
                      return val === 'true' ? <span key={realCi} className="text-green-400 text-[13px] shrink-0">✓</span> : null
                    }
                    return <span key={realCi} className="text-[13px] text-text-dim truncate max-w-[120px] shrink-0">{String(val).slice(0, 30)}</span>
                  })}
                  <IconChevronRight size={14} className="text-text-dim/0 group-hover/listrow:text-text-dim/60 transition-colors shrink-0" />
                </div>
              )
            })}
            <button onClick={() => addRows(1, true)} className="w-full text-left px-3 py-2.5 text-[14px] text-text-dim/40 hover:text-text-dim hover:bg-white/[0.02] transition-colors">
              + New page
            </button>
          </div>
        )}

        {/* Column Header Context Menu */}
        {colHeaderMenu && (
          <div data-col-menu className="fixed rounded-lg py-1 z-50 min-w-[220px]" style={{ left: colHeaderMenu.x, top: colHeaderMenu.y, background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
            <div className="px-3 py-1.5 text-[10px] text-text-dim font-medium uppercase tracking-wider">{colHeaderMenu.col === 0 ? 'Name' : (COL_TYPE_INFO.find(t => t.type === getColType(colHeaderMenu.col))?.label || 'Text')}</div>
            <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
            {!showTypePicker ? (
              <>
                {/* Sort options */}
                <button onClick={() => { addSortRule(colHeaderMenu.col, 'asc'); setColHeaderMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12l7-7 7 7" /></svg>
                  Sort ascending
                </button>
                <button onClick={() => { addSortRule(colHeaderMenu.col, 'desc'); setColHeaderMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 19V5M5 12l7 7 7-7" /></svg>
                  Sort descending
                </button>
                {/* Filter option */}
                <button onClick={() => { addFilterRule(colHeaderMenu.col); setColHeaderMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h18l-7 8.5v5.5l-4 2V12.5z" /></svg>
                  Filter by this column
                </button>
                <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                {colHeaderMenu.col === 0 ? (
                  <div className="px-3 py-2 text-[13px] text-text-dim flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h14M3 9h8M3 13h10" /></svg>
                    Title property
                  </div>
                ) : (
                  <button onClick={() => setShowTypePicker(true)} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d={COL_TYPE_INFO.find(t => t.type === getColType(colHeaderMenu.col))?.icon || COL_TYPE_INFO[0].icon} /></svg>
                    Type: {COL_TYPE_INFO.find(t => t.type === getColType(colHeaderMenu.col))?.label || 'Text'}
                    <IconChevronRight size={8} className="ml-auto" strokeWidth={1.2} />
                  </button>
                )}
                {(getColType(colHeaderMenu.col) === 'select' || getColType(colHeaderMenu.col) === 'multi-select' || getColType(colHeaderMenu.col) === 'status') && (
                  <button onClick={() => { openTagOptionsEditor(colHeaderMenu.col); setColHeaderMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 10l4 4 4-4" /></svg>
                    Edit options
                  </button>
                )}
                <button onClick={() => {
                  const colName = cols[colHeaderMenu.col]?.name
                  const newName = prompt('Rename column:', colName)
                  if (newName && newName.trim() && newName.trim() !== colName) {
                    apiAction({ action: 'rename_column', sheet_id: activeSheet.id, old_name: colName, new_name: newName.trim() }).then(() => fetchSheet(activeSheet.id))
                  }
                  setColHeaderMenu(null)
                }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
                  Rename
                </button>
                <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                {colHeaderMenu.col > 0 && (
                  <button onClick={() => { if (confirm('Delete column ' + cols[colHeaderMenu.col]?.name + '?')) { deleteColumn(colHeaderMenu.col); setColHeaderMenu(null) } }} className="w-full text-left px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2">
                    <IconTrash size={14} />
                    Delete
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="px-2 pb-1.5 pt-1 flex items-center gap-2">
                  <button onClick={() => setShowTypePicker(false)} className="text-text-dim hover:text-text p-0.5">
                    <svg width="10" height="10" viewBox="0 0 8 8" fill="none"><path d="M5 2l-2 2 2 2" stroke="currentColor" strokeWidth="1.2" /></svg>
                  </button>
                  <span className="text-[10px] text-text-dim">Select type</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-dim/50 ml-auto"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                </div>
                <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <div className="max-h-[400px] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-0">
                    {COL_TYPE_INFO.filter(t => t.group === 'basic').map(ti => (
                      <button key={ti.type} onClick={() => setColumnType(colHeaderMenu.col, ti.type)} className={`text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors hover:bg-hover ${getColType(colHeaderMenu.col) === ti.type ? 'text-accent-text bg-accent/10' : 'text-text'}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={ti.icon} /></svg>
                        {ti.label}
                      </button>
                    ))}
                  </div>
                  <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  <div className="grid grid-cols-2 gap-0">
                    {COL_TYPE_INFO.filter(t => t.group === 'advanced').map(ti => (
                      <button key={ti.type} onClick={() => setColumnType(colHeaderMenu.col, ti.type)} className={`text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors hover:bg-hover ${getColType(colHeaderMenu.col) === ti.type ? 'text-accent-text bg-accent/10' : 'text-text'}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={ti.icon} /></svg>
                        {ti.label}
                      </button>
                    ))}
                  </div>
                  <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  <div className="grid grid-cols-2 gap-0">
                    {COL_TYPE_INFO.filter(t => t.group === 'timestamp').map(ti => (
                      <button key={ti.type} onClick={() => setColumnType(colHeaderMenu.col, ti.type)} className={`text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors hover:bg-hover ${getColType(colHeaderMenu.col) === ti.type ? 'text-accent-text bg-accent/10' : 'text-text'}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={ti.icon} /></svg>
                        {ti.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Row Context Menu (Notion-style) */}
        {contextMenu && (
          <div className="fixed rounded-lg py-1 z-50 min-w-[260px]" style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
            {/* Page section header */}
            <div className="px-3 py-1.5 text-[10px] text-text-dim font-medium uppercase tracking-wider">Page</div>
            {/* Edit property submenu */}
            <div className="relative group/editprop">
              <button className="w-full text-left px-3 py-2 text-[14px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h2M3 12h2M3 18h2M8 6h13M8 12h13M8 18h13" /></svg>
                Edit property
                <IconChevronRight size={8} className="ml-auto" strokeWidth={1.2} />
              </button>
              <div className="absolute left-full top-0 ml-1 min-w-[180px] rounded-lg py-1 hidden group-hover/editprop:block" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)' }}>
                {cols.map((col, ci) => {
                  const ti = COL_TYPE_INFO.find(t => t.type === getColType(ci)) || COL_TYPE_INFO[0]
                  return (
                    <button key={ci} onClick={() => {
                      const ri = contextMenu.row
                      setSelectedCell({ row: ri, col: ci })
                      if (getColType(ci) === 'select' || getColType(ci) === 'multi-select' || getColType(ci) === 'status') {
                        setTagEditorCell({ row: ri, col: ci }); setTagSearch('')
                      } else {
                        startEdit(ri, ci)
                      }
                      setContextMenu(null)
                    }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={ti.icon} /></svg>
                      {ci === 0 ? 'Name' : ti.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {/* Open in submenu */}
            <div className="relative group/openin">
              <button className="w-full text-left px-3 py-2 text-[14px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
                Open in
                <IconChevronRight size={8} className="ml-auto" strokeWidth={1.2} />
              </button>
              <div className="absolute left-full top-0 ml-1 min-w-[160px] rounded-lg py-1 hidden group-hover/openin:block" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)' }}>
                <button onClick={() => { setDetailRowId((activeSheet?.rows[contextMenu.row]?._id || activeSheet?.rows[contextMenu.row]?.id) as number); setContextMenu(null) }} className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-hover transition-colors flex items-center gap-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="18" rx="1" /></svg>
                  Side peek
                </button>
              </div>
            </div>
            <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
            {/* Copy link */}
            <button onClick={() => {
              const rowId = activeSheet?.rows[contextMenu.row]?._id || activeSheet?.rows[contextMenu.row]?.id
              navigator.clipboard.writeText(`${window.location.origin}/database?open=${activeSheet?.public_id || activeSheet?.id}&row=${rowId}`)
              setContextMenu(null)
            }} className="w-full text-left px-3 py-2 text-[14px] text-text hover:bg-hover transition-colors flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 14a3.5 3.5 0 005-5l-1-1M14 10a3.5 3.5 0 00-5 5l1 1M8 16l8-8" /></svg>
              Copy link
            </button>
            {/* Insert row */}
            <button onClick={insertRowAbove} className="w-full text-left px-3 py-2 text-[14px] text-text hover:bg-hover transition-colors flex items-center gap-2">
              <IconPlus size={14} strokeWidth={2} />
              Insert row
            </button>
            {/* Duplicate */}
            <button onClick={duplicateSelectedRows} className="w-full text-left px-3 py-2 text-[14px] text-text hover:bg-hover transition-colors flex items-center gap-2">
              <IconCopy size={14} />
              Duplicate
              <span className="ml-auto text-[10px] text-text-dim/50">&#8984;D</span>
            </button>
            <div className="h-px my-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
            {/* Delete */}
            <button onClick={deleteSelectedRows} className="w-full text-left px-3 py-2 text-[14px] text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2">
              <IconTrash size={14} />
              Delete
              <span className="ml-auto text-[10px] text-text-dim/50">Del</span>
            </button>
          </div>
        )}

        {/* CSV Import Modal */}
        {showImport && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowImport(false)}>
            <div className="rounded-xl w-[500px] max-h-[70vh] flex flex-col" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-text">Import CSV</h2>
                <button onClick={() => setShowImport(false)} className="text-text-dim hover:text-text"><IconX size={14} strokeWidth={2} /></button>
              </div>
              <div className="px-5 py-4 flex-1 overflow-auto">
                <textarea className="w-full h-40 bg-bg text-text text-[13px] border border-border rounded-lg p-3 outline-none focus:border-accent resize-none font-mono" placeholder="Paste CSV data here..." value={csvText} onChange={e => setCsvText(e.target.value)} autoFocus />
              </div>
              <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                <button onClick={() => setShowImport(false)} className="text-[13px] px-4 py-2 rounded text-text-dim hover:text-text">Cancel</button>
                <button onClick={importCsv} disabled={!csvText.trim()} className="text-[13px] px-4 py-2 rounded bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-40">Import</button>
              </div>
            </div>
          </div>
        )}

        {/* Add Column Modal */}
        {showAddColumn && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowAddColumn(false)}>
            <div className="rounded-xl w-[320px] flex flex-col" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-text">Add Property</h2>
                <button onClick={() => setShowAddColumn(false)} className="text-text-dim hover:text-text"><IconX size={14} strokeWidth={2} /></button>
              </div>
              <div className="px-5 py-4">
                <input ref={addColumnRef} className="w-full bg-bg text-text text-[14px] border border-border rounded-lg px-3 py-2.5 outline-none focus:border-accent" placeholder="Property name" value={newColumnName} onChange={e => setNewColumnName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmAddColumn(); if (e.key === 'Escape') setShowAddColumn(false) }} />
              </div>
              <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                <button onClick={() => setShowAddColumn(false)} className="text-[13px] px-4 py-2 rounded text-text-dim hover:text-text">Cancel</button>
                <button onClick={confirmAddColumn} disabled={!newColumnName.trim()} className="text-[13px] px-4 py-2 rounded bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-40">Add</button>
              </div>
            </div>
          </div>
        )}

        {/* Row Detail Panel */}
        {detailRowId !== null && activeSheet && (() => {
          const ri = activeSheet.rows.findIndex(r => (r._id || r.id) === detailRowId)
          if (ri < 0) return null
          const row = activeSheet.rows[ri]
          return (
            <RowDetailPanel
              sheetId={activeSheet.id}
              rowId={detailRowId as number}
              rowData={row}
              columns={activeSheet.columns}
              colTypes={colTypes}
              colTags={colTags}
              onClose={() => setDetailRowId(null)}
              onUpdate={async (colName, value) => {
                const rowId = row._id || row.id
                if (rowId) {
                  await apiAction({ action: 'update_row', sheet_id: activeSheet.id, row_id: rowId, data: { [colName]: value } })
                  const newSheet = { ...activeSheet, rows: [...activeSheet.rows] }
                  newSheet.rows[ri] = { ...newSheet.rows[ri], [colName]: value }
                  setActiveSheet(newSheet)
                }
              }}
              onDelete={async () => {
                const rowId = row._id || row.id
                if (rowId) {
                  await apiAction({ action: 'delete_row', sheet_id: activeSheet.id, row_id: rowId })
                  setDetailRowId(null)
                  fetchSheet(activeSheet.id)
                }
              }}
            />
          )
        })()}

        {/* Tag Options Editor Modal */}
        {showDropdownEditor && dropdownEditCol !== null && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowDropdownEditor(false)}>
            <div className="rounded-xl w-[400px] max-h-[70vh] flex flex-col" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }} onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-text">Edit Options - {cols[dropdownEditCol]?.name}</h2>
                <button onClick={() => setShowDropdownEditor(false)} className="text-text-dim hover:text-text"><IconX size={14} strokeWidth={2} /></button>
              </div>
              <div className="px-5 py-3 flex-1 overflow-auto">
                <div className="space-y-1.5">
                  {(colTags[String(dropdownEditCol)] || []).map((tag, idx) => (
                    <div key={idx} className="flex items-center gap-2 group/tag">
                      <div className="relative">
                        <button
                          className="w-6 h-6 rounded-md border border-white/10 flex items-center justify-center shrink-0 hover:brightness-125 transition-all"
                          style={{ background: tag.color }}
                          onClick={(e) => {
                            const btn = e.currentTarget
                            const picker = btn.nextElementSibling as HTMLElement
                            picker.classList.toggle('hidden')
                          }}
                        />
                        <div className="hidden absolute top-full left-0 mt-1 z-50 rounded-lg p-2 grid grid-cols-5 gap-1" style={{ background: 'var(--dropdown-bg)', border: '1px solid var(--border-strong)', boxShadow: 'var(--glass-shadow-lg)', backdropFilter: 'none', WebkitBackdropFilter: 'none', opacity: 1 }}>
                          {TAG_COLORS.map(c => (
                            <button key={c} className="w-6 h-6 rounded-md hover:scale-110 transition-transform" style={{ background: c, outline: tag.color === c ? '2px solid white' : 'none', outlineOffset: '1px' }} onClick={() => updateTagColor(dropdownEditCol!, tag.name, c)} />
                          ))}
                          {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#84cc16'].map(c => (
                            <button key={c} className="w-6 h-6 rounded-md hover:scale-110 transition-transform" style={{ background: c, outline: tag.color === c ? '2px solid white' : 'none', outlineOffset: '1px' }} onClick={() => updateTagColor(dropdownEditCol!, tag.name, c)} />
                          ))}
                        </div>
                      </div>
                      {/* Tag name (editable) */}
                      <input
                        className="flex-1 bg-transparent text-[14px] text-text outline-none border-b border-transparent hover:border-border focus:border-accent px-1 py-1 rounded"
                        defaultValue={tag.name}
                        onBlur={e => {
                          if (e.target.value.trim() !== tag.name) renameTagOption(dropdownEditCol!, tag.name, e.target.value)
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                      {/* Preview pill */}
                      <span className="px-2 py-0.5 rounded text-[10px] text-white/90 shrink-0" style={{ background: tag.color }}>{tag.name}</span>
                      {/* Delete */}
                      <button onClick={() => deleteTagOption(dropdownEditCol!, tag.name)} className="opacity-0 group-hover/tag:opacity-100 text-text-dim hover:text-red-400 transition-all shrink-0" title="Delete option">
                        <IconX size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                {(colTags[String(dropdownEditCol)] || []).length === 0 && (
                  <p className="text-[13px] text-text-dim py-4 text-center">No options yet. Add one below.</p>
                )}
              </div>
              {/* Add new option */}
              <div className="px-5 py-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 bg-bg text-text text-[14px] border border-border rounded-lg px-3 py-2 outline-none focus:border-accent"
                    placeholder="New option name..."
                    value={dropdownEditValue}
                    onChange={e => setDropdownEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && dropdownEditValue.trim()) {
                        addTagOption(dropdownEditCol!, dropdownEditValue.trim())
                        setDropdownEditValue('')
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => { if (dropdownEditValue.trim()) { addTagOption(dropdownEditCol!, dropdownEditValue.trim()); setDropdownEditValue('') } }}
                    disabled={!dropdownEditValue.trim()}
                    className="text-[13px] px-3 py-2 rounded bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Database List ───
  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h1 className="text-[16px] font-bold text-text">Database</h1>
        <button onClick={() => setShowNewSheet(true)} className="text-[13px] px-3 py-1.5 rounded bg-accent text-white font-medium hover:bg-accent/90 transition-colors">
          + New Database
        </button>
      </div>
      <div className="px-5 py-4">
        {showNewSheet && (
          <div className="mb-4 flex items-center gap-2">
            <input
              className="text-[14px] bg-bg text-text border border-border rounded-lg px-3 py-2 outline-none focus:border-accent flex-1 max-w-[240px]"
              placeholder="Database name"
              value={newSheetName}
              onChange={e => setNewSheetName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createSheet(); if (e.key === 'Escape') setShowNewSheet(false) }}
              autoFocus
            />
            <button onClick={createSheet} className="text-[13px] px-3 py-2 rounded bg-accent text-white font-medium">Create</button>
            <button onClick={() => { setShowNewSheet(false); setNewSheetName('') }} className="text-[13px] px-2 py-2 text-text-dim hover:text-text">Cancel</button>
          </div>
        )}
        {sheets.length === 0 && !showNewSheet ? (
          <div className="text-center py-20 text-text-dim">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="mx-auto mb-3 opacity-30">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
            <p className="text-[14px]">No databases yet</p>
            <p className="text-[13px] mt-1">Create a database to start organizing data</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sheets.map(sheet => (
              <button key={sheet.id} onClick={() => fetchSheet(sheet.id)} className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-hover/60 active:bg-elevated transition-colors group">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text truncate">{sheet.name}</div>
                  <div className="text-[10px] text-text-dim">{sheet.column_count} cols, {sheet.row_count} rows</div>
                </div>
                <IconChevronRight size={16} className="text-text-dim flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
