// POST /api/platform/integrations/auto-connect
//
// Domain-driven auto-connect (CONNECTOR-REUSE-PLAN B). For the active client's
// saved website, reuse the agency's shared credentials to connect the providers
// that can be matched from a domain:
//   - GSC: pick the verified property whose host matches the domain
//   - PageSpeed: reuse the shared key + set the audit URL to the website
// Returns a per-provider result summary. Providers that can't be confidently
// matched (GA4 property, SE Ranking project, Everhour/Asana — not domain-keyed)
// are reported as 'skipped' for manual connect. Dedupe means re-running is safe.

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentWorkspaceId, ensureTenantForWorkspace, getCurrentAccountId } from '@/lib/platform/tenant'
import { listTenantCredentials } from '@/lib/platform/vault'
import { getDb } from '@/lib/db'
import { getValidAccessTokenForCredential, listSites } from '@/lib/platform/integrations/gsc/oauth'
import { completeConnect as gscComplete } from '@/lib/platform/integrations/gsc/connect-flow'
import { pagespeedAdapter } from '@/lib/platform/integrations/pagespeed/adapter'

type Result = { provider: string; status: 'connected' | 'skipped' | 'error'; detail: string }

/** Normalize to a bare host: strip protocol, www., trailing slash, lowercase. */
function hostOf(s: string): string {
  return s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase().trim()
}

export async function POST(req: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const tenant = ensureTenantForWorkspace(workspaceId)
  const accountId = await getCurrentAccountId(tenant.id)
  if (!accountId) return NextResponse.json({ error: 'No active client selected' }, { status: 400 })

  const client = getDb().prepare('SELECT name, website FROM client_profiles WHERE id = ?')
    .get(accountId) as { name: string; website: string | null } | undefined
  const website = client?.website?.trim()
  if (!website) {
    return NextResponse.json({ error: 'This client has no website set. Add a domain on the client first.' }, { status: 400 })
  }
  const targetHost = hostOf(website)
  const results: Result[] = []

  // ── GSC: match a verified property to the domain ──
  try {
    // Must use a Google credential that actually has Search Console scope —
    // a GA4-only consent can leave the shared token without webmasters access.
    const googleCred = listTenantCredentials(tenant.id, 'google').find((c) => (c.scopes ?? '').includes('webmasters'))
    if (!googleCred) {
      results.push({ provider: 'gsc', status: 'skipped', detail: 'Shared Google login lacks Search Console access — reconnect GSC once to grant it (no duplicate created).' })
    } else {
      const token = await getValidAccessTokenForCredential(googleCred.id)
      const resp = await listSites(token)
      const sites = (resp.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
      // Rank: exact host match (url-prefix or sc-domain) wins.
      const match = sites.find((s) => hostOf(s.siteUrl.replace(/^sc-domain:/, 'https://')) === targetHost)
      if (match) {
        const { integrationId } = gscComplete({
          state: { provider: 'gsc', tenantId: tenant.id, level: 'account', agencyId: null, accountId, domainId: null },
          siteUrl: match.siteUrl,
          tenantCredentialId: googleCred.id,
        })
        results.push({ provider: 'gsc', status: 'connected', detail: `${match.siteUrl} (integration ${integrationId})` })
      } else {
        results.push({ provider: 'gsc', status: 'skipped', detail: `No verified property matched ${targetHost} — pick manually.` })
      }
    }
  } catch (e) {
    results.push({ provider: 'gsc', status: 'error', detail: e instanceof Error ? e.message : 'GSC auto-connect failed' })
  }

  // ── PageSpeed: reuse shared key + set URL to the website ──
  try {
    const psCred = listTenantCredentials(tenant.id, 'pagespeed').find((c) => c.auth_model === 'api_key' && c.api_key)
    if (!psCred?.api_key) {
      results.push({ provider: 'pagespeed', status: 'skipped', detail: 'No shared PageSpeed key yet — connect PageSpeed once.' })
    } else {
      const { integrationId } = await pagespeedAdapter.connect({
        tenantId: tenant.id, level: 'account', agencyId: null, accountId, domainId: null,
        redirectUri: '', apiKey: psCred.api_key,
        callbackState: { url: website.startsWith('http') ? website : `https://${website}`, strategy: 'mobile' },
      })
      results.push({ provider: 'pagespeed', status: 'connected', detail: `Audit ${website} (integration ${integrationId})` })
    }
  } catch (e) {
    results.push({ provider: 'pagespeed', status: 'error', detail: e instanceof Error ? e.message : 'PageSpeed auto-connect failed' })
  }

  // Domain-agnostic providers — leave for manual connect.
  results.push({ provider: 'ga4', status: 'skipped', detail: 'Pick the GA4 property manually (reuse Google — no re-auth).' })
  results.push({ provider: 'se_ranking', status: 'skipped', detail: 'Pick the SE Ranking project manually (key prefilled).' })
  results.push({ provider: 'everhour', status: 'skipped', detail: 'Pick the Everhour client/projects manually (key prefilled).' })
  results.push({ provider: 'asana', status: 'skipped', detail: 'Pick the Asana portfolio manually.' })

  return NextResponse.json({ ok: true, website, results })
}
