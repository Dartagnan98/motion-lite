'use client'

import { useState } from 'react'
import { IconX } from '@/components/ui/Icons'
import { PRIORITY_COLORS as priorityColors } from '@/lib/task-constants'

interface AIProjectDialogProps {
  workspaceId: number
  folderId?: number
  onClose: () => void
  onCreated: (projectId: number) => void
}

interface GeneratedPlan {
  name: string
  description: string
  color: string
  stages: { name: string; color: string }[]
  tasks: { title: string; description?: string; priority: string; stage_index: number; duration_minutes: number }[]
}

export function AIProjectDialog({ workspaceId, folderId, onClose, onCreated }: AIProjectDialogProps) {
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [plan, setPlan] = useState<GeneratedPlan | null>(null)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!prompt.trim()) return
    setGenerating(true)
    setError('')
    setPlan(null)
    try {
      const res = await fetch('/api/projects/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), workspaceId, folderId, preview: true }),
      })
      if (!res.ok) throw new Error('Generation failed')
      const data = await res.json()
      setPlan(data)
    } catch {
      setError('Failed to generate project. Try again.')
    }
    setGenerating(false)
  }

  async function handleCreate() {
    if (!plan) return
    setCreating(true)
    try {
      const res = await fetch('/api/projects/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), workspaceId, folderId }),
      })
      const data = await res.json()
      if (data.project?.id) {
        onCreated(data.project.id)
      }
    } catch {
      setError('Failed to create project')
    }
    setCreating(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-[640px] max-h-[80vh] glass-elevated animate-glass-in rounded-md border border-border shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="text-accent-text">
              <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <h2 className="text-[14px] font-semibold text-text">Generate Project with AI</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-text-dim">
            <IconX />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Prompt input */}
          <div>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe your project..."
              rows={3}
              className="w-full bg-hover border border-border rounded-lg px-4 py-3 text-[13px] text-text outline-none placeholder:text-text-dim/50 resize-none focus:border-accent/50"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
            />
            <div className="flex items-center gap-2 mt-2 text-[11px] text-text-dim">
              <span>Examples:</span>
              {['Onboard new barbershop client', 'Launch Instagram campaign for tattoo shop', 'Monthly retainer for real estate agent'].map(ex => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="px-2 py-0.5 rounded bg-hover hover:bg-border text-text-secondary transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-[12px] text-red">{error}</p>}

          {/* Preview */}
          {plan && (
            <div className="space-y-3 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-[3px]" style={{ background: plan.color }} />
                <h3 className="text-[14px] font-semibold text-text">{plan.name}</h3>
              </div>
              {plan.description && <p className="text-[12px] text-text-secondary">{plan.description}</p>}

              {/* Stages */}
              <div>
                <span className="text-[11px] text-text-dim font-medium uppercase tracking-wide">Stages</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {plan.stages.map((s, i) => (
                    <span key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[13px] text-text" style={{ fontWeight: 500, background: `${s.color}20`, borderLeft: `3px solid ${s.color}` }}>
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Tasks */}
              <div>
                <span className="text-[11px] text-text-dim font-medium uppercase tracking-wide">Tasks ({plan.tasks.length})</span>
                <div className="mt-1 space-y-1 max-h-[200px] overflow-y-auto">
                  {plan.tasks.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-hover text-[12px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: priorityColors[t.priority] || 'var(--text-dim)' }} />
                      <span className="text-text flex-1">{t.title}</span>
                      <span className="text-text-dim">{t.duration_minutes}m</span>
                      <span className="text-text-dim text-[12px] px-1.5 py-0.5 rounded bg-hover">{plan.stages[t.stage_index]?.name || 'Unstaged'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded-md text-[12px] text-text-dim hover:bg-hover">Cancel</button>
          {plan ? (
            <>
              <button
                onClick={() => { setPlan(null); handleGenerate() }}
                disabled={generating}
                className="px-4 py-1.5 rounded-md text-[12px] text-text border border-border hover:bg-hover disabled:opacity-50"
              >
                {generating ? 'Regenerating...' : 'Regenerate'}
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent/80 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="px-4 py-1.5 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent/80 disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
