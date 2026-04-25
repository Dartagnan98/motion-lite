import Anthropic from '@anthropic-ai/sdk'
import type { CrmAiBrandVoiceRecord, CrmAiPromptCategory, CrmAiPromptRecord } from '@/lib/db'

export const CRM_AI_MODEL = 'claude-haiku-4-5-20251001'

export interface CrmAiCompletionPlan {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  temperature?: number
}

export interface CrmAiCompletionResult {
  text: string
  model: string
  tokensIn: number
  tokensOut: number
}

function getAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('AI is not configured. Set ANTHROPIC_API_KEY on the server.')
  return apiKey
}

let anthropicClient: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: getAnthropicApiKey() })
  }
  return anthropicClient
}

function buildBrandVoiceSystemPrompt(brandVoice?: CrmAiBrandVoiceRecord | null): string {
  if (!brandVoice) return ''
  const parts: string[] = []
  if (brandVoice.voice_sample_text.trim()) {
    parts.push(`Brand voice sample:\n${brandVoice.voice_sample_text.trim()}`)
  }
  if (brandVoice.tone_words.length) parts.push(`Tone words: ${brandVoice.tone_words.join(', ')}`)
  if (brandVoice.do_words.length) parts.push(`Prefer these words and phrases: ${brandVoice.do_words.join(', ')}`)
  if (brandVoice.avoid_words.length) parts.push(`Avoid these words and phrases: ${brandVoice.avoid_words.join(', ')}`)
  if (brandVoice.style_rules.length) parts.push(`Style rules:\n- ${brandVoice.style_rules.join('\n- ')}`)
  return parts.length ? `Brand voice guardrails:\n${parts.join('\n\n')}` : ''
}

function baseSystemPrompt(brandVoice?: CrmAiBrandVoiceRecord | null): string {
  const parts = [
    'You write copy inside Motion Lite, an operator CRM used all day by a fast-moving solo operator.',
    'Output only the requested content. No preambles, no markdown fences, no commentary about your process.',
    'Do not invent facts, pricing, dates, testimonials, or performance claims not present in the prompt.',
    'Avoid AI filler, em dashes, and generic throat-clearing. Be concrete and direct.',
  ]
  const brandVoiceText = buildBrandVoiceSystemPrompt(brandVoice)
  if (brandVoiceText) parts.push(brandVoiceText)
  return parts.join('\n\n')
}

function getContextString(context: Record<string, unknown>, key: string): string {
  const value = context[key]
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ')
  return JSON.stringify(value)
}

function renderContextBlock(context: Record<string, unknown>, preferredKeys: string[]): string {
  const lines = preferredKeys
    .map((key) => {
      const value = getContextString(context, key)
      return value ? `${key}: ${value}` : ''
    })
    .filter(Boolean)
  if (lines.length) return lines.join('\n')
  const fallback = Object.entries(context)
    .map(([key, value]) => {
      const rendered = getContextString({ [key]: value }, key)
      return rendered ? `${key}: ${rendered}` : ''
    })
    .filter(Boolean)
  return fallback.join('\n')
}

export function renderPromptTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => getContextString(context, key))
}

export function buildPromptFromSavedPrompt(
  prompt: CrmAiPromptRecord,
  context: Record<string, unknown>,
  brandVoice?: CrmAiBrandVoiceRecord | null,
): CrmAiCompletionPlan {
  const systemPrompt = [baseSystemPrompt(brandVoice), prompt.system_prompt.trim()].filter(Boolean).join('\n\n')
  const userPrompt = renderPromptTemplate(prompt.user_template, context).trim()
  return {
    systemPrompt,
    userPrompt,
    maxTokens: prompt.category === 'landing_page' || prompt.category === 'blog' ? 2200 : 1200,
    temperature: prompt.category === 'custom' ? 0.6 : 0.5,
  }
}

