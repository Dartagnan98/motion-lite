'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { KeyboardShortcuts } from '@/components/ui/KeyboardShortcuts'

// Detect Tauri desktop app and add class for CSS traffic-light padding
if (typeof window !== 'undefined' && ((window as any).__TAURI__ || (window as any).__NATIVE_APP__ || navigator.userAgent.includes('Tauri'))) {
  document.documentElement.classList.add('is-tauri')
}
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel'
import { MobileNav } from '@/components/MobileNav'
import { NotificationsBell } from '@/components/notifications/NotificationsBell'
import { InboxBell } from '@/components/inbox/InboxBell'
import { RightSidebar } from '@/components/appshell/RightSidebar'
// ChatBubble removed - AI chat consolidated into DMs
import type { Workspace } from '@/lib/types'

// ── Tab types & context ──────────────────────────────────────────────
interface Tab { id: string; path: string; label: string; icon: string }
interface BreadcrumbItem { label: string; icon?: string; href?: string }
interface TabCtx {
  tabs: Tab[]
  activeTabId: string
  openTab: (path: string, label?: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setTabInfo: (label: string, icon?: string) => void
  breadcrumbs: BreadcrumbItem[]
  setBreadcrumbs: (items: BreadcrumbItem[]) => void
}
const TabContext = createContext<TabCtx | null>(null)
export function useTabContext() { return useContext(TabContext) }
let _tabId = 0

const PAGE_META: Record<string, { label: string; icon: string }> = {
  '/schedule': { label: 'Calendar', icon: 'calendar' },
  '/dashboard': { label: 'Dashboard', icon: 'dashboard' },
  '/projects-tasks': { label: 'Projects & Tasks', icon: 'projects' },
  '/settings': { label: 'Settings', icon: 'settings' },
  '/messages': { label: 'Messages', icon: 'page' },
  '/agents': { label: 'Agents', icon: 'page' },
  '/clients': { label: 'Clients', icon: 'page' },
  '/ads': { label: 'Ads', icon: 'page' },
  '/inbox': { label: 'Inbox', icon: 'page' },
  '/crm': { label: 'CRM', icon: 'page' },
  '/crm/inbox': { label: 'Inbox', icon: 'page' },
  '/crm/campaigns': { label: 'Campaigns', icon: 'page' },
  '/memory': { label: 'Memory', icon: 'page' },
  '/brain': { label: 'Brain', icon: 'page' },
  '/skills': { label: 'Skills', icon: 'page' },
  '/database': { label: 'Database', icon: 'page' },
  '/meeting-notes': { label: 'Meeting Notes', icon: 'page' },
  '/agenda': { label: 'Agenda', icon: 'page' },
  '/chat': { label: 'Chat', icon: 'page' },
}
function getDefaultLabel(p: string) {
  if (PAGE_META[p]) return PAGE_META[p].label
  if (p.startsWith('/project/')) return 'Project'
  if (p.startsWith('/doc/')) return 'Doc'
  if (p.startsWith('/database/')) return 'Database'
  return 'Page'
}
function getDefaultIcon(p: string) {
  if (PAGE_META[p]) return PAGE_META[p].icon
  if (p.startsWith('/project/')) return 'project'
  if (p.startsWith('/doc/')) return 'doc'
  return 'page'
}

// ── Icons ────────────────────────────────────────────────────────────
const TAB_ICONS: Record<string, React.ReactNode> = {
  calendar: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  dashboard: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="2" y="9" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" /><rect x="9" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg>,
  projects: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
  project: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
  settings: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  doc: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" /><path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" /></svg>,
  workspace: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 8.5l10 6.5 10-6.5L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M2 12l10 6.5L22 12" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M2 15.5l10 6.5 10-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>,
  folder: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 2h5A1.5 1.5 0 0114 6.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3" /></svg>,
  page: <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
}

// ── AppShell ─────────────────────────────────────────────────────────
// Keys for localStorage persistence
const TABS_STORAGE_KEY = 'ctrl-tabs'
const ACTIVE_TAB_STORAGE_KEY = 'ctrl-active-tab'

function loadPersistedTabs(fallbackPath: string): { tabs: Tab[]; activeId: string } {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY)
    const activeId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Tab[]
      if (parsed.length > 0) {
        // Update _tabId to avoid collisions
        for (const t of parsed) {
          const num = parseInt(t.id.replace('t', ''))
          if (num > _tabId) _tabId = num
        }
        return { tabs: parsed, activeId: activeId || parsed[0].id }
      }
    }
  } catch { /* ignore */ }
  const id = `t${++_tabId}`
  return { tabs: [{ id, path: fallbackPath, label: getDefaultLabel(fallbackPath), icon: getDefaultIcon(fallbackPath) }], activeId: id }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isLogin = pathname === '/login'
  const isPublished = pathname?.startsWith('/published')
  const isPortal = pathname?.startsWith('/portal')
  const isPublicContent = pathname?.startsWith('/blog') || pathname?.startsWith('/pages')
  const isHelp = pathname === '/help' || pathname?.startsWith('/help/')
  const isStandalone = isPublished || isPortal || isPublicContent || isHelp || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('standalone'))
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loaded, setLoaded] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])

  // Tab state - persisted to localStorage
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const p = pathname || '/schedule'
    if (typeof window === 'undefined') {
      const id = `t${++_tabId}`
      return [{ id, path: p, label: getDefaultLabel(p), icon: getDefaultIcon(p) }]
    }
    return loadPersistedTabs(p).tabs
  })
  const [activeTabId, setActiveTabId] = useState(() => {
    if (typeof window === 'undefined') return tabs[0].id
    return loadPersistedTabs(pathname || '/schedule').activeId
  })
  const [globalTaskId, setGlobalTaskId] = useState<number | null>(null)
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable')
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')

  // Persist tabs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs))
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId)
    } catch { /* ignore */ }
  }, [tabs, activeTabId])

  // Fetch display density + theme settings
  useEffect(() => {
    if (isLogin || isPortal) return
    fetch('/api/settings').then(r => r.json()).then(s => {
      if (s.displayDensity === 'compact' || s.displayDensity === 'comfortable') setDensity(s.displayDensity)
      if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'system') setTheme(s.theme)
    }).catch(() => {})
  }, [isLogin, isPortal])

  // Apply theme to document
  useEffect(() => {
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme
    document.documentElement.setAttribute('data-theme', resolved)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f5f3ef' : '#131412')

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const handler = (e: MediaQueryListEvent) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'light' : 'dark')
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', e.matches ? '#f5f3ef' : '#131412')
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  // Global listener for open-task-detail events from any page
  useEffect(() => {
    function handleOpenTask(e: Event) {
      const taskId = (e as CustomEvent).detail?.taskId
      if (taskId) setGlobalTaskId(taskId)
    }
    window.addEventListener('open-task-detail', handleOpenTask)
    return () => window.removeEventListener('open-task-detail', handleOpenTask)
  }, [])

  useEffect(() => {
    if (isLogin || isPortal) { setLoaded(true); return }
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(data => { setWorkspaces(Array.isArray(data) ? data : []); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [isLogin, isPortal])

  // Sync active tab path + label on every navigation
  useEffect(() => {
    if (!pathname || isPortal) return
    setTabs(prev => prev.map(t => {
      if (t.id !== activeTabId) return t
      const label = getDefaultLabel(pathname)
      const icon = getDefaultIcon(pathname)
      return {
        ...t,
        path: pathname,
        label,
        icon,
      }
    }))
    // Fetch breadcrumbs from API
    fetch(`/api/breadcrumb?path=${encodeURIComponent(pathname)}`)
      .then(r => r.json())
      .then((items: BreadcrumbItem[]) => setBreadcrumbs(Array.isArray(items) ? items : []))
      .catch(() => setBreadcrumbs([]))
  }, [pathname, activeTabId, isPortal])

  const setTabInfo = useCallback((label: string, icon?: string) => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, label, icon: icon || t.icon } : t
    ))
  }, [activeTabId])

  const openTab = useCallback((path: string, label?: string) => {
    const id = `t${++_tabId}`
    setTabs(prev => [...prev, { id, path, label: label || getDefaultLabel(path), icon: getDefaultIcon(path) }])
    setActiveTabId(id)
    router.push(path)
  }, [router])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        // Last tab closed - open a fresh default tab
        const newId = `t${++_tabId}`
        const newTab = { id: newId, path: '/schedule', label: 'Calendar', icon: 'calendar' }
        setActiveTabId(newId)
        router.push('/schedule')
        return [newTab]
      }
      if (id === activeTabId) {
        const active = next[Math.min(idx, next.length - 1)]
        setActiveTabId(active.id)
        router.push(active.path)
      }
      return next
    })
  }, [activeTabId, router])

  const switchTab = useCallback((id: string) => {
    setActiveTabId(id)
    const tab = tabs.find(t => t.id === id)
    if (tab) router.push(tab.path)
  }, [tabs, router])

  if (isLogin || isPortal) return <>{children}</>

  // Standalone mode: just the content, no sidebar/tabs (for shared links)
  if (isStandalone) {
    return (
      <TabContext.Provider value={{ tabs, activeTabId, openTab, closeTab, setActiveTab: switchTab, setTabInfo, breadcrumbs, setBreadcrumbs }}>
        <div data-density={density} className="flex flex-col" style={{ height: '100dvh' }}>
          <main className="flex-1 min-h-0 min-w-0 flex flex-col relative">
            {children}
          </main>
        </div>
      </TabContext.Provider>
    )
  }

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="text-text-dim text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <TabContext.Provider value={{ tabs, activeTabId, openTab, closeTab, setActiveTab: switchTab, setTabInfo, breadcrumbs, setBreadcrumbs }}>
      <KeyboardShortcuts />
      <div data-density={density} className="flex flex-col overflow-hidden pwa-safe-top" style={{ height: '100dvh' }}>
        {/* Tab Bar - full width across top */}
        <div data-tabbar className="electron-drag flex items-center h-[39px] shrink-0 overflow-x-auto gap-1" style={{ background: 'var(--bg-chrome)', borderBottom: '1px solid var(--border)', padding: '0 8px' }}>
          <button onClick={() => window.history.back()} className="electron-nodrag flex items-center justify-center w-8 h-8 rounded-md text-text-dim hover:bg-hover hover:text-text shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={() => window.history.forward()} className="electron-nodrag flex items-center justify-center w-8 h-8 rounded-md text-text-dim hover:bg-hover hover:text-text shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {/* Tab strip area */}
          <div className="flex items-center gap-0.5 flex-1 min-w-0 h-full">
            {tabs.map(tab => (
              <button
                key={tab.id}
                draggable
                onClick={() => switchTab(tab.id)}
                onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const menu = document.createElement('div')
                  menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;z-index:9999;background:var(--dropdown-bg);border:1px solid var(--border-strong);border-radius:6px;padding:4px;min-width:180px;box-shadow:var(--glass-shadow-lg);font-size:13px;backdrop-filter:none;-webkit-backdrop-filter:none;opacity:1;`
                  const item = document.createElement('button')
                  item.textContent = 'Open in New Window'
                  item.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 12px;border:none;background:none;color:rgba(243,240,236,1);border-radius:4px;cursor:pointer;font-size:13px;font-family:inherit;backdrop-filter:none;-webkit-backdrop-filter:none;'
                  item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.08)' }
                  item.onmouseleave = () => { item.style.background = 'none' }
                  item.onclick = () => {
                    window.open(`${window.location.origin}${tab.path}`, '_blank', 'width=1200,height=800')
                    document.body.removeChild(menu)
                  }
                  menu.appendChild(item)
                  document.body.appendChild(menu)
                  const dismiss = (ev: MouseEvent) => {
                    if (!menu.contains(ev.target as Node)) {
                      menu.remove()
                      document.removeEventListener('mousedown', dismiss)
                    }
                  }
                  setTimeout(() => document.addEventListener('mousedown', dismiss), 0)
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', `${window.location.origin}${tab.path}`)
                  e.dataTransfer.effectAllowed = 'move'
                  ;(e.currentTarget as HTMLElement).dataset.dragStartX = String(e.clientX)
                  ;(e.currentTarget as HTMLElement).dataset.dragStartY = String(e.clientY)
                }}
                onDragEnd={(e) => {
                  if (e.clientX === 0 && e.clientY === 0) return
                  const startX = Number((e.currentTarget as HTMLElement).dataset.dragStartX || 0)
                  const startY = Number((e.currentTarget as HTMLElement).dataset.dragStartY || 0)
                  const dist = Math.sqrt((e.clientX - startX) ** 2 + (e.clientY - startY) ** 2)
                  if (dist < 20) return
                  const tabBar = (e.currentTarget as HTMLElement).closest('[data-tabbar]')
                  if (tabBar) {
                    const rect = tabBar.getBoundingClientRect()
                    const outOfBar = e.clientY < rect.top - 20 || e.clientY > rect.bottom + 20 || e.clientX < rect.left - 20 || e.clientX > rect.right + 20
                    if (outOfBar) {
                      const newWin = window.open(`${window.location.origin}${tab.path}`, '_blank', 'width=1200,height=800')
                      if (newWin) closeTab(tab.id)
                    }
                  }
                }}
                className={`electron-nodrag group flex items-center gap-2 px-3 h-[38px] rounded-md text-[14px] font-medium transition-colors shrink-0 max-w-[220px] cursor-grab active:cursor-grabbing ${
                  tab.id === activeTabId ? 'text-text' : 'text-text-dim hover:text-text-secondary hover:bg-hover/50'
                }`}
                style={tab.id === activeTabId ? { background: 'var(--bg-active)', boxShadow: '0 0.5px 1px rgba(0,0,0,0.2), inset 0 0.5px 0 rgba(255,255,255,0.06)' } : undefined}
              >
                <span className="shrink-0 text-text-dim">{TAB_ICONS[tab.icon] || TAB_ICONS.page}</span>
                <span className="truncate">{tab.label}</span>
                <span
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-sm hover:bg-hover ${
                    tab.id === activeTabId ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                  }`}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                </span>
              </button>
            ))}
            <button onClick={() => openTab('/schedule')} className="electron-nodrag flex items-center justify-center w-8 h-8 rounded text-text-dim hover:bg-hover hover:text-text shrink-0">
              <svg width="15" height="15" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
          {/* Inbox + Notification bells — pinned to the far right of the tab bar */}
          <div className="electron-nodrag flex items-center shrink-0 pl-1 pr-1 gap-0.5">
            <InboxBell />
            <NotificationsBell />
          </div>
        </div>

        {/* Sidebar + Content below tab bar */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Sidebar workspaces={workspaces} />
          <div className="flex-1 min-h-0 min-w-0 flex flex-col">
            {/* Breadcrumb Bar - hidden on pages with their own title header */}
            {breadcrumbs.length > 0 && pathname !== '/projects-tasks' && pathname !== '/schedule' && (
              <div data-breadcrumbs className="flex items-center min-h-[36px] px-4 shrink-0 border-b border-border bg-bg gap-1 flex-wrap py-1">
                {breadcrumbs.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1 shrink-0">
                    {i > 0 && <span className="doc-breadcrumb-sep text-[13px] mx-0.5">/</span>}
                    {crumb.icon && <span className="doc-breadcrumb">{TAB_ICONS[crumb.icon] || null}</span>}
                    {crumb.href ? (
                      <button onClick={() => router.push(crumb.href!)} className="doc-breadcrumb hover:text-text-secondary truncate max-w-[200px]">{crumb.label}</button>
                    ) : (
                      <span className="doc-breadcrumb-last truncate max-w-[280px]">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            <main className="flex-1 min-h-0 min-w-0 flex flex-col relative">
              {children}
              {globalTaskId && (
                <div className="fixed inset-0 z-30 sm:absolute sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[480px] sm:max-w-full shadow-2xl sm:border-l border-border bg-card animate-slide-up sm:animate-none">
                  <TaskDetailPanel taskId={globalTaskId} onClose={() => setGlobalTaskId(null)} />
                </div>
              )}
            </main>
          </div>
          <RightSidebar />
        </div>
      </div>
      {!pathname.startsWith('/crm') && <MobileNav workspaces={workspaces} />}
      {/* ChatBubble removed - AI chat consolidated into messaging DMs */}
    </TabContext.Provider>
  )
}
