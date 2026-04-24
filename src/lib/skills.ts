/**
 * Skill System - Scanner, health checks, runtime integration, self-improvement.
 *
 * Scans ~/.claude/skills/ for SKILL.md files, parses them into the DB,
 * and makes them available to the agent runtime.
 *
 * Reliability features:
 * - Health checks (validate SKILL.md, check env vars, test scripts)
 * - Execution logging with error tracking
 * - Auto-disable after repeated failures (circuit breaker)
 * - WAL-style learnings capture
 * - Graceful fallback when skills are unhealthy
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { execSync } from 'child_process'
import { getDb } from './db'

// ─── Config ───

const SKILLS_DIR = resolve(process.env.HOME || '~', '.claude', 'skills')
const ERROR_THRESHOLD = 5 // auto-disable after this many consecutive errors
const HEALTH_CHECK_INTERVAL_MS = 3600000 // 1 hour

// ─── Types ───

export interface InstalledSkill {
  id: number
  slug: string
  name: string
  description: string
  version: string
  skill_md: string
  triggers: string[] // parsed from JSON
  allowed_tools: string[]
  env_vars_needed: string[]
  tags: string[]
  homepage: string | null
  scripts_path: string | null
  installed_from: string
  enabled: number
  health_status: string
  last_health_check: number | null
  error_count: number
  last_error: string | null
  last_used: number | null
  use_count: number
  created_at: number
  updated_at: number
}

interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  'allowed-tools'?: string
  'argument-hint'?: string
  'user-invocable'?: boolean
  'disable-model-invocation'?: boolean
  'command-dispatch'?: string
  'command-tool'?: string
  homepage?: string
  metadata?: {
    // Support both OpenClaw format and legacy clawdbot format
    openclaw?: {
      emoji?: string
      always?: boolean
      os?: string[]
      requires?: { env?: string[]; bins?: string[]; anyBins?: string[]; config?: string[] }
      primaryEnv?: string
      tags?: string[]
      homepage?: string
      install?: Array<{ id: string; kind: string; formula?: string; bins?: string[]; label?: string }>
    }
    clawdbot?: {
      emoji?: string
      requires?: { env?: string[]; bins?: string[] }
      primaryEnv?: string
      tags?: string[]
      files?: string[]
      homepage?: string
    }
  }
}

// Helper to get openclaw metadata (supports both formats)
function getSkillMeta(fm: SkillFrontmatter) {
  return fm.metadata?.openclaw || fm.metadata?.clawdbot || null
}

// ─── Skill Gating (OpenClaw-compatible load-time filters) ───

export function checkSkillGating(fm: SkillFrontmatter): { eligible: boolean; issues: string[] } {
  const meta = getSkillMeta(fm)
  if (!meta) return { eligible: true, issues: [] }
  if ('always' in meta && meta.always) return { eligible: true, issues: [] }

  const issues: string[] = []

  // OS check
  if ('os' in meta && meta.os && meta.os.length > 0) {
    if (!meta.os.includes(process.platform)) {
      issues.push(`Requires OS: ${meta.os.join(', ')} (current: ${process.platform})`)
    }
  }

  // Required binaries
  if (meta.requires?.bins) {
    for (const bin of meta.requires.bins) {
      try { execSync(`which ${bin}`, { stdio: 'pipe' }) } catch {
        issues.push(`Missing required binary: ${bin}`)
      }
    }
  }

  // Any of these binaries
  if ('anyBins' in meta && meta.requires && 'anyBins' in meta.requires && meta.requires.anyBins) {
    const found = meta.requires.anyBins.some(bin => {
      try { execSync(`which ${bin}`, { stdio: 'pipe' }); return true } catch { return false }
    })
    if (!found) issues.push(`Needs one of: ${meta.requires.anyBins.join(', ')}`)
  }

  // Required env vars
  if (meta.requires?.env) {
    for (const env of meta.requires.env) {
      if (!process.env[env]) {
        // Check env vault
        try {
          const row = getDb().prepare('SELECT value_encrypted FROM env_vault WHERE key = ?').get(env)
          if (!row) issues.push(`Missing env var: ${env}`)
        } catch {
          issues.push(`Missing env var: ${env}`)
        }
      }
    }
  }

  return { eligible: issues.length === 0, issues }
}

// ─── SKILL.md Parser ───

function parseSkillMd(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) {
    return { frontmatter: { name: 'unknown', description: '' }, body: content }
  }

  const rawYaml = fmMatch[1]
  const body = fmMatch[2]

  // Simple YAML parser (handles the common skill frontmatter patterns)
  const fm: Record<string, unknown> = {}
  let currentKey = ''
  let currentValue = ''
  let inMultiline = false
  let inArray = false
  let arrayKey = ''
  let arrayItems: string[] = []
  let inNestedObj = false
  let nestedPath: string[] = []

  for (const line of rawYaml.split('\n')) {
    const trimmed = line.trimEnd()

    // Array item
    if (inArray && trimmed.match(/^\s+-\s+/)) {
      const val = trimmed.replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, '')
      arrayItems.push(val)
      continue
    } else if (inArray && !trimmed.match(/^\s+-/)) {
      setNestedValue(fm, [...nestedPath, arrayKey], arrayItems)
      inArray = false
      arrayItems = []
    }

    // Multiline string continuation
    if (inMultiline && trimmed.match(/^\s+/)) {
      currentValue += ' ' + trimmed.trim()
      continue
    } else if (inMultiline) {
      setNestedValue(fm, [...nestedPath, currentKey], currentValue.trim())
      inMultiline = false
    }

    // Nested object detection
    const indent = line.match(/^(\s*)/)?.[1]?.length || 0
    const kvMatch = trimmed.match(/^(\s*)([\w-]+)\s*:\s*(.*)$/)

    if (!kvMatch) continue

    const key = kvMatch[2]
    let value = kvMatch[3].trim()

    // Determine nesting level
    const level = Math.floor(indent / 2)
    nestedPath = nestedPath.slice(0, level)

    if (value === '' || value === '>') {
      // Could be a nested object, multiline string, or array
      const nextLineIdx = rawYaml.split('\n').indexOf(line) + 1
      const nextLine = rawYaml.split('\n')[nextLineIdx] || ''
      if (nextLine.match(/^\s+-\s/)) {
        inArray = true
        arrayKey = key
        arrayItems = []
        nestedPath.push(key)
        nestedPath.pop() // arrays go under current path
        continue
      } else if (nextLine.match(/^\s+\w/)) {
        nestedPath.push(key)
        continue
      } else if (value === '>') {
        inMultiline = true
        currentKey = key
        currentValue = ''
        continue
      }
    } else {
      // Simple value
      value = value.replace(/^["']|["']$/g, '')
      setNestedValue(fm, [...nestedPath, key], value)
    }
  }

  // Flush remaining
  if (inArray) setNestedValue(fm, [...nestedPath, arrayKey], arrayItems)
  if (inMultiline) setNestedValue(fm, [...nestedPath, currentKey], currentValue.trim())

  return { frontmatter: fm as unknown as SkillFrontmatter, body }
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown) {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    if (!current[path[i]] || typeof current[path[i]] !== 'object') {
      current[path[i]] = {}
    }
    current = current[path[i]] as Record<string, unknown>
  }
  current[path[path.length - 1]] = value
}

// ─── Extract trigger keywords from description ───

function extractTriggers(description: string, name: string): string[] {
  const triggers = [name]

  // Extract quoted triggers from description
  const quoteMatches = description.match(/"([^"]+)"/g)
  if (quoteMatches) {
    triggers.push(...quoteMatches.map(m => m.replace(/"/g, '').toLowerCase()))
  }

  // Common trigger patterns
  const whenPatterns = description.match(/(?:when\s+(?:user\s+)?says?|triggered?\s+by|use\s+when)\s+["']?([^."']+)/gi)
  if (whenPatterns) {
    for (const p of whenPatterns) {
      const words = p.replace(/.*(?:says?|by|when)\s+["']?/i, '').split(/[,;]/)
      triggers.push(...words.map(w => w.trim().toLowerCase().replace(/["']/g, '')).filter(w => w.length > 2))
    }
  }

  return [...new Set(triggers)]
}

// ─── Scanner: Import skills from ~/.claude/skills/ ───

export function scanLocalSkills(): { imported: number; updated: number; errors: string[] } {
  const db = getDb()
  let imported = 0
  let updated = 0
  const errors: string[] = []

  if (!existsSync(SKILLS_DIR)) {
    return { imported: 0, updated: 0, errors: ['Skills directory not found: ' + SKILLS_DIR] }
  }

  const dirs = readdirSync(SKILLS_DIR).filter(d => {
    const full = join(SKILLS_DIR, d)
    return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'))
  })

  for (const dir of dirs) {
    try {
      const skillPath = join(SKILLS_DIR, dir, 'SKILL.md')
      const content = readFileSync(skillPath, 'utf8')
      const { frontmatter, body } = parseSkillMd(content)

      const slug = dir
      const name = frontmatter.name || dir
      const description = typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : ''
      const version = frontmatter.version || '1.0'
      const allowedTools = frontmatter['allowed-tools']
        ? frontmatter['allowed-tools'].split(',').map(t => t.trim())
        : []
      const meta = getSkillMeta(frontmatter)
      const homepage = frontmatter.homepage || meta?.homepage || null
      const envVars = meta?.requires?.env || []
      const tags = meta?.tags || []
      const triggers = extractTriggers(description, name)
      const scriptsPath = existsSync(join(SKILLS_DIR, dir, 'scripts'))
        ? join(SKILLS_DIR, dir, 'scripts')
        : null

      const existing = db.prepare('SELECT id FROM installed_skills WHERE slug = ?').get(slug) as { id: number } | undefined

      if (existing) {
        db.prepare(`
          UPDATE installed_skills SET
            name = ?, description = ?, version = ?, skill_md = ?,
            triggers = ?, allowed_tools = ?, env_vars_needed = ?, tags = ?,
            homepage = ?, scripts_path = ?,
            updated_at = strftime('%s','now')
          WHERE slug = ?
        `).run(
          name, description, version, content,
          JSON.stringify(triggers), JSON.stringify(allowedTools),
          JSON.stringify(envVars), JSON.stringify(tags),
          homepage, scriptsPath, slug
        )
        updated++
      } else {
        db.prepare(`
          INSERT INTO installed_skills (slug, name, description, version, skill_md, triggers, allowed_tools, env_vars_needed, tags, homepage, scripts_path, installed_from)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')
        `).run(
          slug, name, description, version, content,
          JSON.stringify(triggers), JSON.stringify(allowedTools),
          JSON.stringify(envVars), JSON.stringify(tags),
          homepage, scriptsPath
        )
        imported++
      }
    } catch (err) {
      errors.push(`${dir}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { imported, updated, errors }
}

// ─── Install skill from GitHub URL ───

export function installFromGithub(githubUrl: string): { success: boolean; skill?: InstalledSkill; error?: string } {
  // Extract repo name for directory
  const match = githubUrl.match(/github\.com\/[\w-]+\/([\w-]+)/)
  if (!match) return { success: false, error: 'Invalid GitHub URL' }

  const repoName = match[1].replace(/-skill$/, '')
  const targetDir = join(SKILLS_DIR, repoName)

  try {
    if (existsSync(targetDir)) {
      // Update existing
      execSync(`cd "${targetDir}" && git pull`, { timeout: 30000 })
    } else {
      execSync(`git clone "${githubUrl}" "${targetDir}"`, { timeout: 60000 })
    }

    // Now scan just this skill
    const result = scanLocalSkills()
    const skill = getDb().prepare('SELECT * FROM installed_skills WHERE slug = ?').get(repoName) as InstalledSkill | undefined

    if (skill) {
      // Mark as installed from github
      getDb().prepare('UPDATE installed_skills SET installed_from = ? WHERE slug = ?').run(githubUrl, repoName)
      return { success: true, skill }
    }

    return { success: false, error: 'Skill installed but could not parse SKILL.md' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Health Check ───

export interface HealthCheckResult {
  skillId: number
  slug: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  issues: string[]
}

export function checkSkillHealth(skillId: number): HealthCheckResult {
  const db = getDb()
  const skill = db.prepare('SELECT * FROM installed_skills WHERE id = ?').get(skillId) as InstalledSkill | undefined
  if (!skill) return { skillId, slug: 'unknown', status: 'unhealthy', issues: ['Skill not found'] }

  const issues: string[] = []

  // 1. Check SKILL.md exists and is parseable
  if (!skill.skill_md || skill.skill_md.length < 10) {
    issues.push('SKILL.md is empty or missing')
  }

  // 2. Check env vars are configured
  let envVars: string[] = []
  try { envVars = JSON.parse(skill.env_vars_needed as unknown as string) } catch { /* */ }
  for (const envVar of envVars) {
    const vaultEntry = db.prepare('SELECT id FROM env_vault WHERE key = ?').get(envVar)
    if (!vaultEntry && !process.env[envVar]) {
      issues.push(`Missing env var: ${envVar}`)
    }
  }

  // 3. Check scripts exist if referenced
  if (skill.scripts_path && !existsSync(skill.scripts_path)) {
    issues.push(`Scripts directory missing: ${skill.scripts_path}`)
  }

  // 4. Check error rate
  if (skill.error_count >= ERROR_THRESHOLD) {
    issues.push(`High error count: ${skill.error_count} consecutive failures`)
  }

  // 5. Check skill file still exists on disk
  const diskPath = join(SKILLS_DIR, skill.slug, 'SKILL.md')
  if (skill.installed_from === 'local' && !existsSync(diskPath)) {
    issues.push('SKILL.md file missing from disk')
  }

  const status = issues.length === 0 ? 'healthy' : issues.length <= 2 ? 'degraded' : 'unhealthy'

  // Update DB
  db.prepare(`
    UPDATE installed_skills SET health_status = ?, last_health_check = strftime('%s','now')
    WHERE id = ?
  `).run(status, skillId)

  return { skillId, slug: skill.slug, status, issues }
}

