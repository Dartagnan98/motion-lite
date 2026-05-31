#!/usr/bin/env node
// List the verified GSC sites this integration's token can access, optionally
// pick one, and re-fetch the latest snapshot.
//
//   node scripts/gsc-pick-site.mjs                    -> list sites
//   node scripts/gsc-pick-site.mjs <integrationId> <siteUrl>  -> set + refetch
//
// Uses the platform's existing token vault + adapter. Single-purpose utility
// for the Phase 1 live test before the Phase 2 site-picker UI lands.

import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// We need to run inside the Next.js context to use the platform/oauth modules
// (vault uses CRM_ENCRYPTION_KEY, requires the same env). The simplest path
// is to write a TS helper and import it here via tsx, but that adds tooling.
// Cleanest: shell out to a Next.js api route that already has all the wiring.
//
// We will hit two routes (added below): /api/dev/gsc-list-sites and /api/dev/gsc-set-site.

const args = process.argv.slice(2)
const PORT = process.env.PORT || 4000
const BASE = `http://localhost:${PORT}`

async function main() {
  if (args.length === 0) {
    const r = await fetch(`${BASE}/api/dev/gsc-list-sites`, {
      headers: { 'X-Dev-Bypass': 'true' },
    })
    const data = await r.json()
    if (!r.ok) {
      console.error('Error:', data.error)
      process.exit(1)
    }
    console.log(`\nIntegration #${data.integrationId} — verified GSC sites this token can access:\n`)
    for (const site of data.sites) {
      const marker = site.siteUrl === data.currentSiteUrl ? '  [ current ] ' : '              '
      console.log(`${marker}${site.siteUrl}  (${site.permissionLevel})`)
    }
    console.log(`\nTo switch: node scripts/gsc-pick-site.mjs ${data.integrationId} "<siteUrl>"`)
    return
  }

  const [integrationIdStr, siteUrl] = args
  const integrationId = parseInt(integrationIdStr, 10)
  if (!integrationId || !siteUrl) {
    console.error('Usage: node scripts/gsc-pick-site.mjs <integrationId> <siteUrl>')
    process.exit(1)
  }

  const r = await fetch(`${BASE}/api/dev/gsc-set-site`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-Bypass': 'true' },
    body: JSON.stringify({ integrationId, siteUrl }),
  })
  const data = await r.json()
  if (!r.ok) {
    console.error('Error:', data.error)
    process.exit(1)
  }
  console.log(`\n✓ Integration #${integrationId} now points at ${siteUrl}`)
  console.log(`  Snapshot rows fetched: ${data.dailyRows} daily, ${data.queryCount} queries, ${data.pageCount} pages`)
  console.log(`  Period: ${data.periodStart} to ${data.periodEnd}`)
  console.log(`\nReload the report page — it should now show real data.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
