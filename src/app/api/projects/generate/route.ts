import { NextRequest, NextResponse } from 'next/server'
import { createProjectWithStagesAndTasks } from '@/lib/db'
import { getApiKey, getModelId } from '@/lib/agent-runtime'
import { buildFetchConfig, normalizeResponse } from '@/lib/llm-provider'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const body = await request.json()
  const { prompt, workspaceId, folderId, plan: existingPlan } = body
  if (!workspaceId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // If a pre-built plan is provided, skip AI and create directly
  if (existingPlan) {
    try {
      const project = createProjectWithStagesAndTasks({
        workspaceId,
        name: existingPlan.name,
        description: existingPlan.description,
        color: existingPlan.color,
        folderId,
        stages: existingPlan.stages,
        tasks: existingPlan.tasks,
      })
      return NextResponse.json({ project, plan: existingPlan })
    } catch (err) {
      console.error('Create from plan error:', err)
      return NextResponse.json({ error: 'Failed to create project from plan' }, { status: 500 })
    }
  }

  if (!prompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 })

  const systemPrompt = `You are a project planning assistant for a marketing agency that manages Meta ads for local businesses like barbershops, real estate agents, and tattoo shops.

Generate a project plan as JSON with this exact structure:
{
  "name": "Project Name",
  "description": "Brief project description",
  "color": "#hex_color",
  "stages": [
    { "name": "Stage Name", "color": "#hex_color" }
  ],
  "tasks": [
    { "title": "Task title", "description": "Brief description", "priority": "urgent|high|medium|low", "stage_index": 0, "duration_minutes": 30 }
  ]
}

Rules:
- Use these colors for stages: #4285f4 (blue), #7b68ee (lavender), #9b59b6 (violet), #f06292 (rose), #ef5350 (red), #ff7043 (orange), #26c6da (cyan), #2ecc71 (emerald), #7a6b55 (green), #a3d977 (mint), #f6bf26 (yellow), #78909c (gray)
- Pick a project color from the same palette
- stage_index references the index in the stages array (0-based)
- Create 3-6 stages and 5-15 tasks
- Be specific and actionable with task titles
- Duration should be realistic (15-120 minutes)
- Respond with ONLY the JSON, no markdown or explanation`

  try {
    // Get API key from BYOK config or env
    const keyConfig = getApiKey()
    const apiKey = keyConfig?.apiKey || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key configured. Add one in Settings > AI.' }, { status: 500 })
    }
    const provider = keyConfig?.provider || 'anthropic'

    // Use Sonnet-tier model for project generation (respects provider's model config)
    const model = getModelId('sonnet')

    const fetchConfig = buildFetchConfig(
      provider,
      apiKey,
      model,
      [{ type: 'text', text: systemPrompt }],
      [{ role: 'user', content: prompt }],
      [],
      2048,
      false,
    )

    const res = await fetch(fetchConfig.url, {
      method: 'POST',
      headers: fetchConfig.headers,
      body: fetchConfig.body,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`API error ${res.status}: ${err}`)
    }

    const rawData = await res.json()
    const data = normalizeResponse(provider, rawData)

    const text = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('')

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })

    const plan = JSON.parse(jsonMatch[0])

    if (body.preview) {
      return NextResponse.json(plan)
    }

    const project = createProjectWithStagesAndTasks({
      workspaceId,
      name: plan.name,
      description: plan.description,
      color: plan.color,
      folderId,
      stages: plan.stages,
      tasks: plan.tasks,
    })

    return NextResponse.json({ project, plan })
  } catch (err) {
    console.error('AI generation error:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
