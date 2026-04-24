'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function KeyboardShortcuts() {
  const router = useRouter()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't fire when typing in inputs
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return

      // Navigation shortcuts
      if (e.key === 'g') {
        // Wait for next key
        const handler = (e2: KeyboardEvent) => {
          window.removeEventListener('keydown', handler)
          switch (e2.key) {
            case 'h': router.push('/'); break
            case 'd': router.push('/dashboard'); break
            case 's': router.push('/schedule'); break
          }
        }
        window.addEventListener('keydown', handler)
        setTimeout(() => window.removeEventListener('keydown', handler), 1000)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [router])

  return null
}
