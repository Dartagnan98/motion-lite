# Motion Lite — Project Context

You're being asked to work on a stripped fork of a working solopreneur productivity app. Read this before changing things.

## What this is

Local-first Next.js 16 app. SQLite on disk. Anthropic-powered meeting notes + agentic dispatch system. Fork of a 100K-LOC client CRM with marketing/CRM/messaging surface area torn out — what remains is the **productivity core** (projects, tasks, docs, AI meeting notes, dispatch).

Designed to run on the user's Mac or any Node 20+ box. Single-tenant by default.

## Stack

- **Next.js 16** — app router, React 19, server actions, Turbopack
- **better-sqlite3** — DB at `../store/motion.db` relative to CWD (so the repo lives at `~/code/motion-lite/` and the DB at `~/code/store/motion.db`)
- **@anthropic-ai/sdk** — `ANTHROPIC_API_KEY` required for AI features
- **Tiptap** — rich-text editor
- **Optional**: SendGrid (email), IMAP (transcript ingest), Meta Ads + Google Ads SDKs (dashboards), Electron (desktop wrapper)

## Key directories

```
src/
├── app/                       Next routes
│   ├── login/                 Email + password auth
│   ├── projects-tasks/        Workspaces > folders > projects > stages > tasks
│   ├── meeting-notes/         Transcript paste + AI summarization
│   ├── dispatch/              Agent task queue UI
│   ├── agents/                Sub-agent definitions (read-only)
│   ├── skills/                Skills library (read-only; SKILL.md files live in ~/.claude/skills/)
│   ├── ads/                   Meta Ads dashboard
│   ├── google-ads/            Google Ads dashboard
│   ├── settings/              Workspaces, integrations, API keys
│   └── api/
│       ├── auth/              login, signup, OAuth callbacks
│       ├── dispatch/          queue + bridge endpoints
│       ├── webhooks/transcript/    generic transcript ingest + zoom adapter
│       └── ...
├── lib/
│   ├── db.ts                  ALL SQLite schema + seeders. ~6K lines. Mind the boot path.
│   ├── meeting-processor.ts   Anthropic call that turns a transcript into a doc + tasks
│   ├── agent-executor.ts      Runs an agent (claude --print or programmatic call)
│   ├── dispatch-worker.ts     In-process dispatch tick (separate from the bridge)
│   └── settings.ts            Settings stored in DB (SendGrid key fallback, etc)
└── components/                React components
tools/
└── bridge/                    Mac-side dispatch worker (setup.sh, dispatch-bridge.sh)
```

## DB + schema-on-boot

`src/lib/db.ts` runs on first import — creates tables, runs ALTER TABLE migrations, seeds defaults. It's idempotent.

**Critical quirk**: `seedIfEmpty()` and `ensureAppStartup()` are wrapped in try/catch in `src/app/layout.tsx`. If a seed step throws (usually because the DB was created at an older schema and is missing a column), the app **still boots** — pages just may 500 until you fix the column. Don't remove the try/catch.

If you add a new column anywhere, also add an `ALTER TABLE ... ADD COLUMN` line wrapped in `try { } catch {}` near the existing migration block. Old DBs won't have the column; new DBs get it via CREATE TABLE; both paths must be safe.

If a friend reports "everything 500s after I pulled," the answer is usually:
```
rm ~/code/store/motion.db && restart
```
Loses local data, but rebuilds clean against the current schema.

## Auth

Email + password. Cookie session via `AUTH_SECRET` env var (32+ char random string). First user that POSTs to `/api/auth/login` with `signup: true` becomes the owner. Google OAuth scaffolding exists but the button is removed from `src/app/login/page.tsx` — wire it back if you want it.

## Dispatch

Two execution paths:

1. **In-process worker** (`src/lib/dispatch-worker.ts`) — the Next server itself processes queued dispatches. Started from `src/lib/startup.ts`. Fine for simple cases.
2. **Bridge mode** (`tools/bridge/`) — a Mac polls `/api/dispatch/queue` over HTTP, runs `claude --print` locally with the user's full machine access, POSTs the result back. The cloud-app-talks-to-local-Mac pattern. Auth via shared `BRIDGE_SECRET` header.

Both share the same `dispatch_queue` table. Adding bridge mode doesn't disable the in-process worker — they coexist.

## Meeting notes / transcript ingest

Four ways in:
1. Paste manually in `/meeting-notes`
2. Generic webhook → `POST /api/webhooks/transcript` (auth: `x-webhook-secret`)
3. Zoom direct → `POST /api/webhooks/transcript/zoom` (handles handshake + signature, fetches VTT)
4. IMAP poller (`src/lib/imap-poller.ts`) — email transcripts to a watched inbox

All paths flow into `processTranscriptAI` → Anthropic → creates a doc + extracts tasks against the right project.

## Things the strip pass may have missed

- Some routes may still import deleted CRM modules. If you hit a build error like `Cannot find module '@/lib/crm-foo-thing'`, either delete the route or stub the function.
- Settings tabs for messaging/SMS/CRM may render but no-op — wired UI for integrations whose backend was stripped.
- Schema migrations are auto-applied on boot; old DB + new schema may need a wipe (see DB section above).

## House rules

- **No new features without a clear ask.** This is a stripped fork — don't bolt on more.
- **Don't refactor `db.ts` for "cleanliness."** It's load-bearing and order-sensitive. Add at the end with try/catch ALTERs.
- **Don't add tests just to add them.** No test infra in this lite version.
- **If you delete a route, also delete the matching nav item** in the sidebar so it doesn't 404 from the UI.
- **Default to Tiptap (`@tiptap/react`) for new rich-text inputs.** A custom Notion-style BlockEditor also exists — don't introduce a third editor.

## Companion repo

The `/agents` page references skill files that live in `~/.claude/skills/`. The marketing-skills bundle is a separate repo: **github.com/Dartagnan98/hiilite-share**. Install before agents are useful.
