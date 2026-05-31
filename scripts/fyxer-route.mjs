#!/usr/bin/env node
/**
 * fyxer-route.mjs
 *
 * Reads unrouted Fyxer transcripts from motion.db and routes them to:
 *   1. OneNote (Hiilite WORK section) — always
 *   2. Asana project status update — only for external client meetings (Hiilite //)
 *
 * Idempotent: marks each transcript as routed in motion.db so the next run skips it.
 *
 * Invoked from fyxer-ingest.mjs at the end of each 5-min ingest cycle.
 * Standalone CLI: `node fyxer-route.mjs [--dry-run] [--id <transcript_id>]`
 */

import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'

// ---- config ----
const STORE_DIR = path.join(homedir(), 'code', 'store')
const DB_PATH = path.join(STORE_DIR, 'motion.db')
const LOG_FILE = path.join(STORE_DIR, '.fyxer-route.log')
const ONENOTE_WORK_SECTION_ID = '1-a8385b21-988f-4256-8322-482ef6d658e4'
const ASANA_API = 'https://app.asana.com/api/1.0'
const ASANA_KEYCHAIN_SERVICE = 'asana-personal-token'
const ASANA_KEYCHAIN_ACCOUNT = 'will@hiilite.com'
const ASANA_WORKSPACE_GID = '11332955552906'
const HIILITE_DOMAIN = 'hiilite.com'

// External-domain → friendly client name mapping (best-effort).
// Domain → display label that matches the Hiilite // <Client> Fyxer prefix.
const DOMAIN_TO_CLIENT = {
  'advancesmiles.ca': 'Advance Dental',
  'glenvalleydental.com': 'Glenvalley Dental',
  'truedentalkelowna.com': 'True Dental',
  // extend as new clients show up
}

if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true })

