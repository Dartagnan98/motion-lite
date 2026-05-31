// SE Ranking adapter — provider-specific raw types.
//
// Reference: https://api.seranking.com/ (SE Ranking Project API)
// Auth: Authorization: Token <api_key> header
//
// Endpoints used:
//   GET  /v1/project-management/sites               — list user's tracked sites/projects
//   GET  /sites/{id}/positions                       — current keyword positions for a site
//   GET  /sites/{id}/positions/history               — historical position data per keyword
//
// Rate limit: 100 requests/minute per API key. With one project per integration,
// fetchSnapshot makes 2 calls (positions + history). Well within limits.

// ─── Sites (projects) ─────────────────────────────────────────────────────────

/** A single SE Ranking tracked site, as returned by GET /sites. */
export interface SeRankingSite {
  /** Numeric project ID. Used in all subsequent API calls. */
  id: number
  /** User-assigned project name, e.g. "Glenvalley Dental". */
  title: string
  /** The tracked domain URL, e.g. "glenvalleydental.com". */
  name: string
  /** 1 = active tracking, 0 = paused. */
  is_active: number
  /** Total number of keywords being tracked in this project. */
  keywords_count: number
  /** Search engine configurations assigned to this site. */
  search_engines?: SeRankingSearchEngine[]
}

/** A search engine configuration for a site. */
export interface SeRankingSearchEngine {
  id: number
  name: string
  /** Country code, e.g. "US". */
  country_code?: string
  /** Language code, e.g. "en". */
  language_code?: string
}

// ─── Keyword positions ────────────────────────────────────────────────────────

/** A single keyword record from the Project API. Shape verified live 2026-05-21:
 *    { id, name, group_id, volume, competition, cpc, results, positions: [...] }
 *  The keyword TEXT is in `name`. Rank-per-date is in `positions[i].pos`,
 *  where `pos: 0` + `depth: 100` is a sentinel meaning "not ranked in top 100". */
export interface SeRankingKeywordPosition {
  /** Internal SE Ranking keyword id (numeric string). */
  id?: string | number
  /** Keyword text. SE Ranking returns this under `name`, not `keyword`. */
  name: string
  /** Group ID inside the project. */
  group_id?: number
  /** Monthly search volume. */
  volume?: number | null
  /** Keyword difficulty / competition score (0-1). */
  competition?: number | null
  /** Cost-per-click estimate. */
  cpc?: number | null
  /** Array of per-date position rows. Even for a single-day request, returned
   *  as a 1-element array. */
  positions: SeRankingPositionRow[]
}

/** A single per-date row inside a keyword's `positions` array. */
export interface SeRankingPositionRow {
  /** ISO date YYYY-MM-DD. */
  date: string
  /** Rank position. 0 = not ranked within depth (see `depth` field). */
  pos: number
  /** How deep the engine looked (typically 100 = top 100). */
  depth?: number
  /** Position change vs previous check (positive = improved). */
  change?: number
  /** Whether the result is a map pack. */
  is_map?: number
  /** Map pack position if is_map. */
  map_position?: number
  /** Paid (ad) position if any. */
  paid_position?: number
}

/** Response from GET /sites/{id}/positions. May be wrapped or raw array. */
export type SeRankingPositionsResponse =
  | SeRankingKeywordPosition[]
  | { data: SeRankingKeywordPosition[] }

// ─── Historical rank data ─────────────────────────────────────────────────────

/** A single history entry from GET /sites/{id}/positions/history. */
export interface SeRankingHistoryEntry {
  /** ISO date string YYYY-MM-DD. */
  date: string
  /** Average position across all tracked keywords on this date. */
  avg_position: number
}

/** Response from GET /sites/{id}/positions/history. May be wrapped or raw array. */
export type SeRankingHistoryResponse =
  | SeRankingHistoryEntry[]
  | { data: SeRankingHistoryEntry[] }

// ─── Raw snapshot ─────────────────────────────────────────────────────────────

/** Composite raw snapshot assembled by fetchSnapshot.
 *  This is what fetchSnapshot returns and what persists to raw_json. */
export interface SeRankingRawSnapshot {
  /** SE Ranking site (project) ID. */
  projectId: number
  /** User-facing project name. */
  projectName: string
  /** Period start date YYYY-MM-DD. */
  periodStart: string
  /** Period end date YYYY-MM-DD. */
  periodEnd: string
  /** Current keyword positions (as of last SE Ranking check within the period). */
  positions: SeRankingKeywordPosition[]
  /** Daily average position history for the period. */
  history: SeRankingHistoryEntry[]
  /** Stamped server-side at fetch time. */
  fetchedAt: string  // ISO datetime
}
