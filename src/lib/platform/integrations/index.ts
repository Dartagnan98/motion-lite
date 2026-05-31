// Hiilite Platform — Integration registry.
//
// Adapters register themselves here so callers can look one up by provider slug.
// integrations-engineer adds new adapters in Phase 2 by mirroring the GSC entry.

import type { AdapterContract, MetricEnvelope } from '../adapter-contract'
import type { IntegrationProvider } from '../types'
import { gscAdapter } from './gsc/adapter'
import { ga4Adapter } from './ga4/adapter'
import { pagespeedAdapter } from './pagespeed/adapter'
import { asanaAdapter } from './asana/adapter'
import { everhourAdapter } from './everhour/adapter'
import { seRankingAdapter } from './se_ranking/adapter'
import { wordpressAdapter } from './wordpress/adapter'
import { gravityFormsAdapter } from './gravity_forms/adapter'
import { qboAdapter } from './qbo/adapter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAdapter = AdapterContract<any, MetricEnvelope>

const adapters = new Map<IntegrationProvider, AnyAdapter>([
  ['gsc', gscAdapter],
  ['ga4', ga4Adapter],
  ['pagespeed', pagespeedAdapter],
  ['asana', asanaAdapter],
  ['everhour', everhourAdapter],
  ['se_ranking', seRankingAdapter],
  ['wordpress', wordpressAdapter],
  ['gravity_forms', gravityFormsAdapter],
  ['qbo', qboAdapter],
])

/** Get the adapter for a provider slug. Throws if no adapter is registered. */
export function getAdapter(provider: IntegrationProvider): AnyAdapter {
  const a = adapters.get(provider)
  if (!a) throw new Error(`platform.integrations: no adapter for provider "${provider}"`)
  return a
}

/** List registered providers. Useful for UI dropdowns. */
export function listProviders(): IntegrationProvider[] {
  return Array.from(adapters.keys())
}

export { gscAdapter, ga4Adapter, pagespeedAdapter, asanaAdapter, everhourAdapter, seRankingAdapter, wordpressAdapter, gravityFormsAdapter }
