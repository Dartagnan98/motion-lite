# WordPress REST Adapter

Provider: WordPress  
Adapter: `wordpress`  
Auth model: `basic_auth` — WordPress Application Passwords  
API base: `<siteUrl>/wp-json/`

---

## Auth model

WordPress Application Passwords provide per-user access tokens that authenticate over HTTP Basic auth. Added in WordPress 5.6 (released December 2020). Most sites running 5.6+ have this available without any plugin.

The adapter constructs the Authorization header as:

```
Authorization: Basic base64("username:appPassword")
```

`callWordPress()` is exported from `adapter.ts` for use by the Gravity Forms adapter (same site, same auth, different REST namespace).

### Setting up an Application Password

1. Log in to WordPress admin.
2. Go to Users → Your Profile (or Users → All Users → edit the relevant user).
3. Scroll to the "Application Passwords" section (near the bottom).
4. Enter a name for the new password (e.g. "Hiilite Platform").
5. Click "Add New Application Password".
6. Copy the generated password (shown once, spaces included). It looks like: `AbCd EfGh IjKl MnOp QrSt UvWx`.
7. Use the WordPress login username (not email) + this password in the Hiilite connect form.

**Note**: Application Passwords require HTTPS on the site. WordPress blocks them on plain HTTP by default.

---

## Connect flow (single-step)

Route collects: site URL + username + application password.  
`adapter.connect()` calls `GET /wp-json/wp/v2/users/me` with the credentials. On 200, writes the integration row. On 401, surfaces "Invalid credentials" to the user.

### config_json shape

```ts
{
  siteUrl: string      // Canonical site URL, e.g. "https://glenvalleydental.com"
  username: string     // WP login username (not email)
  appPassword: string  // Application Password with spaces (WP format)
}
```

---

## API endpoints used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/wp-json/` | Site root — extract WP version |
| GET | `/wp-json/wp/v2/users/me` | Validate credentials (connect) |
| GET | `/wp-json/wp/v2/posts` | Count posts in period (X-WP-Total) + recent posts list |
| GET | `/wp-json/wp/v2/pages` | Count pages in period (X-WP-Total) |
| GET | `/wp-json/wp/v2/media` | Count media uploads in period (X-WP-Total) |

### Count pattern

For total counts, we pass `per_page=1` and read the `X-WP-Total` response header. WP REST sets this header on all paginated endpoints — it is the total matching the filter, not the page size. This avoids paginating through all results when we only need the count.

```
GET /wp-json/wp/v2/posts?after=2026-04-01T00:00:00&before=2026-04-30T23:59:59&status=publish&per_page=1
X-WP-Total: 3
```

### WP version extraction

The site root (`GET /wp-json/`) returns the WP version in the `wp_version` field. Some sites remove this via security plugins (Wordfence "Remove WordPress Version", iThemes Security "Hide Backend"). If the field is absent, the normalizer stores `"unknown"` and surfaces a warning.

---

## Rate limiting

WordPress does not enforce a hard rate limit. Hiilite adds a 1-second delay between sequential API calls as a courtesy to the hosting server. `fetchSnapshot` makes 5 sequential calls = ~5 seconds wall time per snapshot. Acceptable for report generation flows.

Backoff strategy: 429 and 5xx get up to 3 retries at 1s/2s/4s. Persistent server errors surface as `yellow:stale` in health().

---

## Normalized metric slugs

| Slug | Type | Unit | Description |
|------|------|------|-------------|
| `wp.posts_published` | MetricValue | `count` | Posts published in the report period |
| `wp.pages_published` | MetricValue | `count` | Pages published in the report period |
| `wp.wp_version` | MetricValue | `count` | WP version string (e.g. "6.5.2"). Renderer treats as string. |
| `wp.recent_posts` | MetricSeries | — | Last 10 published posts. Columns: `title`, `publish_date` (YYYY-MM-DD), `status` |
| `wp.media_uploads` | MetricValue | `count` | Media items uploaded in the report period |

`wp.wp_version` uses `unit: 'count'` because the contract has no string unit. The renderer should detect a string value and skip the numeric formatter.

---

## App password storage

The Application Password is stored plaintext in `config_json`. Same model as PageSpeed Insights and Everhour adapters.

Rationale: WP Application Passwords are read-only from Hiilite's perspective (we never write to the site). The password can be revoked instantly from WP admin under Users → Profile → Application Passwords → Revoke. The risk profile is a read-only analytics token.

If credentials change (password rotated): disconnect and reconnect with the new password.

---

## Known gotchas

1. **HTTPS required**: WP blocks Application Passwords on HTTP-only sites. The connect will fail with 401 if the site is not HTTPS. Surface "WordPress Application Passwords require HTTPS" to the user.

2. **Version hidden by security plugin**: Wordfence, iThemes Security, and others can suppress `wp_version` from the REST root. If `wpVersion` is null, the normalizer stores "unknown" and warns. This is not an error — it's a deliberate site hardening decision.

3. **Application Passwords blocked by plugin**: Some hardened setups disable the Application Passwords feature entirely (e.g. very old security plugins, or WP < 5.6). The adapter will get 401 on `/users/me` in that case. Document the resolution in the error message: "Application Passwords may be disabled on this site — check the WP version and security plugin settings."

4. **Custom REST base slug**: Some WP installs use a non-standard REST API URL (e.g. changing `/wp-json/` to `/api/`). Our adapter hardcodes `/wp-json/`. If a site has customized the REST slug, the connect will 404. Workaround: the PM should provide the correct REST base URL in siteUrl if the site has a non-standard config.

5. **`after`/`before` param timezone**: WP REST interprets `after`/`before` in the site's local timezone, not UTC. For most dental practice sites (US-based), this difference is < 1 day. For precise period matching, the PM should be aware the count may vary slightly from expected based on timezone.

---

## Smoke test (QA engineer)

Fixture: `fixtures/wp-30d-sample.json`

Run `normalize(fixture)` and assert:
- `wp.posts_published.value` === 3
- `wp.pages_published.value` === 1
- `wp.wp_version.value` === `"6.5.2"`
- `wp.media_uploads.value` === 14
- `wp.recent_posts.rows.length` === 5
- `wp.recent_posts.rows[0].title` === `"Spring Dental Tips: How to Care for Your Teeth This Season"`
- `wp.recent_posts.rows[0].publish_date` === `"2026-04-28"`
