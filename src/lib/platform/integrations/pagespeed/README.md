# PageSpeed Insights — adapter notes

Provider slug: `pagespeed`. Auth model: `api_key`.

## Slice B changes (2026-05-27)

- Adapter now fetches **both mobile + desktop** in parallel per refetch.
- Emits **suffix slugs** (`pagespeed.performance_mobile`, `pagespeed.performance_desktop`, etc.) — old plain slugs (`site_health.performance_score`, etc.) are gone.
- `pagespeed` removed from `POINT_IN_TIME_PROVIDERS` — it is now a time-series provider.
- Each refetch creates a **new snapshot row** dated to today (`period_start = period_end = today UTC`). Old snapshots accumulate; they will not render in the new chart (legacy data stays in the DB).
- `config_json.strategy` is now optional/vestigial — stored for backward compat but ignored at fetch time.
- INP replaces TBT in the normalized output. TBT is not emitted.

## Auth model

Google API key. No OAuth. One key per integration, stored in `config_json`.

**Required env vars:** none at the app level. The key is per-integration, not a global env var.

**API key storage decision:** the PageSpeed API key lives in `platform_integrations.config_json` (plaintext at rest in SQLite). This is intentional. Rationale:

- PageSpeed API keys are not credentials that grant account access. They are quota-tracking keys scoped to a Google Cloud project. If one leaks, it is rotatable in Google Cloud Console in under a minute with no client data exposure.
- The alternative (storing in `platform_oauth_tokens` via `vault.ts`) is over-engineered for this threat model — the vault exists for OAuth access/refresh tokens that grant account-wide read access.
- The API key is visible only to users with SQLite-level access to `~/code/store/motion.db`, which is the same as full server access.

If the threat model changes (e.g., PageSpeed keys start granting billing or data access), revisit this at that point.

**config_json shape:**

```json
{
  "url": "https://glenvalleydental.ca/",
  "apiKey": "AIzaSy...",
  "strategy": "mobile"
}
```

`strategy` is vestigial as of Slice B — stored for backward compat, ignored by the adapter.

## Rate limits

- **25,000 calls/day per API key** (per-project Google quota). Two calls per `fetchSnapshot()` (mobile + desktop).
- At daily cadence for 1,000 clients: 2,000 calls/day — well within limits.
- No per-second limit documented; in practice Google throttles burst usage above ~10/s.

Retry strategy: 429 and 5xx get up to 3 attempts with 1s/2s/4s exponential backoff. PageSpeed occasionally returns 500 when the Lighthouse runner crashes against a slow target site; the backoff handles this.

## Lighthouse categories requested

All four in each call:
- `performance`
- `accessibility`
- `seo`
- `best-practices`

## Normalized metric slugs (Slice B)

| Slug | Source | Unit |
|------|--------|------|
| `pagespeed.performance_mobile` | `categories.performance.score * 100` (mobile) | `count` (0-100) |
| `pagespeed.performance_desktop` | `categories.performance.score * 100` (desktop) | `count` (0-100) |
| `pagespeed.accessibility_mobile` | `categories.accessibility.score * 100` (mobile) | `count` (0-100) |
| `pagespeed.accessibility_desktop` | `categories.accessibility.score * 100` (desktop) | `count` (0-100) |
| `pagespeed.seo_mobile` | `categories.seo.score * 100` (mobile) | `count` (0-100) |
| `pagespeed.seo_desktop` | `categories.seo.score * 100` (desktop) | `count` (0-100) |
| `pagespeed.best_practices_mobile` | `categories['best-practices'].score * 100` (mobile) | `count` (0-100) |
| `pagespeed.best_practices_desktop` | `categories['best-practices'].score * 100` (desktop) | `count` (0-100) |
| `pagespeed.lcp_mobile` | `audits['largest-contentful-paint'].numericValue` (mobile) | `ms` |
| `pagespeed.lcp_desktop` | `audits['largest-contentful-paint'].numericValue` (desktop) | `ms` |
| `pagespeed.cls_mobile` | `audits['cumulative-layout-shift'].numericValue` (mobile) | `count` (unitless float) |
| `pagespeed.cls_desktop` | `audits['cumulative-layout-shift'].numericValue` (desktop) | `count` (unitless float) |
| `pagespeed.inp_mobile` | `audits['experimental-interaction-to-next-paint'].numericValue` (mobile) | `ms` |
| `pagespeed.inp_desktop` | `audits['experimental-interaction-to-next-paint'].numericValue` (desktop) | `ms` |
| `pagespeed.ttfb_mobile` | `audits['server-response-time'].numericValue` (mobile) | `ms` |
| `pagespeed.ttfb_desktop` | `audits['server-response-time'].numericValue` (desktop) | `ms` |

**Absent slugs:** INP slugs are omitted entirely (not emitted as 0) when the Lighthouse version does not include the INP audit. Similarly, LCP/CLS/TTFB are omitted when the audit is absent. Renderer must treat a missing slug as N/A, not zero.

