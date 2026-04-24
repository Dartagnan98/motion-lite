/**
 * Smart Agent Runtime - Executes agents using Claude API with:
 * - Prompt caching (90% cost reduction on system prompts)
 * - Intelligent model routing (Haiku default, Sonnet/Opus for complex)
 * - Cost circuit breakers (daily budget caps)
 * - Session management (auto-trim at limits)
 * - Prompt injection defense
 * - Streaming support for chat UI
 * - BYOK (Bring Your Own Key) from api_keys table
 * - Skill injection (matched skills loaded into system prompt)
 * - Skill execution tracking with circuit breakers
 * - WAL-style learnings capture
 */

import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { spawn } from 'child_process'
import { getTask, updateTask, getAgent, updateAgent, createTaskActivity, getAgentReferences, searchAgentReferences } from './db'
import { matchSkills, buildSkillContext, startSkillExecution, completeSkillExecution, failSkillExecution, logLearning, getInstalledSkills } from './skills'
import { getInternalApiSecret } from './auth'
import { detectProvider, buildFetchConfig, normalizeResponse, newStreamState, parseStreamLine, calculateCost, canonicalModel, type ProviderType } from './llm-provider'
import { ragQuery, ragIngest } from './rag-client'
import type { Task } from './types'

const AGENTS_DIR = resolve(process.cwd(), '..', 'agents')

// ─── Agent Config Loading ───

interface AgentConfig {
  soul: string
  memory: string
  skills: string[]
  externalSkills: string[]
  canDelegateTo: string[]
}

export function loadAgentConfig(agentId: string): AgentConfig {
  // Validate agentId to prevent path traversal (only allow alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    return { soul: '', memory: '', skills: [], externalSkills: [], canDelegateTo: [] }
  }

  // Load from DB first (primary source of truth)
  const agent = getAgent(agentId)
  let soul = agent?.soul_md || ''
  let memory = agent?.memory_md || ''
  let canDelegateTo: string[] = agent?.can_delegate_to ? agent.can_delegate_to.split(',').filter(Boolean) : []

  // Fall back to files if DB has no soul_md (backward compat)
  if (!soul) {
    const dir = resolve(AGENTS_DIR, agentId)
    // Double-check resolved path stays within AGENTS_DIR
    if (!dir.startsWith(AGENTS_DIR)) {
      return { soul: '', memory: '', skills: [], externalSkills: [], canDelegateTo: [] }
    }
    soul = existsSync(resolve(dir, 'soul.md'))
      ? readFileSync(resolve(dir, 'soul.md'), 'utf8')
      : ''
    memory = existsSync(resolve(dir, 'memory.md'))
      ? readFileSync(resolve(dir, 'memory.md'), 'utf8')
      : memory
  }

  let skills: string[] = []
  let externalSkills: string[] = []

  const dir = resolve(AGENTS_DIR, agentId)
  if (!dir.startsWith(AGENTS_DIR)) {
    return { soul, memory, skills, externalSkills, canDelegateTo }
  }
  if (existsSync(resolve(dir, 'skills.json'))) {
    try {
      const raw = JSON.parse(readFileSync(resolve(dir, 'skills.json'), 'utf8'))
      skills = raw.skills || []
      externalSkills = raw.external_skills || []
      if (canDelegateTo.length === 0) canDelegateTo = raw.can_delegate_to || []
    } catch { /* ignore parse errors */ }
  }

  return { soul, memory, skills, externalSkills, canDelegateTo }
}

export function updateAgentMemory(agentId: string, newEntry: string): void {
  // Validate agentId to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) return

  // Update in DB (primary source)
  const agent = getAgent(agentId)
  const currentMemory = agent?.memory_md || ''
  const updatedMemory = currentMemory.trimEnd() + '\n\n' + `[${new Date().toISOString()}] ${newEntry}`
  updateAgent(agentId, { memory_md: updatedMemory })

  // Also write to file for backward compat
  const memoryPath = resolve(AGENTS_DIR, agentId, 'memory.md')
  if (!memoryPath.startsWith(AGENTS_DIR)) return
  if (!existsSync(memoryPath)) return
  const current = readFileSync(memoryPath, 'utf8')
  const updated = current.trimEnd() + '\n\n' + newEntry + '\n'
  writeFileSync(memoryPath, updated)
}

// ─── Prompt Injection Defense ───

const BLOCKED_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:new|different)/i,
  /system\s*:\s*you\s+are/i,
  /\<\s*system\s*\>/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+a\s+(?:different|new)/i,
  /override\s+(?:your\s+)?(?:instructions|system\s+prompt)/i,
  /disregard\s+(?:all\s+)?(?:prior|previous)/i,
]

export function validateInput(message: string): { safe: boolean; sanitized: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(message)) {
      return { safe: false, sanitized: '' }
    }
  }
  // Strip potential control characters but keep normal unicode
  const sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  return { safe: true, sanitized }
}

// ─── Intelligent Model Routing ───

type ModelTier = 'haiku' | 'sonnet' | 'opus'

// Default models per provider. OpenRouter unlocks cheaper non-Claude models.
// OpenRouter tiers:
//   Lite:     GPT-5 Mini     $0.25/$2     — reasoning + tool use, 400K ctx
//   Standard: Kimi K2        $0.55/$2.20  — Sonnet-level tool use at 5x less cost
//   Max:      Opus 4.6       $5/$25       — full power for audits/critical decisions
const PROVIDER_MODELS: Record<ProviderType, Record<ModelTier, string>> = {
  anthropic: {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6',
  },
  openrouter: {
    haiku: 'gpt-5-mini',            // $0.25/$2 — reasoning, 400K ctx, 128K output
    sonnet: 'kimi-k2',              // $0.55/$2.20 — Sonnet-tier tool use, 131K ctx
    opus: 'claude-opus-4-6',        // $5/$25 — full power, critical tasks
  },
}

// Active provider — set during runtime based on API key
let activeProvider: ProviderType = 'anthropic'

export function getModelId(tier: ModelTier): string {
  return PROVIDER_MODELS[activeProvider][tier]
}

// Legacy compat: keep MODEL_IDS pointing to current provider
const MODEL_IDS: Record<ModelTier, string> = new Proxy({} as Record<ModelTier, string>, {
  get(_target, prop: string) {
    return PROVIDER_MODELS[activeProvider][prop as ModelTier]
  },
})

// Keywords/patterns that indicate higher complexity
const SONNET_SIGNALS = [
  /analy[sz]/i, /research/i, /compare/i, /review/i, /audit/i,
  /write\s+(?:a\s+)?(?:report|article|post|email|script|copy)/i,
  /explain\s+(?:how|why|the)/i, /strategy/i, /recommend/i,
  /optimize/i, /evaluate/i, /create\s+(?:a\s+)?(?:plan|outline|proposal)/i,
  /summarize\s+(?:all|everything|the\s+\w+\s+data)/i,
  /multi-step/i, /step\s+by\s+step/i,
  // Tool-action patterns: anything that implies creating/modifying should use Sonnet
  /create\s+(?:a\s+)?(?:project|task|doc|event|folder|workspace|label|stage)/i,
  /(?:add|make|set\s*up|build)\s+(?:a\s+)?(?:project|task|doc|event|folder|workspace)/i,
  /schedule\s+(?:a\s+)?(?:meeting|event|call)/i,
  /(?:update|change|modify|edit|delete|remove)\s+(?:the\s+)?(?:project|task|doc|event)/i,
  /(?:assign|delegate|move|prioritize)/i,
  // Retrieval patterns: anything that asks to fetch/share content
  /(?:send|show|share|get|pull\s*up|open|fetch|read)\s+(?:me\s+)?(?:the\s+)?(?:doc|document|project|task|meeting|note|plan|link)/i,
  /doc\s*#?\d+/i,
  // Document editing: any doc creation/update MUST use Sonnet to avoid truncated tool JSON
  /(?:write|draft|update|edit|add\s+to|fill\s+in|complete|finish|rewrite|revise|fix)\s+(?:the\s+)?(?:doc|document|report|proposal|contract|brief|template|section|page)/i,
  /(?:add|include|insert|put|append)\s+(?:a\s+)?(?:section|paragraph|clause|item|line|row|column|header|footer|table)/i,
  // Web search patterns
  /(?:search|look\s*up|google|find\s+(?:me\s+)?(?:info|information|article|news))/i,
  /what\s+(?:is|are|was|were)\s+/i,
  /(?:how\s+(?:to|do|does|can)|who\s+(?:is|are)|where\s+(?:is|are|can))/i,
]

const OPUS_SIGNALS = [
  /full\s+audit/i, /critical\s+decision/i, /comprehensive\s+review/i,
  /legal\s+review/i, /financial\s+analysis/i, /security\s+audit/i,
]

export function classifyComplexity(message: string): ModelTier {
  // Check for opus-level signals first
  for (const pattern of OPUS_SIGNALS) {
    if (pattern.test(message)) return 'opus'
  }
  // Check for sonnet-level signals
  for (const pattern of SONNET_SIGNALS) {
    if (pattern.test(message)) return 'sonnet'
  }
  // Default to haiku for simple stuff
  return 'haiku'
}

// MotionLite Tiers: branded model routing that replaces raw model selection
// - lite: Haiku only. Fast, cheap.
// - standard: Haiku default, auto-escalates to Sonnet for complex tasks + skill triggers
// - max: Sonnet default, auto-escalates to Opus for research/audits
export function resolveModel(complexity: ModelTier, tierOrPreference?: string | null): string {
  const tier = tierOrPreference || 'standard'

  // Legacy: raw model tier names (haiku/sonnet/opus) still work for backward compat
  if (tier in MODEL_IDS) return MODEL_IDS[tier as ModelTier]

  // Legacy: full model IDs still work
  if (tier.startsWith('claude-')) return tier

  // MotionLite Lite: always Haiku, never escalate
  if (tier === 'lite') return MODEL_IDS.haiku

  // MotionLite Max: Sonnet default, escalate to Opus for complex
  if (tier === 'max') return complexity === 'opus' ? MODEL_IDS.opus : MODEL_IDS.sonnet

  // MotionLite Standard (default / 'auto' / 'standard'): Haiku default, escalate to Sonnet for complex
  if (complexity === 'opus' || complexity === 'sonnet') return MODEL_IDS.sonnet
  return MODEL_IDS.haiku
}

// ─── Dynamic Token Limits ───

function getMaxTokens(complexity: ModelTier, hasSkills: boolean): number {
  if (complexity === 'haiku' && !hasSkills) return 4096  // bumped from 2048 — tool calls need room
  if (hasSkills) return 8192
  return 4096
}

// ─── Three-Tier Context System (mirrors Claude Code / OpenClaw) ───
//
// Tier 1 (always, cached): soul.md + skill descriptions + tool defs + client context
// Tier 2 (on trigger):     full SKILL.md body loaded when message matches skill description
// Tier 3 (on demand):      reference docs loaded by agent via search_references tool
//

interface CachedSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

function loadClientContext(): string {
  try {
    const { getBusinesses, getClientProfile, getFolderContents } = require('./db')
    const businesses = getBusinesses()
    if (!businesses || businesses.length === 0) return ''
    const blocks = businesses.map((b: Record<string, unknown>) => {
      let block = `## ${b.name}`
      if (b.industry) block += ` (${b.industry})`
      if (b.status && b.status !== 'active') block += ` [${(b.status as string).toUpperCase()}]`
      block += '\n'
      if (b.slug) block += `- Slug: ${b.slug} (use for ad queries)\n`
      if (b.location) block += `- Location: ${b.location}\n`
      if (b.context) block += `- Background: ${b.context}\n`
      if (b.brand_voice) block += `- Brand Voice: ${b.brand_voice}\n`
      if (b.target_audience) block += `- Target Audience: ${b.target_audience}\n`
      if (b.goals) block += `- Goals: ${b.goals}\n`
      if (b.services) block += `- Services: ${b.services}\n`
      if (b.ad_account_id) block += `- Ad Account: ${b.ad_account_id}\n`
      if (b.page_id) block += `- Page ID (for promoted_object): ${b.page_id}\n`
      if (b.monthly_budget) block += `- Monthly Budget: $${b.monthly_budget}\n`
      if (b.instagram_handle) block += `- Instagram: ${b.instagram_handle}\n`
      if (b.tiktok_handle) block += `- TikTok: ${b.tiktok_handle}\n`
      if (b.facebook_page) block += `- Facebook: ${b.facebook_page}\n`
      if (b.website) block += `- Website: ${b.website}\n`
      if (b.offer) block += `- Current Offer: ${b.offer}\n`
      if (b.offer_details) block += `- Offer/Funnel Details: ${b.offer_details}\n`
      // Show linked client name
      if (b.client_id && (b.client_id as number) > 0) {
        try {
          const client = getClientProfile(b.client_id as number)
          if (client) block += `- Client: ${client.name}\n`
        } catch { /* ignore */ }
      }
      // Folder contents summary
      try {
        if (b.folder_id) {
          const contents = getFolderContents(b.folder_id as number)
          const parts: string[] = []
          if (contents.docs.length > 0) parts.push(`${contents.docs.length} docs`)
          if (contents.projects.length > 0) parts.push(`${contents.projects.length} projects`)
          if (contents.sheets.length > 0) parts.push(`${contents.sheets.length} sheets`)
          if (parts.length > 0) block += `- Folder: ${parts.join(', ')}\n`
        }
      } catch { /* ignore */ }
      return block
    })
    return `\n\n# Businesses\nThese are the businesses you manage. Use their context when making decisions, creating content, or analyzing ads. Use the slug field when querying ad performance data.\n\n${blocks.join('\n')}`
  } catch { return '' }
}

// Tier 1: Build skill description catalog (name + description only, ~100 words each)
function buildSkillCatalog(agentId: string): string {
  try {
    const db = require('./db').getDb()
    // Get skills assigned to this agent
    let skills = db.prepare(`
      SELECT s.slug, s.name, s.description
      FROM installed_skills s
      INNER JOIN skill_agent_map m ON s.id = m.skill_id
      WHERE m.agent_id = ? AND m.enabled = 1 AND s.enabled = 1
      ORDER BY s.use_count DESC
    `).all(agentId) as { slug: string; name: string; description: string }[]

    // Fallback: all enabled skills
    if (skills.length === 0) {
      skills = db.prepare(`
        SELECT slug, name, description FROM installed_skills
        WHERE enabled = 1 ORDER BY use_count DESC LIMIT 20
      `).all() as { slug: string; name: string; description: string }[]
    }

    if (skills.length === 0) return ''

    const entries = skills.map(s => {
      // Truncate description to ~100 words for Tier 1
      const desc = s.description.split(/\s+/).slice(0, 100).join(' ')
      return `- **${s.name}** (${s.slug}): ${desc}`
    })

    return `\n\n# Available Skills\nThese skills activate automatically when your message matches their description. You don't need to invoke them manually.\n${entries.join('\n')}`
  } catch { return '' }
}

