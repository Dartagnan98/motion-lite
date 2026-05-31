#!/usr/bin/env node
// Hiilite Platform — Nightly DB backup.
//
// Uses better-sqlite3's `db.backup()` which is a WAL-safe consistent snapshot
// (equivalent to the sqlite3 `.backup` command). Output filenames are
// timestamped; retention prunes older than HIILITE_BACKUP_RETENTION_DAYS
// (default 14). Also mirrors .env.local so secrets can be restored alongside
// the DB. Optional HIILITE_OFFSITE_CMD lets the host pipe the new file to
// rclone/s3/etc.
//
// Exit codes: 0 = success, 1 = any failure.
//
// Cron suggestion:
//   30 2 * * *  /usr/bin/node /opt/hiilite-platform/scripts/backup-db.mjs >> /var/log/hiilite-platform/backup.cron.log 2>&1

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const HOME = os.homedir()
const DB_PATH = process.env.HIILITE_DB_PATH
  || path.resolve(__dirname, '..', '..', 'store', 'motion.db')
const BACKUP_DIR = process.env.HIILITE_BACKUP_DIR
  || path.join(HOME, 'code', 'backups', 'nightly')
const RETENTION_DAYS = Math.max(1, parseInt(process.env.HIILITE_BACKUP_RETENTION_DAYS || '14', 10) || 14)
const OFFSITE_CMD = process.env.HIILITE_OFFSITE_CMD || ''
const ENV_LOCAL_PATH = path.resolve(__dirname, '..', '.env.local')

function ts() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function logLine(line) {
  const stamp = new Date().toISOString()
  const msg = `[${stamp}] ${line}`
  console.log(msg)
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    fs.appendFileSync(path.join(BACKUP_DIR, 'backup.log'), msg + '\n')
  } catch { /* if we can't write the log, the console still has it */ }
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    logLine(`FAIL: DB not found at ${DB_PATH}`)
    process.exit(1)
  }
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  } catch (e) {
    logLine(`FAIL: cannot create backup dir ${BACKUP_DIR}: ${e.message}`)
    process.exit(1)
  }

  const stamp = ts()
  const backupName = `motion-${stamp}.db`
  const backupPath = path.join(BACKUP_DIR, backupName)

  let Database
  try {
    ({ default: Database } = await import('better-sqlite3'))
  } catch (e) {
    logLine(`FAIL: better-sqlite3 not installed: ${e.message}`)
    process.exit(1)
  }

  // Open in readonly mode — backup is read-only by definition.
  let db
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  } catch (e) {
    logLine(`FAIL: cannot open DB ${DB_PATH}: ${e.message}`)
    process.exit(1)
  }

  try {
    // db.backup is async, returns a promise that resolves when complete.
    // Internally uses SQLite's online backup API — safe with WAL + writers.
    await db.backup(backupPath)
    const sizeMb = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2)
    logLine(`OK: ${backupName} (${sizeMb} MB)`)
  } catch (e) {
    logLine(`FAIL: backup ${backupName}: ${e.message}`)
    try { db.close() } catch { /* ignore */ }
    process.exit(1)
  }
  try { db.close() } catch { /* ignore */ }

  // .env.local mirror (chmod 600).
  if (fs.existsSync(ENV_LOCAL_PATH)) {
    try {
      const envBackup = path.join(BACKUP_DIR, `env.local.backup-${stamp}`)
      fs.copyFileSync(ENV_LOCAL_PATH, envBackup)
      try { fs.chmodSync(envBackup, 0o600) } catch { /* best-effort */ }
      logLine(`OK: env.local mirrored -> env.local.backup-${stamp}`)
    } catch (e) {
      // Non-fatal — DB is the load-bearing artifact.
      logLine(`WARN: env.local mirror failed: ${e.message}`)
    }
  } else {
    logLine(`INFO: no .env.local at ${ENV_LOCAL_PATH} — skipping env mirror`)
  }

  // Retention: prune both *.db and env.local.backup-* older than RETENTION_DAYS.
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000
    const entries = fs.readdirSync(BACKUP_DIR)
    let pruned = 0
    for (const name of entries) {
      // Only prune our own files; never touch backup.log or unknown files.
      if (!/^motion-.+\.db$/.test(name) && !/^env\.local\.backup-/.test(name)) continue
      const p = path.join(BACKUP_DIR, name)
      try {
        const st = fs.statSync(p)
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(p)
          pruned++
        }
      } catch { /* ignore individual prune errors */ }
    }
    if (pruned > 0) logLine(`OK: pruned ${pruned} file(s) older than ${RETENTION_DAYS}d`)
  } catch (e) {
    logLine(`WARN: retention prune failed: ${e.message}`)
  }

  // Offsite hook. Runs in foreground so the cron job can surface failures.
  if (OFFSITE_CMD) {
    try {
      const res = spawnSync(OFFSITE_CMD, [backupPath], { shell: true, stdio: 'pipe', encoding: 'utf8' })
      if (res.status === 0) {
        logLine(`OK: offsite hook (${OFFSITE_CMD}) exit 0`)
      } else {
        logLine(`WARN: offsite hook exit ${res.status}: ${(res.stderr || '').trim().slice(0, 500)}`)
      }
    } catch (e) {
      logLine(`WARN: offsite hook spawn failed: ${e.message}`)
    }
  }

  process.exit(0)
}

main().catch(e => {
  logLine(`FAIL: uncaught: ${e?.stack || e?.message || String(e)}`)
  process.exit(1)
})
