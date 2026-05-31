// GA4 connect flow — high-level orchestration that route handlers call.
//
// Two phases (mirror of GSC):
//   1) startConnect() via adapter.connect() → returns redirect URL; user goes to Google.
//   2) finishConnectStage1() → called from /api/platform/integrations/ga4/callback
//      Exchanges code, lists properties, returns them for the UI to show a picker.
//   3) completeConnect() → user picked a property; persist integration + token.
//
// This file is the seam between route handlers (which own HTTP concerns) and
// oauth.ts (which owns token lifecycle). Neither file touches DB directly except
// through oauth.ts:persistIntegration.

import { exchangeCode, listProperties, persistIntegration } from './oauth'
import { ensurePlatformReady } from '../../tenant'
import { verifyState } from '../../state'
import type { ExchangeResult, GA4PropertyChoice } from './oauth'

export interface CallbackState {
  provider: 'ga4'
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
}

/** Verify the HMAC-signed state param returned by Google and decode the payload.
 *  Throws if the signature is invalid, the payload is malformed, or required
 *  fields are missing. A failed verification = state was tampered with. */
export function decodeState(stateParam: string): CallbackState {
  const parsed = verifyState<Partial<CallbackState>>(stateParam)
  if (!parsed) {
    throw new Error('ga4.connect-flow: state failed HMAC verification (forged or tampered)')
  }
  if (parsed.provider !== 'ga4') {
    throw new Error(`ga4.connect-flow: state has wrong provider "${parsed.provider}"`)
  }
  if (typeof parsed.tenantId !== 'number') {
    throw new Error('ga4.connect-flow: state missing tenantId')
  }
  if (parsed.level !== 'agency' && parsed.level !== 'account' && parsed.level !== 'domain') {
    throw new Error(`ga4.connect-flow: state has invalid level "${parsed.level}"`)
  }
  return parsed as CallbackState
}

export interface FinishConnectStage1Result {
  exchange: ExchangeResult
  properties: GA4PropertyChoice[]
  state: CallbackState
}

/** First half of the callback: exchange code, list GA4 properties. The route
 *  handler renders a "pick your property" UI and POSTs back to completeConnect. */
export async function finishConnectStage1(args: {
  code: string
  state: string
  redirectUri: string
}): Promise<FinishConnectStage1Result> {
  ensurePlatformReady()
  const decoded = decodeState(args.state)
  const exchange = await exchangeCode({ code: args.code, redirectUri: args.redirectUri })
  const properties = await listProperties(exchange.access_token)
  return { exchange, properties, state: decoded }
}

/** Second half: user picked a propertyId; persist the integration + token. */
export function completeConnect(args: {
  state: CallbackState
  propertyId: string
  propertyDisplayName: string
  exchange?: ExchangeResult
  tenantCredentialId?: number
}): { integrationId: number } {
  return persistIntegration({
    tenantId: args.state.tenantId,
    level: args.state.level,
    agencyId: args.state.agencyId,
    accountId: args.state.accountId,
    domainId: args.state.domainId,
    propertyId: args.propertyId,
    propertyDisplayName: args.propertyDisplayName,
    email: args.exchange?.email ?? null,
    exchange: args.exchange,
    tenantCredentialId: args.tenantCredentialId,
  })
}