// Build the full system prompt (Tier 1 content)
function buildSystemPrompt(agent: { name: string; role: string; model_preference?: string | null; allowed_tools?: string | null; can_delegate_to?: string | null; learnings_md?: string | null }, config: AgentConfig): string {
  let prompt = config.soul || `You are ${agent.name}, role: ${agent.role}.`

  if (config.memory) {
    prompt += `\n\n# Working Memory\n${config.memory}`
  }

  // Inject client profiles
  prompt += loadClientContext()

  // Skill catalog (Tier 1 - names + descriptions only)
  prompt += buildSkillCatalog(agent.name?.toLowerCase() || config.soul ? '' : '')

  // Inject current date so agent knows what "today" and "tomorrow" mean
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0]
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()]

  prompt += `\n\n# Current Date
Today is ${dayName}, ${today}. Tomorrow is ${tomorrow}. Use YYYY-MM-DD format for all dates.`

  prompt += `\n\n# Available Tools
You have FULL access to the Motion Lite database through tools. You can create, read, update, and delete anything.

Your tools include:
- **Tasks**: list_tasks, create_task, update_task, complete_task, search_tasks, get_subtasks, create_subtask
- **Projects**: list_projects, get_project_detail, create_project, update_project, create_stage
- **Workspaces**: list_workspaces, create_workspace, create_folder
- **Calendar**: get_calendar_events, get_free_slots, get_today_agenda
- **Docs**: create_doc, read_doc, update_doc (full rich text: bold, italic, headings, tables, code blocks, blockquotes, checklists, links, dividers)
- **Sheets**: create_sheet, read_sheet, list_sheets, update_sheet (spreadsheets with columns, rows, formulas, CSV import)
- **Clients**: list_clients, get_client, create_client, update_client
- **Knowledge**: search_knowledge, create_knowledge_entry
- **Meetings**: create_meeting_note, list_meeting_notes
- **Team**: list_team, list_agents, dispatch_task_to_agent, create_task_for_agent
- **Comments**: post_comment, post_status_update, log_agent_activity
- **Meta Ads**: get_ad_performance, get_ad_daily_summary, get_ad_accounts, detect_creative_fatigue, get_budget_pacing, get_lead_alerts, spy_competitor_ads
- **Reports**: generate_client_report (creates performance report docs)
- **Outbound**: send_email (requires approval), schedule_post (requires approval)
- **Agent Dispatch**: dispatch_to_agent (chain workflows: Gary → Ricky → Sofia)
- **Web**: web_search, fetch_webpage
- **Other**: list_labels, create_label, list_attachments, request_approval, query_db, search_references, list_references, save_learning

IMPORTANT: Always use your tools to take action. Never say you "can't" do something if you have a tool for it. If asked to create a project, use create_project. If asked to create a task, use create_task. Execute, don't explain.

# App & Links
ALWAYS include in-app links in your responses when you create, find, or reference anything:
- Docs: [Doc Title](/doc/{public_id})
- Projects: [Project Name](/project/{public_id})
- Tasks: [Task Title](/projects-tasks) (link to task board)

RULES:
1. When you create something (task, doc, project), ALWAYS include the link in your reply.
2. When you look something up, ALWAYS include the link.
3. When the user says "send me the doc", use read_doc, then reply with: [Document Title](/doc/{workspaceId}/{docId})
4. NEVER say you "can't send" or "can't share" anything. You have full access. Use the tool + link.
5. For web search results, include the source URLs so the user can click through.

# Rules
- Execute tasks, don't just plan them
- When creating tasks, always use the create_task tool. Write documents using create_doc tool.
- When creating projects, always use the create_project tool.
- Post comments on tasks using post_comment to keep the team updated
- If a task requires approval (sending emails, modifying budgets), create an approval request
- Update task status when you start and finish work
- When you complete a task, post a comment with findings and mark it done
- Be concise in your responses
- If you're stuck or need user input, say so clearly in the chat

# CRITICAL: No Narration
NEVER narrate or describe what you are about to do. NEVER say "I'll now update the document" or "Let me create that for you" before using a tool. Just USE the tool. The user sees your tool calls in real time. After all tool calls complete, give a brief confirmation of what was done (with links). Wrong: "I'll update the doc now." → Right: [calls update_doc tool] → "Done. Updated: [Doc Title](/doc/1/5)"

# CRITICAL: Never Fail Silently
**After EVERY tool call, check the result. If it contains an error, STOP and tell the user immediately.**

Rules:
1. After each api_request or tool call, read the result. If it has "error", a non-200 status, or unexpected HTML -- STOP. Do NOT keep calling the same endpoint hoping it works.
2. Report the EXACT error message to the user in plain English. Include: what you tried, what went wrong, and what you think the fix is.
3. If a multi-step workflow fails at step 2, tell the user: "Step 1 succeeded (campaign created, ID: X). Step 2 failed because: [error]. Here's what I recommend."
4. Never summarize 5+ failed tool calls as "having issues." Each failure must be reported with specifics.
5. If you get the same error twice, STOP trying. Don't burn 10 tool calls on the same broken endpoint. Report it and ask the user how to proceed.
6. Never say "the backend team needs to fix this." YOU are the team. Explain the specific error so the user can act on it.
7. After completing a multi-step task, give a clear status report: what succeeded, what failed, what's left.

# Document Formatting
You have FULL rich text control in docs. Use markdown in content and it auto-converts:
- **Bold**: **text**, *Italic*: *text*, ~~Strikethrough~~: ~~text~~, \`Code\`: \`text\`
- Links: [text](url)
- Headings: # H1, ## H2, ### H3
- Lists: - bullet, 1. numbered, - [ ] checkbox, - [x] checked
- Blockquotes: > text
- Dividers: ---
- Code blocks: \`\`\`language ... \`\`\`

For TABLES, pass content as a JSON block array:
[{"id":"a","type":"heading1","content":"Title"},{"id":"b","type":"table","content":"","rows":[["Header 1","Header 2"],["Cell 1","Cell 2"]]}]

You can mix: put regular blocks before/after the table in the same JSON array. Always use the table block type with rows[][] for tabular data -- never use plain text tables.

# Spreadsheets
Use create_sheet to make spreadsheets with columns and rows. Use update_sheet to add/modify data. Sheets support formulas (SUM, AVERAGE, COUNT, MAX, MIN, IF) and cell references (A1, B2, A1:A5). Use import_csv to bulk import data.`

  if (config.canDelegateTo.length > 0) {
    prompt += `\n\n# Inter-Agent Communication
You work on a team with: ${config.canDelegateTo.join(', ')}

Communicate through comments on tasks -- just like a real team member would. Your comments are visible in the inbox.

Tools:
- post_comment: Leave a comment on any task. Mention agents with @name. Use for updates, questions, handoffs, findings.
- create_task_for_agent: Create a new task and assign it to another agent. An intro comment is auto-posted.
- dispatch_task_to_agent: Reassign an existing task.

Write comments naturally: "Hey @gary, can you check the Client A brand ad performance? CPA looks high." Not "Dispatching task to agent gary for ad analysis."

When a task requires expertise outside your role, delegate it. When you finish work, post a comment with your findings so the team can see what happened.`
  }

  // Learnings context (if agent has accumulated learnings)
  if (agent.learnings_md) {
    prompt += `\n\n# Learnings\n${agent.learnings_md}`
  }

  return prompt
}

// Build cached system prompt blocks (Tier 1 cached + Tier 2 dynamic)
export function buildCachedSystemPrompt(
  agent: { name: string; role: string; model_preference?: string | null; allowed_tools?: string | null; can_delegate_to?: string | null; learnings_md?: string | null },
  config: AgentConfig,
  skillContext?: string
): CachedSystemBlock[] {
  const basePrompt = buildSystemPrompt(agent, config)

  const blocks: CachedSystemBlock[] = [
    {
      type: 'text',
      text: basePrompt,
      cache_control: { type: 'ephemeral' }, // Tier 1: cached (soul + skill catalog + tools + client context)
    },
  ]

  // Tier 2: Skill context loaded when message triggers a skill (NOT cached - changes per message)
  if (skillContext) {
    blocks.push({
      type: 'text',
      text: skillContext,
    })
  }

  return blocks
}

// ─── Session Management ───

const MAX_TURNS_SOFT = 30
const MAX_TURNS_HARD = 50
const KEEP_RECENT_TURNS = 10

interface ConversationMessage {
  role: string
  content: unknown
}

export function trimConversation(messages: ConversationMessage[], maxTurns: number = KEEP_RECENT_TURNS): { messages: ConversationMessage[]; trimmed: boolean; warning?: string } {
  const turnCount = messages.filter(m => m.role === 'user').length

  if (turnCount <= maxTurns) {
    return { messages, trimmed: false }
  }

  if (turnCount >= MAX_TURNS_HARD) {
    // Keep only the most recent turns
    const recent = messages.slice(-maxTurns * 2)
    return {
      messages: [
        { role: 'user', content: '[Earlier conversation was trimmed for context management. Key context has been preserved in agent memory.]' },
        { role: 'assistant', content: [{ type: 'text', text: 'Understood. Continuing with the recent context.' }] },
        ...recent,
      ],
      trimmed: true,
      warning: 'Session auto-cleared (exceeded message limit). Starting fresh context.',
    }
  }

  if (turnCount >= MAX_TURNS_SOFT) {
    return {
      messages,
      trimmed: false,
      warning: `Session has ${turnCount} turns. Consider starting a new chat soon for best performance.`,
    }
  }

  return { messages, trimmed: false }
}

// ─── Markdown-to-Blocks converter for doc tools ───

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

function contentToBlockJson(content: string): string {
  // If it's already valid JSON blocks, use directly
  if (content.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
        // Ensure all blocks have IDs
        return JSON.stringify(parsed.map((b: Record<string, unknown>) => ({
          ...b,
          id: b.id || Math.random().toString(36).slice(2, 10),
        })))
      }
    } catch { /* not JSON, parse as markdown */ }
  }

  // Parse markdown to blocks
  const lines = content.split('\n')
  const blocks: { id: string; type: string; content: string; checked?: boolean; language?: string; rows?: string[][] }[] = []
  let inCodeBlock = false
  let codeContent = ''
  let codeLang = ''

  for (const line of lines) {
    const id = Math.random().toString(36).slice(2, 10)

    // Handle fenced code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ id, type: 'code', content: codeContent.trimEnd(), language: codeLang || undefined })
        inCodeBlock = false
        codeContent = ''
        codeLang = ''
      } else {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
      }
      continue
    }
    if (inCodeBlock) {
      codeContent += (codeContent ? '\n' : '') + line
      continue
    }

    if (line.startsWith('# ')) {
      blocks.push({ id, type: 'heading1', content: markdownToHtml(line.slice(2)) })
    } else if (line.startsWith('## ')) {
      blocks.push({ id, type: 'heading2', content: markdownToHtml(line.slice(3)) })
    } else if (line.startsWith('### ')) {
      blocks.push({ id, type: 'heading3', content: markdownToHtml(line.slice(4)) })
    } else if (line.startsWith('- [x] ') || line.startsWith('- [ ] ')) {
      blocks.push({ id, type: 'check_list', content: markdownToHtml(line.slice(6)), checked: line.startsWith('- [x]') })
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({ id, type: 'bulleted_list', content: markdownToHtml(line.slice(2)) })
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({ id, type: 'numbered_list', content: markdownToHtml(line.replace(/^\d+\.\s/, '')) })
    } else if (line.startsWith('> ')) {
      blocks.push({ id, type: 'blockquote', content: markdownToHtml(line.slice(2)) })
    } else if (line === '---' || line === '***' || line === '___') {
      blocks.push({ id, type: 'divider', content: '' })
    } else if (line.trim()) {
      blocks.push({ id, type: 'paragraph', content: markdownToHtml(line) })
    }
  }

  // Close unclosed code block
  if (inCodeBlock && codeContent) {
    blocks.push({ id: Math.random().toString(36).slice(2, 10), type: 'code', content: codeContent.trimEnd(), language: codeLang || undefined })
  }

  if (blocks.length === 0) {
    blocks.push({ id: Math.random().toString(36).slice(2, 10), type: 'paragraph', content: '' })
  }

  return JSON.stringify(blocks)
}

// ─── Tool Definitions for Claude API ───

