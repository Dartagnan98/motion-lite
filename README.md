# Motion Lite

A stripped-down fork of a working solopreneur productivity app. Local SQLite, Next.js 16, React 19. Runs on your Mac or any Node 20+ box.

**This is not perfect but it's close.** The original is a 100K-LOC client CRM with deep integrations (CRM, contacts, messaging, ad platforms, Square, Stripe, GHL). What you're getting here is the *productivity core* — projects, tasks, docs, AI meeting notes, and the dispatch system — with all the marketing / CRM / messaging surface area torn out.

Expect rough edges. Some routes import dead code that the strip pass didn't catch. Some UI surfaces will say "feature unavailable." If you hit a build error, it's almost always an import to a deleted file — delete the offending route or stub it. The friend who shared this with you is happy to help debug.

## What's in it

- **Projects** — workspaces → folders → projects → stages → tasks, with kanban/list/timeline views
- **Tasks** — kanban board, list view, drag-to-reorder, priority/due dates/effort, assignees
- **Docs** — Tiptap-based markdown notes attached to projects (live collab not wired in lite)
- **Meeting Notes** — paste a transcript or pipe one in via email; Anthropic summarizes, extracts action items, auto-creates tasks against the right project
- **Brain** — knowledge graph view (force-directed) over your projects/tasks/docs
- **Dispatch** — the agentic execution system. Schedules + queue + a "bridge" pattern that forwards tasks to a Claude Code instance on your local Mac. **Read the Dispatch section below carefully.**
- **Agents** — sub-agent definitions used by dispatch (Gary/Ricky/Sofia-style specialists)
- **Skills** — skills library (read-only; the actual SKILL.md files live in `~/.claude/skills/` on your machine)
- **Today / Agenda** — daily planning surface
- **Settings** — workspaces, members (single-user mode in lite), integrations (Meta Ads, Google Ads, Google OAuth, Zoom — bring your own OAuth apps + dev tokens, see `.env.example`)
- **Ads dashboards** — `/ads` (Meta) + `/google-ads` show campaign-level performance once you've connected your accounts

## Stack

- Next 16 (app router, React 19, server actions)
- better-sqlite3 (local file DB, no external service needed)
- Anthropic SDK (`@anthropic-ai/sdk`)
- Tiptap (rich-text editor)
- framer-motion + react-force-graph-2d (UI/graph)
- IMAP + mailparser (optional — for email-based transcript ingest)
- Electron (optional — desktop app wrapper)

## Setup (15 min)

### 0. (Strongly recommended) Install the marketing-skills bundle

The `/agents` page wires up sub-agents (Gary/Ricky/Sofia/Jimmy/etc) that reference skills living at `~/.claude/skills/`. Without those skills installed, agents will run with no domain context — fine for testing the dispatch loop, but useless for real work.

```bash
git clone https://github.com/Dartagnan98/hiilite-share ~/code/hiilite-share
cp -R ~/code/hiilite-share/1-marketing-skills/skills/* ~/.claude/skills/
```

Restart Claude Code (if open). Now the agents have something to call.

### 1. Clone + install

```bash
git clone https://github.com/Dartagnan98/motion-lite ~/code/motion-lite
cd ~/code/motion-lite
npm install
```

### 2. Make a store dir for the SQLite DB

The DB lives at `../store/motion.db` relative to cwd:

```bash
mkdir -p ~/code/store
```

(So your tree should be `~/code/motion-lite/` and `~/code/store/` side by side.)

### 3. Env

```bash
cp .env.example .env.local
# Edit .env.local — at minimum, set ANTHROPIC_API_KEY
```

**What you need to plug in (your own dev credentials):**

