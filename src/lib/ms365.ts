// Microsoft 365 (Microsoft Graph) Calendar OAuth + Graph helpers.
//
// Mirrors the pattern in src/lib/google.ts but writes into the multi-provider
// crm_user_calendar_accounts table (provider='microsoft', see DB CHECK
// constraint) instead of a dedicated google_accounts table.
//
// Storage decision: per-calendar visibility/primary flags live INSIDE the
// account row's calendars_json column (no parallel ms365_calendars table).
// Each entry has shape:
//   { id, name, color, visible, is_primary, default_busy_status }
//
// Env vars (all read lazily — routes return 503 if missing, never 500):
//   MS365_CLIENT_ID       Azure AD app's web client id
//   MS365_CLIENT_SECRET   Azure AD app's secret VALUE (not the secret id)
//   MS365_REDIRECT_URI    e.g. http://localhost:4000/api/ms365/callback
//   MS365_TENANT_ID       defaults to 'common' (multi-tenant + personal)
//
// Token encryption reuses encryptToken/decryptToken from src/lib/supabase
// (matches the existing calendar-sync.ts pattern for crm_user_calendar_accounts).

import crypto from 'crypto'
import { encryptToken, decryptToken } from './supabase'
import {
  getCrmUserCalendarAccountById,
  upsertCrmUserCalendarAccount,
  updateCrmUserCalendarAccountTokens,
  updateCrmUserCalendarAccountCalendarsJson,
  type CrmUserCalendarAccount,
} from './db'

// ─── Config (lazy) ────────────────────────────────────────────────────────────

export interface Ms365Config {
  clientId: string
  clientSecret: string
  redirectUri: string
  tenantId: string
}

export class Ms365NotConfiguredError extends Error {
  constructor(missing: string) {
    super(`${missing} not configured. See README — Azure AD App Setup.`)
    this.name = 'Ms365NotConfiguredError'
  }
}

/** Read MS365 env vars on demand. Throws Ms365NotConfiguredError if missing so
 *  route handlers can map to a clean 503 instead of a 500. */
export function readMs365Config(): Ms365Config {
  const clientId = process.env.MS365_CLIENT_ID
  if (!clientId) throw new Ms365NotConfiguredError('MS365_CLIENT_ID')
  const clientSecret = process.env.MS365_CLIENT_SECRET
  if (!clientSecret) throw new Ms365NotConfiguredError('MS365_CLIENT_SECRET')
  const redirectUri =
    process.env.MS365_REDIRECT_URI ||
    'http://localhost:4000/api/ms365/callback'
  const tenantId = process.env.MS365_TENANT_ID || 'common'
  return { clientId, clientSecret, redirectUri, tenantId }
}

export function isMs365Configured(): boolean {
  return !!process.env.MS365_CLIENT_ID && !!process.env.MS365_CLIENT_SECRET
}

// ─── PKCE + state ─────────────────────────────────────────────────────────────

export const MS365_OAUTH_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
] as const

export interface PkceCookiePayload {
  state: string
  code_verifier: string
  user_id: number
  workspace_id: number
  /** Unix seconds — used to expire stale state cookies */
  exp: number
}

const STATE_COOKIE = 'ms365_oauth_state'
const STATE_TTL_SECONDS = 10 * 60

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32))
  const challenge = base64UrlEncode(
    crypto.createHash('sha256').update(verifier).digest(),
  )
  return { verifier, challenge }
}