export function checkAllSkillsHealth(): HealthCheckResult[] {
  const skills = getDb().prepare('SELECT id FROM installed_skills WHERE enabled = 1').all() as { id: number }[]
  return skills.map(s => checkSkillHealth(s.id))
}

// ─── Skill Execution Tracking (reliability) ───

export function startSkillExecution(skillId: number, agentId: string, triggerMessage: string): number {
  const result = getDb().prepare(`
    INSERT INTO skill_executions (skill_id, agent_id, trigger_message, status)
    VALUES (?, ?, ?, 'running')
  `).run(skillId, agentId, triggerMessage.slice(0, 500))
  return Number(result.lastInsertRowid)
}

export function completeSkillExecution(executionId: number, opts: { durationMs: number; tokensUsed?: number; learnings?: string }) {
  const db = getDb()
  db.prepare(`
    UPDATE skill_executions SET status = 'completed', duration_ms = ?, tokens_used = ?, learnings = ?
    WHERE id = ?
  `).run(opts.durationMs, opts.tokensUsed || 0, opts.learnings || null, executionId)

  // Reset error count on success, bump use count
  const exec = db.prepare('SELECT skill_id FROM skill_executions WHERE id = ?').get(executionId) as { skill_id: number } | undefined
  if (exec) {
    db.prepare(`
      UPDATE installed_skills SET error_count = 0, last_used = strftime('%s','now'), use_count = use_count + 1
      WHERE id = ?
    `).run(exec.skill_id)
  }
}

