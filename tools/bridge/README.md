# Dispatch Bridge

Connect a local Mac (with Claude Code installed) to a Motion Lite server's dispatch queue. The bridge polls for queued jobs, runs `claude --print` locally, and POSTs the result back.

## What this enables

- You enqueue a task in Motion Lite ("draft a blog post about X")
- Your Mac picks it up, runs Claude Code locally with **full access to your machine** (your files, your tools, your MCP servers, your skills)
- The result flows back into Motion Lite

This is how the cloud app gets to do things only your local Mac can do — read your Obsidian vault, run scripts that touch your filesystem, talk to local apps via AppleScript, etc.

## Prerequisites

- macOS (or Linux — adapt the launchd plist to systemd)
- `claude` CLI installed and signed in (https://docs.claude.com/claude-code)
- `jq` (`brew install jq`)
- `curl`

## Setup (5 min)

```bash
cd ~/code/motion-lite/tools/bridge
bash setup.sh
```

It will:

1. Ask for your Motion Lite server URL (e.g. `http://localhost:4000` or `https://your-app.example.com`)
2. Generate a `BRIDGE_SECRET` (or accept yours)
3. Test the connection
4. Optionally install a launchd job that auto-starts on login

After setup, **add the same `BRIDGE_SECRET` to your Motion Lite server's `.env.local` and restart it**:

```bash
echo "BRIDGE_SECRET=<the-secret>" >> ~/code/motion-lite/.env.local
# restart npm run dev / pm2 restart / etc
```

## Run manually (no launchd)

```bash
bash dispatch-bridge.sh
```

Logs go to stdout. Ctrl-C to stop.

## Run as launchd service

If you said yes during setup, the job is at `~/Library/LaunchAgents/com.motionlite.dispatch-bridge.plist` and is already loaded.

```bash
# Start
launchctl load ~/Library/LaunchAgents/com.motionlite.dispatch-bridge.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.motionlite.dispatch-bridge.plist

# Check it's running
launchctl list | grep motionlite

# Tail logs
tail -f ~/code/motion-lite/tools/bridge/bridge.log
```

## How a job flows

```
1. You click "Dispatch" in Motion Lite UI
   → row inserted in dispatch_queue (status='queued')

2. Your Mac polls /api/dispatch/queue every 5s with x-bridge-secret header
   → server atomically claims the row (status='working')
   → returns { dispatches: [{ id, agent_id, input_context, ... }] }

3. Bridge spawns: echo "$prompt" | claude --print
   → 30s heartbeat keeps the server from reclaiming the job as stale
   → 300s timeout (configurable via CLAUDE_TIMEOUT in .env)

4. Bridge PATCHes /api/dispatch/<id> with { status: "done", result_summary: <claude output> }
   → Motion Lite UI updates live
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `setup.sh` prints `HTTP 401` | `BRIDGE_SECRET` doesn't match between Mac and server. Re-set it on both sides. |
| `setup.sh` prints `HTTP 404` | Wrong `MOTION_URL`. Check the path is right. |
| Bridge runs but jobs never get claimed | Check Motion Lite Settings → Dispatch → bridge status. If "offline" the server isn't seeing your polls. Likely a `BRIDGE_SECRET` mismatch (server returns 401, bridge silently keeps polling). |
| Claude hangs | `CLAUDE_TIMEOUT` (default 300s) kills it. For long jobs increase it in `.env`. |
| `claude: command not found` in launchd logs | launchd doesn't see your shell PATH. The plist sets `/opt/homebrew/bin:/usr/local/bin:...`. If `claude` is somewhere else (e.g. `~/.npm-global/bin/`), edit the plist `EnvironmentVariables.PATH`. |

## Security notes

- `BRIDGE_SECRET` is a shared symmetric secret. Don't commit `.env`. The setup script chmods it to 600.
- The bridge runs `claude --print` with whatever prompt the server sends. **Anyone who can dispatch in Motion Lite can run arbitrary prompts on your Mac with your Claude session.** Treat dispatch access like SSH access. Lock down Motion Lite auth accordingly.
- For production, run Motion Lite behind HTTPS so the BRIDGE_SECRET isn't sent in plaintext.

## Customizing what runs

The default bridge runs `claude --print`. If you want a different model, append flags inside `dispatch-bridge.sh`:

```bash
result=$(echo "$prompt" | timeout "$CLAUDE_TIMEOUT" claude --print --model claude-sonnet-4-6 2>&1)
```

For tool-forwarding (where the server sends a structured tool call instead of a freeform prompt — e.g. "open Obsidian note X" or "say this via macOS say"), see the bridge tools at `tools/bridge/handlers/` (not included in lite — easy to add).
