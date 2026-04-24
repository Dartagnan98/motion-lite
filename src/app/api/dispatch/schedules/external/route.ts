import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { execSync } from 'child_process'
import { listExternalSchedulesFromDb } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * GET /api/dispatch/schedules/external
 *
 * Read-only mirror of recurring work that doesn't live in Motion's DB:
 *   • Hetzner's root crontab (shelled out live)
 *   • Known Mac launchd plists (static seed, bridge push-sync later)
 *
 * Returned as a single array so the UI can merge with Motion schedules and
 * show a source badge per row. These rows are NOT editable from the app --
 * user has to SSH in / edit the plist. Motion just surfaces them.
 */

interface ExternalScheduleRow {
  source: 'hetzner-crontab' | 'mac-launchd'
  label: string
  schedule_hint: string
  program: string | null
  raw: string
  location: string
  editable: false
}

function readHetznerCrontab(): ExternalScheduleRow[] {
  try {
    const out = execSync('crontab -l 2>/dev/null', { encoding: 'utf8', timeout: 2000 })
    const rows: ExternalScheduleRow[] = []
    for (const line of out.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const parts = trimmed.split(/\s+/)
      if (parts.length < 6) continue
      const schedule = parts.slice(0, 5).join(' ')
      const cmd = parts.slice(5).join(' ')
      rows.push({
        source: 'hetzner-crontab',
        label: cmd.slice(0, 80),
        schedule_hint: schedule,
        program: cmd,
        raw: trimmed,
        location: 'root crontab on Hetzner',
        editable: false,
      })
    }
    return rows
  } catch {
    return []
  }
}

/**
 * Fallback list of Mac launchd heartbeats. Used only when the bridge hasn't
 * POSTed its live inventory yet (empty DB table). Once the bridge syncs,
 * we prefer those rows over the seed.
 */
function macLaunchdSeed(): ExternalScheduleRow[] {
  return [
    {
      source: 'mac-launchd',
      label: 'Smart heartbeat (morning report, calendar, briefings)',
      schedule_hint: 'every 15m while awake',
      program: '~/agent-session/scripts/smart-heartbeat.sh',
      raw: 'com.ctrl.heartbeat',
      location: '~/Library/LaunchAgents/com.ctrl.heartbeat.plist',
      editable: false,
    },
    {
      source: 'mac-launchd',
      label: 'Dispatch bridge (Motion → Claude Code on Mac)',
      schedule_hint: 'always running',
      program: '~/agent-session/dispatch-bridge/index.ts',
      raw: 'com.ctrl.dispatch-bridge',
      location: '~/Library/LaunchAgents/com.ctrl.dispatch-bridge.plist',
      editable: false,
    },
  ]
}

export async function GET() {
  try { await requireAuth() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const crontab = readHetznerCrontab()
  // Prefer DB-backed launchd sync from the bridge; fall back to seed when empty.
  const launchdFromDb = listExternalSchedulesFromDb('mac-launchd')
  const launchd: ExternalScheduleRow[] = launchdFromDb.length > 0
    ? launchdFromDb.map(r => ({
        source: 'mac-launchd',
        label: r.label,
        schedule_hint: r.schedule_hint ?? 'launchd',
        program: r.program,
        raw: r.raw,
        location: r.location ?? '',
        editable: false,
      }))
    : macLaunchdSeed()
  return NextResponse.json({
    external: [...crontab, ...launchd],
    crontab_count: crontab.length,
    launchd_count: launchd.length,
    launchd_source: launchdFromDb.length > 0 ? 'bridge-sync' : 'seed',
  })
}
