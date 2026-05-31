// GSC connect flow — high-level orchestration that route handlers call.
//
// frontend-eng or whoever wires the "Connect GSC" button will use these.
// Two phases:
//   1) startConnect()   → returns redirect URL; user goes to Google
//   2) finishConnect()  → called from /api/platform/integrations/gsc/callback
//                         after Google sends them back with code + state.
//
// finishConnect() lists the user's verified GSC sites and lets the caller pick
// which one to attach. We keep that decision in the route handler / UI; this
// file's job is just to translate `code → tokens → site list → integration row`.

import { exchangeCode, listSites, persistIntegration } from './oauth'
import { ensurePlatformReady } from '../../tenant'
import { verifyState } from '../../state'

export interface StartConnectArgs {
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
  redirectUri: string
}

export interface CallbackState {
  provider: 'gsc'
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
}

/** Verify the HMAC-signed state param Google returns and decode the payload.
 *  Throws if the signature is invalid, the payload is malformed, or any
 *  required field is missing. A failed verification means the state was
 *  tampered with (or generated outside our server) — reject the callback. */
export function decodeState(stateParam: string): CallbackState {
  const parsed = verifyState<Partial<CallbackState>>(stateParam)
  if (!parsed) {
    throw new Error('gsc.connect-flow: state failed HMAC verification (forged or tampered)')
  }
  if (parsed.provider !== 'gsc') {
    throw new Error(`gsc.connect-flow: state has wrong provider "${parsed.provider}"`)
  }
  if (typeof parsed.tenantId !== 'number') {
    throw new Error('gsc.connect-flow: state missing tenantId')
  }
  if (parsed.level !== 'agency' && parsed.level !== 'account' && parsed.level !== 'domain') {
    throw new Error(`gsc.connect-flow: state has invalid level "${parsed.level}"`)
  }
  return parsed as CallbackState
}

export interface SiteChoice {
  siteUrl: string
  permissionLevel: string
}

export interface FinishConnectStage1Result {
  exchange: {
    access_token: string
    refresh_token: string | null
    expires_in: number
    email: string | null
    scopes: string
  }
  sites: SiteChoice[]
  state: CallbackState
}

/** First half of the callback: exchange code, list sites. The route handler
 *  then renders a "pick your site" UI and posts back to completeConnect. */
export async function finishConnectStage1(args: {
  code: string
  state: string
  redirectUri: string
}): Promise<FinishConnectStage1Result> {
  ensurePlatformReady()
  const decoded = decodeState(args.state)
  const exchange = await exchangeCode({ code: args.code, redirectUri: args.redirectUri })
  const sitesResp = await listSites(exchange.access_token)
  const sites: SiteChoice[] = (sitesResp.siteEntry || [])
    // Only sites the user has at least restricted-read access to.
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
  return { exchange, sites, state: decoded }
}

/** Second half: user picked a siteUrl, now persist the integration. Either a
 *  fresh `exchange` (adopted into the tenant credential store) or a
 *  `tenantCredentialId` (reuse an existing shared Google credential). */
export function completeConnect(args: {
  state: CallbackState
  siteUrl: string
  exchange?: FinishConnectStage1Result['exchange']
  tenantCredentialId?: number
}): { integrationId: number } {
  return persistIntegration({
    tenantId: args.state.tenantId,
    level: args.state.level,
    agencyId: args.state.agencyId,
    accountId: args.state.accountId,
    domainId: args.state.domainId,
    siteUrl: args.siteUrl,
    email: args.exchange?.email ?? null,
    exchange: args.exchange,
    tenantCredentialId: args.tenantCredentialId,
  })
}
