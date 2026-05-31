#!/usr/bin/env node
// Microsoft Teams chats → motion.db / agent-session.db teams_messages
//
// Spawns @softeria/ms-365-mcp-server as a child process and ingests recent
// 1:1 Teams chat messages into agent-session.db so the heartbeat agent and
// ctrlm see them alongside iMessage + WhatsApp.
//
// Auth is delegated to ms-365-mcp-server's existing keychain token (same
// shared session as fyxer-ingest + calendar-sync). No separate login.
//
// Scope:
//   - 1:1 chats only (chatType == oneOnOne) — group chats excluded as noise
//   - Last 7 days
//   - Skips bot / system messages (no .from.user)
//   - HTML body stripped to plain text
//
// Idempotent: INSERT OR REPLACE keyed on (chat_id, message_id).
//
// Usage:
//   node teams-ingest.mjs              # last 7 days
//   node teams-ingest.mjs --days 30    # custom window
//   node teams-ingest.mjs --dry-run    # don't write to DB

import { spawn } from 'node:child_process'
import path from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'

const SINK_DB = path.join(homedir(), 'agent-session', 'store', 'agent-session.db')
const WINDOW_DAYS_DEFAULT = 30
const PER_CHAT_MSG_CAP = 50  // Graph API max for chat-messages is 50
// Skip noisy chat types — meeting chats are mostly automated join/leave messages
const SKIP_CHAT_TYPES = new Set(['meeting'])

class McpStdio {
  constructor() {
    // --org-mode enables Teams (Chat/ChatMessage), SharePoint, Files, etc.
    // The cached token must have been logged in with --org-mode at least once.
    this.proc = spawn('npx', ['-y', '@softeria/ms-365-mcp-server', '--org-mode'], {
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
      clientInfo: { name: 'teams-ingest', version: '1.0.0' },
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

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams_messages (
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      is_from_me INTEGER NOT NULL,
      contact_name TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (chat_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_teams_ts ON teams_messages(timestamp);
  `)
}

function pickChatLabel(chat, myUserId) {
  // For 1:1 chats: the partner is the chatMember whose userId != myUserId.
  // For group chats: use the topic (room name).
  // Fallback: 'unknown'.
  if (chat.chatType === 'oneOnOne' && chat.members?.length) {
    const partner = chat.members.find(m => m.userId && m.userId !== myUserId)
    if (partner?.displayName) return partner.displayName
  }
  if (chat.topic) return `[group] ${chat.topic}`
  // Unnamed group chat — list a few member names
  if (chat.chatType === 'group' && chat.members?.length) {
    const others = chat.members
      .filter(m => m.userId && m.userId !== myUserId)
      .map(m => m.displayName)
      .filter(Boolean)
      .slice(0, 3)
    if (others.length) return `[group] ${others.join(', ')}${chat.members.length > others.length + 1 ? '…' : ''}`
  }
  return '(unknown chat)'
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const daysIdx = args.indexOf('--days')
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : WINDOW_DAYS_DEFAULT
  const cutoffMs = Date.now() - days * 86400 * 1000
  const cutoffSec = Math.floor(cutoffMs / 1000)

  console.log(`[teams-ingest] window=${days}d cutoff=${new Date(cutoffMs).toISOString()}${dryRun ? ' (dry-run)' : ''}`)

  const mcp = new McpStdio()
  let exitCode = 0
  let total = 0
  let scannedChats = 0

  try {
    await mcp.init()

    const me = await mcp.tool('get-current-user', { select: 'id,displayName' })
    const myUserId = me?.id
    console.log(`[teams-ingest] me=${me?.displayName} (${myUserId})`)

    // List all chats (1:1 + group), members expanded so we can label them.
    // Skip 'meeting' chats — those are noisy auto-generated by Teams meetings.
    const chatsResp = await mcp.tool('list-chats', {
      expand: ['members'],
      top: 50,
    })
    const allChats = chatsResp?.value || []
    const chats = allChats.filter(c => !SKIP_CHAT_TYPES.has(c.chatType))
    console.log(`[teams-ingest] chats: ${chats.length} eligible (${allChats.length} total, ${allChats.length - chats.length} meeting-type skipped)`)

    let db
    let upsert
    if (!dryRun) {
      db = new Database(SINK_DB)
      db.pragma('journal_mode = WAL')
      ensureSchema(db)
      upsert = db.prepare(`
        INSERT INTO teams_messages (chat_id, message_id, timestamp, is_from_me, contact_name, content)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id, message_id) DO UPDATE SET
          timestamp = excluded.timestamp,
          is_from_me = excluded.is_from_me,
          contact_name = excluded.contact_name,
          content = excluded.content
      `)
    }

    for (const chat of chats) {
      // Note: chat.lastUpdatedDateTime tracks chat metadata changes, not necessarily
      // the latest message. Don't use it to skip — check messages directly.
      scannedChats++
      const partnerName = pickChatLabel(chat, myUserId)
      try {
        // Graph /chats/{id}/messages doesn't allow $select or $orderby — keep params minimal.
        const msgsResp = await mcp.tool('list-chat-messages', {
          chatId: chat.id,
          top: PER_CHAT_MSG_CAP,
        })
        const msgs = msgsResp?.value || []

        let inserted = 0
        for (const m of msgs) {
          if (!m.createdDateTime) continue
          const createdMs = new Date(m.createdDateTime).getTime()
          if (createdMs < cutoffMs) continue
          // Skip system / non-message types
          if (m.messageType && m.messageType !== 'message') continue
          // Skip bot/connector/no-user messages
          const fromUserId = m.from?.user?.id
          if (!fromUserId) continue
          const text = stripHtml(m.body?.content || '')
          if (!text) continue
          const isFromMe = fromUserId === myUserId ? 1 : 0
          const ts = Math.floor(createdMs / 1000)

          if (!dryRun) {
            upsert.run(chat.id, m.id, ts, isFromMe, partnerName, text)
          }
          inserted++
          total++
        }
        if (inserted > 0) {
          console.log(`[teams-ingest] ${partnerName}: ${inserted} msgs`)
        }
      } catch (e) {
        console.error(`[teams-ingest] chat ${chat.id} (${partnerName}) failed: ${e.message}`)
      }
    }

    if (!dryRun && db) {
      // Record run for diagnostics (matches imsg-wa-ingest pattern)
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS ingest_runs (
          source TEXT NOT NULL, run_at INTEGER NOT NULL,
          inserted INTEGER NOT NULL, window_start INTEGER NOT NULL
        )`)
        db.prepare('INSERT INTO ingest_runs (source, run_at, inserted, window_start) VALUES (?, ?, ?, ?)')
          .run('teams', Math.floor(Date.now() / 1000), total, cutoffSec)
      } catch {}
      db.close()
    }

    console.log(`[teams-ingest] done. scanned=${scannedChats}/${chats.length} upserted=${total}`)
  } catch (e) {
    console.error(`[teams-ingest] fatal: ${e.message}`)
    exitCode = 1
  } finally {
    mcp.close()
  }
  process.exit(exitCode)
}

main()
