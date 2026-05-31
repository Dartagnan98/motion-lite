// Shared dedupe-on-connect helper (CONNECTOR-REUSE-PLAN C).
//
// Reconnecting an integration to change its target (Everhour projects, Asana
// portfolio, SE Ranking project, PageSpeed URL, GF forms, WP site) should UPDATE
// the existing tile for that (tenant, provider, account) — not create a
// duplicate. Each provider's persist path calls findIntegrationForAccount()
// first; if it returns an id, it calls updateIntegrationConfig() and reuses that
// id instead of inserting.
//
// Account-level only (accountId required). Agency/domain-level connections are
// rare and keep the insert path.

import { getDb } from '@/lib/db'

/** Existing integration id for (tenant, provider, account), or null. */
export function findIntegrationForAccount(args: {
  tenantId: number
  provider: string
  accountId: number | null
}): number | null {
  if (!args.accountId) return null
  const row = getDb().prepare(
    `SELECT id FROM platform_integrations
      WHERE tenant_id = ? AND provider = ? AND account_id = ?
      ORDER BY id LIMIT 1`
  ).get(args.tenantId, args.provider, args.accountId) as { id: number } | undefined
  return row?.id ?? null
}

/** Update an existing integration's target config + mark it healthy/connected. */
export function updateIntegrationConfig(args: {
  integrationId: number
  configJson: string
  displayName?: string | null
  tenantCredentialId?: number | null
}): void {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  if (args.tenantCredentialId != null) {
    db.prepare(
      `UPDATE platform_integrations
          SET config_json = ?, display_name = COALESCE(?, display_name),
              tenant_credential_id = ?, status = 'connected',
              last_health_status = 'green', last_health_message = NULL, updated_at = ?
        WHERE id = ?`
    ).run(args.configJson, args.displayName ?? null, args.tenantCredentialId, now, args.integrationId)
  } else {
    db.prepare(
      `UPDATE platform_integrations
          SET config_json = ?, display_name = COALESCE(?, display_name),
              status = 'connected', last_health_status = 'green',
              last_health_message = NULL, updated_at = ?
        WHERE id = ?`
    ).run(args.configJson, args.displayName ?? null, now, args.integrationId)
  }
}