export function buildDefaultCategoryPrompt(
  category: CrmAiPromptCategory,
  context: Record<string, unknown>,
  brandVoice?: CrmAiBrandVoiceRecord | null,
): CrmAiCompletionPlan {
  const system = baseSystemPrompt(brandVoice)
  const brief = getContextString(context, 'brief') || getContextString(context, 'context_text') || renderContextBlock(context, ['goal', 'audience', 'offer', 'source_text'])
  switch (category) {
    case 'email':
      return {
        systemPrompt: `${system}\n\nWrite a complete email draft with a clear subject line on the first line prefixed by "Subject:". Then write the body.`,
        userPrompt: renderContextBlock(context, ['goal', 'audience', 'offer', 'cta', 'context_text']) || `Brief: ${brief}`,
        maxTokens: 1400,
        temperature: 0.55,
      }
    case 'sms':
      return {
        systemPrompt: `${system}\n\nWrite a single SMS. Plain text only. Keep it under 160 characters unless the prompt explicitly asks otherwise.`,
        userPrompt: renderContextBlock(context, ['goal', 'audience', 'offer', 'context_text']) || `Brief: ${brief}`,
        maxTokens: 400,
        temperature: 0.55,
      }
    case 'blog':
      return {
        systemPrompt: `${system}\n\nWrite SEO-aware blog copy with useful structure, clear headings, and no generic intro fluff.`,
        userPrompt: renderContextBlock(context, ['keyword', 'audience', 'deliverable', 'context_text']) || `Brief: ${brief}`,
        maxTokens: 2200,
        temperature: 0.5,
      }
    case 'ad_copy':
      return {
        systemPrompt: `${system}\n\nWrite ad copy variants with strong hooks, concrete benefits, and explicit CTAs.`,
        userPrompt: renderContextBlock(context, ['offer', 'audience', 'angle', 'context_text']) || `Brief: ${brief}`,
        maxTokens: 900,
        temperature: 0.65,
      }
    case 'product_description':
      return {
        systemPrompt: `${system}\n\nWrite a product description that leads with the buyer outcome, then supports it with specifics.`,
        userPrompt: renderContextBlock(context, ['product_name', 'audience', 'offer', 'context_text']) || `Brief: ${brief}`,
        maxTokens: 900,
        temperature: 0.5,
      }
    case 'review_reply':
      return {
        systemPrompt: `${system}\n\nWrite a concise, professional review reply. Sound calm, appreciative, and specific.`,
        userPrompt: renderContextBlock(context, ['rating', 'review_text', 'context_text']) || `Review: ${brief}`,
        maxTokens: 320,
        temperature: 0.35,
      }
    case 'bio':
      return {
        systemPrompt: `${system}\n\nWrite a short professional bio with specific credibility markers and zero fluff.`,
        userPrompt: renderContextBlock(context, ['person_name', 'role', 'context_text']) || `Brief: ${brief}`,
        maxTokens: 700,
        temperature: 0.45,
      }
    case 'landing_page':
      return {
        systemPrompt: `${system}\n\nWrite a landing page draft with headline, subhead, proof, objections, CTA, and FAQ sections.`,
        userPrompt: renderContextBlock(context, ['offer', 'audience', 'goal', 'context_text']) || `Brief: ${brief}`,
        maxTokens: 2400,
        temperature: 0.5,
      }
    case 'custom':
    default:
      return {
        systemPrompt: system,
        userPrompt: brief || 'Write the requested copy.',
        maxTokens: 1200,
        temperature: 0.55,
      }
  }
}

export function buildRewritePlan(input: {
  text: string
  tone?: string
  length?: 'shorter' | 'same' | 'longer'
  instructions?: string
  brandVoice?: CrmAiBrandVoiceRecord | null
}): CrmAiCompletionPlan {
  const systemPrompt = `${baseSystemPrompt(input.brandVoice)}\n\nRewrite the supplied text. Preserve the underlying meaning while following the requested tone and length. Output only the rewritten text.`
  const lengthLine =
    input.length === 'shorter' ? 'Length: make it materially shorter.' :
    input.length === 'longer' ? 'Length: make it materially longer with one or two useful supporting details.' :
    'Length: keep it close to the original length.'
  const toneLine = input.tone ? `Tone: ${input.tone}` : 'Tone: keep the intent but improve clarity.'
  const instructionsLine = input.instructions?.trim() ? `Extra instructions: ${input.instructions.trim()}` : ''
  const userPrompt = [toneLine, lengthLine, instructionsLine, '---', input.text.trim()].filter(Boolean).join('\n\n')
  return { systemPrompt, userPrompt, maxTokens: 900, temperature: 0.4 }
}

export function buildSubjectLinePlan(input: {
  body: string
  tone?: string
  brandVoice?: CrmAiBrandVoiceRecord | null
}): CrmAiCompletionPlan {
  const systemPrompt = `${baseSystemPrompt(input.brandVoice)}\n\nGenerate exactly 5 subject lines. One per line. No numbering, no quotes, no commentary.`
  const toneLine = input.tone ? `Tone: ${input.tone}` : ''
  const userPrompt = [toneLine, 'Email body:', input.body.trim()].filter(Boolean).join('\n\n')
  return { systemPrompt, userPrompt, maxTokens: 320, temperature: 0.65 }
}

