// /platform/dashboard
//
// PM dashboard — server component.
//
// Shows:
//   - Connector health tiles (one per platform_integrations row for the tenant)
//   - Quick link to the most recent report per connected integration
//
// Health tile rules (from agent spec):
//   Green  — health() === 'green' and last_synced_at < 7 days
//   Yellow — stale (7-72h gap) or rate-limited, shows reason
//   Red    — auth_expired | schema_drift | transient_error | not_configured
//
// No real-time polling for Phase 1 — page refresh is fine. Phase 6 adds SSE.

import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import {
  ensureTenantForWorkspace,
  getCurrentWorkspaceId,
  getCurrentAccountId,
  listAccountsForSwitcher,
} from '@/lib/platform/tenant'
import { listIntegrationsForAccount } from '@/lib/platform/reports'
import { getAdapter } from '@/lib/platform/integrations'
import type { Integration } from '@/lib/platform/types'
import type { HealthStatus } from '@/lib/platform/adapter-contract'
import { RefetchButton } from '../reports/_components/RefetchButton'
import { DisconnectButton } from '../reports/_components/DisconnectButton'
import { AccountSwitcher } from '../_components/AccountSwitcher'
import { AutoConnectButton } from '../_components/AutoConnectButton'
import { DashboardClientDomain } from '../_components/DashboardClientDomain'
import { NpsWidget } from '../_components/NpsWidget'
import { getDb } from '@/lib/db'

// ─── Health tile component ────────────────────────────────────────────

interface HealthTileProps {
  integration: Integration
  health: HealthStatus
}

const PROVIDER_LABELS: Record<string, string> = {
  gsc: 'Google Search Console',
  ga4: 'Google Analytics 4',
  pagespeed: 'PageSpeed Insights',
  se_ranking: 'SE Ranking',
  wordpress: 'WordPress',
  gravity_forms: 'Gravity Forms',
  asana: 'Asana',
  everhour: 'Everhour',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  quickbooks: 'QuickBooks',
}

