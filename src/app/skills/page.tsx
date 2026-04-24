'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { IconX } from '@/components/ui/Icons'

interface Skill {
  id: number
  slug: string
  name: string
  description: string
  version: string
  triggers: string
  tags: string
  env_vars_needed: string
  homepage: string | null
  installed_from: string
  enabled: number
  health_status: string
  error_count: number
  last_error: string | null
  last_used: number | null
  use_count: number
  created_at: number
}

interface SkillAgent {
  agent_id: string
  enabled: number
  agent_name: string
}

interface Agent {
  id: string
  name: string
  role: string
}

interface Learning {
  id: number
  type: string
  content: string
  created_at: number
  skill_slug?: string
}

const HEALTH_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  healthy: { bg: 'rgba(122,107,85,0.12)', text: '#7a6b55', label: 'Healthy' },
  degraded: { bg: 'rgba(255,152,0,0.12)', text: '#ff9800', label: 'Degraded' },
  unhealthy: { bg: 'rgba(239,83,80,0.12)', text: '#ef5350', label: 'Unhealthy' },
  unknown: { bg: 'rgba(158,158,163,0.12)', text: 'var(--text-dim)', label: 'Unknown' },
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [skillAgents, setSkillAgents] = useState<SkillAgent[]>([])
  const [learnings, setLearnings] = useState<Learning[]>([])
  const [scanning, setScanning] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const [showInstall, setShowInstall] = useState(false)
  const [showLearnings, setShowLearnings] = useState(false)
  const [scanResult, setScanResult] = useState<{ imported: number; updated: number; errors: string[] } | null>(null)
  const [activeTab, setActiveTab] = useState<'installed' | 'registry'>('installed')
  const [registrySkills, setRegistrySkills] = useState<{ name: string; slug: string; description: string; category: string; repo_url: string }[]>([])
  const [registryCategories, setRegistryCategories] = useState<string[]>([])
  const [registryQuery, setRegistryQuery] = useState('')
  const [registryCategory, setRegistryCategory] = useState('All')
  const [registryLoading, setRegistryLoading] = useState(false)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)

  const loadSkills = useCallback(() => {
    fetch('/api/skills').then(r => r.json()).then(d => setSkills(d.skills || [])).catch(() => {})
  }, [])

  useEffect(() => {
    loadSkills()
    fetch('/api/agents').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : d.agents || []
      setAgents(list)
    }).catch(() => {})
  }, [loadSkills])

  async function scanSkills() {
    setScanning(true)
    setScanResult(null)
    const res = await fetch('/api/skills?action=scan')
    const data = await res.json()
    setScanResult(data)
    setScanning(false)
    loadSkills()
  }

  async function runHealthCheck() {
    await fetch('/api/skills?action=health')
    loadSkills()
  }

  async function installSkill() {
    if (!githubUrl.trim()) return
    setInstalling(true)
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_url: githubUrl.trim() }),
    })
    const data = await res.json()
    setInstalling(false)
    if (data.success) {
      setGithubUrl('')
      setShowInstall(false)
      loadSkills()
    } else {
      alert(data.error || 'Install failed')
    }
  }

  async function toggleSkill(id: number, enabled: boolean) {
    await fetch('/api/skills', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    })
    setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: enabled ? 1 : 0 } : s))
  }

  async function selectSkill(skill: Skill) {
    setSelectedSkill(skill)
    const res = await fetch(`/api/skills?action=agents&id=${skill.id}`)
    const data = await res.json()
    setSkillAgents(data.agents || [])
  }

  async function toggleSkillAgent(skillId: number, agentId: string, enabled: boolean) {
    await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_id: skillId, agent_id: agentId, enabled }),
    })
    setSkillAgents(prev =>
      prev.some(a => a.agent_id === agentId)
        ? prev.map(a => a.agent_id === agentId ? { ...a, enabled: enabled ? 1 : 0 } : a)
        : [...prev, { agent_id: agentId, enabled: enabled ? 1 : 0, agent_name: agents.find(a => a.id === agentId)?.name || agentId }]
    )
  }

  async function deleteSkill(id: number) {
    await fetch(`/api/skills?id=${id}`, { method: 'DELETE' })
    setSelectedSkill(null)
    loadSkills()
  }

  async function loadLearnings() {
    setShowLearnings(true)
    const res = await fetch('/api/skills?action=learnings&agent_id=jimmy')
    const data = await res.json()
    setLearnings(data.learnings || [])
  }

  async function browseRegistry(q?: string, cat?: string) {
    setRegistryLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (cat && cat !== 'All') params.set('category', cat)
    params.set('limit', '100')
    const res = await fetch(`/api/skills/registry?${params}`)
    const data = await res.json()
    setRegistrySkills(data.skills || [])
    if (data.categories) setRegistryCategories(data.categories)
    setRegistryLoading(false)
  }

  async function installFromRegistry(repoUrl: string, slug: string) {
    setInstallingSlug(slug)
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_url: repoUrl }),
    })
    const data = await res.json()
    setInstallingSlug(null)
    if (data.success) {
      loadSkills()
    } else {
      alert(data.error || 'Install failed')
    }
  }

  function parseTags(json: string): string[] {
    try { return JSON.parse(json) } catch { return [] }
  }

  function formatTime(ts: number | null): string {
    if (!ts) return 'Never'
    const d = new Date(ts * 1000)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <div className="h-full flex">
      {/* Skill List */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[18px] font-semibold text-text">Skills</h1>
            <p className="text-[13px] text-text-dim">{skills.length} installed | OpenClaw compatible</p>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'installed' && (
              <>
                <button onClick={loadLearnings} className="px-3 py-1.5 text-[13px] text-text-dim hover:text-text border border-border rounded-md hover:bg-hover">Learnings</button>
                <button onClick={runHealthCheck} className="px-3 py-1.5 text-[13px] text-text-dim hover:text-text border border-border rounded-md hover:bg-hover">Health Check</button>
                <button onClick={scanSkills} disabled={scanning} className="px-3 py-1.5 text-[13px] font-medium text-text border border-border rounded-md hover:bg-hover disabled:opacity-50">{scanning ? 'Scanning...' : 'Scan Local'}</button>
                <button onClick={() => setShowInstall(!showInstall)} className="px-3 py-1.5 text-[13px] font-medium text-white bg-accent rounded-md hover:bg-accent/80">+ Install</button>
              </>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-0 border-b border-border mb-4">
          <button
            onClick={() => setActiveTab('installed')}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${activeTab === 'installed' ? 'border-accent text-text' : 'border-transparent text-text-dim hover:text-text-secondary'}`}
          >
            Installed ({skills.length})
          </button>
          <button
            onClick={() => { setActiveTab('registry'); if (registrySkills.length === 0) browseRegistry() }}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${activeTab === 'registry' ? 'border-accent text-text' : 'border-transparent text-text-dim hover:text-text-secondary'}`}
          >
            Browse Registry
          </button>
        </div>

        {activeTab === 'registry' ? (
          /* ---- Registry Browse ---- */
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-sm">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5.5" /><path d="M11 11l3.5 3.5" /></svg>
                <input
                  value={registryQuery}
                  onChange={e => { setRegistryQuery(e.target.value); browseRegistry(e.target.value, registryCategory) }}
                  placeholder="Search 5,400+ OpenClaw skills..."
                  className="w-full rounded-lg border border-border bg-bg pl-9 pr-3 py-2 text-[13px] text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                />
              </div>
              <Dropdown
                value={registryCategory}
                onChange={(v) => { setRegistryCategory(v); browseRegistry(registryQuery, v) }}
                options={[
                  { label: 'All Categories', value: 'All' },
                  ...registryCategories.map(c => ({ label: c, value: c })),
                ]}
                triggerClassName="bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                minWidth={160}
              />
            </div>

            {registryLoading ? (
              <div className="text-center py-12 text-text-dim text-[13px]">Loading registry...</div>
            ) : registrySkills.length === 0 ? (
              <div className="text-center py-12 text-text-dim text-[13px]">No skills found. Try a different search.</div>
            ) : (
              <div className="space-y-1.5">
                {registrySkills.map(rs => {
                  const isInstalled = skills.some(s => s.slug === rs.slug)
                  const isInstalling = installingSlug === rs.slug
                  return (
                    <div key={rs.slug} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-text-dim/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-text">{rs.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-hover text-text-dim">{rs.category}</span>
                        </div>
                        <p className="text-[10px] text-text-dim mt-0.5 truncate">{rs.description}</p>
                      </div>
                      {isInstalled ? (
                        <span className="text-[10px] text-green-400 font-medium shrink-0 flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 6l3 3 5-5" /></svg>
                          Installed
                        </span>
                      ) : isInstalling ? (
                        <span className="text-[10px] text-accent font-medium animate-pulse shrink-0">Installing...</span>
                      ) : (
                        <button
                          onClick={() => installFromRegistry(rs.repo_url, rs.slug)}
                          className="px-3 py-1.5 rounded-md bg-accent text-[12px] font-medium text-white hover:bg-accent/90 transition-colors shrink-0"
                        >
                          Install
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
        /* ---- Installed Skills ---- */
        <>

        {/* Install from GitHub */}
        {showInstall && (
          <div className="mb-4 p-4 rounded-lg border border-border bg-elevated">
            <p className="text-[13px] text-text-dim mb-2">Install a skill from a GitHub repository</p>
            <div className="flex gap-2">
              <input
                value={githubUrl}
                onChange={e => setGithubUrl(e.target.value)}
                placeholder="https://github.com/user/skill-repo"
                className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-[13px] text-text font-mono placeholder:text-text-dim outline-none focus:border-border-strong"
              />
              <button
                onClick={installSkill}
                disabled={installing || !githubUrl.trim()}
                className="px-4 py-2 text-[13px] font-medium text-white bg-accent rounded-md hover:bg-accent/80 disabled:opacity-50"
              >
                {installing ? 'Installing...' : 'Install'}
              </button>
            </div>
          </div>
        )}

        {/* Scan result */}
        {scanResult && (
          <div className="mb-4 p-3 rounded-lg border border-border bg-elevated text-[13px]">
            <span className="text-text">Scan complete: </span>
            <span className="text-accent-text">{scanResult.imported} new</span>
            <span className="text-text-dim">, </span>
            <span className="text-blue">{scanResult.updated} updated</span>
            {scanResult.errors.length > 0 && (
              <span className="text-red">, {scanResult.errors.length} errors</span>
            )}
            <button onClick={() => setScanResult(null)} className="ml-2 text-text-dim hover:text-text">x</button>
          </div>
        )}

        {/* Skills grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {skills.map(skill => {
            const tags = parseTags(skill.tags)
            const health = HEALTH_COLORS[skill.health_status] || HEALTH_COLORS.unknown
            const isSelected = selectedSkill?.id === skill.id
            return (
              <div
                key={skill.id}
                onClick={() => selectSkill(skill)}
                className={`rounded-lg border p-4 cursor-pointer transition-all ${
                  isSelected ? 'border-accent bg-accent/5' : 'border-border hover:border-border-strong hover:bg-hover/50'
                } ${skill.enabled ? '' : 'opacity-50'}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-[13px] font-semibold text-text truncate">{skill.name}</h3>
                    <span className="text-[10px] text-text-dim shrink-0">v{skill.version}</span>
                  </div>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ background: health.bg, color: health.text }}
                  >
                    {health.label}
                  </span>
                </div>
                <p className="text-[10px] text-text-dim line-clamp-2 mb-3">{skill.description}</p>
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {tags.slice(0, 3).map(t => (
                      <span key={t} className="text-[9px] text-text-dim bg-hover px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                    {tags.length > 3 && <span className="text-[9px] text-text-dim">+{tags.length - 3}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-text-dim">
                    {skill.use_count > 0 && <span>{skill.use_count} uses</span>}
                    {skill.last_used && <span>{formatTime(skill.last_used)}</span>}
                  </div>
                </div>
                {skill.error_count > 0 && (
                  <div className="mt-2 text-[10px] text-red">
                    {skill.error_count} error{skill.error_count !== 1 ? 's' : ''}
                    {skill.last_error && `: ${skill.last_error.slice(0, 60)}`}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {skills.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[13px] text-text-dim mb-3">No skills installed yet</p>
            <button onClick={scanSkills} className="px-4 py-2 text-[13px] font-medium text-white bg-accent rounded-md hover:bg-accent/80">
              Scan Local Skills
            </button>
          </div>
        )}
        </>
        )}
      </div>

      {/* Skill Detail Panel */}
      {selectedSkill && (
        <div className="w-[360px] shrink-0 border-l border-border overflow-y-auto p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-semibold text-text">{selectedSkill.name}</h2>
            <button onClick={() => setSelectedSkill(null)} className="text-text-dim hover:text-text">
              <IconX size={14} />
            </button>
          </div>

          <p className="text-[13px] text-text-dim mb-4">{selectedSkill.description}</p>

          {/* Quick actions */}
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => toggleSkill(selectedSkill.id, !selectedSkill.enabled)}
              className={`flex-1 px-3 py-2 text-[13px] font-medium rounded-md border ${
                selectedSkill.enabled
                  ? 'border-red/30 text-red hover:bg-red/10'
                  : 'border-accent/30 text-accent-text hover:bg-accent/10'
              }`}
            >
              {selectedSkill.enabled ? 'Disable' : 'Enable'}
            </button>
            {selectedSkill.homepage && (
              <a
                href={selectedSkill.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-[13px] text-text-dim border border-border rounded-md hover:bg-hover"
              >
                GitHub
              </a>
            )}
            <button
              onClick={() => { if (confirm('Delete this skill?')) deleteSkill(selectedSkill.id) }}
              className="px-3 py-2 text-[13px] text-red border border-border rounded-md hover:bg-red/10"
            >
              Delete
            </button>
          </div>

          {/* Info */}
          <div className="space-y-3 mb-5">
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Version</span>
              <span className="text-text">{selectedSkill.version}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Source</span>
              <span className="text-text font-mono">{selectedSkill.installed_from === 'local' ? 'Local' : 'GitHub'}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Uses</span>
              <span className="text-text">{selectedSkill.use_count}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Last used</span>
              <span className="text-text">{formatTime(selectedSkill.last_used)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-text-dim">Errors</span>
              <span className={selectedSkill.error_count > 0 ? 'text-red' : 'text-text'}>{selectedSkill.error_count}</span>
            </div>
          </div>

          {/* Env vars needed */}
          {(() => {
            const envVars = parseTags(selectedSkill.env_vars_needed)
            if (envVars.length === 0) return null
            return (
              <div className="mb-5">
                <h4 className="text-[13px] font-semibold text-text mb-2">Required Environment Variables</h4>
                <div className="space-y-1">
                  {envVars.map(v => (
                    <div key={v} className="flex items-center gap-2 px-2 py-1.5 rounded bg-elevated text-[10px]">
                      <span className="font-mono text-text">{v}</span>
                      <a href="/settings?section=env-vault" className="ml-auto text-accent-text hover:underline">Configure</a>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Agent assignment */}
          <div className="mb-5">
            <h4 className="text-[13px] font-semibold text-text mb-2">Assign to Agents</h4>
            <div className="space-y-1">
              {agents.map(agent => {
                const assignment = skillAgents.find(a => a.agent_id === agent.id)
                const isAssigned = assignment ? assignment.enabled === 1 : false
                return (
                  <button
                    key={agent.id}
                    onClick={() => toggleSkillAgent(selectedSkill.id, agent.id, !isAssigned)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] transition-colors ${
                      isAssigned ? 'bg-accent/10 border border-accent/30' : 'bg-elevated border border-border hover:border-border-strong'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isAssigned ? 'bg-accent' : 'bg-border'}`} />
                    <span className="text-text font-medium">{agent.name}</span>
                    <span className="text-text-dim capitalize">{agent.role.replace(/-/g, ' ')}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Triggers */}
          <div>
            <h4 className="text-[13px] font-semibold text-text mb-2">Trigger Keywords</h4>
            <div className="flex flex-wrap gap-1">
              {parseTags(selectedSkill.triggers).map(t => (
                <span key={t} className="text-[10px] text-text-dim bg-hover px-2 py-1 rounded font-mono">{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Learnings modal */}
      {showLearnings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowLearnings(false)}>
          <div className="bg-bg border border-border rounded-xl w-[600px] max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold text-text">Agent Learnings</h2>
              <button onClick={() => setShowLearnings(false)} className="text-text-dim hover:text-text">
                <IconX size={14} />
              </button>
            </div>
            <div className="space-y-2">
              {learnings.map(l => (
                <div key={l.id} className="px-3 py-2 rounded-md bg-elevated border border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      l.type === 'error' ? 'bg-red/10 text-red' :
                      l.type === 'correction' ? 'bg-orange/10 text-orange' :
                      l.type === 'learning' ? 'bg-accent/10 text-accent-text' :
                      'bg-blue/10 text-blue'
                    }`}>{l.type}</span>
                    {l.skill_slug && <span className="text-[10px] text-text-dim font-mono">{l.skill_slug}</span>}
                    <span className="text-[10px] text-text-dim ml-auto">{formatTime(l.created_at)}</span>
                  </div>
                  <p className="text-[10px] text-text-secondary whitespace-pre-wrap">{l.content}</p>
                </div>
              ))}
              {learnings.length === 0 && <p className="text-[13px] text-text-dim text-center py-4">No learnings yet</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
