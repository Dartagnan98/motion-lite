# Integration Reconnect Instructions

**For:** Claude Co-work session, or any Claude instance picking up the recovery work
**From:** Previous orchestrator session, 2026-05-22
**Goal:** Reconnect 8 integrations + reseed the Glenvalley Dental report after data loss from the Phase 3 convergence migration.

---

## Context (read this first)

This is the **Hiilite Platform** — a Next.js 16 app inside `~/code/motion-lite/`. It's an internal agency reporting tool (charter at `~/code/hiilite-platform/CHARTER.md`) being dogfooded on a real retainer client (Glenvalley Dental) before productizing as agency SaaS at Phase 4.

**Why you're being asked to do this:** On 2026-05-22, a Phase 3 Sprint 3 "Convergence" migration ran `scripts/consolidate-platform-accounts.mjs` to drop the `platform_accounts` table and consolidate everything into `client_profiles`. The script's DROP TABLE step triggered an `ON DELETE CASCADE` chain that deleted all 8 connected integrations, 47 snapshots, and the seeded report. Schema is now correct; data needs to be re-populated.

**Current DB state (verify before starting):**
```bash
sqlite3 ~/code/store/motion.db "
SELECT 'integrations:', COUNT(*) FROM platform_integrations
UNION ALL SELECT 'snapshots:', COUNT(*) FROM platform_snapshots
UNION ALL SELECT 'reports:', COUNT(*) FROM platform_reports
UNION ALL SELECT 'oauth_tokens:', COUNT(*) FROM platform_oauth_tokens
UNION ALL SELECT 'client_profiles:', COUNT(*) FROM client_profiles
"
```

Expected: 0 integrations, 0 snapshots, 0 reports, 0 oauth_tokens, ≥1 client_profile.

**The Glenvalley client_profile row should exist:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, name, slug, tenant_id, platform_status FROM client_profiles WHERE slug = 'glenvalley-dental'"
```

Expected: `1|Glenvalley Dental|glenvalley-dental|3|active`

If either of those don't match expected, STOP and surface to the user — the recovery prep was incomplete.

---

## Required env vars (verify in ~/code/motion-lite/.env.local before starting)

```
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
CRM_ENCRYPTION_KEY=<32-byte secret, must NOT change between runs>
BYPASS_AUTH=true                ← local dev only; gated to NODE_ENV != production
ANTHROPIC_API_KEY=<for AI Executive Summary>
ASANA_CLIENT_ID=1214983934921557
ASANA_CLIENT_SECRET=b566eadff289d7115ba480e48792b26d
```

Verify:
```bash
grep -E "GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|CRM_ENCRYPTION_KEY|BYPASS_AUTH|ANTHROPIC_API_KEY|ASANA_CLIENT" ~/code/motion-lite/.env.local | cut -d= -f1
```

Should show all 7 keys. If missing, ask the user (don't fabricate; CRM_ENCRYPTION_KEY especially must be the value used to encrypt any prior tokens — though since we lost all tokens, a fresh value is fine for this recovery).

**External OAuth redirect URIs (already registered, don't re-register):**
- Google Cloud Console: `http://localhost:4000/api/platform/integrations/gsc/callback` AND `http://localhost:4000/api/platform/integrations/ga4/callback`
- Asana developer app: `http://localhost:4000/api/platform/integrations/asana/callback`

---

## Dev server check

Before doing anything else, confirm dev server is running on port 4000:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/
```

Expected: `200`. If not, ask the user to start it (`cd ~/code/motion-lite && PORT=4000 npm run dev`).

---

## Reconnect sequence (8 integrations, ~30-45 min total)

The user must drive the OAuth flows + API key entry. You guide them with one-line instructions per integration, then VERIFY via DB query after each. After all 8 are connected, run the reseed script and verify the final report.

**General pattern per integration:**
1. Tell the user which integration to connect, what URL to visit, what answers/credentials to provide
2. After they confirm "done", run a DB query to verify the row exists with correct config
3. Move to the next one

**Tenant scoping note:** all integrations should write to `tenant_id = 3` (Hiilite's active tenant) and `account_id = 1` (Glenvalley's client_profiles row). If you see a different tenant_id or account_id after a connect, something's wrong with the active-account cookie — surface to user.

---

### 1. Google Search Console (GSC) — OAuth, picker

**Tell the user:**
> Visit `http://localhost:4000/platform/connect/gsc` → click "Connect with Google" → authorize as the Google account that owns `glenvalleydental.ca` GSC property → on the site picker, type "glen" into the search → pick `https://glenvalleydental.ca/` → click Continue.

**Verify after:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, provider, account_id, json_extract(config_json, '\$.siteUrl') FROM platform_integrations WHERE provider = 'gsc'"
```
Expected: 1 row, account_id = 1, siteUrl = `https://glenvalleydental.ca/`.

**Common gotchas:**
- If the picker is empty: user picked wrong Google account. They need to start over and authorize the account that owns Glenvalley's GSC.
- If 0 verified sites: user's Google identity needs to be verified owner of glenvalleydental.ca first (separate task in GSC web UI).

