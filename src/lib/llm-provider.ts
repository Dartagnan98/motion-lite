/**
 * LLM Provider Abstraction
 * Supports Anthropic (direct) and OpenRouter (all models) with a unified interface.
 * Keeps internal format close to Anthropic; converts to OpenAI format for OpenRouter.
 */

// ─── Types ───

export type ProviderType = 'anthropic' | 'openrouter'

export interface NormalizedResponse {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  stop_reason: string
}

// ─── Provider Detection ───

export function detectProvider(apiKey: string): ProviderType {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic'
  return 'openrouter'
}

// ─── Request Building ───

export function buildFetchConfig(
  provider: ProviderType,
  apiKey: string,
  model: string,
  system: Array<{ type: string; text: string; cache_control?: { type: string } }>,
  messages: Array<{ role: string; content: unknown }>,
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  maxTokens: number,
  stream: boolean,
): { url: string; headers: Record<string, string>; body: string } {
  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, stream, system, tools, messages }),
    }
  }

  // OpenRouter: convert to OpenAI format
  const openAIMessages = convertMessagesToOpenAI(system, messages)
  const openAITools = tools.length > 0 ? tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  })) : undefined

  const bodyObj: Record<string, unknown> = {
    model: mapModelForOpenRouter(model),
    messages: openAIMessages,
    max_tokens: maxTokens,
    stream,
  }
  if (openAITools) bodyObj.tools = openAITools
  if (stream) bodyObj.stream_options = { include_usage: true }

  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://app.example.com',
      'X-Title': 'Motion Lite',
    },
    body: JSON.stringify(bodyObj),
  }
}

// ─── Message Conversion (Anthropic → OpenAI) ───

function convertMessagesToOpenAI(
  system: Array<{ type: string; text: string }>,
  messages: Array<{ role: string; content: unknown }>,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []

  // System prompt → system message
  if (system.length > 0) {
    result.push({ role: 'system', content: system.map(b => b.text).join('\n\n') })
  }

  for (const msg of messages) {
    // Simple string content
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) {
      result.push({ role: msg.role, content: String(msg.content) })
      continue
    }

    const blocks = msg.content as Array<Record<string, unknown>>

    if (msg.role === 'assistant') {
      // Extract text and tool_use blocks
      const textParts: string[] = []
      const toolCalls: Array<Record<string, unknown>> = []

      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text as string)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {}),
            },
          })
        }
      }

      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: textParts.join('') || null,
      }
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
      result.push(assistantMsg)

    } else if (msg.role === 'user') {
      // Check for tool_result blocks
      const toolResults = blocks.filter(b => b.type === 'tool_result')
      const textBlocks = blocks.filter(b => b.type === 'text')
      const imageBlocks = blocks.filter(b => b.type === 'image')

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          })
        }
      } else if (imageBlocks.length > 0) {
        // Multi-modal content
        const content: Array<Record<string, unknown>> = []
        for (const block of blocks) {
          if (block.type === 'text') {
            content.push({ type: 'text', text: block.text })
          } else if (block.type === 'image') {
            const src = block.source as Record<string, unknown>
            content.push({
              type: 'image_url',
              image_url: { url: `data:${src.media_type};base64,${src.data}` },
            })
          }
        }
        result.push({ role: 'user', content })
      } else {
        result.push({
          role: 'user',
          content: textBlocks.map(b => b.text as string).join('\n') || '',
        })
      }
    }
  }

  return result
}

// ─── Response Normalization ───

/** Normalize a non-streaming response to Anthropic-like format */
export function normalizeResponse(provider: ProviderType, data: Record<string, unknown>): NormalizedResponse {
  if (provider === 'anthropic') {
    return {
      content: data.content as NormalizedResponse['content'],
      usage: data.usage as NormalizedResponse['usage'],
      stop_reason: data.stop_reason as string,
    }
  }

  // OpenAI format
  const choices = data.choices as Array<Record<string, unknown>>
  const message = choices?.[0]?.message as Record<string, unknown> || {}
  const content: NormalizedResponse['content'] = []

  if (message.content) {
    content.push({ type: 'text', text: message.content as string })
  }

  const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined
  if (toolCalls) {
    for (const tc of toolCalls) {
      const fn = tc.function as Record<string, unknown>
      let parsedInput: Record<string, unknown> = {}
      try { parsedInput = JSON.parse(fn.arguments as string || '{}') } catch { /* */ }
      content.push({
        type: 'tool_use',
        id: tc.id as string,
        name: fn.name as string,
        input: parsedInput,
      })
    }
  }

  const usage = data.usage as Record<string, number> | undefined
  const finishReason = (choices?.[0] as Record<string, unknown>)?.finish_reason as string

  return {
    content,
    usage: {
      input_tokens: usage?.prompt_tokens || 0,
      output_tokens: usage?.completion_tokens || 0,
    },
    stop_reason: finishReason === 'tool_calls' ? 'tool_use' : finishReason === 'stop' ? 'end_turn' : (finishReason || 'end_turn'),
  }
}

