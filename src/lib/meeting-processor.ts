/**
 * AI Meeting Processor
 * Automatically processes Plaud transcripts via OpenRouter:
 * - Cleans up raw transcription
 * - Identifies which client the meeting is about
 * - Extracts action items as structured tasks
 * - Creates doc in the right folder
 * - Creates tasks in Motion Lite
 */

import { getApiKey } from './agent-runtime'
import { detectProvider } from './llm-provider'
import { getSetting } from './settings'
import {
  getClientProfiles,
  getClientBusinesses,
  getClientByName,
  createDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  ensurePrivateWorkspaceForUser,
  ensureFolder,
  createTask,
  getProjects,
  getProject,
  getPrimaryWorkspace,
  getTeamMembers,
  getDb,
  startMeetingProcessingEvent,
  completeMeetingProcessingEvent,
  failMeetingProcessingEvent,
} from './db'
import { DEFAULT_TASK_VALUES } from './task-constants'
import { triggerRescheduleServer } from './schedule-trigger'
import { autoDispatchMeeting } from './meeting-dispatch'

// ─── Helpers ───

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Types ───

interface PlaudTranscript {
  id: number
  title: string
  summary: string
  transcript: string
  created_at: string
  recorded_at: string
}

interface ExtractedTask {
  title: string
  description: string
  client: string | null
  businessName: string | null
  priority: 'low' | 'medium' | 'high'
  assignee: string | null
  duration_minutes: number
}

interface NoteSection {
  heading: string
  bullets: string[]
}

interface ProcessingResult {
  cleanedTranscript: string
  summary: string
  notes: NoteSection[]
  clientName: string | null
  clientId: number | null
  businessName: string | null
  tasks: ExtractedTask[]
  attendees: string[]
}

// ─── System Prompt ───

interface BusinessInfo {
  name: string
  keywords: string | null
}

interface ClientInfo {
  name: string
  businesses: BusinessInfo[]
  industry: string | null
  context: string | null
}

function buildClientDirectory(): ClientInfo[] {
  const clients = getClientProfiles()
  const bizKeywords = getSetting<Record<string, string>>('meetingBusinessKeywords') || {}
  return clients.map(c => {
    const businesses = getClientBusinesses(c.id)
    return {
      name: c.name,
      businesses: businesses.map(b => ({
        name: b.name,
        keywords: bizKeywords[`${c.name}::${b.name}`] || null,
      })),
      industry: c.industry || null,
      context: c.context || null,
    }
  })
}

function buildSystemPrompt(): string {
  const taskScope = getSetting<string>('meetingTaskScope') || 'Marketing & Meta Ads, Funnels & Landing Pages, Technology & Automation, Content Creation & Videography, Client Management & Communication'
  const clientDir = buildClientDirectory()
  const clientKeywords = getSetting<Record<string, string>>('meetingClientKeywords') || {}

  const clientBlock = clientDir.map(c => {
    const parts = [`- ${c.name}`]
    if (c.businesses.length > 0) {
      parts.push(`  Businesses:`)
      for (const biz of c.businesses) {
        const bizLine = biz.keywords ? `    - ${biz.name} (keywords: ${biz.keywords})` : `    - ${biz.name}`
        parts.push(bizLine)
      }
    }
    if (c.industry) parts.push(`  Industry: ${c.industry}`)
    if (c.context) parts.push(`  Context: ${c.context}`)
    const kw = clientKeywords[c.name]
    if (kw) parts.push(`  Keywords: ${kw}`)
    return parts.join('\n')
  }).join('\n')

  // Add manual-only keyword entries (names not in client profiles)
  const profileNames = new Set(clientDir.map(c => c.name))
  const manualEntries = Object.entries(clientKeywords)
    .filter(([name]) => !profileNames.has(name))
    .map(([name, kw]) => `- ${name}\n  Keywords: ${kw}`)
    .join('\n')

  const fullClientBlock = [clientBlock, manualEntries].filter(Boolean).join('\n')

  return `You process meeting transcripts for Operator, founder of Example Co (a Meta ads agency serving local businesses).

SPEAKER IDENTIFICATION:
- Operator is always one of the speakers, but speaker numbers do NOT indicate who is who. Speaker 1 could be anyone.
- Figure out who is who from CONTEXT: what they say, what they know, what they're asking about. Operator talks about marketing, Meta ads, funnels, automation, and client work. Clients talk about their own business operations.
- Use names when people say them. If the meeting title or summary mentions a client, that client is likely one of the speakers.
- Replace ALL generic speaker labels ("Speaker 1", "Speaker 2") with real names based on context. If you truly cannot determine a speaker's name, use their role (e.g. "Client", "Team Member", "Consultant").
- Never leave "Speaker 1" or "Speaker 2" in the output.

Your job:
1. CLEAN the transcript -- fix speech-to-text errors, speaker attribution, grammar. Keep the meaning intact. Remove filler words, false starts, and repetition. Format as clear paragraphs with real speaker names (see above).
2. IDENTIFY the client -- based on names, business references, and context. Match against the client directory below. CRITICAL: a KEYWORD SIGNAL SCAN is pre-computed at the top of the user message showing how many of each client's keywords appear in the transcript. A client with a clear lead in keyword hits is almost always the correct answer -- only override the scan if the transcript explicitly makes clear it's about someone else. If no client match, set client to null.
3. IDENTIFY the business -- if a client is identified, determine which specific business the meeting is primarily about. Use the business names, keywords from the client directory, AND the per-business hit counts in the KEYWORD SIGNAL SCAN. If the meeting discusses multiple businesses, set the primary one at the top level and assign each task to its specific business.
4. EXTRACT action items -- only tasks within scope. Each task needs a clear title, description, assignee, business, and time estimate.
5. LIST attendees -- by real name, not speaker numbers. Include Operator plus whoever else is in the meeting.
6. WRITE a summary -- 3-5 bullet points covering the key decisions, updates, and outcomes.
7. WRITE detailed notes -- this is the MOST IMPORTANT section and should be the longest part of your output. Organize the entire meeting chronologically by topic in order of discussion. For each topic section:
   - Use a clear heading describing the topic
   - Write 5-15+ bullet points per section capturing EVERYTHING discussed: specific numbers, dollar amounts, dates, deadlines, names mentioned, strategies proposed, reasoning behind decisions, concerns raised, agreements reached, context shared
   - Include key decisions made and who made them
   - Include timelines discussed (e.g. "Client A said the gym launch is targeted for April 15")
   - Include any commitments or promises made by any party
   - Include disagreements or open questions that weren't resolved
   - Capture the FULL narrative of what transpired -- someone reading these notes should understand exactly what happened in the meeting without needing the transcript
   - Do NOT summarize or abbreviate -- be exhaustive. This is a reference document people will come back to months later
   - Write at least 3-5 topic sections per meeting, more for longer meetings

TASK ASSIGNMENT:
- Assign all tasks to "Operator" unless the task is clearly for someone else mentioned in the meeting by name.
- If a task belongs to someone who is NOT a team member (e.g. a client), leave assignee as null (unassigned).
- Do NOT assign tasks to AI agents. Only assign to real people mentioned in the meeting.
- Set duration_minutes based on complexity: quick tasks 15, standard tasks 30, medium tasks 60, large tasks 120-240.

TASK SCOPE (only extract tasks in these categories):
${taskScope}

CLIENT DIRECTORY:
${fullClientBlock || 'No clients configured yet.'}

Return ONLY valid JSON with this exact structure:
{
  "cleanedTranscript": "Speaker-labeled cleaned transcript...",
  "summary": "- Key point 1\\n- Key point 2\\n- Key point 3",
  "notes": [
    {
      "heading": "Topic Name",
      "bullets": ["Detail about this topic", "Another important point with specific numbers/dates"]
    }
  ],
  "clientName": "Client Name or null",
  "businessName": "Primary Business Name or null",
  "attendees": ["Person 1", "Person 2"],
  "tasks": [
    {
      "title": "Short task title",
      "description": "What needs to be done and why",
      "client": "Client Name or null",
      "businessName": "Business Name this task belongs to, or null",
      "priority": "low|medium|high",
      "assignee": "Operator",
      "duration_minutes": 30
    }
  ]
}

If there are no action items, return an empty tasks array. Never invent tasks that aren't in the transcript.`
}

