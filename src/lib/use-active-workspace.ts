'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'active-workspace-id'
const EVENT_NAME = 'workspace-changed'

function readStoredId(storage: Storage | null | undefined): number | null {
  if (!storage) return null
  const raw = storage.getItem(STORAGE_KEY)
  const parsed = raw ? Number(raw) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function getActiveWorkspaceId(): number | null {
  if (typeof window === 'undefined') return null
  return readStoredId(window.sessionStorage) ?? readStoredId(window.localStorage)
}

export function setActiveWorkspaceId(id: number, options?: { persistGlobal?: boolean }) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(STORAGE_KEY, String(id))
  if (options?.persistGlobal !== false) {
    window.localStorage.setItem(STORAGE_KEY, String(id))
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { workspaceId: id } }))
}

export function useActiveWorkspace() {
  const [workspaceId, setWorkspaceId] = useState<number | null>(() => getActiveWorkspaceId())

  useEffect(() => {
    function handler(e: Event) {
      const id = (e as CustomEvent).detail?.workspaceId
      if (id) setWorkspaceId(id)
    }
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  const setActive = useCallback((id: number, options?: { persistGlobal?: boolean }) => {
    setActiveWorkspaceId(id, options)
    setWorkspaceId(id)
  }, [])

  return { workspaceId, setActive }
}
