/**
 * Plaud transcript processor -- webhook-only, no polling.
 * Supabase fires INSERT webhook to /api/webhooks/transcript,
 * which calls processTranscriptById() here.
 */

import { supabaseSelect } from './supabase'
import { createChatSession, getChatSessions, addChatMessage, getChatMessages, getAgent, createNotificationRow } from './db'
import { runAgentStream } from './agent-runtime'
import { sendPushToAll } from './push'

interface PlaudTranscript {
  id: number
  title: string
  summary: string
  transcript: string
  created_at: string
  recorded_at: string
  processed_by_jimmy: boolean | null
}

const processingNow = new Set<number>()

function getOrCreateTranscriptSession(): { id: number } {
  const sessions = getChatSessions('jimmy')
  const existing = sessions.find(s => s.title === 'Plaud Transcripts')
  if (existing) return { id: existing.id }
  return createChatSession('Plaud Transcripts', 'jimmy')
}

async function processTranscript(transcript: PlaudTranscript): Promise<void> {
  if (processingNow.has(transcript.id)) return
  if (transcript.processed_by_jimmy) return

  processingNow.add(transcript.id)

  // Note: processed_by_jimmy is now set by the AI pipeline (meeting-processor.ts)
  // after successful doc+task creation. This function only handles the Jimmy
  // chat session for conversational follow-up.

  try {
    const session = getOrCreateTranscriptSession()

    const userMessage = `New Plaud transcript just came in. Review it and extract any action items in my scope (marketing, Meta ads, funnels, tech/automation, content, client management). If you find tasks, list them out and ask me to approve before creating them.

Title: ${transcript.title}

Summary:
${transcript.summary || 'No summary'}

Transcript (first 3000 chars):
${transcript.transcript?.slice(0, 3000) || 'No transcript text'}`

    addChatMessage(session.id, 'user', userMessage)

    const msgs = getChatMessages(session.id)
    const recent = msgs.slice(-20)
    const conversationHistory: Array<{ role: string; content: unknown }> = []
    for (const m of recent) {
      if (m.role === 'system') continue
      let content: unknown = m.content
      try {
        const parsed = JSON.parse(m.content)
        if (Array.isArray(parsed)) content = parsed
      } catch { /* keep as string */ }
      conversationHistory.push({ role: m.role, content })
    }

    let fullText = ''
    const toolCalls: Array<{ name: string }> = []
    let costData: unknown = null

    for await (const event of runAgentStream('jimmy', userMessage, conversationHistory, { sessionId: session.id })) {
      if (event.type === 'text') {
        fullText += event.data as string
      } else if (event.type === 'tool_result') {
        const tr = event.data as { name: string; result: string }
        toolCalls.push({ name: tr.name })
      } else if (event.type === 'cost') {
        costData = event.data
      }
    }

    if (fullText) {
      const metadata = JSON.stringify({
        agent_id: 'jimmy',
        tool_calls: toolCalls,
        cost: costData,
        source: 'plaud_transcript',
        transcript_id: transcript.id,
      })
      addChatMessage(session.id, 'assistant', fullText, metadata)

      const agent = getAgent('jimmy')
      const agentName = agent?.name || 'Jimmy'
      const preview = fullText.length > 100 ? fullText.slice(0, 100) + '...' : fullText

      createNotificationRow({
        type: 'message',
        subtype: 'ai',
        title: `${agentName}: New transcript processed`,
        body: preview,
        url: `/chat?agent=jimmy`,
        actor_name: agentName,
        actor_color: agent?.avatar_color || '#7a6b55',
      })
      sendPushToAll({
        title: `${agentName}: Plaud Transcript`,
        body: preview,
        url: `/chat?agent=jimmy`,
        tag: 'message.plaud',
      }).catch(() => {})
    }

    console.log(`[transcript-watcher] Processed transcript ${transcript.id}: "${transcript.title}"`)
  } catch (err) {
    console.error(`[transcript-watcher] Error processing transcript ${transcript.id}:`, err)
  } finally {
    processingNow.delete(transcript.id)
  }
}

/** Process a single transcript by ID (called from webhook route) */
export async function processTranscriptById(id: number): Promise<void> {
  const rows = await supabaseSelect<PlaudTranscript[]>(
    'plaud_transcripts',
    `id=eq.${id}&limit=1`
  )
  const t = rows && Array.isArray(rows) ? rows[0] : null
  if (t) await processTranscript(t)
}
