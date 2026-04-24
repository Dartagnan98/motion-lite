'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'

interface NavLink {
  label: string
  href: string
  icon: React.ReactNode
  badge?: number
  badgeColor?: string
  desc?: string
}

export default function MorePage() {
  const router = useRouter()
  const [inboxCount, setInboxCount] = useState(0)
  const [user, setUser] = useState<{ name?: string; avatar_url?: string } | null>(null)

  useEffect(() => {
    fetch('/api/inbox/count').then(r => r.json()).then(d => setInboxCount(d.count || 0)).catch(() => {})
    fetch('/api/settings').then(r => r.json()).then(s => setUser({ name: s.userName, avatar_url: s.avatarUrl })).catch(() => {})
  }, [])

  const mainLinks: NavLink[] = [
    {
      label: 'Inbox',
      href: '/inbox',
      badge: inboxCount,
      badgeColor: 'var(--red)',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3H10l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>,
    },
    {
      label: 'AI Agenda',
      href: '/agenda',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    },
    {
      label: 'Team Schedule',
      href: '/team-schedule',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
    },
    {
      label: 'AI Meeting Notes',
      href: '/meeting-notes',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
    },
    {
      label: 'AI Employees',
      href: '/agents',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>,
    },
    {
      label: 'Clients',
      href: '/clients',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
    },
    {
      label: 'Skills',
      href: '/agents?tab=skills',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
    },
    {
      label: 'Database',
      href: '/database',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>,
    },
  ]

  const settingsLinks: NavLink[] = [
    {
      label: 'Settings',
      href: '/settings',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
    },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 pt-6 pb-4">
        {/* Profile header */}
        <div className="flex items-center gap-3 mb-6">
          <Avatar name={user?.name || 'Operator'} size={48} src={user?.avatar_url} />
          <div>
            <div className="text-[14px] font-semibold text-text">{user?.name || 'Operator'}</div>
            <div className="text-[12px] text-text-dim">Motion Lite</div>
          </div>
        </div>

        {/* Main navigation */}
        <div className="space-y-1.5 stagger-children">
          {mainLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-hover/60 active:bg-elevated transition-all duration-200 hover:translate-x-0.5"
            >
              <span className="text-text-dim">{link.icon}</span>
              <span className="flex-1 text-[14px] text-text font-medium">{link.label}</span>
              {link.badge ? (
                <span
                  className="min-w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-bold text-white px-1.5"
                  style={{ background: link.badgeColor || 'var(--accent)' }}
                >
                  {link.badge}
                </span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-dim">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </a>
          ))}
        </div>

        {/* Divider */}
        <div className="glass-divider my-4" />

        {/* Settings */}
        <div className="space-y-1">
          {settingsLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-hover active:bg-elevated transition-colors"
            >
              <span className="text-text-dim">{link.icon}</span>
              <span className="flex-1 text-[14px] text-text font-medium">{link.label}</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-dim">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
        </div>

        {/* Version */}
        <div className="mt-8 text-center text-[11px] text-text-dim">
          Motion Lite v1.0
        </div>
      </div>
    </div>
  )
}
