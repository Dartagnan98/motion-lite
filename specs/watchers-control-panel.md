# Spec: Watchers Control Panel (motion-lite)

**Status:** Draft for William review
**Author:** Product (PM agent)
**Date:** 2026-05-28
**Repo:** motion-lite
**Cross-refs:**
- Seed: `/Users/williamwalczak/.claude/projects/-Users-williamwalczak-agent-session/memory/project_motion_lite_monitor_skills.md`
- Trigger session: 2026-05-28 Skyleigh watcher shutdown (4-step launchctl dance + 2 OS prompts)
- Related platform doc: `/Users/williamwalczak/code/hiilite-platform/CHARTER.md` (motion-lite is the foundation repo)
- Related feedback: telegram-mirror feedback note (approval-source friction)

---

## Customer

William, sole operator of the agent-session stack today. Forward path: any Hiilite PM who eventually inherits launchd-managed automations and shouldn't be expected to drive `launchctl` from a terminal.

## Pain

Pausing or disabling a Hiilite watcher today is a four-step terminal sequence with two OS permission prompts when the trigger comes from outside the local terminal (e.g. Telegram). Concretely, the 2026-05-28 Skyleigh stop required:

1. `ps aux | grep skyleigh` to find the PID
2. Locate the launchd user agent at `~/Library/LaunchAgents/com.hiilite.skyleigh-watcher.plist` and confirm `RunAtLoad=true` + `KeepAlive=true`
3. `launchctl unload <plist>`
4. `launchctl disable gui/$(id -u)/com.hiilite.skyleigh-watcher`

Auto-mode classifier correctly refuses to trust a Telegram-sourced approval for system-level launchctl actions, so each step that crosses the OS boundary triggers a fresh permission prompt. Every future watcher pause/resume re-pays this tax. We have 12 known watchers today and the number grows monotonically.

## Outcome

A "Watchers" page inside motion-lite that lists every `com.hiilite.*` launchd agent with a running/stopped/disabled status pill, last-log-line preview, and a one-click enable / disable / pause-without-disable action. Because motion-lite is already an authenticated surface, toggling from this page does not trigger a per-action OS prompt.

## Hormozi Value Equation lift

This is a **time delay** and **effort/sacrifice** play, not a new dream outcome. Frame the priority accordingly.

- **Dream outcome:** unchanged (no new capability — this is meta-control of existing watchers)
- **Perceived likelihood:** small positive (visible last-log-line + status pill makes "did it actually stop?" verifiable in one screen instead of three commands)
- **Time delay:** from ~90 seconds (find-plist + unload + disable + verify) down to ~5 seconds (open page, toggle, watch pill flip)
- **Effort/sacrifice:** from "remember launchctl flag order + handle two OS prompts" down to "click toggle in an already-open authenticated tab"

Priority signal: this is a **William-only operator-experience** win until a second human runs this stack. It should slot **behind any external-beta-blocking feature** but ahead of polish work, because it compounds every time a new watcher ships.

## Scope (in)

- **Discovery service** that scans `~/Library/LaunchAgents/com.hiilite.*.plist` on page load and returns a parsed list per agent
- **Parsed fields per watcher**: Label, ProgramArguments (the script path), StandardOutPath, RunAtLoad/KeepAlive/StartCalendarInterval flags, current load state (via `launchctl print gui/<uid>/<label>` or `launchctl list`)
- **Status resolution** into one of: `running` | `stopped` (loaded but not currently executing — relevant for scheduled agents) | `disabled` (will not auto-start) | `errored` (last exit was non-zero) | `unknown`
- **Last-log-line preview**: tail -n 1 of StandardOutPath (truncate to 200 chars in UI; show full line in expanded row)
- **Toggle actions** invoked from UI via authenticated server action:
  - `Enable` → `launchctl enable gui/<uid>/<label>` then `launchctl load <plist>`
  - `Disable` → `launchctl unload <plist>` then `launchctl disable gui/<uid>/<label>`
  - `Pause` → `launchctl unload <plist>` only (preserves disable state so a `launchctl load` later re-arms it)
- **Sidecar description support**: if a `<plist-stem>.md` exists next to the plist or at `~/code/motion-lite/watchers/<label>.md`, render its first paragraph as the description on the row. Otherwise fall back to the plist `Label`.
- **Audit log row** for every toggle: actor (motion-lite session user), action, label, timestamp, before/after status. Stored in motion-lite's existing audit table.
- **Authorization framing in copy**: page footer reads "Actions on this page run under your motion-lite session and do not trigger additional system prompts" so the operator understands why this is faster than terminal.

## Scope (out)