export function failSkillExecution(executionId: number, error: string, durationMs: number) {
  const db = getDb()
  db.prepare(`
    UPDATE skill_executions SET status = 'failed', error = ?, duration_ms = ?
    WHERE id = ?
  `).run(error.slice(0, 2000), durationMs, executionId)

  // Increment error count, log learning
  const exec = db.prepare('SELECT skill_id, agent_id FROM skill_executions WHERE id = ?').get(executionId) as { skill_id: number; agent_id: string } | undefined
  if (exec) {
    db.prepare(`
      UPDATE installed_skills SET error_count = error_count + 1, last_error = ?
      WHERE id = ?
    `).run(error.slice(0, 500), exec.skill_id)

    // Auto-disable if too many failures (circuit breaker)
    const skill = db.prepare('SELECT error_count, slug FROM installed_skills WHERE id = ?').get(exec.skill_id) as { error_count: number; slug: string } | undefined
    if (skill && skill.error_count >= ERROR_THRESHOLD) {
      db.prepare('UPDATE installed_skills SET enabled = 0, health_status = ? WHERE id = ?').run('unhealthy', exec.skill_id)
      logLearning(exec.agent_id, exec.skill_id, 'error', `Skill "${skill.slug}" auto-disabled after ${ERROR_THRESHOLD} consecutive failures. Last error: ${error.slice(0, 200)}`)
    }

    logLearning(exec.agent_id, exec.skill_id, 'error', `Skill execution failed: ${error.slice(0, 500)}`)
  }
}

