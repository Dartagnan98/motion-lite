// ─── AI Effort Classifier ───
// Batch-classifies task effort levels using Gemini Flash via OpenRouter.
// Called during scheduler runs to auto-tag tasks as low/medium/high effort.

import { getApiKey } from './agent-runtime'
import { detectProvider } from './llm-provider'
import { getDb } from './db'

interface TaskToClassify {
  id: number
  title: string
  description: string | null
  duration_minutes: number
  priority: string
  labels: string | null
}

interface ClassificationResult {
  id: number
  effort_level: 'low' | 'medium' | 'high'
}

const SYSTEM_PROMPT = `You classify task effort levels for a scheduling system. Given a list of tasks, determine if each requires LOW, MEDIUM, or HIGH cognitive effort.

HIGH effort = deep focus work: strategy, writing, design, coding, analysis, complex problem-solving, creative work, research reports, financial modeling, campaign architecture
MEDIUM effort = moderate focus: reviews, editing, organizing, planning, email drafts, data entry, standard meetings prep, routine analysis
LOW effort = light work: status updates, scheduling, file organization, quick replies, simple approvals, routine check-ins, copying/pasting

Consider the task title, description, duration, and labels. Longer tasks that involve creation or strategy are typically high effort. Short administrative tasks are typically low.

Return ONLY a JSON array of objects with "id" (number) and "effort_level" ("low", "medium", or "high"). No markdown, no explanation.

Example: [{"id": 1, "effort_level": "high"}, {"id": 2, "effort_level": "low"}]`

export async function classifyUnclassifiedTasks(): Promise<number> {
  // Check for API key
  const keyConfig = getApiKey(1)
  if (!keyConfig) return 0

  // Get unclassified tasks
  const db = getDb()
  const tasks = db.prepare(`
    SELECT id, title, description, duration_minutes, priority, labels
    FROM tasks
    WHERE effort_level IS NULL
    AND status NOT IN ('completed', 'cancelled', 'archived')
    AND auto_schedule = 1
    ORDER BY id DESC
    LIMIT 50
  `).all() as TaskToClassify[]

  if (tasks.length === 0) return 0

  // Build task list for AI
  const taskList = tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description?.slice(0, 200)?.replace(/<[^>]*>/g, '') || null,
    duration_minutes: t.duration_minutes,
    priority: t.priority,
    labels: t.labels,
  }))

  const userMessage = `Classify these ${tasks.length} tasks:\n${JSON.stringify(taskList)}`

  try {
    const provider = detectProvider(keyConfig.apiKey)
    let classifications: ClassificationResult[]

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': keyConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })
      if (!res.ok) { console.error('[EffortClassifier] Anthropic error:', await res.text()); return 0 }
      const data = await res.json()
      const text = data?.content?.[0]?.text
      if (!text) return 0
      classifications = JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
    } else {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${keyConfig.apiKey}`,
          'HTTP-Referer': 'https://app.example.com',
          'X-Title': 'Motion Lite',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          max_tokens: 2048,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
        }),
      })
      if (!res.ok) { console.error('[EffortClassifier] OpenRouter error:', await res.text()); return 0 }
      const data = await res.json()
      const text = data?.choices?.[0]?.message?.content
      if (!text) return 0
      const parsed = JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
      // Handle both array and object-with-array responses
      classifications = Array.isArray(parsed) ? parsed : (parsed.tasks || parsed.classifications || [])
    }

    if (!Array.isArray(classifications)) return 0

    // Validate and save
    const validLevels = new Set(['low', 'medium', 'high'])
    const taskIds = new Set(tasks.map(t => t.id))
    const update = db.prepare('UPDATE tasks SET effort_level = ? WHERE id = ?')
    let classified = 0

    for (const c of classifications) {
      if (!taskIds.has(c.id) || !validLevels.has(c.effort_level)) continue
      update.run(c.effort_level, c.id)
      classified++
    }

    if (classified > 0) {
      console.log(`[EffortClassifier] Classified ${classified}/${tasks.length} tasks`)
    }
    return classified
  } catch (err) {
    console.error('[EffortClassifier] Failed:', err)
    return 0
  }
}

export function hasApiKey(): boolean {
  const keyConfig = getApiKey(1)
  return keyConfig !== null
}