function getToolDefinitions(allowedSkills: string[]) {
  const allTools = [
    {
      name: 'list_tasks',
      description: 'List tasks with optional filters',
      input_schema: {
        type: 'object' as const,
        properties: {
          workspace_id: { type: 'number' },
          project_id: { type: 'number' },
          status: { type: 'string' },
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
          limit: { type: 'number' },
        },
      },
    },
    {
      name: 'create_task',
      description: 'Create a new task. If no workspace_id provided, uses the default workspace.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string', description: 'Task title' },
          workspace_id: { type: 'number', description: 'Workspace ID (optional, defaults to first workspace)' },
          project_id: { type: 'number', description: 'Project ID (optional)' },
          priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
          assignee: { type: 'string' },
          due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format (e.g. 2026-03-08 for tomorrow)' },
          duration_minutes: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['title'],
      },
    },
    {
      name: 'update_task',
      description: 'Update an existing task',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: { type: 'number' },
          title: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string' },
          assignee: { type: 'string' },
          due_date: { type: 'string' },
        },
        required: ['id'],
      },
    },
    {
      name: 'complete_task',
      description: 'Mark a task as completed',
      input_schema: {
        type: 'object' as const,
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
    {
      name: 'search_tasks',
      description: 'Search tasks by keyword',
      input_schema: {
        type: 'object' as const,
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
    },
    {
      name: 'get_calendar_events',
      description: 'Get calendar events for a date range',
      input_schema: {
        type: 'object' as const,
        properties: {
          start: { type: 'string' },
          end: { type: 'string' },
        },
        required: ['start', 'end'],
      },
    },
    {
      name: 'get_free_slots',
      description: 'Find free time slots in the calendar',
      input_schema: {
        type: 'object' as const,
        properties: {
          date: { type: 'string' },
          duration_minutes: { type: 'number' },
        },
        required: ['date'],
      },
    },
    {
      name: 'get_today_agenda',
      description: 'Get today\'s schedule summary',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'list_workspaces',
      description: 'List all workspaces',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'list_projects',
      description: 'List projects',
      input_schema: {
        type: 'object' as const,
        properties: { workspace_id: { type: 'number' } },
      },
    },
    {
      name: 'get_project_detail',
      description: 'Get detailed project info with stages and tasks',
      input_schema: {
        type: 'object' as const,
        properties: { project_id: { type: 'number' } },
        required: ['project_id'],
      },
    },
    {
      name: 'list_agents',
      description: 'List all agents with status',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'dispatch_task_to_agent',
      description: 'Assign an existing task to another agent',
      input_schema: {
        type: 'object' as const,
        properties: {
          task_id: { type: 'number' },
          agent_id: { type: 'string' },
        },
        required: ['task_id', 'agent_id'],
      },
    },
    {
      name: 'create_task_for_agent',
      description: 'Create a new task and assign it to another agent. Use this to delegate new work to specialized agents (e.g. ask Gary to analyze ads, ask Ricky to write copy).',
      input_schema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Target agent ID (e.g. gary, ricky, sofia)' },
          title: { type: 'string', description: 'Task title/description' },
          description: { type: 'string', description: 'Detailed instructions for the agent' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          workspace_id: { type: 'number' },
        },
        required: ['agent_id', 'title'],
      },
    },
    {
      name: 'post_comment',
      description: 'Post a comment on a task, like a real team member would. Use this to communicate with other agents, leave status updates, ask questions, share findings, or hand off work. Comments are visible to all agents and the user in the inbox.',
      input_schema: {
        type: 'object' as const,
        properties: {
          task_id: { type: 'number', description: 'The task to comment on' },
          message: { type: 'string', description: 'Your comment (write naturally, like a team member)' },
          mention: { type: 'string', description: 'Agent ID to mention/notify (e.g. @gary)' },
        },
        required: ['task_id', 'message'],
      },
    },
    {
      name: 'log_agent_activity',
      description: 'Log a system activity for a task (status changes, assignments, completions). For conversational updates, use post_comment instead.',
      input_schema: {
        type: 'object' as const,
        properties: {
          task_id: { type: 'number' },
          agent_id: { type: 'string' },
          activity_type: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['task_id', 'agent_id', 'activity_type', 'message'],
      },
    },
    {
      name: 'create_doc',
      description: `Create a new document with rich formatting. Content is markdown that auto-converts to blocks.

Supported markdown:
- # Heading 1, ## Heading 2, ### Heading 3
- **bold**, *italic*, ~~strikethrough~~, \`inline code\`
- [link text](url)
- - bullet list, 1. numbered list
- - [ ] unchecked, - [x] checked
- > blockquote
- --- divider

For TABLES, use JSON blocks directly in content as a JSON array:
[{"id":"a1","type":"heading1","content":"Title"},{"id":"a2","type":"table","content":"","rows":[["Col A","Col B"],["val1","val2"]]}]

Block types: paragraph, heading1, heading2, heading3, bulleted_list, numbered_list, check_list, blockquote, divider, code, table, link, page-link, task_ref

For code blocks: {"id":"x","type":"code","content":"console.log('hi')","language":"javascript"}
For tables: {"id":"x","type":"table","content":"","rows":[["Header1","Header2"],["Cell1","Cell2"]]}

You can mix markdown text and JSON blocks. If content starts with [ and is valid JSON, it's used as blocks directly. Otherwise it's parsed as markdown.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' },
          workspace_id: { type: 'number' },
          content: { type: 'string', description: 'Markdown text OR JSON array of blocks. Use markdown for simple docs, JSON blocks for tables and advanced formatting.' },
          doc_type: { type: 'string' },
        },
        required: ['title', 'workspace_id'],
      },
    },
    {
      name: 'read_doc',
      description: 'Read a document. Returns the doc with its block content.',
      input_schema: {
        type: 'object' as const,
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
    {
      name: 'update_doc',
      description: `Update a document's title and/or content. Content follows the same format as create_doc: markdown text or JSON block array. Use JSON blocks when you need tables, code blocks with language, or mixed formatting. Use markdown for everything else.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          id: { type: 'number' },
          title: { type: 'string' },
          content: { type: 'string', description: 'Markdown text OR JSON array of blocks' },
        },
        required: ['id'],
      },
    },
    // ─── Sheet tools ───
    {
      name: 'create_sheet',
      description: 'Create a new spreadsheet with optional columns and initial rows',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Sheet name' },
          workspace_id: { type: 'number' },
          columns: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', description: 'text, number, select, date, checkbox' }, options: { type: 'array', items: { type: 'string' }, description: 'For select type columns' } }, required: ['name'] }, description: 'Column definitions' },
          rows: { type: 'array', items: { type: 'object' }, description: 'Array of row objects keyed by column name, e.g. [{"Name":"John","Amount":100}]' },
        },
        required: ['name'],
      },
    },
    {
      name: 'read_sheet',
      description: 'Read a spreadsheet. Returns columns and all rows.',
      input_schema: {
        type: 'object' as const,
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
    {
      name: 'list_sheets',
      description: 'List all spreadsheets',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'update_sheet',
      description: 'Update a spreadsheet: add/rename/delete columns, add/update/delete rows, rename sheet, or import CSV data',
      input_schema: {
        type: 'object' as const,
        properties: {
          sheet_id: { type: 'number' },
          action: { type: 'string', description: 'One of: rename_sheet, add_column, rename_column, delete_column, add_row, update_row, delete_row, import_csv' },
          name: { type: 'string', description: 'For rename_sheet or add_column' },
          type: { type: 'string', description: 'Column type for add_column: text, number, select, date, checkbox' },
          options: { type: 'array', items: { type: 'string' }, description: 'Options for select columns' },
          old_name: { type: 'string', description: 'For rename_column' },
          new_name: { type: 'string', description: 'For rename_column' },
          column_name: { type: 'string', description: 'For delete_column' },
          row_id: { type: 'number', description: 'For update_row or delete_row' },
          data: { type: 'object', description: 'Row data keyed by column name for add_row or update_row' },
          csv: { type: 'string', description: 'CSV string for import_csv' },
        },
        required: ['sheet_id', 'action'],
      },
    },
    {
      name: 'request_approval',
      description: 'Request human approval for a restricted action (sending email, modifying budget, publishing content)',
      input_schema: {
        type: 'object' as const,
        properties: {
          action_type: { type: 'string', description: 'email, budget_change, publish, message' },
          description: { type: 'string', description: 'What you want to do and why' },
          data: { type: 'string', description: 'JSON data for the action' },
        },
        required: ['action_type', 'description'],
      },
    },
    // ─── Tier 3: On-demand reference loading ───
    {
      name: 'search_references',
      description: 'Search your reference documents (client briefs, SOPs, checklists, templates). Use when you need detailed context about a client, process, or domain.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search term to find relevant reference docs' },
        },
        required: ['query'],
      },
    },
    {
      name: 'list_references',
      description: 'List all your reference documents by category',
      input_schema: {
        type: 'object' as const,
        properties: {
          category: { type: 'string', description: 'Filter by category: sop, client-brief, checklist, template, general' },
        },
      },
    },
    // ─── Project & Workspace Management ───
    {
      name: 'create_project',
      description: 'Create a new project in a workspace. Optionally add it to a folder.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Project name' },
          workspace_id: { type: 'number', description: 'Workspace ID (optional, defaults to first workspace)' },
          folder_id: { type: 'number', description: 'Folder ID (optional)' },
          color: { type: 'string', description: 'Hex color (optional)' },
          description: { type: 'string', description: 'Project description (optional)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'update_project',
      description: 'Update a project (name, description, status, color, priority, assignee, dates)',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
          color: { type: 'string' },
          priority: { type: 'string' },
          assignee: { type: 'string' },
          start_date: { type: 'string' },
          deadline: { type: 'string' },
        },
        required: ['id'],
      },
    },
    {
      name: 'create_stage',
      description: 'Create a new stage (column) in a project',
      input_schema: {
        type: 'object' as const,
        properties: {
          project_id: { type: 'number' },
          name: { type: 'string' },
          color: { type: 'string' },
        },
        required: ['project_id', 'name'],
      },
    },
    {
      name: 'create_workspace',
      description: 'Create a new workspace',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          color: { type: 'string' },
        },
        required: ['name'],
      },
    },
    {
      name: 'create_folder',
      description: 'Create a folder inside a workspace to organize projects',
      input_schema: {
        type: 'object' as const,
        properties: {
          workspace_id: { type: 'number' },
          name: { type: 'string' },
          color: { type: 'string' },
          parent_id: { type: 'number', description: 'Parent folder ID for nesting' },
        },
        required: ['workspace_id', 'name'],
      },
    },
    // ─── Client Profiles ───
    {
      name: 'list_clients',
      description: 'List all client profiles',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_client',
      description: 'Get a client profile by ID',
      input_schema: {
        type: 'object' as const,
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
    {
      name: 'create_client',
      description: 'Create a new client profile',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          slug: { type: 'string', description: 'URL-safe slug (e.g. uppercuts)' },
          industry: { type: 'string' },
          context: { type: 'string', description: 'Background info about this client' },
          notes: { type: 'string' },
          workspace_id: { type: 'number' },
        },
        required: ['name', 'slug'],
      },
    },
    {
      name: 'update_client',
      description: 'Update a client profile',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          industry: { type: 'string' },
          context: { type: 'string' },
          notes: { type: 'string' },
          contacts: { type: 'string' },
        },
        required: ['id'],
      },
    },
    // ─── Knowledge Base ───
    {
      name: 'search_knowledge',
      description: 'Search the knowledge base for entries (SOPs, guides, notes)',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search term' },
          workspace_id: { type: 'number' },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_knowledge_entry',
      description: 'Add a knowledge base entry (SOP, guide, note, link)',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          type: { type: 'string', enum: ['note', 'sop', 'guide', 'link', 'snippet'] },
          url: { type: 'string' },
          workspace_id: { type: 'number' },
        },
        required: ['title'],
      },
    },
    // ─── Meeting Notes ───
    {
      name: 'create_meeting_note',
      description: 'Create a meeting note with optional transcript, summary, and action items',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          transcript: { type: 'string' },
          action_items: { type: 'string', description: 'JSON array of action item strings' },
          attendees: { type: 'string', description: 'JSON array of attendee names' },
          client_id: { type: 'number' },
          meeting_date: { type: 'string' },
        },
        required: ['title'],
      },
    },
    {
      name: 'list_meeting_notes',
      description: 'List recent meeting notes',
      input_schema: {
        type: 'object' as const,
        properties: { limit: { type: 'number' } },
      },
    },
    // ─── Status Updates ───
    {
      name: 'post_status_update',
      description: 'Post a status update on a task or project (like a standup update)',
      input_schema: {
        type: 'object' as const,
        properties: {
          content: { type: 'string' },
          task_id: { type: 'number' },
          project_id: { type: 'number' },
        },
        required: ['content'],
      },
    },
    // ─── Team ───
    {
      name: 'list_team',
      description: 'List all team members (humans and agents)',
      input_schema: { type: 'object' as const, properties: {} },
    },
    // ─── Subtasks ───
    {
      name: 'get_subtasks',
      description: 'Get subtasks of a parent task',
      input_schema: {
        type: 'object' as const,
        properties: { parent_id: { type: 'number' } },
        required: ['parent_id'],
      },
    },
    {
      name: 'create_subtask',
      description: 'Create a subtask under a parent task',
      input_schema: {
        type: 'object' as const,
        properties: {
          parent_id: { type: 'number', description: 'Parent task ID' },
          title: { type: 'string' },
          assignee: { type: 'string' },
          priority: { type: 'string' },
          due_date: { type: 'string' },
        },
        required: ['parent_id', 'title'],
      },
    },
    // ─── Labels ───
    {
      name: 'list_labels',
      description: 'List all global labels',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'create_label',
      description: 'Create a new label',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' },
          color: { type: 'string', description: 'Hex color' },
        },
        required: ['name', 'color'],
      },
    },
    // ─── Attachments ───
    {
      name: 'list_attachments',
      description: 'List attachments on a task',
      input_schema: {
        type: 'object' as const,
        properties: { task_id: { type: 'number' } },
        required: ['task_id'],
      },
    },
    // ─── Flexible DB Query (read-only) ───
    {
      name: 'query_db',
      description: 'Run a read-only SQL query against the database. Use for complex queries that other tools cannot handle. SELECT only -- no INSERT/UPDATE/DELETE.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string', description: 'SELECT query to run' },
          params: { type: 'string', description: 'JSON array of bind parameters (optional)' },
        },
        required: ['sql'],
      },
    },
    // ─── Write DB (full access) ───
    {
      name: 'execute_sql',
      description: 'Run a write SQL statement (INSERT, UPDATE, DELETE) against the database. Use for operations not covered by other tools. Be careful with DELETE statements. Returns { changes, lastInsertRowid }.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string', description: 'SQL statement (INSERT, UPDATE, DELETE, CREATE TABLE, ALTER TABLE)' },
          params: { type: 'string', description: 'JSON array of bind parameters (optional)' },
        },
        required: ['sql'],
      },
    },
    // ─── List Documents ───
    {
      name: 'list_docs',
      description: 'List all documents, optionally filtered by workspace',
      input_schema: {
        type: 'object' as const,
        properties: {
          workspace_id: { type: 'number' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    // ─── List Channels ───
    {
      name: 'list_channels',
      description: 'List all messaging channels (public, private, DMs)',
      input_schema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', description: 'Filter by type: channel, dm, private' },
        },
      },
    },
    // ─── Send Message to Channel ───
    {
      name: 'send_channel_message',
      description: 'Send a message to any messaging channel. Use to notify the user, post updates, or communicate across channels.',
      input_schema: {
        type: 'object' as const,
        properties: {
          channel_id: { type: 'number', description: 'Channel ID to send to' },
          content: { type: 'string', description: 'Message content (markdown)' },
        },
        required: ['channel_id', 'content'],
      },
    },
    // ─── Business Profiles ───
    {
      name: 'list_businesses',
      description: 'List all business profiles',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_business',
      description: 'Get a business profile by ID with full details',
      input_schema: {
        type: 'object' as const,
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
    // ─── Meta Ads ───
    {
      name: 'get_ad_performance',
      description: 'Get Meta/Facebook ad performance data. Returns spend, impressions, clicks, CTR, CPC, CPM, leads, CPL, video metrics for each ad. Filter by client, campaign, or date range.',
      input_schema: {
        type: 'object' as const,
        properties: {
          client_slug: { type: 'string', description: 'Client slug (e.g. uppercuts-barbershop, eco-spa, animo, hpa)' },
          days: { type: 'number', description: 'Number of days back (default 7)' },
          campaign_name: { type: 'string', description: 'Filter by campaign name (partial match)' },
          sort_by: { type: 'string', description: 'Sort by: spend, ctr, cpc, leads, cpl (default: spend)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'get_ad_daily_summary',
      description: 'Get daily totals for ad performance (total spend, impressions, clicks, leads per day). Great for spotting trends.',
      input_schema: {
        type: 'object' as const,
        properties: {
          client_slug: { type: 'string', description: 'Client slug (optional, all clients if empty)' },
          days: { type: 'number', description: 'Number of days back (default 14)' },
        },
      },
    },
    {
      name: 'get_ad_accounts',
      description: 'List all active ad accounts with their client mapping.',
      input_schema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'detect_creative_fatigue',
      description: 'Detect creative fatigue across Meta ads. Flags ads with declining CTR, high frequency, or dropping video retention. Returns a prioritized list of ads that need fresh creatives.',
      input_schema: {
        type: 'object' as const,
        properties: {
          client_slug: { type: 'string', description: 'Client slug (optional, all clients if empty)' },
          threshold_frequency: { type: 'number', description: 'Frequency threshold to flag (default 3.5)' },
          threshold_ctr_drop: { type: 'number', description: 'CTR drop % to flag (default 20)' },
        },
      },
    },
    {
      name: 'get_budget_pacing',
      description: 'Check budget pacing for ad accounts. Shows daily spend vs target, projected monthly spend, and flags overspending or underspending.',
      input_schema: {
        type: 'object' as const,
        properties: {
          client_slug: { type: 'string', description: 'Client slug (optional)' },
          monthly_budget: { type: 'number', description: 'Monthly budget target in dollars (optional, uses average if not set)' },
        },
      },
    },
    {
      name: 'generate_client_report',
      description: 'Generate a performance report doc for a client. Creates a formatted document with key metrics, trends, top/bottom performers, and recommendations. Saves as a doc in the app.',
      input_schema: {
        type: 'object' as const,
        properties: {
          client_slug: { type: 'string', description: 'Client slug' },
          days: { type: 'number', description: 'Report period in days (default 7)' },
          include_recommendations: { type: 'boolean', description: 'Include AI recommendations (default true)' },
        },
        required: ['client_slug'],
      },
    },
    {
      name: 'spy_competitor_ads',
      description: 'Search the Meta Ad Library for competitor ads. Returns active ads from any Facebook/Instagram page. Use to research what competitors are running.',
      input_schema: {
        type: 'object' as const,
        properties: {
          page_name: { type: 'string', description: 'Facebook page name or URL to search' },
          search_term: { type: 'string', description: 'Keyword search across all ads' },
          country: { type: 'string', description: 'Country code (default US)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['search_term'],
      },
    },
    {
      name: 'get_lead_alerts',
      description: 'Check for recent leads from Meta ads. Returns leads from the last N hours with ad source info.',
      input_schema: {
        type: 'object' as const,
        properties: {
          client_slug: { type: 'string', description: 'Client slug (optional)' },
          hours: { type: 'number', description: 'Look back N hours (default 24)' },
        },
      },
    },
    {
      name: 'send_email',
      description: 'Draft or send an email. Requires approval before actually sending. Creates an approval request that the user must confirm.',
      input_schema: {
        type: 'object' as const,
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' },
          client_id: { type: 'number', description: 'Associated client ID (optional)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    {
      name: 'schedule_post',
      description: 'Schedule a social media post for Instagram/Facebook. Creates an approval request before publishing.',
      input_schema: {
        type: 'object' as const,
        properties: {
          platform: { type: 'string', enum: ['instagram', 'facebook', 'both'], description: 'Target platform' },
          caption: { type: 'string', description: 'Post caption/text' },
          image_url: { type: 'string', description: 'Image URL to post' },
          scheduled_time: { type: 'string', description: 'ISO datetime to publish' },
          client_id: { type: 'number', description: 'Associated client ID' },
        },
        required: ['platform', 'caption'],
      },
    },
    {
      name: 'dispatch_to_agent',
      description: 'Dispatch a task or prompt to another agent. They will execute autonomously and results flow back. Use chain_next to set up multi-agent workflows (e.g., Gary analyzes → Ricky writes copy).',
      input_schema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'Target agent ID (gary, ricky, sofia)' },
          prompt: { type: 'string', description: 'What to tell the agent to do' },
          task_id: { type: 'number', description: 'Optional task ID to associate with' },
          chain_next: { type: 'string', description: 'JSON array of {nextAgentId, nextPrompt} for chaining' },
        },
        required: ['agent_id', 'prompt'],
      },
    },
    // ─── Web Search ───
    {
      name: 'web_search',
      description: 'Search the web for current information. Use for research, fact-checking, trends, news, or any question that requires up-to-date web data.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
          num_results: { type: 'number', description: 'Number of results (default 5, max 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'fetch_webpage',
      description: 'Fetch the text content of a webpage URL. Use after web_search to read full articles or pages. For internal app.example.com URLs like /doc/51, prefer using the read_doc tool with the doc ID instead.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Full URL to fetch' },
        },
        required: ['url'],
      },
    },
    // ─── Agent self-improvement ───
    {
      name: 'save_learning',
      description: 'Record a learning, error, or correction to improve future performance. Use when you discover something important, make a mistake, or receive a correction.',
      input_schema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', enum: ['error', 'learning', 'correction', 'feature_request'] },
          content: { type: 'string', description: 'What you learned or what went wrong' },
        },
        required: ['type', 'content'],
      },
    },
    // ─── Client Lookup ───
    {
      name: 'lookup_client',
      description: 'Look up a client profile by name. Returns ad account, page ID, brand voice, goals, budget, and other context needed for campaign management.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Client name (partial match OK)' },
        },
        required: ['name'],
      },
    },
    // ─── API Request (for Meta/Google campaign management) ───
    {
      name: 'api_request',
      description: 'Make HTTP requests to the Motion Lite API (app.example.com). Use this to manage Meta campaigns, ad sets, ads, targeting, audiences, and view ad performance data. Supports GET, POST, PATCH, DELETE.',
      input_schema: {
        type: 'object' as const,
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'HTTP method' },
          path: { type: 'string', description: 'API path starting with /api/ (e.g. /api/meta/campaigns, /api/ads/daily?days=30)' },
          body: { type: 'object', description: 'JSON body for POST/PATCH requests' },
        },
        required: ['method', 'path'],
      },
    },
  ]

  // Filter to allowed skills
  if (allowedSkills.length > 0) {
    return allTools.filter(t => allowedSkills.includes(t.name))
  }
  return allTools
}

// ─── Tool Execution (direct DB calls - no HTTP, no auth issues) ───

