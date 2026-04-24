/**
 * Link checklist blocks in meeting docs to their actual tasks.
 * Matches by task title == checklist block content (case-insensitive, HTML-stripped).
 * Run: npx tsx scripts/link-meeting-tasks.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '..', '.env.local') })

import Database from 'better-sqlite3'

const DB_PATH = resolve(__dirname, '..', '..', 'store', 'motion.db')
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

interface TaskRow {
  id: number
  title: string
  description: string | null
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

// Get all meeting-linked tasks
const tasks = db.prepare(`
  SELECT id, title, description FROM tasks
  WHERE description LIKE '%_From meeting:%'
`).all() as TaskRow[]

// Build lowercase title -> taskId map per meeting
const taskMap: Record<string, Record<string, number>> = {}
for (const t of tasks) {
  const match = t.description?.match(/_From meeting: (.+?)_/)
  if (match) {
    const meetingTitle = match[1]
    if (!taskMap[meetingTitle]) taskMap[meetingTitle] = {}
    taskMap[meetingTitle][t.title.toLowerCase()] = t.id
  }
}

console.log(`Found tasks for ${Object.keys(taskMap).length} meetings`)

// Get all meeting-note docs
const docs = db.prepare(`
  SELECT id, title, content FROM docs WHERE doc_type = 'meeting-note' AND content IS NOT NULL
`).all() as { id: number; title: string; content: string }[]

let updated = 0
let linked = 0

for (const doc of docs) {
  try {
    const blocks = JSON.parse(doc.content)
    if (!Array.isArray(blocks)) continue

    // Extract the raw meeting title from doc title (remove date suffix like "(Mar 30)")
    const rawTitle = doc.title.replace(/\s*\([^)]+\)\s*$/, '')
    const tasksForMeeting = taskMap[rawTitle] || {}

    let changed = false
    for (const block of blocks) {
      if ((block.type === 'checklist' || block.type === 'check_list') && !block.taskId) {
        const text = stripHtml(block.content || '').toLowerCase()
        const taskId = tasksForMeeting[text]
        if (taskId) {
          block.taskId = taskId
          changed = true
          linked++
        }
      }
    }

    if (changed) {
      db.prepare('UPDATE docs SET content = ? WHERE id = ?').run(JSON.stringify(blocks), doc.id)
      updated++
    }
  } catch {
    // Skip docs with invalid JSON
  }
}

console.log(`Updated ${updated} docs, linked ${linked} checklist blocks to tasks`)
db.close()
