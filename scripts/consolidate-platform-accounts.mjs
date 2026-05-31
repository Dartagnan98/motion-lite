#!/usr/bin/env node
// scripts/consolidate-platform-accounts.mjs
//
// One-shot Phase C migration: drops platform_accounts; client_profiles becomes
// the canonical account record across motion-lite CRM + Hiilite Platform.
//
// Prerequisite: scripts/link-clients-to-platform-accounts.mjs must have already
// linked every platform_accounts row to a client_profiles row (FK column
// platform_accounts.client_profile_id is non-null).
//
// Pre-flight checks (script aborts on failure):
//   1. Every platform_accounts row has client_profile_id IS NOT NULL.
//   2. No client_profiles row already has tenant_id set (unless --force).
//
// Migration (single transaction):
//   1. Copy platform_accounts.{tenant_id, public_id → platform_public_id,
//      agency_id, status → platform_status} onto each linked client_profiles row.
//   2. Build platform_accounts.id → client_profiles.id map.
//   3. Rewire every FK that references platform_accounts.id to client_profiles.id:
//      platform_integrations.account_id
//      platform_reports.account_id
//      platform_snapshots.account_id
//      platform_domains.account_id
//      platform_account_users.account_id
//   4. DROP TABLE platform_accounts.
//   5. Print summary.
//
// Flags:
//   --dry-run    Print pre-flight + planned changes; no writes.
//   --force      Bypass partial-consolidation guard (some client_profiles already
//                have tenant_id set — only safe on re-runs after a partial failure).
//
// Usage:
//   node scripts/consolidate-platform-accounts.mjs --dry-run
//   node scripts/consolidate-platform-accounts.mjs

import Database from 'better-sqlite3'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../../store/motion.db')

const isDryRun = process.argv.includes('--dry-run')
const isForce = process.argv.includes('--force')

if (!existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}`)
  process.exit(1)
}

const db = new Database(DB_PATH, { readonly: isDryRun })

console.log(`\nHiilite Platform — Phase C Consolidation${isDryRun ? ' (DRY RUN)' : ''}`)
console.log(`══════════════════════════════════════════════════════════════════`)
console.log(`DB: ${DB_PATH}`)

// ─── Guard: platform_accounts must still exist ────────────────────────────────
let paExists = false
try {
  db.prepare(`SELECT id FROM platform_accounts LIMIT 1`).get()
  paExists = true
} catch {
  // table missing
}

if (!paExists) {
  console.log(`\nplatform_accounts table is already gone — Phase C consolidation already completed.`)
  process.exit(0)
}

// ─── Guard: required Phase C columns on client_profiles ───────────────────────
const cpColsRaw = db.prepare(`PRAGMA table_info(client_profiles)`).all()
const cpCols = new Set(cpColsRaw.map(c => c.name))
const required = ['tenant_id', 'platform_public_id', 'agency_id', 'platform_status']
const missing = required.filter(c => !cpCols.has(c))
if (missing.length > 0) {
  console.error(`\nERROR: client_profiles is missing columns: ${missing.join(', ')}`)
  console.error(`Start the app once to run schema migrations (initPlatformSchema), then re-run.`)
  process.exit(1)
}

// ─── Pre-flight check 1: every platform_accounts row has client_profile_id ────
const orphans = db.prepare(
  `SELECT id, name, tenant_id, status FROM platform_accounts
   WHERE client_profile_id IS NULL
   ORDER BY id ASC`
).all()

if (orphans.length > 0) {
  console.error(`\nERROR: ${orphans.length} platform_accounts row(s) are NOT linked to client_profiles:`)
  for (const o of orphans) {
    console.error(`  #${o.id}  tenant=${o.tenant_id}  status=${o.status}  name="${o.name}"`)
  }
  console.error(`\nRun the Phase B backfill first:`)
  console.error(`  node scripts/link-clients-to-platform-accounts.mjs`)
  console.error(`\nAborting — no writes made.`)
  process.exit(2)
}

// ─── Pre-flight check 2: no client_profiles already partially consolidated ────
const partiallyConsolidated = db.prepare(
  `SELECT id, name, tenant_id FROM client_profiles WHERE tenant_id IS NOT NULL ORDER BY id ASC`
).all()

if (partiallyConsolidated.length > 0 && !isForce) {
  console.error(`\nERROR: ${partiallyConsolidated.length} client_profiles row(s) already have tenant_id set:`)
  for (const p of partiallyConsolidated.slice(0, 10)) {
    console.error(`  cp#${p.id}  tenant_id=${p.tenant_id}  name="${p.name}"`)
  }
  if (partiallyConsolidated.length > 10) {
    console.error(`  ... and ${partiallyConsolidated.length - 10} more`)
  }
  console.error(`\nThis suggests a previous consolidation run partially succeeded.`)
  console.error(`Re-run with --force to overwrite tenant_id / platform_public_id / agency_id / platform_status`)
  console.error(`from the linked platform_accounts row. Aborting.`)
  process.exit(3)
}

