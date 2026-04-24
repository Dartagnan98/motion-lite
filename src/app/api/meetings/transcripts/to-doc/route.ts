import { NextRequest, NextResponse } from 'next/server'
import { createDoc, updateDoc, getDocs, ensurePrivateWorkspaceForUser, ensureFolder } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

// Parse markdown summary into structured blocks
function parseSummaryToBlocks(summary: string): { id: string; type: string; content: string; checked?: boolean }[] {
  if (!summary) return [{ id: generateId(), type: 'paragraph', content: 'No summary available.' }]

  const blocks: { id: string; type: string; content: string; checked?: boolean }[] = []
  const lines = summary.split('\n')

  let inTable = false
  let tableRows: string[][] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      inTable = false
      continue
    }

    // Skip horizontal rules
    if (/^-{3,}$/.test(trimmed)) continue

    // Heading 1: # Title
    if (/^# /.test(trimmed)) {
      inTable = false
      blocks.push({ id: generateId(), type: 'heading1', content: trimmed.replace(/^# /, '') })
      continue
    }

    // Heading 2: ## Section
    if (/^## /.test(trimmed)) {
      inTable = false
      blocks.push({ id: generateId(), type: 'heading2', content: trimmed.replace(/^## /, '') })
      continue
    }

    // Heading 3: ### Subsection
    if (/^### /.test(trimmed)) {
      inTable = false
      blocks.push({ id: generateId(), type: 'heading3', content: trimmed.replace(/^### /, '') })
      continue
    }

    // Table header row (contains |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Skip separator rows like |---|---|
      if (/^\|[\s-|]+\|$/.test(trimmed)) continue

      // Parse table row
      const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim())

      // If this looks like a header row (bold cells with **), skip it as we'll use the content rows
      if (cells.every(c => /^\*\*.*\*\*$/.test(c))) continue

      // Convert table rows to checklist items (for action item tables)
      // Format: Task | Responsible | Deadline | Notes
      if (cells.length >= 2) {
        const task = cells[0].replace(/^\*\*|\*\*$/g, '')
        const responsible = cells.length > 1 ? cells[1].replace(/^\*\*|\*\*$/g, '') : ''
        const deadline = cells.length > 2 ? cells[2].replace(/^\*\*|\*\*$/g, '') : ''

        if (task && task !== 'Task' && task !== '**Task**') {
          let content = task
          if (responsible && responsible !== 'Not specified') content += ` -- ${responsible}`
          if (deadline && deadline !== 'Not specified') content += ` (${deadline})`
          blocks.push({ id: generateId(), type: 'checklist', content, checked: false })
        }
      }
      continue
    }

    // Bullet point: - Item or * Item or • Item
    if (/^[-*•]\s/.test(trimmed)) {
      const content = trimmed.replace(/^[-*•]\s+/, '')

      // Bold prefix like **Decision**: description
      const boldMatch = content.match(/^\*\*(.*?)\*\*[:\s]*(.*)/)
      if (boldMatch) {
        blocks.push({ id: generateId(), type: 'list', content: `${boldMatch[1]}: ${boldMatch[2]}` })
      } else {
        blocks.push({ id: generateId(), type: 'list', content })
      }
      continue
    }

    // Bold standalone line: **Something**
    if (/^\*\*.*\*\*[:\s]*$/.test(trimmed)) {
      blocks.push({ id: generateId(), type: 'heading3', content: trimmed.replace(/\*\*/g, '').replace(/:$/, '') })
      continue
    }

    // Regular paragraph
    blocks.push({ id: generateId(), type: 'paragraph', content: trimmed })
  }

  return blocks
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'owner') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { transcriptId } = await request.json()

  if (!transcriptId) {
    return NextResponse.json({ error: 'transcriptId required' }, { status: 400 })
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  // Fetch the transcript from Supabase
  const res = await fetch(`${SUPABASE_URL}/rest/v1/plaud_transcripts?id=eq.${transcriptId}&limit=1`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 })
  }

  const rows = await res.json()
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
  }

  const transcript = rows[0]

  // Ensure Meeting Notes folder hierarchy in Private workspace
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const privateWs = ensurePrivateWorkspaceForUser(user.id)
  const recordedDate = new Date(transcript.recorded_at)
  const meetingNotesFolder = ensureFolder(privateWs.id, 'Meeting Notes')
  const yearFolder = ensureFolder(privateWs.id, recordedDate.getFullYear().toString(), meetingNotesFolder.id)
  const monthFolder = ensureFolder(privateWs.id, MONTHS[recordedDate.getMonth()], yearFolder.id)

  const d = new Date(transcript.recorded_at)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  // Format title with date suffix
  const dayStr = recordedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const rawTitle = transcript.title || 'Meeting Note'
  const noteTitle = `${rawTitle} (${dayStr})`

  // Check if a doc already exists for this transcript (avoid duplicates)
  // Match against both the full title (with date suffix) and raw title
  const existingDocs = getDocs({ workspaceId: privateWs.id })
  const existingDoc = existingDocs.find(d =>
    d.doc_type === 'meeting-note' && (d.title === noteTitle || d.title === rawTitle)
  )
  if (existingDoc) {
    return NextResponse.json({ docId: existingDoc.id, title: existingDoc.title, existing: true })
  }

  // 1. Create parent doc (meeting note: parsed summary) in the correct folder
  const parentDoc = createDoc({
    title: noteTitle,
    workspaceId: privateWs.id,
    folderId: monthFolder.id,
    docType: 'meeting-note',
  })

  // 2. Create child doc (full transcript as sub-page)
  const transcriptDoc = createDoc({
    title: `Transcript - ${transcript.title || 'Recording'}`,
    workspaceId: privateWs.id,
    folderId: monthFolder.id,
    parentDocId: parentDoc.id,
    docType: 'transcript',
  })

  // Build transcript child doc content
  const transcriptBlocks: { id: string; type: string; content: string }[] = []
  transcriptBlocks.push({ id: generateId(), type: 'heading1', content: 'Full Transcript' })
  transcriptBlocks.push({ id: generateId(), type: 'paragraph', content: `Recorded: ${dateStr}` })

  const paragraphs = (transcript.transcript || 'No transcript available.').split('\n\n').filter(Boolean)
  for (const p of paragraphs.slice(0, 100)) {
    transcriptBlocks.push({ id: generateId(), type: 'paragraph', content: p.trim() })
  }

  updateDoc(transcriptDoc.id, { content: JSON.stringify(transcriptBlocks) })

  // Build parent doc from parsed summary
  const parentBlocks: { id: string; type: string; content: string; checked?: boolean; docId?: number }[] = []

  // Meeting info header
  parentBlocks.push({ id: generateId(), type: 'paragraph', content: `Recorded: ${dateStr}` })
  parentBlocks.push({ id: generateId(), type: 'divider', content: '' })

  // Parse and add the summary blocks
  const summaryBlocks = parseSummaryToBlocks(transcript.summary)
  parentBlocks.push(...summaryBlocks)

  // Divider before transcript link
  parentBlocks.push({ id: generateId(), type: 'divider', content: '' })

  // Link to transcript sub-page
  parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Full Transcript' })
  parentBlocks.push({
    id: generateId(),
    type: 'page-link',
    content: `Transcript - ${transcript.title || 'Recording'}`,
    docId: transcriptDoc.id,
  })

  updateDoc(parentDoc.id, { content: JSON.stringify(parentBlocks) })

  return NextResponse.json({
    docId: parentDoc.id,
    transcriptDocId: transcriptDoc.id,
    title: parentDoc.title,
  })
}