// ─── Agent Learnings (WAL + Self-Improvement) ───

export function logLearning(agentId: string, skillId: number | null, type: 'error' | 'learning' | 'correction' | 'feature_request', content: string) {
  getDb().prepare(`
    INSERT INTO agent_learnings (agent_id, skill_id, type, content)
    VALUES (?, ?, ?, ?)
  `).run(agentId, skillId, type, content.slice(0, 5000))
}

export function getRecentLearnings(agentId: string, limit: number = 20): Array<{ id: number; type: string; content: string; created_at: number; skill_slug?: string }> {
  return getDb().prepare(`
    SELECT l.*, s.slug as skill_slug
    FROM agent_learnings l
    LEFT JOIN installed_skills s ON l.skill_id = s.id
    WHERE l.agent_id = ?
    ORDER BY l.created_at DESC LIMIT ?
  `).all(agentId, limit) as any[]
}

// ─── Skill Matching (which skills apply to a message) ───

export function matchSkills(agentId: string, message: string): InstalledSkill[] {
  const db = getDb()
  const lower = message.toLowerCase()

  // Get skills assigned to this agent
  const skills = db.prepare(`
    SELECT s.*
    FROM installed_skills s
    INNER JOIN skill_agent_map m ON s.id = m.skill_id
    WHERE m.agent_id = ? AND m.enabled = 1 AND s.enabled = 1
      AND s.health_status != 'unhealthy'
    ORDER BY s.use_count DESC
  `).all(agentId) as InstalledSkill[]

  if (skills.length === 0) {
    // Fallback: get all enabled healthy skills (no assignment required)
    const allSkills = db.prepare(`
      SELECT * FROM installed_skills
      WHERE enabled = 1 AND health_status != 'unhealthy'
      ORDER BY use_count DESC
    `).all() as InstalledSkill[]
    return matchByTriggers(allSkills, lower)
  }

  return matchByTriggers(skills, lower)
}

