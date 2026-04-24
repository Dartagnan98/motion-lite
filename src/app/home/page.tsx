'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { IconChevronDown, IconChevronRight } from '@/components/ui/Icons'

interface RecentItem {
  type: 'task' | 'project' | 'doc'
  id: number
  public_id?: string
  title: string
  color?: string
}

interface FolderNode {
  id: number
  public_id?: string
  name: string
  color: string
  subFolders?: FolderNode[]
  projects: { id: number; public_id?: string; name: string; color: string; taskCount: number }[]
  docs?: { id: number; public_id?: string; title: string }[]
}

interface SheetNode {
  id: number
  public_id?: string
  name: string
  color: string
}

interface WorkspaceTree {
  id: number
  name: string
  color: string
  taskCount: number
  folders: FolderNode[]
  projects: { id: number; public_id?: string; name: string; color: string; taskCount: number }[]
  sheets: SheetNode[]
  docs: { id: number; public_id?: string; title: string }[]
}

const TYPE_BG: Record<string, string> = {
  task: 'rgba(66, 165, 245, 0.12)',
  project: 'rgba(179, 136, 255, 0.12)',
  doc: 'rgba(0, 230, 118, 0.12)',
}

function TypeIcon({ type, color }: { type: string; color?: string }) {
  const c = color || (type === 'task' ? 'var(--blue)' : type === 'project' ? 'var(--purple)' : 'var(--green)')
  if (type === 'task') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12l3 3 5-5" />
    </svg>
  )
  if (type === 'project') return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L22 8.5v7L12 22 2 15.5v-7L12 2z" />
    </svg>
  )
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

