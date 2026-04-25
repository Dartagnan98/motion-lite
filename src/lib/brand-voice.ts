import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), '..', 'store', 'motion.db')

function db(): Database.Database {
  const d = new Database(DB_PATH)
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  return d
}

let tableEnsured = false

export function ensureBrandVoiceTable() {
  if (tableEnsured) return
  const d = db()
  try {
    d.exec(`
      CREATE TABLE IF NOT EXISTS brand_voice (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL UNIQUE,
        voice_sample_text TEXT NOT NULL DEFAULT '',
        tone_words_json TEXT NOT NULL DEFAULT '[]',
        do_words_json TEXT NOT NULL DEFAULT '[]',
        avoid_words_json TEXT NOT NULL DEFAULT '[]',
        style_rules_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `)
    d.exec(`CREATE INDEX IF NOT EXISTS idx_brand_voice_workspace ON brand_voice(workspace_id)`)
    tableEnsured = true
  } finally {
    d.close()
  }
}

export interface BrandVoice {
  id: number
  workspace_id: number
  voice_sample_text: string
  tone_words: string[]
  do_words: string[]
  avoid_words: string[]
  style_rules: string[]
  created_at: string
  updated_at: string
}

interface BrandVoiceRow {
  id: number
  workspace_id: number
  voice_sample_text: string
  tone_words_json: string
  do_words_json: string
  avoid_words_json: string
  style_rules_json: string
  created_at: string
  updated_at: string
}

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.map((s) => String(s ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

function normalizeList(values: unknown): string[] {
  if (Array.isArray(values)) return values.map((v) => String(v ?? '').trim()).filter(Boolean)
  if (typeof values === 'string') return values.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean)
  return []
}

function rowToVoice(r: BrandVoiceRow): BrandVoice {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    voice_sample_text: r.voice_sample_text,
    tone_words: parseList(r.tone_words_json),
    do_words: parseList(r.do_words_json),
    avoid_words: parseList(r.avoid_words_json),
    style_rules: parseList(r.style_rules_json),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function ensureRow(workspaceId: number): BrandVoiceRow {
  ensureBrandVoiceTable()
  const d = db()
  try {
    const existing = d.prepare('SELECT * FROM brand_voice WHERE workspace_id = ? LIMIT 1').get(workspaceId) as BrandVoiceRow | undefined
    if (existing) return existing
    const now = new Date().toISOString()
    const result = d.prepare(`
      INSERT INTO brand_voice (workspace_id, voice_sample_text, tone_words_json, do_words_json, avoid_words_json, style_rules_json, created_at, updated_at)
      VALUES (?, '', '[]', '[]', '[]', '[]', ?, ?)
    `).run(workspaceId, now, now)
    return d.prepare('SELECT * FROM brand_voice WHERE id = ?').get(Number(result.lastInsertRowid)) as BrandVoiceRow
  } finally {
    d.close()
  }
}

export function getBrandVoice(workspaceId: number): BrandVoice {
  return rowToVoice(ensureRow(workspaceId))
}

export interface BrandVoicePatch {
  voice_sample_text?: string
  tone_words?: unknown
  do_words?: unknown
  avoid_words?: unknown
  style_rules?: unknown
}

export function updateBrandVoice(workspaceId: number, patch: BrandVoicePatch): BrandVoice {
  const existing = ensureRow(workspaceId)
  const next = {
    voice_sample_text: patch.voice_sample_text !== undefined ? String(patch.voice_sample_text) : existing.voice_sample_text,
    tone_words_json: patch.tone_words !== undefined ? JSON.stringify(normalizeList(patch.tone_words)) : existing.tone_words_json,
    do_words_json: patch.do_words !== undefined ? JSON.stringify(normalizeList(patch.do_words)) : existing.do_words_json,
    avoid_words_json: patch.avoid_words !== undefined ? JSON.stringify(normalizeList(patch.avoid_words)) : existing.avoid_words_json,
    style_rules_json: patch.style_rules !== undefined ? JSON.stringify(normalizeList(patch.style_rules)) : existing.style_rules_json,
  }
  const d = db()
  try {
    d.prepare(`
      UPDATE brand_voice
      SET voice_sample_text = ?, tone_words_json = ?, do_words_json = ?, avoid_words_json = ?, style_rules_json = ?, updated_at = ?
      WHERE workspace_id = ?
    `).run(
      next.voice_sample_text,
      next.tone_words_json,
      next.do_words_json,
      next.avoid_words_json,
      next.style_rules_json,
      new Date().toISOString(),
      workspaceId,
    )
  } finally {
    d.close()
  }
  return getBrandVoice(workspaceId)
}

/**
 * Build a system-prompt fragment that injects this workspace's brand voice
 * guardrails into any AI call. Returns '' if no voice has been set.
 *
 * Usage:
 *   const guardrails = buildBrandVoiceSystemPrompt(getBrandVoice(workspaceId))
 *   const systemPrompt = `${baseInstructions}\n\n${guardrails}`.trim()
 */
export function buildBrandVoiceSystemPrompt(voice: BrandVoice | null | undefined): string {
  if (!voice) return ''
  const parts: string[] = []
  if (voice.voice_sample_text.trim()) parts.push(`Brand voice sample (imitate this style):\n${voice.voice_sample_text.trim()}`)
  if (voice.tone_words.length) parts.push(`Tone: ${voice.tone_words.join(', ')}`)
  if (voice.do_words.length) parts.push(`Prefer these words and phrases: ${voice.do_words.join(', ')}`)
  if (voice.avoid_words.length) parts.push(`Avoid these words and phrases: ${voice.avoid_words.join(', ')}`)
  if (voice.style_rules.length) parts.push(`Style rules:\n- ${voice.style_rules.join('\n- ')}`)
  return parts.length ? `Brand voice guardrails:\n\n${parts.join('\n\n')}` : ''
}

/**
 * Use Anthropic to read a writing sample and extract structured voice
 * guardrails (tone words, do/avoid words, style rules). Caller supplies
 * the API key (settings or env). Returns { tone_words, do_words,
 * avoid_words, style_rules } or throws.
 */
export async function analyzeVoiceSample(sample: string, apiKey: string): Promise<{
  tone_words: string[]
  do_words: string[]
  avoid_words: string[]
  style_rules: string[]
  rationale: string
}> {
  if (!sample.trim()) throw new Error('Sample is empty')
  if (!apiKey) throw new Error('Anthropic API key not configured')

  const systemPrompt = `You analyze writing samples and extract structured voice guardrails. Return JSON only — no preamble, no commentary, no markdown fences.

Schema:
{
  "tone_words": string[],     // 3-7 single words capturing the FEEL of the writing (e.g. "direct", "warm", "skeptical")
  "do_words": string[],       // 5-12 words/short phrases the writer actually uses or would use
  "avoid_words": string[],    // 5-12 words/phrases NOT in this voice — generic AI filler the writer would never say
  "style_rules": string[],    // 4-8 operational rules (one per line, in imperative form, e.g. "Lead with the result, not the setup.")
  "rationale": string         // 1-2 sentence summary of what makes this voice distinct
}`

  const userPrompt = `Writing sample:\n"""\n${sample.trim()}\n"""\n\nExtract the voice guardrails. JSON only.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 200)}`)
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }> }
  const text = data.content?.find((c) => c.type === 'text')?.text || ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI response did not contain JSON')

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
  return {
    tone_words: normalizeList(parsed.tone_words),
    do_words: normalizeList(parsed.do_words),
    avoid_words: normalizeList(parsed.avoid_words),
    style_rules: normalizeList(parsed.style_rules),
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
  }
}
