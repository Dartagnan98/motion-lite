// WordPress REST adapter — provider-specific raw types.
//
// Reference: https://developer.wordpress.org/rest-api/reference/
// API base: <siteUrl>/wp-json/
//
// Auth: HTTP Basic — base64("username:appPassword") in Authorization header.
// Application Passwords were added in WordPress 5.6.
//
// Endpoints used:
//   GET  /wp-json/                      — site info + WP version
//   GET  /wp-json/wp/v2/users/me        — validate credentials (used in connect())
//   GET  /wp-json/wp/v2/posts           — list posts; X-WP-Total header = total count
//   GET  /wp-json/wp/v2/pages           — list pages; X-WP-Total header = total count
//   GET  /wp-json/wp/v2/media           — list media uploads; X-WP-Total header = total count

// ─── Site root ────────────────────────────────────────────────────────────────

/** Partial shape of GET /wp-json/ (site root). We only extract what we need. */
export interface WpSiteRoot {
  /** WordPress version string, e.g. "6.5.2". May be omitted on some hardened sites. */
  wp_version?: string
  /** Site name. */
  name?: string
  /** Site description (tagline). */
  description?: string
  /** Site URL. */
  url?: string
  /** Namespace list — includes "wp/v2" on standard WP installs. */
  namespaces?: string[]
  /** REST API version info — some WP installs put version here. */
  version?: string
  [key: string]: unknown
}

// ─── WP user (from /wp/v2/users/me) ──────────────────────────────────────────

export interface WpUser {
  id: number
  name: string
  email?: string
  roles?: string[]
  slug?: string
}

// ─── WP post ─────────────────────────────────────────────────────────────────

/** A WordPress post object (partial — we extract title, date, status). */
export interface WpPost {
  id: number
  /** Post title — rendered HTML. We use `.rendered` for display. */
  title: { rendered: string }
  /** ISO datetime string (UTC). */
  date: string
  /** Post status: "publish", "draft", "pending", "private", etc. */
  status: string
  /** Post type: "post", "page", etc. */
  type: string
  /** Permalink. */
  link?: string
}

// ─── WP media ────────────────────────────────────────────────────────────────

/** A WordPress media item (partial). */
export interface WpMedia {
  id: number
  date: string
  title: { rendered: string }
  media_type: string  // "image" | "file"
  mime_type: string
}

// ─── Raw snapshot ─────────────────────────────────────────────────────────────

/** Composite raw snapshot assembled by fetchSnapshot. */
export interface WordPressRawSnapshot {
  /** Canonical site URL, e.g. "https://glenvalleydental.com". */
  siteUrl: string
  /** Period start date YYYY-MM-DD. */
  periodStart: string
  /** Period end date YYYY-MM-DD. */
  periodEnd: string
  /** WordPress version string extracted from the site root. */
  wpVersion: string | null
  /** Total posts published in the period (from X-WP-Total header). */
  postsPublishedCount: number
  /** Total pages published in the period (from X-WP-Total header). */
  pagesPublishedCount: number
  /** Total media items uploaded in the period (from X-WP-Total header). */
  mediaUploadsCount: number
  /** Up to 10 most recently published posts (for the recent posts series). */
  recentPosts: WpPost[]
  /** Stamped server-side at fetch time. */
  fetchedAt: string  // ISO datetime
}
