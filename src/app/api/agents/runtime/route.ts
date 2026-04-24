import { NextRequest, NextResponse } from 'next/server'
import { getAgent, getDb, getAgentReferences } from '@/lib/db'
import { loadAgentConfig, buildCachedSystemPrompt, classifyComplexity, resolveModel } from '@/lib/agent-runtime'
import { matchSkills, buildSkillContext } from '@/lib/skills'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const agentId = req.nextUrl.searchParams.get('id')
  if (!agentId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Optional: test skill trigger matching
  const testMessage = req.nextUrl.searchParams.get('test')

  const agent = getAgent(agentId)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const config = loadAgentConfig(agentId)

  // Build Tier 1 context (cached)
  const systemBlocks = buildCachedSystemPrompt(agent, config, '')
  const tier1Prompt = systemBlocks.map(b => b.text).join('\n\n---\n\n')
  const cachedBlocks = systemBlocks.filter(b => b.cache_control).length

  // Tier 1 token breakdown
  const soulTokens = Math.ceil((config.soul || '').length / 4)
  const memoryTokens = Math.ceil((config.memory || '').length / 4)
  const tier1Total = Math.ceil(tier1Prompt.length / 4)

  // Tier 2: Test skill trigger matching if test message provided
  let skillTriggerResult: any = null
  if (testMessage) {
    try {
      const matched = matchSkills(agentId, testMessage)
      const complexity = classifyComplexity(testMessage)
      const model = resolveModel(complexity, agent.model_preference)
      skillTriggerResult = {
        message: testMessage,
        matchedSkills: matched.map(s => ({ name: s.name, slug: s.slug, description: s.description.slice(0, 200) })),
        skillContext: matched.length > 0 ? buildSkillContext(matched).slice(0, 500) + '...' : null,
        tier2Loaded: matched.length > 0,
        complexity,
        model,
      }
    } catch { skillTriggerResult = { message: testMessage, matchedSkills: [], error: 'Skill matching not initialized' } }
  }

  // Tier 3: Reference docs available
  const references = getAgentReferences(agentId)

  // Model routing examples
  const routingExamples = [
    { message: "What's on my plate?", complexity: classifyComplexity("What's on my plate?"), model: resolveModel(classifyComplexity("What's on my plate?"), agent.model_preference) },
    { message: "Hey, how's it going?", complexity: classifyComplexity("Hey, how's it going?"), model: resolveModel(classifyComplexity("Hey, how's it going?"), agent.model_preference) },
    { message: "Analyze my ad performance", complexity: classifyComplexity("Analyze my ad performance"), model: resolveModel(classifyComplexity("Analyze my ad performance"), agent.model_preference) },
    { message: "Write a report on campaign ROI", complexity: classifyComplexity("Write a report on campaign ROI"), model: resolveModel(classifyComplexity("Write a report on campaign ROI"), agent.model_preference) },
    { message: "Full audit of all campaigns", complexity: classifyComplexity("Full audit of all campaigns"), model: resolveModel(classifyComplexity("Full audit of all campaigns"), agent.model_preference) },
  ]

  // All available tools (including new Tier 3 tools)
  const tools = [
    'list_tasks', 'create_task', 'update_task', 'complete_task', 'search_tasks',
    'get_calendar_events', 'get_free_slots', 'get_today_agenda',
    'list_workspaces', 'list_projects', 'get_project_detail',
    'list_agents', 'dispatch_task_to_agent', 'create_task_for_agent', 'post_comment', 'log_agent_activity',
    'create_doc', 'read_doc', 'update_doc', 'request_approval',
    'search_references', 'list_references', 'save_learning',
  ]

  // Filter by agent's allowed_tools
  let allowedTools: string[] = ['*']
  try { allowedTools = JSON.parse(agent.allowed_tools || '["*"]') } catch { /* */ }
  const filteredTools = allowedTools.includes('*') ? tools : tools.filter(t => allowedTools.includes(t))

  // Assigned skills
  const db = getDb()
  const assignedSkills = db.prepare(`
    SELECT s.slug, s.name, s.description, s.health_status, s.use_count, s.last_used
    FROM installed_skills s
    INNER JOIN skill_agent_map m ON s.id = m.skill_id
    WHERE m.agent_id = ? AND m.enabled = 1 AND s.enabled = 1
    ORDER BY s.use_count DESC
  `).all(agentId) as { slug: string; name: string; description: string; health_status: string; use_count: number; last_used: number | null }[]

  // Cost stats from agent_runs
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(cost_cents) as total_cost_cents,
      AVG(cost_cents) as avg_cost_cents,
      SUM(CASE WHEN model LIKE '%haiku%' THEN 1 ELSE 0 END) as haiku_runs,
      SUM(CASE WHEN model LIKE '%sonnet%' THEN 1 ELSE 0 END) as sonnet_runs,
      SUM(CASE WHEN model LIKE '%opus%' THEN 1 ELSE 0 END) as opus_runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_runs,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs
    FROM agent_runs WHERE agent_id = ?
  `).get(agentId) as Record<string, number>

  // Daily cost breakdown (last 7 days)
  const dailyCosts = db.prepare(`
    SELECT
      DATE(started_at, 'unixepoch') as day,
      SUM(cost_cents) as cost_cents,
      COUNT(*) as runs
    FROM agent_runs
    WHERE agent_id = ? AND started_at > strftime('%s', 'now', '-7 days')
    GROUP BY day ORDER BY day ASC
  `).all(agentId) as { day: string; cost_cents: number; runs: number }[]

  // Learnings summary
  const learnings = db.prepare(`
    SELECT type, COUNT(*) as count FROM agent_learnings
    WHERE agent_id = ? GROUP BY type
  `).all(agentId) as { type: string; count: number }[]

  const apiKeyRow = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC LIMIT 1').get() as { daily_budget_cents?: number } | undefined

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      model_preference: agent.model_preference || 'auto',
      max_turns: agent.max_turns || 50,
    },
    tiers: {
      tier1: {
        description: 'Always loaded, cached (soul + skill catalog + tools + client context)',
        compiledPrompt: tier1Prompt,
        tokenEstimate: tier1Total,
        breakdown: {
          soul: soulTokens,
          memory: memoryTokens,
          skillCatalog: tier1Total - soulTokens - memoryTokens,
        },
        cachedBlocks,
        uncachedBlocks: systemBlocks.length - cachedBlocks,
      },
      tier2: {
        description: 'Loaded on skill trigger (full SKILL.md instructions)',
        assignedSkills: assignedSkills.map(s => ({
          ...s,
          descriptionPreview: s.description.slice(0, 150),
        })),
        totalSkills: assignedSkills.length,
        triggerTest: skillTriggerResult,
      },
      tier3: {
        description: 'On-demand reference docs (loaded via search_references tool)',
        references: references.map(r => ({ id: r.id, name: r.name, category: r.category, size: r.content.length })),
        totalRefs: references.length,
      },
    },
    tools: filteredTools,
    modelRouting: {
      agentPreference: agent.model_preference || 'auto',
      default: 'haiku',
      models: {
        haiku: 'claude-haiku-4-5-20251001',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-6',
      },
      examples: routingExamples,
    },
    stats: {
      totalRuns: stats?.total_runs || 0,
      totalInputTokens: stats?.total_input_tokens || 0,
      totalOutputTokens: stats?.total_output_tokens || 0,
      totalCostCents: stats?.total_cost_cents || 0,
      avgCostCents: Math.round(stats?.avg_cost_cents || 0),
      haikuRuns: stats?.haiku_runs || 0,
      sonnetRuns: stats?.sonnet_runs || 0,
      opusRuns: stats?.opus_runs || 0,
      completedRuns: stats?.completed_runs || 0,
      failedRuns: stats?.failed_runs || 0,
      dailyCosts,
    },
    learnings,
    security: {
      promptInjectionDefense: true,
      blockedPatterns: 7,
      inputSanitization: true,
    },
    budget: {
      dailyLimitCents: apiKeyRow?.daily_budget_cents || 500,
    },
  })
}
