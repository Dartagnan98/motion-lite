'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { usePathname, useRouter } from 'next/navigation'
import type { Workspace } from '@/lib/types'
import { SidebarTree } from './SidebarTree'
import { createWorkspaceAction } from '@/lib/actions'
import { SearchModal } from '@/components/ui/SearchModal'
import { useActiveWorkspace } from '@/lib/use-active-workspace'
import { CreateProjectModal } from './CreateProjectModal'
import { Avatar } from '@/components/ui/Avatar'
import { IconX, IconCheck, IconChevronRight, IconPlus } from '@/components/ui/Icons'

interface UserInfo { id: number; email: string; name: string; avatar_url: string | null; role: string }

interface NotifItem {
  id: number
  type: string
  subtype: string | null
  title: string
  body: string | null
  url: string | null
  actor_name: string | null
  actor_avatar: string | null
  actor_color: string | null
  read: number
  created_at: number
  // Legacy compat fields
  message?: string
  task_id?: number
  agent_id?: string | null
  agent_name?: string | null
}

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 244

export function Sidebar({ workspaces }: { workspaces: Workspace[] }) {
  const { workspaceId: activeWsId, setActive: setActiveWs } = useActiveWorkspace()
  const activeWorkspaceId = activeWsId || workspaces[0]?.id
  // Auto-select first workspace if none active
  useEffect(() => {
    if (!activeWsId && workspaces.length > 0 && workspaces[0]?.id) {
      setActiveWs(workspaces[0].id)
    }
  }, [activeWsId, workspaces, setActiveWs])
  const [collapsed, setCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar-width')
      if (saved) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Number(saved)))
    }
    return SIDEBAR_DEFAULT
  })
  const [addingWorkspace, setAddingWorkspace] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [user, setUser] = useState<UserInfo | null>(null)
  const isAdmin = user?.email === 'operator@example.com'
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const [savedViewsOpen, setSavedViewsOpen] = useState(true)
  const [workspacesOpen, setWorkspacesOpen] = useState(true)
  const [navSections, setNavSections] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('sidebar-nav-sections')
        if (saved) return JSON.parse(saved) as Record<string, boolean>
      } catch {}
    }
    return { productivity: true, ai: true, ads: true, operations: true } as Record<string, boolean>
  })
  const toggleNavSection = (key: string) => {
    setNavSections(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem('sidebar-nav-sections', JSON.stringify(next))
      return next
    })
  }
  const [savedViews, setSavedViews] = useState<{ id: number; name: string; view_type: string }[]>([])
  const [showNewViewInput, setShowNewViewInput] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const [favoriteTasks, setFavoriteTasks] = useState<{ id: number; title: string; status: string }[]>([])
  const [pastDueCount, setPastDueCount] = useState(0)
  const [upNext, setUpNext] = useState<{ type: 'task' | 'event'; id: number | string; title: string; time: Date; duration?: number } | null>(null)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const [notifications, setNotifications] = useState<NotifItem[]>([])
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'default'>('default')
  const notifRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setUser(d.user)).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/views').then(r => r.json()).then(d => { if (Array.isArray(d)) setSavedViews(d) }).catch(() => {})
  }, [])


  // Fetch unread inbox count
  useEffect(() => {
    function fetchCount() {
      fetch('/api/activities?unread_count=1').then(r => r.json()).then(d => setInboxCount(d.count || 0)).catch(() => {})
    }
    fetchCount()
    const interval = setInterval(fetchCount, 30000)
    return () => clearInterval(interval)
  }, [])

  // Notification bell: poll unread count + recent notifications every 30s
  useEffect(() => {
    function fetchNotifs() {
      fetch('/api/notifications?unread_count=1')
        .then(r => r.json())
        .then(d => {
          const count = d.count || 0
          // Send desktop notification if tab not focused and count increased
          if (count > prevCountRef.current && !document.hasFocus() && notifPermission === 'granted') {
            const diff = count - prevCountRef.current
            // Fetch the latest notification to show its content
            fetch('/api/notifications?limit=1')
              .then(r2 => r2.json())
              .then(d2 => {
                const latest = d2.notifications?.[0]
                new Notification('Motion Lite', {
                  body: latest
                    ? latest.message || latest.title
                    : `You have ${diff} new notification${diff > 1 ? 's' : ''}`,
                  icon: '/favicon.ico',
                })
              })
              .catch(() => {
                new Notification('Motion Lite', {
                  body: `You have ${diff} new notification${diff > 1 ? 's' : ''}`,
                  icon: '/favicon.ico',
                })
              })
          }
          prevCountRef.current = count
          setNotifCount(count)
        })
        .catch(() => {})
    }
    fetchNotifs()
    const interval = setInterval(fetchNotifs, 30000)
    return () => clearInterval(interval)
  }, [notifPermission])

  // Request web notification permission + register Service Worker for push
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    setNotifPermission(Notification.permission)
    if (Notification.permission === 'default') {
      const handler = () => {
        Notification.requestPermission().then(perm => {
          setNotifPermission(perm)
          if (perm === 'granted') registerServiceWorker()
        })
        window.removeEventListener('click', handler)
      }
      window.addEventListener('click', handler)
      return () => window.removeEventListener('click', handler)
    }
    if (Notification.permission === 'granted') registerServiceWorker()
  }, [])

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      try {
        // Get VAPID key from server
        const res = await fetch('/api/push/subscribe')
        const data = await res.json()
        if (!data.vapidPublicKey) { console.warn('[push] No VAPID key from server'); return }

        // Check existing subscription
        const existing = await reg.pushManager.getSubscription()
        let sub = existing

        // Re-subscribe if no existing subscription or key mismatch
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: data.vapidPublicKey,
          })
        }

        // Always ensure server has our subscription
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        })
        console.log('[push] Subscription registered')
      } catch (err) { console.warn('[push] Subscription failed:', err) }
    }).catch((err) => { console.warn('[push] SW registration failed:', err) })
  }

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!showNotifications) return
    function handler(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotifications])

  // Fetch recent notifications when dropdown opens
  const openNotifDropdown = useCallback(() => {
    setShowNotifications(prev => {
      if (!prev) {
        fetch('/api/notifications?limit=10')
          .then(r => r.json())
          .then(d => { if (Array.isArray(d.notifications)) setNotifications(d.notifications) })
          .catch(() => {})
      }
      return !prev
    })
  }, [])

  function handleNotifClick(n: NotifItem) {
    // Mark as read
    if (!n.read) {
      fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [n.id] }),
      }).then(() => {
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: 1 } : x))
        setNotifCount(prev => Math.max(0, prev - 1))
      }).catch(() => {})
    }
    // Navigate to the notification target
    if (n.url) {
      router.push(n.url)
    } else if (n.task_id) {
      // Legacy fallback for old task_activity entries
      window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: n.task_id } }))
    }
    setShowNotifications(false)
  }

  function markAllNotifRead() {
    fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).then(() => {
      setNotifications(prev => prev.map(x => ({ ...x, read: 1 })))
      setNotifCount(0)
    }).catch(() => {})
  }

  // Fetch sidebar task summary (poll every 60s + on task events)
  useEffect(() => {
    function fetchSidebarSummary() {
      fetch('/api/sidebar/summary').then(r => r.json()).then(d => {
        if (Array.isArray(d.favoriteTasks)) setFavoriteTasks(d.favoriteTasks)
        if (typeof d.pastDueCount === 'number') setPastDueCount(d.pastDueCount)
        if (d.upNext?.time) {
          setUpNext({
            ...d.upNext,
            time: new Date(d.upNext.time),
          })
        } else {
          setUpNext(null)
        }
      }).catch(() => {})
    }
    fetchSidebarSummary()
    const interval = setInterval(fetchSidebarSummary, 60000)
    const handleTaskUpdate = () => fetchSidebarSummary()
    window.addEventListener('tasks-updated', handleTaskUpdate)
    return () => {
      clearInterval(interval)
      window.removeEventListener('tasks-updated', handleTaskUpdate)
    }
  }, [])

  // Cmd+K shortcut for search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    function handleOpenSearch() { setShowSearch(true) }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('open-search', handleOpenSearch)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('open-search', handleOpenSearch)
    }
  }, [])

  // Close new menu on outside click
  useEffect(() => {
    if (!showNewMenu) return
    const handler = (e: MouseEvent) => setShowNewMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showNewMenu])

  // Drag-to-resize
  useEffect(() => {
    if (!isResizing) return
    function onMove(e: MouseEvent) {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX))
      setSidebarWidth(w)
    }
    function onUp() {
      setIsResizing(false)
      setSidebarWidth(w => { localStorage.setItem('sidebar-width', String(w)); return w })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  async function handleNewTask() {
    setShowNewMenu(false)
    if (workspaces.length === 0) return
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled Task', workspace_id: activeWorkspaceId }),
    })
    const data = await res.json()
    if (data.task?.id) {
      window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: data.task.id } }))
    }
  }

  async function handleNewDoc() {
    setShowNewMenu(false)
    if (workspaces.length === 0) return
    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: activeWorkspaceId }),
    })
    const doc = await res.json()
    if (doc?.public_id) window.location.href = `/doc/${doc.public_id}`
    else if (doc?.id) window.location.href = `/doc/${doc.id}`
  }

  async function handleNewDatabase() {
    setShowNewMenu(false)
    const res = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_sheet', name: 'Untitled Database' }),
    })
    const data = await res.json()
    if (data?.id) {
      // Create default Name column and 1 empty row
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_column', sheet_id: data.id, name: 'Name', type: 'text' }),
      })
      await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_row', sheet_id: data.id, data: {} }),
      })
      window.location.href = `/database?open=${data.public_id || data.id}&new=1`
    }
  }

  function handleNewProject() {
    setShowNewMenu(false)
    setShowCreateProject(true)
  }

  return (
    <aside
      data-sidebar
      className={`flex flex-col border-r border-border glass shrink-0 relative hidden sm:flex ${collapsed ? 'w-[52px]' : ''}`}
      style={collapsed ? undefined : { width: sidebarWidth }}
    >
      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={() => setIsResizing(true)}
          className={`absolute right-0 top-0 bottom-0 w-[4px] cursor-col-resize z-30 hover:bg-accent/30 transition-colors ${isResizing ? 'bg-accent/40' : ''}`}
        />
      )}

      {collapsed ? (
        <div className="flex flex-col items-center py-3 gap-1 flex-1">
          {/* Expand button */}
          <button
            onClick={() => setCollapsed(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-dim hover:bg-white/[0.07] hover:text-text transition-all mb-1"
            title="Expand sidebar"
          >
            <IconChevronRight size={14} />
          </button>
          {/* Icon rail -- key nav items */}
          {[
            { icon: 'inbox', href: '/crm/inbox', label: 'Inbox' },
            { icon: 'calendar', href: '/schedule', label: 'Calendar' },
            { icon: 'projects', href: '/projects-tasks', label: 'Projects & Tasks' },
            { icon: 'dispatch', href: '/dispatch', label: 'Dispatch' },
            { icon: 'crm', href: '/crm', label: 'CRM' },
            { icon: 'clients', href: '/clients', label: 'Clients' },
          ].map(({ icon, href, label }) => {
            const icons: Record<string, React.ReactNode> = {
              inbox: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 10l3-1.5L8 10l3-1.5L14 10v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/></svg>,
              calendar: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
              projects: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>,
              dispatch: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
              crm: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 6h6M5 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M11.5 10.5l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
              clients: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 14v-1.5a3 3 0 00-3-3H5a3 3 0 00-3 3V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="6.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
            }
            return (
              <RailIcon key={href} href={href} label={label} icon={icons[icon]} />
            )
          })}
        </div>
      ) : (
        <>
          {/* ─── Top bar: Avatar, hide, settings, + New ─── */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-1.5 relative"
            >
              <Avatar name={user?.name || 'User'} size={28} src={user?.avatar_url} />
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-text-dim"><path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>

            <div className="flex items-center gap-1">
              {/* Hide sidebar */}
              <button
                onClick={() => setCollapsed(true)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text"
                title="Hide sidebar"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 3L9 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Settings */}
              <a
                href="/settings"
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text"
                title="Settings"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
              </a>

              {/* Notification bell */}
              <div className="relative" ref={notifRef}>
                <button
                  onClick={openNotifDropdown}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text relative"
                  title="Notifications"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1.5a4 4 0 00-4 4v3l-1.5 2h11L12 8.5v-3a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    <path d="M6 13a2 2 0 004 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {notifCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red/90 px-1 text-[8px] font-bold text-white leading-none">
                      {notifCount > 99 ? '99+' : notifCount}
                    </span>
                  )}
                </button>

                {/* Notification dropdown */}
                {showNotifications && (
                  <div className="absolute left-0 top-full mt-1.5 w-[340px] rounded-xl border border-border-strong glass-elevated animate-glass-in shadow-2xl z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                      <span className="text-[13px] font-semibold text-text">Notifications</span>
                      {notifCount > 0 && (
                        <button
                          onClick={markAllNotifRead}
                          className="text-[10px] text-accent-text hover:text-accent-text/80 transition-colors"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-[13px] text-text-dim">
                          No notifications yet
                        </div>
                      ) : (
                        notifications.map(n => (
                          <button
                            key={n.id}
                            onClick={() => handleNotifClick(n)}
                            className={`flex items-start gap-3 w-full px-4 py-3 text-left hover:bg-hover transition-colors border-b border-border/50 last:border-0 ${
                              !n.read ? 'bg-accent/5' : ''
                            }`}
                          >
                            {/* Actor avatar or type icon */}
                            <div className="relative shrink-0 mt-0.5">
                              {(n.actor_avatar || n.actor_name) ? (
                                <Avatar name={n.actor_name || 'System'} size={28} src={n.actor_avatar} color={n.actor_color} />
                              ) : (
                                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] ${
                                  n.type === 'task' ? 'bg-purple-500/20 text-purple-400' :
                                  n.type === 'calendar' ? 'bg-blue-500/20 text-blue-400' :
                                  n.type === 'project' ? 'bg-amber-500/20 text-amber-400' :
                                  'bg-accent/20 text-accent-text'
                                }`}>
                                  {n.type === 'task' ? (
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                  ) : n.type === 'calendar' ? (
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 6.5h12M5.5 2v2M10.5 2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                                  ) : n.type === 'project' ? (
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.3"/></svg>
                                  ) : (
                                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a4 4 0 00-4 4v3l-1.5 2h11L12 8.5v-3a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                                  )}
                                </div>
                              )}
                              {/* Type badge overlay */}
                              {(n.actor_avatar || n.actor_name) && (
                                <div className={`absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-bg ${
                                  n.type === 'message' ? 'bg-green-500' :
                                  n.type === 'task' ? 'bg-purple-500' :
                                  n.type === 'calendar' ? 'bg-blue-500' :
                                  n.type === 'project' ? 'bg-amber-500' :
                                  'bg-zinc-500'
                                }`}>
                                  {n.type === 'message' ? (
                                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H5l-3 3V4a1 1 0 011-1z" fill="white"/></svg>
                                  ) : n.type === 'task' ? (
                                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 8.5L6.5 11L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                  ) : n.type === 'calendar' ? (
                                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1" fill="white"/></svg>
                                  ) : (
                                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4" fill="white"/></svg>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium text-text truncate">{n.title}</span>
                                {!n.read && (
                                  <span className="flex h-2 w-2 rounded-full bg-accent shrink-0" />
                                )}
                              </div>
                              {(n.body || n.message) && (
                                <p className="text-[13px] text-text-secondary mt-0.5 line-clamp-2">{n.body || n.message}</p>
                              )}
                              <span className="text-[10px] text-text-dim mt-1 block">
                                {relativeTime(n.created_at)}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    {/* Inbox page stripped from motion-lite — view-all link removed */}
                  </div>
                )}
              </div>

              {/* + New button */}
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowNewMenu(!showNewMenu) }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-white text-[13px] font-semibold transition-all active:scale-[0.98]"
                  style={{ background: 'var(--accent)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#e4ded3' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)' }}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  New
                </button>

                {showNewMenu && (
                  <div className="absolute top-full right-0 mt-1.5 w-[190px] rounded-lg border border-border-strong glass-elevated animate-glass-in shadow-xl py-1 z-50" onClick={e => e.stopPropagation()}>
                    <button onClick={handleNewTask} className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      New Task
                      <span className="ml-auto text-[10px] text-text-dim">Space</span>
                    </button>
                    <button onClick={handleNewDoc} className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" /><path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.3" /></svg>
                      New Doc
                    </button>
                    <button onClick={handleNewDatabase} className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M2 6h12M2 10h12M6 2v12" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                      New Database
                    </button>
                    <button onClick={handleNewProject} className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
                      New Project
                    </button>
                    <div className="h-px bg-border my-0.5 mx-2.5" />
                    <button className="flex items-center gap-2 w-full px-2.5 py-1 text-[13px] text-text hover:bg-[rgba(255,255,255,0.06)] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      New Meeting
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* User menu dropdown */}
            {showUserMenu && (
              <div className="absolute left-3 top-14 w-52 rounded-lg border border-border glass-elevated animate-glass-in shadow-lg py-1 z-50">
                <div className="px-3 py-2 border-b border-border">
                  <div className="text-[13px] text-text font-medium truncate">{user?.name}</div>
                  <div className="text-[10px] text-text-dim truncate">{user?.email}</div>
                </div>
                <button
                  onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' })
                    router.push('/login')
                  }}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-red hover:bg-hover transition-colors"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>

          {/* ─── Up Next banner ─── */}
          <div className="px-2.5 py-2 border-b border-border/40">
            {upNext ? (
              <button
                onClick={() => {
                  if (upNext.type === 'task') {
                    window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: upNext.id } }))
                  }
                }}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-xl transition-all duration-150 hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, rgba(241,237,229,0.18) 0%, rgba(30,40,50,0.6) 100%)',
                  border: '1px solid rgba(241,237,229,0.22)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                {upNext.type === 'task' ? (
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--accent-text)]">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M5.5 8l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[var(--accent-text)]">
                    <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-white/50 mb-0.5 uppercase tracking-wider">Up Next</div>
                  <div className="text-[13px] text-white font-semibold truncate leading-tight">{upNext.title}</div>
                  <div className="text-[11px] text-white/50 mt-0.5">
                    {upNext.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    {upNext.duration ? ` · ${upNext.duration >= 60 ? `${Math.floor(upNext.duration / 60)}h${upNext.duration % 60 ? ` ${upNext.duration % 60}m` : ''}` : `${upNext.duration}m`}` : ''}
                  </div>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-dim shrink-0">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                <span className="text-[12px] text-text-dim truncate">Nothing up next</span>
              </div>
            )}
          </div>

          {/* ─── Scrollable content from AI Chat down ─── */}
          <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ─── AI Chat / Search bar ─── */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
            {isAdmin ? (
              <button
                onClick={() => router.push('/chat')}
                className="flex items-center gap-2 flex-1 rounded-lg bg-elevated border border-border px-3 py-1.5 text-[12px] text-text-dim hover:border-border-strong hover:text-text transition-all duration-150"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2a5.5 5.5 0 00-4 9.3V14l2.5-1.5L9 14v-2.7A5.5 5.5 0 008 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                AI Chat
                <kbd className="ml-auto text-[9px] text-text-dim bg-border/60 rounded px-1.5 py-0.5 font-mono">⌘ /</kbd>
              </button>
            ) : (
              <button
                onClick={() => setShowSearch(true)}
                className="flex items-center gap-2 flex-1 rounded-lg bg-elevated border border-border px-3 py-1.5 text-[12px] text-text-dim hover:border-border-strong hover:text-text transition-all duration-150"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Search
                <kbd className="ml-auto text-[9px] text-text-dim bg-border/60 rounded px-1.5 py-0.5 font-mono">⌘ K</kbd>
              </button>
            )}
            <button
              onClick={() => setShowSearch(true)}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-elevated border border-border text-text-dim hover:border-border-strong hover:text-text transition-all duration-150 shrink-0"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* ─── Navigation items (categorized) ─── */}
          <div className="flex flex-col px-2 py-2 border-b border-border">
            {/* Productivity */}
            <button onClick={() => toggleNavSection('productivity')} className="flex items-center gap-1.5 px-1 pt-0.5 pb-1 w-full">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`text-text-dim transition-transform ${navSections.productivity ? '' : '-rotate-90'}`}>
                <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sidebar-section-label">Productivity</span>
            </button>
            {navSections.productivity && (
              <div className="flex flex-col gap-0.5 pb-1">
                <NavItem icon="agenda" label="Today" href="/today" />
                <NavItem icon="projects" label="Projects & Tasks" href="/projects-tasks" badge={pastDueCount} badgeColor="red" />
                {/* Inbox / CRM / Messages / Calendar pages don't exist in motion-lite — stripped from internal CRM. Re-add NavItems if/when those routes ship. */}
              </div>
            )}

            {/* AI Employees */}
            {isAdmin && (
              <>
                <div className="border-t border-border/40 mt-1 mb-1" />
                <button onClick={() => toggleNavSection('ai')} className="flex items-center gap-1.5 px-1 pt-0.5 pb-1 w-full">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`text-text-dim transition-transform ${navSections.ai ? '' : '-rotate-90'}`}>
                    <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="sidebar-section-label">AI</span>
                </button>
                {navSections.ai && (
                  <div className="flex flex-col gap-0.5 pb-1">
                    <NavItem icon="agenda" label="AI Agenda" href="/agenda" />
                    <NavItem icon="dispatch" label="Dispatch Board" href="/dispatch" />
                    <NavItem icon="meeting" label="AI Meeting Notes" href="/meeting-notes" />
                    <NavItem icon="skills" label="Brand Voice" href="/voice" />
                  </div>
                )}
              </>
            )}

            {/* Ads */}
            {isAdmin && (
              <>
                <div className="border-t border-border/40 mt-1 mb-1" />
                <button onClick={() => toggleNavSection('ads')} className="flex items-center gap-1.5 px-1 pt-0.5 pb-1 w-full">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`text-text-dim transition-transform ${navSections.ads ? '' : '-rotate-90'}`}>
                    <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="sidebar-section-label">Ads</span>
                </button>
                {navSections.ads && (
                  <div className="flex flex-col gap-0.5 pb-1">
                    <NavItem icon="chart" label="Meta Ads" href="/ads" />
                    <NavItem icon="chart" label="Google Ads" href="/google-ads" />
                  </div>
                )}
              </>
            )}

            {/* Operations */}
            <div className="border-t border-border/40 mt-1 mb-1" />
            <button onClick={() => toggleNavSection('operations')} className="flex items-center gap-1.5 px-1 pt-0.5 pb-1 w-full">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`text-text-dim transition-transform ${navSections.operations ? '' : '-rotate-90'}`}>
                <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="sidebar-section-label">Operations</span>
            </button>
            {navSections.operations && (
              <div className="flex flex-col gap-0.5 pb-1">
                <NavItem icon="briefcase" label="Businesses" href="/businesses" />
                <NavItem icon="clients" label="Clients" href="/clients" />
                <NavItem icon="crm" label="Campaigns" href="/crm/campaigns" />
              </div>
            )}
          </div>

          {/* ─── Favorites section ─── */}
          <div className="px-2 pt-2">
            <button
              onClick={() => setFavoritesOpen(!favoritesOpen)}
              className="flex items-center gap-1.5 px-1 pb-1 w-full"
            >
              <span className="sidebar-section-label">Favorites</span>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`text-text-dim transition-transform ${favoritesOpen ? '' : '-rotate-90'}`}>
                <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {favoritesOpen && (
              <div className="flex flex-col gap-0.5 py-1">
                {favoriteTasks.length > 0 ? favoriteTasks.map(t => (
                  <button
                    key={t.id}
                    onClick={() => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: t.id } }))}
                    className="flex items-center gap-2.5 rounded-md px-2 h-[30px] text-[14px] font-medium text-text-secondary hover:bg-hover hover:text-text transition-colors w-full text-left"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-yellow-400 shrink-0">
                      <path d="M8 1l2.2 4.5 5 .7-3.6 3.5.8 5L8 12.4 3.6 14.7l.8-5L.8 6.2l5-.7L8 1z" fill="currentColor" />
                    </svg>
                    <span className="truncate">{t.title}</span>
                  </button>
                )) : (
                  <div className="flex flex-col items-center gap-1.5 py-4 px-3">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-text-dim/40">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                    </svg>
                    <p className="text-[11px] text-text-dim text-center">Star items to pin them here</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Saved Views section ─── */}
          <div className="px-2 pt-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <button
                onClick={() => setSavedViewsOpen(!savedViewsOpen)}
                className="flex items-center gap-1.5"
              >
                <span className="sidebar-section-label">Views</span>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`text-text-dim transition-transform ${savedViewsOpen ? '' : '-rotate-90'}`}>
                  <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                onClick={() => setShowNewViewInput(true)}
                className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text"
                title="New view"
              >
                <PlusIcon size={10} />
              </button>
            </div>
            {savedViewsOpen && (
              <div className="flex flex-col gap-0.5 py-1">
                {savedViews.map(v => {
                  const viewTypeIcons: Record<string, React.ReactNode> = {
                    list: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
                    kanban: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="8" y="2" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>,
                    gantt: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h6M3 8h8M3 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
                    dashboard: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="2" y="9" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="9" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>,
                    workload: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="10" width="3" height="4" rx="0.5" fill="currentColor" fillOpacity="0.4" /><rect x="6.5" y="6" width="3" height="8" rx="0.5" fill="currentColor" fillOpacity="0.6" /><rect x="11" y="3" width="3" height="11" rx="0.5" fill="currentColor" fillOpacity="0.8" /></svg>,
                  }
                  return (
                    <button
                      key={v.id}
                      onClick={() => router.push(`/projects-tasks?view=${v.id}`)}
                      className="flex items-center gap-2.5 rounded-md px-2 h-[30px] text-[14px] font-medium text-text-secondary hover:bg-hover hover:text-text transition-colors w-full text-left"
                    >
                      <span className="text-text-dim shrink-0">{viewTypeIcons[v.view_type] || viewTypeIcons.list}</span>
                      <span className="truncate">{v.name}</span>
                    </button>
                  )
                })}
                {showNewViewInput && (
                  <NewViewInput
                    onSave={async (name) => {
                      const res = await fetch('/api/views', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, view_type: 'list', config: {} }),
                      })
                      if (res.ok) {
                        const view = await res.json()
                        setSavedViews(prev => [...prev, view])
                        setShowNewViewInput(false)
                        router.push(`/projects-tasks?view=${view.id}`)
                      }
                    }}
                    onCancel={() => setShowNewViewInput(false)}
                  />
                )}
                {savedViews.length === 0 && !showNewViewInput && (
                  <button
                    onClick={() => setShowNewViewInput(true)}
                    className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-text-dim hover:bg-hover hover:text-text-secondary transition-colors w-full"
                  >
                    <PlusIcon size={11} />
                    Create a view
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ─── Workspaces section ─── */}
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <button onClick={() => setWorkspacesOpen(v => !v)} className="flex items-center gap-1.5 flex-1">
              <span className="sidebar-section-label">Workspaces</span>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={`text-text-dim transition-transform ${workspacesOpen ? '' : '-rotate-90'}`}>
                <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => setAddingWorkspace(true)}
              className="flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-hover hover:text-text"
              title="New workspace"
            >
              <PlusIcon size={12} />
            </button>
          </div>

          {addingWorkspace && (
            <AddWorkspaceModal
              workspaces={workspaces}
              onClose={() => setAddingWorkspace(false)}
              onCreate={async (name: string, color: string) => {
                const formData = new FormData()
                formData.set('name', name)
                formData.set('color', color)
                await createWorkspaceAction(formData)
                setAddingWorkspace(false)
              }}
            />
          )}

          {/* Workspace trees */}
          {workspacesOpen && <div className="px-2 py-1">
            {workspaces.map((ws) => (
              <SidebarTree key={ws.id} workspace={ws} isActive={ws.id === activeWorkspaceId} onActivate={() => setActiveWs(ws.id)} onNewProject={() => setShowCreateProject(true)} />
            ))}
            {workspaces.length === 0 && !addingWorkspace && (
              <button
                onClick={() => setAddingWorkspace(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-3 text-[13px] text-text-dim hover:bg-hover hover:text-text-secondary"
              >
                <PlusIcon size={14} />
                Create your first workspace
              </button>
            )}
          </div>}

          </div>{/* end scrollable content */}

        </>
      )}

      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
      {showCreateProject && (
        <CreateProjectModal
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onClose={() => setShowCreateProject(false)}
        />
      )}
    </aside>
  )
}

function RailIcon({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
  return (
    <button
      onClick={() => router.push(href)}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-md transition-all duration-150"
      style={isActive ? {
        background: 'var(--accent-dim)',
        color: 'var(--accent-text)',
      } : { color: 'var(--text-dim)' }}
      onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' } }}
      onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)' } }}
    >
      {icon}
    </button>
  )
}

function NavItem({ icon, label, href, badge, badgeColor, rightText }: { icon: string; label: string; href: string; badge?: number; badgeColor?: string; rightText?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [agendaActive, setAgendaActive] = useState(false)

  // Track agenda doc navigation — /agenda redirects to /doc/{id}, so pathname check alone fails
  useEffect(() => {
    if (href !== '/agenda') return
    if (pathname.startsWith('/doc')) {
      // Check if breadcrumb bar contains "Agenda" folder
      const el = document.querySelector('[data-breadcrumbs]')
      if (el?.textContent?.includes('Agenda')) { setAgendaActive(true); return }
    }
    setAgendaActive(false)
  }, [href, pathname])

  const isActive = agendaActive || (href === '/' ? pathname === '/' : pathname.startsWith(href))
  const icons: Record<string, React.ReactNode> = {
    inbox: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 10l3-1.5L8 10l3-1.5L14 10v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/></svg>,
    messages: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 2.5V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M5 7h6M5 9.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
    agenda: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    calendar: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" /><path d="M2 7h12M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
    projects: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14 5v6l-6 3.5L2 11V5l6-3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M8 8.5V15M8 8.5L2 5M8 8.5l6-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>,
    dashboard: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="2" y="9" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="9" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>,
    team: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="11" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/><path d="M1 13c0-2.2 2.2-4 5-4s5 1.8 5 4" stroke="currentColor" strokeWidth="1.2"/><path d="M11 9c1.7 0 3 1.1 3 2.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
    meeting: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.2"/><path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
    dispatch: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    employees: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/><circle cx="8" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 12c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke="currentColor" strokeWidth="1.2"/></svg>,
    chat: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H4l-2 2V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
    skills: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l2 3h3l-2 3 1 3-4-1-4 1 1-3-2-3h3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
    chart: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="4" y1="13" x2="4" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="8" y1="13" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="12" y1="13" x2="12" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
    briefcase: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M10.5 5V3.5a1.5 1.5 0 00-1.5-1.5H7A1.5 1.5 0 005.5 3.5V5" stroke="currentColor" strokeWidth="1.2"/></svg>,
    clients: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 14v-1.5a3 3 0 00-3-3H5a3 3 0 00-3 3V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="6.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M15 14v-1.5a2.5 2.5 0 00-2-2.45M10.5 2.13a2.5 2.5 0 010 4.74" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    crm: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 6h6M5 9h6M5 12h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
    database: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>,
    settings: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>,
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); router.push(href) }}
      className={`w-full flex items-center gap-2.5 rounded-md h-[32px] px-2.5 text-[13px] font-medium transition-all duration-150 text-left ${
        isActive
          ? 'text-[color:var(--text)]'
          : 'text-text-secondary hover:text-text hover:bg-[color:var(--bg-hover)]'
      }`}
      style={isActive
        ? {
            background: 'var(--accent-dim)',
          }
        : {}}
    >
      <span className={`shrink-0 ${isActive ? 'text-[color:var(--accent-text)]' : 'text-[color:var(--text-dim)]'}`}>{icons[icon]}</span>
      <span className="truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className={`ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold tabular-nums ${
          badgeColor === 'red'
            ? 'bg-red/15 text-red'
            : 'bg-accent/15 text-accent-text'
        }`}>{badge > 99 ? '99+' : badge}</span>
      )}
      {rightText && (
        <span className="ml-auto text-[10px] text-text-dim">{rightText}</span>
      )}
    </button>
  )
}

function FavItem({ label, icon }: { label: string; icon: string }) {
  const icons: Record<string, React.ReactNode> = {
    tasks: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/><path d="M5 8h6M5 5h6M5 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
    timeline: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h6M3 8h8M3 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
    dashboard: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="2" y="9" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="9" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>,
  }
  return (
    <button className="flex items-center gap-2.5 rounded-md px-2 h-[30px] text-[14px] font-medium text-text-secondary hover:bg-hover hover:text-text transition-colors w-full text-left">
      <span className="text-text-dim shrink-0">{icons[icon]}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function NewViewInput({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()) }}
      className="px-1"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="View name..."
        className="w-full rounded-md border border-border glass-input px-2 py-1 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-accent"
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
        onBlur={() => { if (!name.trim()) onCancel() }}
      />
    </form>
  )
}

function relativeTime(unixSeconds: number): string {
  const now = Date.now() / 1000
  const diff = now - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const WORKSPACE_COLORS = [
  '#7a6b55', '#42a5f5', '#ff9100', '#ef5350', '#ab47bc',
  '#26c6da', '#ffd740', '#78909c', '#ec407a', '#7e57c2',
]

function AddWorkspaceModal({ workspaces, onClose, onCreate }: {
  workspaces: Workspace[]
  onClose: () => void
  onCreate: (name: string, color: string) => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(WORKSPACE_COLORS[0])
  const [copyFrom, setCopyFrom] = useState<number | null>(null)
  const [copySettings, setCopySettings] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Close on Escape
  useEffect(() => {
    function handler(e: globalThis.KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative glass-elevated rounded-xl border border-border shadow-2xl w-[440px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-[16px] font-semibold text-text">Add Workspace</h2>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:bg-hover hover:text-text transition-colors"
          >
            <IconX size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[13px] font-medium text-text-secondary mb-1.5">Name</label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing, Engineering..."
              className="w-full rounded-lg border border-border glass-input px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-dim focus:border-accent transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim(), color) }}
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-[13px] font-medium text-text-secondary mb-1.5">Color</label>
            <div className="flex gap-2">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full transition-all flex items-center justify-center"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px var(--bg-card), 0 0 0 4px ${c}` : 'none',
                  }}
                >
                  {color === c && (
                    <IconCheck size={12} style={{ color: '#fff' }} strokeWidth={1.8} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Copy settings toggle */}
          {workspaces.length > 0 && (
            <div>
              <button
                onClick={() => { setCopySettings(!copySettings); if (copySettings) setCopyFrom(null) }}
                className="flex items-center gap-2.5 w-full"
              >
                <div
                  className={`w-8 h-[18px] rounded-full transition-colors relative ${
                    copySettings ? 'bg-accent' : 'bg-border'
                  }`}
                >
                  <div
                    className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                      copySettings ? 'left-[16px]' : 'left-[2px]'
                    }`}
                  />
                </div>
                <span className="text-[13px] text-text-secondary">Copy settings from other workspace</span>
              </button>

              {copySettings && (
                <div className="mt-2 ml-[42px]">
                  <Dropdown
                    value={copyFrom != null ? String(copyFrom) : ''}
                    onChange={(v) => setCopyFrom(v ? Number(v) : null)}
                    placeholder="Select workspace..."
                    options={workspaces.map((ws) => ({ label: ws.name, value: String(ws.id) }))}
                    triggerClassName="w-full bg-[var(--bg-field)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[13px] text-text inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors"
                  />
                </div>
              )}
            </div>
          )}

          {/* Members placeholder */}
          <div>
            <label className="block text-[13px] font-medium text-text-secondary mb-1.5">Members</label>
            <div className="rounded-lg border border-border glass-input px-3 py-2.5 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="4" r="2" stroke="var(--accent)" strokeWidth="1.2" />
                  <path d="M2 11c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="var(--accent)" strokeWidth="1.2" />
                </svg>
              </div>
              <span className="text-[13px] text-text-dim">You (Owner)</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (name.trim()) onCreate(name.trim(), color) }}
            disabled={!name.trim()}
            className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-white bg-accent hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export function PlusIcon({ size = 14 }: { size?: number }) {
  return <IconPlus size={size} />
}