| Service | Required for | Where to get it |
|---|---|---|
| Anthropic API key | AI meeting notes, dispatch, agent runs | console.anthropic.com → API keys |
| SendGrid API key | Outbound email (notifications, invites). Can also be set in Settings → CRM → SendGrid (no restart). Alternative: SMTP creds. | sendgrid.com → Settings → API Keys |
| Facebook (Meta) developer app | Meta Ads dashboard (`/ads`), Facebook OAuth, ad account access | developers.facebook.com → My Apps → Create App → Business → grab App ID + Secret. Add scopes: `ads_management`, `ads_read`, `read_insights`, `pages_read_engagement`, `business_management` |
| Google OAuth client | Sign in with Google, Gmail send, Calendar sync, Google Ads OAuth | console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client ID. Authorized redirect: `http://localhost:4000/api/auth/google/callback` |
| Google Ads developer token | Google Ads dashboard (`/google-ads`), pulling campaign data | ads.google.com → Tools → API Center → request a developer token (takes 1-2 days for approval). Also need a Manager (MCC) account customer ID for `GOOGLE_ADS_LOGIN_CUSTOMER_ID` |
| Zoom OAuth app | Zoom transcript ingest into Meeting Notes | marketplace.zoom.us → Build App → OAuth → grab Client ID + Secret |
| VAPID keys | Web push notifications (optional) | `npx web-push generate-vapid-keys` |
| IMAP creds | Email-based meeting transcript ingest (Plaud/Otter/Fireflies → email) | App-specific password from Gmail/Outlook |