- **No plist authoring UI.** This release reads existing plists only. Creating new watchers stays in source control under `~/agent-session/scripts/` + a manually written plist. (Plist-create UI is a follow-on spec if demand shows up.)
- **No multi-machine support.** All discovery is local to the machine motion-lite runs on. (Phase 4+ concern.)
- **No retroactive plist wrapping for un-plisted scripts.** We flag which sibling scripts under `~/agent-session/scripts/` lack a plist but do not auto-generate one this round (see "Open question" below).
- **No log streaming / tail -f.** Last-line snapshot only. Live stream is a follow-on if William asks.
- **No schedule editing** (StartCalendarInterval, ThrottleInterval). View-only this release.
- **No remote-trigger surface from Telegram.** Telegram still cannot directly toggle watchers. The operator opens motion-lite. This is the whole point of the authorization model.

## UI sketch (plain text)

```
┌─ Watchers ──────────────────────────────────────────────────────────┐
│                                                                     │
│  12 agents discovered under ~/Library/LaunchAgents/com.hiilite.*    │
│  [Refresh]                                                          │
│                                                                     │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ skyleigh-watcher                                  [● running] │   │
│ │ iMessage watcher for Skyleigh thread → agent dispatch         │   │
│ │ Last log: 12:04:11 ingested 1 message (skyleigh)              │   │
│ │ [Pause]  [Disable]                                            │   │
│ └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ telegram-watchdog                                 [● running] │   │
│ │ Bridges Telegram bot polling to the agent session             │   │
│ │ Last log: 12:04:55 poll ok, 0 updates                         │   │
│ │ [Pause]  [Disable]                                            │   │
│ └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ qbo-month-end                                    [○ stopped] │   │
│ │ Monthly QBO close digest, scheduled for the 1st               │   │
│ │ Last log: 2026-05-01 03:00:14 month-end digest sent           │   │
│ │ [Enable]                                                      │   │
│ └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ skyleigh-watcher-v2                              [✕ disabled] │   │
│ │ (experimental; superseded by skyleigh-watcher)                │   │
│ │ Last log: 2026-04-30 18:21:09 exit 0                          │   │
│ │ [Enable]                                                      │   │
│ └───────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Actions on this page run under your motion-lite session and do     │
│  not trigger additional system prompts.                             │
└─────────────────────────────────────────────────────────────────────┘
```

Status pill legend: `● running` (green), `○ stopped` (grey, loaded-but-idle), `✕ disabled` (red), `! errored` (amber).

## Technical contract

### backend-architect owns
- `src/lib/watchers/discovery.ts` — read `~/Library/LaunchAgents/`, filter to `com.hiilite.*.plist`, parse plist XML, return typed `Watcher[]`
- `src/lib/watchers/state.ts` — resolve current state per watcher by shelling `launchctl print gui/<uid>/<label>` and parsing `state = running|not running|...` + `last exit code`
- `src/lib/watchers/sidecar.ts` — look for `<plist-stem>.md` adjacent or at `~/code/motion-lite/watchers/<label>.md`; return first paragraph
- `src/lib/watchers/logs.ts` — tail 1 line from StandardOutPath, with size cap and error handling for missing files
- DB migration: extend the existing audit table with a `watcher_label` column or add `watchers_audit (id, ts, actor, label, action, prev_state, next_state, ok, error)` — backend-architect picks based on existing schema
- Audit insertion called from each server action

### integrations-engineer owns
- `src/server/actions/watchers.ts` — server actions `enableWatcher(label)`, `disableWatcher(label)`, `pauseWatcher(label)` that shell out to `launchctl` and write the audit row
- Error mapping: `launchctl` non-zero exit → return a typed error the UI can render inline on the row (not a toast — keep it row-local so the operator sees which watcher failed)
- No raw shell interpolation of label: validate label matches `^com\.hiilite\.[a-z0-9-]+$` before any shell call

### frontend-eng owns
- `/watchers` route in motion-lite, server-rendered with the parsed watcher list
- Row component with status pill, last-log preview, expand-to-full-log, action buttons
- Optimistic toggle UI with rollback on server-action error
- Footer authorization-model copy
- "Refresh" button (re-runs discovery + state resolution; no auto-poll in v1)

### qa-engineer owns acceptance verification (see below)

## In-scope watcher inventory (today)

Confirmed plists present under `~/Library/LaunchAgents/`:
1. `com.hiilite.skyleigh-watcher` — script: `~/agent-session/scripts/skyleigh-watcher.py`
2. `com.hiilite.telegram-watchdog` — script: `~/agent-session/scripts/telegram-watchdog.sh`
3. `com.hiilite.heartbeat` — script: `~/agent-session/scripts/smart-heartbeat.sh`
4. `com.hiilite.claude-keep-alive` — script: `~/agent-session/scripts/claude-keep-alive.sh`
5. `com.hiilite.qbo-month-end` — script: `~/agent-session/scripts/qbo-month-end.sh`
6. `com.hiilite.imsg-wa-ingest` — script: `~/agent-session/scripts/imsg-wa-ingest.py`
7. `com.hiilite.fyxer-ingest`
8. `com.hiilite.motion-lite-dev`
9. `com.hiilite.calendar-sync`
10. `com.hiilite.teams-ingest`
11. `com.hiilite.agents-sync`
12. `com.hiilite.pagespeed-daily`

