# motion-lite ↔ Hiilite Platform Menu Convergence Plan

> Mirror of `~/code/hiilite-platform/MENU-CONVERGENCE-PLAN.md` — kept in the
> motion-lite workspace per William's request 2026-05-21. Canonical version
> lives next to the Charter in `hiilite-platform/`.

**Drafted:** 2026-05-21
**Status:** Plan / pending William sign-off

---

## Problem statement

motion-lite and the Hiilite Platform have grown overlapping concepts that today appear in **two separate places** in the left sidebar:

- **Client Reports** group (added Phase 2): PM Dashboard, Reports, Connect Integrations
- **Operations** group (pre-existing): Businesses, **Clients**, Campaigns

Both groups deal with "the agency's retainer clients." The data lives in two tables:

- `client_profiles` (motion-lite) — rich CRM: name, industry, brand voice, goals, social handles, services, location, monthly budget, contacts, notes. Plus `client_businesses` for multi-business per-client support.
- `platform_accounts` (Hiilite Platform) — slim: name, tenant_id, status. Created by Phase 3 Sprint 1's new-client wizard.

These are logically the same entity. The data divergence + UI duplication cost the PM time on every workflow.

---

## Strategic decision: Option B — Bridge layer

Add a FK link between `platform_accounts` ↔ `client_profiles`; auto-link on create; collapse UI to one "Clients" tree. Preserves both systems, no data migration, fastest path to UX win. Phase 4 (Supabase cutover) collapses to a single table.

---

## Proposed sidebar structure

```
Productivity       Today  ·  Projects & Tasks
AI                 AI Agenda  ·  Dispatch  ·  Meeting Notes  ·  Brand Voice
Clients            All Clients  ·  Reports  ·  Connector Health  ·  Integrations
Ads                Meta Ads  ·  Google Ads
Operations         Businesses  ·  Campaigns       ← Clients moves out
```

Per-client detail at `/clients/[slug]` becomes the unified hub with tabs:
- **Profile** (motion-lite CRM — existing)
- **Integrations** (platform per-account tiles)
- **Reports** (platform reports for this client)
- **Comments** (platform comment activity)

---

## Menu mapping table

| Current path | Current label / location | Proposed path | Proposed label / location | What changes |
|---|---|---|---|---|
| `/clients` | Operations → Clients | `/clients` | **Clients → All Clients** | Top-level promotion. List enriched with integration count + last-report date + health badge |
| `/platform/clients` | (sidebar entry from Sprint 1) | `/clients` (redirect) | merged | Sprint 1's `/platform/clients` redirects to `/clients` |
| `/platform/clients/[id]` | (no sidebar) | `/clients/[slug]` | merged into client detail | Platform's client detail (Asana picker, clone template) becomes tabs on existing CRM detail page |
| `/platform/dashboard` | Client Reports → PM Dashboard | `/platform/dashboard` | **Clients → Connector Health** | Renamed for clarity |
| `/platform/reports` | Client Reports → Reports | `/platform/reports` | **Clients → Reports** | Same content; new location in tree |
| `/platform/connect` | Client Reports → Connect Integrations | `/platform/connect` | **Clients → Integrations** | Cleaner label |
| `/businesses` | Operations → Businesses | unchanged | unchanged | Phase 4 may move to per-client tab |
| `/crm/campaigns` | Operations → Campaigns | unchanged | unchanged | Same |
| `/ads`, `/google-ads` | Ads → Meta Ads / Google Ads | unchanged | unchanged | Phase 4 may nest under Clients |

**Removed:** "Client Reports" section header dissolves. Its three items move under new **Clients** group.

---

## Phased implementation

### Phase A — UI convergence only (~2-3h frontend-eng)

1. Sidebar refactor (`src/components/sidebar/Sidebar.tsx`):
   - Rename "Client Reports" → "Clients"
   - Add "All Clients" first item (`/clients`)
   - Remove "Operations → Clients" entry
   - Default `navSections.clients = true`
2. Redirect `/platform/clients` → `/clients`
3. Enrich `/clients` list page: integration count column, last-report column, "Open report" quick action
4. Add tabs to `/clients/[slug]`: Profile (existing), Integrations, Reports, Comments

### Phase B — Bridge data link (~4-6h)

1. Schema migration (additive):
   ```sql
   ALTER TABLE platform_accounts ADD COLUMN client_profile_id INTEGER REFERENCES client_profiles(id) ON DELETE SET NULL
   CREATE INDEX idx_platform_accounts_client_profile ON platform_accounts(client_profile_id)
   ```
2. `/clients/new` wizard also creates a `platform_accounts` row + links via `client_profile_id`
3. `/platform/clients/new` deprecated → redirect to `/clients/new`
4. Backfill script `scripts/link-clients-to-platform-accounts.mjs` (interactive)
5. `getCurrentAccountId` falls back to user's most-recent `client_profiles.platform_account_id`
6. `AccountSwitcher` displays `client_profiles.name`

### Phase C — Optional consolidation (Phase 4)

- Drop `platform_accounts` entirely; `client_profiles` becomes sole source of truth
- One destructive migration: copy platform-only metadata onto `client_profiles`, drop `platform_accounts`

---

## Hormozi lever

**Time-to-find-client-and-act.**

Before: 4+ clicks + cognitive load to navigate between two trees ("Is the April report under Operations or Client Reports?").
After Phase A: 2 clicks, zero thinking — Sidebar → Clients → Glenvalley → Reports tab.
After Phase B: PM never sees the seams between CRM and platform.

---

## Open questions for William

1. Naming: "All Clients" vs "Clients" vs "Client Roster" vs "Retainers"?
2. "PM Dashboard" rename: "Connector Health" vs "Health Overview" vs "Sync Status" vs keep current?
3. Should Ads nest under Clients in Phase 4 when campaign is per-client?
4. How many existing `platform_accounts` rows? (For backfill script estimation.)

---

## Recommended next action

Dispatch frontend-eng to execute **Phase A** as a quick win. Phase B waits until after Heather's Phase 3 sign-off so it doesn't muddy the exit gate review.