The Sign in with Google button is removed from the login page. If you wire your own Google OAuth (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`), the `/api/auth/google` route still works — just add the button back in `src/app/login/page.tsx`.

### 4. Run

```bash
npm run dev
# Opens on http://localhost:4000
```

First boot auto-creates the SQLite schema. Create your first admin user via the login API (signup is enabled, the first user becomes the owner):

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","name":"You","password":"pick-something","signup":true}'
```

Then go to http://localhost:4000/login and sign in with the email + password you just used.

### 5. First-run walkthrough

You're logged in. Now what:

1. **Settings → Workspaces** — your default workspace was auto-created. Rename it if you want.
2. **Projects** — click "New project," pick a stage layout (kanban or list), drop in a couple test tasks. Confirms the core loop works.
3. **Meeting Notes → New → Paste transcript** — paste any meeting transcript (or any chunk of text), click Process. If your Anthropic key is right, you'll get back a summary, action items, and auto-created tasks against the right project. This is the main AI feature — verify it works before going further.
4. **Agents → list** — confirm the bundled agents (Gary, Ricky, Sofia, Jimmy, etc) appear. These are MY fake-team naming convention — rename them to whatever fits your work. Each one is a sub-agent definition that calls into a skill from the bundle you installed in Step 0.
5. **(Optional) Dispatch** — if you set up the bridge in Step 6 below, you can now click "Dispatch" on any task and have your local Claude Code execute it.

### 7. (Optional) Build the desktop app

```bash
npm run electron
```

Wraps the app in Electron, runs locally as a desktop app.

## AI Meeting Notes

Anthropic processes the transcript — writes a summary, extracts action items, auto-creates tasks against the right project. Three ways to get a transcript in:

### Option A — paste manually

`/meeting-notes` → "New" → paste transcript → Process. No setup needed.

### Option B — generic webhook (works with anything)

Point any tool at `/api/webhooks/transcript`:

```bash
curl -X POST https://your-app.example.com/api/webhooks/transcript \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $TRANSCRIPT_WEBHOOK_SECRET" \
  -d '{
    "title": "Sales call with Acme",
    "transcript": "Full transcript text...",
    "source": "plaud",
    "external_id": "plaud-rec-12345",
    "recorded_at": "2026-04-25T10:00:00Z"
  }'
```

Set `TRANSCRIPT_WEBHOOK_SECRET` in `.env.local`. Idempotent on `external_id` — safe to retry.

This is what to wire your Plaud webhook (or Otter, Fireflies, Read.ai, a custom scraper, a cron job) into. Any tool that can POST JSON.

### Option C — Zoom direct

`/api/webhooks/transcript/zoom` adapts Zoom's `recording.transcript_completed` event to the generic webhook above. In your Zoom Marketplace app:

1. Add event subscription: `recording.transcript_completed`
2. Endpoint URL: `https://your-app.example.com/api/webhooks/transcript/zoom`
3. Set `ZOOM_WEBHOOK_SECRET_TOKEN` in `.env.local` (from Zoom app's Feature page)
4. Validate the endpoint — Zoom sends a one-shot handshake which this route auto-handles

Zoom uploads a VTT file; the route fetches it, strips timestamps, and forwards plain text.

### Option D — email/IMAP

Set `IMAP_*` env vars, configure your meeting bot to email transcripts to that inbox, the poller in `src/lib/imap-poller.ts` picks them up.

## Dispatch System

This is the most powerful + most fragile piece. **Treat it as alpha.**

### What it does

Dispatch is an agentic task queue. You can:
1. Dispatch a one-off task to an agent: "Write a draft for blog post X" → it runs Claude → saves the draft as a doc
2. Schedule recurring dispatches (cron-like): "Every Monday at 9am, summarize last week's tasks"
3. **Forward tasks to a local Mac** via the "bridge" pattern: the cloud app enqueues a task, a process running on your Mac picks it up, runs Claude with full local-machine access, returns the result

### Architecture (bridge mode)

```
[Motion Lite app] -- enqueues --> [dispatch queue (sqlite)]
                                          |
                  (your Mac polls every Xs via /api/dispatch/bridge)
                                          |
                              [claude --print runs locally]
                                          |
                  (Mac POSTs result back to /api/dispatch/[id]/complete)
```

### To wire the bridge (5 min, scripted)

A turnkey setup script lives in `tools/bridge/`. On the Mac you want to use as the worker:

```bash
cd tools/bridge
bash setup.sh
```

It will:
- Prompt for your Motion Lite URL + generate a `BRIDGE_SECRET`
- Test the connection
- Optionally install a launchd job so the bridge auto-starts on login

Then add the same `BRIDGE_SECRET` to your Motion Lite server's `.env.local` and restart it. Done.

Full bridge docs (manual run, troubleshooting, security notes, customizing `claude --print` flags) → [`tools/bridge/README.md`](tools/bridge/README.md).

### To NOT use dispatch

If you don't want any of this — just delete `/dispatch` and `/api/dispatch` routes and remove `dispatch-worker.ts` startup hook in `src/lib/startup.ts`. The rest of the app runs fine without it.

## Operating notes

### Backups
The DB is a single SQLite file at `~/code/store/motion.db`. **Back it up.** Anything — `cp`, rsync, a launchd job that copies it nightly to iCloud Drive, your call. The app does not back itself up.

### Logs
- **App** — `npm run dev` logs to stdout. In production, redirect or use PM2.
- **Bridge worker** — `~/code/motion-lite/tools/bridge/bridge.log` (when run via launchd).
- **Dispatch in-process worker** — same stream as the app (stdout).

### Schema reset (most common "everything is broken" fix)
This app auto-migrates schema on boot. If you pull new code and the app boots but pages start 500'ing with column errors, the cleanest fix is:
```bash
rm ~/code/store/motion.db
# restart the app — fresh DB rebuilt against current schema
```
You'll lose local data. Back up first if you care.

### Renaming the agents
The shipped agents (Gary, Ricky, Sofia, Jimmy, Marcus, etc) are named after my fake team. Rename them in **/agents** or directly in the DB. They're just sub-agent definitions — what matters is the underlying skill they reference.

### Companion repo
Skills bundle: **github.com/Dartagnan98/hiilite-share**. Drop into `~/.claude/skills/` before agents are useful. See setup Step 0.

## Known rough edges

- Some imports may reference deleted CRM code — fix by deleting the importing route or stubbing the function
- Meta + Google Ads dashboards are wired and live — but you bring your own OAuth client ID, app secret, and (for Google Ads) developer token. See the integration env vars in `.env.example`.
- Some settings tabs (CRM/messaging) are UI placeholders that no-op — wired UI for integrations we did not include code for
- The agents listed in `/agents` page reference skill files that live in `~/.claude/skills/` (the marketing-skills bundle from this share). If those skills don't exist on disk, agents will run but with less context.
- IMAP poller logs noisy errors if creds are wrong — set IMAP_* env vars or comment out the `imapPoller.start()` call in `src/lib/startup.ts`
- Push notifications need VAPID keys — also optional, errors are non-fatal
- Schema migrations are auto-applied on boot. If you have an old DB and a new schema lands, you may need to delete `../store/motion.db` and start fresh.
- Single-tenant. Lite version assumes one user. Multi-workspace works but cross-user RLS isn't hardened.
- Electron build is provided but untested in lite — may need adjustments

## Where this came from

Forked from a working internal CRM. The original is in production. This share is to let a friend run a local productivity app + see the dispatch pattern in action without any of the CRM/marketing surface.

If you find bugs, the friend who shared this with you is the right person to ask.

## License

MIT. Use freely.