Scripts under `~/agent-session/scripts/` that do NOT have a `com.hiilite.*` plist and therefore won't appear in v1:
- `heartbeat-context.sh` — utility called by other scripts; leave un-plisted
- `agent_log.py`, `imsg-send.sh`, `wa-send.sh`, `tg-send.sh`, `replay-last-burst.py` — these are CLI helpers invoked on-demand, not long-running watchers. Do not wrap.

**Recommendation: no new plists in this spec.** v1 ships against the 12 existing agents. Wrap others only when a specific operator-experience pain shows up.

## Acceptance criteria

1. Opening `/watchers` in motion-lite renders one row per `com.hiilite.*.plist` under `~/Library/LaunchAgents/`, ordered alphabetically by label
2. Each row shows: label, description (sidecar or fallback), status pill, last log line (or "no log yet"), action buttons appropriate to current state (Pause+Disable when running; Enable when stopped/disabled)
3. Clicking `Disable` on a running watcher results in `launchctl list | grep com.hiilite.skyleigh-watcher` returning no row within 5 seconds, and the UI pill flips to `disabled`
4. Clicking `Enable` on a disabled watcher results in the process showing in `ps aux` within 15 seconds (KeepAlive=true cases) or a successful `launchctl print` lookup with `state = running` (always)
5. Clicking `Pause` unloads without disabling: a subsequent `launchctl print` shows the agent absent, but the disabled list (`launchctl print-disabled gui/<uid>`) does NOT include the label
6. A `launchctl` failure renders an inline error on the row including stderr; the audit row is written with `ok=false` and the captured stderr
7. Every successful toggle writes an audit row with actor, ts, label, action, prev_state, next_state
8. No OS permission prompt fires for any toggle action when the operator is signed into motion-lite locally
9. Label validation rejects any label that doesn't match `^com\.hiilite\.[a-z0-9-]+$` before invoking launchctl (shell-injection guard)
10. Sidecar lookup: dropping `~/code/motion-lite/watchers/com.hiilite.skyleigh-watcher.md` with one paragraph causes that paragraph to render in the row description within one Refresh
11. Page load time under 1.5s with 12 watchers (state resolution can parallelize)

## Open questions for William

1. **Sidecar location**: prefer `~/code/motion-lite/watchers/<label>.md` (in-repo, version-controlled) or adjacent to the plist in `~/Library/LaunchAgents/<label>.md` (closer to the artifact, not in git)? Default I'd ship: in-repo.
2. **Should `claude-keep-alive` be toggle-able from this UI?** Disabling it kills the very session that hosts motion-lite. Recommend: render the row with a confirm-dialog warning, not exclude it. Operator should still see status.
3. **Audit row visibility**: surface in this page as a "recent toggles" strip, or only via the existing audit log view? Default: separate audit view, link from page header.

## Owner agents + effort estimate

- **backend-architect**: discovery + state + sidecar + logs + audit migration — ~6 hours
- **integrations-engineer**: server actions + launchctl shell + label validation — ~4 hours
- **frontend-eng**: `/watchers` route + row component + optimistic toggles + footer copy — ~6 hours
- **qa-engineer**: acceptance criteria 1–11 verification + adversarial label fuzz — ~2 hours

**Total: ~18 hours, 1 sprint slot.**

## Rollout

- **Feature-flagged** behind an env var or in-app flag (`FEATURE_WATCHERS_PANEL`) on first ship. William flips it on for his own workspace, runs through the Skyleigh enable/disable/pause cycle, sanity-checks audit rows.
- **No external comms.** This is operator-internal; no ricky/gary involvement.
- **GA day-1 for internal Hiilite PMs only** once William signs off — does not enter external-beta scope until a second human regularly inherits launchd-managed work.

## Phase / sprint suggestion

**Phase 4 — but not Sprint 1.** Phase 4 Sprint 1 is committed to external-beta-blocking work (per `HANDOFF-PHASE-4-SPRINT-1.md`). Slot Watchers Control Panel into **Phase 4 Sprint 2 or later**, contingent on Sprint 1 closing clean. If a Sprint 1 spec slips and a backfill slot opens, this is a clean pickup because the contract is fully specified and the scope is one operator (no beta-agency dependencies).

If William wants it sooner, the trade is explicit: one external-beta spec slides one sprint. Recommendation is to keep Sprint 1 focused and pick this up in Sprint 2.

---

**Next step on William's desk:** approve / amend the three open questions above, then I'll hand to backend-architect + frontend-eng + integrations-engineer with this spec as the brief.
