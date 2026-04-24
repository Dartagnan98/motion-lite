'use client'

import { useState } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { StatusIcon, renderStatusOption } from '@/components/ui/StatusIcon'
import { STATUS_OPTIONS_ALL, PRIORITY_OPTIONS } from '@/lib/task-constants'
import { useTeamMembers } from '@/lib/use-team-members'

export type ViewMode = 'list' | 'kanban' | 'gantt' | 'calendar'

interface FilterState {
  status: string
  priority: string
  assignee: string
  search: string
}

export function ViewToolbar({
  viewMode,
  onViewChange,
  filters,
  onFilterChange,
  sortBy,
  onSortChange,
}: {
  viewMode: ViewMode
  onViewChange: (mode: ViewMode) => void
  filters: FilterState
  onFilterChange: (filters: FilterState) => void
  sortBy: string
  onSortChange: (sort: string) => void
}) {
  const [showFilters, setShowFilters] = useState(false)
  const teamMembers = useTeamMembers()

  const statusFilterOptions = [
    { value: '', label: 'All Statuses' },
    ...STATUS_OPTIONS_ALL.map(s => ({ value: s.value, label: s.label, color: s.color })),
  ]

  const priorityFilterOptions = [
    { value: '', label: 'All Priorities' },
    ...PRIORITY_OPTIONS.map(p => ({ value: p.value, label: p.label, color: p.color })),
  ]

  const assigneeFilterOptions = [
    { value: '', label: 'All Assignees' },
    ...teamMembers.map(m => ({ value: m.id, label: m.name })),
  ]

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      {/* View toggle tabs */}
      <div className="flex items-center gap-0">
        {([
          { mode: 'list' as ViewMode, label: 'List', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 2h10M1 6h10M1 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg> },
          { mode: 'kanban' as ViewMode, label: 'Kanban', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="0.5" y="0.5" width="3" height="11" rx="0.5" stroke="currentColor" strokeWidth="1" /><rect x="4.5" y="0.5" width="3" height="7" rx="0.5" stroke="currentColor" strokeWidth="1" /><rect x="8.5" y="0.5" width="3" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" /></svg> },
          { mode: 'gantt' as ViewMode, label: 'Timeline', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1.5" width="6" height="2" rx="0.5" fill="currentColor" /><rect x="3" y="5" width="7" height="2" rx="0.5" fill="currentColor" /><rect x="2" y="8.5" width="5" height="2" rx="0.5" fill="currentColor" /></svg> },
          { mode: 'calendar' as ViewMode, label: 'Calendar', icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" /><path d="M1 5h10M4 0.5v3M8 0.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg> },
        ]).map(({ mode, label, icon }) => (
          <button
            key={mode}
            onClick={() => onViewChange(mode)}
            className={`relative flex items-center gap-1.5 px-2 h-[25px] text-[13px] font-medium transition-colors ${
              viewMode === mode
                ? 'text-white'
                : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {icon}
            {label}
            {viewMode === mode && (
              <span className="absolute bottom-0 left-1 right-1 h-[2px] bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Sort */}
      <Dropdown
        value={sortBy}
        onChange={onSortChange}
        options={[
          { value: 'sort_order', label: 'Manual' },
          { value: 'priority', label: 'Priority' },
          { value: 'due_date', label: 'Due Date' },
          { value: 'created_at', label: 'Created' },
          { value: 'title', label: 'Name' },
          { value: 'status', label: 'Status' },
        ]}
        placeholder="Sort"
        minWidth={130}
        triggerClassName="h-[25px] inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-1.5 text-[13px] font-medium text-text-secondary hover:border-border-strong cursor-pointer"
      />

      {/* Filter toggle */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className={`flex items-center gap-1.5 h-[25px] rounded-[6px] border px-1.5 py-0.5 text-[13px] font-medium transition-colors ${
          showFilters
            ? 'border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] text-text'
            : 'border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] text-text-dim hover:text-text-secondary'
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M1 2h10L7 6.5V10l-2-1V6.5L1 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        Filter
      </button>

      {/* Search */}
      <div className="relative">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          value={filters.search}
          onChange={(e) => onFilterChange({ ...filters, search: e.target.value })}
          placeholder="Search tasks..."
          className="w-40 h-[25px] rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] pl-7 pr-2 text-[13px] font-medium text-text outline-none placeholder:text-text-dim focus:border-border-strong"
        />
      </div>

      {/* Filter dropdowns */}
      {showFilters && (
        <div className="flex items-center gap-2 ml-2">
          <Dropdown
            value={filters.status}
            onChange={(v) => onFilterChange({ ...filters, status: v })}
            options={statusFilterOptions}
            placeholder="All Statuses"
            minWidth={150}
            renderOption={renderStatusOption}
            renderTrigger={({ selected }) => (
              <button type="button" className="h-[25px] inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-1.5 text-[13px] font-medium text-text-secondary cursor-pointer">
                {filters.status ? <StatusIcon status={filters.status} size={12} /> : null}
                {selected?.label || 'All Statuses'}
              </button>
            )}
          />
          <Dropdown
            value={filters.priority}
            onChange={(v) => onFilterChange({ ...filters, priority: v })}
            options={priorityFilterOptions}
            placeholder="All Priorities"
            minWidth={140}
            triggerClassName="h-[25px] inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-1.5 text-[13px] font-medium text-text-secondary cursor-pointer"
          />
          <Dropdown
            value={filters.assignee}
            onChange={(v) => onFilterChange({ ...filters, assignee: v })}
            options={assigneeFilterOptions}
            placeholder="All Assignees"
            minWidth={140}
            triggerClassName="h-[25px] inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--filter-btn-border)] bg-[var(--filter-btn-bg)] px-1.5 text-[13px] font-medium text-text-secondary cursor-pointer"
          />
        </div>
      )}
    </div>
  )
}
