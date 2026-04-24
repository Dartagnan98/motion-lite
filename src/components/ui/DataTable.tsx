'use client'

import { CSSProperties, Key, ReactNode } from 'react'
import { SkeletonTable } from './Skeleton'
import { EmptyState } from './EmptyState'

export interface DataTableColumn<Row> {
  id: string
  header: ReactNode
  cell: (row: Row, index: number) => ReactNode
  width?: number | string
  align?: 'left' | 'right' | 'center'
  sticky?: boolean
  mono?: boolean
}

interface DataTableProps<Row> {
  rows: Row[]
  columns: DataTableColumn<Row>[]
  rowKey: (row: Row, index: number) => Key
  onRowClick?: (row: Row, index: number) => void
  selectedKey?: Key
  loading?: boolean
  loadingRows?: number
  empty?: { title: string; description?: string; icon?: ReactNode; action?: { label: string; onClick: () => void } }
  zebra?: boolean
  compact?: boolean
  stickyHeader?: boolean
  rowHeight?: number
  rowStyle?: (row: Row, index: number, selected: boolean) => CSSProperties | undefined
  className?: string
  style?: CSSProperties
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  loading = false,
  loadingRows = 6,
  empty,
  zebra = true,
  compact = false,
  stickyHeader = true,
  rowHeight,
  rowStyle,
  className,
  style,
}: DataTableProps<Row>) {
  const cellPadX = compact ? 10 : 14
  const cellPadY = compact ? 8 : 11
  const fontSize = compact ? 12 : 13

  const gridTemplate = columns
    .map(c => (c.width ? (typeof c.width === 'number' ? `${c.width}px` : c.width) : 'minmax(0, 1fr)'))
    .join(' ')

  const headerRow = (
    <div role="rowgroup" style={headerRowStyle(stickyHeader, gridTemplate)}>
      {columns.map(c => (
        <HeaderCell key={c.id} column={c} padX={cellPadX} />
      ))}
    </div>
  )

  if (loading) {
    return (
      <div className={className} style={style}>
        {headerRow}
        <SkeletonTable rows={loadingRows} columns={columns.map(() => 1)} />
      </div>
    )
  }

  if (rows.length === 0 && empty) {
    return (
      <div className={className} style={style}>
        {headerRow}
        <EmptyState {...empty} />
      </div>
    )
  }

  return (
    <div className={className} style={{ ...style, overflow: 'auto' }}>
      <div
        role="table"
        style={{ display: 'flex', flexDirection: 'column', minWidth: 'max-content', width: '100%' }}
      >
        {headerRow}
        <div role="rowgroup">
          {rows.map((row, i) => {
            const key = rowKey(row, i)
            const isSelected = selectedKey !== undefined && key === selectedKey
            const baseBackground = isSelected
              ? 'var(--accent-dim)'
              : zebra && i % 2 === 1
                ? 'rgba(255,255,255,0.01)'
                : 'transparent'
            const customRowStyle = rowStyle?.(row, i, isSelected)
            return (
              <div
                key={key}
                role="row"
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  alignItems: 'center',
                  height: rowHeight,
                  background: baseBackground,
                  borderBottom: '1px solid var(--border)',
                  cursor: onRowClick ? 'pointer' : undefined,
                  fontSize,
                  color: 'var(--text)',
                  transition: 'background 0.1s ease',
                  ...customRowStyle,
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.background = customRowStyle?.background ? String(customRowStyle.background) : 'rgba(255,255,255,0.04)'
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = customRowStyle?.background ? String(customRowStyle.background) : baseBackground
                }}
              >
                {columns.map(c => (
                  <div
                    key={c.id}
                    role="cell"
                    style={{
                      padding: `${cellPadY}px ${cellPadX}px`,
                      textAlign: c.align || 'left',
                      fontFamily: c.mono ? 'var(--font-mono)' : undefined,
                      fontSize: c.mono ? fontSize - 1 : fontSize,
                      color: c.mono ? 'var(--text-secondary)' : undefined,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.cell(row, i)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function headerRowStyle(sticky: boolean, gridTemplate: string): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: gridTemplate,
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-chrome)',
    position: sticky ? 'sticky' : undefined,
    top: sticky ? 0 : undefined,
    zIndex: sticky ? 2 : undefined,
  }
}

function HeaderCell<Row>({ column, padX }: { column: DataTableColumn<Row>; padX: number }) {
  return (
    <div
      role="columnheader"
      style={{
        minWidth: 0,
        padding: `9px ${padX}px`,
        textAlign: column.align || 'left',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {column.header}
    </div>
  )
}