// ─── Build the migration plan ─────────────────────────────────────────────────
const linkedAccounts = db.prepare(
  `SELECT pa.id          AS pa_id,
          pa.tenant_id   AS pa_tenant_id,
          pa.public_id   AS pa_public_id,
          pa.agency_id   AS pa_agency_id,
          pa.status      AS pa_status,
          pa.name        AS pa_name,
          pa.client_profile_id AS cp_id,
          cp.name        AS cp_name,
          cp.slug        AS cp_slug
     FROM platform_accounts pa
     JOIN client_profiles cp ON cp.id = pa.client_profile_id
    ORDER BY pa.id ASC`
).all()

// FK tables that reference platform_accounts.id via an account_id column
const fkTables = [
  'platform_integrations',
  'platform_reports',
  'platform_snapshots',
  'platform_domains',
  'platform_account_users',
]

console.log(`\nPre-flight checks passed.`)
console.log(`\nPlan:`)
console.log(`  platform_accounts → client_profiles consolidations: ${linkedAccounts.length}`)
if (isForce && partiallyConsolidated.length > 0) {
  console.log(`  Overwriting existing tenant_id on ${partiallyConsolidated.length} client_profiles row(s) (--force)`)
}

// Count rows in each FK table that will be rewired.
const fkCounts = {}
for (const table of fkTables) {
  try {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()
    fkCounts[table] = r.c
  } catch {
    fkCounts[table] = 0
  }
}
console.log(`  FK rewires:`)
for (const [t, c] of Object.entries(fkCounts)) {
  console.log(`    ${t}.account_id: ${c} row(s)`)
}

// Print sample (first 5) of what will be copied.
if (linkedAccounts.length > 0) {
  console.log(`\nSample (first 5):`)
  for (const r of linkedAccounts.slice(0, 5)) {
    console.log(
      `  pa#${r.pa_id} "${r.pa_name}" → cp#${r.cp_id} "${r.cp_name}" (${r.cp_slug})  ` +
      `tenant=${r.pa_tenant_id} agency=${r.pa_agency_id} status=${r.pa_status}`
    )
  }
}

if (isDryRun) {
  console.log(`\n[DRY RUN] No writes performed. Re-run without --dry-run to apply.\n`)
  process.exit(0)
}

// ─── Apply migration in a single transaction ──────────────────────────────────
const tx = db.transaction(() => {
  let cpUpdated = 0
  const fkUpdated = Object.fromEntries(fkTables.map(t => [t, 0]))

  const updateCp = db.prepare(
    `UPDATE client_profiles
        SET tenant_id          = ?,
            platform_public_id = ?,
            agency_id          = ?,
            platform_status    = ?,
            updated_at         = strftime('%s','now')
      WHERE id = ?`
  )

  // Prepared FK rewires per table
  const fkStmts = {}
  for (const table of fkTables) {
    try {
      fkStmts[table] = db.prepare(`UPDATE ${table} SET account_id = ? WHERE account_id = ?`)
    } catch {
      // table doesn't exist on this DB (e.g. domains older than current schema)
      fkStmts[table] = null
    }
  }

  for (const row of linkedAccounts) {
    updateCp.run(row.pa_tenant_id, row.pa_public_id, row.pa_agency_id, row.pa_status, row.cp_id)
    cpUpdated++

    for (const table of fkTables) {
      const stmt = fkStmts[table]
      if (!stmt) continue
      const result = stmt.run(row.cp_id, row.pa_id)
      fkUpdated[table] += result.changes
    }
  }

  // ─── Critical: disable FK enforcement before DROP ───────────────────
  // When PRAGMA foreign_keys = ON, DROP TABLE on a referenced table does an
  // implicit DELETE FROM the parent first, which fires ON DELETE CASCADE on
  // every child row whose FK still nominally points at the parent. Even
  // though we just rewired account_id values to client_profiles.id, the
  // FK CONSTRAINTS in the dependent tables still REFERENCE platform_accounts.
  // SQLite cascades on the implicit parent-delete and wipes the rewired rows.
  //
  // The motion-lite app's main connection runs PRAGMA foreign_keys = ON
  // (src/lib/db.ts:44). This script's connection inherits OFF by default,
  // but the SHM/WAL state from a recently-running app process can leave FK
  // enforcement effectively in play. Be explicit.
  db.exec(`PRAGMA foreign_keys = OFF`)
  db.exec(`DROP TABLE platform_accounts`)

  return { cpUpdated, fkUpdated }
})

try {
  const { cpUpdated, fkUpdated } = tx()

  console.log(`\nMigration complete.`)
  console.log(`══════════════════════════════════════════════════════════════════`)
  console.log(`  client_profiles updated:  ${cpUpdated}`)
  for (const [t, c] of Object.entries(fkUpdated)) {
    console.log(`  ${t}.account_id rewired:  ${c}`)
  }
  console.log(`  platform_accounts: DROPPED`)
  console.log(`══════════════════════════════════════════════════════════════════\n`)
} catch (err) {
  console.error(`\nFATAL: migration transaction failed: ${err.message}`)
  console.error(`Transaction rolled back. No changes applied.`)
  process.exit(4)
}
