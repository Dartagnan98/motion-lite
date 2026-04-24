/**
 * Meeting Dispatch - after processTranscriptAI finishes, optionally push a
 * pointer message to Jimmy (Operator's Telegram-connected Claude Code session
 * running on the Mac at home) via the loopback inject endpoint exposed across
 * the private Tailscale tailnet.
 *
 * Jimmy gets: short summary, client/business, task count, urgency, link to
 * the meeting doc on this app. He can Read the full doc if context needs it.
 *
 * Keeps Jimmy's context lean (pointer, not full transcript) while preserving
 * the thread so he can follow up on anything actionable.
 */

import { getApiKey } from './agent-runtime'
import { getSetting } from './settings'
import { recordMeetingDispatch, getDb } from './db'

// ─── Types ───

export interface DispatchInput {
  docId: number
  transcriptId: number
  meetingTitle: string
  recordedAt: string
  clientName: string | null
  businessName: string | null
  summary: string
  taskCount: number
  highPriorityTaskCount: number
  topTasks: Array<{ title: string; priority: string }>
}

interface TriageResult {
  dispatch: boolean
  urgency: 'low' | 'medium' | 'high'
  reason: string
}

// ─── Config ───

function getInjectConfig(): { url: string; token: string } | null {
  const url = process.env.JIMMY_INJECT_URL
  const token = process.env.JIMMY_INJECT_TOKEN
  if (!url || !token) {
    console.warn('[meeting-dispatch] JIMMY_INJECT_URL or JIMMY_INJECT_TOKEN not set, skipping dispatch')
    return null
  }
  return { url, token }
}

// ─── Triage ───

const TRIAGE_SYSTEM = `You are a triage classifier deciding whether a meeting outcome needs Operator's assistant (Jimmy, an AI agent running on his Mac) to be made aware of it now.

Operator runs Example Co, a solo Meta ads agency. Jimmy handles ads ops, client comms, automation, content.

Dispatch=true when any of these apply:
- Commitments Operator made that need follow-up in the next 72h
- Urgent client issues (unhappy client, fire to put out, account/billing problems)
- New client onboarding kickoff
- Decisions that change ongoing work (campaign pause, strategy pivot, budget change)
- Tasks where Jimmy's automation would accelerate execution (ads setup, CRM workflow, email draft, report generation)

Dispatch=false when:
- Routine check-in with nothing actionable in the near term
- Internal musing / brainstorming that didn't reach a decision
- Tasks already handled during the meeting itself
- No client identified and no concrete asks

Urgency:
- high: client on fire, deadline in <24h, money/account issue
- medium: normal action items, deliverables in 1-5 days
- low: long-tail items, nice-to-haves, general context

Return ONLY valid JSON:
{"dispatch": true|false, "urgency": "low"|"medium"|"high", "reason": "short sentence explaining the call"}`

