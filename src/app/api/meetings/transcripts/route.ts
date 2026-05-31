import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

interface LocalTranscript {
  id: number
  title: string
  summary: string | null
  created_at: string
  recorded_at: string
  processed_at: string | null
  doc_id: number | null
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Transcripts belong to the owner's integration -- only show to owner
  if (user.role !== 'owner') return NextResponse.json([])
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 50
  const search = request.nextUrl.searchParams.get('search') || ''

  const db = getDb()

  // Read transcripts from local SQLite (was previously Supabase plaud_transcripts).
  // Fyxer-ingest, generic webhook, Zoom, and IMAP all write here.
  let transcripts: LocalTranscript[]
  if (search) {
    const term = `%${search}%`
    transcripts = db.prepare(
      `SELECT id, title, summary, created_at, recorded_at, processed_at, doc_id
       FROM transcripts
       WHERE title LIKE ? OR summary LIKE ?
       ORDER BY recorded_at DESC
       LIMIT ?`
    ).all(term, term, limit) as LocalTranscript[]
  } else {
    transcripts = db.prepare(
      `SELECT id, title, summary, created_at, recorded_at, processed_at, doc_id
       FROM transcripts
       ORDER BY recorded_at DESC
       LIMIT ?`
    ).all(limit) as LocalTranscript[]
  }

  const meetingDocs = db.prepare(
    "SELECT id, title, content, business_id, client_id FROM docs WHERE doc_type = 'meeting-note' ORDER BY id DESC"
  ).all() as { id: number; title: string; content: string; business_id: number | null; client_id: number | null }[]

  // Load business names
  const bizRows = db.prepare('SELECT id, name FROM client_businesses').all() as { id: number; name: string }[]
  const bizNameMap: Record<number, string> = {}
  for (const b of bizRows) bizNameMap[b.id] = b.name

  // Build doc metadata lookup by title (single pass)
  const docMetaByTitle: Record<string, { id: number; client: string | null; business: string | null; attendees: string[]; host: string | null; actionCount: number }> = {}
  for (const doc of meetingDocs) {
    try {
      const blocks = JSON.parse(doc.content || '[]')
      let client: string | null = null
      let business: string | null = doc.business_id ? bizNameMap[doc.business_id] || null : null
      let attendees: string[] = []
      let host: string | null = null
      let actionCount = 0

      for (const b of blocks) {
        if (b.type === 'paragraph' && b.content?.startsWith('Client: ')) {
          const clientText = b.content.replace('Client: ', '')
          // Handle "Client: Name / Business" format
          if (clientText.includes(' / ')) {
            const parts = clientText.split(' / ')
            client = parts[0].trim()
            if (!business) business = parts[1]?.trim() || null
          } else {
            client = clientText
          }
        }
        if (b.type === 'paragraph' && b.content?.startsWith('Attendees: ')) {
          attendees = b.content.replace('Attendees: ', '').split(',').map((a: string) => a.trim()).filter(Boolean)
          if (attendees.length > 0) host = attendees[0]
        }
        if (b.type === 'check_list' || b.type === 'checklist') actionCount++
      }

      docMetaByTitle[doc.title] = { id: doc.id, client, business, attendees, host, actionCount }
    } catch {
      docMetaByTitle[doc.title] = { id: doc.id, client: null, business: null, attendees: [], host: null, actionCount: 0 }
    }
  }

  // Build avatar photo map from users + team members
  const userPhotos = db.prepare('SELECT name, avatar_url FROM users WHERE avatar_url IS NOT NULL').all() as { name: string; avatar_url: string }[]
  const teamPhotos = db.prepare('SELECT name, avatar FROM team_members WHERE avatar IS NOT NULL').all() as { name: string; avatar: string }[]
  const avatarMap: Record<string, string> = {}
  for (const u of userPhotos) {
    avatarMap[u.name] = u.avatar_url
    const first = u.name.split(' ')[0]
    if (first) avatarMap[first] = u.avatar_url
  }
  for (const tm of teamPhotos) {
    if (!avatarMap[tm.name]) avatarMap[tm.name] = tm.avatar
    const first = tm.name.split(' ')[0]
    if (first && !avatarMap[first]) avatarMap[first] = tm.avatar
  }

  const meetingTasks = db.prepare(`
    SELECT id, title, description, status, priority, due_date, duration_minutes, assignee, project_id, auto_schedule, scheduled_start, workspace_id
    FROM tasks
    WHERE description LIKE '%_From meeting:%'
    ORDER BY id DESC
  `).all() as { id: number; title: string; description: string | null; status: string; priority: string; due_date: string | null; duration_minutes: number; assignee: string | null; project_id: number | null; auto_schedule: number; scheduled_start: string | null; workspace_id: number | null }[]

  // Group tasks by meeting title
  const tasksByMeeting: Record<string, typeof meetingTasks> = {}
  for (const task of meetingTasks) {
    const match = task.description?.match(/_From meeting: (.+?)_/)
    if (match) {
      const mtitle = match[1]
      if (!tasksByMeeting[mtitle]) tasksByMeeting[mtitle] = []
      tasksByMeeting[mtitle].push(task)
    }
  }

  // Load project names for task metadata
  const projectRows = db.prepare('SELECT id, name FROM projects').all() as { id: number; name: string }[]
  const projectNameMap: Record<number, string> = {}
  for (const p of projectRows) projectNameMap[p.id] = p.name

  // Build a doc-id lookup so we can resolve meta when transcripts.doc_id is set
  // but the title-based match misses (timezone drift on the date suffix, etc).
  const docMetaById: Record<number, (typeof docMetaByTitle)[string]> = {}
  for (const key of Object.keys(docMetaByTitle)) {
    const m = docMetaByTitle[key]
    docMetaById[m.id] = m
  }

  // Return without full transcript text (too large for list view)
  const result = transcripts.map(t => {
    const docTitle = t.title || 'Meeting Note'
    // Find matching doc (title with date suffix)
    const dayStr = new Date(t.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const fullTitle = `${docTitle} (${dayStr})`

    const meta =
      docMetaByTitle[fullTitle] ||
      docMetaByTitle[docTitle] ||
      (t.doc_id ? docMetaById[t.doc_id] : null) ||
      null
    const linkedTasks = (tasksByMeeting[docTitle] || []).map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date,
      duration_minutes: task.duration_minutes,
      assignee: task.assignee,
      project_name: task.project_id ? projectNameMap[task.project_id] || null : null,
      project_id: task.project_id,
      auto_schedule: !!task.auto_schedule,
      scheduled_start: task.scheduled_start,
      workspace_id: task.workspace_id,
    }))

    return {
      id: t.id,
      title: t.title,
      summary: t.summary,
      recorded_at: t.recorded_at,
      created_at: t.created_at,
      processed: !!t.processed_at,
      processed_at: t.processed_at,
      action_item_count: linkedTasks.length || meta?.actionCount || 0,
      doc_id: meta?.id || t.doc_id || null,
      client_name: meta?.client || null,
      business_name: meta?.business || null,
      attendees: meta?.attendees || [],
      host: meta?.host || null,
      tasks: linkedTasks,
    }
  })

  return NextResponse.json({ transcripts: result, avatarMap })
}
