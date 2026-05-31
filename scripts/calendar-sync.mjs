#!/usr/bin/env node
// MS365 calendar → motion.db calendar_events
//
// Spawns @softeria/ms-365-mcp-server as a child process, calls
// get-calendar-view for a rolling window, and upserts events into
// motion.db so `ctrlm calendar` can read them locally.
//
// Auth is delegated to ms-365-mcp-server's existing keychain token
// (service ms-365-mcp-server, account will@hiilite.com). No separate login.
//
// Usage:
//   node calendar-sync.mjs              # sync next 14 days
//   node calendar-sync.mjs --days 30    # custom window
//   node calendar-sync.mjs --dry-run    # don't write to DB
//
// Run via launchd (com.hiilite.calendar-sync.plist) every 15 min.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'

const DB_PATH = path.join(homedir(), 'code', 'store', 'motion.db')
const CALENDAR_ID = 'ms365-work'  // single bucket for the work calendar
const WINDOW_DAYS_DEFAULT = 14

class McpStdio {
  constructor() {
    // Match fyxer-ingest's invocation: plain npx, no --org-mode, no env overrides.
    // The keychain token is shared across both pollers via service `ms-365-mcp-server`.
    this.proc = spawn('npx', ['-y', '@softeria/ms-365-mcp-server'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    this.id = 0
    this.pending = new Map()
    this.buf = ''
    this.proc.stdout.on('data', chunk => {
      this.buf += chunk.toString()
      let nl
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          msg.error ? reject(new Error(msg.error.message || JSON.stringify(msg.error))) : resolve(msg.result)
        }
      }
    })
    this.proc.on('exit', code => {
      for (const { reject } of this.pending.values()) reject(new Error(`mcp exited (${code})`))
    })
  }
  request(method, params) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }
  async init() {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'calendar-sync', version: '1.0.0' },
    })
    this.notify('notifications/initialized', {})
  }
  async tool(name, args) {
    const r = await this.request('tools/call', { name, arguments: args })
    if (r.isError) throw new Error('tool error: ' + JSON.stringify(r.content))
    const text = r.content?.find(c => c.type === 'text')?.text
    return text ? JSON.parse(text) : r
  }
  close() { try { this.proc.stdin.end() } catch {} ; this.proc.kill('SIGTERM') }
}

function normalizeIso(timeObj) {
  // MS365 with `timezone: 'UTC'` query param returns:
  //   { dateTime: "2026-04-29T17:00:00.0000000", timeZone: "UTC" }
  // (wall-clock UTC; trailing zeros are sub-second precision). We always
  // output "YYYY-MM-DDTHH:MM:SSZ" so ctrlm can parse with explicit UTC.
  if (!timeObj) return null
  if (typeof timeObj === 'string') {
    return timeObj.endsWith('Z') ? timeObj : timeObj.replace(/\.\d+$/, '').slice(0, 19) + 'Z'
  }
  if (timeObj.dateTime) {
    const tz = (timeObj.timeZone || 'UTC').toUpperCase()
    if (timeObj.dateTime.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(timeObj.dateTime)) {
      // Has explicit zone — use Date to parse and re-emit as UTC ISO.
      return new Date(timeObj.dateTime).toISOString().slice(0, 19) + 'Z'
    }
    if (tz === 'UTC') {
      // Wall-clock UTC; just chop sub-seconds and append Z.
      return timeObj.dateTime.replace(/\.\d+$/, '').slice(0, 19) + 'Z'
    }
    // Fallback: tz hint we don't resolve here. Treat as UTC (best effort).
    return timeObj.dateTime.replace(/\.\d+$/, '').slice(0, 19) + 'Z'
  }
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const daysIdx = args.indexOf('--days')
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : WINDOW_DAYS_DEFAULT

  const now = new Date()
  const startIso = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString()
  const endIso = new Date(now.getTime() + days * 86400000).toISOString()

  console.log(`[calendar-sync] window ${startIso.slice(0, 10)} → ${endIso.slice(0, 10)}${dryRun ? ' (dry-run)' : ''}`)

  const mcp = new McpStdio()
  let exitCode = 0
  let upserted = 0
  let skipped = 0

  try {
    await mcp.init()
    const result = await mcp.tool('get-calendar-view', {
      startDateTime: startIso,
      endDateTime: endIso,
      select: 'id,subject,bodyPreview,start,end,location,isAllDay,showAs,isCancelled',
      timezone: 'UTC',
      top: 250,
    })
    const events = result?.value || []
    console.log(`[calendar-sync] fetched ${events.length} events`)

    if (!dryRun && events.length) {
      const db = new Database(DB_PATH)
      db.pragma('journal_mode = WAL')
      const upsert = db.prepare(`
        INSERT INTO calendar_events
          (id, calendar_id, title, description, start_time, end_time, all_day,
           location, status, busy_status, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
        ON CONFLICT(id, calendar_id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          all_day = excluded.all_day,
          location = excluded.location,
          status = excluded.status,
          busy_status = excluded.busy_status,
          synced_at = excluded.synced_at
      `)
      const purgeOld = db.prepare(`
        DELETE FROM calendar_events
        WHERE calendar_id = ? AND start_time >= ? AND start_time < ? AND synced_at < ?
      `)
      const txn = db.transaction((events) => {
        const syncStart = Math.floor(Date.now() / 1000) - 30  // 30s grace
        for (const ev of events) {
          if (ev.isCancelled) { skipped++; continue }
          const start = normalizeIso(ev.start)
          const end = normalizeIso(ev.end)
          if (!start || !end) { skipped++; continue }
          const loc = ev.location?.displayName || null
          upsert.run(
            ev.id,
            CALENDAR_ID,
            ev.subject || '(no title)',
            ev.bodyPreview || null,
            start,
            end,
            ev.isAllDay ? 1 : 0,
            loc,
            'confirmed',
            ev.showAs || 'busy',
            // synced_at handled by SQL
          )
          upserted++
        }
        // Purge events in window that weren't refreshed (cancelled/deleted at source)
        purgeOld.run(CALENDAR_ID, startIso.slice(0, 19), endIso.slice(0, 19), syncStart)
      })
      txn(events)
      db.close()
    }

    console.log(`[calendar-sync] upserted=${upserted} skipped=${skipped}`)
  } catch (e) {
    console.error(`[calendar-sync] fatal: ${e.message}`)
    exitCode = 1
  } finally {
    mcp.close()
  }
  process.exit(exitCode)
}

main()
