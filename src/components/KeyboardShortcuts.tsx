'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function KeyboardShortcuts() {
  const router = useRouter()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger when typing in inputs, textareas, or contenteditable
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return

      // Navigation shortcuts
      if (e.key === 'g') {
        // Wait for second key
        const handler = (e2: KeyboardEvent) => {
          document.removeEventListener('keydown', handler)
          clearTimeout(timeout)
          switch (e2.key) {
            case 'c': router.push('/schedule'); break // Go to Calendar
            case 't': router.push('/projects-tasks'); break // Go to Tasks
            case 'a': router.push('/agenda'); break // Go to Agenda
            case 'i': router.push('/inbox'); break // Go to Inbox
            case 's': router.push('/settings'); break // Go to Settings
            case 'd': router.push('/dashboard'); break // Go to Dashboard
          }
        }
        const timeout = setTimeout(() => document.removeEventListener('keydown', handler), 1000)
        document.addEventListener('keydown', handler, { once: true })
        return
      }

      // Quick actions
      if (e.key === 'Escape') {
        // Close any open panels - dispatch custom event
        window.dispatchEvent(new CustomEvent('close-panels'))
      }

      if (e.key === '?' && e.shiftKey) {
        // Show shortcuts help
        window.dispatchEvent(new CustomEvent('toggle-shortcuts-help'))
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [router])

  return null // no UI, just event listeners
}