export function buildCampaignPlanPlan(input: {
  goalDescription: string
  audienceDescription: string
  tone?: string
  deadline?: string
  brandVoice?: CrmAiBrandVoiceRecord | null
}): CrmAiCompletionPlan {
  const systemPrompt = `${baseSystemPrompt(input.brandVoice)}\n\nReturn exactly one JSON object with these keys and no prose outside the JSON: campaign_name, core_angle, subject_lines, email_body, sms_follow_up, landing_page_copy, schedule, notes.`
  const userPrompt = [
    `Goal: ${input.goalDescription.trim()}`,
    `Audience: ${input.audienceDescription.trim()}`,
    input.tone?.trim() ? `Tone: ${input.tone.trim()}` : '',
    input.deadline?.trim() ? `Deadline: ${input.deadline.trim()}` : '',
    'Requirements:',
    '- subject_lines: array of exactly 5 strings',
    '- email_body: complete email draft',
    '- sms_follow_up: one short follow-up SMS',
    '- landing_page_copy: concise landing page draft with sections',
    '- schedule: array of 3 to 5 objects with day_offset (number), channel (email|sms|landing_page), objective (string)',
    '- notes: array of 3 concise strategic notes',
  ].filter(Boolean).join('\n')
  return { systemPrompt, userPrompt, maxTokens: 2200, temperature: 0.55 }
}

export async function runCrmAiCompletion(plan: CrmAiCompletionPlan): Promise<CrmAiCompletionResult> {
  const client = getAnthropicClient()
  const data = await client.messages.create({
    model: CRM_AI_MODEL,
    max_tokens: Math.max(64, Math.floor(plan.maxTokens ?? 1200)),
    temperature: typeof plan.temperature === 'number' ? plan.temperature : 0.5,
    system: plan.systemPrompt,
    messages: [{ role: 'user', content: plan.userPrompt }],
  })
  const text = data.content
    .map((entry) => (entry.type === 'text' ? entry.text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Empty response from AI')
  return {
    text,
    model: data.model || CRM_AI_MODEL,
    tokensIn: Math.max(0, Math.floor(data.usage.input_tokens ?? 0)),
    tokensOut: Math.max(0, Math.floor(data.usage.output_tokens ?? 0)),
  }
}

function splitIntoStreamChunks(text: string): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    const size = text[i] === '\n' ? 1 : Math.min(3, text.length - i)
    chunks.push(text.slice(i, i + size))
    i += size
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export function createCrmAiSseResponse(
  worker: () => Promise<{ text: string; meta?: Record<string, unknown> }>,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown> | '[DONE]') => {
        const data = payload === '[DONE]' ? '[DONE]' : JSON.stringify(payload)
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))
      }

      try {
        send({ type: 'status', phase: 'queued' })
        const result = await worker()
        for (const chunk of splitIntoStreamChunks(result.text)) {
          send({ type: 'delta', text: chunk })
          await sleep(4)
        }
        send({ type: 'done', text: result.text, ...(result.meta || {}) })
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'AI request failed' })
      } finally {
        send('[DONE]')
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

export function parseJsonObjectFromModel<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed
  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')
  const sliced = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate
  try {
    return JSON.parse(sliced) as T
  } catch {
    return fallback
  }
}

export function parseSubjectLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/^["'](.*)["']$/, '$1'))
    .filter(Boolean)
    .slice(0, 5)
}

export interface CrmAiCampaignPlan {
  campaign_name: string
  core_angle: string
  subject_lines: string[]
  email_body: string
  sms_follow_up: string
  landing_page_copy: string
  schedule: Array<{ day_offset: number; channel: 'email' | 'sms' | 'landing_page'; objective: string }>
  notes: string[]
}

export function sanitizeCampaignPlan(raw: string): CrmAiCampaignPlan {
  const parsed = parseJsonObjectFromModel<Partial<CrmAiCampaignPlan>>(raw, {})
  const subjectLines = Array.isArray(parsed.subject_lines) ? parsed.subject_lines.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5) : []
  const notes = Array.isArray(parsed.notes) ? parsed.notes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5) : []
  const schedule: CrmAiCampaignPlan['schedule'] = Array.isArray(parsed.schedule)
    ? parsed.schedule
      .map((item) => {
        const row = item as Partial<{ day_offset: unknown; channel: unknown; objective: unknown }>
        const channel: CrmAiCampaignPlan['schedule'][number]['channel'] =
          row.channel === 'sms' || row.channel === 'landing_page' ? row.channel : 'email'
        return {
          day_offset: Math.max(0, Math.floor(Number(row.day_offset ?? 0) || 0)),
          channel,
          objective: String(row.objective || '').trim(),
        }
      })
      .filter((item) => item.objective)
      .slice(0, 5)
    : []

  return {
    campaign_name: String(parsed.campaign_name || 'AI campaign draft').trim() || 'AI campaign draft',
    core_angle: String(parsed.core_angle || '').trim(),
    subject_lines: subjectLines,
    email_body: String(parsed.email_body || '').trim(),
    sms_follow_up: String(parsed.sms_follow_up || '').trim(),
    landing_page_copy: String(parsed.landing_page_copy || '').trim(),
    schedule,
    notes,
  }
}
