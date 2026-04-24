'use client'

import { useState } from 'react'

interface GoogleCalendar {
  id: string
  account_id: number
  name: string
  color: string
  visible: number
  is_primary: number
}

interface GoogleAccount {
  id: number
  email: string
}

function CalCheckbox({ checked, color, onClick }: { checked: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-[18px] h-[18px] rounded-[4px] shrink-0 flex items-center justify-center transition-colors border"
      style={{
        backgroundColor: checked ? color : 'transparent',
        borderColor: checked ? color : 'var(--border)',
      }}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6l2.5 2.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

export function CalendarList({
  calendars,
  onCalendarToggle,
  onCalendarColorChange,
}: {
  calendars: GoogleCalendar[]
  onCalendarToggle?: (calId: string, visible: boolean) => void
  onCalendarColorChange?: (calId: string, color: string) => void
}) {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([])
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [search, setSearch] = useState('')

  // Fetch accounts on first render
  useState(() => {
    fetch('/api/google/accounts')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) {
          setAccounts(d)
          const exp: Record<number, boolean> = {}
          d.forEach((a: GoogleAccount) => { exp[a.id] = true })
          setExpanded(exp)
        }
      })
      .catch(() => {})
  })

  // Group calendars by account
  const calsByAccount = accounts.map(acc => ({
    account: acc,
    calendars: calendars.filter(c => c.account_id === acc.id),
  }))

  const accountIds = new Set(accounts.map(a => a.id))
  const ungrouped = calendars.filter(c => !accountIds.has(c.account_id))

  // Filter by search
  const filterCal = (name: string) => !search || name.toLowerCase().includes(search.toLowerCase())

  async function toggleCalendar(calId: string, currentVisible: number) {
    const newVisible = currentVisible !== 1
    await fetch('/api/google/calendars/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: calId, visible: newVisible }),
    })
    onCalendarToggle?.(calId, newVisible)
  }

  // Count my calendars
  const myCalendars = calendars.filter(c => c.is_primary === 1)

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[15px] font-bold text-text">Calendars</h4>
        <a href="/settings?section=calendars" className="text-[12px] text-text-dim hover:text-text">+ Add calendar</a>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-transparent">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search teammates"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim w-full"
        />
      </div>

      {/* My calendars */}
      {myCalendars.length > 0 && (
        <div>
          <button className="text-[12px] text-text-dim font-medium mb-1.5 flex items-center gap-1">
            My calendars ({myCalendars.length})
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
          </button>
          {myCalendars.filter(c => filterCal(c.name)).map(c => (
            <div key={c.id} className="flex items-center gap-2.5 py-1.5">
              <CalCheckbox checked={c.visible === 1} color={c.color} onClick={() => toggleCalendar(c.id, c.visible)} />
              <span className="text-[13px] text-text truncate">{c.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Accounts */}
      {calsByAccount.map(({ account, calendars: cals }) => {
        const isExpanded = expanded[account.id]
        const subCals = cals.filter(c => c.is_primary !== 1 && filterCal(c.name))
        return (
          <div key={account.id}>
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [account.id]: !prev[account.id] }))}
              className="text-[12px] text-text-dim font-medium mb-1.5 flex items-center gap-1"
            >
              Accounts ({cals.length})
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`transition-transform ${isExpanded ? '' : '-rotate-90'}`}><path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            </button>

            {isExpanded && (
              <>
                {/* Account header */}
                <div className="flex items-center gap-2.5 py-1.5">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 text-text-dim"><path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                  <span className="text-[13px] text-text truncate">{account.email}</span>
                </div>

                {/* Sub-calendars */}
                <div className="ml-4 space-y-0">
                  {subCals.map(c => (
                    <div key={c.id} className="flex items-center gap-2.5 py-1.5">
                      <CalCheckbox checked={c.visible === 1} color={c.color} onClick={() => toggleCalendar(c.id, c.visible)} />
                      <span className="text-[13px] text-text-secondary truncate">{c.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* Ungrouped */}
      {ungrouped.filter(c => filterCal(c.name)).map(c => (
        <div key={c.id} className="flex items-center gap-2.5 py-1.5">
          <CalCheckbox checked={c.visible === 1} color={c.color} onClick={() => toggleCalendar(c.id, c.visible)} />
          <span className="text-[13px] text-text-secondary truncate">{c.name}</span>
        </div>
      ))}

      {calendars.length === 0 && accounts.length === 0 && (
        <p className="text-[12px] text-text-dim">No calendars connected. <a href="/settings?section=calendars" className="text-text-secondary hover:text-text underline">Connect Google Calendar</a></p>
      )}
    </div>
  )
}
