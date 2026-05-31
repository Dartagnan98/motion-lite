// Site & Content section — renders the WordPress REST normalized MetricEnvelope.
//
// This is a NEW sibling section (not a replacement for SiteHealthSection).
// The dispatcher detects 'wp.*' slug prefix and renders this component AFTER
// the existing PageSpeed-based SiteHealthSection.
//
// Wireframe ref: "Hiilites Report Layout for new crm.pdf"
//   Section structure: header (site URL + period) →
//   3-tile KPI strip (posts published, pages published, WP version pill) →
//   optional 4th KPI tile for media uploads (if slug present) →
//   recent activity table (10 rows: title, published date, status).
//
// Data contract consumed:
//   MetricEnvelope.metrics['wp.posts_published'] → MetricValue (unit: 'count')
//   MetricEnvelope.metrics['wp.pages_published'] → MetricValue (unit: 'count')
//   MetricEnvelope.metrics['wp.wp_version']      → MetricValue (string value like "6.5.2")
//   MetricEnvelope.metrics['wp.media_uploads']   → MetricValue (unit: 'count') — optional
//   MetricEnvelope.metrics['wp.recent_posts']    → MetricSeries (title, publish_date, status)

import type { MetricEnvelope, MetricValue, MetricSeries } from '@/lib/platform/adapter-contract'
import { BlockKpi } from './BlockKpi'

interface SiteHealthV2SectionProps {
  title: string
  descriptionHtml?: string | null
  envelope: MetricEnvelope | null
  /** Previous-period envelope for delta computation. */
  previousEnvelope?: MetricEnvelope | null
  siteUrl?: string | null
  periodStart: string
  periodEnd: string
  readOnly?: boolean
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

function formatPublishDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const s = String(dateStr)
    // Bare 'YYYY-MM-DD' → parse as local midnight (not UTC).
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return String(dateStr)
  }
}

function statusBadge(status: string | null | undefined): string {
  const s = String(status ?? '').toLowerCase()
  if (s === 'publish' || s === 'published') return 'Published'
  if (s === 'draft') return 'Draft'
  if (s === 'pending') return 'Pending'
  if (s === 'private') return 'Private'
  if (s === 'future') return 'Scheduled'
  return status ? String(status) : '—'
}

function statusColor(status: string | null | undefined): string {
  const s = String(status ?? '').toLowerCase()
  if (s === 'publish' || s === 'published') return 'bg-green-50 text-green-700 border-green-200'
  if (s === 'draft') return 'bg-gray-100 text-gray-600 border-gray-200'
  if (s === 'future') return 'bg-blue-50 text-blue-700 border-blue-200'
  return 'bg-gray-100 text-gray-500 border-gray-200'
}

export function SiteHealthV2Section({
  title,
  descriptionHtml,
  envelope,
  previousEnvelope: _previousEnvelope,
  siteUrl,
  periodStart,
  periodEnd,
}: SiteHealthV2SectionProps) {
  const metrics = envelope?.metrics ?? {}

  const postsPublished = isMetricValue(metrics['wp.posts_published'])
    ? metrics['wp.posts_published']
    : null
  const pagesPublished = isMetricValue(metrics['wp.pages_published'])
    ? metrics['wp.pages_published']
    : null
  const wpVersion = isMetricValue(metrics['wp.wp_version'])
    ? metrics['wp.wp_version']
    : null
  const mediaUploads = isMetricValue(metrics['wp.media_uploads'])
    ? metrics['wp.media_uploads']
    : null
  const recentPosts = isMetricSeries(metrics['wp.recent_posts'])
    ? metrics['wp.recent_posts']
    : null

  const recentRows = recentPosts ? recentPosts.rows.slice(0, 10) : []

  // Build a display version of wpVersion — show as a "WP 6.5.2" pill value.
  const wpVersionDisplay: MetricValue | null = wpVersion
    ? {
        value: typeof wpVersion.value === 'string'
          ? `WP ${wpVersion.value}`
          : `WP ${wpVersion.value}`,
        label: 'WordPress Version',
      }
    : null

  return (
    // PHASE2-TIPTAP: replace outer div with <TiptapSectionNode> custom extension
    <section className="mb-10">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          {siteUrl && (
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{siteUrl}</p>
          )}
        </div>
        <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-1 whitespace-nowrap self-start sm:flex-shrink-0 sm:mt-0.5">
          {periodStart && periodEnd ? formatPeriod(periodStart, periodEnd) : 'No period set'}
        </span>
      </div>

      {/* Section description */}
      {descriptionHtml && (
        // PHASE2-TIPTAP: this renders the section's description_html field.
        <div
          className="text-sm text-gray-600 mb-5 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      {/* No snapshot state */}
      {!envelope && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5 text-sm text-amber-700">
          No data synced yet. Connect WordPress and run the first sync.
        </div>
      )}

      {/* KPI strip — 3 tiles + optional 4th */}
      <div className={`grid grid-cols-1 sm:grid-cols-${mediaUploads ? '4' : '3'} gap-3 mb-5`}>
        <BlockKpi
          title="Posts Published"
          metric={postsPublished ? { ...postsPublished, label: 'Posts Published' } : null}
        />
        <BlockKpi
          title="Pages Published"
          metric={pagesPublished ? { ...pagesPublished, label: 'Pages Published' } : null}
        />
        <BlockKpi
          title="WordPress Version"
          metric={wpVersionDisplay}
        />
        {mediaUploads && (
          <BlockKpi
            title="Media Uploads"
            metric={{ ...mediaUploads, label: 'Media Uploads' }}
          />
        )}
      </div>

      {/* Recent Activity table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700">Recent Content Activity</p>
        </div>
        {recentRows.length === 0 ? (
          <div className="px-5 py-6 text-sm text-gray-300 text-center">No recent posts</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-2.5 font-medium text-gray-500">Title</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-500">Published</th>
                  <th className="text-right px-5 py-2.5 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-gray-50 last:border-0 ${
                      i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                    }`}
                  >
                    <td className="px-5 py-2.5 text-gray-800 font-medium max-w-[280px] truncate">
                      {String(row.title ?? '')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 whitespace-nowrap">
                      {formatPublishDate(row.publish_date as string | null)}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded border ${statusColor(row.status as string | null)}`}>
                        {statusBadge(row.status as string | null)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
