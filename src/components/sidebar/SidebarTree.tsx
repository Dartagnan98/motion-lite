'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { Workspace, TreeNode } from '@/lib/types'
import { docUrl, projectUrl } from '@/lib/url-utils'
import { SidebarItem } from './SidebarItem'
import { PlusIcon } from './Sidebar'
import { ContextMenu } from './ContextMenu'
// Using fetch API instead of server actions to avoid stale build ID issues

function treeHasActivePath(nodes: TreeNode[], wsPublicId: string, pathname: string): boolean {
  for (const node of nodes) {
    const href = node.type === 'project' && node.public_id ? projectUrl(node.public_id)
      : node.type === 'doc' && node.public_id ? docUrl(node.public_id)
      : node.type === 'database' && node.public_id ? `/database/${node.public_id}`
      : undefined
    if (href && pathname === href) return true
    if (node.children.length > 0 && treeHasActivePath(node.children, wsPublicId, pathname)) return true
  }
  return false
}

export function SidebarTree({ workspace, isActive, onActivate, onNewProject }: { workspace: Workspace; isActive?: boolean; onActivate?: () => void; onNewProject?: () => void }) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState(true)
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [inlineAdd, setInlineAdd] = useState<'folder' | 'project' | 'doc' | 'database' | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  const [wsMenuPos, setWsMenuPos] = useState({ x: 0, y: 0 })
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  function refreshTree() {
    fetch(`/api/sidebar?workspaceId=${workspace.public_id}`)
      .then(r => r.json())
      .then(d => setTree(Array.isArray(d) ? d : []))
      .catch(() => setTree([]))
  }

  useEffect(() => { refreshTree() }, [workspace.public_id])

  // Listen for sidebar-refresh events from doc editor, project pages, etc.
  useEffect(() => {
    const handler = () => refreshTree()
    window.addEventListener('sidebar-refresh', handler)
    return () => window.removeEventListener('sidebar-refresh', handler)
  }, [workspace.public_id])

  // Auto-expand workspace if any descendant item matches the current path or we're on the workspace page
  const isWorkspacePage = pathname === `/workspace/${workspace.public_id}`
  useEffect(() => {
    if (pathname && (isWorkspacePage || (tree.length > 0 && treeHasActivePath(tree, workspace.public_id || '', pathname)))) {
      setExpanded(true)
    }
  }, [pathname, tree, workspace.public_id, isWorkspacePage])

  function handlePlusClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuPos({ x: rect.right, y: rect.bottom + 4 })
    setMenuOpen(true)
  }

  async function handleMenuAction(action: string) {
    setMenuOpen(false)
    if (action === 'project') {
      // Open the unified CreateProjectModal instead of inline input
      onNewProject?.()
      return
    }
    if (action === 'folder' || action === 'doc' || action === 'database') {
      setInlineAdd(action as typeof inlineAdd)
    }
  }

  async function handleInlineSubmit(name: string) {
    if (!name.trim()) { setInlineAdd(null); return }
    if (inlineAdd === 'folder') {
      await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, name }),
      })
    } else if (inlineAdd === 'project') {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, name }),
      })
    } else if (inlineAdd === 'doc') {
      await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, title: name }),
      })
    } else if (inlineAdd === 'database') {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_sheet', name, workspace_id: workspace.id }),
      })
    }
    setInlineAdd(null)
    refreshTree()
  }

  // Drop on workspace root to un-nest items from folders
  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragOver(false)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setDragOver(false)

    const raw = e.dataTransfer.getData('application/sidebar-item')
    if (!raw) return
    const item = JSON.parse(raw)

    // Move to workspace root (no folder)
    await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: item.type,
        id: item.id,
        targetFolderId: null,
      }),
    })

    refreshTree()
  }

  const taskCount = tree.reduce((acc, node) => acc + node.itemCount + node.children.reduce((a, c) => a + c.itemCount, 0), 0)

  return (
    <div
      className="mb-2"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDragEnter={(e) => { e.preventDefault() }}
      onDrop={handleDrop}
    >
      {/* Workspace header */}
      <div
        className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
          dragOver ? 'bg-accent/20 ring-1 ring-accent/40' : (isActive || isWorkspacePage) ? 'bg-white/[0.08]' : 'hover:bg-hover'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(prev => !prev) }}
            className="shrink-0 w-[18px] h-[18px] flex items-center justify-center relative"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {/* Layers icon - visible by default, hidden on group hover */}
            <span className="group-hover:hidden flex items-center justify-center" style={{ color: workspace.color }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 8.5l10 6.5 10-6.5L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M2 12l10 6.5L22 12" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M2 15.5l10 6.5 10-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            {/* Chevron - hidden by default, visible on group hover */}
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`hidden group-hover:block absolute transition-transform text-text-dim ${expanded ? 'rotate-90' : ''}`}
            >
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={() => { router.push(`/workspace/${workspace.public_id}`); setExpanded(true); onActivate?.() }}
            className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          >
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  await fetch('/api/workspaces', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: workspace.id, name: renameValue.trim() }) })
                  setRenaming(false)
                  window.location.reload()
                }
                if (e.key === 'Escape') setRenaming(false)
              }}
              onBlur={async () => {
                if (renameValue.trim() && renameValue !== workspace.name) {
                  await fetch('/api/workspaces', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: workspace.id, name: renameValue.trim() }) })
                  window.location.reload()
                }
                setRenaming(false)
              }}
              onClick={e => e.stopPropagation()}
              className="flex-1 bg-transparent text-[13px] font-medium text-text outline-none border-b border-accent min-w-0"
            />
          ) : (
            <span className={`text-[13px] truncate font-medium ${(isActive || isWorkspacePage) ? 'text-white' : 'text-text-secondary'}`}>{workspace.name}</span>
          )}
          {taskCount > 0 && (
            <span className="text-[10px] text-text-dim shrink-0">{taskCount}</span>
          )}
          </button>
        </div>

        {/* Hover actions */}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            onClick={handlePlusClick}
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text"
            title="Add to workspace"
          >
            <PlusIcon size={12} />
          </button>
          <button
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setWsMenuPos({ x: rect.right, y: rect.bottom + 4 })
              setWsMenuOpen(true)
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text"
            title="Workspace settings"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="3" r="1.2" fill="currentColor" />
              <circle cx="8" cy="8" r="1.2" fill="currentColor" />
              <circle cx="8" cy="13" r="1.2" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Context menu */}
      {menuOpen && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuOpen(false)}
          items={[
            { icon: 'folder', label: 'New folder', action: 'folder' },
            { icon: 'project', label: 'New project', action: 'project' },
            { icon: 'doc', label: 'New doc', action: 'doc' },
            { icon: 'database', label: 'New database', action: 'database' },
          ]}
          onAction={handleMenuAction}
        />
      )}

      {/* Workspace settings menu */}
      {wsMenuOpen && (
        <ContextMenu
          x={wsMenuPos.x}
          y={wsMenuPos.y}
          onClose={() => setWsMenuOpen(false)}
          items={[
            { icon: 'doc', label: 'Rename', action: 'rename' },
            { icon: 'folder', label: 'Settings', action: 'settings' },
            ...(workspace.slug !== 'my-private' ? [{ icon: 'project', label: 'Delete', action: 'delete' }] : []),
          ]}
          onAction={async (action) => {
            setWsMenuOpen(false)
            if (action === 'rename') {
              setRenameValue(workspace.name)
              setRenaming(true)
            } else if (action === 'settings') {
              window.location.href = `/settings?section=workspace&ws=${workspace.public_id}`
            } else if (action === 'delete') {
              if (confirm(`Delete workspace "${workspace.name}"? This will remove all projects, tasks, and docs inside.`)) {
                await fetch(`/api/workspaces?id=${workspace.public_id || workspace.id}`, { method: 'DELETE' })
                window.location.reload()
              }
            }
          }}
        />
      )}

      {expanded && (
        <div className="ml-1">
          {tree.map((node) => (
            <SidebarItem key={node.id} node={node} depth={0} workspaceId={workspace.id} onRefresh={refreshTree} />
          ))}

          {/* Drop zone to move items to workspace root (only visible while dragging) */}
          {dragOver && (
            <div
              className="min-h-[40px] rounded-md mx-1 transition-colors flex items-center justify-center bg-accent/10 border border-dashed border-accent/30"
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }}
              onDrop={(e) => { e.stopPropagation(); handleDrop(e) }}
            >
              <span className="text-[11px] text-accent-text/60">Drop here to move to root</span>
            </div>
          )}

          {/* Inline add input */}
          {inlineAdd && (
            <InlineAddInput
              type={inlineAdd}
              onSubmit={handleInlineSubmit}
              onCancel={() => setInlineAdd(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function InlineAddInput({
  type,
  onSubmit,
  onCancel,
}: {
  type: 'folder' | 'project' | 'doc' | 'database'
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const icons: Record<string, React.ReactNode> = {
    folder: <FolderIcon />,
    project: <ProjectIcon />,
    doc: <DocIcon />,
    database: <SheetIcon />,
  }
  const placeholders: Record<string, string> = {
    folder: 'Folder name...',
    project: 'Project name...',
    doc: 'Doc title...',
    database: 'Database name...',
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 ml-4">
      <span className="text-text-dim shrink-0">{icons[type]}</span>
      <input
        autoFocus
        placeholder={placeholders[type]}
        className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim min-w-0"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(e.currentTarget.value)
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={(e) => {
          if (e.currentTarget.value.trim()) onSubmit(e.currentTarget.value)
          else onCancel()
        }}
      />
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function ProjectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function SheetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  )
}