export function buildAuthUrl(args: {
  state: string
  codeChallenge: string
}): string {
  const cfg = readMs365Config()
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: MS365_OAUTH_SCOPES.join(' '),
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize?${params.toString()}`
}

/** Sign a state-cookie payload with HMAC. Stored in an httpOnly cookie until
 *  the callback comes back. Format: `<b64u_json>.<hex_hmac>`. */
export function packStateCookie(payload: PkceCookiePayload): string {
  const secret =
    process.env.AUTH_SECRET ||
    process.env.CRM_ENCRYPTION_KEY ||
    'dev-insecure-state-secret'
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, 'utf8').toString('base64url')
  const mac = crypto.createHmac('sha256', secret).update(b64).digest('hex')
  return `${b64}.${mac}`
}

export function unpackStateCookie(cookie: string): PkceCookiePayload | null {
  if (!cookie || typeof cookie !== 'string') return null
  const dot = cookie.lastIndexOf('.')
  if (dot <= 0 || dot === cookie.length - 1) return null
  const b64 = cookie.slice(0, dot)
  const provided = cookie.slice(dot + 1)
  const secret =
    process.env.AUTH_SECRET ||
    process.env.CRM_ENCRYPTION_KEY ||
    'dev-insecure-state-secret'
  let expected: string
  try {
    expected = crypto.createHmac('sha256', secret).update(b64).digest('hex')
  } catch {
    return null
  }
  if (expected.length !== provided.length) return null
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided)))
      return null
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(b64, 'base64url').toString('utf8'),
    ) as PkceCookiePayload
    if (typeof parsed.state !== 'string') return null
    if (typeof parsed.code_verifier !== 'string') return null
    if (typeof parsed.user_id !== 'number') return null
    if (typeof parsed.workspace_id !== 'number') return null
    if (typeof parsed.exp !== 'number') return null
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null
    return parsed
  } catch {
    return null
  }
}

export const MS365_STATE_COOKIE_NAME = STATE_COOKIE
export const MS365_STATE_COOKIE_TTL_SECONDS = STATE_TTL_SECONDS

// ─── Code exchange ────────────────────────────────────────────────────────────

export interface MsTokenResponse {
  access_token: string
  refresh_token: string | null
  expires_in: number
  scope: string | null
}

export async function exchangeCode(args: {
  code: string
  codeVerifier: string
}): Promise<MsTokenResponse> {
  const cfg = readMs365Config()
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code: args.code,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: args.codeVerifier,
        scope: MS365_OAUTH_SCOPES.join(' '),
      }),
    },
  )
  const data = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !data.access_token) {
    throw new Error(
      `ms365.exchangeCode failed (${res.status}): ${data.error || 'unknown'}: ${data.error_description || JSON.stringify(data)}`,
    )
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in: data.expires_in ?? 3600,
    scope: data.scope || null,
  }
}

// ─── /me ──────────────────────────────────────────────────────────────────────

export interface GraphMe {
  id: string
  mail: string | null
  userPrincipalName: string | null
  displayName: string | null
}

export async function fetchMe(accessToken: string): Promise<GraphMe> {
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ms365.fetchMe failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as Partial<GraphMe>
  if (!data.id) throw new Error('ms365.fetchMe: response missing id')
  return {
    id: data.id,
    mail: data.mail ?? null,
    userPrincipalName: data.userPrincipalName ?? null,
    displayName: data.displayName ?? null,
  }
}

// ─── /me/calendars ────────────────────────────────────────────────────────────

export interface GraphCalendar {
  id: string
  name: string
  hexColor?: string | null
  color?: string | null
  isDefaultCalendar?: boolean
  canEdit?: boolean
  owner?: { name?: string; address?: string }
}

/** Microsoft's named colors → hex fallbacks. Graph returns `color` as a string
 *  name like 'lightBlue' on personal accounts; `hexColor` populated on M365
 *  accounts. We coerce to hex for the frontend. */
const MS_COLOR_MAP: Record<string, string> = {
  auto: '#0078d4',
  lightBlue: '#0078d4',
  lightGreen: '#107c10',
  lightOrange: '#ca5010',
  lightGray: '#737373',
  lightYellow: '#ffaa44',
  lightTeal: '#038387',
  lightPink: '#e3008c',
  lightBrown: '#8e562e',
  lightRed: '#d13438',
  maxColor: '#0078d4',
}

function resolveCalendarColor(cal: GraphCalendar): string {
  if (cal.hexColor && /^#[0-9a-fA-F]{6}$/.test(cal.hexColor)) return cal.hexColor
  if (cal.color && MS_COLOR_MAP[cal.color]) return MS_COLOR_MAP[cal.color]
  return '#0078d4'
}

export async function fetchCalendarList(
  accessToken: string,
): Promise<GraphCalendar[]> {
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit,owner&$top=100',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ms365.fetchCalendarList failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as { value?: GraphCalendar[] }
  return data.value || []
}

// ─── Stored calendar shape (what we write into calendars_json) ───────────────

/** Mirrors the shape returned by /api/google/calendars so the frontend can
 *  share row components. `default_busy_status` only matters when this account
 *  is used for free/busy conflict detection. */
export interface StoredMs365Calendar {
  id: string
  name: string
  color: string
  visible: boolean
  is_primary: boolean
  default_busy_status: string // 'busy' | 'free'
  can_edit: boolean
}

export function toStoredCalendar(cal: GraphCalendar): StoredMs365Calendar {
  return {
    id: cal.id,
    name: cal.name || 'Untitled',
    color: resolveCalendarColor(cal),
    visible: true,
    is_primary: !!cal.isDefaultCalendar,
    default_busy_status: 'busy',
    can_edit: cal.canEdit !== false,
  }
}

export function parseStoredCalendars(
  json: string | null | undefined,
): StoredMs365Calendar[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: typeof c.color === 'string' ? c.color : '#0078d4',
        visible: c.visible !== false,
        is_primary: !!c.is_primary,
        default_busy_status:
          c.default_busy_status === 'free' ? 'free' : 'busy',
        can_edit: c.can_edit !== false,
      }))
  } catch {
    return []
  }
}

// ─── Token refresh ────────────────────────────────────────────────────────────

const refreshLocks = new Map<number, Promise<string>>()

async function callRefreshEndpoint(
  refreshToken: string,
): Promise<MsTokenResponse> {
  const cfg = readMs365Config()
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: MS365_OAUTH_SCOPES.join(' '),
      }),
    },
  )
  const data = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !data.access_token) {
    throw new Error(
      `ms365.refresh failed (${res.status}): ${data.error || 'unknown'}: ${data.error_description || JSON.stringify(data)}`,
    )
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in: data.expires_in ?? 3600,
    scope: data.scope || null,
  }
}

/** Force-refresh an account's access token. Persists the new token + expiry.
 *  Returns the new plaintext access token. */
export async function refreshMs365AccessToken(
  accountId: number,
): Promise<string> {
  const account = getCrmUserCalendarAccountById(accountId)
  if (!account) throw new Error(`ms365.refresh: account ${accountId} not found`)
  if (account.provider !== 'microsoft') {
    throw new Error(`ms365.refresh: account ${accountId} is not a microsoft account`)
  }
  if (!account.refresh_token_encrypted) {
    throw new Error(`ms365.refresh: account ${accountId} has no refresh token`)
  }
  const refreshToken = decryptToken(account.refresh_token_encrypted)
  const fresh = await callRefreshEndpoint(refreshToken)
  const tokenExpiresAt = Math.floor(Date.now() / 1000) + fresh.expires_in
  updateCrmUserCalendarAccountTokens(accountId, {
    accessTokenEncrypted: encryptToken(fresh.access_token),
    refreshTokenEncrypted: fresh.refresh_token
      ? encryptToken(fresh.refresh_token)
      : null, // null means "keep existing"
    tokenExpiresAt,
  })
  return fresh.access_token
}

/** Return a known-valid access token, refreshing if within REFRESH_BUFFER s of
 *  expiry. Concurrent callers share the same refresh promise per account. */
const REFRESH_BUFFER_SECONDS = 60
export async function getValidMs365AccessToken(
  accountId: number,
): Promise<string> {
  const account = getCrmUserCalendarAccountById(accountId)
  if (!account) throw new Error(`ms365: account ${accountId} not found`)
  if (!account.access_token_encrypted) {
    throw new Error(`ms365: account ${accountId} has no access token`)
  }
  const now = Math.floor(Date.now() / 1000)
  if (
    account.token_expires_at &&
    account.token_expires_at > now + REFRESH_BUFFER_SECONDS
  ) {
    return decryptToken(account.access_token_encrypted)
  }
  const existing = refreshLocks.get(accountId)
  if (existing) return existing
  const promise = refreshMs365AccessToken(accountId).finally(() => {
    refreshLocks.delete(accountId)
  })
  refreshLocks.set(accountId, promise)
  return promise
}

// ─── End-to-end connect helper ───────────────────────────────────────────────

/** Used by the OAuth callback. Exchanges code, fetches /me, fetches /me/calendars,
 *  writes one crm_user_calendar_accounts row with encrypted tokens and the
 *  calendars_json blob. Returns the upserted account. */
export async function completeConnect(args: {
  userId: number
  workspaceId: number
  code: string
  codeVerifier: string
}): Promise<CrmUserCalendarAccount> {
  const tokens = await exchangeCode({
    code: args.code,
    codeVerifier: args.codeVerifier,
  })
  const me = await fetchMe(tokens.access_token)
  const calendars = await fetchCalendarList(tokens.access_token)
  const storedCalendars = calendars.map(toStoredCalendar)

  // Ensure exactly one is_primary
  if (!storedCalendars.some((c) => c.is_primary) && storedCalendars[0]) {
    storedCalendars[0].is_primary = true
  }

  const displayEmail = me.mail || me.userPrincipalName || null
  const tokenExpiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in

  const account = upsertCrmUserCalendarAccount({
    userId: args.userId,
    workspaceId: args.workspaceId,
    provider: 'microsoft',
    providerAccountId: me.id,
    displayEmail,
    accessTokenEncrypted: encryptToken(tokens.access_token),
    refreshTokenEncrypted: tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : null,
    tokenExpiresAt,
    calendarsJson: JSON.stringify(storedCalendars),
  })
  return account
}

/** Apply visibility / primary / default_busy_status flags to a single
 *  calendar inside an account's calendars_json. Returns the new array. */
export function applyCalendarToggle(args: {
  account: CrmUserCalendarAccount
  calendarId: string
  visible?: boolean
  default_busy_status?: 'busy' | 'free'
  set_primary?: boolean
}): StoredMs365Calendar[] {
  const list = parseStoredCalendars(args.account.calendars_json)
  let touched = false
  for (const cal of list) {
    if (cal.id === args.calendarId) {
      if (typeof args.visible === 'boolean') cal.visible = args.visible
      if (
        args.default_busy_status === 'busy' ||
        args.default_busy_status === 'free'
      ) {
        cal.default_busy_status = args.default_busy_status
      }
      touched = true
    }
  }
  if (!touched) return list
  if (args.set_primary) {
    for (const cal of list) {
      cal.is_primary = cal.id === args.calendarId
    }
  }
  return list
}

/** Flatten one account's stored calendars into the shape that
 *  /api/ms365/calendars exposes (matches /api/google/calendars). */
export function flattenAccountCalendars(
  account: CrmUserCalendarAccount,
): Array<{
  id: string
  account_id: number
  name: string
  color: string
  visible: number
  is_primary: number
  default_busy_status: string
}> {
  const stored = parseStoredCalendars(account.calendars_json)
  return stored.map((c) => ({
    id: c.id,
    account_id: account.id,
    name: c.name,
    color: c.color,
    visible: c.visible ? 1 : 0,
    is_primary: c.is_primary ? 1 : 0,
    default_busy_status: c.default_busy_status,
  }))
}

/** Convenience: re-write calendars_json on an account. Thin wrapper for callers
 *  that already have an updated list in memory. */
export function persistCalendarsJson(
  accountId: number,
  calendars: StoredMs365Calendar[],
): void {
  updateCrmUserCalendarAccountCalendarsJson(accountId, JSON.stringify(calendars))
}
