# Asana Adapter

Provider: Asana REST API v1 (`https://app.asana.com/api/1.0`)
Auth model: OAuth 2.0

## Auth model

OAuth 2.0 authorization code flow. Asana uses a single bundled scope (`default`) that grants full read+write access to everything the user can see. There are no granular read-only OAuth scopes in Asana v2 as of 2026.

For Phase 2 MVP we request `default` scope. Escalate if William decides the write-access surface is too broad for client trust — the mitigation is switching to Personal Access Tokens (PAT) per workspace, which are read-only by policy.

Redirect URI to register in Asana developer console: `/api/platform/integrations/asana/callback`

Env vars (devops registers the OAuth app):
- `ASANA_CLIENT_ID` — required for connect() and refresh()
- `ASANA_CLIENT_SECRET` — required for connect() and refresh()

Both env vars are read from the process environment at call time (never hardcoded).

## Token lifespan

- Access tokens: 1 hour
- Refresh tokens: never expire unless the user revokes app access in Asana's connected apps settings, or 90 days of inactivity (per Asana docs). Treat them as long-lived.

The adapter refreshes automatically via `getValidAccessToken()` with a 60-second buffer before expiry. A per-integration in-memory lock (`refreshLocks` Map) prevents concurrent refresh races for the same integration.

## Rate limits

150 requests/minute per access token (Asana Standard and Business tiers). The Free tier has lower limits and lacks the task search endpoint — require at least Standard.

fetchSnapshot paginates at 100 tasks/page. A workspace with 1,000 completed tasks in 30 days = 10 API calls. Well within the limit.

Backoff: 429 and 5xx get up to 3 attempts at 1s / 2s / 4s (exponential). Auth errors (401, 403) are non-retryable and propagate immediately.

## Workspace + project hierarchy

A user can belong to multiple workspaces. The workspace picker (frontend-eng's deliverable) exposes `listWorkspaces(accessToken)` from `oauth.ts`. The PM picks one. The chosen `workspaceId` is stored in `config_json`.

`config_json` shape:
```json
{ "workspaceId": "123456789", "projectIds": ["111", "222"] }
```

If `projectIds` is omitted or empty, `fetchSnapshot` fetches all completed tasks in the workspace for the period and applies no project filter.

If `projectIds` is set, the adapter fetches all tasks from the workspace search endpoint and filters client-side to the specified project GIDs. This is intentional: Asana's task search endpoint does not support multi-project OR filtering in a single call, and making one call per project would exhaust the rate limit for large workspaces. The client-side filter approach uses one call per 100 tasks regardless of project count.

## fetchSnapshot semantics

Endpoint: `GET /workspaces/{workspace_gid}/tasks/search`
Key query params:
- `completed=true`
- `completed_on.after={periodStart}` (YYYY-MM-DD)
- `completed_on.before={periodEnd}` (YYYY-MM-DD, inclusive)
- `limit=100` (Asana hard cap)
- `opt_fields=gid,name,completed,completed_at,memberships.project.gid,memberships.project.name,...`

Pagination: follow `next_page.offset` until `next_page` is null.

## Normalized metric slugs

| Slug | Type | Unit | Description |
|---|---|---|---|
| `tasks.completed` | MetricValue | count | Total tasks completed in the period |
| `tasks.completed_daily` | MetricSeries | — | Columns: date (YYYY-MM-DD), count (number) |
| `tasks.recent` | MetricSeries | — | Top 10 most recently completed; columns: task_name, project_name, completed_at |

All date strings are ISO YYYY-MM-DD. completed_at in `tasks.recent` is the full ISO datetime from Asana (YYYY-MM-DDTHH:MM:SS.SSSZ).

## Known gotchas

1. **Asana Free tier blocks task search.** The `tasks/search` endpoint requires Standard tier or higher. If a workspace is on Free, the API returns 402 or 403 with a message about plan limits. Health returns red:auth_expired in that case — surface a more specific message if Asana adds a distinct error code.

2. **Workspace vs Organization.** Asana has two kinds of "workspaces": free Workspaces and paid Organizations. The `/workspaces` endpoint returns both. The task search endpoint behaves identically for both types, so no special handling needed.

3. **Tasks in multiple projects.** A task can be in multiple projects (`memberships` is an array). `normalize.ts` uses `memberships[0].project.name` as the primary project. For tasks with no memberships (top-level workspace tasks), it falls back to `(no project)`.

4. **`completed_on.before` is inclusive.** Asana treats this date filter as `<= periodEnd`. If the PM wants to exclude the last day, they should pass `periodEnd - 1d`. We do not adjust — the caller sets the period boundary.

5. **Schema drift.** `normalize()` throws loudly if `gid`, `name`, or `completed_at` are missing from a task. Do NOT silently default. The error surfaces as `red:schema_drift` in `health()`.

6. **OAuth app verification.** Asana does not require production OAuth verification for B2B use — OAuth apps are approved instantly. No approval gate.

## Fixture

`fixtures/tasks-completed-sample.json` — 11 redacted tasks from a Hiilite-style client workspace covering April 2026. PII removed from task names.
