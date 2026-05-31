#!/usr/bin/env node
// Sprint 4 — team-seed script for the Internal Multi-User Beta.
//
// Creates the team accounts, adds them to a shared "Hiilite Creative Group"
// workspace (renamed from the existing primary workspace), and prints the
// temporary passwords for William to share with each teammate via secure
// channel (1Password share, Telegram DM, in person, etc.).
//
// IDEMPOTENT: re-running skips accounts that already exist. Safe to run many
// times. The workspace rename is also idempotent (no-op if name already set).
//
// Usage:
//   node scripts/seed-team-users.mjs                 # uses default team list below
//   TEAM_FILE=/path/to/team.json node scripts/seed-team-users.mjs
//
// team.json shape: [{ "email": "...", "name": "..." }, ...]

import path from 'node:path'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.chdir(path.resolve(__dirname, '..'))

// Force NODE_ENV=development so the dev path's auth + db imports light up correctly
// (this is a script, not a production deploy; the .env.local is read for ANTHROPIC etc.
// but the workspace mutations go straight through better-sqlite3).
process.env.NODE_ENV = process.env.NODE_ENV || 'development'

const TEAM = process.env.TEAM_FILE
  ? JSON.parse(readFileSync(process.env.TEAM_FILE, 'utf8'))
  : [
      { email: 'bijoy@hiilite.com',   name: 'Bijoy' },
      { email: 'heather@hiilite.com', name: 'Heather' },
      { email: 'cameron@hiilite.com', name: 'Cameron' },
    ]

const SHARED_WORKSPACE_NAME = 'Hiilite Creative Group'

// 16-char URL-safe random password (no ambiguous chars).
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

const { signupWithPassword, getUserByEmail } = await import('../src/lib/auth.ts').catch(() =>
  import('../src/lib/auth.js'),
)
const dbMod = await import('../src/lib/db.ts').catch(() => import('../src/lib/db.js'))
const { getDb, addUserToWorkspace, getUserWorkspaces, updateWorkspace } = dbMod

const db = getDb()

// Resolve the shared workspace: take the existing primary workspace (the one
// holding all the real data — clients, companies, contacts). On William's
// machine that's workspace id=2. Rename it if it isn't already "Hiilite
// Creative Group".
const william = db.prepare("SELECT id FROM users WHERE email = 'will@hiilite.com'").get()
if (!william) {
  console.error('FATAL: will@hiilite.com not found. Aborting.')
  process.exit(1)
}
const williamWorkspaces = getUserWorkspaces(william.id)
if (!williamWorkspaces.length) {
  console.error('FATAL: william has no workspaces. Aborting.')
  process.exit(1)
}
const sharedWorkspaceId = williamWorkspaces[0].id
const currentName = williamWorkspaces[0].name

if (currentName !== SHARED_WORKSPACE_NAME) {
  updateWorkspace(sharedWorkspaceId, { name: SHARED_WORKSPACE_NAME })
  console.log(`✓ workspace id=${sharedWorkspaceId} renamed: "${currentName}" → "${SHARED_WORKSPACE_NAME}"`)
} else {
  console.log(`✓ workspace already named "${SHARED_WORKSPACE_NAME}" (id=${sharedWorkspaceId})`)
}

const created = []
const skipped = []

for (const member of TEAM) {
  const existing = await getUserByEmail(member.email)
  if (existing) {
    // Already a user — just ensure workspace membership.
    addUserToWorkspace(existing.id, sharedWorkspaceId, 'member')
    skipped.push({ email: member.email, reason: 'user already exists; membership ensured' })
    continue
  }
  const password = generatePassword()
  const user = await signupWithPassword(member.email, member.name, password)
  // signupWithPassword auto-creates a private workspace for the new user; we
  // ALSO add them to the shared "Hiilite Creative Group" workspace.
  addUserToWorkspace(user.id, sharedWorkspaceId, 'member')
  created.push({ email: member.email, name: member.name, password, userId: user.id })
}

console.log('')
console.log('────────────────────────────────────────────────────────────────')
console.log('TEAM SEED COMPLETE')
console.log('────────────────────────────────────────────────────────────────')
if (created.length) {
  console.log('\nNEW ACCOUNTS — share these passwords with each teammate SECURELY:')
  console.log('(1Password share, Telegram DM, in-person — NOT email)\n')
  for (const u of created) {
    console.log(`  ${u.email.padEnd(25)}  →  ${u.password}`)
  }
  console.log('\nThey should sign in once with this password, then change it via Settings.')
  console.log('(Note: password reset UI not yet built — owner can re-run this script')
  console.log("with a forced-overwrite flag if someone forgets — coming next sprint.)")
}
if (skipped.length) {
  console.log('\nSKIPPED (already exist, membership confirmed):')
  for (const s of skipped) console.log(`  ${s.email.padEnd(25)}  →  ${s.reason}`)
}
console.log('')