// ─── Keyword Signal Scan ───
// Pre-scan the transcript for client/business keyword hits so the LLM
// doesn't have to re-derive the match from scratch every call. Word-boundary
// counts per client, ranked. Feeds into the user message and into the
// post-LLM fallback safety net.

interface KeywordHitScore {
  name: string
  hits: number
  matched: string[]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function scanKeywordHits(text: string, keywordMap: Record<string, string>): KeywordHitScore[] {
  if (!text || !keywordMap) return []
  const textLower = text.toLowerCase()
  const results: KeywordHitScore[] = []

  for (const [name, kwString] of Object.entries(keywordMap)) {
    if (!kwString) continue
    const seen = new Set<string>()
    const keywords = kwString
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length >= 2 && !seen.has(k) && (seen.add(k) || true))

    let hits = 0
    const matched: string[] = []
    for (const kw of keywords) {
      // Word-boundary match for normal words, substring match for multi-word phrases
      const hasSpace = /\s/.test(kw)
      const pattern = hasSpace
        ? new RegExp(escapeRegex(kw), 'gi')
        : new RegExp(`\\b${escapeRegex(kw)}\\b`, 'gi')
      const found = textLower.match(pattern)
      if (found && found.length > 0) {
        hits += found.length
        matched.push(kw)
      }
    }
    if (hits > 0) {
      results.push({ name, hits, matched })
    }
  }

  return results.sort((a, b) => b.hits - a.hits)
}

function buildKeywordSignalBlock(title: string, summary: string | null, transcript: string | null): string {
  const clientKeywords = getSetting<Record<string, string>>('meetingClientKeywords') || {}
  const bizKeywords = getSetting<Record<string, string>>('meetingBusinessKeywords') || {}
  const scanText = `${title || ''}\n${summary || ''}\n${transcript || ''}`

  const clientHits = scanKeywordHits(scanText, clientKeywords).slice(0, 4)
  const bizHits = scanKeywordHits(scanText, bizKeywords).slice(0, 4)

  if (clientHits.length === 0 && bizHits.length === 0) {
    return 'KEYWORD SIGNAL SCAN: no matches found (use transcript context only)'
  }

  const parts = ['KEYWORD SIGNAL SCAN (pre-computed hits from the transcript + summary + title; use these heavily to pick client/business):']
  if (clientHits.length > 0) {
    parts.push('Client matches (by hit count):')
    for (const h of clientHits) {
      parts.push(`  - ${h.name}: ${h.hits} hits [${h.matched.slice(0, 8).join(', ')}]`)
    }
  }
  if (bizHits.length > 0) {
    parts.push('Business matches (by hit count):')
    for (const h of bizHits) {
      parts.push(`  - ${h.name}: ${h.hits} hits [${h.matched.slice(0, 8).join(', ')}]`)
    }
  }
  return parts.join('\n')
}

