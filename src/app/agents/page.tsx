'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'

interface Agent {
  id: string
  name: string
  role: string
  system_prompt: string
  avatar_color: string | null
  status: string
  model_preference: string
  allowed_tools: string  // JSON array
  last_active: number | null
}

interface RunResult {
  response: string
  model: string
  elapsed_ms: number
  usage?: { input_tokens: number; output_tokens: number }
  error?: string
}

const MODEL_BADGES: Record<string, string> = {
  haiku: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  sonnet: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  opus: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  auto: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
}

function parseTools(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch { return [] }
}

function Avatar({ name, color }: { name: string; color: string | null }) {
  const initials = name.split(/[\s-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div
      className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
      style={{ background: color || '#6b7280', color: '#0a0a0a' }}
    >
      {initials}
    </div>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setAgents(data.agents || [])
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const selected = agents.find(a => a.id === selectedId)

  async function runAgent() {
    if (!selected || !testMessage.trim()) return
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selected.id, message: testMessage }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({ response: '', model: data.model || '', elapsed_ms: 0, error: data.error || `HTTP ${res.status}` })
      } else {
        setResult(data)
      }
    } catch (e) {
      setResult({ response: '', model: '', elapsed_ms: 0, error: e instanceof Error ? e.message : 'request failed' })
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <div className="p-6 text-text-dim text-sm">Loading agents…</div>
  if (error) return <div className="p-6 text-red-400 text-sm">Error: {error}</div>

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader title="Agents" subtitle={`${agents.length} agents synced from ~/.claude/agents/`} />

      <div className="flex-1 min-h-0 overflow-hidden flex">
        {/* Left: agent grid */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {agents.map(a => {
              const tools = parseTools(a.allowed_tools)
              const badge = MODEL_BADGES[a.model_preference?.toLowerCase()] || MODEL_BADGES.auto
              const isSel = a.id === selectedId
              return (
                <button
                  key={a.id}
                  onClick={() => { setSelectedId(a.id); setResult(null); setTestMessage('') }}
                  className={`text-left p-4 rounded-lg border transition-colors ${
                    isSel
                      ? 'bg-accent/10 border-accent/40'
                      : 'bg-elevated border-border hover:border-border-strong'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={a.name} color={a.avatar_color} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-text">{a.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider ${badge}`}>
                          {a.model_preference}
                        </span>
                      </div>
                      {a.role && (
                        <div className="text-[12px] text-text-dim mt-1 line-clamp-2">{a.role}</div>
                      )}
                      <div className="text-[10px] text-text-muted mt-2 font-mono">
                        {tools.includes('*') ? 'all tools' : `${tools.length} tools`} · {a.status}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: detail + test panel */}
        {selected && (
          <div className="w-[480px] shrink-0 border-l border-border bg-bg-surface overflow-y-auto">
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Avatar name={selected.name} color={selected.avatar_color} />
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-semibold text-text">{selected.name}</div>
                  <div className="text-[12px] text-text-dim font-mono">{selected.id}</div>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-text-dim hover:text-text text-[14px] px-2 py-1"
                  aria-label="Close"
                >×</button>
              </div>

              {selected.role && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-text-muted mb-1">Role</div>
                  <div className="text-[13px] text-text">{selected.role}</div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-text-muted mb-1">Model</div>
                  <div className="text-text">{selected.model_preference}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-text-muted mb-1">Tools</div>
                  <div className="text-text">{parseTools(selected.allowed_tools).join(', ') || '—'}</div>
                </div>
              </div>

              <details className="border border-border rounded-md">
                <summary className="cursor-pointer p-3 text-[11px] uppercase tracking-widest text-text-muted hover:text-text">
                  System prompt ({selected.system_prompt?.length || 0} chars)
                </summary>
                <pre className="p-3 pt-0 text-[12px] text-text-secondary font-mono whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                  {selected.system_prompt || '(empty)'}
                </pre>
              </details>

              <div className="border-t border-border pt-4">
                <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Test this agent</div>
                <textarea
                  value={testMessage}
                  onChange={e => setTestMessage(e.target.value)}
                  placeholder="Send a prompt and see the response…"
                  rows={4}
                  className="w-full p-3 rounded-md bg-elevated border border-border text-[13px] text-text resize-y focus:outline-none focus:border-accent"
                  disabled={running}
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={runAgent}
                    disabled={running || !testMessage.trim()}
                    className="px-4 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors"
                  >
                    {running ? 'Running…' : 'Run'}
                  </button>
                  {testMessage && !running && (
                    <button
                      onClick={() => { setTestMessage(''); setResult(null) }}
                      className="px-3 py-2 text-[12px] text-text-dim hover:text-text"
                    >Clear</button>
                  )}
                </div>
              </div>

              {result && (
                <div className="border-t border-border pt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-widest text-text-muted">Response</div>
                    {!result.error && (
                      <div className="text-[11px] text-text-muted font-mono">
                        {result.model} · {result.elapsed_ms}ms
                        {result.usage && ` · ${result.usage.input_tokens}→${result.usage.output_tokens} tok`}
                      </div>
                    )}
                  </div>
                  {result.error ? (
                    <div className="p-3 rounded-md bg-red-900/20 border border-red-500/30 text-[13px] text-red-300">
                      {result.error}
                    </div>
                  ) : (
                    <div className="p-3 rounded-md bg-elevated border border-border text-[13px] text-text whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto">
                      {result.response}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
