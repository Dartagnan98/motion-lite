// Hiilite Platform — Snapshot persistence
//
// Adapters return raw payloads + normalize them. This file is the single place
// snapshots get written to platform_snapshots. Keeps fetchSnapshot() in adapters
// pure-ish (just I/O over the provider) and the DB write semantics consistent.

import { getDb, generatePublicId } from '../db'
import { ensurePlatformReady } from './tenant'
import type { MetricEnvelope } from './adapter-contract'

export interface PersistSnapshotInput {
  tenant_id: number
  integration_id: number
  account_id: number
  domain_id?: number | null
  period_start: string
  period_end: string
  raw: unknown                // serialized to raw_json
  normalized: MetricEnvelope  // serialized to normalized_json
}

export interface PersistedSnapshot {
  id: number
  public_id: string
}

/** Insert a new snapshot row and return its id + public_id. Snapshots are
 *  immutable — re-running a fetch creates a new row. The dashboard reads the
 *  latest per (integration, period_end). */
export function persistSnapshot(input: PersistSnapshotInput): PersistedSnapshot {
  ensurePlatformReady()
  const rawJson = JSON.stringify(input.raw)
  const normJson = JSON.stringify(input.normalized)
  const sizeBytes = Buffer.byteLength(rawJson, 'utf8') + Buffer.byteLength(normJson, 'utf8')

  const publicId = generatePublicId()
  const result = getDb().prepare(
    `INSERT INTO platform_snapshots
       (tenant_id, public_id, integration_id, account_id, domain_id,
        period_start, period_end, raw_json, normalized_json, size_bytes, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.tenant_id,
    publicId,
    input.integration_id,
    input.account_id,
    input.domain_id ?? null,
    input.period_start,
    input.period_end,
    rawJson,
    normJson,
    sizeBytes,
    Math.floor(Date.now() / 1000),
  )
  return { id: Number(result.lastInsertRowid), public_id: publicId }
}

/** Find the snapshot that best covers the period immediately before
 *  `currentPeriodStart`. The "ideal" previous-period end is
 *  (currentPeriodStart - 1 day). We search ±5 days of that boundary.
 *  Returns null when no qualifying snapshot exists, or when the matching
 *  snapshot covers fewer than 28 days (guards against partial-period junk).
 *
 *  Explicit-window mode: when `explicitPeriodStart` + `explicitPeriodEnd` are
 *  both supplied (the report has a user-chosen compare window via the GA-style
 *  picker), we do an EXACT lookup for that window — no ±5-day fuzz, no 28-day
 *  floor — so the picker's choice is honored verbatim. Falls through to the
 *  fuzzy auto-compute below when either is missing. */
export function getPreviousPeriodSnapshot(args: {
  tenant_id: number
  integration_id: number
  currentPeriodStart: string  // ISO YYYY-MM-DD
  currentPeriodEnd: string    // ISO YYYY-MM-DD — used to compute ideal boundary
  /** Explicit compare window from the report row. When both set, match exactly. */
  explicitPeriodStart?: string | null
  explicitPeriodEnd?: string | null
}): { id: number; normalized: MetricEnvelope; period_start: string; period_end: string } | null {
  ensurePlatformReady()

  // Explicit-window path: exact period_start + period_end match. Caller has
  // already validated that the window precedes the current period.
  if (args.explicitPeriodStart && args.explicitPeriodEnd) {
    const row = getDb().prepare(
      `SELECT id, normalized_json, period_start, period_end
         FROM platform_snapshots
        WHERE tenant_id = ? AND integration_id = ?
          AND period_start = ? AND period_end = ?
        ORDER BY fetched_at DESC
        LIMIT 1`
    ).get(
      args.tenant_id,
      args.integration_id,
      args.explicitPeriodStart,
      args.explicitPeriodEnd,
    ) as
      | { id: number; normalized_json: string; period_start: string; period_end: string }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      normalized: JSON.parse(row.normalized_json) as MetricEnvelope,
      period_start: row.period_start,
      period_end: row.period_end,
    }
  }

  // Ideal boundary: the day before the current period starts.
  const idealEnd = new Date(args.currentPeriodStart + 'T00:00:00')
  idealEnd.setDate(idealEnd.getDate() - 1)
  const idealEndStr = idealEnd.toISOString().slice(0, 10)

  // Search window: ideal ± 5 days.
  const windowStart = new Date(idealEnd)
  windowStart.setDate(windowStart.getDate() - 5)
  const windowEnd = new Date(idealEnd)
  windowEnd.setDate(windowEnd.getDate() + 5)
  const windowStartStr = windowStart.toISOString().slice(0, 10)
  const windowEndStr = windowEnd.toISOString().slice(0, 10)

  // Pick the snapshot whose period_end is closest to idealEndStr within the window.
  const row = getDb().prepare(
    `SELECT id, normalized_json, period_start, period_end
       FROM platform_snapshots
      WHERE tenant_id = ? AND integration_id = ?
        AND period_end >= ? AND period_end <= ?
        AND period_end < ?
      ORDER BY ABS(julianday(period_end) - julianday(?)) ASC, fetched_at DESC
      LIMIT 1`
  ).get(
    args.tenant_id,
    args.integration_id,
    windowStartStr,
    windowEndStr,
    args.currentPeriodStart,   // must not overlap the current period
    idealEndStr,
  ) as
    | { id: number; normalized_json: string; period_start: string; period_end: string }
    | undefined

  if (!row) return null

  // Enforce 28-day minimum coverage on the candidate snapshot.
  const pStart = new Date(row.period_start + 'T00:00:00')
  const pEnd = new Date(row.period_end + 'T00:00:00')
  const daysCovered = Math.round((pEnd.getTime() - pStart.getTime()) / (1000 * 60 * 60 * 24))
  if (daysCovered < 28) return null

  return {
    id: row.id,
    normalized: JSON.parse(row.normalized_json) as MetricEnvelope,
    period_start: row.period_start,
    period_end: row.period_end,
  }
}

/** Latest snapshot for an integration. The `asOf` arg (ISO date) selects
 *  snapshots whose period covers at least that date — i.e. period_end >= asOf.
 *  Default: today. Caller passes report.period_end to find a snapshot that
 *  covers up through the report's window. Phase 2 may add period_start
 *  bounds as well. */
export function getLatestSnapshot(args: {
  tenant_id: number
  integration_id: number
  asOf?: string  // ISO date; defaults to today
}): { id: number; normalized: MetricEnvelope; raw: unknown; period_start: string; period_end: string } | null {
  ensurePlatformReady()
  const asOf = args.asOf || new Date().toISOString().slice(0, 10)
  const row = getDb().prepare(
    `SELECT id, normalized_json, raw_json, period_start, period_end
       FROM platform_snapshots
      WHERE tenant_id = ? AND integration_id = ? AND period_end >= ?
      ORDER BY period_end DESC, fetched_at DESC
      LIMIT 1`
  ).get(args.tenant_id, args.integration_id, asOf) as
    | {
        id: number
        normalized_json: string
        raw_json: string
        period_start: string
        period_end: string
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    normalized: JSON.parse(row.normalized_json) as MetricEnvelope,
    raw: JSON.parse(row.raw_json),
    period_start: row.period_start,
    period_end: row.period_end,
  }
}

/** Return the snapshot captured for an EXACT period window (the report's
 *  selected range), newest fetch wins. Unlike getLatestSnapshot — which returns
 *  whatever snapshot ends on/after a date — this only matches data fetched for
 *  this specific window, so changing the report period shows the right data
 *  (and null when that window hasn't been fetched yet, rather than stale numbers
 *  from a different range). */
export function getSnapshotForPeriod(args: {
  tenant_id: number
  integration_id: number
  periodStart: string
  periodEnd: string
  /** Disambiguate per-client snapshots from a tenant-level integration (QBO:
   *  one integration, per-customer snapshots). When set, also filter by it. */
  account_id?: number
}): { id: number; normalized: MetricEnvelope; raw: unknown; period_start: string; period_end: string } | null {
  ensurePlatformReady()
  const acctFilter = args.account_id != null ? ' AND account_id = ?' : ''
  const params: (number | string)[] = [args.tenant_id, args.integration_id, args.periodStart, args.periodEnd]
  if (args.account_id != null) params.push(args.account_id)
  const row = getDb().prepare(
    `SELECT id, normalized_json, raw_json, period_start, period_end
       FROM platform_snapshots
      WHERE tenant_id = ? AND integration_id = ?
        AND period_start = ? AND period_end = ?${acctFilter}
      ORDER BY fetched_at DESC
      LIMIT 1`
  ).get(...params) as
    | { id: number; normalized_json: string; raw_json: string; period_start: string; period_end: string }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    normalized: JSON.parse(row.normalized_json) as MetricEnvelope,
    raw: JSON.parse(row.raw_json),
    period_start: row.period_start,
    period_end: row.period_end,
  }
}
