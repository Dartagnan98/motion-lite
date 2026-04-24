'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from '@/components/sidebar/Sidebar'
import type { Workspace } from '@/lib/types'

const navItems = [
  {
    label: 'Home',
    href: '/home',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    label: 'Agenda',
    href: '/agenda',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    label: 'Tasks',
    href: '/projects-tasks',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
  {
    label: 'Chat',
    href: '/messages',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
      </svg>
    ),
  },
]

export function MobileNav({ workspaces }: { workspaces: Workspace[] }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  // Listen for open-mobile-drawer events (from other components)
  useEffect(() => {
    function handler() { setDrawerOpen(true) }
    window.addEventListener('open-mobile-drawer', handler)
    return () => window.removeEventListener('open-mobile-drawer', handler)
  }, [])

  const handleClose = useCallback(() => setDrawerOpen(false), [])

  return (
    <>
      {/* Floating + button with quick-create menu -- hidden on chat */}
      {!pathname.startsWith('/chat') && !pathname.startsWith('/messages') && (
        <QuickCreateButton />
      )}

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-border sm:hidden mobile-nav-safe">
        <div className="flex items-center justify-around h-[60px] px-1">
          {navItems.map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
            return (
              <a
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center gap-1 flex-1 py-1 relative"
              >
                {isActive && (
                  <div className="absolute -top-0.5 w-5 h-[3px] rounded-full bg-accent-text" />
                )}
                <span className={`relative z-10 transition-all ${isActive ? 'text-accent-text drop-shadow-[0_0_6px_rgba(59,155,143,0.5)]' : 'text-text-dim'}`}>
                  {item.icon}
                </span>
                <span className={`text-[12px] font-semibold relative z-10 ${
                  isActive ? 'text-accent-text' : 'text-text-dim'
                }`}>
                  {item.label}
                </span>
              </a>
            )
          })}

          {/* More button - navigates to /more page */}
          <a
            href="/more"
            className="flex flex-col items-center justify-center gap-1 flex-1 py-1 relative"
          >
            {pathname === '/more' && (
              <div className="absolute -top-0.5 w-5 h-[3px] rounded-full bg-accent-text" />
            )}
            <span className={`relative z-10 transition-all ${pathname === '/more' ? 'text-accent-text drop-shadow-[0_0_6px_rgba(59,155,143,0.5)]' : 'text-text-dim'}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </span>
            <span className={`text-[12px] font-semibold relative z-10 ${
              pathname === '/more' ? 'text-accent-text' : 'text-text-dim'
            }`}>
              More
            </span>
          </a>
        </div>
      </nav>

      {/* Sidebar drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={handleClose}
        />
      )}

      {/* Sidebar drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-[70] w-[300px] max-w-[85vw] glass border-r border-border transform transition-transform duration-300 ease-in-out sm:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-lg bg-hover text-text-dim hover:text-text"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Render sidebar content only when the drawer is actually open */}
        {drawerOpen ? <MobileDrawerSidebar workspaces={workspaces} /> : null}
      </div>
    </>
  )
}

/** Quick-create floating action button with popup menu */
function QuickCreateButton() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const items = [
    {
      label: 'Task',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      ),
      action: () => {
        setOpen(false)
        window.dispatchEvent(new CustomEvent('open-quick-create', { detail: 'task' }))
        router.push('/projects-tasks?create=task')
      },
    },
    {
      label: 'Doc',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
      ),
      action: async () => {
        setOpen(false)
        const res = await fetch('/api/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Untitled', workspaceId: 1 }),
        })
        const doc = await res.json()
        if (doc?.public_id) router.push(`/doc/${doc.public_id}`)
        else if (doc?.id) router.push(`/doc/${doc.id}`)
      },
    },
    {
      label: 'Project',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
        </svg>
      ),
      action: () => { setOpen(false); router.push('/projects-tasks?create=project') },
    },
    {
      label: 'Event',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
      action: () => { setOpen(false); router.push('/schedule?create=event') },
    },
  ]

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Menu items */}
      {open && (
        <div className="fixed bottom-[190px] right-4 z-50 sm:hidden flex flex-col gap-2 animate-glass-in">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="flex items-center gap-3 px-4 py-3 rounded-md glass-elevated text-text min-w-[150px] active:scale-95 transition-transform"
            >
              <span className="text-accent-text">{item.icon}</span>
              <span className="text-[14px] font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-[160px] right-4 z-50 sm:hidden w-14 h-14 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all duration-200 ${
          open ? 'bg-red-500 rotate-45' : 'bg-blue-600'
        } text-white`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </>
  )
}

/** Renders the sidebar content for the mobile drawer using the already-loaded workspace list */
function MobileDrawerSidebar({ workspaces }: { workspaces: Workspace[] }) {
  return (
    <div className="h-full overflow-y-auto [&_aside]:!flex [&_aside]:!relative [&_aside]:!border-r-0 [&_aside]:!w-full [&_aside]:!h-full">
      <Sidebar workspaces={workspaces} />
    </div>
  )
}
