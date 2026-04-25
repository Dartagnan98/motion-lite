'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from '@/components/crm/CrmMobileNav.module.css'
import { IconChevronRight } from '@/components/ui/Icons'
import { usePwaInstallPrompt } from '@/lib/pwa-browser'

export type CrmMobilePrimaryItem = {
  href: string
  label: string
  active: boolean
  icon: React.ReactNode
}

export type CrmMobileMoreItem = {
  href: string
  label: string
  active: boolean
}

export function CrmMobileNav({
  pathname,
  primaryItems,
  moreItems,
}: {
  pathname: string
  primaryItems: CrmMobilePrimaryItem[]
  moreItems: CrmMobileMoreItem[]
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [installDismissed, setInstallDismissed] = useState(false)
  const { available, promptInstall } = usePwaInstallPrompt()

  useEffect(() => {
    setSheetOpen(false)
  }, [pathname])

  useEffect(() => {
    try {
      setInstallDismissed(window.localStorage.getItem('crm-mobile-install-dismissed') === '1')
    } catch {
      setInstallDismissed(false)
    }
  }, [])

  useEffect(() => {
    if (!sheetOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [sheetOpen])

  function dismissInstall() {
    setInstallDismissed(true)
    try {
      window.localStorage.setItem('crm-mobile-install-dismissed', '1')
    } catch {
      // ignore storage failures
    }
  }

  const showInstall = available && !installDismissed
  const moreActive = moreItems.some((item) => item.active)

  return (
    <>
      {showInstall && (
        <div className={styles.installBanner}>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Install app</span>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Pin Motion Lite for faster replies and schedule checks on your phone.</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Install now to launch straight into Today and keep push ready when delivery wiring lands.</div>
          </div>
          <div className={styles.installActions}>
            <button type="button" onClick={dismissInstall} className={styles.inlineButton} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Later</button>
            <button
              type="button"
              onClick={() => {
                promptInstall().catch(() => {})
              }}
              className={`${styles.inlineButton} ${styles.inlineButtonAccent}`}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              Install
            </button>
          </div>
        </div>
      )}

      {sheetOpen && <button type="button" aria-label="Close more menu" className={styles.scrim} onClick={() => setSheetOpen(false)} />}

      {sheetOpen && (
        <div className={styles.sheetWrap}>
          <div id="crm-mobile-more-sheet" className={styles.sheet}>
            <div className={styles.sheetHeader}>
              <div className={styles.sheetHandle} />
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>More</span>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Marketing, automation, payments, reports, and settings.</div>
              </div>
            </div>
            <div className={styles.sheetItems}>
              {moreItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.sheetItem} ${item.active ? styles.sheetItemActive : ''}`}
                >
                  <span style={{ fontSize: 14, color: item.active ? 'var(--text)' : 'var(--text-secondary)' }}>{item.label}</span>
                  <IconChevronRight size={14} className="text-[var(--text-dim)]" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className={styles.mobileNav} aria-label="CRM mobile navigation">
        <div className={styles.mobileNavInner}>
          {primaryItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileNavItem} ${item.active ? styles.mobileNavItemActive : ''}`}
            >
              {item.active && <span className={styles.mobileNavDot} />}
              <span aria-hidden>{item.icon}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setSheetOpen((open) => !open)}
            className={`${styles.mobileNavItem} ${moreActive || sheetOpen ? styles.mobileNavItemActive : ''}`}
            aria-expanded={sheetOpen}
            aria-controls="crm-mobile-more-sheet"
          >
            {(moreActive || sheetOpen) && <span className={styles.mobileNavDot} />}
            <span aria-hidden>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M4 6.5h12M4 10h12M4 13.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
