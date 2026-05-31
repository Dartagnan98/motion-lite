// /platform/clients/[id] — resolves legacy account id to /clients/[slug].
//
// Phase C: account_id is now client_profiles.id (platform_accounts dropped).
// [id] from the URL is treated as client_profiles.id directly; redirect to its slug.
// Older URLs pointing at platform_accounts.id will 404-via-redirect to /clients
// after consolidation (acceptable — those URLs aren't in active circulation).

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import {
  getCurrentWorkspaceId,
  ensureTenantForWorkspace,
  assertTenantOwnsRow,
} from '@/lib/platform/tenant'
import { getDb } from '@/lib/db'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PlatformClientRedirectPage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const { id: idStr } = await params
  const accountId = parseInt(idStr, 10)
  if (isNaN(accountId) || accountId <= 0) notFound()

  const workspaceId = await getCurrentWorkspaceId()
  if (!workspaceId) redirect('/login')
  const tenant = ensureTenantForWorkspace(workspaceId)

  try {
    assertTenantOwnsRow(tenant, 'client_profiles', accountId)
  } catch {
    redirect('/clients')
  }

  const db = getDb()

  const row = db.prepare(
    `SELECT slug FROM client_profiles WHERE id = ? AND tenant_id = ? LIMIT 1`
  ).get(accountId, tenant.id) as { slug: string } | undefined

  redirect(row ? `/clients/${row.slug}` : '/clients')
}