// ─── Streaming: Anthropic SSE Parser ───

export interface StreamState {
  currentText: string
  currentToolId: string
  currentToolName: string
  currentToolInput: string
  turnInput: number
  turnOutput: number
  stopReason: string
  contentBlocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
}

export function newStreamState(): StreamState {
  return {
    currentText: '',
    currentToolId: '',
    currentToolName: '',
    currentToolInput: '',
    turnInput: 0,
    turnOutput: 0,
    stopReason: '',
    contentBlocks: [],
  }
}

export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_start'; id: string; name: string }
  | { kind: 'tool_input'; id: string; input: Record<string, unknown> }
  | { kind: 'tool_end' }
  | { kind: 'text_end'; text: string }
  | { kind: 'stop'; reason: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number }

/** Parse one SSE data line into stream events. Mutates state. */
export function parseStreamLine(provider: ProviderType, data: string, state: StreamState): StreamEvent[] {
  if (data === '[DONE]') return [{ kind: 'stop', reason: state.stopReason || 'end_turn' }]

  const events: StreamEvent[] = []

  try {
    const event = JSON.parse(data)

    if (provider === 'anthropic') {
      switch (event.type) {
        case 'message_start':
          if (event.message?.usage) {
            state.turnInput = event.message.usage.input_tokens || 0
          }
          break

        case 'content_block_start':
          if (event.content_block?.type === 'text') {
            state.currentText = ''
          } else if (event.content_block?.type === 'tool_use') {
            state.currentToolId = event.content_block.id || ''
            state.currentToolName = event.content_block.name || ''
            state.currentToolInput = ''
            events.push({ kind: 'tool_start', id: state.currentToolId, name: state.currentToolName })
          }
          break

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            state.currentText += event.delta.text || ''
            events.push({ kind: 'text', text: event.delta.text || '' })
          } else if (event.delta?.type === 'input_json_delta') {
            state.currentToolInput += event.delta.partial_json || ''
          }
          break

        case 'content_block_stop':
          if (state.currentToolId) {
            let parsedInput: Record<string, unknown> = {}
            try { parsedInput = JSON.parse(state.currentToolInput || '{}') } catch { /* */ }
            state.contentBlocks.push({ type: 'tool_use', id: state.currentToolId, name: state.currentToolName, input: parsedInput })
            events.push({ kind: 'tool_input', id: state.currentToolId, input: parsedInput })
            state.currentToolId = ''
            state.currentToolName = ''
            state.currentToolInput = ''
          } else if (state.currentText) {
            state.contentBlocks.push({ type: 'text', text: state.currentText })
            events.push({ kind: 'text_end', text: state.currentText })
          }
          break

        case 'message_delta':
          if (event.delta?.stop_reason) state.stopReason = event.delta.stop_reason
          if (event.usage) state.turnOutput = event.usage.output_tokens || 0
          events.push({ kind: 'usage', inputTokens: state.turnInput, outputTokens: state.turnOutput })
          break
      }
    } else {
      // OpenAI / OpenRouter format
      const choice = event.choices?.[0]

      // Usage-only event (final)
      if (!choice && event.usage) {
        state.turnInput = event.usage.prompt_tokens || 0
        state.turnOutput = event.usage.completion_tokens || 0
        events.push({ kind: 'usage', inputTokens: state.turnInput, outputTokens: state.turnOutput })
        return events
      }

      if (!choice) return events

      const delta = choice.delta

      // Text content
      if (delta?.content) {
        state.currentText += delta.content
        events.push({ kind: 'text', text: delta.content })
      }

      // Tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            // New tool call starting
            state.currentToolId = tc.id || `tool_${tc.index}`
            state.currentToolName = tc.function.name
            state.currentToolInput = ''
            events.push({ kind: 'tool_start', id: state.currentToolId, name: state.currentToolName })
          }
          if (tc.function?.arguments) {
            state.currentToolInput += tc.function.arguments
          }
        }
      }

      // Finish reason
      if (choice.finish_reason) {
        // Finalize any pending tool call
        if (state.currentToolId && state.currentToolInput) {
          let parsedInput: Record<string, unknown> = {}
          try { parsedInput = JSON.parse(state.currentToolInput || '{}') } catch { /* */ }
          state.contentBlocks.push({ type: 'tool_use', id: state.currentToolId, name: state.currentToolName, input: parsedInput })
          events.push({ kind: 'tool_input', id: state.currentToolId, input: parsedInput })
          state.currentToolId = ''
          state.currentToolInput = ''
        }
        // Finalize text
        if (state.currentText) {
          state.contentBlocks.push({ type: 'text', text: state.currentText })
        }

        state.stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason
        events.push({ kind: 'stop', reason: state.stopReason })
      }
    }
  } catch { /* skip malformed events */ }

  return events
}

