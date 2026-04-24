'use client'

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export interface Tab {
  id: string
  path: string
  label: string
  icon?: string
}

interface TabContextValue {
  tabs: Tab[]
  activeTabId: string | null
  openTab: (path: string, label: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
}

const TabContext = createContext<TabContextValue | null>(null)

export function useTabContext() {
  return useContext(TabContext)
}

function getPageLabel(path: string): string {
  if (path === '/schedule') return 'Calendar'
  if (path === '/dashboard') return 'Dashboard'
  if (path === '/projects-tasks') return 'Projects & Tasks'
  if (path === '/settings') return 'Settings'
  if (path.startsWith('/project/')) return 'Project'
  if (path.startsWith('/doc/')) return 'Doc'
  return 'Calendar'
}

function getPageIcon(path: string): string {
  if (path === '/schedule') return 'calendar'
  if (path === '/dashboard') return 'dashboard'
  if (path === '/projects-tasks') return 'projects'
  if (path === '/settings') return 'settings'
  if (path.startsWith('/project/')) return 'project'
  if (path.startsWith('/doc/')) return 'doc'
  return 'calendar'
}

let tabCounter = 0

export function TabProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const id = `tab-${++tabCounter}`
    return [{ id, path: pathname || '/schedule', label: getPageLabel(pathname || '/schedule'), icon: getPageIcon(pathname || '/schedule') }]
  })
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id)

  // When user navigates via sidebar, update the active tab's path
  useEffect(() => {
    if (!pathname) return
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, path: pathname, label: getPageLabel(pathname), icon: getPageIcon(pathname) } : t
    ))
  }, [pathname, activeTabId])

  const openTab = useCallback((path: string, label: string) => {
    const id = `tab-${++tabCounter}`
    const newTab: Tab = { id, path, label: label || getPageLabel(path), icon: getPageIcon(path) }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(id)
    router.push(path)
  }, [router])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)
      if (id === activeTabId) {
        const newActive = next[Math.min(idx, next.length - 1)]
        setActiveTabId(newActive.id)
        router.push(newActive.path)
      }
      return next
    })
  }, [activeTabId, router])

  const switchTab = useCallback((id: string) => {
    setActiveTabId(id)
    const tab = tabs.find(t => t.id === id)
    if (tab) router.push(tab.path)
  }, [tabs, router])

  return (
    <TabContext.Provider value={{ tabs, activeTabId, openTab, closeTab, setActiveTab: switchTab }}>
      {children}
    </TabContext.Provider>
  )
}

const TAB_ICONS: Record<string, React.ReactNode> = {
  calendar: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  dashboard: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  projects: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  project: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  doc: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
}

export function TabBar() {
  const ctx = useTabContext()
  const [isTauri, setIsTauri] = useState(false)
  useEffect(() => {
    setIsTauri(!!(window as any).__TAURI__ || navigator.userAgent.includes('Tauri'))
  }, [])
  if (!ctx) return <div className="h-[36px] bg-red shrink-0 flex items-center px-2 text-white text-xs">TabBar: no context</div>

  const { tabs, activeTabId, openTab, closeTab, setActiveTab } = ctx

  return (
    <div
      className="flex items-center h-[39px] glass border-b border-border px-2 shrink-0 gap-1 overflow-x-auto"
      style={isTauri ? { paddingLeft: 140 } : undefined}
    >
      {/* Back / Forward */}
      <button
        onClick={() => window.history.back()}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-dim hover:bg-hover hover:text-text shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        onClick={() => window.history.forward()}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-dim hover:bg-hover hover:text-text shrink-0"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="w-px h-4 bg-border/50 mx-1 shrink-0" />

      {/* Tabs */}
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`group flex items-center gap-2 px-3.5 h-[32px] rounded-md text-[13px] font-medium transition-all duration-200 shrink-0 max-w-[220px] ${
            tab.id === activeTabId
              ? 'glass-pill text-text'
              : 'text-text-dim hover:bg-hover/50 hover:text-text-secondary'
          }`}
        >
          <span className="shrink-0 text-text-dim">{TAB_ICONS[tab.icon || 'calendar']}</span>
          <span className="truncate">{tab.label}</span>
          {tabs.length > 1 && (
            <span
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              className={`shrink-0 flex items-center justify-center w-4 h-4 rounded hover:bg-border ${
                tab.id === activeTabId ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
              }`}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </button>
      ))}

      {/* Add tab button */}
      <button
        onClick={() => openTab('/schedule', 'Calendar')}
        className="flex items-center justify-center w-7 h-7 rounded-md text-text-dim hover:bg-hover hover:text-text shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
