#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const STORE_DIR = path.join(homedir(), 'code', 'store')
const WATERMARK_FILE = path.join(STORE_DIR, '.fyxer-watermark.json')
const ENV_FILE = path.join(homedir(), 'code', 'motion-lite', '.env.local')
const WEBHOOK_URL = process.env.MOTION_LITE_URL || 'http://localhost:4000/api/webhooks/transcript'
const FYXER_FROM = 'notetaker@fyxer.com'
const LOOKBACK_HOURS_DEFAULT = 24

if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true })

const env = readFileSync(ENV_FILE, 'utf8')
const m = env.match(/^TRANSCRIPT_WEBHOOK_SECRET=(.+)$/m)
if (!m || !m[1].trim()) {
  console.error('TRANSCRIPT_WEBHOOK_SECRET missing from .env.local')
  process.exit(1)
}
const WEBHOOK_SECRET = m[1].trim().replace(/^['"]|['"]$/g, '')

function readWatermark() {
  if (!existsSync(WATERMARK_FILE)) {
    return new Date(Date.now() - LOOKBACK_HOURS_DEFAULT * 3600_000).toISOString()
  }
  return JSON.parse(readFileSync(WATERMARK_FILE, 'utf8')).last
}
function writeWatermark(iso) {
  writeFileSync(WATERMARK_FILE, JSON.stringify({ last: iso, updated_at: new Date().toISOString() }, null, 2))
}

class McpStdio {
  constructor() {
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
  async request(method, params) {
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
      clientInfo: { name: 'fyxer-ingest', version: '1.0.0' },
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

function fyxerExternalIdFromBody(body) {
  // Fyxer URL shape: .../call-recordings/<orgId>:<entryid>[:<extraId>]?...
  // Take the whole tail after "call-recordings/" up to the query string.
  const m = body.match(/call-recordings\/([^?>\s]+)/)
  return m ? `fyxer:${m[1]}` : null
}

function cleanFyxerBody(body) {
  body = body.replace(/\[Fyxer AI\]<[^>]+>/g, '')
  body = body.replace(/<https?:\/\/[^>]+>/g, '')
  body = body.split(/Rate this summary:/)[0]
  return body.replace(/\n{3,}/g, '\n\n').trim()
}

async function postTranscript(msg) {
  const bodyText = msg.body?.contentType === 'html'
    ? msg.body.content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    : msg.body?.content || ''
  const cleaned = cleanFyxerBody(bodyText)
  const externalId = fyxerExternalIdFromBody(bodyText) || `fyxer:msg:${msg.id}`
  const payload = {
    title: msg.subject || 'Fyxer Meeting',
    transcript: cleaned,
    summary: '',
    source: 'fyxer',
    external_id: externalId,
    recorded_at: msg.receivedDateTime,
  }
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
    body: JSON.stringify(payload),
  })
  const txt = await res.text()
  return { status: res.status, body: txt, externalId, title: payload.title }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const since = process.argv.includes('--since')
    ? process.argv[process.argv.indexOf('--since') + 1]
    : readWatermark()
  console.log(`[fyxer-ingest] watermark = ${since}${dryRun ? ' (dry-run)' : ''}`)

  const mcp = new McpStdio()
  let exitCode = 0
  try {
    await mcp.init()
    const search = `"from:${FYXER_FROM} received>=${since.slice(0, 10)}"`
    const result = await mcp.tool('list-mail-messages', {
      search,
      select: 'id,subject,from,receivedDateTime',
      top: 25,
    })
    const all = result?.value || []
    const fyxer = all
      .filter(m => m.from?.emailAddress?.address?.toLowerCase() === FYXER_FROM)
      .filter(m => new Date(m.receivedDateTime) > new Date(since))
      .sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime))

    console.log(`[fyxer-ingest] candidates: ${all.length}, after-filter: ${fyxer.length}`)
    if (fyxer.length === 0) return

    let latest = since
    for (const stub of fyxer) {
      try {
        const full = await mcp.tool('get-mail-message', {
          messageId: stub.id,
          select: 'id,subject,body,receivedDateTime,from',
        })
        if (dryRun) {
          const bodyText = full.body?.content || ''
          const xid = fyxerExternalIdFromBody(bodyText) || `fyxer:msg:${full.id}`
          console.log(`[dry-run] ${stub.receivedDateTime} ${xid} :: ${full.subject}`)
          continue
        }
        const r = await postTranscript(full)
        console.log(`[fyxer-ingest] ${r.status} ${r.title} ${r.externalId} -> ${r.body.slice(0, 80)}`)
        if (r.status >= 200 && r.status < 300) {
          if (new Date(stub.receivedDateTime) > new Date(latest)) latest = stub.receivedDateTime
        }
      } catch (e) {
        console.error(`[fyxer-ingest] failed for ${stub.id}: ${e.message}`)
      }
    }
    if (!dryRun && latest !== since) writeWatermark(latest)
  } catch (e) {
    console.error(`[fyxer-ingest] fatal: ${e.message}`)
    exitCode = 1
  } finally {
    mcp.close()
  }

  // Chain: route any unrouted Fyxer transcripts to OneNote (+Asana for client meetings).
  // Runs in-process after ingest so the 5-min LaunchAgent fires both jobs in one cycle.
  // Failure here does NOT roll back the ingest — routing retries next cycle.
  if (!dryRun) {
    try {
      const { routePending } = await import('./fyxer-route.mjs')
      const r = await routePending({ dryRun: false })
      console.log(`[fyxer-ingest] routed ${r.processed} transcript(s) (errors: ${r.errors || 0})`)
    } catch (e) {
      console.error(`[fyxer-ingest] route step failed: ${e.message}`)
    }
  }

  process.exit(exitCode)
}

main()