---

### 2. Google Analytics 4 (GA4) — OAuth, picker

**Tell the user:**
> Visit `http://localhost:4000/platform/connect/ga4` → click "Connect with Google" → authorize → on the property picker, search "glen" → pick Glenvalley Dental's GA4 property (property ID was 463805576 in the prior connect; might differ if they have multiple) → click Connect.

**Verify:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, account_id, json_extract(config_json, '\$.propertyId') FROM platform_integrations WHERE provider = 'ga4'"
```
Expected: 1 row, account_id = 1, propertyId = numeric string.

**Gotchas:**
- If the picker shows "Session expired" → cookie expired between callback and picker. Ask user to restart the flow.
- If picker is empty → user's Google identity has no GA4 property access. Verify in Google Analytics admin.

---

### 3. PageSpeed Insights — API key, no OAuth

**Tell the user:**
> Get a PageSpeed Insights API key from https://developers.google.com/speed/docs/insights/v5/get-started (free, 25K calls/day quota). Then visit `http://localhost:4000/platform/connect/pagespeed`. Enter:
> - URL: `https://glenvalleydental.ca/`
> - API Key: (paste)
> - Strategy: Mobile
> - Click Connect.

**Verify:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, json_extract(config_json, '\$.url'), json_extract(config_json, '\$.strategy') FROM platform_integrations WHERE provider = 'pagespeed'"
```
Expected: 1 row, url = `https://glenvalleydental.ca/`, strategy = `mobile`.

**Gotcha:** PageSpeed first snapshot takes ~30s (running a live Lighthouse audit). If the connect page seems hung, wait.

---

### 4. Asana — OAuth, multi-step picker (workspace + portfolio/projects)

**Tell the user:**
> Visit `http://localhost:4000/platform/connect/asana` → "Connect with Asana" → authorize → workspace picker shows your Asana workspaces. Pick the Hiilite workspace (search "hiilite") → Continue.
>
> Next screen has two tabs: "By Portfolio" vs "By Projects". If you have a Glenvalley-specific portfolio, pick it from the Portfolio tab. Otherwise switch to Projects tab and multi-select the 1-3 Glenvalley Dental project(s) (search "glen"). Click Connect Asana.

**Verify:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, json_extract(config_json, '\$.scope'), json_extract(config_json, '\$.workspaceDisplayName'), json_array_length(json_extract(config_json, '\$.projectIds')) FROM platform_integrations WHERE provider = 'asana'"
```
Expected: 1 row, scope = `portfolio` or `projects`, workspaceDisplayName populated, projectIds array has ≥1 entry.

---

### 5. Everhour — API key, multi-step picker (clients + projects)

**Tell the user:**
> Get an Everhour API key from https://app.everhour.com → Profile → API → Generate. Visit `http://localhost:4000/platform/connect/everhour` → paste the key → Continue.
>
> Client picker shows ~656 clients. Search "glen" → check "GlenValley Dental Clinic" → Continue.
>
> Project picker shows the projects for that client (~4). All pre-checked. Click Connect Everhour.

**Verify:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, json_extract(config_json, '\$.clientNames'), json_array_length(json_extract(config_json, '\$.projectIds')) FROM platform_integrations WHERE provider = 'everhour'"
```
Expected: 1 row, clientNames includes "GlenValley Dental Clinic", projectIds has 4 entries.

**Gotchas:**
- `listClients`/`listProjects` have a defensive dedupe-by-id loop because Everhour's API ignores `page`/`limit` params and returns the full list every call. Don't be alarmed if logs show "20-loop break" messages.
- If 0 projects appear in step 3: client ID mismatch. The fix is via `listProjectsByClients` walking the selected client's `projects[]` array in the /clients response — already implemented; should just work.

---

### 6. SE Ranking — API key, project picker

**Tell the user:**
> Get an SE Ranking API key from https://online.seranking.com/admin.api-keys-management.html → "Generate API Key". Note: SE Ranking has Project API + Data API keys — both work for this connector.
>
> Visit `http://localhost:4000/platform/connect/se_ranking` → paste the key → Continue → on the project picker, pick "Glenvalley Dental" (or "Hiilite" if Glenvalley project doesn't exist in their SE Ranking account yet) → Connect.

**Verify:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, json_extract(config_json, '\$.projectName'), json_extract(config_json, '\$.projectId') FROM platform_integrations WHERE provider = 'se_ranking'"
```
Expected: 1 row, projectName + projectId populated, projectId is a number (not string).

**Gotchas:**
- If "Invalid API key" → user may have generated a different key. The connector accepts both Project API and Data API keys.
- If the snapshot is empty (0 keywords): the SE Ranking project has no keywords tracked yet. PM needs to add keywords in SE Ranking admin first. The integration is still considered "connected" — the snapshot will populate after SE Ranking's next rank check (usually next-day).

---

### 7. WordPress (REST API) — site URL + App Password

**Tell the user:**
> In WordPress admin for glenvalleydental.ca, go to Users → Profile → Application Passwords. Create one named "Hiilite Platform". Copy the generated password.
>
> Visit `http://localhost:4000/platform/connect/wordpress`. Enter:
> - Site URL: `https://glenvalleydental.ca`
> - Username: your WP admin username (e.g. `william`)
> - Application Password: (paste — spaces are stripped automatically)
> - Click Connect.

