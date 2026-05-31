#!/usr/bin/env node
/**
 * daily-journal.mjs
 *
 * Creates today's daily journal scaffold in OneNote (Hiilite WORK section).
 * Pre-populates:
 *   1. Today's calendar events (from MS365 work calendar)
 *   2. Yesterday's open Asana tasks (overdue/incomplete, assigned to William)
 *   3. Yesterday's unchecked OneNote to-dos (carried forward from yesterday's daily note)
 *
 * Idempotent: if a page with title `<YYYY-MM-DD>  <Day>...` already exists in WORK,
 * the script no-ops and reports the existing page URL.
 *
 * Invoked from smart-heartbeat.sh at the start of the Morning slot (~6:30am)
 * so the heartbeat agent can read the scaffold + work against it.
 *
 * Standalone CLI:
 *   node daily-journal.mjs                     # create today's
 *   node daily-journal.mjs --date 2026-05-09   # create for a specific date
 *   node daily-journal.mjs --dry-run           # preview HTML without writing
 */

import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const STORE_DIR = path.join(homedir(), 'code', 'store')
const LOG_FILE = path.join(STORE_DIR, '.daily-journal.log')
const WORK_SECTION_ID = '1-a8385b21-988f-4256-8322-482ef6d658e4'
const ASANA_API = 'https://app.asana.com/api/1.0'
const ASANA_KEYCHAIN_SERVICE = 'asana-personal-token'
const ASANA_KEYCHAIN_ACCOUNT = 'will@hiilite.com'
const ASANA_USER_GID = '11332956705049'  // William
const TZ = 'America/Vancouver'

if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true })

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [daily-journal] [${level}] ${msg}` +
    (extra ? ' ' + JSON.stringify(extra) : '')
  appendFileSync(LOG_FILE, line + '\n')
  if (level !== 'debug') console.log(line)
}

// ---- McpStdio (work account, --org-mode) ----
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
        } catch (_) {}
      }
    })
  }
  async init() {
    await this.req('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'daily-journal', version: '1.0' },
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

function getAsanaToken() {
  try {
    return execFileSync('/usr/bin/security', [
      'find-generic-password', '-s', ASANA_KEYCHAIN_SERVICE, '-a', ASANA_KEYCHAIN_ACCOUNT, '-w',
    ], { encoding: 'utf8' }).trim()
  } catch (_) { return null }
}

// ---- date helpers (PT-aware) ----
function ptDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
  }
}

function ptIsoFromUtc(utcIso) {
  // Format a UTC ISO timestamp as "h:mm AM/PM PT"
  return new Date(utcIso).toLocaleString('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' PT'
}

function dayBeforeIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - 1)
  return dt.toISOString().slice(0, 10)
}

function ptIsoToUtcWindow(iso) {
  // Given an ISO date (YYYY-MM-DD in PT), return [startUtc, endUtcExclusive]
  // covering 00:00:00–23:59:59 PT on that date.
  // PT is UTC-7 (PDT) most of the year; UTC-8 in winter (PST). Use Intl to compute.
  const [y, m, d] = iso.split('-').map(Number)
  const localMidnight = new Date(`${iso}T00:00:00`)
  // Workaround: build a Date that represents PT midnight by guessing offset
  // and correcting. Cheap approach: use a known "anchor" date and look up its TZ offset.
  const utcEarlyAm = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))  // noon UTC == 4-5am PT
  const ptString = utcEarlyAm.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false })
  const ptHour = Number(ptString)
  // ptHour at noon UTC == 4 (PDT) or 5 (PST). UTC offset = 12 - ptHour (negative)
  const ptOffsetHours = ptHour - 12  // -8 PST, -7 PDT
  const startUtc = new Date(Date.UTC(y, m - 1, d, -ptOffsetHours, 0, 0)).toISOString()
  const endUtc = new Date(Date.UTC(y, m - 1, d + 1, -ptOffsetHours, 0, 0)).toISOString()
  return [startUtc, endUtc]
}

// ---- HTML helpers ----
function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function htmlDecode(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')   // must come last so &amp;lt; → &lt; → <
}

function orange(text) {
  return `<p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:14pt;color:#f79646;font-weight:bold">${htmlEscape(text)}</span></p>`
}

