// Lightweight client-side helper for the CTRL pixel cid cookie/localStorage.
// Replaces the old funnel-browser.ts -- funnels are gone, but we still want
// anonymous visitor ids for pixel -> contact attribution.

const CTRL_CID_KEY = 'ctrl_cid'

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readStored(key: string): string {
  if (!canUseStorage()) return ''
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writeStored(key: string, value: string): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore storage failures in private mode or restrictive browsers
  }
}

function generateId(): string {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function ensureCtrlCid(): string {
  const existing = readStored(CTRL_CID_KEY)
  if (existing) return existing
  const fresh = generateId()
  writeStored(CTRL_CID_KEY, fresh)
  return fresh
}
