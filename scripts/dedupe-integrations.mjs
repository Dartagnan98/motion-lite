#!/usr/bin/env node
// Deletes orphan + duplicate platform_integrations rows.
//
// Strategy: keep the integration referenced by report blocks. If multiple
// integrations of the same provider exist for the same (tenant, account)
// and none is referenced, keep the most recently created.
//
//   node scripts/dedupe-integrations.mjs                    # dry-run
//   node scripts/dedupe-integrations.mjs --apply            # actually delete

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.resolve(__dirname, '..', '..', 'store', 'motion.db')
const APPLY = process.argv.includes('--apply')

console.log(`[dedupe] DB: ${DB_PATH}`)
console.log(`[dedupe] mode: ${APPLY ? 'APPLY (will delete)' : 'DRY RUN'}\n`)

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

// 1. Find all (tenant, provider, account) groups with multiple rows.
const groups = db.prepare(`
  SELECT tenant_id, provider, account_id, COUNT(*) AS n
  FROM platform_integrations
  GROUP BY tenant_id, provider, account_id
  HAVING n > 1
`).all()

if (groups.length === 0) {
  console.log('[dedupe] No duplicates found. Nothing to do.')
  process.exit(0)
}

const toDelete = []
for (const g of groups) {
  const rows = db.prepare(`
    SELECT id, json_extract(config_json, '$.siteUrl') AS site,
           json_extract(config_json, '$.propertyId') AS prop,
           datetime(created_at, 'unixepoch') AS created
      FROM platform_integrations
     WHERE tenant_id = ? AND provider = ? AND account_id = ?
     ORDER BY id
  `).all(g.tenant_id, g.provider, g.account_id)

  console.log(`\n[dedupe] ${g.provider} @ tenant=${g.tenant_id} account=${g.account_id} — ${rows.length} rows:`)

  // Which IDs are referenced by report blocks?
  const referenced = new Set(
    db.prepare(`
      SELECT DISTINCT integration_id FROM platform_report_blocks
       WHERE integration_id IN (${rows.map(() => '?').join(',')})
    `).all(...rows.map((r) => r.id)).map((r) => r.integration_id)
  )

  // Keep: any referenced row (lowest id if multiple). Else: most recent.
  let keepId
  const referencedRows = rows.filter((r) => referenced.has(r.id))
  if (referencedRows.length > 0) {
    keepId = referencedRows[0].id  // lowest id among referenced
  } else {
    keepId = rows[rows.length - 1].id  // most recent
  }

  for (const r of rows) {
    const tag =
      r.id === keepId
        ? '  KEEP   '
        : referenced.has(r.id)
        ? '  delete (referenced — blocks will reset to NULL via FK SET NULL)'
        : '  delete '
    console.log(`${tag} #${r.id} ${r.site || r.prop || ''} (created ${r.created})`)
    if (r.id !== keepId) toDelete.push(r.id)
  }
}

if (!APPLY) {
  console.log(`\n[dedupe] DRY RUN: ${toDelete.length} row(s) would be deleted. Re-run with --apply to commit.`)
  process.exit(0)
}

// Apply: foreign keys cascade snapshots + oauth_tokens; report blocks have
// ON DELETE SET NULL so they survive minus the integration link.
const stmt = db.prepare('DELETE FROM platform_integrations WHERE id = ?')
const tx = db.transaction(() => {
  for (const id of toDelete) stmt.run(id)
})
tx()

console.log(`\n[dedupe] Deleted ${toDelete.length} integration row(s). Snapshots + oauth_tokens cascaded; report blocks set integration_id=NULL where applicable.`)
db.close()