async function triageForDispatch(input: DispatchInput): Promise<TriageResult> {
  const keyConfig = getApiKey(1)
  const envKey = keyConfig?.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY
  if (!envKey) {
    // No LLM available, default to dispatching with medium urgency. Better to
    // over-notify Jimmy than drop something critical.
    return { dispatch: true, urgency: 'medium', reason: 'No LLM configured for triage, defaulted to dispatch' }
  }

  const userMsg = `Meeting: ${input.meetingTitle}
Client: ${input.clientName || 'unknown'}${input.businessName ? ' / ' + input.businessName : ''}

Summary:
${input.summary}

Action items (${input.taskCount} total, ${input.highPriorityTaskCount} high priority):
${input.topTasks.map(t => `- [${t.priority}] ${t.title}`).join('\n') || '(none)'}

Decide: should Jimmy be notified about this meeting right now? If so, how urgent?`

  try {
    const isAnthropic = envKey.startsWith('sk-ant')
    let text: string | null = null

    if (isAnthropic) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': envKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 200,
          system: TRIAGE_SYSTEM,
          messages: [{ role: 'user', content: userMsg }],
        }),
      })
      if (!res.ok) {
        console.error('[meeting-dispatch] Triage anthropic error:', await res.text())
        return { dispatch: true, urgency: 'medium', reason: 'Triage call failed, defaulted to dispatch' }
      }
      const data = await res.json()
      text = data?.content?.[0]?.text
    } else {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${envKey}`,
          'HTTP-Referer': 'https://app.example.com',
          'X-Title': 'Motion Lite',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4-5',
          max_tokens: 200,
          messages: [
            { role: 'system', content: TRIAGE_SYSTEM },
            { role: 'user', content: userMsg },
          ],
          response_format: { type: 'json_object' },
        }),
      })
      if (!res.ok) {
        console.error('[meeting-dispatch] Triage openrouter error:', await res.text())
        return { dispatch: true, urgency: 'medium', reason: 'Triage call failed, defaulted to dispatch' }
      }
      const data = await res.json()
      text = data?.choices?.[0]?.message?.content
    }

    if (!text) return { dispatch: true, urgency: 'medium', reason: 'Empty triage response' }

    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned) as { dispatch?: boolean; urgency?: string; reason?: string }
    const urgency = (parsed.urgency === 'low' || parsed.urgency === 'medium' || parsed.urgency === 'high') ? parsed.urgency : 'medium'
    return {
      dispatch: typeof parsed.dispatch === 'boolean' ? parsed.dispatch : true,
      urgency,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 280) : '',
    }
  } catch (err) {
    console.error('[meeting-dispatch] Triage exception:', err)
    return { dispatch: true, urgency: 'medium', reason: 'Triage exception, defaulted to dispatch' }
  }
}

// ─── Pointer construction ───

export function buildPointerText(input: DispatchInput, triage: { urgency: string; reason?: string } | null): string {
  const clientLabel = input.clientName
    ? (input.businessName ? `${input.clientName} / ${input.businessName}` : input.clientName)
    : 'unknown client'

  // Compact first 2 summary bullets
  const summaryLines = input.summary.split('\n').filter(l => l.trim()).slice(0, 2)
  const summary = summaryLines.map(l => l.replace(/^[-*•]\s*/, '').trim()).join(' ')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.example.com'
  const docUrl = `${baseUrl}/docs/${input.docId}`

  const urgencyTag = triage?.urgency ? ` [${triage.urgency.toUpperCase()}]` : ''
  const reason = triage?.reason ? ` Triage: ${triage.reason}` : ''

  return `[meeting dispatch]${urgencyTag} ${input.meetingTitle} -- ${clientLabel}

${summary}

Tasks: ${input.taskCount} total, ${input.highPriorityTaskCount} high priority.${reason}

Full doc: ${docUrl}

Do not reply. Read the doc if a follow-up needs the detail.`
}

// ─── Inject call ───

async function postToJimmy(pointerText: string): Promise<{ ok: boolean; httpStatus: number | null; response: string | null; error: string | null }> {
  const cfg = getInjectConfig()
  if (!cfg) return { ok: false, httpStatus: null, response: null, error: 'inject config missing' }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inject-token': cfg.token,
      },
      body: JSON.stringify({
        content: pointerText,
        chat_id: 'meeting-dispatch',
        user: 'ctrl-motion',
        user_id: '0',
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    const body = await res.text().catch(() => '')
    return {
      ok: res.ok,
      httpStatus: res.status,
      response: body.slice(0, 500),
      error: res.ok ? null : `HTTP ${res.status}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, httpStatus: null, response: null, error: msg.slice(0, 500) }
  }
}

// ─── Public API ───

/**
 * Run triage + dispatch for an AI-processed meeting. Called from
 * processTranscriptAI after the doc+tasks land. Records every attempt
 * (including skipped + failed) to meeting_dispatches.
 */
export async function autoDispatchMeeting(input: DispatchInput): Promise<{ dispatched: boolean; reason: string }> {
  const autoEnabled = getSetting<boolean>('meetingAutoDispatch')
  if (autoEnabled === false) {
    return { dispatched: false, reason: 'auto-dispatch disabled in settings' }
  }

  const cfg = getInjectConfig()
  if (!cfg) {
    return { dispatched: false, reason: 'JIMMY_INJECT_URL / JIMMY_INJECT_TOKEN env vars missing' }
  }

  const triage = await triageForDispatch(input)
  const urgencyThreshold = getSetting<string>('meetingDispatchMinUrgency') || 'low'
  const urgencyRank: Record<string, number> = { low: 0, medium: 1, high: 2 }
  const meetsThreshold = urgencyRank[triage.urgency] >= urgencyRank[urgencyThreshold]

  if (!triage.dispatch || !meetsThreshold) {
    recordMeetingDispatch({
      docId: input.docId,
      mode: 'auto',
      urgency: triage.urgency,
      triageReason: triage.reason,
      pointerText: '',
      injectStatus: 'skipped',
      error: triage.dispatch ? `below urgency threshold (${triage.urgency} < ${urgencyThreshold})` : 'triage declined',
    })
    return { dispatched: false, reason: triage.reason || 'skipped by triage' }
  }

  const pointerText = buildPointerText(input, triage)
  const res = await postToJimmy(pointerText)

  recordMeetingDispatch({
    docId: input.docId,
    mode: 'auto',
    urgency: triage.urgency,
    triageReason: triage.reason,
    pointerText,
    injectStatus: res.ok ? 'sent' : 'failed',
    injectHttpStatus: res.httpStatus,
    injectResponse: res.response,
    error: res.error,
  })

  return {
    dispatched: res.ok,
    reason: res.ok ? `sent (${triage.urgency})` : `inject failed: ${res.error}`,
  }
}

