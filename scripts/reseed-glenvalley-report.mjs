#!/usr/bin/env node
// Deletes ALL existing platform_reports / sections / blocks for the tenant
// so the next visit to /platform/reports/0 auto-seeds a fresh report that
// detects the current set of connected integrations (GSC + GA4 + PageSpeed
// in whatever combination exists).
//
// Idempotent — re-running is safe.
//
//   node scripts/reseed-glenvalley-report.mjs

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.resolve(__dirname, '..', '..', 'store', 'motion.db')

console.log(`[reseed] DB: ${DB_PATH}`)

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

const before = {
  reports: db.prepare('SELECT COUNT(*) AS n FROM platform_reports').get().n,
  sections: db.prepare('SELECT COUNT(*) AS n FROM platform_report_sections').get().n,
  blocks: db.prepare('SELECT COUNT(*) AS n FROM platform_report_blocks').get().n,
}
console.log(`[reseed] before — reports: ${before.reports}, sections: ${before.sections}, blocks: ${before.blocks}`)

const tx = db.transaction(() => {
  db.prepare('DELETE FROM platform_report_blocks').run()
  db.prepare('DELETE FROM platform_report_sections').run()
  db.prepare('DELETE FROM platform_reports').run()
})
tx()

const after = {
  reports: db.prepare('SELECT COUNT(*) AS n FROM platform_reports').get().n,
  sections: db.prepare('SELECT COUNT(*) AS n FROM platform_report_sections').get().n,
  blocks: db.prepare('SELECT COUNT(*) AS n FROM platform_report_blocks').get().n,
}
console.log(`[reseed] after  — reports: ${after.reports}, sections: ${after.sections}, blocks: ${after.blocks}`)

console.log('\n[reseed] Done. Open http://localhost:4000/platform/reports/0 — the auto-seeder will create a fresh report with whichever integrations are currently connected.')

db.close()
