#!/usr/bin/env node
// Daily PageSpeed Insights refetch — Slice B (2026-05-27).
//
// For every connected `pagespeed` integration in platform_integrations,
// POST /api/platform/integrations/<id>/refetch. Each call captures a
// fresh dual-strategy (mobile + desktop) snapshot dated today, so the
// per-section trend chart in the report builds up real history.
//
// Run by launchd via `~/Library/LaunchAgents/com.hiilite.pagespeed-daily.plist`
// at 03:00 local. Sequential refetches (PSI API is rate-limited per key),
// per-call timeout of 60s, full output logged to /tmp.
//
// Safe to run manually for a backfill: `node scripts/pagespeed-daily-refetch.mjs`.

import Database from 'better-sqlite3'
import { mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'

const DB_PATH = `${homedir()}/code/store/motion.db`
const BASE = process.env.HIILITE_BASE_URL || 'http://localhost:4000'
const LOG_DIR = '/tmp/hiilite-cron'
const LOG_FILE = `${LOG_DIR}/pagespeed-daily.log`
const TIMEOUT_MS = 60_000

mkdirSync(LOG_DIR, { recursive: true })

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  appendFileSync(LOG_FILE, stamped + '\n')
}

async function postWithTimeout(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: ac.signal,
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, body: text.slice(0, 300) }
  } catch (err) {
    return { ok: false, status: 0, body: err?.message || String(err) }
  } finally {
    clearTimeout(timer)
  }
}

const db = new Database(DB_PATH, { readonly: true })
const rows = db.prepare(`
  SELECT i.id, i.tenant_id, COALESCE(c.name, '(no client)') AS client_name
  FROM platform_integrations i
  LEFT JOIN client_profiles c ON c.id = i.account_id
  WHERE i.provider = 'pagespeed' AND COALESCE(i.status, 'connected') = 'connected'
  ORDER BY i.id
`).all()
db.close()

log(`pagespeed-daily-refetch start — ${rows.length} integration(s)`)

let ok = 0
let fail = 0
for (const r of rows) {
  const url = `${BASE}/api/platform/integrations/${r.id}/refetch`
  const result = await postWithTimeout(url)
  if (result.ok) {
    ok++
    log(`OK   id=${r.id} (${r.client_name}) → ${result.body}`)
  } else {
    fail++
    log(`FAIL id=${r.id} (${r.client_name}) status=${result.status} → ${result.body}`)
  }
  // Small delay between calls — PSI API is rate-limited per key.
  await new Promise((r) => setTimeout(r, 2000))
}

log(`pagespeed-daily-refetch done — ok=${ok} fail=${fail}`)
process.exit(fail > 0 ? 1 : 0)
