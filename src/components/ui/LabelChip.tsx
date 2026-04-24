'use client'

import React from 'react'

interface LabelChipProps {
  name: string
  color: string
  onRemove?: () => void
  size?: 'sm' | 'md'
}

export function LabelChip({ name, color, onRemove, size = 'md' }: LabelChipProps) {
  const isSm = size === 'sm'
  const displayName = isSm && name.length > 15 ? name.slice(0, 15) + '...' : name.length > 20 ? name.slice(0, 20) + '...' : name

  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium ${isSm ? 'px-1.5 text-[10px]' : 'px-1.5 text-[12px]'}`}
      style={{
        backgroundColor: color,
        color: 'white',
        paddingTop: isSm ? '1px' : '1.5px',
        paddingBottom: isSm ? '1px' : '1.5px',
      }}
    >
      {displayName}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="hover:text-red-200 text-white/70 transition-colors leading-none"
          style={{ fontSize: isSm ? '10px' : '12px' }}
        >
          &times;
        </button>
      )}
    </span>
  )
}

/** Safely parse labels from JSON array string or CSV string */
export function safeParseLabels(labels: string | null | undefined): string[] {
  if (!labels) return []
  try {
    const parsed = JSON.parse(labels)
    return Array.isArray(parsed) ? parsed : [String(parsed)]
  } catch {
    return labels.split(',').map(s => s.trim()).filter(Boolean)
  }
}

export const LABEL_COLORS = ['#3c8cdc', '#8c3cdc', '#dd3c64', '#dc3c3c', '#dd643c', '#3cddb4', '#3bdd8c', '#64dc3c', '#ddb53c', '#8c8c8c', '#262659', '#8bdd3c']