// ─── Model Mapping ───

/** Map canonical model name to OpenRouter's prefixed name */
export function mapModelForOpenRouter(model: string): string {
  if (model.includes('/')) return model // already prefixed
  const map: Record<string, string> = {
    // Anthropic
    'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4-5-20251001',
    'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
    'claude-sonnet-4.6': 'anthropic/claude-sonnet-4.6',
    'claude-opus-4-6': 'anthropic/claude-opus-4-6',
    // OpenAI
    'gpt-4.1-nano': 'openai/gpt-4.1-nano',
    'gpt-4.1-mini': 'openai/gpt-4.1-mini',
    'gpt-4.1': 'openai/gpt-4.1',
    'gpt-4o': 'openai/gpt-4o',
    'gpt-4o-mini': 'openai/gpt-4o-mini',
    'gpt-5-mini': 'openai/gpt-5-mini',
    // Moonshot
    'kimi-k2': 'moonshotai/kimi-k2',
    // Google
    'gemini-2.0-flash': 'google/gemini-2.0-flash-001',
    'gemini-2.5-flash-lite': 'google/gemini-2.5-flash-lite',
    'gemini-2.5-flash': 'google/gemini-2.5-flash',
    'gemini-2.5-pro': 'google/gemini-2.5-pro',
    // DeepSeek
    'deepseek-v3.2': 'deepseek/deepseek-v3.2',
    // Mistral
    'mistral-nemo': 'mistralai/mistral-nemo',
  }
  return map[model] || model
}

// ─── Pricing (cents per 1M tokens) ───

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-6': { input: 300, output: 1500 },
  'claude-sonnet-4.6': { input: 300, output: 1500 },
  'claude-haiku-4-5-20251001': { input: 100, output: 500 },
  'claude-opus-4-6': { input: 500, output: 2500 },
  // OpenAI
  'gpt-4.1-nano': { input: 10, output: 40 },
  'gpt-4.1-mini': { input: 40, output: 160 },
  'gpt-4.1': { input: 200, output: 800 },
  'gpt-4o': { input: 250, output: 1000 },
  'gpt-4o-mini': { input: 15, output: 60 },
  'gpt-5-mini': { input: 25, output: 200 },
  // Moonshot
  'kimi-k2': { input: 55, output: 220 },
  // Google
  'gemini-2.0-flash': { input: 10, output: 40 },
  'gemini-2.5-flash-lite': { input: 10, output: 40 },
  'gemini-2.5-flash': { input: 30, output: 250 },
  'gemini-2.5-pro': { input: 125, output: 1000 },
  // DeepSeek
  'deepseek-v3.2': { input: 25, output: 40 },
  // Mistral
  'mistral-nemo': { input: 2, output: 2 },
}

/** Strip OpenRouter provider prefix to get canonical name for pricing lookup */
export function canonicalModel(model: string): string {
  return model.includes('/') ? model.split('/').slice(1).join('/') : model
}

/** Calculate cost in cents */
export function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const canonical = canonicalModel(model)
  const rate = MODEL_PRICING[canonical] || MODEL_PRICING['claude-haiku-4-5-20251001']
  return Math.ceil((inputTokens * rate.input + outputTokens * rate.output) / 1000000)
}

// ─── API Key Validation ───

export async function validateApiKey(provider: ProviderType, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
      return res.ok ? { ok: true } : { ok: false, error: 'Invalid Anthropic API key' }
    } else {
      // Use OpenRouter's auth/key endpoint — validates without burning credits
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      })
      if (res.ok) {
        const data = await res.json()
        if (data?.data) return { ok: true }
      }
      return { ok: false, error: 'Invalid OpenRouter API key. Make sure you copied the full key from openrouter.ai/keys' }
    }
  } catch {
    return { ok: false, error: 'Could not validate API key' }
  }
}
