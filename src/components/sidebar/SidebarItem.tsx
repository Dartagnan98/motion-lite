'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { TreeNode } from '@/lib/types'
import { docUrl, projectUrl } from '@/lib/url-utils'
import { PlusIcon } from './Sidebar'
import { ContextMenu } from './ContextMenu'
import { deleteFolderAction, updateFolderAction, updateProjectAction } from '@/lib/actions'

type DropPosition = 'above' | 'inside' | 'below' | null

export function SidebarItem({
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [menuMode, setMenuMode] = useState<'plus' | 'context'>('plus')
  const [inlineAdd, setInlineAdd] = useState<'folder' | 'project' | 'doc' | 'database' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.name)
  const [dropPos, setDropPos] = useState<DropPosition>(null)
  const [copied, setCopied] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const hasChildren = node.children.length > 0

  const isFolder = node.type === 'folder'
  const isProject = node.type === 'project'
  const isDoc = node.type === 'doc'
  const isDatabase = node.type === 'database'

  // numericId still needed for internal API calls (POST/PATCH/DELETE)
  const numericId = node.id.split('-').slice(1).join('-')

  const href = isProject && node.public_id ? projectUrl(node.public_id)
    : isDoc && node.public_id ? docUrl(node.public_id)
    : isDatabase && node.public_id ? `/database/${node.public_id}`
    : undefined
  const isActive = href && pathname === href

  // Recursively check if any descendant is the active page (not just direct children)
  function hasActiveDescendant(children: TreeNode[]): boolean {
    for (const child of children) {
      const cHref = child.type === 'project' && child.public_id ? projectUrl(child.public_id)
        : child.type === 'doc' && child.public_id ? docUrl(child.public_id)
        : child.type === 'database' && child.public_id ? `/database/${child.public_id}`
        : undefined
      if (cHref && pathname === cHref) return true
      if (child.children.length > 0 && hasActiveDescendant(child.children)) return true
    }
    return false
  }

  const hasActiveChild = hasChildren && pathname ? hasActiveDescendant(node.children) : false

  useEffect(() => {
    if (isActive || hasActiveChild) setExpanded(true)
  }, [isActive, hasActiveChild])

  function handleClick() {
    if (isFolder) {
      setExpanded(!expanded)
    } else if (href) {
      router.push(href)
    }
  }

  function handlePlusClick(e: React.MouseEvent) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuPos({ x: rect.right + 4, y: rect.top })
    setMenuMode('plus')
    setMenuOpen(true)
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuMode('context')
    setMenuOpen(true)
  }

  async function handleMenuAction(action: string) {
    setMenuOpen(false)
    if (action === 'folder' || action === 'project' || action === 'doc' || action === 'database') {
      setInlineAdd(action as typeof inlineAdd)
      if (!expanded) setExpanded(true)
    } else if (action === 'rename') {
      setRenaming(true)
      setRenameValue(node.name)
    } else if (action === 'delete') {
      if (isFolder) {
        const formData = new FormData()
        formData.set('id', numericId)
        await deleteFolderAction(formData)
        onRefresh()
      } else if (isProject) {
        await fetch(`/api/projects?id=${numericId}`, { method: 'DELETE' })
        onRefresh()
      } else if (isDoc) {
        await fetch(`/api/docs?id=${numericId}`, { method: 'DELETE' })
        onRefresh()
      } else if (isDatabase) {
        await fetch('/api/sheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete_sheet', sheet_id: Number(numericId) }),
        })
        onRefresh()
      }
    } else if (action === 'moveUp' || action === 'moveDown') {
      const thisSortOrder = (node.data as { sort_order?: number }).sort_order ?? 0
      const newOrder = action === 'moveUp' ? thisSortOrder - 2 : thisSortOrder + 2
      if (isFolder) {
        await fetch('/api/folders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(numericId), sort_order: newOrder }),
        })
      } else if (isProject) {
        await fetch('/api/projects', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(numericId), sort_order: newOrder }),
        })
      } else if (isDoc) {
        await fetch('/api/docs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(numericId), sort_order: newOrder }),
        })
      } else if (isDatabase) {
        await fetch('/api/sheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_sheet', sheet_id: Number(numericId), sort_order: newOrder }),
        })
      }
      onRefresh()
    } else if (action === 'copyLink') {
      if (href) {
        navigator.clipboard.writeText(window.location.origin + href)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } else if (action === 'duplicate') {
      if (isProject) {
        const res = await fetch('/api/projects/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: Number(numericId) }),
        })
        const data = await res.json()
        if (data?.project?.id) {
          onRefresh()
        }
      }
    } else if (action === 'archive') {
      if (isProject) {
        await fetch('/api/projects', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(numericId), status: 'archived' }),
        })
        onRefresh()
      }
    }
  }

  async function handleRename() {
    if (!renameValue.trim() || renameValue === node.name) { setRenaming(false); return }
    const formData = new FormData()
    formData.set('id', numericId)
    formData.set('name', renameValue)
    if (isFolder) await updateFolderAction(formData)
    else if (isProject) await updateProjectAction(formData)
    else if (isDoc) {
      await fetch('/api/docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(numericId), title: renameValue }),
      })
    } else if (isDatabase) {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename_sheet', sheet_id: Number(numericId), name: renameValue }),
      })
    }
    setRenaming(false)
    onRefresh()
  }

  async function handleColorChange(color: string) {
    setMenuOpen(false)
    if (isFolder) {
      // Cascade: update folder + all children
      await fetch('/api/folders/cascade-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(numericId), color }),
      })
    } else if (isProject) {
      await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(numericId), color }),
      })
    } else if (isDoc) {
      await fetch('/api/docs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(numericId), color }),
      })
    } else if (isDatabase) {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_sheet', sheet_id: Number(numericId), color }),
      })
    }
    onRefresh()
  }

  async function handleInlineSubmit(name: string) {
    if (!name.trim()) { setInlineAdd(null); return }
    const parentColor = isFolder ? node.color : undefined
    if (inlineAdd === 'folder' && isFolder) {
      await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, parentId: numericId, name, color: parentColor }),
      })
    } else if (inlineAdd === 'project' && isFolder) {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, folderId: numericId, name, color: parentColor }),
      })
    } else if (inlineAdd === 'doc') {
      const body: Record<string, unknown> = { workspaceId, title: name }
      if (isFolder) body.folderId = numericId
      if (isProject) body.projectId = numericId
      if (parentColor) body.color = parentColor
      const res = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok && parentColor) {
        const doc = await res.json()
        if (doc?.id) await fetch('/api/docs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, color: parentColor }) })
      }
    } else if (inlineAdd === 'database') {
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_sheet',
          name,
          workspace_id: workspaceId,
          folder_id: isFolder ? Number(numericId) : undefined,
        }),
      })
    }
    setInlineAdd(null)
    onRefresh()
  }

  // ─── Drag source ───
  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('application/sidebar-item', JSON.stringify({
      type: node.type,
      id: Number(numericId),
      name: node.name,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  // ─── Drop target ───
  function getDropPosition(e: React.DragEvent): DropPosition {
    if (!rowRef.current) return null
    const rect = rowRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    const h = rect.height
    if (isFolder) {
      if (y < h * 0.25) return 'above'
      if (y > h * 0.75) return 'below'
      return 'inside'
    }
    return y < h * 0.5 ? 'above' : 'below'
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropPos(getDropPosition(e))
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    setDropPos(getDropPosition(e))
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    if (rowRef.current && !rowRef.current.contains(e.relatedTarget as Node)) {
      setDropPos(null)
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const pos = getDropPosition(e)
    setDropPos(null)

    const raw = e.dataTransfer.getData('application/sidebar-item')
    if (!raw) return
    const item = JSON.parse(raw)

    if (item.type === node.type && item.id === Number(numericId)) return

    const thisSortOrder = (node.data as { sort_order?: number }).sort_order ?? 0

    if (pos === 'inside' && isFolder) {
      await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: item.type,
          id: item.id,
          targetFolderId: Number(numericId),
          sortOrder: 9999,
        }),
      })
      if (!expanded) setExpanded(true)
    } else {
      const parentFolderId = isFolder
        ? (node.data as { parent_id?: number }).parent_id || null
        : (node.data as { folder_id?: number }).folder_id || null

      const sortOrder = pos === 'above' ? thisSortOrder - 1 : thisSortOrder + 1

      await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: item.type,
          id: item.id,
          targetFolderId: parentFolderId,
          sortOrder,
        }),
      })
    }

    onRefresh()
  }

  // ─── Menu items ───
  // Plus menu: creation actions
  const plusMenuItems = isFolder
    ? [
        { icon: 'folder', label: 'New folder', action: 'folder' },
        { icon: 'project', label: 'New project', action: 'project' },
        { icon: 'doc', label: 'New doc', action: 'doc' },
        { icon: 'database', label: 'New database', action: 'database' },
      ]
    : isProject
    ? [
        { icon: 'doc', label: 'New doc', action: 'doc' },
      ]
    : []

  // Right-click context menu: color grid + full action list
  const contextMenuItems = isFolder
    ? [
        { icon: 'rename', label: 'Rename', action: 'rename' },
        { icon: 'copy', label: 'Copy link', action: 'copyLink' },
        { icon: 'moveUp', label: 'Move up', action: 'moveUp' },
        { icon: 'moveDown', label: 'Move down', action: 'moveDown' },
        { icon: 'delete', label: 'Delete', action: 'delete', danger: true },
      ]
    : isProject
    ? [
        { icon: 'rename', label: 'Rename', action: 'rename' },
        { icon: 'copy', label: 'Copy link', action: 'copyLink' },
        { icon: 'duplicate', label: 'Duplicate', action: 'duplicate' },
        { icon: 'moveUp', label: 'Move up', action: 'moveUp' },
        { icon: 'moveDown', label: 'Move down', action: 'moveDown' },
        { icon: 'archive', label: 'Archive', action: 'archive' },
        { icon: 'delete', label: 'Delete', action: 'delete', danger: true },
      ]
    : isDoc
    ? [
        { icon: 'rename', label: 'Rename', action: 'rename' },
        { icon: 'copy', label: 'Copy link', action: 'copyLink' },
        { icon: 'moveUp', label: 'Move up', action: 'moveUp' },
        { icon: 'moveDown', label: 'Move down', action: 'moveDown' },
        { icon: 'delete', label: 'Delete', action: 'delete', danger: true },
      ]
    : isDatabase
    ? [
        { icon: 'rename', label: 'Rename', action: 'rename' },
        { icon: 'copy', label: 'Copy link', action: 'copyLink' },
        { icon: 'moveUp', label: 'Move up', action: 'moveUp' },
        { icon: 'moveDown', label: 'Move down', action: 'moveDown' },
        { icon: 'delete', label: 'Delete', action: 'delete', danger: true },
      ]
    : []

  const icons: Record<string, React.ReactNode> = {
    folder: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
    project: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
    doc: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
    database: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </svg>
    ),
  }

  const isDraggable = isFolder || isProject || isDoc || isDatabase
  const indent = depth * 20

  return (
    <div className="relative">
      {/* Drop indicator line - above */}
      {dropPos === 'above' && (
        <div
          className="absolute top-0 right-1 h-[2px] bg-accent rounded-full z-10"
          style={{ left: `${indent}px` }}
        >
          <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-accent" />
        </div>
      )}

      <div
        ref={rowRef}
        className={`group flex w-full items-center rounded-full transition-all duration-150 ${
          isActive ? 'text-white'
          : dropPos === 'inside' ? 'bg-accent/20 ring-1 ring-accent/40'
          : 'hover:bg-white/[0.05]'
        }`}
        style={isActive ? {
          background: 'linear-gradient(135deg, rgba(241,237,229,0.22) 0%, rgba(241,237,229,0.12) 100%)',
          boxShadow: '0 0 0 1px rgba(241,237,229,0.25), 0 1px 8px rgba(241,237,229,0.12)',
          paddingLeft: `${indent}px`,
        } : { paddingLeft: `${indent}px` }}
        draggable={isDraggable}
        onDragStart={handleDragStart}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
      >
        {/* Drag handle dots - visible on hover */}
        <span className={`shrink-0 w-4 flex items-center justify-center cursor-grab active:cursor-grabbing ${isActive ? 'text-text-dim' : 'text-transparent group-hover:text-text-dim'} transition-colors`}>
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.2" />
            <circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" />
            <circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" />
            <circle cx="6" cy="12" r="1.2" />
          </svg>
        </span>

        <button
          onClick={handleClick}
          className={`flex flex-1 items-center gap-2 h-[30px] pr-1 text-[14px] font-medium min-w-0 text-left ${
            isActive ? 'text-text' : 'text-text-secondary hover:text-text'
          }`}
        >
          {/* Chevron */}
          {hasChildren || isFolder ? (
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`shrink-0 transition-transform text-text-dim ${expanded ? 'rotate-90' : ''}`}
            >
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="w-[10px] shrink-0" />
          )}

          {/* Icon */}
          <span className="shrink-0" style={{ color: node.color }}>
            {icons[node.type]}
          </span>

          {/* Name */}
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false) }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-transparent text-[13px] text-text outline-none min-w-0 border-b border-accent"
            />
          ) : (
            <span className="truncate">{node.name || (isDoc ? 'Untitled Doc' : node.name)}</span>
          )}

          {/* Project health indicator */}
          {isProject && (node.data as any)?.health && (() => {
            const h = (node.data as any).health as string
            const colors: Record<string, string> = { green: 'var(--green)', yellow: 'var(--gold)', red: 'var(--red)' }
            const labels: Record<string, string> = { green: 'on track', yellow: 'has tasks due soon', red: 'has overdue tasks' }
            return <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colors[h] }} title={`Project ${labels[h]}`} />
          })()}
          {/* Count */}
          {node.itemCount > 0 && (
            <span className="text-[10px] text-text-dim shrink-0">{node.itemCount}</span>
          )}
          {/* Copied toast */}
          {copied && (
            <span className="text-[10px] text-accent shrink-0 animate-pulse">Copied!</span>
          )}
        </button>

        {/* Hover actions: three-dot menu + plus */}
        <span className={`flex items-center gap-0.5 shrink-0 mr-1 ${isActive ? 'flex' : 'hidden group-hover:flex'}`}>
          <button
            onClick={(e) => { e.stopPropagation(); handleContextMenu(e) }}
            className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:text-text hover:bg-border/50 transition-colors"
            title="More actions"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="4" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="12" cy="8" r="1.5" />
            </svg>
          </button>
          {(isFolder || isProject) && (
            <button
              onClick={handlePlusClick}
              className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:text-text hover:bg-border/50 transition-colors"
              title="Add"
            >
              <PlusIcon size={11} />
            </button>
          )}
        </span>
      </div>

      {/* Drop indicator line - below */}
      {dropPos === 'below' && (
        <div
          className="absolute bottom-0 right-1 h-[2px] bg-accent rounded-full z-10"
          style={{ left: `${indent}px` }}
        >
          <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-accent" />
        </div>
      )}

      {/* Context menu */}
      {menuOpen && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuOpen(false)}
          items={menuMode === 'plus' ? plusMenuItems : contextMenuItems}
          onAction={handleMenuAction}
          showColors={menuMode === 'context' && (isFolder || isProject || isDoc || isDatabase)}
          currentColor={node.color}
          onColorChange={handleColorChange}
        />
      )}

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <SidebarItem key={child.id} node={child} depth={depth + 1} workspaceId={workspaceId} onRefresh={onRefresh} />
          ))}
        </div>
      )}

      {/* Inline add */}
      {expanded && inlineAdd && (
        <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: `${24 + depth * 16}px` }}>
          <span className="text-text-dim shrink-0">
            {inlineAdd === 'folder' ? icons.folder : inlineAdd === 'project' ? icons.project : inlineAdd === 'database' ? icons.database : icons.doc}
          </span>
          <input
            autoFocus
            placeholder={inlineAdd === 'folder' ? 'Folder name...' : inlineAdd === 'project' ? 'Project name...' : inlineAdd === 'database' ? 'Database name...' : 'Doc title...'}
            className="flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-dim min-w-0"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleInlineSubmit(e.currentTarget.value)
              if (e.key === 'Escape') setInlineAdd(null)
            }}
            onBlur={(e) => {
              if (e.currentTarget.value.trim()) handleInlineSubmit(e.currentTarget.value)
              else setInlineAdd(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
