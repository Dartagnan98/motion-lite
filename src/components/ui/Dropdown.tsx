'use client'

import { useState, useRef, type ReactNode } from 'react'
import { Popover } from './Popover'
import { IconChevronDown, IconCheck } from '@/components/ui/Icons'

export interface DropdownOption {
  label: string
  value: string
  icon?: ReactNode
  color?: string
  description?: string
  disabled?: boolean
}

interface DropdownProps {
  options: DropdownOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  searchable?: boolean
  className?: string
  triggerClassName?: string
  disabled?: boolean
  side?: 'top' | 'bottom'
  align?: 'start' | 'center' | 'end'
  minWidth?: number
  defaultOpen?: boolean
  onClose?: () => void
  renderTrigger?: (props: { selected: DropdownOption | undefined; open: boolean }) => ReactNode
  renderOption?: (option: DropdownOption, isSelected: boolean) => ReactNode
  theme?: 'dark' | 'light'
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchable = false,
  className,
  triggerClassName,
  disabled = false,
  side = 'bottom',
  align = 'start',
  minWidth = 140,
  defaultOpen = false,
  onClose,
  renderTrigger,
  renderOption,
  theme,
}: DropdownProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const handleSelect = (optValue: string) => {
    setOpen(false)
    setSearch('')
    onChange?.(optValue)
  }

  const handleOpenChange = (next: boolean) => {
    if (disabled) return
    setOpen(next)
    if (!next) {
      setSearch('')
      onClose?.()
    }
    if (next && searchable) {
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }

  const isLight = theme === 'light'

  const defaultTrigger = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => handleOpenChange(!open)}
      className={triggerClassName || `
        inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[13px]
        transition-colors cursor-pointer
        ${disabled ? 'opacity-50 cursor-not-allowed' : isLight ? 'hover:bg-[rgba(0,0,0,0.04)]' : 'hover:bg-[rgba(255,255,255,0.06)]'}
        ${value ? (isLight ? 'text-gray-900' : 'text-text') : (isLight ? 'text-gray-400' : 'text-text-dim')}
      `}
    >
      {selected?.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{selected.icon}</span>}
      {selected?.color && <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: selected.color }} />}
      <span className="truncate">{selected?.label || placeholder}</span>
      <IconChevronDown size={10} className="shrink-0 ml-auto opacity-50" />
    </button>
  )

  const trigger = renderTrigger
    ? <div onClick={() => handleOpenChange(!open)}>{renderTrigger({ selected, open })}</div>
    : defaultTrigger

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger={trigger}
      side={side}
      align={align}
      minWidth={minWidth}
      className={className}
      theme={theme}
    >
      <div className="py-1 max-h-[280px] overflow-y-auto">
        {searchable && (
          <div className="px-2.5 py-1.5 border-b border-border/60">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className={`w-full text-[12px] outline-none ${
                isLight
                  ? 'bg-transparent text-gray-900 placeholder:text-gray-400'
                  : 'bg-transparent text-text placeholder:text-text-dim'
              }`}
              onKeyDown={e => {
                if (e.key === 'Escape') handleOpenChange(false)
              }}
            />
          </div>
        )}
        {filtered.map((opt) => {
          const isSelected = value === opt.value
          if (renderOption) {
            return (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => !opt.disabled && handleSelect(opt.value)}
                className={`w-full text-left transition-colors ${opt.disabled ? 'opacity-40 cursor-default' : `cursor-pointer`}`}
              >
                {renderOption(opt, isSelected)}
              </button>
            )
          }
          return (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => !opt.disabled && handleSelect(opt.value)}
              className={`
                flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-left transition-colors
                ${isSelected ? (isLight ? 'bg-[rgba(0,0,0,0.05)] font-medium' : 'bg-[rgba(255,255,255,0.08)] font-medium') : ''}
                ${opt.disabled
                  ? (isLight ? 'text-gray-300 cursor-default' : 'text-text-dim cursor-default')
                  : (isLight ? 'text-gray-900 hover:bg-[rgba(0,0,0,0.04)] cursor-pointer' : 'text-text hover:bg-[rgba(255,255,255,0.06)] cursor-pointer')
                }
              `}
              style={{ borderRadius: 'var(--radius-sm)' }}
            >
              {opt.color && (
                <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: opt.color }} />
              )}
              {opt.icon && (
                <span className="shrink-0 w-4 h-4 flex items-center justify-center">{opt.icon}</span>
              )}
              <span className="flex-1 truncate">{opt.label}</span>
              {opt.description && (
                <span className={`text-[12px] truncate ${isLight ? 'text-gray-400' : 'text-text-dim'}`}>{opt.description}</span>
              )}
              {isSelected && !opt.color && (
                <IconCheck size={14} className={`shrink-0 ${isLight ? 'text-gray-600' : 'text-text-secondary'}`} />
              )}
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className={`px-3 py-2 text-[13px] ${isLight ? 'text-gray-400' : 'text-text-dim'}`}>No results</div>
        )}
      </div>
    </Popover>
  )
}