async function executeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
  const db = await import('./db')

  try {
    switch (toolName) {
      case 'list_tasks': {
        const tasks = db.getTasks({
          workspaceId: input.workspace_id as number | undefined,
          projectId: input.project_id as number | undefined,
          status: input.status as string | undefined,
        })
        const limit = (input.limit as number) || 20
        const filtered = input.priority
          ? tasks.filter(t => t.priority === input.priority)
          : tasks
        return JSON.stringify({ tasks: filtered.slice(0, limit) })
      }

      case 'create_task': {
        // Auto-resolve workspace_id if not provided
        let wsId = input.workspace_id as number | undefined
        if (!wsId) {
          const workspaces = db.getWorkspaces()
          if (workspaces.length > 0) wsId = workspaces[0].id
        }
        const task = db.createTask({
          title: input.title as string,
          workspaceId: wsId,
          projectId: input.project_id as number | undefined,
          priority: input.priority as string | undefined,
          assignee: input.assignee as string | undefined,
          due_date: input.due_date as string | undefined,
          duration_minutes: input.duration_minutes as number | undefined,
          description: input.description as string | undefined,
        })
        // Auto-log activity
        db.createTaskActivity(task.id, 'created', `Task created: ${task.title}`, (input._caller_agent_id as string) || 'jimmy')
        return JSON.stringify({ task, url: '/projects-tasks' })
      }

      case 'update_task': {
        const caller = (input._caller_agent_id as string) || 'unknown'
        const updates: Record<string, unknown> = {}
        if (input.title) updates.title = input.title
        if (input.status) updates.status = input.status
        if (input.priority) updates.priority = input.priority
        if (input.assignee) updates.assignee = input.assignee
        if (input.due_date) updates.due_date = input.due_date
        const task = db.updateTask(input.id as number, updates)
        if (task && input.status) {
          db.createTaskActivity(task.id, 'status_change', `Status changed to ${input.status}`, caller)
        }
        return JSON.stringify({ task })
      }

      case 'complete_task': {
        const caller = (input._caller_agent_id as string) || 'unknown'
        const task = db.updateTask(input.id as number, { status: 'done' })
        if (task) {
          db.createTaskActivity(task.id, 'completed', `Task completed: ${task.title}`, caller)
        }
        return JSON.stringify({ task })
      }

      case 'search_tasks': {
        const d = db.getDb()
        const query = `%${input.query}%`
        const limit = (input.limit as number) || 20
        const tasks = d.prepare(
          'SELECT * FROM tasks WHERE (title LIKE ? OR description LIKE ?) AND status NOT IN (\'done\',\'cancelled\',\'archived\') ORDER BY updated_at DESC LIMIT ?'
        ).all(query, query, limit)
        return JSON.stringify({ tasks })
      }

      case 'get_calendar_events': {
        const d = db.getDb()
        const events = d.prepare(
          'SELECT * FROM calendar_events WHERE start_time >= ? AND end_time <= ? ORDER BY start_time ASC'
        ).all(input.start, input.end)
        return JSON.stringify({ events })
      }

      case 'get_free_slots': {
        const d = db.getDb()
        const date = input.date as string
        const events = d.prepare(
          "SELECT * FROM calendar_events WHERE start_time >= ? AND end_time <= ? ORDER BY start_time ASC"
        ).all(`${date}T00:00:00`, `${date}T23:59:59`)
        return JSON.stringify({ date, events, message: `${events.length} events on ${date}` })
      }

      case 'get_today_agenda': {
        const d = db.getDb()
        const today = new Date().toISOString().split('T')[0]
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
        const events = d.prepare(
          "SELECT * FROM calendar_events WHERE start_time >= ? AND end_time <= ? ORDER BY start_time ASC"
        ).all(`${today}T00:00:00`, `${tomorrow}T00:00:00`)
        const tasks = db.getTasks({ status: 'in_progress' })
        const todayTasks = db.getTasks({}).filter(t =>
          t.due_date && t.due_date.startsWith(today) && t.status !== 'done' && t.status !== 'cancelled'
        )
        return JSON.stringify({ date: today, events, active_tasks: tasks.slice(0, 10), due_today: todayTasks.slice(0, 10) })
      }

      case 'list_workspaces': {
        const workspaces = db.getWorkspaces()
        return JSON.stringify({ workspaces })
      }

      case 'list_projects': {
        const projects = input.workspace_id
          ? db.getProjects(input.workspace_id as number)
          : db.getAllProjects()
        return JSON.stringify({ projects })
      }

      case 'get_project_detail': {
        const d = db.getDb()
        const project = d.prepare('SELECT * FROM projects WHERE id = ?').get(input.project_id)
        const stages = d.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY sort_order ASC').all(input.project_id)
        const tasks = db.getTasks({ projectId: input.project_id as number })
        return JSON.stringify({ project, stages, tasks, url: `/project/${(project as any)?.public_id || input.project_id}` })
      }

      case 'list_agents': {
        const agents = db.getAgents()
        return JSON.stringify({ agents })
      }

      case 'dispatch_task_to_agent': {
        const caller = (input._caller_agent_id as string) || 'unknown'
        const task = db.updateTask(input.task_id as number, { assignee: input.agent_id as string })
        db.updateAgent(input.agent_id as string, { current_task_id: input.task_id as number })
        db.createTaskActivity(input.task_id as number, 'delegated', `Task dispatched to ${input.agent_id} by ${caller}`, caller)
        return JSON.stringify({ dispatched: true, task })
      }

      case 'create_task_for_agent': {
        const caller = (input._caller_agent_id as string) || 'unknown'
        const targetAgentId = input.agent_id as string
        const targetAgent = db.getAgent(targetAgentId)
        if (!targetAgent) return JSON.stringify({ error: `Agent '${targetAgentId}' not found` })

        const task = db.createTask({
          title: input.title as string,
          description: (input.description as string) || '',
          priority: (input.priority as string) || 'medium',
          status: 'todo',
          assignee: targetAgentId,
          workspaceId: input.workspace_id as number | undefined,
        })
        db.updateAgent(targetAgentId, { current_task_id: task.id })
        db.createTaskActivity(task.id, 'created', `Task assigned to @${targetAgentId}`, caller)
        // Auto-post initial comment so it reads like a real handoff
        const commentMsg = input.description
          ? `@${targetAgentId} ${input.description}`
          : `@${targetAgentId} Hey, can you handle this? ${input.title}`
        db.createTaskActivity(task.id, 'comment', commentMsg as string, caller)
        return JSON.stringify({ created: true, task_id: task.id, assigned_to: targetAgentId, title: input.title })
      }

      case 'post_comment': {
        const caller = (input._caller_agent_id as string) || 'unknown'
        const taskId = input.task_id as number
        let message = input.message as string
        // If mentioning another agent, prefix with @
        if (input.mention) {
          const mentionId = (input.mention as string).replace('@', '')
          if (!message.includes(`@${mentionId}`)) {
            message = `@${mentionId} ${message}`
          }
        }
        const activity = db.createTaskActivity(taskId, 'comment', message, caller)
        return JSON.stringify({ posted: true, comment_id: activity.id, task_id: taskId, from: caller })
      }

      case 'log_agent_activity': {
        const activity = db.createTaskActivity(
          input.task_id as number,
          input.activity_type as string,
          input.message as string,
          input.agent_id as string
        )
        return JSON.stringify({ logged: true, activity })
      }

      case 'create_doc': {
        const doc = db.createDoc({
          title: input.title as string,
          workspaceId: input.workspace_id as number | undefined,
          docType: input.doc_type as string | undefined,
        })
        if (input.content) {
          const blockContent = contentToBlockJson(input.content as string)
          db.updateDoc(doc.id, { content: blockContent }, 'ai')
        }
        const docUrl = `/doc/${doc.public_id || doc.id}`
        return JSON.stringify({ doc, url: docUrl })
      }

      case 'read_doc': {
        const doc = db.getDoc(input.id as number)
        if (!doc) return JSON.stringify({ error: `Doc ${input.id} not found` })
        // Parse blocks back to readable format for the agent
        let readableContent = ''
        if (doc.content) {
          try {
            const blocks = JSON.parse(doc.content)
            if (Array.isArray(blocks)) {
              readableContent = blocks.map((b: { type: string; content?: string; rows?: string[][]; language?: string; checked?: boolean }) => {
                const text = (b.content || '').replace(/<[^>]*>/g, '')
                switch (b.type) {
                  case 'heading1': return `# ${text}`
                  case 'heading2': return `## ${text}`
                  case 'heading3': return `### ${text}`
                  case 'bulleted_list': return `- ${text}`
                  case 'numbered_list': return `1. ${text}`
                  case 'check_list': return `- [${b.checked ? 'x' : ' '}] ${text}`
                  case 'blockquote': return `> ${text}`
                  case 'divider': return '---'
                  case 'code': return '```' + (b.language || '') + '\n' + text + '\n```'
                  case 'table': return b.rows ? b.rows.map(r => '| ' + r.join(' | ') + ' |').join('\n') : ''
                  default: return text
                }
              }).filter(Boolean).join('\n')
            }
          } catch { readableContent = doc.content }
        }
        const docUrl = `/doc/${doc.public_id || doc.id}`
        return JSON.stringify({ doc: { ...doc, readable_content: readableContent }, url: docUrl })
      }

      case 'update_doc': {
        const updates: { title?: string; content?: string } = {}
        if (input.title) updates.title = input.title as string
        if (input.content) updates.content = contentToBlockJson(input.content as string)
        const doc = db.updateDoc(input.id as number, updates, 'ai')
        return JSON.stringify({ doc })
      }

      // ─── Sheet tools ───
      case 'create_sheet': {
        const d = db.getDb()
        const result = d.prepare('INSERT INTO sheets (name, workspace_id) VALUES (?, ?)').run(
          input.name as string, (input.workspace_id as number) || null
        )
        const sheetId = result.lastInsertRowid as number
        // Add columns if provided
        if (input.columns && Array.isArray(input.columns)) {
          const insertCol = d.prepare('INSERT INTO sheet_columns (sheet_id, name, type, options, sort_order) VALUES (?, ?, ?, ?, ?)')
          for (let i = 0; i < (input.columns as Array<{ name: string; type?: string; options?: string[] }>).length; i++) {
            const col = (input.columns as Array<{ name: string; type?: string; options?: string[] }>)[i]
            insertCol.run(sheetId, col.name, col.type || 'text', col.options ? JSON.stringify(col.options) : null, i)
          }
        }
        // Add rows if provided
        if (input.rows && Array.isArray(input.rows)) {
          const insertRow = d.prepare('INSERT INTO sheet_rows (sheet_id, data, sort_order) VALUES (?, ?, ?)')
          for (let i = 0; i < (input.rows as Record<string, unknown>[]).length; i++) {
            insertRow.run(sheetId, JSON.stringify((input.rows as Record<string, unknown>[])[i]), i)
          }
        }
        return JSON.stringify({ id: sheetId, name: input.name, url: '/sheets' })
      }

      case 'read_sheet': {
        const d = db.getDb()
        const sheet = d.prepare('SELECT * FROM sheets WHERE id = ?').get(input.id as number) as { id: number; name: string } | undefined
        if (!sheet) return JSON.stringify({ error: 'Sheet not found' })
        const columns = d.prepare('SELECT name, type, options FROM sheet_columns WHERE sheet_id = ? ORDER BY sort_order').all(input.id as number) as Array<{ name: string; type: string; options: string | null }>
        const rows = d.prepare('SELECT id, data FROM sheet_rows WHERE sheet_id = ? ORDER BY sort_order').all(input.id as number) as Array<{ id: number; data: string }>
        return JSON.stringify({
          id: sheet.id,
          name: sheet.name,
          columns: columns.map(c => ({ name: c.name, type: c.type, options: c.options ? JSON.parse(c.options) : undefined })),
          rows: rows.map(r => ({ _id: r.id, ...JSON.parse(r.data) })),
          url: '/sheets',
        })
      }

      case 'list_sheets': {
        const d = db.getDb()
        const sheets = d.prepare(`
          SELECT s.*, (SELECT COUNT(*) FROM sheet_columns WHERE sheet_id = s.id) as column_count,
            (SELECT COUNT(*) FROM sheet_rows WHERE sheet_id = s.id) as row_count
          FROM sheets s ORDER BY s.updated_at DESC
        `).all()
        return JSON.stringify({ sheets })
      }

      case 'update_sheet': {
        const d = db.getDb()
        const sid = input.sheet_id as number
        const action = input.action as string
        switch (action) {
          case 'rename_sheet':
            d.prepare("UPDATE sheets SET name = ?, updated_at = strftime('%s','now') WHERE id = ?").run(input.name, sid)
            break
          case 'add_column': {
            const maxO = d.prepare('SELECT MAX(sort_order) as m FROM sheet_columns WHERE sheet_id = ?').get(sid) as { m: number | null }
            d.prepare('INSERT INTO sheet_columns (sheet_id, name, type, options, sort_order) VALUES (?, ?, ?, ?, ?)').run(
              sid, input.name, input.type || 'text', input.options ? JSON.stringify(input.options) : null, (maxO?.m ?? -1) + 1
            )
            break
          }
          case 'rename_column': {
            d.prepare('UPDATE sheet_columns SET name = ? WHERE sheet_id = ? AND name = ?').run(input.new_name, sid, input.old_name)
            const renameRows = d.prepare('SELECT id, data FROM sheet_rows WHERE sheet_id = ?').all(sid) as Array<{ id: number; data: string }>
            const renameStmt = d.prepare('UPDATE sheet_rows SET data = ? WHERE id = ?')
            for (const row of renameRows) {
              const data = JSON.parse(row.data)
              if ((input.old_name as string) in data) {
                data[input.new_name as string] = data[input.old_name as string]
                delete data[input.old_name as string]
                renameStmt.run(JSON.stringify(data), row.id)
              }
            }
            break
          }
          case 'delete_column':
            d.prepare('DELETE FROM sheet_columns WHERE sheet_id = ? AND name = ?').run(sid, input.column_name)
            break
          case 'add_row': {
            const maxR = d.prepare('SELECT MAX(sort_order) as m FROM sheet_rows WHERE sheet_id = ?').get(sid) as { m: number | null }
            const rowResult = d.prepare('INSERT INTO sheet_rows (sheet_id, data, sort_order) VALUES (?, ?, ?)').run(
              sid, JSON.stringify(input.data || {}), (maxR?.m ?? -1) + 1
            )
            d.prepare("UPDATE sheets SET updated_at = strftime('%s','now') WHERE id = ?").run(sid)
            return JSON.stringify({ id: rowResult.lastInsertRowid })
          }
          case 'update_row': {
            const existing = d.prepare('SELECT data FROM sheet_rows WHERE id = ? AND sheet_id = ?').get(input.row_id, sid) as { data: string } | undefined
            if (!existing) return JSON.stringify({ error: 'Row not found' })
            const merged = { ...JSON.parse(existing.data), ...(input.data as Record<string, unknown>) }
            d.prepare('UPDATE sheet_rows SET data = ? WHERE id = ?').run(JSON.stringify(merged), input.row_id)
            d.prepare("UPDATE sheets SET updated_at = strftime('%s','now') WHERE id = ?").run(sid)
            break
          }
          case 'delete_row':
            d.prepare('DELETE FROM sheet_rows WHERE id = ?').run(input.row_id)
            d.prepare("UPDATE sheets SET updated_at = strftime('%s','now') WHERE id = ?").run(sid)
            break
          case 'import_csv': {
            const csv = input.csv as string
            const csvLines = csv.trim().split('\n').map((line: string) => {
              const cells: string[] = []
              let cur = '', inQ = false
              for (const ch of line) {
                if (ch === '"') { inQ = !inQ; continue }
                if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue }
                cur += ch
              }
              cells.push(cur.trim())
              return cells
            })
            const csvHeaders = csvLines[0]
            const csvData = csvLines.slice(1)
            const existCols = d.prepare('SELECT name FROM sheet_columns WHERE sheet_id = ?').all(sid) as { name: string }[]
            const existNames = new Set(existCols.map(c => c.name))
            let maxCO = (d.prepare('SELECT MAX(sort_order) as m FROM sheet_columns WHERE sheet_id = ?').get(sid) as { m: number | null })?.m ?? -1
            for (const h of csvHeaders) {
              if (h && !existNames.has(h)) {
                maxCO++
                d.prepare('INSERT INTO sheet_columns (sheet_id, name, type, sort_order) VALUES (?, ?, ?, ?)').run(sid, h, 'text', maxCO)
              }
            }
            const insRow = d.prepare('INSERT INTO sheet_rows (sheet_id, data, sort_order) VALUES (?, ?, ?)')
            let maxRO = (d.prepare('SELECT MAX(sort_order) as m FROM sheet_rows WHERE sheet_id = ?').get(sid) as { m: number | null })?.m ?? -1
            for (const row of csvData) {
              const rData: Record<string, string> = {}
              csvHeaders.forEach((h: string, i: number) => { if (h) rData[h] = row[i] || '' })
              maxRO++
              insRow.run(sid, JSON.stringify(rData), maxRO)
            }
            d.prepare("UPDATE sheets SET updated_at = strftime('%s','now') WHERE id = ?").run(sid)
            return JSON.stringify({ imported: csvData.length })
          }
        }
        return JSON.stringify({ success: true })
      }

      case 'request_approval': {
        const d = db.getDb()
        d.prepare(`
          INSERT INTO approval_queue (agent_id, action_type, action_data, created_at)
          VALUES (?, ?, ?, strftime('%s','now'))
        `).run(input.agent_id || 'unknown', input.action_type, JSON.stringify({ description: input.description, data: input.data }))
        return JSON.stringify({ status: 'pending_approval', message: 'Action queued for human approval' })
      }

      // ─── Tier 3: Reference docs (on-demand loading) ───
      case 'search_references': {
        const agentId = (input.agent_id as string) || 'jimmy'
        const ragResult = await ragQuery(input.query as string, 'hybrid', { source: 'agent_references', agentId })
        if (ragResult) {
          return JSON.stringify({ references: ragResult.results, source: 'rag' })
        }
        // Fallback to LIKE if RAG service is down
        const refs = searchAgentReferences(agentId, input.query as string)
        return JSON.stringify({
          references: refs.map(r => ({
            content: r.content,
            metadata: {
              source_table: 'agent_references',
              record_id: String(r.id),
              agent_id: agentId,
              category: r.category,
            },
          })),
          source: 'fallback',
        })
      }

      case 'list_references': {
        const allRefs = getAgentReferences((input.agent_id as string) || 'jimmy')
        let filtered = allRefs
        if (input.category) {
          filtered = allRefs.filter(r => r.category === input.category)
        }
        return JSON.stringify({ references: filtered.map(r => ({ id: r.id, name: r.name, category: r.category, size: r.content.length })) })
      }

      case 'save_learning': {
        logLearning(
          (input.agent_id as string) || 'jimmy',
          null,
          input.type as 'error' | 'learning' | 'correction' | 'feature_request',
          input.content as string
        )
        return JSON.stringify({ saved: true })
      }

      // ─── Project & Workspace Management ───
      case 'create_project': {
        let wsId = input.workspace_id as number | undefined
        if (!wsId) {
          const workspaces = db.getWorkspaces()
          if (workspaces.length > 0) wsId = workspaces[0].id
        }
        const project = db.createProject(wsId!, input.name as string, input.folder_id as number | undefined, input.color as string | undefined)
        if (input.description) {
          db.updateProject(project.id, { description: input.description as string })
        }
        const caller = (input._caller_agent_id as string) || 'unknown'
        // Create default stages
        db.createStage(project.id, 'To Do', '#78909c')
        db.createStage(project.id, 'In Progress', '#42a5f5')
        db.createStage(project.id, 'Done', '#00e676')
        return JSON.stringify({ project, url: `/project/${project.public_id || project.id}`, message: `Project "${input.name}" created with default stages` })
      }

      case 'update_project': {
        const updates: Record<string, unknown> = {}
        for (const key of ['name', 'description', 'status', 'color', 'priority', 'assignee', 'start_date', 'deadline']) {
          if (input[key] !== undefined) updates[key] = input[key]
        }
        db.updateProject(input.id as number, updates as any)
        const project = db.getProject(input.id as number)
        return JSON.stringify({ project })
      }

      case 'create_stage': {
        const stage = db.createStage(input.project_id as number, input.name as string, input.color as string | undefined)
        return JSON.stringify({ stage })
      }

      case 'create_workspace': {
        const slug = (input.name as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const ws = db.createWorkspace(input.name as string, slug, input.color as string | undefined)
        return JSON.stringify({ workspace: ws })
      }

      case 'create_folder': {
        const folder = db.createFolder(input.workspace_id as number, input.name as string, input.color as string | undefined, input.parent_id as number | undefined)
        return JSON.stringify({ folder })
      }

      // ─── Client Profiles ───
      case 'list_clients': {
        const clients = db.getClientProfiles()
        return JSON.stringify({ clients })
      }

      case 'get_client': {
        const client = db.getClientProfile(input.id as number)
        return JSON.stringify({ client })
      }

      case 'create_client': {
        const client = db.createClientProfile({
          name: input.name as string,
          slug: input.slug as string,
          industry: input.industry as string | undefined,
          context: input.context as string | undefined,
          notes: input.notes as string | undefined,
          workspace_id: input.workspace_id as number | undefined,
        })
        return JSON.stringify({ client })
      }

      case 'update_client': {
        const updates: Record<string, unknown> = {}
        for (const key of ['name', 'industry', 'context', 'notes', 'contacts']) {
          if (input[key] !== undefined) updates[key] = input[key]
        }
        const client = db.updateClientProfile(input.id as number, updates)
        return JSON.stringify({ client })
      }

      // ─── Knowledge Base ───
      case 'search_knowledge': {
        const ragResult = await ragQuery(input.query as string, 'hybrid', { source: 'knowledge_entries' })
        if (ragResult) {
          return JSON.stringify({ entries: ragResult.results, source: 'rag' })
        }
        // Fallback to LIKE if RAG service is down
        const d = db.getDb()
        const query = `%${input.query}%`
        const entries = d.prepare(
          'SELECT * FROM knowledge_entries WHERE (title LIKE ? OR content LIKE ?) ORDER BY created_at DESC LIMIT 20'
        ).all(query, query)
        return JSON.stringify({
          entries: (entries as Array<{ id: number; content: string | null; type: string | null }>).map(entry => ({
            content: entry.content || '',
            metadata: {
              source_table: 'knowledge_entries',
              record_id: String(entry.id),
              category: entry.type || 'knowledge',
            },
          })),
          source: 'fallback',
        })
      }

      case 'create_knowledge_entry': {
        const entry = db.createKnowledgeEntry({
          title: input.title as string,
          content: input.content as string | undefined,
          type: input.type as string | undefined,
          url: input.url as string | undefined,
          workspace_id: input.workspace_id as number | undefined,
        })
        // Fire-and-forget RAG ingest
        ragIngest(
          `knowledge_entries_${entry.id}`,
          'knowledge_entries',
          input.title as string,
          (input.content as string) || '',
          (input.type as string) || 'knowledge',
        ).catch(() => {})
        return JSON.stringify({ entry })
      }

      // ─── Meeting Notes ───
      case 'create_meeting_note': {
        const note = db.createMeetingNote({
          title: input.title as string,
          summary: input.summary as string | undefined,
          transcript: input.transcript as string | undefined,
          action_items: input.action_items ? JSON.parse(input.action_items as string) : undefined,
          attendees: input.attendees ? JSON.parse(input.attendees as string) : undefined,
          client_id: input.client_id as number | undefined,
          meeting_date: input.meeting_date as string | undefined,
        })
        return JSON.stringify({ note })
      }

      case 'list_meeting_notes': {
        const notes = db.getMeetingNotes((input.limit as number) || 20)
        return JSON.stringify({ notes: notes.map(n => ({ id: n.id, title: n.title, meeting_date: n.meeting_date, summary: n.summary })) })
      }

      // ─── Status Updates ───
      case 'post_status_update': {
        const update = db.createStatusUpdate({
          content: input.content as string,
          taskId: input.task_id as number | undefined,
          projectId: input.project_id as number | undefined,
          author: (input._caller_agent_id as string) || 'jimmy',
        })
        return JSON.stringify({ update })
      }

      // ─── Team ───
      case 'list_team': {
        const members = db.getTeamMembers()
        return JSON.stringify({ members })
      }

      // ─── Subtasks ───
      case 'get_subtasks': {
        const subtasks = db.getSubtasks(input.parent_id as number)
        return JSON.stringify({ subtasks })
      }

      case 'create_subtask': {
        const caller = (input._caller_agent_id as string) || 'unknown'
        const parentTask = db.getTask(input.parent_id as number)
        const subtask = db.createTask({
          title: input.title as string,
          parentTaskId: input.parent_id as number,
          workspaceId: parentTask?.workspace_id ?? undefined,
          projectId: parentTask?.project_id ?? undefined,
          assignee: input.assignee as string | undefined,
          priority: input.priority as string | undefined,
          due_date: input.due_date as string | undefined,
        })
        db.createTaskActivity(subtask.id, 'created', `Subtask created under "${parentTask?.title}"`, caller)
        return JSON.stringify({ subtask })
      }

      // ─── Labels ───
      case 'list_labels': {
        const labels = db.getLabels()
        return JSON.stringify({ labels })
      }

      case 'create_label': {
        const label = db.createLabel(input.name as string, input.color as string)
        return JSON.stringify({ label })
      }

      // ─── Attachments ───
      case 'list_attachments': {
        const attachments = db.getAttachments(input.task_id as number)
        return JSON.stringify({ attachments })
      }

      // ─── Flexible DB Query (read-only) ───
      case 'query_db': {
        const sql = (input.sql as string).trim()
        const upperSql = sql.toUpperCase().replace(/\s+/g, ' ')
        // Safety: only allow SELECT queries (no writable CTEs, no semicolons for multi-statement)
        if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH')) {
          return JSON.stringify({ error: 'Only SELECT queries are allowed' })
        }
        if (upperSql.includes(';')) {
          return JSON.stringify({ error: 'Multi-statement queries are not allowed' })
        }
        // Block writable CTEs and embedded DML
        const dmlKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE', 'TRUNCATE', 'ATTACH', 'DETACH']
        for (const kw of dmlKeywords) {
          // Check for keyword as a whole word (not part of a column/table name)
          const kwRegex = new RegExp(`\\b${kw}\\b`, 'i')
          if (kwRegex.test(sql)) {
            return JSON.stringify({ error: `Blocked: ${kw} not allowed in read-only queries` })
          }
        }
        // Block access to sensitive tables (auth, keys, sessions)
        const sensitiveTablePattern = /\b(users|api_keys|auth_sessions|provider_tokens|approval_queue)\b/i
        if (sensitiveTablePattern.test(sql)) {
          return JSON.stringify({ error: 'Access to auth/credential tables is not allowed via query_db. Use dedicated tools instead.' })
        }
        const d = db.getDb()
        const params = input.params ? JSON.parse(input.params as string) : []
        const rows = d.prepare(sql).all(...params)
        return JSON.stringify({ rows: rows.slice(0, 100) })
      }

      // ─── Write DB (controlled access) ───
      case 'execute_sql': {
        const sql = (input.sql as string).trim()
        // Normalize: collapse whitespace, strip comments for reliable keyword detection
        const normalized = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toUpperCase()
        // Block multi-statement injection via semicolons
        if (sql.includes(';')) {
          return JSON.stringify({ error: 'Multi-statement queries are not allowed' })
        }
        // Only allow INSERT, UPDATE, DELETE (no DDL, no SELECT for data exfil)
        const allowedPrefixes = ['INSERT', 'UPDATE', 'DELETE']
        const startsWithAllowed = allowedPrefixes.some(p => normalized.startsWith(p))
        if (!startsWithAllowed) {
          return JSON.stringify({ error: 'Only INSERT, UPDATE, DELETE statements are allowed. Use query_db for SELECT.' })
        }
        // Block dangerous DDL operations anywhere in the statement
        const blockedKeywords = ['DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'ATTACH', 'DETACH', 'PRAGMA']
        for (const kw of blockedKeywords) {
          if (new RegExp(`\\b${kw}\\b`).test(normalized)) {
            return JSON.stringify({ error: `Blocked: ${kw} not allowed via agent` })
          }
        }
        // Block writes to sensitive tables using regex word boundary matching
        // Catches: UPDATE USERS, UPDATE "users", UPDATE `users`, INSERT INTO USERS, DELETE FROM USERS
        const protectedTables = ['USERS', 'AUTH_SESSIONS', 'PROVIDER_TOKENS', 'API_KEYS', 'APPROVAL_QUEUE', 'AGENT_RUNS', 'MODEL_ROUTING_LOG']
        for (const tbl of protectedTables) {
          const tblPattern = new RegExp(`\\b${tbl}\\b`, 'i')
          if (tblPattern.test(normalized.replace(/["`]/g, ''))) {
            return JSON.stringify({ error: `Blocked: cannot modify ${tbl.toLowerCase()} table via agent` })
          }
        }
        const d = db.getDb()
        const params = input.params ? JSON.parse(input.params as string) : []
        const result = d.prepare(sql).run(...params)
        return JSON.stringify({ changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) })
      }

      // ─── List Documents ───
      case 'list_docs': {
        const d = db.getDb()
        const lim = (input.limit as number) || 50
        if (input.workspace_id) {
          const wsId = Number(input.workspace_id)
          const docs = d.prepare('SELECT id, title, doc_type, workspace_id, created_at, updated_at FROM docs WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?').all(wsId, lim)
          return JSON.stringify({ docs })
        }
        const docs = d.prepare('SELECT id, title, doc_type, workspace_id, created_at, updated_at FROM docs ORDER BY updated_at DESC LIMIT ?').all(lim)
        return JSON.stringify({ docs })
      }

      // ─── List Channels ───
      case 'list_channels': {
        const d = db.getDb()
        if (input.type) {
          const chs = d.prepare('SELECT id, name, slug, type, description FROM msg_channels WHERE type = ? ORDER BY id').all(String(input.type))
          return JSON.stringify({ channels: chs })
        }
        const chs = d.prepare('SELECT id, name, slug, type, description FROM msg_channels ORDER BY id').all()
        return JSON.stringify({ channels: chs })
      }

      // ─── Send Message to Channel ───
      case 'send_channel_message': {
        const callerAgent = (input._caller_agent_id as string) || 'jimmy'
        const agentNumMap: Record<string, number> = { jimmy: 100, gary: 101, ricky: 102, sofia: 103 }
        const senderNum = agentNumMap[callerAgent] || 100
        const msg = db.createMsgMessage({
          channel_id: input.channel_id as number,
          content: input.content as string,
          sender_user_id: senderNum,
        })
        return JSON.stringify({ message: msg })
      }

      // ─── Business Profiles ───
      case 'list_businesses': {
        const d = db.getDb()
        const businesses = d.prepare('SELECT * FROM businesses ORDER BY name').all()
        return JSON.stringify({ businesses })
      }

      case 'get_business': {
        const d = db.getDb()
        const biz = d.prepare('SELECT * FROM businesses WHERE id = ?').get(input.id as number)
        return JSON.stringify({ business: biz || null })
      }

      // ─── Meta Ads (Supabase) ───
      case 'get_ad_performance': {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseKey) return JSON.stringify({ error: 'Supabase not configured' })

        const days = (input.days as number) || 7
        const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
        const sortBy = (input.sort_by as string) || 'spend'
        const limit = Math.min((input.limit as number) || 20, 50)

        let query = `${supabaseUrl}/rest/v1/ad_performance_daily?select=*&date=gte.${startDate}&order=${sortBy}.desc&limit=${limit}`
        if (input.client_slug) query += `&client_slug=eq.${input.client_slug}`
        if (input.campaign_name) query += `&campaign_name=ilike.*${input.campaign_name}*`

        try {
          const resp = await fetch(query, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const data = await resp.json()

          // Aggregate by ad
          const adMap = new Map<string, Record<string, unknown>>()
          for (const row of data) {
            const key = row.ad_id || row.ad_name
            const existing = adMap.get(key)
            if (existing) {
              existing.spend = (existing.spend as number || 0) + (row.spend || 0)
              existing.impressions = (existing.impressions as number || 0) + (row.impressions || 0)
              existing.clicks = (existing.clicks as number || 0) + (row.clicks || 0)
              existing.link_clicks = (existing.link_clicks as number || 0) + (row.link_clicks || 0)
              existing.leads = (existing.leads as number || 0) + (row.leads || 0)
              existing.video_views = (existing.video_views as number || 0) + (row.video_views || 0)
              existing.days_count = (existing.days_count as number || 0) + 1
            } else {
              adMap.set(key, { ...row, days_count: 1 })
            }
          }

          // Calculate derived metrics
          const ads = Array.from(adMap.values()).map(ad => {
            const spend = ad.spend as number || 0
            const impr = ad.impressions as number || 0
            const clicks = ad.clicks as number || 0
            const leads = ad.leads as number || 0
            return {
              ad_id: ad.ad_id, ad_name: ad.ad_name,
              campaign_name: ad.campaign_name, account_name: ad.account_name, client_slug: ad.client_slug,
              spend: Math.round(spend * 100) / 100,
              impressions: impr, clicks, link_clicks: ad.link_clicks, leads,
              ctr: impr > 0 ? Math.round((clicks / impr) * 10000) / 100 : 0,
              cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
              cpm: impr > 0 ? Math.round((spend / impr * 1000) * 100) / 100 : 0,
              cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : 0,
              hook_rate: ad.hook_rate, hold_rate: ad.hold_rate,
              video_views: ad.video_views, frequency: ad.frequency, reach: ad.reach,
              days_active: ad.days_count,
            }
          })

          return JSON.stringify({ ads, period: `last ${days} days`, total_ads: ads.length })
        } catch (err) {
          return JSON.stringify({ error: `Supabase query failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'get_ad_daily_summary': {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseKey) return JSON.stringify({ error: 'Supabase not configured' })

        const days = (input.days as number) || 14
        const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

        let query = `${supabaseUrl}/rest/v1/ad_performance_daily?select=date,spend,impressions,clicks,link_clicks,leads,reach&date=gte.${startDate}&order=date.asc`
        if (input.client_slug) query += `&client_slug=eq.${input.client_slug}`

        try {
          const resp = await fetch(query, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const data = await resp.json()

          // Aggregate by date
          const dayMap = new Map<string, { date: string; spend: number; impressions: number; clicks: number; link_clicks: number; leads: number; reach: number }>()
          for (const row of data) {
            const existing = dayMap.get(row.date)
            if (existing) {
              existing.spend += row.spend || 0
              existing.impressions += row.impressions || 0
              existing.clicks += row.clicks || 0
              existing.link_clicks += row.link_clicks || 0
              existing.leads += row.leads || 0
              existing.reach += row.reach || 0
            } else {
              dayMap.set(row.date, {
                date: row.date, spend: row.spend || 0, impressions: row.impressions || 0,
                clicks: row.clicks || 0, link_clicks: row.link_clicks || 0,
                leads: row.leads || 0, reach: row.reach || 0,
              })
            }
          }

          const daily = Array.from(dayMap.values()).map(d => ({
            ...d,
            spend: Math.round(d.spend * 100) / 100,
            ctr: d.impressions > 0 ? Math.round((d.clicks / d.impressions) * 10000) / 100 : 0,
            cpl: d.leads > 0 ? Math.round((d.spend / d.leads) * 100) / 100 : 0,
          }))

          const totals = daily.reduce((acc, d) => ({
            spend: acc.spend + d.spend,
            impressions: acc.impressions + d.impressions,
            clicks: acc.clicks + d.clicks,
            leads: acc.leads + d.leads,
          }), { spend: 0, impressions: 0, clicks: 0, leads: 0 })

          return JSON.stringify({ daily, totals: { ...totals, spend: Math.round(totals.spend * 100) / 100 }, period: `last ${days} days` })
        } catch (err) {
          return JSON.stringify({ error: `Supabase query failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'get_ad_accounts': {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseKey) return JSON.stringify({ error: 'Supabase not configured' })

        try {
          const resp = await fetch(`${supabaseUrl}/rest/v1/ad_accounts?select=*&is_active=eq.true`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const accounts = await resp.json()
          return JSON.stringify({ accounts })
        } catch {
          // Fallback: list unique accounts from performance data
          return JSON.stringify({ accounts: [
            { id: 'act_236690350962454', name: 'Client A brand Barbershop', client_slug: 'uppercuts-barbershop' },
            { id: 'act_698789644506560', name: 'Client A brand Tattoo', client_slug: 'uppercuts-tattoo' },
            { id: 'act_906967752025699', name: 'Client A brand Barber Academy', client_slug: 'uppercuts-academy' },
            { id: 'act_2371938493039107', name: 'Client C brand Vancouver Island', client_slug: 'eco-spa' },
            { id: 'act_980417616201931', name: 'Animo Boxing & MMA', client_slug: 'animo' },
            { id: 'act_317785086341567', name: 'High Performance Coaching', client_slug: 'hpa' },
            { id: 'act_418635207363932', name: 'CTRL', client_slug: 'ctrl' },
          ]})
        }
      }

      // ─── Creative Fatigue Detection ───
      case 'detect_creative_fatigue': {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseKey) return JSON.stringify({ error: 'Supabase not configured' })

        const freqThreshold = (input.threshold_frequency as number) || 3.5
        const ctrDropThreshold = (input.threshold_ctr_drop as number) || 20

        try {
          // Get last 14 days of data
          const startDate = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0]
          const midDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

          let url = `${supabaseUrl}/rest/v1/ad_performance_daily?select=ad_id,ad_name,campaign_name,client_slug,date,spend,impressions,clicks,ctr,frequency,hook_rate,hold_rate,video_views,video_thruplay&date=gte.${startDate}&order=date.asc`
          if (input.client_slug) url += `&client_slug=eq.${input.client_slug}`

          const resp = await fetch(url, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const data = await resp.json()

          // Group by ad, split into week1 (older) and week2 (recent)
          const adData = new Map<string, { name: string; campaign: string; client: string; week1: { ctr: number[]; freq: number[]; hook: number[] }; week2: { ctr: number[]; freq: number[]; hook: number[] }; totalSpend: number }>()

          for (const row of data) {
            const key = row.ad_id || row.ad_name
            if (!adData.has(key)) {
              adData.set(key, { name: row.ad_name, campaign: row.campaign_name, client: row.client_slug, week1: { ctr: [], freq: [], hook: [] }, week2: { ctr: [], freq: [], hook: [] }, totalSpend: 0 })
            }
            const ad = adData.get(key)!
            ad.totalSpend += row.spend || 0
            const week = row.date < midDate ? ad.week1 : ad.week2
            if (row.ctr) week.ctr.push(row.ctr)
            if (row.frequency) week.freq.push(row.frequency)
            if (row.hook_rate) week.hook.push(row.hook_rate)
          }

          const fatigued: { ad_name: string; campaign: string; client: string; signals: string[]; severity: string; spend: number; avg_frequency: number; ctr_change_pct: number }[] = []

          for (const [, ad] of adData) {
            const signals: string[] = []
            const avgFreqRecent = ad.week2.freq.length ? ad.week2.freq.reduce((a, b) => a + b, 0) / ad.week2.freq.length : 0
            const avgCtrOld = ad.week1.ctr.length ? ad.week1.ctr.reduce((a, b) => a + b, 0) / ad.week1.ctr.length : 0
            const avgCtrNew = ad.week2.ctr.length ? ad.week2.ctr.reduce((a, b) => a + b, 0) / ad.week2.ctr.length : 0
            const ctrChange = avgCtrOld > 0 ? ((avgCtrNew - avgCtrOld) / avgCtrOld) * 100 : 0

            if (avgFreqRecent >= freqThreshold) signals.push(`High frequency: ${avgFreqRecent.toFixed(1)}`)
            if (ctrChange < -ctrDropThreshold && avgCtrOld > 0) signals.push(`CTR dropped ${Math.abs(ctrChange).toFixed(0)}%`)

            const avgHookOld = ad.week1.hook.length ? ad.week1.hook.reduce((a, b) => a + b, 0) / ad.week1.hook.length : 0
            const avgHookNew = ad.week2.hook.length ? ad.week2.hook.reduce((a, b) => a + b, 0) / ad.week2.hook.length : 0
            if (avgHookOld > 0 && avgHookNew < avgHookOld * 0.75) signals.push(`Hook rate dropped ${((1 - avgHookNew / avgHookOld) * 100).toFixed(0)}%`)

            if (signals.length > 0) {
              fatigued.push({
                ad_name: ad.name, campaign: ad.campaign, client: ad.client,
                signals, severity: signals.length >= 3 ? 'critical' : signals.length >= 2 ? 'high' : 'medium',
                spend: Math.round(ad.totalSpend * 100) / 100,
                avg_frequency: Math.round(avgFreqRecent * 10) / 10,
                ctr_change_pct: Math.round(ctrChange),
              })
            }
          }

          fatigued.sort((a, b) => (b.severity === 'critical' ? 3 : b.severity === 'high' ? 2 : 1) - (a.severity === 'critical' ? 3 : a.severity === 'high' ? 2 : 1))

          return JSON.stringify({
            fatigued_ads: fatigued.slice(0, 20),
            total_flagged: fatigued.length,
            thresholds: { frequency: freqThreshold, ctr_drop_pct: ctrDropThreshold },
            recommendation: fatigued.length > 5 ? 'Multiple ads showing fatigue. Prioritize new creatives for critical severity ads.' : fatigued.length > 0 ? 'A few ads need attention. Consider refreshing creatives.' : 'No significant fatigue detected. Ads are performing stable.',
          })
        } catch (err) {
          return JSON.stringify({ error: `Fatigue check failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      // ─── Budget Pacing ───
      case 'get_budget_pacing': {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseKey) return JSON.stringify({ error: 'Supabase not configured' })

        try {
          const now = new Date()
          const dayOfMonth = now.getDate()
          const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
          const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

          let url = `${supabaseUrl}/rest/v1/ad_performance_daily?select=date,client_slug,account_name,spend&date=gte.${monthStart}&order=date.asc`
          if (input.client_slug) url += `&client_slug=eq.${input.client_slug}`

          const resp = await fetch(url, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const data = await resp.json()

          // Aggregate by client
          const clientSpend = new Map<string, { client: string; account: string; totalSpend: number; days: Set<string> }>()
          for (const row of data) {
            const key = row.client_slug || row.account_name
            if (!clientSpend.has(key)) clientSpend.set(key, { client: key, account: row.account_name, totalSpend: 0, days: new Set() })
            const c = clientSpend.get(key)!
            c.totalSpend += row.spend || 0
            c.days.add(row.date)
          }

          const monthlyBudget = input.monthly_budget as number | undefined
          const pacing = Array.from(clientSpend.values()).map(c => {
            const dailyAvg = c.days.size > 0 ? c.totalSpend / c.days.size : 0
            const projectedMonthly = dailyAvg * daysInMonth
            const idealPace = monthlyBudget ? (monthlyBudget / daysInMonth) * dayOfMonth : null
            const paceStatus = idealPace ? (c.totalSpend > idealPace * 1.15 ? 'overspending' : c.totalSpend < idealPace * 0.85 ? 'underspending' : 'on_track') : 'unknown'

            return {
              client: c.client, account: c.account,
              spend_mtd: Math.round(c.totalSpend * 100) / 100,
              daily_avg: Math.round(dailyAvg * 100) / 100,
              projected_monthly: Math.round(projectedMonthly * 100) / 100,
              target_monthly: monthlyBudget || null,
              pace_status: paceStatus,
              days_elapsed: dayOfMonth,
              days_remaining: daysInMonth - dayOfMonth,
            }
          })

          return JSON.stringify({ pacing, month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` })
        } catch (err) {
          return JSON.stringify({ error: `Pacing check failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      // ─── Client Report Generator ───
      case 'generate_client_report': {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseKey) return JSON.stringify({ error: 'Supabase not configured' })

        const clientSlug = input.client_slug as string
        const days = (input.days as number) || 7
        const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
        const prevStartDate = new Date(Date.now() - days * 2 * 86400000).toISOString().split('T')[0]

        try {
          // Current period
          const resp = await fetch(`${supabaseUrl}/rest/v1/ad_performance_daily?select=*&client_slug=eq.${clientSlug}&date=gte.${startDate}&order=date.asc`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const current = await resp.json()

          // Previous period for comparison
          const prevResp = await fetch(`${supabaseUrl}/rest/v1/ad_performance_daily?select=*&client_slug=eq.${clientSlug}&date=gte.${prevStartDate}&date=lt.${startDate}&order=date.asc`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const previous = await prevResp.json()

          const sum = (arr: Record<string, unknown>[], key: string) => arr.reduce((s, r) => s + ((r[key] as number) || 0), 0)

          const curTotals = { spend: sum(current, 'spend'), impressions: sum(current, 'impressions'), clicks: sum(current, 'clicks'), leads: sum(current, 'leads'), link_clicks: sum(current, 'link_clicks'), reach: sum(current, 'reach') }
          const prevTotals = { spend: sum(previous, 'spend'), impressions: sum(previous, 'impressions'), clicks: sum(previous, 'clicks'), leads: sum(previous, 'leads'), link_clicks: sum(previous, 'link_clicks'), reach: sum(previous, 'reach') }

          const pctChange = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0

          // Top performers
          const adMap = new Map<string, Record<string, number>>()
          for (const row of current) {
            const key = row.ad_name
            if (!adMap.has(key)) adMap.set(key, { spend: 0, clicks: 0, leads: 0, impressions: 0 })
            const a = adMap.get(key)!
            a.spend += row.spend || 0; a.clicks += row.clicks || 0; a.leads += row.leads || 0; a.impressions += row.impressions || 0
          }
          const topByLeads = Array.from(adMap.entries()).filter(([, v]) => v.leads > 0).sort(([, a], [, b]) => (a.spend / a.leads) - (b.spend / b.leads)).slice(0, 3)
          const worstByCpl = Array.from(adMap.entries()).filter(([, v]) => v.leads > 0).sort(([, a], [, b]) => (b.spend / b.leads) - (a.spend / a.leads)).slice(0, 3)

          // Build report markdown
          const clientName = clientSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          const reportDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

          let report = `# ${clientName} - Performance Report\n`
          report += `**Period:** Last ${days} days (${startDate} to today)\n`
          report += `**Generated:** ${reportDate}\n\n`
          report += `## Key Metrics\n\n`
          report += `| Metric | This Period | Previous Period | Change |\n`
          report += `| --- | --- | --- | --- |\n`
          report += `| Spend | $${curTotals.spend.toFixed(2)} | $${prevTotals.spend.toFixed(2)} | ${pctChange(curTotals.spend, prevTotals.spend)}% |\n`
          report += `| Impressions | ${curTotals.impressions.toLocaleString()} | ${prevTotals.impressions.toLocaleString()} | ${pctChange(curTotals.impressions, prevTotals.impressions)}% |\n`
          report += `| Clicks | ${curTotals.clicks.toLocaleString()} | ${prevTotals.clicks.toLocaleString()} | ${pctChange(curTotals.clicks, prevTotals.clicks)}% |\n`
          report += `| Leads | ${curTotals.leads} | ${prevTotals.leads} | ${pctChange(curTotals.leads, prevTotals.leads)}% |\n`
          report += `| CPL | ${curTotals.leads > 0 ? '$' + (curTotals.spend / curTotals.leads).toFixed(2) : 'N/A'} | ${prevTotals.leads > 0 ? '$' + (prevTotals.spend / prevTotals.leads).toFixed(2) : 'N/A'} | ${curTotals.leads > 0 && prevTotals.leads > 0 ? pctChange(curTotals.spend / curTotals.leads, prevTotals.spend / prevTotals.leads) + '%' : '-'} |\n`
          report += `| CTR | ${curTotals.impressions > 0 ? (curTotals.clicks / curTotals.impressions * 100).toFixed(2) + '%' : 'N/A'} | ${prevTotals.impressions > 0 ? (prevTotals.clicks / prevTotals.impressions * 100).toFixed(2) + '%' : 'N/A'} | - |\n`

          if (topByLeads.length > 0) {
            report += `\n## Top Performers (by CPL)\n\n`
            for (const [name, metrics] of topByLeads) {
              report += `- **${name}**: ${metrics.leads} leads at $${(metrics.spend / metrics.leads).toFixed(2)} CPL ($${metrics.spend.toFixed(2)} spend)\n`
            }
          }

          if (worstByCpl.length > 0) {
            report += `\n## Needs Attention (highest CPL)\n\n`
            for (const [name, metrics] of worstByCpl) {
              report += `- **${name}**: ${metrics.leads} leads at $${(metrics.spend / metrics.leads).toFixed(2)} CPL ($${metrics.spend.toFixed(2)} spend)\n`
            }
          }

          // Save as doc
          const doc = db.createDoc({ title: `${clientName} Report - ${reportDate}`, docType: 'report' })
          db.updateDoc(doc.id, { content: report })

          return JSON.stringify({ doc_id: doc.id, url: `/doc/${doc.public_id || doc.id}`, title: doc.title, summary: `Report generated: $${curTotals.spend.toFixed(2)} spend, ${curTotals.leads} leads, ${curTotals.clicks} clicks over ${days} days.` })
        } catch (err) {
          return JSON.stringify({ error: `Report generation failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      // ─── Competitor Ad Spy (Meta Ad Library) ───
      case 'spy_competitor_ads': {
        const metaToken = process.env.META_ACCESS_TOKEN
        const searchTerm = input.search_term as string
        const country = (input.country as string) || 'US'
        const limit = Math.min((input.limit as number) || 10, 20)

        if (metaToken) {
          try {
            const url = `https://graph.facebook.com/v19.0/ads_archive?search_terms=${encodeURIComponent(searchTerm)}&ad_reached_countries=['${country}']&ad_active_status=ACTIVE&fields=id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,page_name,ad_delivery_start_time,ad_snapshot_url,spend_lower,spend_upper&limit=${limit}&access_token=${metaToken}`
            const resp = await fetch(url)
            const data = await resp.json()

            if (data.data) {
              const ads = data.data.map((ad: Record<string, unknown>) => ({
                page_name: ad.page_name,
                body: (ad.ad_creative_bodies as string[])?.[0] || '',
                title: (ad.ad_creative_link_titles as string[])?.[0] || '',
                started: ad.ad_delivery_start_time,
                spend_range: ad.spend_lower && ad.spend_upper ? `$${ad.spend_lower}-$${ad.spend_upper}` : 'Unknown',
                snapshot_url: ad.ad_snapshot_url,
              }))
              return JSON.stringify({ ads, query: searchTerm, country, total: ads.length })
            }
            return JSON.stringify({ ads: [], query: searchTerm, note: 'No results found' })
          } catch (err) {
            return JSON.stringify({ error: `Ad Library query failed: ${err instanceof Error ? err.message : String(err)}` })
          }
        }

        // Fallback: scrape Ad Library web
        try {
          const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(searchTerm)}`
          return JSON.stringify({ url, note: 'Meta access token not available. Use this URL to browse the Ad Library manually, or add META_ACCESS_TOKEN to .env for direct API access.' })
        } catch {
          return JSON.stringify({ error: 'Could not access Meta Ad Library' })
        }
      }

      // ─── Lead Alerts ───
      case 'get_lead_alerts': {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseKey) return JSON.stringify({ error: 'Supabase not configured' })

        const hours = (input.hours as number) || 24
        const startDate = new Date(Date.now() - hours * 3600000).toISOString().split('T')[0]

        try {
          let url = `${supabaseUrl}/rest/v1/ad_performance_daily?select=date,client_slug,campaign_name,ad_name,leads,spend,cpl&date=gte.${startDate}&leads=gt.0&order=date.desc`
          if (input.client_slug) url += `&client_slug=eq.${input.client_slug}`

          const resp = await fetch(url, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
          })
          const data = await resp.json()

          const totalLeads = data.reduce((s: number, r: Record<string, unknown>) => s + ((r.leads as number) || 0), 0)
          const totalSpend = data.reduce((s: number, r: Record<string, unknown>) => s + ((r.spend as number) || 0), 0)

          return JSON.stringify({
            leads: data.slice(0, 30),
            total_leads: totalLeads,
            total_spend: Math.round(totalSpend * 100) / 100,
            avg_cpl: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0,
            period: `last ${hours} hours`,
          })
        } catch (err) {
          return JSON.stringify({ error: `Lead check failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      // ─── Email (approval required) ───
      case 'send_email': {
        const d = db.getDb()
        d.prepare(`
          INSERT INTO approval_queue (agent_id, action_type, action_data, created_at)
          VALUES (?, ?, ?, strftime('%s','now'))
        `).run(
          (input._caller_agent_id as string) || 'jimmy',
          'send_email',
          JSON.stringify({ to: input.to, subject: input.subject, body: input.body, client_id: input.client_id })
        )
        return JSON.stringify({ status: 'pending_approval', message: `Email to ${input.to} queued for your approval. Check the approval queue to send it.` })
      }

      // ─── Social Post (approval required) ───
      case 'schedule_post': {
        const d = db.getDb()
        d.prepare(`
          INSERT INTO approval_queue (agent_id, action_type, action_data, created_at)
          VALUES (?, ?, ?, strftime('%s','now'))
        `).run(
          (input._caller_agent_id as string) || 'sofia',
          'schedule_post',
          JSON.stringify({ platform: input.platform, caption: input.caption, image_url: input.image_url, scheduled_time: input.scheduled_time, client_id: input.client_id })
        )
        return JSON.stringify({ status: 'pending_approval', message: `${input.platform} post queued for your approval.` })
      }

      // ─── Agent Dispatch (chaining) ───
      case 'dispatch_to_agent': {
        const targetAgentId = input.agent_id as string
        const targetAgent = db.getAgent(targetAgentId)
        if (!targetAgent) return JSON.stringify({ error: `Agent '${targetAgentId}' not found` })

        let chainConfig: { nextAgentId: string; nextPrompt: string }[] | undefined
        if (input.chain_next) {
          try { chainConfig = JSON.parse(input.chain_next as string) } catch { /* */ }
        }

        const dispatch = db.enqueueDispatch({
          taskId: input.task_id as number | undefined,
          agentId: targetAgentId,
          triggerType: 'chain',
          sourceAgentId: (input._caller_agent_id as string) || 'jimmy',
          inputContext: input.prompt as string,
          chainConfig,
        })

        return JSON.stringify({
          dispatched: true,
          dispatch_id: dispatch.id,
          agent: targetAgent.name,
          message: `Dispatched to ${targetAgent.name}. They will execute autonomously and results will appear in the inbox.`,
        })
      }

      case 'web_search': {
        const query = input.query as string
        const numResults = Math.min((input.num_results as number) || 5, 10)
        try {
          // Use DuckDuckGo instant answer API + HTML scrape for web results
          const encoded = encodeURIComponent(query)
          const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CTRLMotion/1.0)' },
          })
          const html = await resp.text()
          // Parse results from DuckDuckGo HTML
          const results: { title: string; url: string; snippet: string }[] = []
          const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
          let match
          while ((match = resultRegex.exec(html)) !== null && results.length < numResults) {
            const url = decodeURIComponent(match[1].replace(/.*uddg=/, '').replace(/&.*/, ''))
            const title = match[2].replace(/<[^>]*>/g, '').trim()
            const snippet = match[3].replace(/<[^>]*>/g, '').trim()
            if (url.startsWith('http')) results.push({ title, url, snippet })
          }
          if (results.length === 0) {
            // Fallback: try simpler regex
            const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
            while ((match = linkRegex.exec(html)) !== null && results.length < numResults) {
              const url = decodeURIComponent(match[1].replace(/.*uddg=/, '').replace(/&.*/, ''))
              const title = match[2].replace(/<[^>]*>/g, '').trim()
              if (url.startsWith('http') && title) results.push({ title, url, snippet: '' })
            }
          }
          return JSON.stringify({ query, results })
        } catch (err) {
          return JSON.stringify({ error: `Search failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'fetch_webpage': {
        const url = input.url as string
        try {
          // SSRF protection: block internal/private network URLs
          try {
            const parsed = new URL(url)
            const hostname = parsed.hostname.toLowerCase()
            // Block localhost, internal IPs, cloud metadata endpoints
            const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '169.254.169.254', 'metadata.google.internal']
            if (blockedHosts.includes(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
              return JSON.stringify({ error: 'Blocked: cannot fetch internal/private network URLs' })
            }
            // Block private IP ranges (10.x, 172.16-31.x, 192.168.x)
            const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
            if (ipMatch) {
              const [, a, b] = ipMatch.map(Number)
              if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0) {
                return JSON.stringify({ error: 'Blocked: cannot fetch private network URLs' })
              }
            }
            // Only allow http/https
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              return JSON.stringify({ error: 'Only http and https URLs are supported' })
            }
          } catch {
            return JSON.stringify({ error: 'Invalid URL' })
          }
          // Intercept internal doc URLs (app.example.com/doc/123 or localhost:4000/doc/123)
          const docMatch = url.match(/(?:your-app\.example\.com|localhost:\d+)\/doc\/(?:\d+\/)?(\d+)/)
          if (docMatch) {
            const { getDoc } = await import('./db')
            const doc = getDoc(parseInt(docMatch[1]))
            if (doc) {
              let readable = `# ${doc.title}\n\n`
              try {
                const blocks = JSON.parse(doc.content)
                if (Array.isArray(blocks)) {
                  for (const block of blocks) {
                    if (block.type === 'heading') readable += `${'#'.repeat(block.level || 1)} ${block.content}\n\n`
                    else if (block.type === 'paragraph') readable += `${block.content}\n\n`
                    else if (block.type === 'list') readable += (block.items || []).map((i: string) => `- ${i}`).join('\n') + '\n\n'
                    else if (block.content) readable += `${block.content}\n\n`
                  }
                }
              } catch { readable += doc.content }
              return JSON.stringify({ url, content: readable.trim() })
            }
          }
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CTRLMotion/1.0)' },
            signal: AbortSignal.timeout(10000),
          })
          const html = await resp.text()
          // Strip HTML tags, scripts, styles -- extract readable text
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8000) // Limit to ~8k chars to stay in context
          return JSON.stringify({ url, content: text })
        } catch (err) {
          return JSON.stringify({ error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'api_request': {
        const method = (input.method as string || 'GET').toUpperCase()
        const apiPath = input.path as string
        if (!apiPath || !apiPath.startsWith('/api/')) {
          return JSON.stringify({ error: 'path must start with /api/' })
        }
        // Only allow requests to our own API
        const baseUrl = process.env.APP_URL || 'http://localhost:4000'
        const fullUrl = `${baseUrl}${apiPath}`
        try {
          const fetchOptions: RequestInit = {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-Token': getInternalApiSecret(),
            },
            signal: AbortSignal.timeout(30000),
          }
          if (input.body && (method === 'POST' || method === 'PATCH')) {
            fetchOptions.body = JSON.stringify(input.body)
          }
          const resp = await fetch(fullUrl, fetchOptions)
          const data = await resp.json()
          return JSON.stringify(data)
        } catch (err) {
          return JSON.stringify({ error: `API request failed: ${err instanceof Error ? err.message : String(err)}` })
        }
      }

      case 'lookup_client': {
        const { getBusinessByName, getClientByName, getClientBusinesses } = await import('./db')
        const searchName = String(input.name || '')
        // Try business first, then fall back to client
        const biz = getBusinessByName(searchName)
        if (biz) {
          return JSON.stringify({
            type: 'business',
            name: biz.name,
            slug: biz.slug,
            industry: biz.industry,
            brand_voice: biz.brand_voice,
            goals: biz.goals,
            target_audience: biz.target_audience,
            services: biz.services,
            offer: biz.offer,
            location: biz.location,
            website: biz.website,
            instagram_handle: biz.instagram_handle,
            facebook_page: biz.facebook_page,
            ad_account_id: biz.ad_account_id,
            page_id: biz.page_id,
            monthly_budget: biz.monthly_budget,
          })
        }
        // Fall back to client lookup -- return their linked businesses
        const client = getClientByName(searchName)
        if (!client) return JSON.stringify({ error: `No business or client found matching "${input.name}"` })
        const clientBizs = getClientBusinesses(client.id)
        return JSON.stringify({
          type: 'client',
          name: client.name,
          slug: client.slug,
          businesses: clientBizs.map(b => ({
            name: b.name,
            slug: b.slug,
            ad_account_id: b.ad_account_id,
            page_id: b.page_id,
            monthly_budget: b.monthly_budget,
            industry: b.industry,
            brand_voice: b.brand_voice,
            goals: b.goals,
          })),
        })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err) {
    return JSON.stringify({ error: `Tool error: ${err instanceof Error ? err.message : String(err)}` })
  }
}

// ─── BYOK Key Management ───

interface ApiKeyConfig {
  apiKey: string
  model: string
  dailyBudgetCents: number
  spentTodayCents: number
  provider: ProviderType
}

export function getApiKey(userId: number = 1): ApiKeyConfig | null {
  try {
    const { getDb } = require('./db')
    const db = getDb()
    // Try any provider — anthropic or openrouter
    const row = db.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY provider ASC LIMIT 1').get(userId) as {
      api_key_encrypted: string; model_preference: string; daily_budget_cents: number; spent_today_cents: number; last_reset_date: string; provider: string
    } | undefined

    if (!row) return null

    // Reset daily spend if new day
    const today = new Date().toISOString().split('T')[0]
    if (row.last_reset_date !== today) {
      db.prepare('UPDATE api_keys SET spent_today_cents = 0, last_reset_date = ? WHERE user_id = ? AND provider = ?').run(today, userId, row.provider)
      row.spent_today_cents = 0
    }

    // Detect provider from key format
    const provider = detectProvider(row.api_key_encrypted)
    // Set the global active provider so model routing uses the right models
    activeProvider = provider

    return {
      apiKey: row.api_key_encrypted,
      model: row.model_preference || 'standard',
      dailyBudgetCents: row.daily_budget_cents || 500,
      spentTodayCents: row.spent_today_cents || 0,
      provider,
    }
  } catch {
    return null
  }
}

// ─── Budget Circuit Breakers ───

export interface BudgetCheck {
  allowed: boolean
  model: string
  warning?: string
  hardLimit: boolean
}

export function checkBudget(userId: number, requestedModel: string): BudgetCheck {
  const keyConfig = getApiKey(userId)
  if (!keyConfig) {
    return { allowed: false, model: requestedModel, warning: 'No API key configured', hardLimit: true }
  }

  const budget = keyConfig.dailyBudgetCents
  const spent = keyConfig.spentTodayCents
  const pct = budget > 0 ? (spent / budget) * 100 : 0

  // HARD LIMIT: 2x budget - block all requests
  if (spent >= budget * 2) {
    return {
      allowed: false,
      model: requestedModel,
      warning: `Daily budget exceeded ($${(spent / 100).toFixed(2)} / $${(budget / 100).toFixed(2)}). Requests blocked until tomorrow.`,
      hardLimit: true,
    }
  }

  // SOFT LIMIT: at budget - downgrade to cheapest model
  if (spent >= budget) {
    return {
      allowed: true,
      model: getModelId('haiku'),
      warning: `Budget reached ($${(spent / 100).toFixed(2)} / $${(budget / 100).toFixed(2)}). Auto-downgraded to cheapest model.`,
      hardLimit: false,
    }
  }

  // WARNING: 75% budget
  if (pct >= 75) {
    return {
      allowed: true,
      model: requestedModel,
      warning: `${Math.round(pct)}% of daily budget used ($${(spent / 100).toFixed(2)} / $${(budget / 100).toFixed(2)})`,
      hardLimit: false,
    }
  }

  return { allowed: true, model: requestedModel, hardLimit: false }
}

function trackCost(userId: number, inputTokens: number, outputTokens: number, model: string): number {
  const costCents = calculateCost(inputTokens, outputTokens, model)

  try {
    const { getDb } = require('./db')
    const db = getDb()
    db.prepare('UPDATE api_keys SET spent_today_cents = spent_today_cents + ? WHERE user_id = ?').run(costCents, userId)
    // Track model routing distribution
    db.prepare('INSERT INTO model_routing_log (model, cost_cents) VALUES (?, ?)').run(model, costCents)
  } catch { /* ignore */ }

  return costCents
}

// ─── Main Agent Execution (non-streaming, for API/Telegram use) ───

export interface AgentRunResult {
  success: boolean
  output: string
  toolCalls: number
  inputTokens: number
  outputTokens: number
  costCents: number
  model?: string
  error?: string
  budgetWarning?: string
}

export async function runAgent(
  agentId: string,
  userMessage: string,
  opts: { taskId?: number; userId?: number; maxTurns?: number } = {}
): Promise<AgentRunResult> {
  const { taskId, userId = 1, maxTurns = 25 } = opts

  // Validate input
  const { safe, sanitized } = validateInput(userMessage)
  if (!safe) {
    return { success: false, output: 'Message blocked by safety filter.', toolCalls: 0, inputTokens: 0, outputTokens: 0, costCents: 0 }
  }

  // Load agent config
  const agent = getAgent(agentId)
  if (!agent) return { success: false, output: 'Agent not found', toolCalls: 0, inputTokens: 0, outputTokens: 0, costCents: 0 }

  const config = loadAgentConfig(agentId)

  // Match skills to message and build context
  let skillContext = ''
  let matchedSkillIds: number[] = []
  try {
    const matched = matchSkills(agentId, sanitized)
    if (matched.length > 0) {
      // Filter by allowed platform skills from DB
      let allowedPlatformSkills: Set<string> | null = null
      try {
        const tools = JSON.parse(agent.allowed_tools || '["*"]')
        if (!tools.includes('*')) {
          allowedPlatformSkills = new Set(tools as string[])
        }
      } catch { /* use all */ }

      const filtered = allowedPlatformSkills
        ? matched.filter(s => allowedPlatformSkills!.has(s.slug))
        : matched

      if (filtered.length > 0) {
        skillContext = buildSkillContext(filtered)
        matchedSkillIds = filtered.map(s => s.id)
      }
    }
    // If no skills matched by trigger but agent has ad/campaign skills assigned, load them anyway
    // This ensures Gary always has the campaign management instructions even for messages like "try again"
    if (matchedSkillIds.length === 0) {
      const adSkillSlugs = ['meta-campaign-management', 'ads-meta']
      try {
        const dbToolsList = JSON.parse(agent.allowed_tools || '["*"]')
        if (!dbToolsList.includes('*')) {
          const hasAdSkill = (dbToolsList as string[]).some(t => adSkillSlugs.includes(t))
          if (hasAdSkill) {
            const allAgentSkills = getInstalledSkills().filter(s => (dbToolsList as string[]).includes(s.slug) && s.enabled)
            if (allAgentSkills.length > 0) {
              skillContext = buildSkillContext(allAgentSkills)
              matchedSkillIds = allAgentSkills.map(s => s.id)
            }
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* skills not initialized yet, continue without */ }

  const systemBlocks = buildCachedSystemPrompt(agent, config, skillContext)

  // Build tool list: start with config.skills from filesystem, then add api_request if agent has campaign skills enabled
  let allowedTools = config.skills
  try {
    const dbTools = JSON.parse(agent.allowed_tools || '["*"]')
    const hasWildcard = dbTools.includes('*')
    if (hasWildcard) {
      allowedTools = [] // empty = give all tools
    } else {
      // Always include internal tools from config.skills + api_request if any ads/campaign skills are enabled
      const adSkills = ['ads-meta', 'ads-audit', 'ads-creative', 'ads-budget', 'ads-competitor', 'ads-plan', 'meta-campaign-management']
      const hasAdSkill = (dbTools as string[]).some(t => adSkills.includes(t))
      if (hasAdSkill && !allowedTools.includes('api_request')) {
        allowedTools = [...allowedTools, 'api_request']
      }
    }
  } catch { /* use config.skills as-is */ }
  const tools = getToolDefinitions(allowedTools)

  // Get API key (BYOK or env)
  const keyConfig = getApiKey(userId)
  const apiKey = keyConfig?.apiKey || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY
  const provider: ProviderType = keyConfig?.provider || (apiKey ? detectProvider(apiKey) : 'anthropic')
  activeProvider = provider
  if (!apiKey) return { success: false, output: 'No API key configured. Add one in Settings > AI.', toolCalls: 0, inputTokens: 0, outputTokens: 0, costCents: 0 }

  // Model routing: classify complexity, respect agent's preference, then check budget
  // If skills matched OR agent has campaign mgmt tools, escalate to at least sonnet
  const hasAdTools = allowedTools.includes('api_request')
  const needsSonnet = (matchedSkillIds.length > 0 || hasAdTools) && classifyComplexity(sanitized) === 'haiku'
  const complexity = needsSonnet ? 'sonnet' as ModelTier : classifyComplexity(sanitized)
  const idealModel = resolveModel(complexity, agent.model_preference)
  const budget = checkBudget(userId, idealModel)

  if (!budget.allowed) {
    return { success: false, output: budget.warning || 'Budget exceeded', toolCalls: 0, inputTokens: 0, outputTokens: 0, costCents: 0, budgetWarning: budget.warning }
  }

  const model = budget.model

  // Update agent status
  updateAgent(agentId, { status: 'working', current_task_id: taskId || null })
  if (taskId) {
    updateTask(taskId, { status: 'in_progress' })
    createTaskActivity(taskId, 'agent_started', `${agent.name} started working`, agentId)
  }

  // Log run start
  const { getDb } = require('./db')
  const db = getDb()
  const runResult = db.prepare(`
    INSERT INTO agent_runs (agent_id, task_id, trigger, status, model, started_at)
    VALUES (?, ?, 'api', 'running', ?, strftime('%s','now'))
  `).run(agentId, taskId || null, model)
  const runId = runResult.lastInsertRowid

  let totalInput = 0
  let totalOutput = 0
  let totalToolCalls = 0
  let finalOutput = ''

  // Wall-clock timeout: 5 minutes max per agent run
  const AGENT_RUN_TIMEOUT_MS = 5 * 60 * 1000
  const runDeadline = Date.now() + AGENT_RUN_TIMEOUT_MS

  try {
    let messages: Array<{ role: string; content: unknown }> = [
      { role: 'user', content: sanitized },
    ]

    for (let turn = 0; turn < maxTurns; turn++) {
      // Check wall-clock timeout
      if (Date.now() > runDeadline) {
        finalOutput = finalOutput || 'Agent run timed out after 5 minutes.'
        break
      }
      const fetchConfig = buildFetchConfig(provider, apiKey, model, systemBlocks, messages, tools, getMaxTokens(complexity, matchedSkillIds.length > 0), false)
      const response = await fetch(fetchConfig.url, {
        method: 'POST',
        headers: fetchConfig.headers,
        body: fetchConfig.body,
        signal: AbortSignal.timeout(60000), // 60s per API call
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`API error ${response.status}: ${err}`)
      }

      const rawData = await response.json()
      const data = normalizeResponse(provider, rawData)

      totalInput += data.usage.input_tokens + (data.usage.cache_creation_input_tokens || 0) + (data.usage.cache_read_input_tokens || 0)
      totalOutput += data.usage.output_tokens

      const textBlocks = data.content.filter(c => c.type === 'text')
      const toolUses = data.content.filter(c => c.type === 'tool_use')

      if (textBlocks.length > 0) {
        finalOutput = textBlocks.map(b => b.text).join('\n')
      }

      if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
        break
      }

      totalToolCalls += toolUses.length
      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []

      for (const tu of toolUses) {
        // Inject agent_id into tool input for reference/learning tools
        const rawInput = tu.input as Record<string, unknown> || {}
        const toolInput: Record<string, unknown> = { ...rawInput, _caller_agent_id: agentId }
        // Only inject agent_id if tool didn't specify one (for tools where agent_id = target)
        if (!rawInput.agent_id) toolInput.agent_id = agentId
        const result = await executeTool(tu.name!, toolInput)
        const truncatedResult = result.length > 4000 ? result.slice(0, 4000) + '\n... [truncated, ' + result.length + ' chars total]' : result
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id!,
          content: truncatedResult,
        })
      }

      messages.push({ role: 'assistant', content: data.content })
      messages.push({ role: 'user', content: toolResults })
    }

    const costCents = trackCost(userId, totalInput, totalOutput, model)

    db.prepare(`
      UPDATE agent_runs SET status = 'completed', input_tokens = ?, output_tokens = ?, cost_cents = ?,
        completed_at = strftime('%s','now'), result = ?
      WHERE id = ?
    `).run(totalInput, totalOutput, costCents, finalOutput.slice(0, 10000), runId)

    updateAgent(agentId, { status: 'standby', current_task_id: null, last_active: Math.floor(Date.now() / 1000) })

    // WAL Protocol: auto-capture learnings from the conversation
    // If the agent produced meaningful output, log it as a potential memory update
    if (finalOutput && totalToolCalls > 0) {
      try {
        const summary = `Completed task with ${totalToolCalls} tool calls using ${model}. Output: ${finalOutput.slice(0, 200)}`
        updateAgentMemory(agentId, summary)
      } catch { /* non-critical */ }
    }

    if (taskId) {
      createTaskActivity(taskId, 'agent_completed', `${agent.name} completed work. ${totalToolCalls} tool calls, $${(costCents / 100).toFixed(2)} cost.`, agentId, JSON.stringify({ output: finalOutput.slice(0, 5000) }))
      updateTask(taskId, { status: 'review' })
    }

    return { success: true, output: finalOutput, toolCalls: totalToolCalls, inputTokens: totalInput, outputTokens: totalOutput, costCents, model, budgetWarning: budget.warning }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    db.prepare(`
      UPDATE agent_runs SET status = 'failed', completed_at = strftime('%s','now'), error = ? WHERE id = ?
    `).run(errorMsg, runId)

    updateAgent(agentId, { status: 'standby', current_task_id: null })

    // Log error as learning for self-improvement
    try { logLearning(agentId, null, 'error', errorMsg.slice(0, 500)) } catch { /* non-critical */ }

    if (taskId) {
      createTaskActivity(taskId, 'agent_failed', `${agent.name} failed: ${errorMsg.slice(0, 200)}`, agentId)
    }

    return { success: false, output: '', toolCalls: totalToolCalls, inputTokens: totalInput, outputTokens: totalOutput, costCents: 0, error: errorMsg }
  }
}

// ─── Streaming Agent Execution (for chat UI) ───

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_update' | 'tool_result' | 'cost' | 'error' | 'done' | 'warning'
  data: unknown
}

export async function* runAgentStream(
  agentId: string,
  userMessage: string | unknown[],
  conversationHistory: ConversationMessage[] = [],
  opts: { userId?: number; sessionId?: number } = {}
): AsyncGenerator<StreamEvent> {
  const { userId = 1, sessionId } = opts

  // Validate input -- extract text for validation, keep full content for API
  const textMessage = typeof userMessage === 'string'
    ? userMessage
    : (userMessage.find((b: unknown) => (b as { type: string }).type === 'text') as { text?: string } | undefined)?.text || ''
  const { safe, sanitized } = validateInput(textMessage)
  if (!safe) {
    yield { type: 'error', data: 'Message blocked by safety filter.' }
    return
  }
  // For multimodal, use original content blocks with sanitized text
  const userContent = typeof userMessage === 'string'
    ? sanitized
    : userMessage.map((b: unknown) => {
        const block = b as Record<string, unknown>
        if (block.type === 'text') return { ...block, text: sanitized }
        return block
      })

  // Load agent
  const agent = getAgent(agentId)
  if (!agent) {
    yield { type: 'error', data: 'Agent not found' }
    return
  }

  const config = loadAgentConfig(agentId)

  // Match skills to message
  let skillContext = ''
  let matchedSkillIds: number[] = []
  const skillExecStart = Date.now()
  try {
    const matched = matchSkills(agentId, sanitized)
    if (matched.length > 0) {
      // Filter by allowed platform skills from DB
      let allowedPlatformSkills2: Set<string> | null = null
      try {
        const dbTools2 = JSON.parse(agent.allowed_tools || '["*"]')
        if (!dbTools2.includes('*')) {
          allowedPlatformSkills2 = new Set(dbTools2 as string[])
        }
      } catch { /* use all */ }

      const filtered = allowedPlatformSkills2
        ? matched.filter(s => allowedPlatformSkills2!.has(s.slug))
        : matched

      if (filtered.length > 0) {
        skillContext = buildSkillContext(filtered)
        matchedSkillIds = filtered.map(s => s.id)
      }
    }
    // If no skills matched by trigger but agent has ad/campaign skills assigned, load them anyway
    if (matchedSkillIds.length === 0) {
      const adSkillSlugs = ['meta-campaign-management', 'ads-meta']
      try {
        const dbToolsList = JSON.parse(agent.allowed_tools || '["*"]')
        if (!dbToolsList.includes('*')) {
          const hasAdSkill = (dbToolsList as string[]).some((t: string) => adSkillSlugs.includes(t))
          if (hasAdSkill) {
            const allAgentSkills = getInstalledSkills().filter(s => (dbToolsList as string[]).includes(s.slug) && s.enabled)
            if (allAgentSkills.length > 0) {
              skillContext = buildSkillContext(allAgentSkills)
              matchedSkillIds = allAgentSkills.map(s => s.id)
            }
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* skills not initialized yet */ }

  const systemBlocks = buildCachedSystemPrompt(agent, config, skillContext)

  // Build tool list with platform skill awareness
  let allowedTools2 = config.skills
  try {
    const dbTools2 = JSON.parse(agent.allowed_tools || '["*"]')
    const hasWildcard2 = dbTools2.includes('*')
    if (hasWildcard2) {
      allowedTools2 = [] // empty = give all tools
    } else {
      const adSkills = ['ads-meta', 'ads-audit', 'ads-creative', 'ads-budget', 'ads-competitor', 'ads-plan', 'meta-campaign-management']
      const hasAdSkill = (dbTools2 as string[]).some((t: string) => adSkills.includes(t))
      if (hasAdSkill && !allowedTools2.includes('api_request')) {
        allowedTools2 = [...allowedTools2, 'api_request']
      }
    }
  } catch { /* use config.skills as-is */ }
  const tools = getToolDefinitions(allowedTools2)

  // API key + provider detection
  const keyConfig = getApiKey(userId)
  const apiKey = keyConfig?.apiKey || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    yield { type: 'error', data: 'No API key configured. Add one in Settings > AI.' }
    return
  }
  const provider: ProviderType = keyConfig?.provider || detectProvider(apiKey)
  activeProvider = provider

  // Model routing + budget check
  // Escalate to sonnet when skills are active OR agent has campaign mgmt tools
  const hasAdTools2 = allowedTools2.includes('api_request')
  const needsSonnet2 = (matchedSkillIds.length > 0 || hasAdTools2) && classifyComplexity(sanitized) === 'haiku'
  const complexity = needsSonnet2 ? 'sonnet' as ModelTier : classifyComplexity(sanitized)
  const idealModel = resolveModel(complexity, agent.model_preference)
  const budget = checkBudget(userId, idealModel)

  if (!budget.allowed) {
    yield { type: 'error', data: budget.warning || 'Daily budget exceeded' }
    return
  }

  if (budget.warning) {
    yield { type: 'warning', data: budget.warning }
  }

  const model = budget.model

  // Update agent status
  updateAgent(agentId, { status: 'working', current_task_id: null })

  // Log run
  const { getDb } = require('./db')
  const db = getDb()
  const runResult = db.prepare(`
    INSERT INTO agent_runs (agent_id, trigger, status, model, started_at)
    VALUES (?, 'chat', 'running', ?, strftime('%s','now'))
  `).run(agentId, model)
  const runId = runResult.lastInsertRowid

  let totalInput = 0
  let totalOutput = 0
  let totalToolCalls = 0
  let finalOutput = ''

  try {
    // Build messages: conversation history + new message
    const { messages: trimmedHistory, trimmed, warning } = trimConversation(conversationHistory)
    if (warning) {
      yield { type: 'warning', data: warning }
    }

    let messages: ConversationMessage[] = [
      ...trimmedHistory,
      { role: 'user', content: userContent },
    ]

    const maxTurns = 25
    // Wall-clock timeout: 5 minutes max per streaming agent run
    const STREAM_TIMEOUT_MS = 5 * 60 * 1000
    const streamDeadline = Date.now() + STREAM_TIMEOUT_MS

    for (let turn = 0; turn < maxTurns; turn++) {
      // Check wall-clock timeout
      if (Date.now() > streamDeadline) {
        yield { type: 'warning', data: 'Agent run timed out after 5 minutes.' }
        break
      }
      // Use streaming API via provider abstraction
      const fetchConfig = buildFetchConfig(provider, apiKey, model, systemBlocks, messages, tools, getMaxTokens(complexity, matchedSkillIds.length > 0), true)
      const response = await fetch(fetchConfig.url, {
        method: 'POST',
        headers: fetchConfig.headers,
        body: fetchConfig.body,
        signal: AbortSignal.timeout(60000), // 60s per API call
      })

      if (!response.ok) {
        const err = await response.text()
        yield { type: 'error', data: `API error ${response.status}: ${err}` }
        break
      }

      // Parse SSE stream (provider-agnostic)
      const reader = response.body?.getReader()
      if (!reader) {
        yield { type: 'error', data: 'No response body' }
        break
      }

      const decoder = new TextDecoder()
      let buffer = ''
      const streamState = newStreamState()
      let toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
      let stopReason = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          const events = parseStreamLine(provider, data, streamState)
          for (const evt of events) {
            switch (evt.kind) {
              case 'text':
                yield { type: 'text', data: evt.text }
                break
              case 'tool_start':
                yield { type: 'tool_use', data: { id: evt.id, name: evt.name, status: 'started' } }
                break
              case 'tool_input':
                yield { type: 'tool_update', data: { id: evt.id, input: evt.input } }
                toolUses.push({ id: evt.id!, name: streamState.currentToolName || evt.id!, input: evt.input })
                break
              case 'text_end':
                finalOutput = evt.text
                break
              case 'stop':
                stopReason = evt.reason
                break
              case 'usage':
                // handled below via streamState
                break
            }
          }
        }
      }

      // Collect tool uses from content blocks (for providers where tool_input event may not fire separately)
      if (toolUses.length === 0 && streamState.contentBlocks.length > 0) {
        for (const block of streamState.contentBlocks) {
          if (block.type === 'tool_use' && block.id && block.name) {
            toolUses.push({ id: block.id, name: block.name, input: block.input || {} })
          }
        }
      }
      if (!finalOutput && streamState.currentText) {
        finalOutput = streamState.currentText
      }

      totalInput += streamState.turnInput
      totalOutput += streamState.turnOutput

      // If no tool use, we're done
      if (stopReason !== 'tool_use' || toolUses.length === 0) {
        break
      }

      // Execute tool calls
      totalToolCalls += toolUses.length
      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []

      for (const tu of toolUses) {
        const parsedInput: Record<string, unknown> = { ...tu.input }
        // Inject caller identity; preserve agent_id if tool specifies a target
        parsedInput._caller_agent_id = agentId
        if (!parsedInput.agent_id) parsedInput.agent_id = agentId
        const result = await executeTool(tu.name, parsedInput)
        // Truncate tool results to prevent context bloat (large API responses like accounts/creatives)
        const truncatedResult = result.length > 4000 ? result.slice(0, 4000) + '\n... [truncated, ' + result.length + ' chars total]' : result
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: truncatedResult,
        })
        yield { type: 'tool_result', data: { id: tu.id, name: tu.name, result: result.slice(0, 2000) } }
      }

      // Continue conversation with content blocks from stream state
      const contentBlocks = streamState.contentBlocks.length > 0 ? streamState.contentBlocks : toolUses.map(tu => ({ type: 'tool_use' as const, id: tu.id, name: tu.name, input: tu.input }))
      messages.push({ role: 'assistant', content: contentBlocks })
      messages.push({ role: 'user', content: toolResults })

      // Reset for next turn
      toolUses = []
    }

    // Track cost
    const costCents = trackCost(userId, totalInput, totalOutput, model)

    // Update run record
    db.prepare(`
      UPDATE agent_runs SET status = 'completed', input_tokens = ?, output_tokens = ?, cost_cents = ?,
        completed_at = strftime('%s','now'), result = ?
      WHERE id = ?
    `).run(totalInput, totalOutput, costCents, finalOutput.slice(0, 10000), runId)

    updateAgent(agentId, { status: 'standby', current_task_id: null, last_active: Math.floor(Date.now() / 1000) })

    // Track skill executions
    for (const sid of matchedSkillIds) {
      try {
        const execId = startSkillExecution(sid, agentId, sanitized)
        completeSkillExecution(execId, { durationMs: Date.now() - skillExecStart, tokensUsed: totalInput + totalOutput })
      } catch { /* */ }
    }

    // WAL: capture corrections/preferences from the conversation
    if (finalOutput && (finalOutput.includes('correction') || finalOutput.includes('I was wrong') || finalOutput.includes('you\'re right'))) {
      try { logLearning(agentId, null, 'correction', `User interaction correction: ${sanitized.slice(0, 200)} -> ${finalOutput.slice(0, 500)}`) } catch { /* */ }
    }

    yield {
      type: 'cost',
      data: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        costCents,
        model,
        toolCalls: totalToolCalls,
        skillsUsed: matchedSkillIds.length,
      },
    }

    yield { type: 'done', data: null }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    db.prepare(`
      UPDATE agent_runs SET status = 'failed', completed_at = strftime('%s','now'), error = ? WHERE id = ?
    `).run(errorMsg, runId)

    updateAgent(agentId, { status: 'standby', current_task_id: null })

    // Track skill failures
    for (const sid of matchedSkillIds) {
      try {
        const execId = startSkillExecution(sid, agentId, sanitized)
        failSkillExecution(execId, errorMsg, Date.now() - skillExecStart)
      } catch { /* */ }
    }

    yield { type: 'error', data: errorMsg }
  }
}

// ─── Heavy Task Execution (Claude Code subprocess for code gen, video, etc.) ───

export async function runHeavyTask(agentId: string, prompt: string): Promise<{ success: boolean; output: string }> {
  const config = loadAgentConfig(agentId)
  const fullPrompt = config.soul + '\n\n' + config.memory + '\n\n' + prompt

  return new Promise((resolve) => {
    const proc = spawn('claude', ['-p', fullPrompt], {
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: 600000,
    })

    let output = ''
    let error = ''
    proc.stdout.on('data', (data: Buffer) => { output += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { error += data.toString() })

    proc.on('close', (code) => resolve({ success: code === 0, output: output || error }))
    proc.on('error', (err) => resolve({ success: false, output: err.message }))
  })
}
