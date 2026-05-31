// Tasks Completed section — renders the Asana normalized MetricEnvelope.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Section structure: header (workspace name + period) → 1-tile KPI strip →
//   daily completions bar chart → recent tasks table (10 rows).
//
// Data contract consumed:
//   MetricEnvelope.metrics['tasks.completed']       → MetricValue (count)
//   MetricEnvelope.metrics['tasks.completed_daily'] → MetricSeries (date, count)
//   MetricEnvelope.metrics['tasks.recent']          → MetricSeries (task_name, project_name, completed_at)

import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'
import { BlockBarChart } from './BlockBarChart'
import { BlockTable } from './BlockTable'

interface TasksCompletedSectionProps {
  /** Section title from the database row */
  title: string
  /** Optional intro copy (description_html from the section row). */
  descriptionHtml?: string | null
  /** The normalized Asana envelope. Null means no snapshot yet. */
  envelope: MetricEnvelope | null
  /** Previous-period envelope for delta indicators. */
  previousEnvelope?: MetricEnvelope | null
  /** Asana workspace display name (from integration config_json). */
  workspaceName?: string | null
  /** Period dates for the sub-header. */
  periodStart: string
  periodEnd: string
}

function isMetricValue(m: MetricValue | MetricSeries | undefined): m is MetricValue {
  return !!m && 'value' in m
}

function isMetricSeries(m: MetricValue | MetricSeries | undefined): m is MetricSeries {
  return !!m && 'columns' in m
}

function formatPeriod(start: string, end: string): string {
  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  return `${fmt(start)} – ${fmt(end)}`
}

/** Format a completed_at ISO datetime string as relative time ("2d ago", "5h ago"). */
function formatRelativeTime(isoDatetime: string): string {
  const then = new Date(isoDatetime)
  const nowMs = Date.now()
  const diffMs = nowMs - then.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths}mo ago`
}

/** Build a display-friendly series for the recent tasks table — replace the
 *  ISO completed_at with a relative label so the table reads naturally. */
function buildRecentDisplaySeries(raw: MetricSeries): MetricSeries {
  return {
    ...raw,
    columns: raw.columns.map((col) =>
      col.key === 'completed_at' ? { ...col, label: 'Completed' } : col
    ),
    rows: raw.rows.map((row) => ({
      ...row,
      completed_at:
        typeof row.completed_at === 'string'
          ? formatRelativeTime(row.completed_at)
          : row.completed_at,
    })),
  }
}

export function TasksCompletedSection({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope: _previousEnvelope,
  workspaceName,
  periodStart,
  periodEnd,
}: TasksCompletedSectionProps) {
  const metrics = envelope?.metrics ?? {}

  const tasksCompleted = isMetricValue(metrics['tasks.completed'])
    ? metrics['tasks.completed']
    : null
  const completedDaily = isMetricSeries(metrics['tasks.completed_daily'])
    ? metrics['tasks.completed_daily']
    : null
  const recentRaw = isMetricSeries(metrics['tasks.recent'])
    ? metrics['tasks.recent']
    : null
  const recentDisplay = recentRaw ? buildRecentDisplaySeries(recentRaw) : null

  return (
    // PHASE2-TIPTAP: replace outer div with <TiptapSectionNode> custom extension
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {workspaceName && (
            <p className="text-xs text-gray-400 mt-0.5">{workspaceName}</p>
          )}
        </div>
        <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-1 whitespace-nowrap self-start sm:flex-shrink-0 sm:mt-0.5">
          {periodStart && periodEnd ? formatPeriod(periodStart, periodEnd) : 'No period set'}
        </span>
      </div>

      {/* Section description (intro copy from description_html) */}
      {descriptionHtml && (
        // PHASE2-TIPTAP: this renders the section's description_html field.
        // Sprint 3 mounts a Tiptap editor here so PMs can edit before sending.
        <div
          className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      {/* No snapshot state */}
      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No data synced yet. Connect Asana and run the first sync.
        </div>
      )}

      {/* KPI strip — 1 tile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <BlockKpi title="Tasks Completed" metric={tasksCompleted} />
      </div>

      {/* Daily completions bar chart */}
      <div className="mb-5">
        <BlockBarChart
          title="Daily Task Completions"
          series={completedDaily}
          bar={{ dataKey: 'count', label: 'Tasks Completed', color: '#8b5cf6' }}
        />
      </div>

      {/* Recent tasks table */}
      <BlockTable title="Recent Tasks" series={recentDisplay} limit={10} />
    </section>
  )
}
