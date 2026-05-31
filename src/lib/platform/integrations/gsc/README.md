# Google Search Console (GSC) — adapter notes

Reference implementation of `AdapterContract<GscRawSnapshot, GscNormalized>`.
Provider slug: `gsc`. Auth model: `oauth`.

## Auth model

OAuth 2.0, Authorization Code flow.

**Required env vars (existing, shared with motion-lite Calendar OAuth):**

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CRM_ENCRYPTION_KEY` — used by `vault.ts` to encrypt access/refresh tokens at rest

**Scopes requested:**

```
https://www.googleapis.com/auth/webmasters.readonly
https://www.googleapis.com/auth/userinfo.email
```

`webmasters.readonly` is enough for `sites.list` and `searchAnalytics.query`. We do not write to GSC. `userinfo.email` is requested so we can label the integration "GSC — pm@hiilite.com" in the dashboard.

**Redirect URI:** caller decides; pass via `ConnectContext.redirectUri`. Phase 1 uses `http://localhost:4000/api/platform/integrations/gsc/callback`. Production redirect URI must be registered in Google Cloud Console.

**Refresh tokens:** Google returns one on the first consent (`prompt=consent`, `access_type=offline`). We persist it encrypted in `platform_oauth_tokens.refresh_token_encrypted`. Refresh tokens occasionally rotate — the refresh response may include a new one, and `vault.updateAccessToken` overwrites if non-null. If rotation fails (Google revoked the grant) `health()` returns `red:auth_expired`.

## Rate limits

- **Per-project (your Google Cloud project):** 200 QPS for `searchAnalytics.query`.
- **Per-user:** ~1,200 queries/min.
- **Per-site:** none documented; high-traffic sites still hit the per-project quota first.

We make 3 sequential calls per `fetchSnapshot()`: daily, top queries, top pages. At normal cadence (one fetch per client per day) we are nowhere near limits. If integrations-engineer adds parallel multi-client refresh, throttle at the client level, not at the call level.

## Data sampling

GSC samples results on high-traffic sites — typically when a single query result would exceed ~50k rows. The API does not flag sampling per-row. Our `dimensions=['date']` daily call returns at most 90 rows for a 90-day window so it never samples. `top_queries` and `top_pages` are limited to 25 rows each, well under the sampling threshold.

If we later expand row limits, surface a warning in `MetricEnvelope.warnings` like `"Top queries sampled by Google for high-traffic sites."`.

## Verified ownership

GSC will only return data for sites the OAuthed account has been verified for. The `connect()` flow lists the user's verified properties via `sites.list`; the UI must let the PM pick. Unverified sites return 403 from `searchAnalytics.query`.

## Property URL formats

GSC supports two property types:

- **URL-prefix:** `https://glenvalleydental.com/`
- **Domain:** `sc-domain:glenvalleydental.com`

Both are valid `siteUrl` values for `searchAnalytics.query`. The adapter passes through whatever the user picks during connect — we store it on `platform_integrations.config_json.siteUrl`.

## Known gotchas

1. **Empty rows on new sites.** First 2-3 days of data after verification often return empty. Treat zero-row daily responses as valid (the normalizer handles this).
2. **Date drift.** GSC data is finalized ~3 days after the date. Reports that pull "yesterday" will show zeros; we recommend `period_end = today - 3` for the SEO retainer template.
3. **Position float oddity.** Position is reported per-row averaged (so `4.5` is normal). Period-level "average position" is the unweighted mean across days, which slightly biases toward low-traffic days. The renderer can label the metric as "Average daily position" to be honest.
4. **Domain property sub-paths.** `sc-domain:` properties aggregate all subdomains and protocols. If a client has both `www.` and bare-domain set up, expect higher numbers than a `https://www...` URL-prefix property would show.

## Acceptance against Sprint 1 spec

| # | Criterion | Status |
|---|---|---|
| 1 | "Connect GSC" → Google OAuth → stored integration row + encrypted token | passes (oauth.ts + persistIntegration) |
| 2 | `fetchSnapshot()` over 30 days lands raw + normalized rows in `platform_snapshots` | passes (adapter.fetchSnapshot + snapshots.persistSnapshot) |
| 3 | `health()` returns green right after a successful fetch | passes (adapter.health checks last_synced_at + token validity) |
| 4 | Token refresh runs automatically when expired | passes (oauth.getValidAccessToken with serialized refresh) |
| 5 | README documents scopes, rate limits, gotchas | this file |

## What integrations-engineer must mirror for the next 9

1. **Folder layout:** `<provider>/{adapter,oauth-or-auth,normalize,types,README,fixtures/}.ts`.
2. **Adapter shape:** `AdapterContract<RawT, NormT extends MetricEnvelope>`. Don't invent your own.
3. **Token storage:** always via `vault.ts`. Never store credentials in `platform_integrations.config_json`.
4. **Snapshot writes:** always via `snapshots.persistSnapshot`. Don't insert into `platform_snapshots` directly.
5. **Health probes:** must be ≤ 1s. Read from the integration row; only ping the provider if you have to.
6. **Slug namespace:** prefix every metric with the provider's primary metric category (`search_performance.*`, `traffic.*`, `ads.spend.*`). Document in your README.
7. **Schema drift:** `normalize()` throws on missing required fields. Don't silently default. The renderer surfaces these as `red:schema_drift`.
