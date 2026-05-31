#!/usr/bin/env node
/**
 * qbo-eod-update.mjs
 *
 * Computes today's QBO totals (payments + sales receipts + deposits) and writes
 * a paste-ready plain-text summary to /tmp/qbo-eod-totals.txt. The EOD heartbeat
 * (smart-heartbeat.sh) reads that file, injects it into the briefing prompt,
 * and the heartbeat agent includes it verbatim in the Telegram message.
 *
 * Why not OneNote append? The MS365 MCP only exposes `create-onenote-section-page`
 * (POST) for OneNote, not PATCH. Going through Graph $batch fails with
 * "Invalid JSON body" for the OneNote /content endpoint. Going through
 * delete-then-create would orphan the page's embedded image resources
 * (meeting recap screenshots) every day. Telegram delivery is the safe path.
 *
 * Standalone CLI:
 *   node qbo-eod-update.mjs                     # write today's totals
 *   node qbo-eod-update.mjs --date 2026-05-09   # specific date
 *   node qbo-eod-update.mjs --print             # also print the block to stdout
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const STORE_DIR = path.join(homedir(), 'code', 'store')
const LOG_FILE = path.join(STORE_DIR, '.qbo-eod-update.log')
const OUT_FILE = '/tmp/qbo-eod-totals.txt'
const QBO_MCP_CMD = path.join(homedir(), 'code', 'hiilite-share', '8-accounting', 'intuit-qbo-mcp', 'run-mcp.sh')
const TZ = 'America/Vancouver'

if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true })

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [qbo-eod-update] [${level}] ${msg}` +
    (extra ? ' ' + JSON.stringify(extra) : '')
  appendFileSync(LOG_FILE, line + '\n')
  if (level !== 'debug') console.log(line)
}

class McpStdio {
  constructor(cmd, args = []) {
    this.proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] })
    this.id = 0
    this.pending = new Map()
    this.buf = ''
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk.toString('utf8')
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id)
            this.pending.delete(msg.id)
            if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
            else resolve(msg.result)
          }
        } catch (_) {}
      }
    })
  }
  async init(clientName) {
    await this.req('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0' },
    })
    this.notify('notifications/initialized', {})
  }
  req(method, params) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP timeout: ${method}`))
        }
      }, 60_000)
    })
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }
  async tool(name, args) {
    const r = await this.req('tools/call', { name, arguments: args })
    if (r?.isError) throw new Error(`MCP tool error (${name}): ${JSON.stringify(r.content)}`)
    if (Array.isArray(r?.content)) {
      const joined = r.content.map((c) => c?.text || '').join('\n').trim()
      if (joined) {
        const jsonStart = joined.indexOf('[')
        if (jsonStart >= 0) {
          try { return JSON.parse(joined.slice(jsonStart)) } catch (_) {}
        }
        try { return JSON.parse(joined) } catch (_) { return joined }
      }
    }
    const txt = r?.content?.[0]?.text
    if (txt) {
      try { return JSON.parse(txt) } catch (_) { return txt }
    }
    return r
  }
  close() { try { this.proc.kill() } catch (_) {} }
}

function ptDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday }
}

function fmtCAD(n) {
  const v = Number(n) || 0
  return v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

// QBO MCP search-* tools choke on the date-range filter syntax; pull a sliding
// window and filter client-side. 50 records is enough headroom for a 24h period.
async function fetchQboRecords(qbo, targetIso) {
  const [payments, salesReceipts, deposits] = await Promise.all([
    qbo.tool('search_payments', { params: { limit: 50 } }).catch((e) => { log('warn', `payments: ${e.message}`); return [] }),
    qbo.tool('search_sales_receipts', { params: { limit: 50 } }).catch((e) => { log('warn', `sales_receipts: ${e.message}`); return [] }),
    qbo.tool('search_deposits', { params: { limit: 50 } }).catch((e) => { log('warn', `deposits: ${e.message}`); return [] }),
  ])
  return {
    todayPayments: (Array.isArray(payments) ? payments : []).filter((p) => p?.TxnDate === targetIso),
    todaySR: (Array.isArray(salesReceipts) ? salesReceipts : []).filter((p) => p?.TxnDate === targetIso),
    todayDeposits: (Array.isArray(deposits) ? deposits : []).filter((p) => p?.TxnDate === targetIso),
  }
}

function summarizeTotals({ todayPayments, todaySR, todayDeposits }) {
  const sum = (arr) => arr.reduce((a, x) => a + (Number(x?.TotalAmt) || 0), 0)
  const paymentsTotal = sum(todayPayments)
  const salesReceiptsTotal = sum(todaySR)
  const depositsTotal = sum(todayDeposits)
  return {
    paymentsTotal,
    salesReceiptsTotal,
    depositsTotal,
    receivedTotal: paymentsTotal + salesReceiptsTotal,
    paymentsCount: todayPayments.length,
    srCount: todaySR.length,
    depositsCount: todayDeposits.length,
  }
}

// Plain-text block. Designed for Telegram (no markdown), and also paste-safe for OneNote.
function buildTextBlock({ todayIso, weekday, todayPayments, todaySR, todayDeposits, totals }) {
  const lines = [`QBO TODAY -- ${weekday} ${todayIso}`, '']

  lines.push(`Received: ${fmtCAD(totals.receivedTotal)}  (SR ${fmtCAD(totals.salesReceiptsTotal)} x${totals.srCount} + PMT ${fmtCAD(totals.paymentsTotal)} x${totals.paymentsCount})`)
  lines.push(`Deposits: ${fmtCAD(totals.depositsTotal)} x${totals.depositsCount}`)

  if (todaySR.length || todayPayments.length) {
    lines.push('')
    for (const r of todaySR) {
      lines.push(`  SR  ${fmtCAD(r.TotalAmt).padEnd(11)} ${r?.CustomerRef?.name || 'Unknown'}`)
    }
    for (const p of todayPayments) {
      lines.push(`  PMT ${fmtCAD(p.TotalAmt).padEnd(11)} ${p?.CustomerRef?.name || 'Unknown'}`)
    }
  }

  if (todayDeposits.length) {
    lines.push('')
    for (const d of todayDeposits) {
      const acct = d?.DepositToAccountRef?.name || 'unknown account'
      const lc = Array.isArray(d?.Line) ? d.Line.length : 0
      lines.push(`  DEP ${fmtCAD(d.TotalAmt).padEnd(11)} -> ${acct}${lc ? ` (${lc} line${lc === 1 ? '' : 's'})` : ''}`)
    }
  }

  return lines.join('\n')
}

export async function updateQboEod({ date = null, print = false } = {}) {
  const now = date ? new Date(`${date}T20:00:00Z`) : new Date()
  const today = ptDateParts(now)
  log('info', `EOD QBO totals for ${today.iso} (${today.weekday})`)

  const qbo = new McpStdio(QBO_MCP_CMD)
  const result = { date: today.iso }

  try {
    await qbo.init('qbo-eod-update')
    const records = await fetchQboRecords(qbo, today.iso)
    const totals = summarizeTotals(records)
    log('info', `totals`, totals)
    Object.assign(result, totals)

    const block = buildTextBlock({ todayIso: today.iso, weekday: today.weekday, ...records, totals })
    writeFileSync(OUT_FILE, block + '\n')
    log('info', `wrote totals to ${OUT_FILE}`, { bytes: block.length })
    result.outFile = OUT_FILE
    if (print) console.log('\n' + block + '\n')
    return result
  } finally {
    qbo.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const print = args.includes('--print')
  const dIdx = args.indexOf('--date')
  const date = dIdx >= 0 ? args[dIdx + 1] : null
  updateQboEod({ date, print })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
    .catch((e) => { log('error', 'fatal', { err: e.message, stack: e.stack }); process.exit(1) })
}
