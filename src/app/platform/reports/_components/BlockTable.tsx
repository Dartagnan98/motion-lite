// Block: Data table
//
// Renders a MetricSeries as an HTML table. Used for Top Queries and Top Pages
// in the Search Performance section.
//
// Sprint 2: plain RSC. Truncates long URLs/queries for readability.
// Phase 2: add sorting, pagination, CSV export.

import type { MetricSeries } from '@/lib/platform/adapter-contract'

interface BlockTableProps {
  title: string
  series: MetricSeries | null
  /** How many rows to show (default 10) */
  limit?: number
}

function formatCell(value: string | number | null, type: string): string {
  if (value === null || value === undefined) return '—'
  if (type === 'percent') {
    const n = Number(value)
    return isNaN(n) ? String(value) : `${(n * 100).toFixed(1)}%`
  }
  if (type === 'number') {
    const n = Number(value)
    return isNaN(n) ? String(value) : n.toLocaleString(undefined, { maximumFractionDigits: 1 })
  }
  if (type === 'string') {
    const s = String(value)
    // Truncate long URLs/queries so the table stays readable
    return s.length > 60 ? s.slice(0, 57) + '…' : s
  }
  return String(value)
}

export function BlockTable({ title, series, limit = 10 }: BlockTableProps) {
  if (!series || series.rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-700 mb-3">{title}</p>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    )
  }

  const rows = series.rows.slice(0, limit)
  // Identify the primary (string) column — usually first
  const primaryCol = series.columns.find((c) => c.type === 'string') ?? series.columns[0]
  const metricCols = series.columns.filter((c) => c !== primaryCol)

  return (
    <div data-report-card className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-medium text-gray-700">{title}</p>
      </div>

      {/* Mobile card list — hidden at md+ */}
      <div className="md:hidden divide-y divide-gray-50">
        {rows.map((row, i) => (
          <div key={i} className="px-4 py-3 hover:bg-gray-50 transition-colors">
            <p className="text-sm text-gray-800 font-medium truncate" title={String(row[primaryCol.key] ?? '')}>
              {formatCell(row[primaryCol.key] as string | number | null, primaryCol.type)}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              {metricCols.map((col) => (
                <span key={col.key} className="text-xs text-gray-500">
                  <span className="text-gray-400">{col.label}: </span>
                  <span className="tabular-nums font-medium text-gray-700">
                    {formatCell(row[col.key] as string | number | null, col.type)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table — hidden below md */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {series.columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide ${
                    col.type !== 'string' ? 'text-right' : ''
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
              >
                {series.columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-2.5 text-gray-700 tabular-nums ${
                      col.type !== 'string' ? 'text-right' : ''
                    }`}
                    title={col.type === 'string' ? String(row[col.key] ?? '') : undefined}
                  >
                    {formatCell(row[col.key] as string | number | null, col.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
