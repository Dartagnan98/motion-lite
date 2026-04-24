'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDown, IconCheck } from '@/components/ui/Icons'
import { popupSurfaceDataProps, stopPopupMouseDown, withPopupSurfaceClassName } from '@/lib/popup-surface'

// ─── Types ───

export type SidebarProject = {
  id: number
  name: string
  color?: string | null
}

export type SidebarFolder = {
  id: number
  name: string
  color?: string | null
  subFolders?: SidebarFolder[]
  projects?: SidebarProject[]
}

export type SidebarWorkspace = {
  id: number
  name: string
  color?: string | null
  projects: SidebarProject[]
  folders: SidebarFolder[]
}

type ProjectLocation = {
  workspaceId: number
  workspaceName: string
  projectId: number
  projectName: string
  folderIds: number[]
}

export interface ProjectPickerProps {
  currentProjectId?: number | null
  currentProjectName?: string | null
  currentWorkspaceId?: number | null
  currentWorkspaceName?: string | null
  workspaces: SidebarWorkspace[]
  onSelect: (project: { id: number; name: string; workspaceId: number; workspaceName: string }) => Promise<void> | void
  compact?: boolean
}

// ─── Helpers ───

export function findProjectLocation(workspaces: SidebarWorkspace[], projectId: number | null | undefined): ProjectLocation | null {
  if (!projectId) return null

  const visitFolder = (workspace: SidebarWorkspace, folder: SidebarFolder, parentFolderIds: number[]): ProjectLocation | null => {
    const folderIds = [...parentFolderIds, folder.id]
    const directProject = (folder.projects || []).find(project => project.id === projectId)
    if (directProject) {
      return {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        projectId: directProject.id,
        projectName: directProject.name,
        folderIds,
      }
    }
    for (const subFolder of folder.subFolders || []) {
      const found = visitFolder(workspace, subFolder, folderIds)
      if (found) return found
    }
    return null
  }

  for (const workspace of workspaces) {
    const rootProject = workspace.projects.find(project => project.id === projectId)
    if (rootProject) {
      return {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        projectId: rootProject.id,
        projectName: rootProject.name,
        folderIds: [],
      }
    }
    for (const folder of workspace.folders || []) {
      const found = visitFolder(workspace, folder, [])
      if (found) return found
    }
  }

  return null
}

// ─── Icons ───

