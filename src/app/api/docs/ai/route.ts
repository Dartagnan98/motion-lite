import { NextRequest, NextResponse } from 'next/server'
import { getDoc, updateDoc } from '@/lib/db'
import { getApiKey, getModelId } from '@/lib/agent-runtime'
import { buildFetchConfig, normalizeResponse } from '@/lib/llm-provider'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { docId, prompt, action, selectedText } = await request.json()

  if (!prompt && !action) {
    return NextResponse.json({ error: 'prompt or action required' }, { status: 400 })
  }

  const doc = docId ? getDoc(docId) : null
  const docContent = doc?.content || ''

  // Parse existing blocks for context
  let existingText = ''
  try {
    const blocks = JSON.parse(docContent)
    if (Array.isArray(blocks)) {
      existingText = blocks.map((b: { content?: string }) => b.content?.replace(/<[^>]*>/g, '') || '').filter(Boolean).join('\n')
    }
  } catch {
    existingText = docContent
  }

  let systemPrompt = `You are an AI writing assistant inside a document editor. You help users write, edit, and improve documents.
Keep responses focused and practical. Write in a clear, professional tone unless told otherwise.
Do not include meta-commentary about what you're doing. Just write the content directly.`

  let userPrompt = ''

  if (action === 'summarize' && selectedText) {
    userPrompt = `Summarize this text concisely:\n\n${selectedText}`
  } else if (action === 'rewrite' && selectedText) {
    userPrompt = `Rewrite this text to be clearer and more polished:\n\n${selectedText}`
  } else if (action === 'expand' && selectedText) {
    userPrompt = `Expand on this text with more detail and depth:\n\n${selectedText}`
  } else if (action === 'shorten' && selectedText) {
    userPrompt = `Make this text more concise without losing meaning:\n\n${selectedText}`
  } else if (action === 'critique') {
    const role = prompt || 'expert reviewer'
    systemPrompt = `You are a ${role} reviewing a document. Provide constructive, actionable feedback from the perspective of a ${role}. Be specific about what works and what could be improved. Structure your feedback clearly.`
    userPrompt = `Review this document as a ${role} and provide feedback:\n\n${existingText}`
  } else {
    // General AI chat / drafting
    if (existingText) {
      userPrompt = `Current document content:\n---\n${existingText}\n---\n\nUser request: ${prompt}`
    } else {
      userPrompt = prompt
    }
  }

  try {
    // Get API key from BYOK config or env
    const keyConfig = getApiKey()
    const apiKey = keyConfig?.apiKey || process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key configured. Add one in Settings > AI.' }, { status: 500 })
    }
    const provider = keyConfig?.provider || 'anthropic'

    // Use Sonnet-tier model for doc AI (respects provider's model config)
    const model = getModelId('sonnet')

    const fetchConfig = buildFetchConfig(
      provider,
      apiKey,
      model,
      [{ type: 'text', text: systemPrompt }],
      [{ role: 'user', content: userPrompt }],
      [],
      4096,
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

    // For draft generation, convert to blocks and update the doc
    if (action === 'draft' && docId) {
      const blocks = textToBlocks(text)
      updateDoc(docId, { content: JSON.stringify(blocks) }, 'ai')
      return NextResponse.json({ text, blocks, applied: true })
    }

    return NextResponse.json({ text })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function textToBlocks(text: string) {
  const lines = text.split('\n')
  const blocks: { id: string; type: string; content: string; checked?: boolean }[] = []

  for (const line of lines) {
    const id = Math.random().toString(36).slice(2, 10)

    if (line.startsWith('# ')) {
      blocks.push({ id, type: 'heading1', content: line.slice(2) })
    } else if (line.startsWith('## ')) {
      blocks.push({ id, type: 'heading2', content: line.slice(3) })
    } else if (line.startsWith('### ')) {
      blocks.push({ id, type: 'heading3', content: line.slice(4) })
    } else if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
      blocks.push({ id, type: 'check_list', content: line.slice(6), checked: line.startsWith('- [x]') })
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({ id, type: 'bulleted_list', content: line.slice(2) })
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({ id, type: 'numbered_list', content: line.replace(/^\d+\.\s/, '') })
    } else if (line.startsWith('> ')) {
      blocks.push({ id, type: 'blockquote', content: line.slice(2) })
    } else if (line === '---' || line === '***') {
      blocks.push({ id, type: 'divider', content: '' })
    } else if (line.trim()) {
      blocks.push({ id, type: 'paragraph', content: line })
    }
  }

  return blocks.length > 0 ? blocks : [{ id: Math.random().toString(36).slice(2, 10), type: 'paragraph', content: '' }]
}
