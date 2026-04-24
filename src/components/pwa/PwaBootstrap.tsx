'use client'

import { useEffect } from 'react'
import { type BeforeInstallPromptEvent, setStoredInstallPrompt } from '@/lib/pwa-browser'

export function PwaBootstrap() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js?v=8').catch(() => {})
  }, [])

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      const promptEvent = event as BeforeInstallPromptEvent
      promptEvent.preventDefault()
      setStoredInstallPrompt(promptEvent)
    }

    function handleInstalled() {
      setStoredInstallPrompt(null)
      try {
        window.localStorage.removeItem('crm-mobile-install-dismissed')
      } catch {
        // ignore storage failures
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  return null
}