const WorkspaceIcon = ({ color, className = '' }: { color?: string; className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={`shrink-0 ${className}`} style={{ color: color || undefined }}>
    <path d="M8 1L1 5.5l7 4.5 7-4.5L8 1zM1 8l7 4.5L15 8" />
  </svg>
)

const FolderIcon = ({ color, className = '' }: { color?: string; className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 ${className}`} style={{ color: color || undefined }}>
    <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

const ProjectIcon = ({ color, className = '' }: { color?: string; className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`shrink-0 ${className}`} style={{ color: color || '#666' }}>
    <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

// ─── Component ───

export function ProjectPicker({
  currentProjectId,
  currentProjectName,
  currentWorkspaceId,
  currentWorkspaceName,
  workspaces,
  onSelect,
  compact,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [expandedWs, setExpandedWs] = useState<Set<number>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
  const [savingProjectId, setSavingProjectId] = useState<number | null>(null)

  const currentLocation = useMemo(
    () => findProjectLocation(workspaces, currentProjectId) || null,
    [workspaces, currentProjectId]
  )

  const currentProjectColor = useMemo(() => {
    if (!currentProjectId) return undefined

    const findInFolders = (folders: SidebarFolder[]): string | undefined => {
      for (const folder of folders) {
        const direct = (folder.projects || []).find(project => project.id === currentProjectId)
        if (direct) return direct.color || undefined
        const nested = findInFolders(folder.subFolders || [])
        if (nested) return nested
      }
      return undefined
    }

    for (const workspace of workspaces) {
      const direct = workspace.projects.find(project => project.id === currentProjectId)
      if (direct) return direct.color || undefined
      const nested = findInFolders(workspace.folders)
      if (nested) return nested
    }

    return undefined
  }, [workspaces, currentProjectId])

  const displayWorkspaceName = currentLocation?.workspaceName
    || currentWorkspaceName
    || workspaces.find(ws => ws.id === currentWorkspaceId)?.name
    || 'Workspace'

  const normalizedFilter = filter.trim().toLowerCase()
  const matchesText = useCallback((value: string) => value.toLowerCase().includes(normalizedFilter), [normalizedFilter])

  useEffect(() => {
    if (!open) return
    const nextExpandedWs = new Set<number>()
    const nextExpandedFolders = new Set<number>()
    const workspaceIdToExpand = currentLocation?.workspaceId || currentWorkspaceId || null
    if (workspaceIdToExpand) nextExpandedWs.add(workspaceIdToExpand)
    for (const folderId of currentLocation?.folderIds || []) nextExpandedFolders.add(folderId)
    setExpandedWs(prev => new Set([...prev, ...nextExpandedWs]))
    setExpandedFolders(prev => new Set([...prev, ...nextExpandedFolders]))
  }, [open, currentLocation, currentWorkspaceId])

  const folderHasMatch = useCallback((folder: SidebarFolder): boolean => {
    if (!normalizedFilter) return true
    if (matchesText(folder.name)) return true
    if ((folder.projects || []).some(project => matchesText(project.name))) return true
    return (folder.subFolders || []).some(subFolder => folderHasMatch(subFolder))
  }, [normalizedFilter, matchesText])

  const workspaceHasMatch = useCallback((workspace: SidebarWorkspace): boolean => {
    if (!normalizedFilter) return true
    if (matchesText(workspace.name)) return true
    if (workspace.projects.some(project => matchesText(project.name))) return true
    return workspace.folders.some(folder => folderHasMatch(folder))
  }, [normalizedFilter, matchesText, folderHasMatch])

  const visibleWorkspaces = useMemo(
    () => workspaces.filter(workspace => workspaceHasMatch(workspace)),
    [workspaces, workspaceHasMatch]
  )

  const handleSelect = async (project: { id: number; name: string; workspaceId: number; workspaceName: string }) => {
    if (savingProjectId !== null) return
    setSavingProjectId(project.id)
    try {
      await onSelect(project)
      setOpen(false)
      setFilter('')
    } finally {
      setSavingProjectId(null)
    }
  }

  const renderFolderTree = (workspace: SidebarWorkspace, folders: SidebarFolder[], depth = 0): React.ReactNode => (
    <>
      {folders.map(folder => {
        if (!folderHasMatch(folder)) return null
        const isExpanded = normalizedFilter ? true : expandedFolders.has(folder.id)
        const hasChildren = (folder.subFolders?.length || 0) > 0 || (folder.projects?.length || 0) > 0

        return (
          <div key={`folder-${folder.id}`}>
            <button
              type="button"
              onClick={() => {
                if (!hasChildren) return
                setExpandedFolders(prev => {
                  const next = new Set(prev)
                  if (next.has(folder.id)) next.delete(folder.id)
                  else next.add(folder.id)
                  return next
                })
              }}
              className="flex w-full items-center gap-2 py-1.5 text-[13px] text-left text-text hover:bg-hover transition-colors"
              style={{ paddingLeft: 28 + depth * 16 }}
            >
              {hasChildren && (
                <IconChevronDown size={8} strokeWidth={3} className={`text-text-dim shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
              )}
              {!hasChildren && <span className="w-2 shrink-0" />}
              <FolderIcon color={folder.color || undefined} />
              <span className="truncate text-text">{folder.name}</span>
            </button>

            {isExpanded && (
              <>
                {(folder.projects || []).filter(project => !normalizedFilter || matchesText(project.name)).map(project => (
                  <button
                    key={`project-${project.id}`}
                    type="button"
                    onClick={() => handleSelect({ id: project.id, name: project.name, workspaceId: workspace.id, workspaceName: workspace.name })}
                    disabled={savingProjectId !== null}
                    className={`flex w-full items-center gap-2 py-1.5 text-[13px] text-left transition-colors ${
                      currentProjectId === project.id ? 'text-text bg-hover' : 'text-text hover:bg-hover'
                    }`}
                    style={{ paddingLeft: 44 + depth * 16 }}
                  >
                    <ProjectIcon color={project.color || undefined} />
                    <span className="truncate text-text">{project.name}</span>
                    {currentProjectId === project.id && (
                      <IconCheck size={12} strokeWidth={2.5} className="ml-auto text-accent-text" />
                    )}
                  </button>
                ))}
                {renderFolderTree(workspace, folder.subFolders || [], depth + 1)}
              </>
            )}
          </div>
        )
      })}
    </>
  )

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setFilter('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const textSize = compact ? 'text-[11px]' : 'text-[13px]'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen(!open); setFilter('') }}
        className={`flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-hover/70 hover:text-text transition-colors ${textSize}`}
      >
        {compact ? (
          <>
            <WorkspaceIcon className="opacity-60" />
            <span className="opacity-60">... /</span>
            <ProjectIcon color={currentProjectColor} />
            <span>{currentProjectName || 'No project'}</span>
          </>
        ) : (
          <>
            <WorkspaceIcon className="text-text-dim opacity-60" />
            <span className="opacity-60">{displayWorkspaceName} / ... /</span>
            <ProjectIcon color={currentProjectColor} />
            <span>{currentProjectName || 'No project'}</span>
          </>
        )}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          {...popupSurfaceDataProps}
          ref={dropdownRef}
          className={withPopupSurfaceClassName('fixed w-[320px] bg-elevated border border-border rounded-lg shadow-2xl py-1')}
          style={{ top: pos.top, left: pos.left, zIndex: 9999 }}
          onMouseDown={stopPopupMouseDown}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-2.5 py-1.5 border-b border-border/60">
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter..."
              className="w-full bg-transparent text-[12px] text-text placeholder:text-text-dim outline-none"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {visibleWorkspaces.map(workspace => {
              const isExpanded = normalizedFilter ? true : expandedWs.has(workspace.id)
              const hasChildren = workspace.projects.length > 0 || workspace.folders.length > 0

              return (
                <div key={`workspace-${workspace.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!hasChildren) return
                      setExpandedWs(prev => {
                        const next = new Set(prev)
                        if (next.has(workspace.id)) next.delete(workspace.id)
                        else next.add(workspace.id)
                        return next
                      })
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-left text-text hover:bg-hover transition-colors"
                  >
                    <IconChevronDown size={8} strokeWidth={3} className={`text-text-dim shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    <WorkspaceIcon color={workspace.color || undefined} />
                    <span className="truncate text-text">{workspace.name}</span>
                  </button>

                  {isExpanded && (
                    <>
                      {workspace.projects.filter(project => !normalizedFilter || matchesText(project.name)).map(project => (
                        <button
                          key={`root-project-${project.id}`}
                          type="button"
                          onClick={() => handleSelect({ id: project.id, name: project.name, workspaceId: workspace.id, workspaceName: workspace.name })}
                          disabled={savingProjectId !== null}
                          className={`flex w-full items-center gap-2 py-1.5 text-[13px] text-left transition-colors ${
                            currentProjectId === project.id ? 'text-text bg-hover/80' : 'text-text hover:bg-hover/70'
                          }`}
                          style={{ paddingLeft: 44 }}
                        >
                          <ProjectIcon color={project.color || undefined} />
                          <span className="truncate text-text">{project.name}</span>
                          {currentProjectId === project.id && (
                            <IconCheck size={12} strokeWidth={2.5} className="ml-auto text-accent-text" />
                          )}
                        </button>
                      ))}
                      {renderFolderTree(workspace, workspace.folders)}
                    </>
                  )}
                </div>
              )
            })}

            {visibleWorkspaces.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-text-dim">No matching projects</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
