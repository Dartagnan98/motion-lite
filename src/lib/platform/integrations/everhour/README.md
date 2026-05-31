# Everhour Adapter

Provider: Everhour REST API (`https://api.everhour.com/`)
Auth model: API key (`X-Api-Key` header)

## Auth model

No OAuth. The PM enters the Everhour API key in the connect form. The key is validated immediately by calling `GET /users/me` — if the call succeeds, the integration row is created and `integrationId` is returned. If the key is invalid, a 401 from Everhour surfaces as an error to the caller.

## API key storage

The API key is stored plaintext in `config_json` on the `platform_integrations` row. This is the same decision made for PageSpeed Insights (documented in the PageSpeed README and Sprint 1 close-out). Rationale: Everhour API keys are revocable and per-workspace. The threat model for a PM-facing internal tool is different from a consumer-facing application. A malicious insider with DB access already has access to tenant data; encrypting the key in config_json adds no meaningful protection for that threat while adding complexity. If the threat model changes (e.g., Phase 4 multi-tenant SaaS), migrate to the vault layer.

`config_json` shape:
```json
{ "apiKey": "ev-api-xxxx-redacted", "projectIds": ["ev-proj-100", "ev-proj-101"] }
```

If `projectIds` is omitted or empty, `fetchSnapshot` returns all time entries across all projects the API key can see (i.e., the full team's time for the period).

## Rate limits

60 requests/minute. `fetchSnapshot` makes 1 API call (`GET /team/time`) per invocation. At 1 call/client/day, 60 clients would use the limit in under a minute — not a concern for Phase 2. If multi-client batch refresh is added, throttle in the caller.

Backoff: 429 and 5xx get up to 3 attempts at 1s / 2s / 4s. Auth errors (401) are non-retryable and propagate immediately.

## `connect()` behavior

1. Validate the API key with `GET /users/me`.
2. Create the `platform_integrations` row with `auth_model: 'api_key'` and the API key in `config_json`.
3. Return `{ integrationId }`. No OAuth redirect.

The connect form should submit: API key + optional comma-separated project IDs.

## fetchSnapshot semantics

Endpoint: `GET /team/time?from={periodStart}&to={periodEnd}`

Everhour returns a flat array of time entries for the entire team in the date range. Each entry has:
- `id` — entry identifier
- `user` — who logged the time
- `date` — ISO YYYY-MM-DD
- `time` — seconds logged
- `task.projects` — project(s) the task belongs to

If `projectIds` is configured, entries are filtered client-side to those project IDs.

All time values from Everhour are in **seconds**. `normalize.ts` converts to decimal hours (`seconds / 3600`, rounded to 2dp).

## Normalized metric slugs

| Slug | Type | Unit | Description |
|---|---|---|---|
| `hours.total` | MetricValue | hours | Total tracked hours in the period |
| `hours.by_project` | MetricSeries | — | Top 10 projects by hours desc; columns: project_name, hours |
| `hours.daily` | MetricSeries | — | Daily hours; columns: date (YYYY-MM-DD), hours |

All date strings are ISO YYYY-MM-DD.

## Known gotchas

1. **`/team/time` response shape.** Some Everhour API versions return the array directly; others wrap it in `{ data: [...] }`. The adapter handles both shapes. If a third shape appears, `normalize()` will throw `schema_drift`.

2. **Time logged with no project.** Everhour allows logging time directly to a workspace (no task, no project). These entries have `task: null`. The adapter groups them under `(no project)` in `hours.by_project`. They count toward `hours.total`.

3. **Multi-project tasks.** A task can belong to multiple Everhour projects. The adapter uses `task.projects[0]` as the primary project for grouping. This matches how Everhour's own UI attributes time.

4. **Large payloads.** `/team/time` is not paginated by cursor. For a 30-day window with 20 team members averaging 8h/day, the response could be 5,000+ entries. The adapter loads everything into memory for aggregation. For Phase 2 (1–5 active clients), this is fine. If a single client has a very active team, the `size_bytes` column on `platform_snapshots` will surface the bloat.

5. **Schema drift.** `normalize()` throws loudly if `id`, `time`, or `date` are missing from any entry. It also validates that `date` matches `YYYY-MM-DD`. Do NOT silently zero-fill.

## Fixture

`fixtures/hours-30d-sample.json` — 12 redacted time entries from a Hiilite-style workspace covering April 2026. User names and task names are redacted / genericized. Total: 86,400 seconds = 24 hours.
