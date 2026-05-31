#!/usr/bin/env node
// Run with `node scripts/seed-glenvalley.mjs` before the first live GSC OAuth test.
//
// Seeds the minimum platform_* rows required for the Glenvalley Dental GSC
// connect flow. All inserts are INSERT OR IGNORE — re-running is a no-op.
// Prints final IDs (tenant_id, agency_id, account_id) for human verification.

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.resolve(__dirname, '..', '..', 'store', 'motion.db')

console.log(`[seed-glenvalley] DB: ${DB_PATH}`)

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

function generatePublicId() {
  return crypto.randomBytes(12).toString('base64url')
}

// ── 1. platform_tenants: seed against the first user's primary workspace ──
// Override with: WORKSPACE_ID=N node scripts/seed-glenvalley.mjs
let WORKSPACE_ID = process.env.WORKSPACE_ID ? parseInt(process.env.WORKSPACE_ID, 10) : null
if (!WORKSPACE_ID) {
  const row = db.prepare(`
    SELECT w.id FROM workspaces w
    JOIN user_workspace_members uwm ON uwm.workspace_id = w.id
    WHERE uwm.role = 'owner'
    ORDER BY uwm.user_id, w.id
    LIMIT 1
  `).get()
  if (!row) {
    console.error('[seed-glenvalley] ERROR: no workspace owners in user_workspace_members. Boot motion-lite once + sign in first.')
    process.exit(1)
  }
  WORKSPACE_ID = row.id
}
console.log(`[seed-glenvalley] workspace_id: ${WORKSPACE_ID}`)
const tenantRef = `workspace:${WORKSPACE_ID}`

db.prepare(`
  INSERT OR IGNORE INTO platform_tenants (public_id, name, external_tenant_ref)
  VALUES (?, ?, ?)
`).run(generatePublicId(), `Workspace ${WORKSPACE_ID}`, tenantRef)

const tenant = db.prepare(
  'SELECT * FROM platform_tenants WHERE external_tenant_ref = ?'
).get(tenantRef)

if (!tenant) {
  console.error('[seed-glenvalley] ERROR: tenant row missing after insert')
  process.exit(1)
}
console.log(`[seed-glenvalley] tenant_id: ${tenant.id}  (public_id: ${tenant.public_id})`)

// ── 2. platform_agencies: Hiilite Creative Group under that tenant ──────────
const AGENCY_SLUG = 'hiilite-creative-group'

db.prepare(`
  INSERT OR IGNORE INTO platform_agencies
    (tenant_id, public_id, name, slug, subscription_tier, max_accounts, max_users, status)
  VALUES (?, ?, ?, ?, 'pro', 20, 10, 'active')
`).run(tenant.id, generatePublicId(), 'Hiilite Creative Group', AGENCY_SLUG)

const agency = db.prepare(
  'SELECT * FROM platform_agencies WHERE tenant_id = ? AND slug = ?'
).get(tenant.id, AGENCY_SLUG)

if (!agency) {
  console.error('[seed-glenvalley] ERROR: agency row missing after insert')
  process.exit(1)
}
console.log(`[seed-glenvalley] agency_id: ${agency.id}  (name: ${agency.name})`)

// ── 3. platform_accounts: Glenvalley Dental under that agency ───────────────
const ACCOUNT_NAME = 'Glenvalley Dental'

db.prepare(`
  INSERT OR IGNORE INTO platform_accounts
    (tenant_id, public_id, agency_id, name, status)
  VALUES (?, ?, ?, ?, 'active')
`).run(tenant.id, generatePublicId(), agency.id, ACCOUNT_NAME)

const account = db.prepare(
  'SELECT * FROM platform_accounts WHERE tenant_id = ? AND agency_id = ? AND name = ?'
).get(tenant.id, agency.id, ACCOUNT_NAME)

if (!account) {
  console.error('[seed-glenvalley] ERROR: account row missing after insert')
  process.exit(1)
}
console.log(`[seed-glenvalley] account_id: ${account.id}  (name: ${account.name})`)

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n[seed-glenvalley] Ready for live GSC OAuth test:')
console.log(`  tenant_id:  ${tenant.id}`)
console.log(`  agency_id:  ${agency.id}`)
console.log(`  account_id: ${account.id}`)
console.log(`\n  Connect body: { workspaceId: ${WORKSPACE_ID}, level: "account", accountId: ${account.id} }`)
console.log(`  (or just { level: "account" } — server auto-resolves both)`)

db.close()
