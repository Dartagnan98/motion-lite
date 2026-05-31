# Gravity Forms Adapter

Provider: Gravity Forms  
Adapter: `gravity_forms`  
Auth model: `basic_auth` — WordPress Application Passwords (same as WordPress adapter)  
API base: `<siteUrl>/wp-json/gf/v2/`

---

## Auth model

Gravity Forms REST API uses the same WordPress Application Password mechanism as the WordPress REST adapter. The HTTP Basic auth header is constructed identically:

```
Authorization: Basic base64("username:appPassword")
```

`callWordPress()` is imported from the WordPress adapter — the HTTP layer is shared.

The Gravity Forms namespace is `gf/v2` (not the WP core `wp/v2` namespace).

---

## Prerequisites — enabling GF REST API

The Gravity Forms REST API is disabled by default. It must be enabled before the adapter can connect.

1. Log in to WordPress admin.
2. Go to Forms → Settings → REST API tab.
3. Check "Enable access to the API" (Gravity Forms v2.4+).
4. Save settings.

On older Gravity Forms versions (< 2.4), the REST API tab may not exist. The endpoint `/wp-json/gf/v2/forms` will return 404 if the REST API is not enabled.

---

## Connect flow (multi-step picker)

**Step 1 — Credentials**  
Route collects site URL + username + application password. Calls `listForms(args)` to validate credentials and populate the form picker.

**Step 2 — Form picker**  
PM multi-selects which forms to track. `listForms()` returns `{ formId, title, isActive, totalEntries }[]` sorted alphabetically. If formIds is left empty, the adapter queries all visible forms.

**Step 3 — Finalize**  
Route calls `adapter.connect(ctx)` with `ctx.callbackState = { siteUrl, username, appPassword, formIds, formNames }`. Integration row written. `integrationId` returned.

### config_json shape

```ts
{
  siteUrl: string      // WordPress site URL
  username: string     // WP login username
  appPassword: string  // Application Password (with spaces)
  formIds?: string[]   // Selected GF form IDs. Empty = all forms.
  formNames?: string[] // Display names parallel to formIds (for tile labels)
}
```

---

## API endpoints used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/wp-json/gf/v2/forms` | List forms (connect + picker) |
| GET | `/wp-json/gf/v2/entries` | Entry counts + date listing for daily series |

### Entry count pattern

For total count per form, we request `paging[page_size]=1` and read `total_count` from the response body:

```
GET /wp-json/gf/v2/entries
  ?form_ids=1
  &search={"start_date":"2026-04-01","end_date":"2026-04-30"}
  &paging[page_size]=1
  &paging[current_page]=1
Response: { "total_count": 32, "entries": [...1 entry...] }
```

### Daily series pattern

GF does not have a server-side daily grouping. The adapter fetches all entry records (`id`, `date_created`, `status`) with pagination, then groups client-side by date. All days in the period are pre-initialized to 0 to avoid chart gaps on days with no submissions.

---

## Rate limiting

GF REST inherits WordPress's no-hard-limit policy. Hiilite adds 1-second delays between calls.

`fetchSnapshot` call count: 1 (list forms if no filter) + N (one per selected form for count) + P (paginated entry date fetch, typically 1-2 pages). For 3 selected forms with 50-200 entries/month: ~5-8 API calls total.

Pagination cap: 20 pages x 250 entries = 5000 entries maximum per fetchSnapshot. If a form exceeds 5000 entries in a period, daily counts are truncated at the cap. This is noted in the raw snapshot and warned in normalize. Realistic for Phase 2 (dental practices typically see < 200 form submissions/month).

---

## Normalized metric slugs

| Slug | Type | Unit | Description |
|------|------|------|-------------|
| `forms.total_entries` | MetricValue | `count` | Total entries across selected forms in the report period |
| `forms.by_form` | MetricSeries | — | Per-form breakdown. Columns: `form_title`, `entries` |
| `forms.daily` | MetricSeries | — | Daily entry count. Columns: `date` (YYYY-MM-DD), `count`. All days in period included (0-filled). |

`forms.conversion_rate` is deferred to Phase 3 (requires GA4 session data join).

---

## App password storage

Same decision as WordPress and PageSpeed adapters — stored plaintext in `config_json`. GF access via Application Password is read-only from Hiilite's perspective. Revoke at any time in WP admin → Users → Profile → Application Passwords.

---

## Known gotchas

1. **GF REST API disabled**: The most common failure mode. If `/gf/v2/forms` returns 404, GF REST is not enabled. The connect flow should surface: "Gravity Forms REST API is not enabled — go to Forms → Settings → REST API and enable it."

2. **GF `is_active` type varies**: Older GF versions return `is_active` as a string `"1"`/`"0"`, newer versions return a boolean. `listForms()` handles both shapes.

3. **Entry `date_created` timezone**: GF stores `date_created` in the site's local timezone without a timezone indicator. The adapter slices the first 10 chars for date grouping (`YYYY-MM-DD`). For sites near a timezone boundary and with non-UTC hosts, entries submitted near midnight may appear in the wrong day's count. Acceptable for Phase 2.

4. **GF form response shape**: `GET /gf/v2/forms` returns forms as a keyed object `{ "1": {...}, "2": {...} }` when multiple forms exist, or as an array in some GF versions. `listForms()` handles both.

5. **`_field_ids` parameter**: The `_field_ids` parameter is used to request only specific fields from entries (to reduce payload size). Some GF versions may ignore this and return the full entry. The adapter handles either — it only reads `id`, `date_created`, and `status` from each entry.

6. **Spam/trash entries**: The adapter filters to `status === 'active'` when building the daily series. Spam entries are excluded. The total_count from the search endpoint may include spam entries in some GF configurations — we rely on the entries array for the daily series and the total_count for the KPI tile. These may diverge slightly on sites with heavy spam.

---

## Smoke test (QA engineer)

Fixture: `fixtures/gf-30d-sample.json`

Run `normalize(fixture)` and assert:
- `forms.total_entries.value` === 47
- `forms.by_form.rows.length` === 2
- `forms.by_form.rows[0].form_title` === `"Contact Us"` (32 entries, sorted desc)
- `forms.by_form.rows[1].form_title` === `"New Patient Appointment Request"` (15 entries)
- `forms.daily.rows.length` === 30 (all days in April)
- `forms.daily.rows[0].date` === `"2026-04-01"`
- `forms.daily.rows[29].date` === `"2026-04-30"`
- Sum of `forms.daily.rows.map(r => r.count)` === 47