function matchByTriggers(skills: InstalledSkill[], lowerMessage: string): InstalledSkill[] {
  const matched: InstalledSkill[] = []

  for (const skill of skills) {
    let triggers: string[] = []
    try { triggers = JSON.parse(skill.triggers as unknown as string) } catch { continue }

    for (const trigger of triggers) {
      if (lowerMessage.includes(trigger.toLowerCase())) {
        matched.push(skill)
        break
      }
    }
  }

  return matched
}

// ─── Build skill context for agent system prompt ───

export function buildSkillContext(matchedSkills: InstalledSkill[]): string {
  if (matchedSkills.length === 0) return ''

  let context = '\n\n# Active Skills\n'
  for (const skill of matchedSkills.slice(0, 3)) { // max 3 skills to keep context lean
    // Use just the body (not frontmatter) to save tokens
    const bodyMatch = skill.skill_md.match(/^---[\s\S]*?---\n([\s\S]*)$/)
    const body = bodyMatch ? bodyMatch[1].trim() : skill.skill_md

    // Truncate very long skills
    const truncated = body.length > 4000 ? body.slice(0, 4000) + '\n\n[Skill content truncated for context management]' : body
    context += `\n## Skill: ${skill.name} (v${skill.version})\n${truncated}\n`
  }

  return context
}

// ─── Env Vault ───

export function getEnvVar(key: string): string | null {
  // Check vault first, then process.env
  const row = getDb().prepare('SELECT value_encrypted FROM env_vault WHERE key = ?').get(key) as { value_encrypted: string } | undefined
  if (row) return row.value_encrypted // TODO: decrypt when encryption is added
  return process.env[key] || null
}