// ---- logging ----
function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [fyxer-route] [${level}] ${msg}` +
    (extra ? ' ' + JSON.stringify(extra) : '')
  appendFileSync(LOG_FILE, line + '\n')
  if (level !== 'debug') console.log(line)
}

// ---- MCP-over-stdio (same pattern as fyxer-ingest.mjs) ----
class McpStdio {
  constructor() {
    this.proc = spawn('npx', ['-y', '@softeria/ms-365-mcp-server', '--org-mode'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
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
        } catch (_) { /* non-json output: ignore */ }
      }
    })
  }
  async init() {
    await this.req('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'fyxer-route', version: '1.0' },
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
    const txt = r?.content?.[0]?.text
    if (txt) {
      try { return JSON.parse(txt) } catch (_) { return txt }
    }
    return r
  }
  close() { try { this.proc.kill() } catch (_) {} }
}

// ---- Asana auth via macOS Keychain ----
function getAsanaToken() {
  try {
    const out = execFileSync('/usr/bin/security', [
      'find-generic-password', '-s', ASANA_KEYCHAIN_SERVICE, '-a', ASANA_KEYCHAIN_ACCOUNT, '-w',
    ], { encoding: 'utf8' })
    return out.trim()
  } catch (e) {
    return null  // not yet configured
  }
}

async function asanaPost(path, token, body) {
  const r = await fetch(`${ASANA_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ data: body }),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Asana ${path} ${r.status}: ${JSON.stringify(json)}`)
  return json.data
}

async function asanaGet(path, token) {
  const r = await fetch(`${ASANA_API}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Asana GET ${path} ${r.status}: ${JSON.stringify(json)}`)
  return json.data
}

// ---- title parsing ----
function parseTitle(rawTitle, recordedAt) {
  // Format: "Hiilite [Internal] // <Subject> [/ <Detail>]"
  const datePrefix = recordedAt.slice(0, 10)  // YYYY-MM-DD
  let isInternal = false
  let body = rawTitle
  const internalMatch = rawTitle.match(/^Hiilite Internal\s*\/\/\s*(.+)$/i)
  const externalMatch = rawTitle.match(/^Hiilite\s*\/\/\s*(.+)$/i)
  if (internalMatch) { isInternal = true; body = internalMatch[1] }
  else if (externalMatch) { body = externalMatch[1] }
  const parts = body.split(/\s*\/\s*/)
  let client = null
  let topic = null
  if (isInternal) {
    topic = parts.join(' / ')  // "1:1 Bijoy & William / Weekly Check-in"
  } else {
    client = parts[0]?.trim()
    topic = parts.slice(1).join(' / ').trim() || 'Meeting'
  }
  let pageTitle
  if (isInternal) {
    pageTitle = `${datePrefix} Internal — ${topic}`
  } else if (client && /management meeting/i.test(client)) {
    pageTitle = `${datePrefix} Management Meeting — ${topic}`
  } else if (client) {
    pageTitle = `${datePrefix} ${client} — ${topic}`
  } else {
    pageTitle = `${datePrefix} Meeting — ${rawTitle}`
  }
  return { isInternal, client, topic, pageTitle }
}

// ---- attendee resolution from MS365 calendar ----
async function resolveAttendees(mcp, recordedAtIso, fyxerTitle) {
  const recAt = new Date(recordedAtIso)
  const winStart = new Date(recAt.getTime() - 3 * 3600_000).toISOString()
  const winEnd = new Date(recAt.getTime() + 30 * 60_000).toISOString()
  let events
  try {
    events = await mcp.tool('get-calendar-view', {
      startDateTime: winStart,
      endDateTime: winEnd,
      select: 'subject,start,end,attendees,organizer',
      top: 25,
    })
  } catch (e) {
    log('warn', 'calendar lookup failed', { err: e.message })
    return null
  }
  const items = events?.value || []
  if (!items.length) return null
  // Strip "Hiilite [Internal] //" prefix from fyxer title before fuzzy-matching subject
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const stripped = fyxerTitle.replace(/^Hiilite\s*(Internal)?\s*\/\/\s*/i, '')
  const target = norm(stripped)
  let best = null
  let bestScore = 0
  for (const ev of items) {
    const subj = norm(ev.subject || '')
    if (!subj) continue
    const tWords = new Set(target.split(' '))
    const sWords = new Set(subj.split(' '))
    let overlap = 0
    for (const w of tWords) if (sWords.has(w) && w.length > 2) overlap++
    const score = overlap / Math.max(tWords.size, 1)
    if (score > bestScore) { bestScore = score; best = ev }
  }
  if (!best || bestScore < 0.3) return null
  const list = best.attendees || []
  const organizer = best.organizer?.emailAddress
  const out = []
  for (const a of list) {
    const resp = a.status?.response
    if (resp === 'declined') continue
    const email = a.emailAddress?.address || ''
    const name = a.emailAddress?.name || email
    const isOrg = email && organizer?.address && email.toLowerCase() === organizer.address.toLowerCase()
    const isInternal = email.toLowerCase().endsWith(`@${HIILITE_DOMAIN}`)
    let display = name
    if (!isInternal && email) {
      const domain = email.split('@')[1] || ''
      const friendly = DOMAIN_TO_CLIENT[domain] || domain
      display = `${name} (${friendly})`
    }
    if (isOrg) display += ' (organizer)'
    out.push(display)
  }
  // Cap at 8
  let line
  if (out.length > 8) line = out.slice(0, 8).join(', ') + ` (+${out.length - 8} more)`
  else line = out.join(', ')
  return line
}

// ---- markdown-flavored Fyxer body → OneNote HTML body (sections) ----
function fyxerBodyToOneNoteHtml(transcript) {
  // The Fyxer transcript starts with a header block we strip,
  // then has SECTION HEADERS followed by `  *   item` bullets.
  // Sections we care about — split on lines that look like section headers
  // (single-line, not starting with whitespace, doesn't begin with bullet).
  const lines = transcript.split(/\r?\n/)
  // Find start: first section header AFTER the meta block
  // Skip lines until we hit a non-empty, non-link, non-meta header
  let i = 0
  // Strip leading meta block
  while (i < lines.length) {
    const l = lines[i].trim()
    if (l && !/^Key decisions|^Hiilite |^[A-Z][a-z]+, [A-Z][a-z]+ \d+|^\d+ minutes|^View recording|•|·/.test(l)) {
      // first real section header
      break
    }
    i++
  }
  const html = []
  let inList = false
  let listStack = []
  function closeLists() {
    while (listStack.length) { html.push('</ul>'); listStack.pop() }
    inList = false
  }
  function openList(depth) {
    while (listStack.length < depth) { html.push('<ul>'); listStack.push(depth) }
    while (listStack.length > depth) { html.push('</ul>'); listStack.pop() }
    inList = true
  }
  let inNextSteps = false
  for (; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    // Bullet detection: leading spaces + "*" + space
    const bulletMatch = line.match(/^(\s*)\*\s+(.*)$/)
    if (bulletMatch) {
      const indent = bulletMatch[1].length
      const text = htmlEscape(bulletMatch[2])
      // depth heuristic: 2 spaces = top, 5 spaces = nested
      const depth = indent <= 2 ? 1 : 2
      openList(depth)
      if (inNextSteps) {
        html.push(`<p data-tag="to-do">${text}</p>`)
      } else {
        html.push(`<li>${text}</li>`)
      }
      continue
    }
    if (line.match(/^View Meeting/i)) continue  // footer junk
    // Section header
    closeLists()
    const heading = htmlEscape(line.trim())
    inNextSteps = /^(next steps|action items)$/i.test(line.trim())
    if (inNextSteps) {
      html.push(`<h2>${heading}</h2>`)
    } else {
      html.push(`<h2>${heading}</h2>`)
    }
  }
  closeLists()
  return html.join('')
}

function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ---- markdown-flavored Fyxer body → plain-text Asana status body ----
function fyxerBodyToPlainText(transcript) {
  const lines = transcript.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const l = lines[i].trim()
    if (l && !/^Key decisions|^Hiilite |^[A-Z][a-z]+, [A-Z][a-z]+ \d+|^\d+ minutes|^View recording|•|·/.test(l)) break
    i++
  }
  const out = []
  let inNextSteps = false
  for (; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) { out.push(''); continue }
    if (/^View Meeting/i.test(line)) continue
    const bulletMatch = line.match(/^(\s*)\*\s+(.*)$/)
    if (bulletMatch) {
      const indent = bulletMatch[1].length
      const text = bulletMatch[2]
      if (inNextSteps) {
        out.push(`[ ] ${text}`)
      } else if (indent <= 2) {
        out.push(`• ${text}`)
      } else {
        out.push(`   – ${text}`)
      }
      continue
    }
    // Section header — uppercase it
    inNextSteps = /^(next steps|action items)$/i.test(line.trim())
    out.push('')
    out.push(line.trim().toUpperCase())
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---- date formatter ----
function formatDateLine(recordedAtIso) {
  const d = new Date(recordedAtIso)
  return d.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    timeZone: 'America/Vancouver',
  })
}

// ---- Asana project lookup (prefer "<Client> - Retainer") ----
async function findAsanaProject(token, clientName) {
  const q = encodeURIComponent(clientName)
  const data = await asanaGet(
    `/workspaces/${ASANA_WORKSPACE_GID}/typeahead?resource_type=project&query=${q}&count=10&opt_fields=name,gid`,
    token
  )
  if (!Array.isArray(data) || !data.length) return null
  // Prefer "Retainer"
  const retainer = data.find((p) => /retainer/i.test(p.name) && p.name.toLowerCase().includes(clientName.toLowerCase()))
  if (retainer) return retainer
  // Fallback to first that starts with the client name
  const startsWith = data.find((p) => p.name.toLowerCase().startsWith(clientName.toLowerCase()))
  return startsWith || data[0]
}

// ---- main routing per transcript ----
async function routeOne(db, mcp, asanaToken, t, opts) {
  const { dryRun } = opts
  const { isInternal, client, pageTitle } = parseTitle(t.title, t.recorded_at)
  const dateLine = formatDateLine(t.recorded_at)

  // Skip internal Therapy/Legal-style content (none expected from Fyxer, but guard)
  if (/therapy|legal/i.test(t.title)) {
    log('warn', `skip transcript #${t.id} — title flagged as Therapy/Legal`, { title: t.title })
    return { skipped: 'sensitive' }
  }

  // 1. attendees
  let attendeesLine = await resolveAttendees(mcp, t.recorded_at, t.title)
  log('debug', `transcript #${t.id} attendees`, { line: attendeesLine })
  if (!attendeesLine) {
    // fallback: scan transcript for "Owner: <Name>"
    const owners = new Set()
    for (const m of t.transcript.matchAll(/Owner:\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/g)) {
      owners.add(m[1])
    }
    if (owners.size) attendeesLine = [...owners].join(', ') + ' (parsed from transcript)'
    else attendeesLine = '(could not resolve from calendar)'
  }

  // 2. OneNote — always
  let oneNotePageId = t.onenote_page_id
  let oneNoteWebUrl = null
  if (!oneNotePageId) {
    const bodyHtml = fyxerBodyToOneNoteHtml(t.transcript)
    const docPublicId = await dbDocPublicIdForTranscript(db, t.id)
    const motionLink = docPublicId
      ? `<a href="http://localhost:4000/doc/${docPublicId}">Motion Lite doc</a>`
      : `Motion Lite (transcript #${t.id})`
    const fullHtml = `<!DOCTYPE html><html><head><title>${htmlEscape(pageTitle)}</title>` +
      `<meta name="created" content="${t.recorded_at}" /></head><body>` +
      `<h1>${htmlEscape(pageTitle.replace(/^\d{4}-\d{2}-\d{2}\s+/, ''))}</h1>` +
      `<p><strong>Date:</strong> ${htmlEscape(dateLine)}</p>` +
      `<p><strong>Attendees:</strong> ${htmlEscape(attendeesLine)}</p>` +
      `<p><strong>Source:</strong> Fyxer (transcript #${t.id}) · ${motionLink}</p>` +
      `<hr />${bodyHtml}` +
      `<hr /><p style="font-size:9pt;color:#666"><em>Auto-generated from Fyxer recap by fyxer-route on ${new Date().toISOString().slice(0, 10)}.</em></p>` +
      `</body></html>`
    if (dryRun) {
      log('info', `[DRY-RUN] would create OneNote page`, { pageTitle, transcriptId: t.id, htmlBytes: fullHtml.length })
    } else {
      const created = await mcp.tool('create-onenote-section-page', {
        onenoteSectionId: ONENOTE_WORK_SECTION_ID,
        body: { content: fullHtml },
      })
      oneNotePageId = created?.id
      oneNoteWebUrl = created?.links?.oneNoteWebUrl?.href
      if (!oneNotePageId) throw new Error('OneNote create returned no page id')
      db.prepare('UPDATE transcripts SET onenote_page_id=?, onenote_routed_at=? WHERE id=?')
        .run(oneNotePageId, new Date().toISOString(), t.id)
      log('info', `routed transcript #${t.id} → OneNote`, { pageTitle, pageId: oneNotePageId })
    }
  } else {
    log('debug', `transcript #${t.id} already routed to OneNote`, { pageId: oneNotePageId })
  }

  // 3. Asana — only for external client meetings
  if (isInternal) {
    log('debug', `transcript #${t.id} is internal — no Asana status update`)
    return { onenotePageId: oneNotePageId, onenoteUrl: oneNoteWebUrl, asanaSkipped: 'internal' }
  }
  if (!asanaToken) {
    log('warn', `transcript #${t.id} is external but no Asana token — skipping status update`)
    return { onenotePageId: oneNotePageId, onenoteUrl: oneNoteWebUrl, asanaSkipped: 'no_token' }
  }
  if (t.asana_status_gid) {
    log('debug', `transcript #${t.id} already has Asana status`, { gid: t.asana_status_gid })
    return { onenotePageId: oneNotePageId, onenoteUrl: oneNoteWebUrl, asanaStatusGid: t.asana_status_gid }
  }
  const project = await findAsanaProject(asanaToken, client).catch((e) => {
    log('warn', `Asana project lookup failed for "${client}"`, { err: e.message })
    return null
  })
  if (!project) {
    log('warn', `transcript #${t.id} — no Asana project found for client "${client}"`)
    return { onenotePageId: oneNotePageId, onenoteUrl: oneNoteWebUrl, asanaSkipped: 'no_project' }
  }
  // Build plain-text body
  const bodyText = `Meeting: ${client} — ${parseTitle(t.title, t.recorded_at).topic}\n${dateLine}\n\n` +
    `Attendees: ${attendeesLine}\n\n` +
    `Source: Fyxer recap (transcript #${t.id})\n` +
    (oneNoteWebUrl ? `OneNote: ${oneNoteWebUrl}\n\n\n` : '\n\n') +
    fyxerBodyToPlainText(t.transcript) +
    `\n\n—\nAuto-generated from Fyxer recap by fyxer-route on ${new Date().toISOString().slice(0, 10)}.`
  if (dryRun) {
    log('info', `[DRY-RUN] would post Asana status`, { project: project.name, transcriptId: t.id, bytes: bodyText.length })
    return { onenotePageId: oneNotePageId, onenoteUrl: oneNoteWebUrl, asanaSkipped: 'dry_run' }
  }
  const status = await asanaPost(`/projects/${project.gid}/project_statuses`, asanaToken, {
    title: pageTitle,  // matches OneNote title exactly
    color: 'green',
    text: bodyText,
  })
  db.prepare('UPDATE transcripts SET asana_status_gid=?, asana_routed_at=? WHERE id=?')
    .run(status.gid, new Date().toISOString(), t.id)
  log('info', `routed transcript #${t.id} → Asana status`, { project: project.name, statusGid: status.gid })
  return { onenotePageId: oneNotePageId, onenoteUrl: oneNoteWebUrl, asanaStatusGid: status.gid, project: project.name }
}

