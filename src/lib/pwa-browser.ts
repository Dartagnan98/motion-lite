'use client'

import { useEffect, useState } from 'react'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Navigator {
    standalone?: boolean
  }

  interface Window {
    __ctrlBeforeInstallPrompt?: BeforeInstallPromptEvent | null
  }
}

const INSTALL_EVENT_NAME = 'ctrl-pwa-install-prompt'

function notifyPromptChange() {
  window.dispatchEvent(new CustomEvent(INSTALL_EVENT_NAME))
}

export function setStoredInstallPrompt(event: BeforeInstallPromptEvent | null) {
  if (typeof window === 'undefined') return
  window.__ctrlBeforeInstallPrompt = event
  notifyPromptChange()
}

export function getStoredInstallPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null
  return window.__ctrlBeforeInstallPrompt ?? null
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function usePwaInstallPrompt() {
  const [available, setAvailable] = useState(() => {
    if (typeof window === 'undefined') return false
    return !isStandaloneDisplayMode() && Boolean(getStoredInstallPrompt())
  })
  const [installed, setInstalled] = useState(() => isStandaloneDisplayMode())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => {
      setInstalled(isStandaloneDisplayMode())
      setAvailable(!isStandaloneDisplayMode() && Boolean(getStoredInstallPrompt()))
    }
    update()
    window.addEventListener(INSTALL_EVENT_NAME, update)
    window.addEventListener('appinstalled', update)
    return () => {
      window.removeEventListener(INSTALL_EVENT_NAME, update)
      window.removeEventListener('appinstalled', update)
    }
  }, [])

  async function promptInstall() {
    const event = getStoredInstallPrompt()
    if (!event) return null
    await event.prompt()
    const choice = await event.userChoice
    setStoredInstallPrompt(null)
    return choice
  }

  return {
    available,
    installed,
    promptInstall,
  }
}
