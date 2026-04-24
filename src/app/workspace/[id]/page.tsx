'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { TreeNode } from '@/lib/types'
import { docUrl, projectUrl } from '@/lib/url-utils'

interface WorkspaceInfo {
  id: number
  public_id: string
  name: string
  color: string
  slug: string
}

export default function WorkspaceNavigatePage() {
  const params = useParams()
  const router = useRouter()
  const workspaceParam = params.id as string
  // workspaceId used for internal API calls; workspaceParam is the public_id from URL
  const workspaceId = /^\d+$/.test(workspaceParam) ? Number(workspaceParam) : 0
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [activeTab, setActiveTab] = useState<'navigate' | 'tasklist' | 'kanban'>('navigate')
  const [inlineAdd, setInlineAdd] = useState(false)
  const [addValue, setAddValue] = useState('')
  const [addType, setAddType] = useState<'folder' | 'project' | 'doc' | 'database'>('doc')
  const [showAddMenu, setShowAddMenu] = useState(false)

  const refreshTree = useCallback(() => {
    fetch(`/api/sidebar?workspaceId=${workspaceParam}`)
      .then(r => r.json())
      .then(d => setTree(Array.isArray(d) ? d : []))
      .catch(() => setTree([]))
  }, [workspaceParam])

  useEffect(() => {
    // Load workspace info - pass public_id or numeric id, API handles both
    fetch(`/api/workspaces?id=${workspaceParam}`)
      .then(r => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const ws = data.find((w: WorkspaceInfo) => w.public_id === workspaceParam || w.id === workspaceId)
          if (ws) setWorkspace(ws)
        } else if (data?.id) {
          setWorkspace(data)
        }
      })
    refreshTree()
  }, [workspaceParam, workspaceId, refreshTree])

  // Listen for sidebar-refresh events
  useEffect(() => {
    const handler = () => refreshTree()
    window.addEventListener('sidebar-refresh', handler)
    return () => window.removeEventListener('sidebar-refresh', handler)
  }, [refreshTree])

  // Count total items in tree
  function countItems(nodes: TreeNode[]): number {
    let count = 0
    for (const n of nodes) {
      count++
      if (n.children.length > 0) count += countItems(n.children)
    }
    return count
  }

  const totalItems = countItems(tree)

  async function handleInlineSubmit() {
    if (!addValue.trim() || !workspace) { setInlineAdd(false); setAddValue(''); return }
    const wsId = workspace.id
    if (addType === 'folder') {
      await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, name: addValue.trim() }),
      })
    } else if (addType === 'project') {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, name: addValue.trim() }),
      })
    } else if (addType === 'doc') {
      await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, title: addValue.trim() }),
      })
    } else if (addType === 'database') {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_sheet', name: addValue.trim(), workspace_id: wsId }),
      })
    }
    setInlineAdd(false)
    setAddValue('')
    refreshTree()
    window.dispatchEvent(new Event('sidebar-refresh'))
  }

  if (!workspace) return null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span style={{ color: workspace.color }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 8.5l10 6.5 10-6.5L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M2 12l10 6.5L22 12" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M2 15.5l10 6.5 10-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="text-[22px] font-bold text-text">{workspace.name}</h1>
            <span className="text-[12px] text-text-dim bg-elevated px-2 py-0.5 rounded-full">{totalItems}</span>
            <button className="text-text-dim hover:text-text ml-1">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.3" />
                <circle cx="8" cy="8" r="1.3" />
                <circle cx="12" cy="8" r="1.3" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push(`/settings?section=workspace&ws=${workspaceParam}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-text-secondary border border-border rounded-lg hover:bg-hover transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
              </svg>
              Workspace Settings
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-border">
          {[
            { id: 'navigate' as const, label: 'Navigate', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z"/></svg> },
            { id: 'tasklist' as const, label: 'Task List', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 4h8M4 8h6M4 12h4"/></svg> },
            { id: 'kanban' as const, label: 'Kanban', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="3" height="12" rx="0.5"/><rect x="6.5" y="2" width="3" height="8" rx="0.5"/><rect x="11" y="2" width="3" height="10" rx="0.5"/></svg> },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'navigate') setActiveTab('navigate')
                else router.push(`/projects-tasks?view=${tab.id === 'tasklist' ? 'Task List' : 'Kanban'}&ws=${workspaceParam}`)
              }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-text'
                  : 'border-transparent text-text-dim hover:text-text-secondary'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => { setInlineAdd(true); setAddType('doc') }}
              className="flex h-6 w-6 items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text transition-colors"
              title="Add new"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Navigate Tree */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {tree.map(node => (
          <NavigateItem
            key={node.id}
            node={node}
            depth={0}
            workspaceId={workspaceId}
            onRefresh={() => { refreshTree(); window.dispatchEvent(new Event('sidebar-refresh')) }}
          />
        ))}

        {/* Inline add */}
        {inlineAdd ? (
          <div className="flex items-center gap-2 py-2 px-3 mt-1">
            <div className="relative">
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="text-text-dim hover:text-text"
              >
                {addType === 'folder' ? <FolderIcon /> : addType === 'project' ? <ProjectIcon /> : addType === 'database' ? <SheetIcon /> : <DocIcon />}
              </button>
              {showAddMenu && (
                <div className="absolute top-full left-0 mt-1 bg-elevated border border-border rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
                  {(['folder', 'project', 'doc', 'database'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => { setAddType(t); setShowAddMenu(false) }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text-secondary hover:bg-hover hover:text-text"
                    >
                      {t === 'folder' ? <FolderIcon /> : t === 'project' ? <ProjectIcon /> : t === 'database' ? <SheetIcon /> : <DocIcon />}
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              autoFocus
              value={addValue}
              onChange={e => setAddValue(e.target.value)}
              placeholder={`New ${addType} name...`}
              className="flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-dim"
              onKeyDown={e => {
                if (e.key === 'Enter') handleInlineSubmit()
                if (e.key === 'Escape') { setInlineAdd(false); setAddValue('') }
              }}
              onBlur={() => {
                if (addValue.trim()) handleInlineSubmit()
                else { setInlineAdd(false); setAddValue('') }
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setInlineAdd(true)}
            className="flex items-center gap-2 py-2 px-3 mt-1 text-[14px] text-text-dim hover:text-text-secondary transition-colors w-full"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            New folder, project, doc, or database
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Navigate Item (matches tree layout) ───

function NavigateItem({
  node,
  depth,
  workspaceId,
  onRefresh,
}: {
  node: TreeNode
  depth: number
  workspaceId: number
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const [showMenu, setShowMenu] = useState(false)
  const router = useRouter()

  const isFolder = node.type === 'folder'
  const isProject = node.type === 'project'
  const isDoc = node.type === 'doc'
  const isDatabase = node.type === 'database'

  // numericId still needed for internal API calls (rename, delete)
  const numericId = node.id.split('-').slice(1).join('-')
  const hasChildren = node.children.length > 0

  function handleClick() {
    if (isFolder || (isProject && hasChildren)) {
      setExpanded(!expanded)
    } else if (isProject && node.public_id) {
      router.push(projectUrl(node.public_id))
    } else if (isDoc && node.public_id) {
      router.push(docUrl(node.public_id))
    } else if (isDatabase && node.public_id) {
      router.push(`/database?open=${node.public_id}`)
    }
  }

  function handleDoubleClick() {
    if (isProject && node.public_id) {
      router.push(projectUrl(node.public_id))
    }
  }

  const indent = depth * 24

  const icons: Record<string, React.ReactNode> = {
    folder: <FolderIcon color={node.color} />,
    project: <ProjectIcon color={node.color} />,
    doc: <DocIcon color={node.color} />,
    database: <SheetIcon color={node.color} />,
  }

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded-md hover:bg-hover transition-colors cursor-pointer py-1.5 pr-2"
        style={{ paddingLeft: `${12 + indent}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* Expand chevron */}
        {hasChildren || isFolder || isProject ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            className="shrink-0 w-5 h-5 flex items-center justify-center text-text-dim hover:text-text"
          >
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Icon */}
        <span className="shrink-0">{icons[node.type]}</span>

        {/* Name */}
        <span className="text-[14px] text-text truncate flex-1">{node.name || (isDoc ? 'Untitled Doc' : node.name)}</span>

        {/* Item count */}
        {node.itemCount > 0 && (
          <span className="text-[12px] text-text-dim shrink-0 ml-1">{node.itemCount}</span>
        )}

        {/* Hover actions */}
        <span className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-1 relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:text-text hover:bg-border/50 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="4" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="12" cy="8" r="1.3" />
            </svg>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-[100]" onClick={(e) => { e.stopPropagation(); setShowMenu(false) }} />
              <div className="absolute right-0 top-6 z-[101] bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
                {isProject && node.public_id && (
                  <button onClick={(e) => { e.stopPropagation(); setShowMenu(false); router.push(projectUrl(node.public_id!)) }}
                    className="w-full text-left px-3 py-1.5 text-[13px] text-text hover:bg-hover">
                    Open
                  </button>
                )}
                {isDoc && node.public_id && (
                  <button onClick={(e) => { e.stopPropagation(); setShowMenu(false); router.push(docUrl(node.public_id!)) }}
                    className="w-full text-left px-3 py-1.5 text-[13px] text-text hover:bg-hover">
                    Open
                  </button>
                )}
                <button onClick={async (e) => {
                  e.stopPropagation(); setShowMenu(false)
                  const newName = prompt('Rename to:', node.name)
                  if (newName && newName !== node.name) {
                    const type = isProject ? 'projects' : isDoc ? 'docs' : isFolder ? 'folders' : null
                    if (type) {
                      await fetch(`/api/${type}/${numericId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, title: newName }) })
                      onRefresh()
                    }
                  }
                }} className="w-full text-left px-3 py-1.5 text-[13px] text-text hover:bg-hover">
                  Rename
                </button>
                <button onClick={async (e) => {
                  e.stopPropagation(); setShowMenu(false)
                  if (confirm(`Delete "${node.name}"?`)) {
                    const type = isProject ? 'projects' : isDoc ? 'docs' : isFolder ? 'folders' : null
                    if (type) {
                      await fetch(`/api/${type}/${numericId}`, { method: 'DELETE' })
                      onRefresh()
                    }
                  }
                }} className="w-full text-left px-3 py-1.5 text-[13px] text-red-400 hover:bg-hover">
                  Delete
                </button>
              </div>
            </>
          )}
        </span>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <NavigateItem
              key={child.id}
              node={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Icons ───

function FolderIcon({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: color || 'currentColor' }}>
      <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function ProjectIcon({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: color || 'currentColor' }}>
      <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function DocIcon({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: color || 'currentColor' }}>
      <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function SheetIcon({ color }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: color || 'currentColor' }}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  )
}
