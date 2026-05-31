#!/usr/bin/env node
// cleanup-old-snapshots.mjs
//
// Deletes snapshots older than 13 months per integration. Keeps the 13 most
// recent period_end rows per integration so YoY comparisons remain possible.
//
// Usage:
//   node scripts/cleanup-old-snapshots.mjs           # live deletion
//   node scripts/cleanup-old-snapshots.mjs --dry-run # preview only (no delete)
//
// Safe to run repeatedly — idempotent.

import Database from 'better-sqlite3'
import { resolve } from 'path'

const DRY_RUN = process.argv.includes('--dry-run')
const DB_PATH = resolve(process.cwd(), '../store/motion.db')

let db
try {
  db = new Database(DB_PATH, { readonly: DRY_RUN })
} catch (err) {
  console.error(`[cleanup-old-snapshots] Failed to open DB at ${DB_PATH}:`, err.message)
  process.exit(1)
}

console.log(`[cleanup-old-snapshots] DB: ${DB_PATH}${DRY_RUN ? ' (DRY RUN)' : ''}`)

// Find all distinct integration IDs that have snapshots.
const integrations = db.prepare(
  `SELECT DISTINCT integration_id FROM platform_snapshots`
).all()

console.log(`[cleanup-old-snapshots] Found ${integrations.length} integration(s) with snapshots`)

let totalDeleted = 0

for (const { integration_id } of integrations) {
  // Count snapshots for this integration.
  const { count } = db.prepare(
    `SELECT COUNT(*) as count FROM platform_snapshots WHERE integration_id = ?`
  ).get(integration_id)

  if (count <= 13) {
    // Nothing to clean up — keep all.
    continue
  }

  // Find the 14th most recent snapshot (the first one to prune).
  // We keep the 13 most recent by period_end DESC, fetched_at DESC.
  const cutoffRow = db.prepare(
    `SELECT id, period_end FROM platform_snapshots
      WHERE integration_id = ?
      ORDER BY period_end DESC, fetched_at DESC
      LIMIT 1 OFFSET 13`
  ).get(integration_id)

  if (!cutoffRow) continue

  // Count rows to delete.
  const { deleteCount } = db.prepare(
    `SELECT COUNT(*) as deleteCount FROM platform_snapshots
      WHERE integration_id = ?
        AND (period_end < ? OR (period_end = ? AND fetched_at < (
          SELECT MIN(fetched_at) FROM (
            SELECT fetched_at FROM platform_snapshots
            WHERE integration_id = ?
            ORDER BY period_end DESC, fetched_at DESC
            LIMIT 13
          )
        )))`
  ).get(integration_id, cutoffRow.period_end, cutoffRow.period_end, integration_id)

  if (DRY_RUN) {
    console.log(
      `[dry-run] integration_id=${integration_id}: ${count} total, would delete ${deleteCount} (keep 13, cutoff period_end=${cutoffRow.period_end})`
    )
  } else {
    // Delete snapshots not in the top 13 by period_end DESC.
    const result = db.prepare(
      `DELETE FROM platform_snapshots
        WHERE integration_id = ?
          AND id NOT IN (
            SELECT id FROM platform_snapshots
            WHERE integration_id = ?
            ORDER BY period_end DESC, fetched_at DESC
            LIMIT 13
          )`
    ).run(integration_id, integration_id)

    const deleted = result.changes
    totalDeleted += deleted
    if (deleted > 0) {
      console.log(
        `[cleanup-old-snapshots] integration_id=${integration_id}: deleted ${deleted} snapshot(s) (kept 13, cutoff=${cutoffRow.period_end})`
      )
    }
  }
}

if (DRY_RUN) {
  console.log('[cleanup-old-snapshots] Dry run complete — no rows deleted.')
} else {
  console.log(`[cleanup-old-snapshots] Done. Total deleted: ${totalDeleted}`)
}

db.close()
