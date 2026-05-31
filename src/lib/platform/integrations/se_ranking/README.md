# SE Ranking Adapter

Provider: SE Ranking  
Adapter: `se_ranking`  
Auth model: API key (`Authorization: Token <api_key>` header)  
API base: `https://api.seranking.com/`

---

## Auth model

SE Ranking uses a per-account API key. No OAuth. The key is stored in `config_json.apiKey` (plaintext at rest — see §API key storage below).

### Getting an API key

1. Log in to SE Ranking.
2. Go to Settings (top-right profile menu) → API.
3. Generate a new API key.
4. Copy the key into the Hiilite connect form.

---

## Connect flow (multi-step picker)

**Step 1 — Key validation**  
Route collects API key from form. Calls `listProjects(apiKey)` to validate the key and populate the project picker. On auth failure (401/403), surface "Invalid API key" to the user.

**Step 2 — Project picker**  
PM selects which SE Ranking site to track. One integration row = one SE Ranking site. `listProjects()` returns `{ id, name, domain, isActive, keywordsCount }[]` sorted alphabetically.

**Step 3 — Finalize**  
Route calls `adapter.connect(ctx)` with `ctx.callbackState = { projectId, projectName }`. Integration row is written. `integrationId` returned.

### config_json shape

```ts
{
  apiKey: string       // SE Ranking API key (plaintext)
  projectId: number    // SE Ranking numeric site ID
  projectName: string  // Display name (from SE Ranking project title)
}
```

To get a project ID manually: in SE Ranking UI, go to Sites & Pages → click any project → the URL contains the numeric ID: `/sites/{id}/...`.

---

## API endpoints used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sites` | List user's tracked sites (connect + picker) |
| GET | `/sites/{id}/positions` | Current keyword positions |
| GET | `/sites/{id}/positions/history` | Daily avg position history for a date range |

Parameters for `/positions/history`: `date_from=YYYY-MM-DD`, `date_to=YYYY-MM-DD`.

Note: the `/positions` endpoint returns the most recent check result for each keyword (point-in-time, not time-series). The `previous_position` field on each keyword record is the position from the previous SE Ranking check (not necessarily the period start). The `/positions/history` endpoint provides the time-series data at project level (avg across all keywords).

---

## Rate limits

100 requests/minute per API key (documented by SE Ranking).

`fetchSnapshot` makes 2 parallel API calls per integration (positions + history). Even at high frequency, this is well under the cap.

Backoff strategy: 429 and 5xx responses get up to 3 retries at 1s/2s/4s exponential backoff. Persistent 429s surface as `yellow:rate_limited` in health().

---

## Normalized metric slugs

| Slug | Type | Unit | Description |
|------|------|------|-------------|
| `rank.average_position` | MetricValue | `rank` | Average rank across all tracked keywords currently in top 100 |
| `rank.keywords_top10` | MetricValue | `count` | Number of tracked keywords ranking in positions 1-10 |
| `rank.keywords_top3` | MetricValue | `count` | Number of tracked keywords ranking in positions 1-3 |
| `rank.movement_daily` | MetricSeries | — | Daily avg position (lower = better). Columns: `date`, `avg_position` |
| `rank.keywords` | MetricSeries | — | Top 50 keywords sorted by current rank. Columns: `keyword`, `current_rank`, `previous_rank`, `delta` |

**Delta convention**: `delta = previous_rank - current_rank`. Positive value = rank improved (moved up). Negative = declined. Zero if either rank was outside top 100.

**Rank sentinel**: SE Ranking returns 0 or null for keywords not in top 100. The adapter converts these to `null` in the MetricSeries rows (renderer shows "—") and excludes them from average_position calculations.

---

## API key storage

The SE Ranking API key is stored plaintext in `config_json` alongside `projectId` and `projectName`. This matches the pattern used by PageSpeed Insights and Everhour adapters in this codebase.

Rationale: SE Ranking API keys do not grant write access to the tracked site (read-only rank data). The key can be revoked and regenerated in SE Ranking settings at any time. The risk profile is comparable to an analytics read-only token.

If key rotation is needed: disconnect the integration and reconnect with the new key.

---

## Known gotchas

1. **Check frequency mismatch**: SE Ranking checks keyword positions at intervals set per project (daily, every 3 days, weekly). The `/positions` endpoint returns the most recent check, not necessarily "today's" data. If a PM pulls a report on a non-check day, `current_rank` may be 1-6 days old. The `last_check_date` field on each keyword row shows when SE Ranking last updated it.

2. **`previous_position` definition**: SE Ranking's `previous_position` is the position from the check immediately prior to the current one — not the position at the start of the report period. For a 30-day report, this means delta reflects only the change between the last two checks, not the full 30-day movement. Phase 3 can compute full-period delta by joining two snapshots.

3. **Search engine configs**: SE Ranking projects can track keywords across multiple search engines (Google US, Google UK, Bing, etc.). The `/positions` endpoint returns positions across the default engine unless `site_engine_id` is specified. For Phase 2 we use the default (no filter), which returns Google results in the account's primary market.

4. **Keyword count cap**: `fetchSnapshot` paginates up to 50 pages of 250 keywords (12,500 max). This covers all realistic Phase 2 clients. If a client tracks more than 12,500 keywords, we stop at 12,500 — increase the page cap in `fetchPositions` if needed.

5. **Empty history**: If SE Ranking has no history data for the requested period (e.g., project created mid-period), `history` is empty. The normalizer surfaces a warning rather than throwing.

---

## Smoke test (QA engineer)

Fixture: `fixtures/rank-30d-sample.json`

Run `normalize(fixture)` and assert:
- `rank.average_position.value` ≈ 10.3 (average of positions for the 15 keywords in the fixture, excluding position 31 which brings it up slightly)
- `rank.keywords_top3.value` === 3 (positions 2, 1, 1)
- `rank.keywords_top10.value` === 9 (positions 2,1,3,7,5,8,4,6,9)
- `rank.movement_daily.rows.length` === 15
- `rank.keywords.rows.length` === 15 (all 15 from fixture, under 50 cap)
- `rank.keywords.rows[0].keyword` === `"family dentist glenvalley"` (rank 1)
- `rank.keywords.rows[0].delta` === 0 (previous = 1, current = 1)
- `rank.keywords.rows[1].keyword` === `"glenvalley dental care"` (rank 1, alpha tiebreak)