async function dbDocPublicIdForTranscript(db, transcriptId) {
  const row = db.prepare(`
    SELECT d.public_id FROM transcripts t LEFT JOIN docs d ON d.id = t.doc_id WHERE t.id = ?
  `).get(transcriptId)
  return row?.public_id || null
}

// ---- entry point: route all pending transcripts ----
export async function routePending({ dryRun = false, onlyId = null } = {}) {
  const db = new Database(DB_PATH, { readonly: false })
  let pending
  if (onlyId) {
    pending = db.prepare(`SELECT * FROM transcripts WHERE id = ? AND source = 'fyxer'`).all(onlyId)
  } else {
    // Pick rows that need EITHER step:
    //   - never routed to OneNote, OR
    //   - external client (Hiilite // …, NOT Hiilite Internal //) that hasn't been routed to Asana yet.
    // Internal meetings without Asana stay silent (no retry loop).
    pending = db.prepare(`
      SELECT * FROM transcripts
      WHERE source = 'fyxer'
        AND (
          onenote_routed_at IS NULL
          OR (
            asana_routed_at IS NULL
            AND title LIKE 'Hiilite //%'
            AND title NOT LIKE 'Hiilite Internal //%'
          )
        )
      ORDER BY recorded_at ASC
      LIMIT 50
    `).all()
  }
  if (!pending.length) {
    log('info', 'no unrouted transcripts')
    db.close()
    return { processed: 0 }
  }
  log('info', `found ${pending.length} unrouted Fyxer transcript(s)`)
  const mcp = new McpStdio()
  const asanaToken = getAsanaToken()
  if (!asanaToken) {
    log('warn', 'Asana token not in Keychain — external client meetings will skip Asana status')
  }
  let processed = 0, errors = 0
  try {
    await mcp.init()
    for (const t of pending) {
      try {
        const r = await routeOne(db, mcp, asanaToken, t, { dryRun })
        log('info', `done #${t.id}`, r)
        processed++
      } catch (e) {
        errors++
        log('error', `failed transcript #${t.id}`, { err: e.message, stack: e.stack })
      }
    }
  } finally {
    mcp.close()
    db.close()
  }
  log('info', `route complete`, { processed, errors })
  return { processed, errors }
}

