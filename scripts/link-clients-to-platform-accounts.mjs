#!/usr/bin/env node
// scripts/link-clients-to-platform-accounts.mjs
//
// Interactive backfill: links every platform_accounts row (where
// client_profile_id IS NULL) to a client_profiles row.
//
// Three strategies per unlinked account:
//   1. Exact name match (auto-linked silently)
//   2. Interactive prompt: create new client_profile, link to existing, or skip
//
// Flags:
//   --dry-run   Show what WOULD happen without writing anything
//
// Idempotent: re-running resumes from WHERE client_profile_id IS NULL.
// Summary printed on exit: Linked: N, Created: N, Skipped: N
//
// Usage:
//   node scripts/link-clients-to-platform-accounts.mjs
//   node scripts/link-clients-to-platform-accounts.mjs --dry-run

import Database from 'better-sqlite3'
import { createInterface } from 'node:readline'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, '../../store/motion.db')
const PENDING_PATH = resolve(__dirname, '../pending-backfill.json')

const isDryRun = process.argv.includes('--dry-run')

if (!existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}`)
  process.exit(1)
}

const db = new Database(DB_PATH, { readonly: isDryRun })

// Ensure the column exists (schema migration should have run already)
try {
  db.prepare('SELECT client_profile_id FROM platform_accounts LIMIT 1').get()
} catch {
  console.error('Error: platform_accounts.client_profile_id column not found.')
  console.error('Start the app once to run schema migrations, then re-run this script.')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const prompt = (q) => new Promise(resolve => rl.question(q, resolve))

// ─── Simple Levenshtein for fuzzy name matching ───────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

function findSimilar(targetName, profiles, count = 5) {
  return profiles
    .map(p => ({ ...p, dist: levenshtein(targetName.toLowerCase(), p.name.toLowerCase()) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
}

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// ─── Read current state ───────────────────────────────────────────────
const unlinkedAccounts = db.prepare(
  `SELECT id, name, tenant_id, status FROM platform_accounts WHERE client_profile_id IS NULL ORDER BY name ASC`
).all()

const allProfiles = db.prepare(
  `SELECT id, name, slug FROM client_profiles ORDER BY name ASC`
).all()

if (unlinkedAccounts.length === 0) {
  console.log('All platform_accounts rows already have client_profile_id set. Nothing to do.')
  rl.close()
  process.exit(0)
}

console.log(`\nHiilite Platform — Client Backfill${isDryRun ? ' (DRY RUN)' : ''}`)
console.log(`─────────────────────────────────────────`)
console.log(`Unlinked platform accounts: ${unlinkedAccounts.length}`)
console.log(`Existing client profiles:   ${allProfiles.length}\n`)

let linked = 0, created = 0, skipped = 0
const pending = []

// Load existing pending file
let existingPending = []
if (existsSync(PENDING_PATH)) {
  try {
    existingPending = JSON.parse(readFileSync(PENDING_PATH, 'utf8'))
    const skipIds = new Set(existingPending.map(p => p.id))
    // Filter out previously skipped accounts from this run
    // (they're still unlinked but we respect the skip decision)
    const toProcess = unlinkedAccounts.filter(a => !skipIds.has(a.id))
    console.log(`Resuming — ${existingPending.length} previously skipped account(s) excluded.\n`)
    unlinkedAccounts.splice(0, unlinkedAccounts.length, ...toProcess)
  } catch {
    console.warn('Could not read pending-backfill.json — processing all unlinked accounts.')
  }
}

// ─── Insert helper ────────────────────────────────────────────────────
const linkStmt = isDryRun ? null : db.prepare(
  `UPDATE platform_accounts SET client_profile_id = ?, updated_at = strftime('%s','now') WHERE id = ?`
)
const insertProfileStmt = isDryRun ? null : db.prepare(
  `INSERT INTO client_profiles (name, slug, workspace_id, created_at, updated_at)
   VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))`
)

// Resolve the motion-lite workspace_id for a platform account's tenant.
// platform_tenants.external_tenant_ref is "workspace:<id>" — without setting
// workspace_id, a created client_profile is invisible in the /clients list
// (getClientProfiles filters WHERE workspace_id = activeWorkspace).
const tenantRefStmt = db.prepare('SELECT external_tenant_ref FROM platform_tenants WHERE id = ?')
function workspaceIdForTenant(tenantId) {
  if (!tenantId) return null
  const row = tenantRefStmt.get(tenantId)
  const ref = row?.external_tenant_ref ?? ''
  const m = /^workspace:(\d+)$/.exec(ref)
  return m ? Number(m[1]) : null
}

for (const account of unlinkedAccounts) {
  const norm = account.name.trim().toLowerCase()

  // ── 1. Exact match ────────────────────────────────────────────────
  const exactMatch = allProfiles.find(p => p.name.trim().toLowerCase() === norm)
  if (exactMatch) {
    console.log(`  auto-linked: "${account.name}" → client_profile #${exactMatch.id} (${exactMatch.slug})`)
    if (!isDryRun) linkStmt.run(exactMatch.id, account.id)
    linked++
    continue
  }

  // ── 2. Interactive prompt ─────────────────────────────────────────
  console.log(`\nPlatform account: "${account.name}" (tenant ${account.tenant_id})`)
  console.log(`No client_profile matches by name.`)
  const similar = findSimilar(account.name, allProfiles)
  console.log(`\nWhat do you want to do?`)
  console.log(`  1) Create a new client_profile "${account.name}"`)
  console.log(`  2) Link to existing client (pick from list)`)
  console.log(`  3) Skip (leave platform_account orphaned for now)`)

  const choice = (await prompt('\nChoice [1]: ')).trim() || '1'

  if (choice === '1') {
    const slug = generateSlug(account.name)
    const wsId = workspaceIdForTenant(account.tenant_id)
    console.log(`  Creating client_profile: name="${account.name}", slug="${slug}", workspace_id=${wsId ?? 'NULL'}`)
    if (wsId === null) {
      console.warn(`  WARNING: could not resolve workspace_id for tenant ${account.tenant_id} — client will not show in /clients until workspace_id is set.`)
    }
    if (!isDryRun) {
      const result = insertProfileStmt.run(account.name, slug, wsId)
      const newId = result.lastInsertRowid
      linkStmt.run(newId, account.id)
      // Add to allProfiles for subsequent matches
      allProfiles.push({ id: Number(newId), name: account.name, slug })
      console.log(`  Created + linked: client_profile #${newId}`)
    } else {
      console.log(`  [DRY RUN] Would create + link "${account.name}" (workspace_id=${wsId ?? 'NULL'})`)
    }
    created++
  } else if (choice === '2') {
    console.log(`\nNearest matches:`)
    similar.forEach((p, i) => {
      console.log(`  ${i + 1}) ${p.name} (slug: ${p.slug}) — edit distance: ${p.dist}`)
    })
    if (allProfiles.length > similar.length) {
      console.log(`  ${similar.length + 1}) Show all profiles`)
    }
    const pickInput = await prompt('\nEnter number or partial name: ')
    const pickNum = parseInt(pickInput.trim(), 10)
    let picked = null
    if (!isNaN(pickNum) && pickNum >= 1 && pickNum <= similar.length) {
      picked = similar[pickNum - 1]
    } else if (!isNaN(pickNum) && pickNum === similar.length + 1) {
      console.log('\nAll profiles:')
      allProfiles.forEach((p, i) => console.log(`  ${i + 1}) ${p.name} (${p.slug})`))
      const allPickInput = await prompt('\nEnter number: ')
      const allPickNum = parseInt(allPickInput.trim(), 10)
      if (!isNaN(allPickNum) && allPickNum >= 1 && allPickNum <= allProfiles.length) {
        picked = allProfiles[allPickNum - 1]
      }
    } else {
      // Search by partial name
      const q = pickInput.trim().toLowerCase()
      picked = allProfiles.find(p => p.name.toLowerCase().includes(q)) ?? null
    }

    if (picked) {
      console.log(`  Linking "${account.name}" → "${picked.name}" (client_profile #${picked.id})`)
      if (!isDryRun) linkStmt.run(picked.id, account.id)
      else console.log(`  [DRY RUN] Would link.`)
      linked++
    } else {
      console.log(`  No match found — skipping.`)
      pending.push({ id: account.id, name: account.name, reason: 'no match in pick' })
      skipped++
    }
  } else {
    console.log(`  Skipped "${account.name}"`)
    pending.push({ id: account.id, name: account.name, reason: 'user skipped' })
    skipped++
  }
}

// Write pending file
const allPending = [...existingPending.filter(p => !unlinkedAccounts.some(a => a.id === p.id)), ...pending]
if (!isDryRun && allPending.length > 0) {
  writeFileSync(PENDING_PATH, JSON.stringify(allPending, null, 2))
  console.log(`\nSkipped accounts written to: ${PENDING_PATH}`)
}

console.log(`\n─────────────────────────────────────────`)
console.log(`Summary${isDryRun ? ' (DRY RUN — no writes made)' : ''}:`)
console.log(`  Linked:  ${linked}`)
console.log(`  Created: ${created}`)
console.log(`  Skipped: ${skipped}`)
console.log(`─────────────────────────────────────────\n`)

rl.close()