function FolderRow({ folder, depth, expandedFolders, setExpandedFolders, router }: {
  folder: FolderNode; depth: number;
  expandedFolders: Set<number>; setExpandedFolders: React.Dispatch<React.SetStateAction<Set<number>>>;
  router: ReturnType<typeof useRouter>;
}) {
  const isExpanded = expandedFolders.has(folder.id)
  const hasContent = (folder.projects?.length > 0) || (folder.subFolders && folder.subFolders.length > 0) || (folder.docs && folder.docs.length > 0)
  const paddingLeft = 16 + depth * 20

  return (
    <div>
      <button
        onClick={() => setExpandedFolders(prev => {
          const next = new Set(prev)
          next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id)
          return next
        })}
        className="w-full flex items-center gap-3 py-3 border-t border-border/30"
        style={{ paddingLeft, paddingRight: 16 }}
      >
        {hasContent ? (
          <IconChevronDown size={12} className={`text-text-dim shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
        ) : (
          <div className="w-3 shrink-0" />
        )}
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke={folder.color || 'currentColor'} strokeWidth="1.3" />
        </svg>
        <span className="text-[14px] text-text flex-1 text-left truncate">{folder.name}</span>
      </button>

      {isExpanded && (
        <>
          {/* Sub-folders */}
          {folder.subFolders?.map(sf => (
            <FolderRow key={sf.id} folder={sf} depth={depth + 1} expandedFolders={expandedFolders} setExpandedFolders={setExpandedFolders} router={router} />
          ))}
          {/* Projects in this folder */}
          {folder.projects?.map(proj => (
            <button
              key={proj.id}
              onClick={() => router.push(`/project/${proj.public_id || proj.id}`)}
              className="w-full flex items-center gap-3 py-3 border-t border-border/30 active:bg-hover/50"
              style={{ paddingLeft: paddingLeft + 32, paddingRight: 16 }}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke={proj.color || 'var(--accent)'} strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke={proj.color || 'var(--accent)'} strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              <span className="text-[14px] text-text flex-1 text-left truncate">{proj.name}</span>
              {proj.taskCount > 0 && <span className="text-[13px] text-text-dim">{proj.taskCount}</span>}
              <IconChevronRight size={16} className="text-text-dim shrink-0" />
            </button>
          ))}
          {/* Docs in this folder */}
          {folder.docs?.map(doc => (
            <button
              key={doc.id}
              onClick={() => router.push(`/doc/${doc.public_id || doc.id}`)}
              className="w-full flex items-center gap-3 py-3 border-t border-border/30 active:bg-hover/50"
              style={{ paddingLeft: paddingLeft + 32, paddingRight: 16 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="var(--text-dim)" strokeWidth="1.5" />
                <path d="M14 2v6h6" stroke="var(--text-dim)" strokeWidth="1.5" />
              </svg>
              <span className="text-[14px] text-text flex-1 text-left truncate">{doc.title}</span>
              <IconChevronRight size={16} className="text-text-dim shrink-0" />
            </button>
          ))}
        </>
      )}
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const [recents, setRecents] = useState<RecentItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceTree[]>([])
  const [expandedWs, setExpandedWs] = useState<Set<number>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
  const [user, setUser] = useState<{ name?: string; avatar_url?: string } | null>(null)

  useEffect(() => {
    fetch('/api/tasks?recent=1&limit=8')
      .then(r => r.json())
      .then(d => {
        const tasks = (d.tasks || []) as Array<{ id: number; title: string; status: string; updated_at: number; project_color?: string }>
        const recent = tasks.map(t => ({ type: 'task' as const, id: t.id, title: t.title, color: t.project_color }))
        setRecents(recent)
      })
      .catch(err => console.error('Failed to load recent tasks:', err))

    fetch('/api/sidebar')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) {
          setWorkspaces(d)
          if (d.length > 0) setExpandedWs(new Set([d[0].id]))
        }
      })
      .catch(err => console.error('Failed to load workspaces:', err))

    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser({ name: d.user.name, avatar_url: d.user.avatar_url }) }).catch(err => console.error('Failed to load user:', err))
  }, [])

  return (
    <div className="h-full overflow-auto pb-28">
      {/* Header: avatar + search */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <Avatar name={user?.name || 'Operator'} size={44} src={user?.avatar_url} />
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-search'))}
          className="flex-1 flex items-center gap-2.5 glass-card !rounded-md px-4 py-3"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-dim">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span className="text-[14px] text-text-dim">Search</span>
        </button>
      </div>

      {/* Recent */}
      {recents.length > 0 && (
        <div className="mb-5 px-5">
          <h2 className="text-[14px] font-semibold text-text-dim uppercase tracking-wider mb-3">Recent</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {recents.slice(0, 6).map(item => (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => {
                  if (item.type === 'task') {
                    window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: item.id } }))
                  } else if (item.type === 'project') {
                    router.push(`/project/${item.public_id || item.id}`)
                  } else {
                    router.push(`/doc/${item.public_id || item.id}`)
                  }
                }}
                className="glass-card !rounded-md px-3.5 py-3 flex items-center gap-3 active:scale-[0.98] transition-transform text-left"
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: TYPE_BG[item.type] }}>
                  <TypeIcon type={item.type} color={item.color} />
                </div>
                <span className="text-[14px] text-text font-medium truncate leading-tight">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI Meeting Notes */}
      <div className="px-5 mb-5">
        <button
          onClick={() => router.push('/meeting-notes')}
          className="w-full glass-card !rounded-md px-4 py-4 flex items-center gap-4 active:scale-[0.99] transition-transform"
        >
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M9 15l2 2 4-4" />
            </svg>
          </div>
          <span className="text-[14px] font-medium text-text flex-1 text-left">AI Meeting Notes</span>
          <IconChevronRight size={18} className="text-text-dim shrink-0" />
        </button>
      </div>

      {/* Workspaces */}
      <div className="px-5">
        <h2 className="text-[14px] font-semibold text-text-dim uppercase tracking-wider mb-3">Workspaces</h2>
        <div className="space-y-3 stagger-children">
          {workspaces.map(ws => (
            <div key={ws.id} className="glass-card !rounded-md overflow-hidden">
              {/* Workspace header */}
              <button
                onClick={() => setExpandedWs(prev => {
                  const next = new Set(prev)
                  next.has(ws.id) ? next.delete(ws.id) : next.add(ws.id)
                  return next
                })}
                className="w-full flex items-center gap-3 px-4 py-3.5"
              >
                <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: ws.color || 'var(--accent)' }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="2" width="12" height="12" rx="3" stroke="white" strokeWidth="1.5" />
                  </svg>
                </div>
                <span className="text-[14px] font-semibold text-text flex-1 text-left">{ws.name}</span>
                <span className="text-[13px] text-text-dim mr-1">{ws.taskCount}</span>
                <IconChevronDown size={16} className={`text-text-dim shrink-0 transition-transform ${expandedWs.has(ws.id) ? '' : '-rotate-90'}`} />
              </button>

              {expandedWs.has(ws.id) && (
                <div className="border-t border-border/50">
                  {/* Folders (recursive) */}
                  {ws.folders?.map(folder => (
                    <FolderRow key={folder.id} folder={folder} depth={0} expandedFolders={expandedFolders} setExpandedFolders={setExpandedFolders} router={router} />
                  ))}

                  {/* Root projects */}
                  {ws.projects?.map(proj => (
                    <button
                      key={proj.id}
                      onClick={() => router.push(`/project/${proj.public_id || proj.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 border-t border-border/30 active:bg-hover/50"
                    >
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0 ml-2">
                        <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke={proj.color || 'var(--accent)'} strokeWidth="1.3" strokeLinejoin="round" />
                        <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke={proj.color || 'var(--accent)'} strokeWidth="1.3" strokeLinejoin="round" />
                      </svg>
                      <span className="text-[14px] text-text flex-1 text-left truncate">{proj.name}</span>
                      {proj.taskCount > 0 && <span className="text-[13px] text-text-dim">{proj.taskCount}</span>}
                      <IconChevronRight size={16} className="text-text-dim shrink-0" />
                    </button>
                  ))}

                  {/* Root docs */}
                  {ws.docs?.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => router.push(`/doc/${doc.public_id || doc.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 border-t border-border/30 active:bg-hover/50"
                    >
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0 ml-2">
                        <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="var(--text-dim)" strokeWidth="1.3" />
                        <path d="M9 2v4h4" stroke="var(--text-dim)" strokeWidth="1.3" />
                      </svg>
                      <span className="text-[14px] text-text flex-1 text-left truncate">{doc.title || 'Untitled'}</span>
                      <IconChevronRight size={16} className="text-text-dim shrink-0" />
                    </button>
                  ))}

                  {/* Root sheets */}
                  {ws.sheets?.map(sheet => (
                    <button
                      key={sheet.id}
                      onClick={() => router.push(`/database/${sheet.public_id || sheet.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 border-t border-border/30 active:bg-hover/50"
                    >
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="shrink-0 ml-2">
                        <rect x="2" y="2" width="12" height="12" rx="1.5" stroke={sheet.color || 'var(--text-dim)'} strokeWidth="1.3" />
                        <path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke={sheet.color || 'var(--text-dim)'} strokeWidth="1" opacity="0.5" />
                      </svg>
                      <span className="text-[14px] text-text flex-1 text-left truncate">{sheet.name}</span>
                      <IconChevronRight size={16} className="text-text-dim shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