// ---- summary for heartbeat / status ----
// Emits a plain-text context block describing recently routed Fyxer transcripts.
// Used by the heartbeat agent so it knows what meetings happened since last run.
export function summarizeRouted({ sinceHours = 24 } = {}) {
  const db = new Database(DB_PATH, { readonly: true })
  const cutoff = new Date(Date.now() - sinceHours * 3600_000).toISOString()
  const rows = db.prepare(`
    SELECT id, title, transcript, recorded_at, onenote_routed_at,
           asana_status_gid, asana_routed_at
    FROM transcripts
    WHERE source = 'fyxer'
      AND onenote_routed_at IS NOT NULL
      AND onenote_routed_at >= ?
    ORDER BY recorded_at DESC
  `).all(cutoff)
  db.close()

  const out = []
  out.push(`=== MEETING RECAPS (Fyxer, routed in last ${sinceHours}h) ===`)
  out.push('')
  if (!rows.length) {
    out.push('(no meeting recaps routed in this window)')
    return out.join('\n')
  }
  out.push(`${rows.length} meeting recap(s) routed since ${cutoff}:`)
  out.push('')

  for (const r of rows) {
    const { isInternal, client, pageTitle } = parseTitle(r.title, r.recorded_at)
    const compact = formatCompactDate(r.recorded_at)
    const kind = isInternal ? 'internal' : (client ? `external · ${client}` : 'meeting')
    let asanaLine = ''
    if (isInternal) asanaLine = '(internal — no Asana status)'
    else if (r.asana_status_gid) asanaLine = `Asana status posted (gid ${r.asana_status_gid})`
    else asanaLine = `Asana NOT posted (no project match or token missing)`

    const nextSteps = extractNextStepsTop3(r.transcript)

    out.push(`---`)
    out.push(`[${compact}] ${pageTitle}`)
    out.push(`  Kind: ${kind}`)
    out.push(`  ${asanaLine}`)
    if (nextSteps.length) {
      out.push(`  Top next steps:`)
      for (const ns of nextSteps) out.push(`    • ${ns}`)
    }
    out.push('')
  }
  return out.join('\n')
}