// ---- Asana: open tasks (overdue last 14 days + due today). Caps at 12. ----
async function fetchOpenAsanaTasks(token, todayIso) {
  if (!token) return []
  const cutoffStart = new Date(`${todayIso}T00:00:00Z`)
  cutoffStart.setUTCDate(cutoffStart.getUTCDate() - 14)
  const fourteenAgo = cutoffStart.toISOString().slice(0, 10)
  const tomorrow = new Date(`${todayIso}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowIso = tomorrow.toISOString().slice(0, 10)

  // Use Asana's workspace search endpoint (premium-only): better filter granularity
  const params = new URLSearchParams({
    'assignee.any': ASANA_USER_GID,
    'completed': 'false',
    'due_on.after': fourteenAgo,
    'due_on.before': tomorrowIso,
    'sort_by': 'due_date',
    'sort_ascending': 'true',
    'limit': '12',
    'opt_fields': 'name,due_on,projects.name,permalink_url',
  })
  const url = `${ASANA_API}/workspaces/11332955552906/tasks/search?${params}`
  const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    log('warn', 'Asana tasks fetch failed', { status: r.status, json })
    return []
  }
  return json.data || []
}

// ---- MS365: today's calendar events ----
async function fetchTodayCalendar(mcp, todayIso) {
  const [startUtc, endUtc] = ptIsoToUtcWindow(todayIso)
  try {
    const r = await mcp.tool('get-calendar-view', {
      startDateTime: startUtc,
      endDateTime: endUtc,
      select: 'subject,start,end,location,attendees,onlineMeeting,bodyPreview',
      top: 50,
    })
    const events = r?.value || []
    events.sort((a, b) => {
      const at = a.start?.dateTime || ''
      const bt = b.start?.dateTime || ''
      return at < bt ? -1 : at > bt ? 1 : 0
    })
    return events
  } catch (e) {
    log('warn', 'calendar fetch failed', { err: e.message })
    return []
  }
}

// ---- OneNote: yesterday's daily note → unchecked to-dos ----
async function fetchYesterdayUncheckedTodos(mcp, yesterdayIso) {
  let pages
  try {
    pages = await mcp.tool('list-onenote-section-pages', {
      onenoteSectionId: WORK_SECTION_ID,
      filter: `startswith(title, '${yesterdayIso}')`,
      top: 5,
      select: 'id,title',
    })
  } catch (e) {
    log('warn', 'yesterday lookup failed', { err: e.message })
    return []
  }
  const items = pages?.value || []
  if (!items.length) return []
  // Pick the longest-titled match (likely the user's main daily note vs a meeting recap that also starts with date)
  items.sort((a, b) => (b.title || '').length - (a.title || '').length)
  const target = items.find((p) => /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(p.title || '')) || items[0]
  let html
  try {
    html = await mcp.tool('get-onenote-page-content', { onenotePageId: target.id })
  } catch (e) {
    log('warn', 'yesterday page content fetch failed', { err: e.message })
    return []
  }
  // The MCP tool wraps OneNote get-page-content as { message: "OK!", rawResponse: "<html...>" }.
  let text = ''
  if (typeof html === 'string') text = html
  else if (typeof html?.rawResponse === 'string') text = html.rawResponse
  else if (typeof html?.content === 'string') text = html.content
  else if (typeof html?.body === 'string') text = html.body
  else if (typeof html === 'object' && html !== null) {
    text = html.value || html.data || ''
  }
  if (!text) {
    log('warn', `yesterday page content unparseable; sample=${JSON.stringify(html).slice(0, 200)}`)
    return []
  }
  log('debug', `yesterday page content length: ${text.length}`)
  // Extract <p data-tag="to-do">…</p> (unchecked only — completed has data-tag="to-do:completed")
  const todos = []
  const re = /<p\b[^>]*\bdata-tag="to-do"(?!:completed)[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = re.exec(text)) !== null) {
    const inner = htmlDecode(m[1].replace(/<[^>]+>/g, '')).trim()
    if (inner) todos.push(inner)
  }
  log('info', `parsed ${todos.length} unchecked to-dos from yesterday's page "${target.title}"`)
  return todos.slice(0, 30)
}

// ---- Idempotence: today's page already exists? ----
async function findExistingTodayPage(mcp, todayIso) {
  try {
    const r = await mcp.tool('list-onenote-section-pages', {
      onenoteSectionId: WORK_SECTION_ID,
      filter: `startswith(title, '${todayIso}')`,
      top: 5,
      select: 'id,title,links',
    })
    const matches = (r?.value || []).filter((p) => {
      // Match the daily-note style: contains weekday name. Skip meeting-recap pages
      // titled like "2026-05-08 Some Client — Some Topic" (no weekday).
      const t = p.title || ''
      return /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(t)
    })
    return matches[0] || null
  } catch (e) {
    log('warn', 'idempotence check failed', { err: e.message })
    return null
  }
}

// ---- HTML page builder ----
function buildPageHtml({ todayIso, weekday, calendarEvents, asanaTasks, carriedTodos }) {
  const title = `${todayIso}  ${weekday}`
  const now = new Date().toISOString()

  // Carried-forward TO DO's
  let todosHtml = ''
  for (const t of carriedTodos) {
    todosHtml += `<p data-tag="to-do" style="margin-top:0pt;margin-bottom:0pt"><span style="font-family:Calibri;font-size:14pt">${htmlEscape(t)}</span></p>`
  }
  // Asana overdue/today bullets, marked as to-dos so user can check off as they go
  for (const t of asanaTasks) {
    const project = t.projects?.[0]?.name ? ` · ${t.projects[0].name}` : ''
    const due = t.due_on ? ` · due ${t.due_on}` : ''
    const link = t.permalink_url ? ` <a href="${htmlEscape(t.permalink_url)}">[Asana]</a>` : ''
    todosHtml += `<p data-tag="to-do" style="margin-top:0pt;margin-bottom:0pt"><span style="font-family:Calibri;font-size:14pt">${htmlEscape(t.name)}${htmlEscape(project)}${htmlEscape(due)}${link}</span></p>`
  }
  if (!todosHtml) todosHtml = `<p data-tag="to-do" style="margin-top:0pt;margin-bottom:0pt"><span style="font-family:Calibri;font-size:14pt">&nbsp;</span></p>`

  // Today's calendar — bullet list
  let calendarHtml = ''
  if (calendarEvents.length) {
    calendarHtml += '<ul>'
    for (const ev of calendarEvents) {
      const startTime = ev.start?.dateTime ? ptIsoFromUtc(ev.start.dateTime) : ''
      const endTime = ev.end?.dateTime ? ptIsoFromUtc(ev.end.dateTime) : ''
      const subject = htmlEscape(ev.subject || '(untitled)')
      const join = ev.onlineMeeting?.joinUrl
        ? ` <a href="${htmlEscape(ev.onlineMeeting.joinUrl)}">Join</a>`
        : ''
      const attendees = (ev.attendees || []).map((a) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean).slice(0, 6).join(', ')
      const attLine = attendees ? ` — <em>${htmlEscape(attendees)}</em>` : ''
      calendarHtml += `<li><strong>${startTime}–${endTime}</strong> ${subject}${join}${attLine}</li>`
    }
    calendarHtml += '</ul>'
  } else {
    calendarHtml = '<p><em>(no scheduled events today)</em></p>'
  }

  const body = [
    `<h1 style="font-size:16pt;color:#1e4e79;margin-top:0pt;margin-bottom:5.5pt">${htmlEscape(title)}</h1>`,
    `<p style="font-size:9pt;color:#666"><em>Auto-scaffolded by daily-journal on ${now.slice(0,10)}. Edit freely.</em></p>`,
    `<br />`,
    orange("To Do's"),
    `<br />`,
    todosHtml,
    `<br />`,
    orange("3 Positive Things from the Last Day:"),
    `<br />`,
    `<ol><li><br /></li><li><br /></li><li><br /></li></ol>`,
    `<br />`,
    orange('Priorities'),
    `<ol><li><span style="font-size:14pt">&nbsp;</span></li><li><span style="font-size:14pt">&nbsp;</span></li><li><span style="font-size:14pt">&nbsp;</span></li></ol>`,
    `<br />`,
    orange('Person I Thanked Today:'),
    `<br />`,
    `<ul><li><br /></li></ul>`,
    `<br />`,
    orange('Last Exercise?'),
    `<br />`,
    `<ul><li><br /></li></ul>`,
    `<br />`,
    `<table style="border:1px solid;border-collapse:collapse">
      <tr>
        <td style="border:1px solid"><span style="font-size:14pt;color:#f79646;font-weight:bold">Links:</span></td>
        <td style="border:1px solid"><br /></td>
      </tr>
      <tr>
        <td style="border:1px solid"><h3 style="font-size:14pt;color:#1f3763;margin-top:0pt;margin-bottom:0pt">Asana Tasks:</h3></td>
        <td style="border:1px solid"><h3 style="font-size:14pt;color:#1f3763;margin-top:0pt;margin-bottom:0pt"><a href="https://app.asana.com/0/${ASANA_USER_GID}/list">My Tasks</a></h3></td>
      </tr>
      <tr>
        <td style="border:1px solid"><h3 style="font-size:14pt;color:#1f3763;margin-top:0pt;margin-bottom:0pt">Scorecard:</h3></td>
        <td style="border:1px solid"><h3 style="font-size:14pt;color:#1f3763;margin-top:0pt;margin-bottom:0pt"><a href="https://hiiliteorg.sharepoint.com/:x:/s/Hiilite/EY9IT_tPhEZKsZqvVPH7y1oB4XRdI0adcBtKyUw_7M24CQ?e=qfyLIH">SharePoint</a></h3></td>
      </tr>
    </table>`,
    `<br />`,
    orange("WORK (start with reviewing the notes from yesterday to find tasks that still need to be scheduled, or moved forward to today):"),
    `<br />`,
    `<ul><li><span style="font-size:14pt">Time - Description</span></li></ul>`,
    `<br />`,
    orange("Today's Calendar:"),
    calendarHtml,
    `<br />`,
    orange('PERSONAL NOTES:'),
    `<br />`,
    `<p><br /></p><p><br /></p><p><br /></p>`,
    `<br />`,
    orange('Daily Schedule:'),
    `<br />`,
    `<ol>
      <li><span style="font-size:14pt">Start Everhour/Timer</span></li>
      <li><span style="font-size:14pt">Review your To Do List, <a href="https://hiiliteorg.sharepoint.com/:x:/s/Hiilite/EY9IT_tPhEZKsZqvVPH7y1oB4XRdI0adcBtKyUw_7M24CQ?e=qfyLIH">Rocks</a>, put hardest first, do those first, "Lick your toads"</span></li>
      <li><span style="font-size:14pt;font-style:italic">Write down 3 positive things from the last day</span></li>
      <li><span style="font-size:14pt;font-style:italic">Journal</span></li>
      <li><span style="font-size:14pt;font-style:italic">Exercise</span></li>
      <li><span style="font-size:14pt;font-style:italic">Write an email or text to thank someone</span></li>
    </ol>`,
  ].join('')

  return `<!DOCTYPE html><html lang="en-CA"><head><title>${htmlEscape(title)}</title><meta name="created" content="${now}" /></head><body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt"><div style="position:absolute;left:48px;top:120px;width:720px">${body}</div></body></html>`
}

// ---- main ----
export async function createDailyJournal({ date = null, dryRun = false } = {}) {
  const now = date ? new Date(`${date}T12:00:00Z`) : new Date()
  const today = ptDateParts(now)
  const yesterday = dayBeforeIso(today.iso)
  log('info', `creating daily journal for ${today.iso} (${today.weekday}); carrying forward from ${yesterday}`)

  const mcp = new McpStdio()
  const asanaToken = getAsanaToken()
  if (!asanaToken) log('warn', 'Asana token not in Keychain — Asana task carry-forward disabled')

  let result = { date: today.iso }
  try {
    await mcp.init()

    // Idempotence
    const existing = await findExistingTodayPage(mcp, today.iso)
    if (existing) {
      log('info', `daily note for ${today.iso} already exists, skipping`, { pageId: existing.id, title: existing.title })
      return { skipped: 'already_exists', pageId: existing.id, pageUrl: existing.links?.oneNoteWebUrl?.href, title: existing.title }
    }

    // Fetch all source data in parallel
    const [calendarEvents, asanaTasks, carriedTodos] = await Promise.all([
      fetchTodayCalendar(mcp, today.iso),
      fetchOpenAsanaTasks(asanaToken, today.iso),
      fetchYesterdayUncheckedTodos(mcp, yesterday),
    ])
    log('info', `sources: ${calendarEvents.length} cal events, ${asanaTasks.length} overdue Asana tasks, ${carriedTodos.length} carried OneNote todos`)

    const html = buildPageHtml({
      todayIso: today.iso,
      weekday: today.weekday,
      calendarEvents,
      asanaTasks,
      carriedTodos,
    })

    if (dryRun) {
      const previewPath = path.join(STORE_DIR, `daily-journal-preview-${today.iso}.html`)
      writeFileSync(previewPath, html)
      log('info', `[DRY-RUN] would create page; preview written to ${previewPath}`, { bytes: html.length })
      result.dryRun = true
      result.previewPath = previewPath
    } else {
      const created = await mcp.tool('create-onenote-section-page', {
        onenoteSectionId: WORK_SECTION_ID,
        body: { content: html },
      })
      result.pageId = created?.id
      result.pageUrl = created?.links?.oneNoteWebUrl?.href
      result.title = created?.title
      log('info', `daily journal created`, { title: result.title, pageId: result.pageId })
    }
    result.calendarEvents = calendarEvents.length
    result.asanaTasks = asanaTasks.length
    result.carriedTodos = carriedTodos.length
  } finally {
    mcp.close()
  }
  return result
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const dIdx = args.indexOf('--date')
  const date = dIdx >= 0 ? args[dIdx + 1] : null
  createDailyJournal({ date, dryRun })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
    .catch((e) => { log('error', 'fatal', { err: e.message, stack: e.stack }); process.exit(1) })
}