**Verify:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, json_extract(config_json, '\$.siteUrl'), json_extract(config_json, '\$.username') FROM platform_integrations WHERE provider = 'wordpress'"
```
Expected: 1 row, siteUrl populated, username populated.

**Gotchas:**
- If 401 from WP REST: WP REST API may be disabled or behind a security plugin. Check Glenvalley's WP setup.
- Connect takes ~5s wall-time (5 sequential WP calls).

---

### 8. Gravity Forms — same WP creds + form picker

**Tell the user:**
> First confirm Gravity Forms REST API is enabled in WP admin → Forms → Settings → REST API → "Enable access to the API" checked.
>
> Visit `http://localhost:4000/platform/connect/gravity_forms`. Enter same site URL + username + app password as the WordPress connect → Continue. Form picker shows all GF forms — multi-select the Glenvalley contact form (and any other forms you want counted) → Connect.

**Verify:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, json_extract(config_json, '\$.siteUrl'), json_array_length(json_extract(config_json, '\$.formIds')) FROM platform_integrations WHERE provider = 'gravity_forms'"
```
Expected: 1 row, siteUrl populated, formIds array has ≥1 entry.

---

## After all 8 are connected

**Verify the full set:**
```bash
sqlite3 ~/code/store/motion.db "SELECT provider, status, last_health_status FROM platform_integrations ORDER BY id"
```
Expected: 8 rows. All `status = 'connected'`. All `last_health_status = 'green'`.

**Verify snapshots fired:**
```bash
sqlite3 ~/code/store/motion.db "SELECT COUNT(*) FROM platform_snapshots"
```
Expected: ≥8 (one per integration; some may have multiple if refetch fired).

**Reseed the report:**
```bash
cd ~/code/motion-lite && node scripts/reseed-glenvalley-report.mjs
```
Expected output: deletes any existing reports, creates one fresh with 8 sections seeded based on the now-connected integrations.

**Verify report exists:**
```bash
sqlite3 ~/code/store/motion.db "SELECT id, name, period_start, period_end FROM platform_reports; SELECT section_type, title FROM platform_report_sections ORDER BY position"
```
Expected: 1 report, 8 sections (ai_summary, search_performance, traffic_overview, site_health, site_health_v2, form_conversions, tasks_completed, hours_invested). The order may include rank_movement if SE Ranking has data.

**Final UI verification (ask user to do this):**
> Visit `http://localhost:4000/clients/glenvalley-dental` → click the Integrations tab → all 8 tiles green. Click the Reports tab → 1 report listed. Click Open Report → all sections render with real data. AI Executive Summary fires automatically (10s wait). KPI tiles show real numbers, not zeros or "No data synced yet".

---

## If something goes wrong

- **403/401 during OAuth callback** → redirect URI not registered. Ask user to register in Google Cloud Console / Asana developer app.
- **Empty snapshot after connect** → the source has no data for the period. For SE Ranking specifically: no tracked keywords yet (normal post-setup). For others: investigate via the dev debug routes if they still exist (`/api/dev/gsc-list-sites`, `/api/dev/gsc-set-site` — these are kept; ops-only, gated to non-prod).
- **`Active account not found` errors** → cookie pointing at stale ID. Visit `/platform/dashboard` to trigger active-account resolution; should auto-pick Glenvalley.
- **Reseed creates a report but sections are missing** → an integration is still in a connecting state. Wait 60s, refetch all tiles via the dashboard refresh icons, then reseed again.

---

## Escalation

Surface to the user when:
- An OAuth client_id or client_secret is missing from `.env.local` (they may need to generate a fresh one)
- Any DB verification query returns unexpected counts (could indicate the schema-on-boot didn't fire correctly post-migration — restart dev server)
- An integration's API responds with an unexpected 5xx — investigate before retrying

Surface to the **prior orchestrator (this Claude session's planning lineage)** when:
- The platform's `client_profiles.tenant_id` is NULL after the migration (the convergence script should have populated it — if it didn't, the schema is in a broken state and the consolidation pre-flight was bypassed)

---

## Success criteria

8 integrations connected + healthy. 1 report seeded with 8 sections rendering real data. AI summary cites real numbers. PM can navigate `/clients/glenvalley-dental` → Reports tab → open the report → see everything.

Then Phase 3 truly closes and Phase 4 (charter §3) kicks off with the QBO integration + Supabase migration as Sprint 1 deliverables.

---

*Estimated time: 30-45 min. Most of it is the user clicking through OAuth flows + pasting keys; your job is to guide them step-by-step and verify each step via DB query before moving on. Don't batch the verifications — catch issues one integration at a time.*
