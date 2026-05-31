// WordPress REST normalize — raw snapshot → canonical metric envelope.
//
// Slug namespace this adapter publishes (under metric_slug):
//   wp.posts_published  → MetricValue (unit: 'count') — posts published in period
//   wp.pages_published  → MetricValue (unit: 'count') — pages published in period
//   wp.wp_version       → MetricValue (unit: 'count', value = version string)
//   wp.recent_posts     → MetricSeries — last 10 posts: title / publish_date / status
//   wp.media_uploads    → MetricValue (unit: 'count') — media items uploaded in period
//
// Schema drift strategy: throw on missing required fields. Do not silently zero-fill.
// Exception: wpVersion null is not schema drift — some hardened WP sites suppress the
// version header. Surface it as a warning and store "unknown" as the value.
//
// Date format: WP REST returns ISO 8601 datetimes (UTC). We truncate to YYYY-MM-DD
// for MetricSeries rows (ISO date strings per the contract).

import type { MetricEnvelope, MetricSeries, MetricValue } from '../../adapter-contract'
import type { WordPressRawSnapshot } from './types'

export interface WordPressNormalized extends MetricEnvelope {
  provider: 'wordpress'
  metrics: {
    'wp.posts_published': MetricValue
    'wp.pages_published': MetricValue
    'wp.wp_version': MetricValue
    'wp.recent_posts': MetricSeries
    'wp.media_uploads': MetricValue
  }
}

// ─── Main normalizer ─────────────────────────────────────────────────────────

export function normalize(raw: WordPressRawSnapshot): WordPressNormalized {
  // Required top-level field validation.
  if (!raw.siteUrl || typeof raw.siteUrl !== 'string') {
    throw new Error('wordpress.normalize: raw.siteUrl missing or not a string (schema drift)')
  }
  if (!raw.periodStart || !raw.periodEnd) {
    throw new Error('wordpress.normalize: raw.periodStart or periodEnd missing (schema drift)')
  }
  if (typeof raw.postsPublishedCount !== 'number') {
    throw new Error('wordpress.normalize: raw.postsPublishedCount is not a number (schema drift)')
  }
  if (typeof raw.pagesPublishedCount !== 'number') {
    throw new Error('wordpress.normalize: raw.pagesPublishedCount is not a number (schema drift)')
  }
  if (typeof raw.mediaUploadsCount !== 'number') {
    throw new Error('wordpress.normalize: raw.mediaUploadsCount is not a number (schema drift)')
  }
  if (!Array.isArray(raw.recentPosts)) {
    throw new Error('wordpress.normalize: raw.recentPosts is not an array (schema drift)')
  }

  // Validate each recent post record.
  for (let i = 0; i < raw.recentPosts.length; i++) {
    const p = raw.recentPosts[i]
    if (typeof p.id !== 'number') {
      throw new Error(`wordpress.normalize: recentPosts[${i}] missing id (schema drift)`)
    }
    if (!p.title || typeof p.title.rendered !== 'string') {
      throw new Error(`wordpress.normalize: recentPosts[${i}] (id=${p.id}) missing title.rendered (schema drift)`)
    }
    if (typeof p.date !== 'string' || p.date.length < 10) {
      throw new Error(
        `wordpress.normalize: recentPosts[${i}] (id=${p.id}) date "${p.date}" is not a valid ISO string (schema drift)`
      )
    }
  }

  const warnings: string[] = []
  const versionString = raw.wpVersion ?? 'unknown'
  if (!raw.wpVersion) {
    warnings.push('wordpress.normalize: WP version not returned by site — version hardening may be active')
  }

  // Recent posts series: title (strip HTML tags), publish_date (YYYY-MM-DD), status.
  const recentPostRows = raw.recentPosts.map((p) => ({
    title: p.title.rendered.replace(/<[^>]+>/g, '').trim(),
    publish_date: p.date.slice(0, 10),
    status: p.status,
  }))

  return {
    provider: 'wordpress',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    normalizedAt: new Date().toISOString(),
    ...(warnings.length > 0 ? { warnings } : {}),
    metrics: {
      'wp.posts_published': {
        value: raw.postsPublishedCount,
        label: 'Posts Published',
        unit: 'count',
      },
      'wp.pages_published': {
        value: raw.pagesPublishedCount,
        label: 'Pages Published',
        unit: 'count',
      },
      'wp.wp_version': {
        // unit: 'count' per contract (no string unit exists). Renderer reads value as string.
        value: versionString,
        label: 'WordPress Version',
        unit: 'count',
      },
      'wp.recent_posts': {
        columns: [
          { key: 'title', label: 'Title', type: 'string' },
          { key: 'publish_date', label: 'Published', type: 'date' },
          { key: 'status', label: 'Status', type: 'string' },
        ],
        rows: recentPostRows,
      },
      'wp.media_uploads': {
        value: raw.mediaUploadsCount,
        label: 'Media Uploads',
        unit: 'count',
      },
    },
  }
}
