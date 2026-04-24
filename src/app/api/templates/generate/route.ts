import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createTemplate } from '@/lib/db'
import { getApiKey } from '@/lib/agent-runtime'
import { detectProvider } from '@/lib/llm-provider'

const SYSTEM_PROMPT = `You are an expert project management AI that creates structured project workflow templates. You understand how project management tools work: stages represent phases of work, tasks are ordered within stages, and dependencies (blocked_by) ensure tasks execute in the right sequence.

## YOUR OUTPUT FORMAT

Return ONLY valid JSON matching this exact schema (no markdown, no code fences, no explanation):

{
  "name": "Template Name",
  "description": "1-2 sentence description of when to use this template",
  "stages": [
    {
      "name": "Stage Name",
      "color": "#hex",
      "sort_order": 0,
      "expected_duration_value": 1,
      "expected_duration_unit": "weeks",
      "auto_schedule_all": true
    }
  ],
  "tasks": [
    {
      "id": "task_1",
      "title": "Task title",
      "description": "Brief description of what this task involves",
      "stage_index": 0,
      "offset_days": 0,
      "offset_unit": "days",
      "deadline_offset_days": 2,
      "deadline_offset_unit": "days",
      "duration_minutes": 60,
      "priority": "medium",
      "role": "Role Name",
      "task_type": "task",
      "auto_schedule": true,
      "blocked_by_ids": [],
      "labels": [],
      "checklist": [],
      "hard_deadline": false,
      "min_chunk_minutes": 30
    }
  ],
  "roles": [
    { "name": "Role Name", "description": "What this role does", "color": "#hex" }
  ],
  "text_variables": [
    { "key": "client_name", "label": "Client Name", "default_value": "" }
  ]
}

## RULES FOR STAGES

- Create as many stages as the project scope requires (typically 3-10)
- Simple projects: 3-4 stages. Complex multi-phase projects: 6-10 stages
- Use these colors (pick different ones per stage): #3c8cdc (Blue), #8c3cdc (Violet), #dd3c64 (Rose), #dc3c3c (Red), #dd643c (Orange), #3cddb4 (Cyan), #3bdd8c (Emerald), #64dc3c (Green), #ddb53c (Yellow)
- sort_order starts at 0 and increments
- expected_duration_value: realistic duration for the stage (1-4 weeks typically)
- expected_duration_unit: "weeks" for most stages, "days" for short ones
- auto_schedule_all: true (the scheduler handles placement)

## RULES FOR TASKS

- Create as many tasks as the project needs (typically 8-30, more for complex projects)
- Include BOTH tasks and events. Events are meetings, calls, check-ins, presentations, reviews
- IDs must be sequential strings: "task_1", "task_2", "task_3", etc.
- stage_index: 0-based, matching the stage sort_order
- CRITICAL: Tasks within a stage must be ordered sequentially with blocked_by_ids:
  * First task in a stage: blocked_by_ids = []
  * Second task: blocked_by_ids = ["task_X"] (the first task's ID)
  * Third task: blocked_by_ids = ["task_X", "task_Y"] (all prior tasks in that stage)
  * This ensures tasks execute in order when scheduled
- offset_days: days from project start when this task can begin
  * First stage tasks: 0
  * Second stage tasks: offset by first stage duration
  * Cascade forward through stages
- deadline_offset_days: when the task is due (always >= offset_days)
- offset_unit / deadline_offset_unit: "days" for calendar days, "weekdays" for business days
- duration_minutes: realistic estimate (15, 30, 45, 60, 90, 120, 180, 240, 480)
- priority: "urgent" for critical path items, "high" for important, "medium" for standard, "low" for nice-to-have
- role: must match a role name from the roles array exactly
- auto_schedule: true (let the scheduler place it)
- checklist: optional array of sub-items like ["Sub-task 1", "Sub-task 2"]
- labels: optional tags like ["creative", "review"]
- hard_deadline: true only for tasks with immovable due dates
- min_chunk_minutes: minimum work session (15 or 30 for most tasks)
- task_type: "task" for regular work items, "event" for meetings/calls/check-ins/reviews/presentations
- Events examples: "Client Kickoff Call", "Weekly Check-in", "Design Review Meeting", "Final Presentation", "Stakeholder Sign-off"
- Events should have shorter durations (30-60 min) and be placed at key milestones between work tasks

## RULES FOR ROLES

- Create 2-5 roles that represent the team members needed
- Use these colors for roles: #3c8cdc, #8c3cdc, #3bdd8c, #dd643c, #ddb53c
- Roles are placeholders mapped to real people when creating a project
- Common roles: Project Manager, Designer, Developer, Content Writer, Account Manager, Strategist, QA, Client Liaison

## RULES FOR TEXT VARIABLES

- Do NOT include "project_name" - it is built-in and always available as {{project_name}}
- Include "client_name" which auto-populates from the project's parent folder
- Add domain-specific variables if needed (e.g., "brand_name", "website_url", "launch_date")
- Variables can be referenced in task titles with {{variable_key}} syntax
- CRITICAL: EVERY task title MUST end with " | {{project_name}}". Examples: "Kickoff Call | {{project_name}}", "Creative Review | {{project_name}}", "Budget Setup | {{project_name}}"
- No exceptions - every single task must have the pipe + project_name at the end
- Never use "for {{variable}}" format - always use "Title | {{variable}}"

## QUALITY STANDARDS

- Make every task actionable and specific (not vague like "Do research")
- Include task descriptions that explain what deliverables are expected
- Create realistic time estimates based on industry standards
- Ensure the dependency chain creates a logical workflow from start to finish
- Offset days should cascade: if stage 1 takes 5 days, stage 2 tasks start at offset_days: 5
- The template should be immediately usable for real projects`

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const body = await request.json()
  const { description, workspaceId, documents, preview } = body

  if (!description?.trim()) {
    return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  }

  // Get API key from user's configured key (OpenRouter or Anthropic)
  const keyConfig = getApiKey(1)
  if (!keyConfig) {
    return NextResponse.json({ error: 'No API key configured. Add your OpenRouter key in Settings.' }, { status: 400 })
  }

  const provider = detectProvider(keyConfig.apiKey)

  // Build user message with description + documents
  let userMessage = `Project description: ${description.trim()}`

  if (documents && Array.isArray(documents)) {
    for (const doc of documents.slice(0, 10)) {
      if (!doc.data || !doc.mimeType) continue
      // Text-based documents: decode and include
      if (doc.mimeType.startsWith('text/') || doc.mimeType === 'application/json' || doc.mimeType === 'text/csv' || doc.mimeType.includes('csv') || doc.mimeType.includes('spreadsheet')) {
        try {
          const decoded = Buffer.from(doc.data, 'base64').toString('utf-8')
          userMessage += `\n\n--- Document: ${doc.name} ---\n${decoded.slice(0, 15000)}`
        } catch { /* skip */ }
      }
      // For PDFs/images, include a note (OpenRouter text models can't process inline images)
      else if (doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf') {
        userMessage += `\n\n[Uploaded file: ${doc.name} (${doc.mimeType}) - analyze based on filename and context]`
      }
    }
  }

  try {
    let generated

    if (provider === 'anthropic') {
      // Anthropic direct
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': keyConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', // fallback if using Anthropic key directly
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        console.error('Anthropic API error:', err)
        return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
      }
      const data = await res.json()
      const text = data?.content?.[0]?.text
      if (!text) return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      generated = JSON.parse(cleaned)
    } else {
      // OpenRouter
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
          max_tokens: 8192,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        console.error('OpenRouter API error:', err)
        return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
      }
      const data = await res.json()
      const text = data?.choices?.[0]?.message?.content
      if (!text) return NextResponse.json({ error: 'No response from AI' }, { status: 500 })
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      generated = JSON.parse(cleaned)
    }

    // Post-process: ensure blocked_by_ids are set sequentially within stages
    if (generated.tasks && Array.isArray(generated.tasks)) {
      const stageGroups: Record<number, typeof generated.tasks> = {}
      for (const t of generated.tasks) {
        const si = t.stage_index ?? 0
        if (!stageGroups[si]) stageGroups[si] = []
        stageGroups[si].push(t)
      }
      for (const tasks of Object.values(stageGroups)) {
        for (let i = 0; i < tasks.length; i++) {
          const expected = tasks.slice(0, i).map((t: { id: string }) => t.id).filter(Boolean)
          if (!tasks[i].blocked_by_ids || tasks[i].blocked_by_ids.length === 0) {
            tasks[i].blocked_by_ids = expected
          }
        }
      }
    }

    // Filter out project_name from text_variables (it's built-in)
    if (generated.text_variables && Array.isArray(generated.text_variables)) {
      generated.text_variables = generated.text_variables.filter((v: { key: string }) => v.key !== 'project_name')
    }

    // Preview mode: return unsaved template object for editor review
    if (preview) {
      return NextResponse.json({
        id: 0,
        name: generated.name || 'AI Generated Template',
        description: generated.description || description.trim(),
        stages: JSON.stringify(generated.stages || []),
        default_tasks: JSON.stringify(generated.tasks || []),
        workspace_id: workspaceId || null,
        is_builtin: 0,
        roles: JSON.stringify(generated.roles || []),
        text_variables: JSON.stringify(generated.text_variables || []),
      })
    }

    // Save as template
    const template = createTemplate({
      name: generated.name || 'AI Generated Template',
      description: generated.description || description.trim(),
      stages: JSON.stringify(generated.stages || []),
      default_tasks: JSON.stringify(generated.tasks || []),
      workspace_id: workspaceId || null,
      roles: JSON.stringify(generated.roles || []),
      text_variables: JSON.stringify(generated.text_variables || []),
    })

    return NextResponse.json(template)
  } catch (err) {
    console.error('AI template generation error:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