/**
 * Rebuild DispatchInput from an existing meeting-note doc. Used by the manual
 * dispatch API route -- the doc already has the AI processing baked in, we
 * just re-extract the pieces we need to build a pointer.
 */
export function buildDispatchInputFromDoc(docId: number): DispatchInput | null {
  const db = getDb()
  const doc = db.prepare(`
    SELECT d.id, d.title, d.content, d.client_id, d.business_id,
           c.name AS client_name, b.name AS business_name
    FROM docs d
    LEFT JOIN client_profiles c ON c.id = d.client_id
    LEFT JOIN client_businesses b ON b.id = d.business_id
    WHERE d.id = ? AND d.doc_type = 'meeting-note'
    LIMIT 1
  `).get(docId) as {
    id: number
    title: string
    content: string
    client_id: number | null
    business_id: number | null
    client_name: string | null
    business_name: string | null
  } | undefined

  if (!doc) return null

  // Parse content blocks to extract summary bullets
  let summaryLines: string[] = []
  try {
    const blocks = JSON.parse(doc.content || '[]') as Array<{ type: string; content: string }>
    let inSummary = false
    for (const b of blocks) {
      if (b.type === 'heading2' && /summary/i.test(b.content)) {
        inSummary = true
        continue
      }
      if (inSummary && (b.type === 'heading2' || b.type === 'divider')) break
      if (inSummary && b.type === 'bulleted_list' && b.content) {
        summaryLines.push(b.content)
      }
    }
  } catch { /* ignore */ }
  const summary = summaryLines.slice(0, 5).map(l => '- ' + l).join('\n')

  // Find linked tasks for this meeting
  const escapedTitle = (doc.title || '').replace(/[%_]/g, '\\$&').replace(/\s*\([^)]+\)\s*$/, '')
  const tasks = db.prepare(`
    SELECT title, priority FROM tasks
    WHERE description IS NOT NULL AND description LIKE ? ESCAPE '\\'
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      id DESC
    LIMIT 10
  `).all(`%\\_From meeting: ${escapedTitle}%`) as Array<{ title: string; priority: string }>

  const highPriorityTaskCount = tasks.filter(t => t.priority === 'high').length

  return {
    docId: doc.id,
    transcriptId: 0,
    meetingTitle: doc.title,
    recordedAt: '',
    clientName: doc.client_name,
    businessName: doc.business_name,
    summary: summary || '(no summary extracted)',
    taskCount: tasks.length,
    highPriorityTaskCount,
    topTasks: tasks.slice(0, 5).map(t => ({ title: t.title, priority: t.priority })),
  }
}

/**
 * Manual dispatch triggered from the UI. Skips triage, always sends with
 * medium urgency unless caller specifies.
 */
export async function manualDispatchMeeting(
  input: DispatchInput,
  opts?: { urgency?: 'low' | 'medium' | 'high' },
): Promise<{ dispatched: boolean; reason: string }> {
  const cfg = getInjectConfig()
  if (!cfg) {
    recordMeetingDispatch({
      docId: input.docId,
      mode: 'manual',
      pointerText: '',
      injectStatus: 'failed',
      error: 'JIMMY_INJECT_URL / JIMMY_INJECT_TOKEN env vars missing',
    })
    return { dispatched: false, reason: 'inject env vars missing on this server' }
  }

  const urgency = opts?.urgency || 'medium'
  const pointerText = buildPointerText(input, { urgency, reason: 'manual dispatch from UI' })
  const res = await postToJimmy(pointerText)

  recordMeetingDispatch({
    docId: input.docId,
    mode: 'manual',
    urgency,
    triageReason: 'manual dispatch',
    pointerText,
    injectStatus: res.ok ? 'sent' : 'failed',
    injectHttpStatus: res.httpStatus,
    injectResponse: res.response,
    error: res.error,
  })

  return {
    dispatched: res.ok,
    reason: res.ok ? 'sent' : `inject failed: ${res.error}`,
  }
}
