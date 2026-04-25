import {
  createCrmAiGeneration,
  getCrmAiBrandVoice,
  getCrmAiPromptById,
  type CrmAiPromptCategory,
} from '@/lib/db'
import {
  buildCampaignPlanPlan,
  buildDefaultCategoryPrompt,
  buildPromptFromSavedPrompt,
  buildRewritePlan,
  buildSubjectLinePlan,
  parseSubjectLines,
  runCrmAiCompletion,
  sanitizeCampaignPlan,
  type CrmAiCampaignPlan,
} from '@/lib/crm-ai'

export interface LoggedCrmAiResult {
  generationId: number
  promptId: number | null
  category: string
  text: string
  model: string
  tokensIn: number
  tokensOut: number
}

export function parseEmailDraftText(text: string): { subject: string; body: string } {
  const lines = text.trim().split(/\r?\n/)
  const first = lines[0] || ''
  if (/^subject\s*:/i.test(first)) {
    return {
      subject: first.replace(/^subject\s*:/i, '').trim(),
      body: lines.slice(1).join('\n').trim(),
    }
  }
  return { subject: '', body: text.trim() }
}

export async function generateCrmAiText(input: {
  workspaceId: number
  userId: number | null
  category: CrmAiPromptCategory
  promptId?: number | null
  context: Record<string, unknown>
}): Promise<LoggedCrmAiResult> {
  const brandVoice = getCrmAiBrandVoice(input.workspaceId)
  const prompt = input.promptId ? getCrmAiPromptById(input.promptId, input.workspaceId) : null
  const plan = prompt
    ? buildPromptFromSavedPrompt(prompt, input.context, brandVoice)
    : buildDefaultCategoryPrompt(input.category, input.context, brandVoice)
  const result = await runCrmAiCompletion(plan)
  const generation = createCrmAiGeneration(input.workspaceId, input.userId, {
    prompt_id: prompt?.id ?? null,
    category: prompt?.category ?? input.category,
    input_context: input.context,
    output_text: result.text,
    model: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
  })
  return {
    generationId: generation.id,
    promptId: prompt?.id ?? null,
    category: prompt?.category ?? input.category,
    text: result.text,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  }
}

export async function rewriteCrmAiText(input: {
  workspaceId: number
  userId: number | null
  text: string
  tone?: string
  length?: 'shorter' | 'same' | 'longer'
  instructions?: string
}): Promise<LoggedCrmAiResult> {
  const brandVoice = getCrmAiBrandVoice(input.workspaceId)
  const result = await runCrmAiCompletion(buildRewritePlan({
    text: input.text,
    tone: input.tone,
    length: input.length,
    instructions: input.instructions,
    brandVoice,
  }))
  const generation = createCrmAiGeneration(input.workspaceId, input.userId, {
    category: 'rewrite',
    input_context: {
      text: input.text,
      tone: input.tone,
      length: input.length,
      instructions: input.instructions,
    },
    output_text: result.text,
    model: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
  })
  return {
    generationId: generation.id,
    promptId: null,
    category: 'rewrite',
    text: result.text,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  }
}

export async function generateCrmAiSubjectLines(input: {
  workspaceId: number
  userId: number | null
  body: string
  tone?: string
}): Promise<LoggedCrmAiResult & { lines: string[] }> {
  const brandVoice = getCrmAiBrandVoice(input.workspaceId)
  const result = await runCrmAiCompletion(buildSubjectLinePlan({
    body: input.body,
    tone: input.tone,
    brandVoice,
  }))
  const lines = parseSubjectLines(result.text)
  const generation = createCrmAiGeneration(input.workspaceId, input.userId, {
    category: 'subject_lines',
    input_context: { body: input.body, tone: input.tone },
    output_text: lines.join('\n'),
    model: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
  })
  return {
    generationId: generation.id,
    promptId: null,
    category: 'subject_lines',
    text: lines.join('\n'),
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    lines,
  }
}

export async function generateCrmAiCampaignPlan(input: {
  workspaceId: number
  userId: number | null
  goalDescription: string
  audienceDescription: string
  tone?: string
  deadline?: string
}): Promise<LoggedCrmAiResult & { plan: CrmAiCampaignPlan }> {
  const brandVoice = getCrmAiBrandVoice(input.workspaceId)
  const result = await runCrmAiCompletion(buildCampaignPlanPlan({
    goalDescription: input.goalDescription,
    audienceDescription: input.audienceDescription,
    tone: input.tone,
    deadline: input.deadline,
    brandVoice,
  }))
  const plan = sanitizeCampaignPlan(result.text)
  const generation = createCrmAiGeneration(input.workspaceId, input.userId, {
    category: 'campaign_plan',
    input_context: {
      goal_description: input.goalDescription,
      audience_description: input.audienceDescription,
      tone: input.tone,
      deadline: input.deadline,
    },
    output_text: JSON.stringify(plan),
    model: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
  })
  return {
    generationId: generation.id,
    promptId: null,
    category: 'campaign_plan',
    text: JSON.stringify(plan, null, 2),
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    plan,
  }
}
