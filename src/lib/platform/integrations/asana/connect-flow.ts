// Asana connect flow — high-level orchestration that route handlers call.
//
// Three phases (mirrors GA4):
//   1) startConnect() via adapter.connect() → returns redirect URL; browser goes to Asana.
//   2) finishConnectStage1() → called from /api/platform/integrations/asana/callback
//      Exchanges code + lists workspaces. Returns them for the UI workspace picker.
//   3) completeConnect() → user picked a workspace; persist integration + token.
//
// This file is the seam between route handlers (HTTP concerns) and oauth.ts
// (token lifecycle). Neither file touches DB directly except via oauth.ts:persistIntegration.

import { exchangeCode, listWorkspaces, persistIntegration } from './oauth'
import { ensurePlatformReady } from '../../tenant'
import { verifyState } from '../../state'
import type { ExchangeResult, AsanaWorkspaceChoice } from './oauth'

export interface CallbackState {
  provider: 'asana'
  tenantId: number
  level: 'agency' | 'account' | 'domain'
  agencyId: number | null
  accountId: number | null
  domainId: number | null
}

/** Verify the HMAC-signed state param returned by Asana and decode the payload.
 *  Throws if the signature is invalid, payload is malformed, or required fields
 *  are missing. A failed verification = state was tampered with. */
export function decodeState(stateParam: string): CallbackState {
  const parsed = verifyState<Partial<CallbackState>>(stateParam)
  if (!parsed) {
    throw new Error('asana.connect-flow: state failed HMAC verification (forged or tampered)')
  }
  if (parsed.provider !== 'asana') {
    throw new Error(`asana.connect-flow: state has wrong provider "${parsed.provider}"`)
  }
  if (typeof parsed.tenantId !== 'number') {
    throw new Error('asana.connect-flow: state missing tenantId')
  }
  if (parsed.level !== 'agency' && parsed.level !== 'account' && parsed.level !== 'domain') {
    throw new Error(`asana.connect-flow: state has invalid level "${parsed.level}"`)
  }
  return parsed as CallbackState
}

export interface FinishConnectStage1Result {
  exchange: ExchangeResult
  workspaces: AsanaWorkspaceChoice[]
  state: CallbackState
}

/** First half of the callback: exchange code, list Asana workspaces.
 *  The route handler renders a "pick your workspace" UI and POSTs back to
 *  completeConnect with the chosen workspaceId. */
export async function finishConnectStage1(args: {
  code: string
  state: string
  redirectUri: string
}): Promise<FinishConnectStage1Result> {
  ensurePlatformReady()
  const decoded = decodeState(args.state)
  const exchange = await exchangeCode({ code: args.code, redirectUri: args.redirectUri })
  const workspaces = await listWorkspaces(exchange.access_token)
  return { exchange, workspaces, state: decoded }
}

/** Second half: user picked a workspace + scope; persist the integration + token. */
export function completeConnect(args: {
  state: CallbackState
  workspaceId: string
  workspaceDisplayName: string
  scope?: 'portfolio' | 'projects'
  portfolioId?: string
  portfolioName?: string
  projectIds?: string[]
  projectNames?: string[]
  exchange: ExchangeResult
}): { integrationId: number } {
  const email = args.exchange.data?.email ?? null
  return persistIntegration({
    tenantId: args.state.tenantId,
    level: args.state.level,
    agencyId: args.state.agencyId,
    accountId: args.state.accountId,
    domainId: args.state.domainId,
    workspaceId: args.workspaceId,
    workspaceDisplayName: args.workspaceDisplayName,
    scope: args.scope,
    portfolioId: args.portfolioId,
    portfolioName: args.portfolioName,
    projectIds: args.projectIds,
    projectNames: args.projectNames,
    email,
    exchange: args.exchange,
  })
}