export function setEnvVar(key: string, value: string, description?: string) {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM env_vault WHERE key = ?').get(key)
  if (existing) {
    db.prepare("UPDATE env_vault SET value_encrypted = ?, description = COALESCE(?, description), updated_at = strftime('%s','now') WHERE key = ?")
      .run(value, description || null, key)
  } else {
    db.prepare('INSERT INTO env_vault (key, value_encrypted, description) VALUES (?, ?, ?)')
      .run(key, value, description || '')
  }
}

export function deleteEnvVar(key: string) {
  getDb().prepare('DELETE FROM env_vault WHERE key = ?').run(key)
}

export function listEnvVars(): Array<{ id: number; key: string; description: string; has_value: boolean; used_by_skills: string; created_at: number }> {
  const rows = getDb().prepare('SELECT id, key, description, value_encrypted, used_by_skills, created_at FROM env_vault ORDER BY key ASC').all() as any[]
  return rows.map(r => ({ ...r, has_value: !!r.value_encrypted, value_encrypted: undefined }))
}

// ─── Skill CRUD ───

export function getInstalledSkills(): InstalledSkill[] {
  return getDb().prepare('SELECT * FROM installed_skills ORDER BY use_count DESC, name ASC').all() as InstalledSkill[]
}

export function getInstalledSkill(id: number): InstalledSkill | null {
  return getDb().prepare('SELECT * FROM installed_skills WHERE id = ?').get(id) as InstalledSkill | null
}

export function getSkillAgents(skillId: number): Array<{ agent_id: string; enabled: number; agent_name?: string }> {
  return getDb().prepare(`
    SELECT m.agent_id, m.enabled, a.name as agent_name
    FROM skill_agent_map m
    LEFT JOIN agents a ON m.agent_id = a.id
    WHERE m.skill_id = ?
  `).all(skillId) as any[]
}

export function assignSkillToAgent(skillId: number, agentId: string, enabled: boolean = true) {
  getDb().prepare(`
    INSERT INTO skill_agent_map (skill_id, agent_id, enabled) VALUES (?, ?, ?)
    ON CONFLICT(skill_id, agent_id) DO UPDATE SET enabled = ?
  `).run(skillId, agentId, enabled ? 1 : 0, enabled ? 1 : 0)
}

export function toggleSkill(skillId: number, enabled: boolean) {
  getDb().prepare("UPDATE installed_skills SET enabled = ?, updated_at = strftime('%s','now') WHERE id = ?")
    .run(enabled ? 1 : 0, skillId)
}

export function deleteSkill(skillId: number) {
  getDb().prepare('DELETE FROM installed_skills WHERE id = ?').run(skillId)
}

// ─── Auto-assign skills to agents based on tags ───

export function autoAssignSkills() {
  const db = getDb()
  const skills = getInstalledSkills()
  const agents = db.prepare('SELECT id, role FROM agents').all() as Array<{ id: string; role: string }>

  const roleTagMap: Record<string, string[]> = {
    'executive-assistant': ['tasks', 'calendar', 'email', 'research', 'trends', 'prompts'],
    'meta-ads': ['ads', 'meta', 'facebook', 'instagram', 'creative', 'audit', 'budget', 'competitor'],
    'copywriter': ['copy', 'writing', 'content', 'creative', 'script'],
    'social-media': ['social', 'content', 'tiktok', 'instagram', 'youtube'],
  }

  for (const skill of skills) {
    let tags: string[] = []
    try { tags = JSON.parse(skill.tags as unknown as string) } catch { /* */ }
    const slug = skill.slug.toLowerCase()

    for (const agent of agents) {
      const relevantTags = roleTagMap[agent.role] || []
      const isRelevant = relevantTags.some(t =>
        tags.some(st => st.includes(t) || t.includes(st)) || slug.includes(t)
      )

      if (isRelevant) {
        assignSkillToAgent(skill.id, agent.id)
      }
    }

    // Always assign to jimmy (executive assistant gets everything)
    assignSkillToAgent(skill.id, 'jimmy')
  }
}