function formatCompactDate(iso) {
  const d = new Date(iso)
  const fmt = d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Vancouver',
  })
  return `${fmt} PT`
}

function extractNextStepsTop3(transcript) {
  const lines = transcript.split(/\r?\n/)
  let inSection = false
  const items = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^(next steps|action items)$/i.test(line)) { inSection = true; continue }
    if (inSection) {
      if (!line) continue
      if (/^view meeting/i.test(line)) break
      // Section header would end this block — non-bullet, non-link line
      if (!/^\s*\*\s+/.test(raw) && !/^\s+/.test(raw)) break
      const m = raw.match(/^\s*\*\s+(.*)$/)
      if (m) {
        items.push(m[1].slice(0, 160))
        if (items.length >= 3) break
      }
    }
  }
  return items
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  if (args.includes('--summary')) {
    const hIdx = args.indexOf('--since-hours')
    const sinceHours = hIdx >= 0 ? Number(args[hIdx + 1]) : 24
    process.stdout.write(summarizeRouted({ sinceHours }) + '\n')
    process.exit(0)
  }
  const dryRun = args.includes('--dry-run')
  const idArgIdx = args.indexOf('--id')
  const onlyId = idArgIdx >= 0 ? Number(args[idArgIdx + 1]) : null
  routePending({ dryRun, onlyId })
    .then((r) => { process.exit(r.errors ? 1 : 0) })
    .catch((e) => { log('error', 'top-level failure', { err: e.message, stack: e.stack }); process.exit(1) })
}
