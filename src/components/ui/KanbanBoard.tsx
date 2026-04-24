'use client'

import { useState, type ReactNode } from 'react'

export type KanbanColumn = {
  key: string
  label: string
  color?: string
}

export type KanbanBoardProps<T> = {
  columns: KanbanColumn[]
  items: T[]
  getItemId: (item: T) => string | number
  getItemColumn: (item: T) => string
  onMove: (itemId: string | number, toColumnKey: string) => void | Promise<void>
  renderCard: (item: T, opts: { isDragging: boolean }) => ReactNode
  renderColumnHeaderRight?: (column: KanbanColumn, items: T[]) => ReactNode
  renderEmptyColumn?: (column: KanbanColumn, isOver: boolean) => ReactNode
  columnWidth?: number
  dragMimeType?: string
}

export function KanbanBoard<T>({
  columns,
  items,
  getItemId,
  getItemColumn,
  onMove,
  renderCard,
  renderColumnHeaderRight,
  renderEmptyColumn,
  columnWidth = 300,
  dragMimeType = 'text/kanban-item-id',
}: KanbanBoardProps<T>) {
  const [draggingId, setDraggingId] = useState<string | number | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  return (
    <div className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full min-w-max gap-3 p-1">
        {columns.map((col) => {
          const colItems = items.filter((item) => getItemColumn(item) === col.key)
          const isOver = dragOverKey === col.key && draggingId !== null
          const dot = col.color || 'var(--accent)'
          return (
            <div
              key={col.key}
              className={`flex shrink-0 flex-col rounded-lg transition-colors ${isOver ? 'bg-[color:var(--accent)]/5' : ''}`}
              style={{ width: columnWidth }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDragOverKey(col.key)
              }}
              onDragLeave={() => {
                if (dragOverKey === col.key) setDragOverKey(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const raw = e.dataTransfer.getData(dragMimeType)
                setDragOverKey(null)
                if (!raw) return
                const asNum = Number(raw)
                const id = Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw
                Promise.resolve(onMove(id, col.key)).catch(() => {})
              }}
            >
              <div className="mb-1 flex items-center justify-between px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
                  <span className="truncate text-[13px] font-medium text-[var(--text)]">{col.label}</span>
                  <span className="shrink-0 text-[12px] text-[var(--text-dim)]">{colItems.length}</span>
                </div>
                {renderColumnHeaderRight?.(col, colItems)}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-1 pb-4 scrollbar-thin">
                {colItems.map((item) => {
                  const id = getItemId(item)
                  const isDragging = draggingId === id
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData(dragMimeType, String(id))
                        setDraggingId(id)
                        if (e.currentTarget instanceof HTMLElement) {
                          const rect = e.currentTarget.getBoundingClientRect()
                          e.dataTransfer.setDragImage(e.currentTarget, e.clientX - rect.left, e.clientY - rect.top)
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingId(null)
                        setDragOverKey(null)
                      }}
                    >
                      {renderCard(item, { isDragging })}
                    </div>
                  )
                })}
                {colItems.length === 0 && (
                  renderEmptyColumn
                    ? renderEmptyColumn(col, isOver)
                    : <div className={`rounded-lg border-2 border-dashed py-8 text-center text-[12px] transition-colors ${
                        isOver ? 'border-[color:var(--accent)]/40 text-[var(--accent-text)]' : 'border-transparent text-[var(--text-dim)]'
                      }`}>
                        {isOver ? 'Drop here' : 'Empty'}
                      </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
