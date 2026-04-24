/**
 * LightRAG HTTP client for semantic knowledge retrieval.
 * Gracefully degrades -- returns null if the service is down.
 * Logs degradation so silent fallback is observable.
 */

const LIGHTRAG_URL = process.env.LIGHTRAG_URL || 'http://localhost:4002'
const TIMEOUT_MS = 5000

export type QueryMode = 'hybrid' | 'local' | 'global' | 'naive'
export type RagSource = 'knowledge_entries' | 'agent_references' | 'docs' | 'client_profiles'

export interface RagQueryOptions {
  source?: RagSource
  agentId?: string
  category?: string
}

export interface RagResultMetadata {
  source_table?: string
  record_id?: string
  agent_id?: string | null
  category?: string | null
}

export interface RagResult {
  content: string
  metadata: RagResultMetadata
}

export interface RagQueryResponse {
  results: RagResult[]
  mode: QueryMode
  filters?: {
    source?: RagSource
    agent_id?: string
    category?: string
  }
}

export async function ragQuery(
  query: string,
  mode: QueryMode = 'hybrid',
  options?: RagQueryOptions,
): Promise<RagQueryResponse | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${LIGHTRAG_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        mode,
        source: options?.source,
        agent_id: options?.agentId,
        category: options?.category,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`[rag-client] Query failed with status ${res.status}, falling back to SQL`)
      return null
    }
    return await res.json() as RagQueryResponse
  } catch (err) {
    console.warn(`[rag-client] RAG service unreachable, falling back to SQL: ${err instanceof Error ? err.message : 'unknown'}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function ragIngest(
  id: string,
  source: string,
  title: string,
  content: string,
  category: string = 'general',
  agentId?: string,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${LIGHTRAG_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, source, title, content, category, agent_id: agentId }),
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