// Safety net: if the LLM returns null for clientName but there's a clear
// keyword winner, override. "Clear winner" = >=5 hits AND at least 2x the
// runner-up (or no runner-up at all).
function applyKeywordFallback(
  result: ProcessingResult,
  title: string,
  summary: string | null,
  transcript: string | null,
): void {
  if (result.clientName) return // LLM already picked someone -- trust it

  const clientKeywords = getSetting<Record<string, string>>('meetingClientKeywords') || {}
  const hits = scanKeywordHits(`${title || ''}\n${summary || ''}\n${transcript || ''}`, clientKeywords)
  if (hits.length === 0) return

  const top = hits[0]
  const runner = hits[1]
  const dominant = top.hits >= 5 && (!runner || top.hits >= runner.hits * 2)
  if (!dominant) return

  // Personal keywords shouldn't map to a real client profile; skip if top is Personal/unknown
  if (/^personal$/i.test(top.name)) return

  console.log(`[meeting-processor] Keyword fallback: LLM picked null, overriding to "${top.name}" (${top.hits} hits, runner-up=${runner?.hits || 0})`)
  result.clientName = top.name
}

// ─── LLM Call ───

async function callLLM(systemPrompt: string, userMessage: string): Promise<ProcessingResult | null> {
  let keyConfig = getApiKey(1)
  // Fallback to env vars if no DB key
  if (!keyConfig) {
    const envKey = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY
    if (envKey) {
      keyConfig = { apiKey: envKey, model: 'claude-sonnet-4-6', dailyBudgetCents: 5000, spentTodayCents: 0, provider: envKey.startsWith('sk-ant') ? 'anthropic' : 'openrouter' } as any
    }
  }
  if (!keyConfig) {
    console.error('[meeting-processor] No API key configured (checked DB and env vars)')
    return null
  }

  const selectedModel = getSetting<string>('meetingModel') || 'anthropic/claude-sonnet-4-6'
  const keyProvider = detectProvider(keyConfig.apiKey)
  // Use Anthropic direct only if key is Anthropic AND selected model is Anthropic
  const isAnthropicModel = selectedModel.startsWith('anthropic/') || (!selectedModel.includes('/') && selectedModel.startsWith('claude'))
  const useAnthropicDirect = keyProvider === 'anthropic' && isAnthropicModel

  try {
    let text: string | null = null

    if (useAnthropicDirect) {
      const anthropicModel = selectedModel.replace('anthropic/', '')
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': keyConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 16384,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })
      if (!res.ok) {
        console.error('[meeting-processor] Anthropic error:', await res.text())
        return null
      }
      const data = await res.json()
      text = data?.content?.[0]?.text
    } else {
      // OpenRouter handles all providers
      const apiKey = keyConfig.apiKey
      // If key is Anthropic but model is non-Anthropic, we need an OpenRouter key
      if (keyProvider === 'anthropic' && !isAnthropicModel) {
        const orKey = process.env.OPENROUTER_API_KEY
        if (!orKey) {
          console.error('[meeting-processor] Selected non-Anthropic model but no OpenRouter key available')
          return null
        }
      }
      const routerKey = keyProvider === 'openrouter' ? apiKey : (process.env.OPENROUTER_API_KEY || apiKey)
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${routerKey}`,
          'HTTP-Referer': 'https://app.example.com',
          'X-Title': 'Motion Lite',
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 16384,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
        }),
      })
      if (!res.ok) {
        console.error('[meeting-processor] OpenRouter error:', await res.text())
        return null
      }
      const data = await res.json()
      text = data?.choices?.[0]?.message?.content
    }

    if (!text) return null

    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      cleanedTranscript: parsed.cleanedTranscript || '',
      summary: parsed.summary || '',
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      clientName: parsed.clientName || null,
      clientId: null, // resolved below
      businessName: parsed.businessName || null,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      attendees: Array.isArray(parsed.attendees) ? parsed.attendees : [],
    }
  } catch (err) {
    console.error('[meeting-processor] LLM call failed:', err)
    return null
  }
}

// ─── Assignee Resolution ───

function resolveAssigneeId(assigneeName: string | null): string | null {
  const members = getTeamMembers()
  if (!assigneeName) {
    // Default to first human member (owner)
    const owner = members.find(m => m.type === 'human')
    return owner?.public_id || null
  }
  const nameLower = assigneeName.toLowerCase()
  // Try exact name match first
  const exact = members.find(m => m.name.toLowerCase() === nameLower)
  if (exact) return exact.public_id || null
  // Try first name match
  const firstNameMatch = members.find(m => m.name.split(' ')[0].toLowerCase() === nameLower)
  if (firstNameMatch) return firstNameMatch.public_id || null
  // Try fuzzy contains
  const fuzzy = members.find(m => m.name.toLowerCase().includes(nameLower) || nameLower.includes(m.name.toLowerCase()))
  if (fuzzy) return fuzzy.public_id || null
  // Unknown assignee - default to owner
  const owner = members.find(m => m.type === 'human')
  return owner?.public_id || null
}

// ─── Client Resolution ───

function resolveClient(clientName: string | null): { id: number; name: string } | null {
  if (!clientName) return null
  const client = getClientByName(clientName)
  if (client) return { id: client.id, name: client.name }
  return null
}

// ─── Project Resolution ───

function findProjectForClient(clientName: string, workspaceId: number): number | null {
  const projects = getProjects(workspaceId)
  // Try exact match first, then fuzzy
  const exact = projects.find(p => p.name.toLowerCase() === clientName.toLowerCase())
  if (exact) return exact.id
  const fuzzy = projects.find(p =>
    p.name.toLowerCase().includes(clientName.toLowerCase()) ||
    clientName.toLowerCase().includes(p.name.toLowerCase())
  )
  return fuzzy?.id || null
}

// ─── Business Resolution ───

function resolveBusinessForTask(clientId: number, businessName: string | null): { id: number; name: string; folderId: number | null; workspaceId: number | null } | null {
  const businesses = getClientBusinesses(clientId)
  if (businesses.length === 0) return null

  if (businessName) {
    // Exact match first
    const exact = businesses.find(b => b.name.toLowerCase() === businessName.toLowerCase())
    if (exact) return { id: exact.id, name: exact.name, folderId: exact.folder_id, workspaceId: exact.workspace_id }
    // Fuzzy match
    const fuzzy = businesses.find(b =>
      b.name.toLowerCase().includes(businessName.toLowerCase()) ||
      businessName.toLowerCase().includes(b.name.toLowerCase())
    )
    if (fuzzy) return { id: fuzzy.id, name: fuzzy.name, folderId: fuzzy.folder_id, workspaceId: fuzzy.workspace_id }
  }

  // Default to first business
  const first = businesses[0]
  return { id: first.id, name: first.name, folderId: first.folder_id, workspaceId: first.workspace_id }
}

function findProjectInBusinessFolder(businessFolderId: number, workspaceId: number, taskTitle: string): number | null {
  const projects = getProjects(workspaceId, businessFolderId)
  if (projects.length === 0) return null
  // Try fuzzy match by task content
  const fuzzy = projects.find(p =>
    taskTitle.toLowerCase().includes(p.name.toLowerCase()) ||
    p.name.toLowerCase().includes(taskTitle.toLowerCase())
  )
  return fuzzy?.id || projects[0]?.id || null
}

// ─── Doc Creation ───

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

function checkExistingDoc(transcript: PlaudTranscript, userId: number): boolean {
  const privateWs = ensurePrivateWorkspaceForUser(userId)
  const recordedDate = new Date(transcript.recorded_at)
  const noteTitle = `${transcript.title || 'Meeting Note'}`
  const dayStr = recordedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fullTitle = `${noteTitle} (${dayStr})`
  const existingDocs = getDocs({ workspaceId: privateWs.id })
  return !!existingDocs.find(d => d.doc_type === 'meeting-note' && d.title === fullTitle)
}

function createMeetingDoc(
  transcript: PlaudTranscript,
  result: ProcessingResult,
  userId: number,
  taskIdMap: Record<string, number> = {},
  businessInfo?: { id: number; folderId: number | null; workspaceId: number | null } | null,
  clientId?: number | null,
): { docId: number; transcriptDocId: number; alreadyExisted: boolean } {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const privateWs = ensurePrivateWorkspaceForUser(userId)
  const recordedDate = new Date(transcript.recorded_at)

  // Determine target workspace and folder
  let targetWsId: number
  let targetFolderId: number

  if (businessInfo?.folderId && businessInfo?.workspaceId) {
    // Route to business folder > Meetings > Year > Month
    targetWsId = businessInfo.workspaceId
    const meetingsFolder = ensureFolder(targetWsId, 'Meetings', businessInfo.folderId)
    const yearFolder = ensureFolder(targetWsId, recordedDate.getFullYear().toString(), meetingsFolder.id)
    const monthFolder = ensureFolder(targetWsId, MONTHS[recordedDate.getMonth()], yearFolder.id)
    targetFolderId = monthFolder.id
  } else {
    // Personal fallback: Meeting Notes > Year > Month
    targetWsId = privateWs.id
    const meetingNotesFolder = ensureFolder(privateWs.id, 'Meeting Notes')
    const yearFolder = ensureFolder(privateWs.id, recordedDate.getFullYear().toString(), meetingNotesFolder.id)
    const monthFolder = ensureFolder(privateWs.id, MONTHS[recordedDate.getMonth()], yearFolder.id)
    targetFolderId = monthFolder.id
  }

  const noteTitle = `${transcript.title || 'Meeting Note'}`
  const dateStr = recordedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const dayStr = recordedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fullTitle = `${noteTitle} (${dayStr})`

  // Check for existing doc (avoid duplicates) -- check both target workspace and private workspace
  const checkWorkspaces = [targetWsId]
  if (targetWsId !== privateWs.id) checkWorkspaces.push(privateWs.id)
  for (const wsId of checkWorkspaces) {
    const existingDocs = getDocs({ workspaceId: wsId })
    const existing = existingDocs.find(d => d.doc_type === 'meeting-note' && d.title === fullTitle)
    if (existing) {
      return { docId: existing.id, transcriptDocId: 0, alreadyExisted: true }
    }
  }

  // Parent doc: summary + action items
  const parentDoc = createDoc({
    title: fullTitle,
    workspaceId: targetWsId,
    folderId: targetFolderId,
    docType: 'meeting-note',
    businessId: businessInfo?.id,
    clientId: clientId || undefined,
  })

  // Child doc: cleaned transcript
  const transcriptDoc = createDoc({
    title: `Transcript - ${noteTitle}`,
    workspaceId: targetWsId,
    folderId: targetFolderId,
    parentDocId: parentDoc.id,
    docType: 'transcript',
  })

  // Build transcript doc content
  const transcriptBlocks: { id: string; type: string; content: string }[] = [
    { id: generateId(), type: 'heading1', content: 'Full Transcript' },
    { id: generateId(), type: 'paragraph', content: `Recorded: ${dateStr}` },
  ]
  const paragraphs = (result.cleanedTranscript || transcript.transcript || 'No transcript available.').split('\n\n').filter(Boolean)
  for (const p of paragraphs.slice(0, 100)) {
    transcriptBlocks.push({ id: generateId(), type: 'paragraph', content: escapeHtml(p.trim()) })
  }
  updateDoc(transcriptDoc.id, { content: JSON.stringify(transcriptBlocks) })

  // Build parent doc content
  const parentBlocks: { id: string; type: string; content: string; checked?: boolean; docId?: number }[] = []

  // Header info
  parentBlocks.push({ id: generateId(), type: 'paragraph', content: `Recorded: ${dateStr}` })
  if (result.clientName) {
    parentBlocks.push({ id: generateId(), type: 'paragraph', content: `Client: ${result.clientName}` })
  }
  if (result.attendees.length > 0) {
    parentBlocks.push({ id: generateId(), type: 'paragraph', content: `Attendees: ${result.attendees.join(', ')}` })
  }
  parentBlocks.push({ id: generateId(), type: 'divider', content: '' })

  // Summary
  parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Summary' })
  const summaryLines = result.summary.split('\n').filter(l => l.trim())
  for (const line of summaryLines) {
    const content = line.replace(/^[-*•]\s*/, '').trim()
    if (content) parentBlocks.push({ id: generateId(), type: 'bulleted_list', content })
  }

  // Detailed notes by topic
  if (result.notes && result.notes.length > 0) {
    parentBlocks.push({ id: generateId(), type: 'divider', content: '' })
    parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Notes' })
    for (const section of result.notes) {
      parentBlocks.push({ id: generateId(), type: 'heading3', content: section.heading })
      for (const bullet of section.bullets) {
        parentBlocks.push({ id: generateId(), type: 'bulleted_list', content: bullet })
      }
    }
  }

  // Action items as checklist
  if (result.tasks.length > 0) {
    parentBlocks.push({ id: generateId(), type: 'divider', content: '' })
    parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Action Items' })
    for (const task of result.tasks) {
      const label = task.title
      const linkedTaskId = taskIdMap[label] || undefined
      parentBlocks.push({ id: generateId(), type: 'check_list', content: label, checked: false, ...(linkedTaskId ? { taskId: linkedTaskId } : {}) })
    }
  }

  // Link to transcript
  parentBlocks.push({ id: generateId(), type: 'divider', content: '' })
  parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Full Transcript' })
  parentBlocks.push({
    id: generateId(),
    type: 'page-link',
    content: `Transcript - ${noteTitle}`,
    docId: transcriptDoc.id,
  })

  updateDoc(parentDoc.id, { content: JSON.stringify(parentBlocks) })

  return { docId: parentDoc.id, transcriptDocId: transcriptDoc.id, alreadyExisted: false }
}

// ─── Task Creation ───

function createTasksFromResult(
  result: ProcessingResult,
  workspaceId: number,
  transcript: PlaudTranscript,
): { ids: number[]; titleMap: Record<string, number> } {
  const ids: number[] = []
  const titleMap: Record<string, number> = {}

  for (const task of result.tasks) {
    const clientMatch = resolveClient(task.client)

    // Resolve business for this specific task
    let businessId: number | undefined
    let taskProjectId: number | null = null
    let taskWorkspaceId = workspaceId

    let taskFolderId: number | null = null

    if (clientMatch) {
      const biz = resolveBusinessForTask(clientMatch.id, task.businessName)
      if (biz) {
        businessId = biz.id
        // Find project within the business's folder
        if (biz.folderId && biz.workspaceId) {
          taskWorkspaceId = biz.workspaceId
          taskFolderId = biz.folderId
          taskProjectId = findProjectInBusinessFolder(biz.folderId, biz.workspaceId, task.title)
        }
      }
    }

    // Fallback to workspace-wide project match if no business-scoped project found
    if (!taskProjectId && task.client) {
      taskProjectId = findProjectForClient(task.client, taskWorkspaceId)
    }

    // If project found but no folder yet, inherit from project
    if (taskProjectId && !taskFolderId) {
      const project = getProject(taskProjectId)
      if (project?.folder_id) taskFolderId = project.folder_id
    }

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dueDate = tomorrow.toISOString().split('T')[0]

    const created = createTask({
      title: task.title,
      description: task.description + `\n\n_From meeting: ${transcript.title}_`,
      workspaceId: taskWorkspaceId,
      folderId: taskFolderId || undefined,
      projectId: taskProjectId || undefined,
      priority: task.priority,
      status: 'todo',
      due_date: dueDate,
      assignee: resolveAssigneeId(task.assignee) || undefined,
      duration_minutes: task.duration_minutes || DEFAULT_TASK_VALUES.duration_minutes,
      businessId,
    })

    // Enable auto-schedule on meeting tasks
    getDb().prepare('UPDATE tasks SET auto_schedule = 1 WHERE id = ?').run(created.id)

    ids.push(created.id)
    titleMap[task.title] = created.id
  }

  if (ids.length > 0) {
    triggerRescheduleServer().catch(() => {})
  }

  return { ids, titleMap }
}

// ─── Main Entry Point ───

export async function processTranscriptAI(transcript: PlaudTranscript, userId: number = 1, opts?: { manual?: boolean }): Promise<{
  success: boolean
  docId?: number
  taskIds?: number[]
  clientName?: string | null
  error?: string
}> {
  console.log(`[meeting-processor] Processing transcript ${transcript.id}: "${transcript.title}"`)

  // Check if auto-processing is enabled (skip check for manual triggers)
  if (!opts?.manual) {
    const autoProcess = getSetting<boolean>('meetingAutoProcess')
    if (autoProcess === false) {
      console.log('[meeting-processor] Auto-processing disabled in settings')
      return { success: false, error: 'Auto-processing disabled' }
    }
  }

  // Guard: skip if transcript and summary are both empty
  const hasContent = (transcript.transcript && transcript.transcript.trim().length > 50) ||
                     (transcript.summary && transcript.summary.trim().length > 20)
  if (!hasContent) {
    console.log(`[meeting-processor] Skipping transcript ${transcript.id}: no meaningful content`)
    return { success: false, error: 'Transcript has no content to process' }
  }

  const systemPrompt = buildSystemPrompt()
  const keywordSignalBlock = buildKeywordSignalBlock(transcript.title, transcript.summary, transcript.transcript)

  const userMessage = `Process this meeting transcript.

${keywordSignalBlock}

Title: ${transcript.title}

Plaud Summary:
${transcript.summary || 'No summary provided'}

Full Transcript:
${transcript.transcript?.slice(0, 15000) || 'No transcript text'}`

  // Audit trail event: shows up on /dispatch "Meeting Processing" section.
  const eventId = startMeetingProcessingEvent({
    transcriptId: transcript.id,
    transcriptTitle: transcript.title,
    phase: 'process',
    keywordScan: keywordSignalBlock,
  })

  const result = await callLLM(systemPrompt, userMessage)

  if (!result) {
    failMeetingProcessingEvent(eventId, 'AI processing failed (LLM returned null)')
    return { success: false, error: 'AI processing failed' }
  }

  // Safety net if LLM failed to pick a client but keywords clearly point at one
  applyKeywordFallback(result, transcript.title, transcript.summary, transcript.transcript)

  // Resolve client ID and primary business
  let resolvedBusiness: { id: number; name: string; folderId: number | null; workspaceId: number | null } | null = null
  if (result.clientName) {
    const client = resolveClient(result.clientName)
    if (client) {
      result.clientId = client.id
      resolvedBusiness = resolveBusinessForTask(client.id, result.businessName)
    }
  }

  // Create tasks first (so we can link taskIds in the doc)
  const privateWs = ensurePrivateWorkspaceForUser(userId)
  const primaryWs = getPrimaryWorkspace()
  const taskWorkspace = primaryWs || privateWs
  const autoCreateTasks = getSetting<boolean>('meetingAutoCreateTasks')
  let taskIds: number[] = []
  let taskIdMap: Record<string, number> = {} // task title -> task id

  // Check if doc already exists (for idempotency)
  const existingDoc = checkExistingDoc(transcript, userId)

  if (!existingDoc && autoCreateTasks !== false) {
    try {
      const created = createTasksFromResult(result, taskWorkspace.id, transcript)
      taskIds = created.ids
      taskIdMap = created.titleMap
    } catch (err) {
      console.error(`[meeting-processor] Task creation failed:`, err)
      failMeetingProcessingEvent(eventId, `Task creation failed: ${String(err)}`)
      return { success: false, error: 'Task creation failed, will retry' }
    }
  }

  // Create doc with task IDs linked to checklist blocks -- route to business folder if detected
  const { docId, alreadyExisted } = createMeetingDoc(transcript, result, userId, taskIdMap, resolvedBusiness, result.clientId)

  console.log(`[meeting-processor] Done: doc=${docId}, tasks=${taskIds.length}, client=${result.clientName || 'unknown'}, business=${resolvedBusiness?.name || 'personal'}`)

  // Dispatch pointer to Jimmy (Mac) -- fire and forget, never block on this.
  // Skip if this doc already existed; reprocessMeetingNotes fires its own
  // dispatch at the tail end of that path.
  if (!alreadyExisted) {
    const highPriorityTaskCount = result.tasks.filter(t => t.priority === 'high').length
    const topTasks = result.tasks
      .slice()
      .sort((a, b) => {
        const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
        return (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)
      })
      .slice(0, 5)
      .map(t => ({ title: t.title, priority: t.priority }))

    autoDispatchMeeting({
      docId,
      transcriptId: transcript.id,
      meetingTitle: transcript.title || 'Untitled Meeting',
      recordedAt: transcript.recorded_at,
      clientName: result.clientName,
      businessName: resolvedBusiness?.name || result.businessName,
      summary: result.summary,
      taskCount: result.tasks.length,
      highPriorityTaskCount,
      topTasks,
    }).then(res => {
      console.log(`[meeting-processor] Dispatch to Jimmy: dispatched=${res.dispatched}, reason=${res.reason}`)
    }).catch(err => {
      console.error('[meeting-processor] Dispatch to Jimmy failed:', err)
    })
  }

  completeMeetingProcessingEvent(eventId, {
    docId,
    clientName: result.clientName,
    businessName: resolvedBusiness?.name,
    taskCount: result.tasks.length,
  })

  return {
    success: true,
    docId,
    taskIds,
    clientName: result.clientName,
  }
}

// ─── Reprocess (notes + business only, no task creation) ───

export async function reprocessMeetingNotes(transcript: PlaudTranscript, userId: number = 1): Promise<{
  success: boolean
  docId?: number
  clientName?: string | null
  businessName?: string | null
  error?: string
}> {
  console.log(`[meeting-processor] Reprocessing transcript ${transcript.id}: "${transcript.title}"`)

  const hasContent = (transcript.transcript && transcript.transcript.trim().length > 50) ||
                     (transcript.summary && transcript.summary.trim().length > 20)
  if (!hasContent) {
    return { success: false, error: 'No content to process' }
  }

  const systemPrompt = buildSystemPrompt()
  let keywordSignalBlock = 'KEYWORD SIGNAL SCAN: (skipped due to scan error)'
  try {
    keywordSignalBlock = buildKeywordSignalBlock(transcript.title, transcript.summary, transcript.transcript)
    console.log(`[meeting-processor] Reprocess keyword scan for #${transcript.id}:\n${keywordSignalBlock}`)
  } catch (err) {
    console.error(`[meeting-processor] Reprocess keyword scan threw for #${transcript.id}:`, err)
  }

  // Log this processing run into the audit trail so it shows up on /dispatch.
  // We mark done/failed at every return site below.
  const eventId = startMeetingProcessingEvent({
    transcriptId: transcript.id,
    transcriptTitle: transcript.title,
    phase: 'reprocess',
    keywordScan: keywordSignalBlock,
  })
  const userMessage = `Process this meeting transcript. Focus on writing EXTREMELY detailed notes -- capture every topic, decision, number, timeline, and commitment discussed. The notes section should be comprehensive enough that someone can understand the entire meeting without reading the transcript.

${keywordSignalBlock}

Title: ${transcript.title}

Plaud Summary:
${transcript.summary || 'No summary provided'}

Full Transcript:
${transcript.transcript?.slice(0, 15000) || 'No transcript text'}`

  console.log(`[meeting-processor] Reprocess #${transcript.id}: calling LLM (prompt=${systemPrompt.length}ch, message=${userMessage.length}ch)`)
  const result = await callLLM(systemPrompt, userMessage)
  if (!result) {
    console.error(`[meeting-processor] Reprocess #${transcript.id}: LLM returned null`)
    failMeetingProcessingEvent(eventId, 'AI processing failed (LLM returned null)')
    return { success: false, error: 'AI processing failed' }
  }
  console.log(`[meeting-processor] Reprocess #${transcript.id}: LLM returned client="${result.clientName}" business="${result.businessName}"`)

  // Safety net if LLM failed to pick a client but keywords clearly point at one
  applyKeywordFallback(result, transcript.title, transcript.summary, transcript.transcript)

  // Resolve client and business
  let resolvedBusiness: { id: number; name: string; folderId: number | null; workspaceId: number | null } | null = null
  if (result.clientName) {
    const client = resolveClient(result.clientName)
    if (client) {
      result.clientId = client.id
      resolvedBusiness = resolveBusinessForTask(client.id, result.businessName)
    }
  }

  // Find existing doc
  const recordedDate = new Date(transcript.recorded_at)
  const noteTitle = transcript.title || 'Meeting Note'
  const dayStr = recordedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fullTitle = `${noteTitle} (${dayStr})`
  const dateStr = recordedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const db = getDb()
  const existingDoc = db.prepare(
    "SELECT id, content FROM docs WHERE doc_type = 'meeting-note' AND title = ? LIMIT 1"
  ).get(fullTitle) as { id: number; content: string } | undefined

  if (!existingDoc) {
    // No existing doc -- create fresh WITH tasks
    const privateWs = ensurePrivateWorkspaceForUser(userId)
    const primaryWs = getPrimaryWorkspace()
    const taskWorkspace = primaryWs || privateWs

    // Create tasks first so we can link them
    const { titleMap: taskIdMap } = createTasksFromResult(result, taskWorkspace.id, transcript)

    const { docId } = createMeetingDoc(transcript, result, userId, taskIdMap, resolvedBusiness, result.clientId)
    completeMeetingProcessingEvent(eventId, {
      docId,
      clientName: result.clientName,
      businessName: resolvedBusiness?.name,
      taskCount: result.tasks.length,
    })
    return { success: true, docId, clientName: result.clientName, businessName: resolvedBusiness?.name }
  }

  // Find all tasks linked to this meeting (via doc content or description tag)
  const allLinkedTaskIds: Set<number> = new Set()
  const completedTaskIds: Record<string, number> = {} // Keep completed tasks for context

  // From doc content
  try {
    const blocks = JSON.parse(existingDoc.content || '[]')
    for (const b of blocks) {
      if ((b.type === 'check_list' || b.type === 'checklist') && b.taskId) {
        allLinkedTaskIds.add(b.taskId)
      }
    }
  } catch { /* ignore parse errors */ }

  // From description tag
  const escapedTitle = noteTitle.replace(/[%_]/g, '\\$&')
  const linkedTasks = db.prepare(`
    SELECT id, title, status FROM tasks
    WHERE description IS NOT NULL AND description LIKE ? ESCAPE '\\'
  `).all(`%\\_From meeting: ${escapedTitle}\\_%`) as { id: number; title: string; status: string }[]
  for (const t of linkedTasks) {
    allLinkedTaskIds.add(t.id)
  }

  // Check which tasks are completed vs incomplete
  for (const taskId of allLinkedTaskIds) {
    const task = db.prepare('SELECT id, title, status FROM tasks WHERE id = ?').get(taskId) as { id: number; title: string; status: string } | undefined
    if (task) {
      if (task.status === 'completed' || task.status === 'done') {
        // Keep completed tasks - store for reference
        completedTaskIds[task.title.toLowerCase().trim()] = task.id
      } else {
        // Delete incomplete tasks - they'll be recreated fresh
        db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id)
        console.log(`[meeting-processor] Deleted incomplete task id=${task.id} title="${task.title}"`)
      }
    }
  }

  // Build updated doc content with new summary/notes but preserving task links
  const parentBlocks: { id: string; type: string; content: string; checked?: boolean; docId?: number; taskId?: number }[] = []

  // Header
  parentBlocks.push({ id: generateId(), type: 'paragraph', content: `Recorded: ${dateStr}` })
  if (result.clientName) {
    const bizLabel = resolvedBusiness ? ` / ${resolvedBusiness.name}` : ''
    parentBlocks.push({ id: generateId(), type: 'paragraph', content: `Client: ${result.clientName}${bizLabel}` })
  }
  if (result.attendees.length > 0) {
    parentBlocks.push({ id: generateId(), type: 'paragraph', content: `Attendees: ${result.attendees.join(', ')}` })
  }
  parentBlocks.push({ id: generateId(), type: 'divider', content: '' })

  // Summary
  parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Summary' })
  const summaryLines = result.summary.split('\n').filter(l => l.trim())
  for (const line of summaryLines) {
    const content = line.replace(/^[-*•]\s*/, '').trim()
    if (content) parentBlocks.push({ id: generateId(), type: 'bulleted_list', content })
  }

  // Detailed notes
  if (result.notes && result.notes.length > 0) {
    parentBlocks.push({ id: generateId(), type: 'divider', content: '' })
    parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Meeting Notes' })
    for (const section of result.notes) {
      parentBlocks.push({ id: generateId(), type: 'heading3', content: section.heading })
      for (const bullet of section.bullets) {
        parentBlocks.push({ id: generateId(), type: 'bulleted_list', content: bullet })
      }
    }
  }

  // Action items -- create new tasks, preserve completed ones
  const taskBlocks = result.tasks.length > 0 ? result.tasks : []
  if (taskBlocks.length > 0 || Object.keys(completedTaskIds).length > 0) {
    parentBlocks.push({ id: generateId(), type: 'divider', content: '' })
    parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Action Items' })

    // First add completed tasks for context (marked as done)
    for (const [title, taskId] of Object.entries(completedTaskIds)) {
      parentBlocks.push({
        id: generateId(), type: 'check_list', content: title, checked: true, taskId,
      })
    }

    if (taskBlocks.length > 0) {
      // Create fresh tasks (incomplete ones were deleted above)
      const privateWs = ensurePrivateWorkspaceForUser(userId)
      const primaryWs = getPrimaryWorkspace()
      const taskWorkspace = primaryWs || privateWs

      for (const task of taskBlocks) {
        const titleKey = task.title.toLowerCase().trim()

        // Skip if this task was already completed
        if (completedTaskIds[titleKey]) {
          continue
        }

        // Create new task
        const clientMatch = resolveClient(task.client)
        let businessId: number | undefined
        let taskProjectId: number | null = null
        let taskWorkspaceId = taskWorkspace.id
        let taskFolderId: number | null = null

        if (clientMatch) {
          const biz = resolveBusinessForTask(clientMatch.id, task.businessName)
          if (biz) {
            businessId = biz.id
            if (biz.folderId && biz.workspaceId) {
              taskWorkspaceId = biz.workspaceId
              taskFolderId = biz.folderId
              taskProjectId = findProjectInBusinessFolder(biz.folderId, biz.workspaceId, task.title)
            }
          }
        }

        if (!taskProjectId && task.client) {
          taskProjectId = findProjectForClient(task.client, taskWorkspaceId)
        }

        if (taskProjectId && !taskFolderId) {
          const project = getProject(taskProjectId)
          if (project?.folder_id) taskFolderId = project.folder_id
        }

        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const dueDate = tomorrow.toISOString().split('T')[0]

        const created = createTask({
          title: task.title,
          description: task.description + `\n\n_From meeting: ${noteTitle}_`,
          workspaceId: taskWorkspaceId,
          folderId: taskFolderId || undefined,
          projectId: taskProjectId || undefined,
          priority: task.priority,
          status: 'todo',
          due_date: dueDate,
          assignee: resolveAssigneeId(task.assignee) || undefined,
          duration_minutes: task.duration_minutes || DEFAULT_TASK_VALUES.duration_minutes,
          businessId,
        })

        db.prepare('UPDATE tasks SET auto_schedule = 1 WHERE id = ?').run(created.id)

        parentBlocks.push({
          id: generateId(), type: 'check_list', content: task.title, checked: false, taskId: created.id,
        })
      }

      triggerRescheduleServer().catch(() => {})
    }
    // Note: if no new tasks from AI, completed tasks were already added above
  }

  // Find transcript child doc
  const transcriptDoc = db.prepare(
    "SELECT id FROM docs WHERE parent_doc_id = ? AND doc_type = 'transcript' LIMIT 1"
  ).get(existingDoc.id) as { id: number } | undefined

  if (transcriptDoc) {
    parentBlocks.push({ id: generateId(), type: 'divider', content: '' })
    parentBlocks.push({ id: generateId(), type: 'heading2', content: 'Full Transcript' })
    parentBlocks.push({ id: generateId(), type: 'page-link', content: `Transcript - ${noteTitle}`, docId: transcriptDoc.id })
  }

  // Update doc content + metadata
  updateDoc(existingDoc.id, {
    content: JSON.stringify(parentBlocks),
    ...(resolvedBusiness ? { business_id: resolvedBusiness.id } : {}),
    ...(result.clientId ? { client_id: result.clientId } : {}),
  })

  console.log(`[meeting-processor] Reprocessed doc=${existingDoc.id}, client=${result.clientName}, business=${resolvedBusiness?.name || 'none'}, notes=${result.notes.length} sections`)

  // Fire dispatch to Jimmy on reprocess too. User expectation: pressing
  // Reprocess re-runs the full pipeline including the meeting dispatch
  // triage/push, so the meeting gets re-evaluated against the current rules
  // and pinged if urgent. autoDispatchMeeting handles its own urgency gate +
  // settings check, so we just call it unconditionally.
  const highPriorityTaskCount = result.tasks.filter(t => t.priority === 'high').length
  const topTasks = result.tasks.slice()
    .sort((a, b) => {
      const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
      return (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)
    })
    .slice(0, 5)
    .map(t => ({ title: t.title, priority: t.priority }))
  autoDispatchMeeting({
    docId: existingDoc.id,
    transcriptId: transcript.id,
    meetingTitle: transcript.title || 'Untitled Meeting',
    recordedAt: transcript.recorded_at,
    clientName: result.clientName,
    businessName: resolvedBusiness?.name || result.businessName,
    summary: result.summary,
    taskCount: result.tasks.length,
    highPriorityTaskCount,
    topTasks,
  }).then(res => {
    console.log(`[meeting-processor] Reprocess dispatch to Jimmy: dispatched=${res.dispatched}, reason=${res.reason}`)
  }).catch(err => {
    console.error('[meeting-processor] Reprocess dispatch to Jimmy failed:', err)
  })

  completeMeetingProcessingEvent(eventId, {
    docId: existingDoc.id,
    clientName: result.clientName,
    businessName: resolvedBusiness?.name,
    taskCount: result.tasks.length,
  })

  return { success: true, docId: existingDoc.id, clientName: result.clientName, businessName: resolvedBusiness?.name }
}
