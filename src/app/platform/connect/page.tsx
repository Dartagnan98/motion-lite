// /platform/connect
//
// Provider grid — PM selects which integration to connect.
// Server component: reads existing integrations so tiles show connected state.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import {
  getCurrentWorkspaceId,
  ensureTenantForWorkspace,
  getCurrentAccountId,
} from '@/lib/platform/tenant'
import { listIntegrationsForAccount } from '@/lib/platform/reports'
import type { IntegrationProvider } from '@/lib/platform/types'

interface ProviderConfig {
  id: IntegrationProvider | 'coming_soon'
  displayName: string
  description: string
  authModel: 'oauth' | 'api_key' | 'coming_soon'
  icon: string
  href?: string
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'gsc',
    displayName: 'Google Search Console',
    description: 'Organic search clicks, impressions, CTR, and rankings.',
    authModel: 'oauth',
    icon: 'GSC',
    href: '/platform/connect/gsc',
  },
  {
    id: 'ga4',
    displayName: 'Google Analytics 4',
    description: 'Traffic, sessions, page views, and top sources.',
    authModel: 'oauth',
    icon: 'GA4',
    href: '/platform/connect/ga4',
  },
  {
    id: 'pagespeed',
    displayName: 'PageSpeed Insights',
    description: 'Lighthouse scores and Core Web Vitals.',
    authModel: 'api_key',
    icon: 'PSI',
    href: '/platform/connect/pagespeed',
  },
  {
    id: 'se_ranking',
    displayName: 'SE Ranking',
    description: 'Keyword position tracking and rank movement.',
    authModel: 'api_key',
    icon: 'SER',
    href: '/platform/connect/se_ranking',
  },
  {
    id: 'wordpress',
    displayName: 'WordPress',
    description: 'Post counts, page activity, and content metrics.',
    authModel: 'api_key',
    icon: 'WP',
    href: '/platform/connect/wordpress',
  },
  {
    id: 'gravity_forms',
    displayName: 'Gravity Forms',
    description: 'Form entry counts and conversion tracking.',
    authModel: 'api_key',
    icon: 'GF',
    href: '/platform/connect/gravity_forms',
  },
  {
    id: 'google_ads',
    displayName: 'Google Ads',
    description: 'Ad spend, clicks, conversions, and ROAS.',
    authModel: 'coming_soon',
    icon: 'GAds',
  },
  {
    id: 'meta_ads',
    displayName: 'Meta Ads',
    description: 'Facebook/Instagram ad spend and performance.',
    authModel: 'coming_soon',
    icon: 'Meta',
  },
  {
    id: 'asana',
    displayName: 'Asana',
    description: 'Tasks completed and project velocity.',
    authModel: 'oauth',
    icon: 'Asn',
    href: '/platform/connect/asana',
  },
  {
    id: 'everhour',
    displayName: 'Everhour',
    description: 'Hours tracked and time investment by project.',
    authModel: 'api_key',
    icon: 'EH',
    href: '/platform/connect/everhour',
  },
  {
    id: 'qbo',
    displayName: 'QuickBooks Online',
    description: 'Invoices, payments, and AR — agency-level (connect once).',
    authModel: 'oauth',
    icon: 'QB',
    href: '/platform/connect/qbo',
  },
]

interface ConnectPageProps {
  searchParams: Promise<{ accountId?: string }>
}

export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) redirect('/login')
  const tenant = ensureTenantForWorkspace(workspaceId)

  // Use active account for the connected-state display.
  const activeAccountId = await getCurrentAccountId(tenant.id)
  if (!activeAccountId) redirect('/platform/clients/new')

  const integrations = listIntegrationsForAccount({ tenantId: tenant.id, accountId: activeAccountId })
  const connectedProviders = new Set(integrations.map((i) => i.provider))

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/platform/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Connect an Integration</h1>
          <p className="text-sm text-gray-500 mt-1">
            Connect data sources to populate your client reports.
          </p>
        </div>

        {/* Provider grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PROVIDERS.map((provider) => {
            const isConnected = provider.id !== 'coming_soon' && connectedProviders.has(provider.id as IntegrationProvider)
            const isComingSoon = provider.authModel === 'coming_soon'

            if (isComingSoon) {
              return (
                <div
                  key={provider.id}
                  className="bg-white rounded-lg border border-gray-200 p-5 opacity-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 font-bold text-xs flex-shrink-0">
                      {provider.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700">{provider.displayName}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{provider.description}</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <span className="text-xs text-gray-400 border border-gray-200 rounded px-2 py-1">
                      Coming soon
                    </span>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={provider.id}
                className={`bg-white rounded-lg border p-5 transition-colors ${
                  isConnected
                    ? 'border-green-200 bg-green-50/30'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                    isConnected ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'
                  }`}>
                    {provider.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{provider.displayName}</p>
                      {isConnected && (
                        <span className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{provider.description}</p>
                  </div>
                </div>
                <div className="mt-4">
                  {isConnected ? (
                    <Link
                      href={provider.href!}
                      className="text-xs font-medium text-green-700 border border-green-200 rounded px-3 py-1.5 hover:bg-green-50 transition-colors inline-block"
                    >
                      Connected — Add another
                    </Link>
                  ) : (
                    <Link
                      href={provider.href!}
                      className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 transition-colors inline-block"
                    >
                      Connect
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
