'use client'

// RecentEntriesTable — renders Gravity Forms `forms.recent_entries` MetricSeries.
//
// Each row is clickable → opens the WP-admin entry view in a new tab.
// Date column header toggles sort asc/desc.
//
// Client component because it owns sort state. The series data is server-rendered
// and passed in as a prop.

import { useState, useMemo } from 'react'
import type { MetricSeries } from '@/lib/platform/adapter-contract'

interface RecentEntriesTableProps {
  series: MetricSeries | null
  title?: string
  /** When true, the entry link is suppressed (clients viewing /r/[token] shouldn't
   *  follow a link that points to the WP admin — they can't auth there). */
  readOnly?: boolean
}

type SortDir = 'desc' | 'asc'

function formatDate(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // GF returns "YYYY-MM-DD HH:MM:SS" in site-local time. Render as
  // "May 21, 2026, 10:30 AM" for readability; falls back to raw string
  // if parsing fails.
  const iso = raw.replace(' ', 'T')
  const d = new Date(iso)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function RecentEntriesTable({ series, title = 'Recent Entries', readOnly }: RecentEntriesTableProps) {
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const rows = useMemo(() => {
    if (!series?.rows) return []
    const copy = [...series.rows]
    copy.sort((a, b) => {
      const da = String(a.entry_date ?? '')
      const db = String(b.entry_date ?? '')
      return sortDir === 'desc' ? db.localeCompare(da) : da.localeCompare(db)
    })
    return copy
  }, [series, sortDir])

  if (!series || rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
        <p className="text-sm text-gray-400">No entries in this period.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <span className="text-xs text-gray-400">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Message</th>
              <th className="px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                  className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
                  aria-label={`Sort by entry date ${sortDir === 'desc' ? 'ascending' : 'descending'}`}
                >
                  Entry Date
                  <span aria-hidden="true">{sortDir === 'desc' ? '↓' : '↑'}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const entryUrl = typeof row.entry_url === 'string' ? row.entry_url : null
              const RowEl = entryUrl && !readOnly ? 'a' : 'div'
              const rowProps =
                entryUrl && !readOnly
                  ? { href: entryUrl, target: '_blank', rel: 'noopener noreferrer' }
                  : {}

              return (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 align-top">
                    <RowEl
                      {...rowProps}
                      className={
                        entryUrl && !readOnly
                          ? 'text-gray-900 font-medium hover:text-[var(--platform-accent,#0891b2)] hover:underline'
                          : 'text-gray-900 font-medium'
                      }
                    >
                      {row.name || <span className="text-gray-400 italic">—</span>}
                    </RowEl>
                  </td>
                  <td className="px-4 py-2.5 align-top text-gray-700 whitespace-nowrap">
                    {row.phone ? (
                      <a
                        href={`tel:${row.phone}`}
                        className="hover:underline hover:text-[var(--platform-accent,#0891b2)]"
                      >
                        {row.phone}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top text-gray-700">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="hover:underline hover:text-[var(--platform-accent,#0891b2)] break-all"
                      >
                        {row.email}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top text-gray-600 max-w-md">
                    {row.message ? (
                      <span title={String(row.message)}>{truncate(String(row.message), 120)}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top text-gray-500 whitespace-nowrap text-xs">
                    {formatDate(row.entry_date)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
