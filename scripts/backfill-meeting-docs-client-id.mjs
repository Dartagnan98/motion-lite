#!/usr/bin/env node
// Backfill docs.client_id for historical meeting-note docs (2026-05-27).
//
// Background: every meeting-note doc was ingested before the AI meeting-notes
// pipeline started tagging client_id. The Assets tab's Meetings card reads
// `/api/docs?client_id=<id>&doc_type=meeting-note`, so today every client's
// Meetings section shows empty even though relevant transcripts exist.
//
// Strategy: title-substring match against each client's name. Only docs with
// EXACTLY ONE client name match are updated — ambiguous matches are skipped
// and reported. CONTENT search is intentionally NOT used (too noisy: the body
// often mentions other clients in passing).
//
// Dry run by default. Run with `--apply` to actually write UPDATEs.
//
//   node scripts/backfill-meeting-docs-client-id.mjs
//   node scripts/backfill-meeting-docs-client-id.mjs --apply

import Database from 'better-sqlite3'
import { homedir } from 'node:os'

const DB_PATH = `${homedir()}/code/store/motion.db`
const APPLY = process.argv.includes('--apply')

// Distinctive substrings per client. Tweak if a client's name overlaps another's.
// (Lowercase comparison — keep these lowercase.)
const PATTERNS = {
  // client_id → array of distinctive substrings that should match in the title
  1: ['glenvalley'],
  3: ['advance dental'],
  5: ['williamwalczak.com', 'williamwalczak.com', 'william walczak.com'],
  // 6 (Acme Test Co) intentionally omitted — test data
}

const db = new Database(DB_PATH)

// Sanity: confirm client_profiles still has these ids + names
const clients = db.prepare('SELECT id, name FROM client_profiles WHERE id IN (1,3,5)').all()
console.log('Clients in scope:')
for (const c of clients) console.log(`  ${c.id}: ${c.name}`)
console.log('')

const docs = db.prepare(`
  SELECT id, title FROM docs
  WHERE doc_type = 'meeting-note' AND client_id IS NULL
  ORDER BY id
`).all()

const proposed = []     // [{ docId, clientId, title }]
const ambiguous = []    // [{ docId, matchingClients, title }]
const noMatch = []      // [{ docId, title }]

for (const d of docs) {
  const lc = (d.title || '').toLowerCase()
  const matches = []
  for (const [cidStr, subs] of Object.entries(PATTERNS)) {
    if (subs.some((s) => lc.includes(s))) matches.push(Number(cidStr))
  }
  if (matches.length === 1) {
    proposed.push({ docId: d.id, clientId: matches[0], title: d.title })
  } else if (matches.length > 1) {
    ambiguous.push({ docId: d.id, matchingClients: matches, title: d.title })
  } else {
    noMatch.push({ docId: d.id, title: d.title })
  }
}

console.log(`Total meeting-note docs with NULL client_id: ${docs.length}`)
console.log(`  → Will tag (single match): ${proposed.length}`)
console.log(`  → Ambiguous (skipped):     ${ambiguous.length}`)
console.log(`  → No client name in title: ${noMatch.length}`)
console.log('')

if (proposed.length > 0) {
  console.log('Proposed updates:')
  for (const p of proposed) {
    const clientName = clients.find((c) => c.id === p.clientId)?.name ?? `client ${p.clientId}`
    console.log(`  doc ${p.docId} → client_id=${p.clientId} (${clientName})  ::  ${p.title}`)
  }
  console.log('')
}

if (ambiguous.length > 0) {
  console.log('Ambiguous (review manually):')
  for (const a of ambiguous) console.log(`  doc ${a.docId} → matches ${a.matchingClients.join(',')}  ::  ${a.title}`)
  console.log('')
}

if (!APPLY) {
  console.log('Dry run only. Pass --apply to write these UPDATEs to the database.')
  process.exit(0)
}

// Apply mode
const stmt = db.prepare('UPDATE docs SET client_id = ? WHERE id = ? AND client_id IS NULL AND doc_type = \'meeting-note\'')
const tx = db.transaction((rows) => {
  let updated = 0
  for (const r of rows) {
    const info = stmt.run(r.clientId, r.docId)
    if (info.changes > 0) updated++
  }
  return updated
})

const n = tx(proposed)
console.log(`Applied: ${n} row(s) updated.`)