**CLS scale:** raw float (0.0–~1.0, 4 decimal places). NOT multiplied by 100. Unit is `count`.

**Renderer threshold hints:**
- Scores (0-100): green ≥ 90, yellow 50-89, red < 50.
- LCP: green ≤ 2500ms, yellow ≤ 4000ms, red > 4000ms.
- CLS: green ≤ 0.1, yellow ≤ 0.25, red > 0.25.
- INP: green ≤ 200ms, yellow ≤ 500ms, red > 500ms.
- TTFB: green ≤ 800ms, yellow ≤ 1800ms, red > 1800ms.

## periodStart / periodEnd

As of Slice B: `period_start = period_end = today's UTC date (YYYY-MM-DD)` for every snapshot. This is set by the normalizer and is NOT overridden by the refetch route. Each daily refetch creates a new row — chart x-axis is the date column. Use `getLatestSnapshot` to show the current tile; future chart renderer will query all snapshots for the integration ordered by period_end.

## Known gotchas

1. **Score variability.** Lighthouse scores can vary ±5 points between runs due to network conditions and CPU throttling. Don't alert clients on single-point changes — chart the trend.
2. **Flaky on slow sites.** Sites with server response times > 5s sometimes cause the Lighthouse runner to abort. The retry strategy handles transient failures; if all 3 attempts fail for a strategy, the adapter logs the error and emits a partial snapshot (the other strategy). If BOTH fail, the adapter throws.
3. **server-response-time audit absent.** Google omits this audit on pages with multiple redirects. The normalizer treats this as soft drift: the `pagespeed.ttfb_*` slug is simply not emitted (no 0 fill, no throw) and a warning is appended to `MetricEnvelope.warnings`.
4. **INP availability.** `experimental-interaction-to-next-paint` requires Lighthouse 10+. The normalizer falls back to `interaction-to-next-paint` (non-experimental key), then soft-drifts to absent (no slug emitted, warning appended). This is expected on older API versions.
5. **best-practices key.** The API returns the category under the key `best-practices` (with a hyphen). TypeScript indexing requires bracket notation: `categories['best-practices']`.
6. **Local or dev URLs.** PageSpeed cannot audit localhost or IP addresses. Integration should validate that `config_json.url` starts with `https://` and is publicly routable before creating the integration row.
7. **Lighthouse version drift.** Google updates Lighthouse periodically. Score thresholds and audit availability can change. If a category disappears entirely, `normalize()` throws (hard drift). If an audit disappears, it's soft drift (slug omitted, warning appended).
8. **Legacy snapshots.** Pre-Slice-B snapshots in `platform_snapshots` use old slug names (`site_health.performance_score`, etc.) and a single-strategy raw shape. They will not render in the new chart — this is intentional. They stay in the DB and are not deleted.

## Partial fetch behavior

If mobile succeeds but desktop fails (or vice versa): the adapter logs the error, emits a raw snapshot with the failing strategy's field set to `null`, and appends a `fetchWarning`. The normalizer emits slugs only for the strategy that succeeded. The snapshot is still persisted — partial data is better than no data.

If both strategies fail: the adapter throws. The refetch route returns a 500 and no snapshot is persisted.

## Caller contract

Adapter does NOT persist snapshots. Caller must:

```ts
const raw  = await pagespeedAdapter.fetchSnapshot(args)
const norm = pagespeedAdapter.normalize(raw)
// NOTE: do NOT override norm.periodStart / norm.periodEnd for pagespeed.
// The normalizer owns today's date. The refetch route handles this automatically.
await snapshots.persistSnapshot({ raw, normalized: norm, ... })
```

`fetchSnapshot` stamps `last_synced_at`, `status`, and `last_health_*` on the integration row as its only side effect.

## Connect flow (no OAuth)

Route handler sequence for connecting a PageSpeed integration:

1. User submits form: `{ apiKey, url, strategy? }`.
2. Route handler validates `url` is a valid HTTPS URL.
3. (Optional but recommended) Route handler makes a test PageSpeed call to verify the key and URL work before creating the integration row.
4. Route handler calls `adapter.connect(ctx)` with `apiKey` and `callbackState: { url, strategy? }`.
5. Adapter creates the integration row; returns `{ integrationId }`.
6. Route handler redirects to `/platform/integrations/{integrationId}` (no site picker needed).

`strategy` in `callbackState` is now optional (vestigial). Adapter stores it in `config_json` for backward compat but does not use it for fetch decisions.

## Files

```
pagespeed/
├── adapter.ts          # AdapterContract<PageSpeedRawSnapshot, PageSpeedNormalized>
├── normalize.ts        # PageSpeedRawSnapshot → PageSpeedNormalized (pure, suffix slugs)
├── types.ts            # PageSpeedApiResponse, PageSpeedRawSnapshot, etc.
├── README.md           # this file
└── fixtures/
    └── pagespeed-sample.json   # dual-strategy synthetic payload for qa-engineer tests
```
