# Google Analytics 4 (GA4) — adapter notes

Provider slug: `ga4`. Auth model: `oauth`.

## Auth model

OAuth 2.0, Authorization Code flow. Shares the same Google Cloud Console project and OAuth credentials as the GSC adapter.

**Required env vars (shared with GSC and motion-lite Calendar OAuth):**

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CRM_ENCRYPTION_KEY` — used by `vault.ts` to encrypt access/refresh tokens at rest

**Scopes requested:**

```
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/userinfo.email
```

`analytics.readonly` covers the GA4 Data API (runReport) and the Analytics Admin API (accountSummaries). We do not write to GA4. `userinfo.email` lets us label the integration in the dashboard.

**Redirect URI:** caller decides; pass via `ConnectContext.redirectUri`. Dev: `http://localhost:4000/api/platform/integrations/ga4/callback`. Production redirect URI must be registered in Google Cloud Console.

**OAuth verification:** `analytics.readonly` is a restricted scope in Google's OAuth verification process. Apply for production verification (per HANDOFF-PHASE-2-SPRINT-1.md) before shipping to real clients. Dev and test accounts (added as test users in Google Cloud Console) work without verification.

**Refresh tokens:** same behavior as GSC. Google returns one on first consent (`prompt=consent`, `access_type=offline`). Persisted encrypted. Google occasionally rotates refresh tokens — the refresh response may include a new one, and `vault.updateAccessToken` overwrites if non-null. If the grant is revoked, `health()` returns `red:auth_expired`.

## Property hierarchy

GA4 hierarchy: Google Account → GA4 Account → Property → Data Stream.

We target the **Property** level. A Property maps to one website (or app). The Analytics Admin API's `accountSummaries` endpoint returns all Accounts and Properties the OAuthed user can read in a single paged call.

`config_json` shape: `{ "propertyId": "123456789" }` (numeric string, without the `properties/` prefix the Admin API uses).

**After OAuth:** call `listProperties(accessToken)` from `oauth.ts` to enumerate the user's accessible properties. The frontend presents a picker. The selected `propertyId` goes into `config_json` via `completeConnect()`.

**Property types:** only `PROPERTY_TYPE_ORDINARY` properties are surfaced in the picker. Subproperties and rollup properties are filtered out — they are composites that most PMs do not intend to connect directly.

## Rate limits

- **GA4 Data API (analyticsdata.googleapis.com):**
  - 200,000 requests/day per Google Cloud project
  - 50,000 requests/day per property
  - 10 requests/second per property (short burst)
- **Analytics Admin API (analyticsadmin.googleapis.com):**
  - 10,000 requests/day per project
  - Used only during connect (listProperties), not during fetchSnapshot

We issue 4 sequential `runReport` calls per `fetchSnapshot`: summary, daily, top pages, top sources. Sequential rather than parallel to fail fast on the first auth error and to stay within the per-second quota.

Retry strategy: 429 and 5xx get up to 3 attempts with 1s/2s/4s exponential backoff. 401/403 fail immediately.

## Data sampling

GA4 samples results on high-traffic properties at the property level when the query would touch billions of events. Sampling is indicated by `samplingMetadatas` in the response. The normalizer detects this and appends a warning to `MetricEnvelope.warnings` (surfaced in the renderer).

Properties on the GA4 360 tier are not sampled — but we have no way to detect the tier programmatically.

## Date format quirk

GA4 Data API returns dates in `YYYYMMDD` format (e.g. `20260408`), not `YYYY-MM-DD`. The fixture reflects this. The normalizer passes the raw value through to `MetricSeries` rows; the renderer must format for display.

## Known gotchas

1. **Date format:** daily rows come back as `YYYYMMDD` strings. Renderer must parse/format.
2. **engagementRate vs bounceRate:** GA4's `bounceRate` is the complement of `engagementRate` (i.e., `bounceRate = 1 - engagementRate`). The normalizer converts both to percentages (multiply by 100). Do not double-multiply in the renderer.
3. **New property, no data:** a GA4 property with no events in the period returns an empty `rows` array (not `null`). The normalizer handles this gracefully (all totals zero, empty series).
4. **Universal Analytics vs GA4:** if a user connects a Universal Analytics property (GA3), the Data API returns 404. The error surfaces as a transient adapter error. The fix is to migrate to GA4 — we cannot support UA.
5. **Multi-property accounts:** large agencies may have 50+ properties across multiple accounts. The property picker must be searchable. The `listProperties` response is flat (account name + property name), sorted alphabetically.
6. **sessionSourceMedium "(not set)":** GA4 frequently returns `(not set)` for direct or dark traffic. This is correct behavior; the renderer should display it as-is.
7. **Timezone:** GA4 reports are in the property's configured timezone, not UTC. The `metadata.timeZone` field is available in the response. We do not currently normalize to UTC — document timezone in report headers.

## Caller contract

Adapter does NOT persist snapshots. Caller must:

```ts
const raw  = await ga4Adapter.fetchSnapshot(args)
const norm = ga4Adapter.normalize(raw)
await snapshots.persistSnapshot({ raw, normalized: norm, ... })
```

`fetchSnapshot` stamps `last_synced_at`, `status`, and `last_health_*` on the integration row as its only side effect.

## Files

```
ga4/
├── adapter.ts          # AdapterContract<GA4RawSnapshot, GA4Normalized>
├── oauth.ts            # Google OAuth flow, token refresh, property listing
├── connect-flow.ts     # finishConnectStage1 / completeConnect (route handler seam)
├── normalize.ts        # GA4RawSnapshot → GA4Normalized (pure)
├── types.ts            # GA4ReportResponse, GA4RawSnapshot, GA4AccountSummary, etc.
├── README.md           # this file
└── fixtures/
    └── traffic-30d-sample.json   # synthetic 30-day payload for qa-engineer tests
```

## Scope justification (for Google OAuth verification application)

`analytics.readonly`: read-only access to GA4 reporting data and account structure. Required to call `properties.runReport` (traffic metrics) and `accountSummaries.list` (property picker during connect). No write operations. The user explicitly connects their GA4 property and consents to the scope; Hiilite uses the data solely to generate client-facing SEO/marketing retainer reports.
