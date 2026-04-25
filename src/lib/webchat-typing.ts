/**
 * In-memory typing indicator tracker for the public webchat SDK.
 *
 * We deliberately avoid persisting "is typing" to SQLite — it's a transient
 * signal that should disappear within ~10 seconds of inactivity, and SQLite
 * writes would be wasteful. This module keeps a simple keyed map with periodic
 * cleanup and serves both sides of the conversation:
 *
 *   - Visitor side (widget):  POST /api/webchat/:publicId/typing  { session, isTyping }
 *   - Agent side  (inbox):    GET  /api/crm/webchat/typing?widget_id=&session=
 *
 * Keys are `${widgetId}:${sessionToken}` for visitor typing state, and
 * `${widgetId}:${sessionToken}:agent:${userId}` for agent-side typing so the
 * visitor knows which human is typing.
 */

interface TypingEntry {
  isTyping: boolean
  lastSeen: number
  label: string | null
}

const STATE = new Map<string, TypingEntry>()
const FRESH_WINDOW_MS = 10_000

function key(widgetId: number, sessionToken: string): string {
  return `${widgetId}:${sessionToken}`
}

function agentKey(widgetId: number, sessionToken: string, userId: number): string {
  return `${widgetId}:${sessionToken}:agent:${userId}`
}

/** Visitor side — mark the session as typing or not. */
export function setVisitorTyping(widgetId: number, sessionToken: string, isTyping: boolean): void {
  if (!sessionToken) return
  STATE.set(key(widgetId, sessionToken), {
    isTyping,
    lastSeen: Date.now(),
    label: null,
  })
}

/** Agent side — mark a teammate as typing into the visitor's thread. */
export function setAgentTyping(
  widgetId: number,
  sessionToken: string,
  userId: number,
  userName: string,
  isTyping: boolean,
): void {
  if (!sessionToken) return
  STATE.set(agentKey(widgetId, sessionToken, userId), {
    isTyping,
    lastSeen: Date.now(),
    label: userName,
  })
}

/** Returns true if the visitor is actively typing within the 10s freshness window. */
export function isVisitorTyping(widgetId: number, sessionToken: string): boolean {
  const entry = STATE.get(key(widgetId, sessionToken))
  if (!entry || !entry.isTyping) return false
  return Date.now() - entry.lastSeen < FRESH_WINDOW_MS
}

/**
 * Returns the list of teammates currently typing into a session so we can
 * render "Client D is typing…" on the visitor side. Stale entries auto-expire.
 */
export function getAgentTyping(widgetId: number, sessionToken: string): string[] {
  const prefix = `${widgetId}:${sessionToken}:agent:`
  const now = Date.now()
  const out: string[] = []
  for (const [k, v] of STATE.entries()) {
    if (!k.startsWith(prefix)) continue
    if (!v.isTyping) continue
    if (now - v.lastSeen >= FRESH_WINDOW_MS) continue
    if (v.label) out.push(v.label)
  }
  return out
}

/** Periodic sweep — called lazily on every read to drop stale entries. */
function sweep() {
  const cutoff = Date.now() - FRESH_WINDOW_MS
  for (const [k, v] of STATE.entries()) {
    if (v.lastSeen < cutoff) STATE.delete(k)
  }
}

// Opportunistic background sweep so the map doesn't grow unbounded in long-
// running processes. We only start the interval when the module is imported
// at runtime; it's a noop under Next.js edge.
if (typeof globalThis.setInterval === 'function') {
  const g = globalThis as unknown as { __webchatTypingSweepStarted?: boolean }
  if (!g.__webchatTypingSweepStarted) {
    g.__webchatTypingSweepStarted = true
    setInterval(sweep, 30_000).unref?.()
  }
}