function HealthDot({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const colorMap = {
    green: 'bg-green-500',
    yellow: 'bg-amber-400',
    red: 'bg-red-500',
  }
  return (
    <span
      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorMap[status]}`}
      aria-label={`Status: ${status}`}
    />
  )
}

function formatLastFetched(d: Date | undefined): string {
  if (!d) return 'Never synced'
  const diffMs = Date.now() - d.getTime()
  const diffH = Math.floor(diffMs / 3_600_000)
  if (diffH < 1) return 'Synced <1h ago'
  if (diffH < 24) return `Synced ${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `Synced ${diffD}d ago`
}

function HealthTile({ integration, health }: HealthTileProps) {
  const providerLabel = PROVIDER_LABELS[integration.provider] || integration.provider
  const displayName = integration.display_name || providerLabel

  let statusText = ''
  let borderColor = 'border-gray-200'
  let bgHover = 'hover:bg-gray-50'

  if (health.status === 'green') {
    statusText = formatLastFetched('lastFetchedAt' in health ? health.lastFetchedAt : undefined)
    borderColor = 'border-green-200'
    bgHover = 'hover:bg-green-50/30'
  } else if (health.status === 'yellow') {
    statusText =
      'message' in health && health.message
        ? health.message
        : health.reason === 'stale'
        ? formatLastFetched('lastFetchedAt' in health ? health.lastFetchedAt : undefined)
        : 'Rate limited'
    borderColor = 'border-amber-200'
    bgHover = 'hover:bg-amber-50/30'
  } else {
    statusText = 'message' in health ? health.message : 'Unknown error'
    borderColor = 'border-red-200'
    bgHover = 'hover:bg-red-50/30'
  }

  const levelBadge = `${integration.level}`
  const levelColor =
    integration.level === 'domain'
      ? 'bg-purple-50 text-purple-600'
      : integration.level === 'account'
      ? 'bg-blue-50 text-blue-600'
      : 'bg-gray-100 text-gray-500'

  const reconnectHref = `/platform/connect/${integration.provider}`

  return (
    <div
      className={`bg-white rounded-lg border ${borderColor} ${bgHover} p-4 transition-colors`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <HealthDot status={health.status} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{statusText}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Refresh button — tile variant (icon-only) */}
          {health.status !== 'red' && (
            <RefetchButton integrationIds={[integration.id]} variant="tile" />
          )}
          {/* Configure — reuses the connect flow (reuses auth / prefills key) and
              dedupes onto this same tile, so changing the target (e.g. add an
              Everhour/Asana project, change GSC property, edit PageSpeed URL)
              doesn't create a duplicate. */}
          <Link
            href={reconnectHref}
            title="Reconfigure this connection (change property / project / URL)"
            className="w-7 h-7 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Configure integration"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
          <DisconnectButton
            integrationId={integration.id}
            providerLabel={displayName}
          />
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${levelColor}`}>
            {levelBadge}
          </span>
        </div>
      </div>

      {health.status === 'red' && (
        <div className="mt-3 pt-3 border-t border-red-100">
          <Link
            href={reconnectHref}
            className="text-xs text-red-600 hover:underline font-medium"
          >
            Reconnect
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) redirect('/login')
  const tenant = ensureTenantForWorkspace(workspaceId)

  // Resolve active account — redirect to new-client wizard if none exist.
  const activeAccountId = await getCurrentAccountId(tenant.id)
  if (!activeAccountId) {
    redirect('/platform/clients/new')
  }

  const switcherAccounts = listAccountsForSwitcher({ tenantId: tenant.id, activeAccountId })

  // Active client's profile info (shown in the header — #5).
  const activeClient = getDb().prepare(
    'SELECT name, website, industry FROM client_profiles WHERE id = ?'
  ).get(activeAccountId) as { name: string; website: string | null; industry: string | null } | undefined

  // Integrations scoped to the active account only.
  const integrations = listIntegrationsForAccount({ tenantId: tenant.id, accountId: activeAccountId })

  // Resolve health for each integration. Sequential for Phase 1 (no parallelism
  // needed with a single integration). Phase 2: Promise.all.
  const integrationHealth: { integration: Integration; health: HealthStatus }[] = []
  for (const integration of integrations) {
    let health: HealthStatus
    try {
      // Attempt to use the registered adapter for health(). Fall back to DB-derived
      // status if no adapter is registered (future providers not yet in index.ts).
      let adapter
      try {
        adapter = getAdapter(integration.provider)
      } catch {
        adapter = null
      }

      if (adapter) {
        health = await adapter.health(integration.id)
      } else {
        const syncedAt = integration.last_synced_at
          ? new Date(integration.last_synced_at * 1000)
          : null
        const age = syncedAt ? Date.now() - syncedAt.getTime() : Infinity
        if (integration.status === 'error') {
          health = { status: 'red', reason: 'transient_error', message: integration.last_health_message || 'Error' }
        } else if (!syncedAt || age > 7 * 86_400_000) {
          health = { status: 'yellow', reason: 'stale', lastFetchedAt: syncedAt ?? undefined }
        } else {
          health = { status: 'green', lastFetchedAt: syncedAt }
        }
      }
    } catch {
      health = { status: 'red', reason: 'transient_error', message: 'Health check failed' }
    }
    integrationHealth.push({ integration, health })
  }

  const greenCount = integrationHealth.filter((h) => h.health.status === 'green').length
  const yellowCount = integrationHealth.filter((h) => h.health.status === 'yellow').length
  const redCount = integrationHealth.filter((h) => h.health.status === 'red').length

  // NPS: show widget if user has not submitted this calendar month.
  // First-of-month in UTC. `Date.UTC(...)` produces an actual UTC epoch; the
  // `new Date(year, month, 1)` constructor treats args as local time, which
  // shifts by up to 24h on non-UTC servers. Must match the same computation
  // in /api/platform/nps/route.ts.
  const db = getDb()
  const _now = new Date()
  const firstOfMonthEpoch = Math.floor(
    Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), 1) / 1000
  )
  const hasNpsThisMonth = !!db.prepare(
    `SELECT id FROM platform_nps_responses WHERE user_id = ? AND created_at >= ?`
  ).get(user.id, firstOfMonthEpoch)

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* NPS widget — once per calendar month per user */}
        {!hasNpsThisMonth && <NpsWidget />}

        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 truncate">
              {activeClient?.name ?? 'PM Dashboard'}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
              {activeClient?.industry && <span>{activeClient.industry}</span>}
              <DashboardClientDomain clientId={activeAccountId} website={activeClient?.website ?? null} />
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AccountSwitcher accounts={switcherAccounts} />
            <AutoConnectButton />
            <Link
              href="/platform/connect"
              className="text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              + Connect Integration
            </Link>
          </div>
        </div>

        {/* Summary row */}
        {integrations.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{greenCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Healthy</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-amber-500">{yellowCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Stale</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-red-500">{redCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Errors</p>
            </div>
          </div>
        )}

        {/* Connector health tiles */}
        <div className="mb-8">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Connector Health
          </h2>
          {integrationHealth.length === 0 ? (
            <div className="bg-white rounded-lg border border-dashed border-gray-200 p-8 text-center">
              <p className="text-sm text-gray-500 mb-3">No integrations connected yet.</p>
              <Link
                href="/platform/connect"
                className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
              >
                Connect an Integration
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {integrationHealth.map(({ integration, health }) => (
                <HealthTile
                  key={integration.id}
                  integration={integration}
                  health={health}
                />
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/platform/connect"
              className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 p-4 flex items-center gap-3 transition-colors group"
            >
              <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">Connect Integration</p>
                <p className="text-xs text-gray-400">GSC, GA4, PageSpeed and more</p>
              </div>
            </Link>
            <Link
              href={`/platform/reports?accountId=${activeAccountId}`}
              className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 p-4 flex items-center gap-3 transition-colors group"
            >
              <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">View Report</p>
                <p className="text-xs text-gray-400">Latest for active client</p>
              </div>
            </Link>
            <Link
              href="/platform/clients"
              className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 p-4 flex items-center gap-3 transition-colors group"
            >
              <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">All Clients</p>
                <p className="text-xs text-gray-400">Manage client roster</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
